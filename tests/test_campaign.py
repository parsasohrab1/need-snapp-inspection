import pytest
from datetime import timedelta
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.domain.errors import DomainError
from app.models import Document, InspectionPoint, Inspector, Offer, User, utcnow
from app.scenarios import build_campaign, run_campaign
from app.services.engine import (
    accept_offer,
    add_evidence,
    broadcast,
    confirm_remote_location,
    expire_offers,
    mark_ready,
    start_remote,
    submit_visit,
)


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def test_document_gate_blocks_ready_point():
    session = _session()
    world = build_campaign(session)
    point = session.scalar(select(InspectionPoint).where(InspectionPoint.discipline == "coating"))
    session.execute(delete(Document).where(Document.doc_type == "coating_spec"))
    with pytest.raises(DomainError) as caught:
        mark_ready(session, point.id, world["vendor"])
    assert caught.value.code == "docs_missing"
    session.close()


def test_relevant_campaign_closes_forty_points():
    session = _session()
    report = run_campaign(session)
    session.close()
    assert report["passed"], report
    assert report["accepted"] == 40
    assert report["ncr_reworked"] == 3
    assert report["site_offers_to_far_inspector"] == 0


def test_offer_expiry_sends_next_nearest_inspector():
    session = _session()
    world = build_campaign(session)
    point = session.scalar(select(InspectionPoint).where(InspectionPoint.discipline == "welding"))
    near_user = session.scalar(select(User).where(User.username == "lab.w1"))
    near = session.scalar(select(Inspector).where(Inspector.user_id == near_user.id))
    near.engagement = "hourly"
    mark_ready(session, point.id, world["vendor"])

    start = utcnow()
    first = broadcast(session, point.id, world["coordinator"], now=start)[0]
    assert first.inspector_id == near.id
    assert first.expires_at == start + timedelta(minutes=30)

    expire_offers(session, now=first.expires_at + timedelta(seconds=1))
    offers = session.scalars(select(Offer).where(Offer.point_id == point.id).order_by(Offer.id)).all()
    assert offers[0].status == "expired"
    assert offers[1].status == "pending"
    assert offers[1].inspector_id != near.id
    assert offers[1].created_at == first.expires_at + timedelta(seconds=1)
    session.close()


def test_remote_report_evidence_requires_confirmed_geolocation():
    session = _session()
    world = build_campaign(session)
    point = session.scalar(select(InspectionPoint).where(InspectionPoint.discipline == "documentation"))
    point.remote_allowed = True
    mark_ready(session, point.id, world["vendor"], remote_requested=True)
    offer = broadcast(session, point.id, world["coordinator"])[0]
    inspector = session.get(Inspector, offer.inspector_id)
    user = session.get(User, inspector.user_id)
    visit = accept_offer(session, offer.id, user)
    start_remote(session, visit.id, user)

    with pytest.raises(DomainError) as caught:
        add_evidence(session, visit.id, user, "مدرک", None, None)
    assert caught.value.code == "location_required"
    with pytest.raises(DomainError) as caught:
        submit_visit(
            session,
            visit.id,
            user,
            "accept",
            "گزارش بازرسی",
            require_signature=False,
            require_in_report=False,
        )
    assert caught.value.code == "location_required"

    confirm_remote_location(session, visit.id, user, 35.755, 50.958)
    evidence = add_evidence(session, visit.id, user, "مدرک", 35.755, 50.958)
    assert evidence.visit_id == visit.id
    session.close()

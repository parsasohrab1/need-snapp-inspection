"""کمپین آزمایشگاهی ۴۰ نقطه‌ای. محیط مرتبط، شبیه‌سازی کارگاه است نه آرشیو یک سایت واقعی."""

import json
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.domain.catalog import DOC_LABELS, EQUIPMENT_CLASSES
from app.domain.commercial import PLATFORM_COMMISSION
from app.domain.errors import DomainError
from app.models import Equipment, InspectionPoint, Inspector, Ledger, Offer, User, Visit, utcnow
from app.security import hash_password
from app.services.engine import (
    accept_offer,
    add_document,
    add_site_photos,
    broadcast,
    confirm_by_client,
    confirm_remote_location,
    decline_offer,
    expire_offers,
    mark_arrived,
    mark_en_route,
    mark_ready,
    review_visit,
    save_checklist,
    start_remote,
    submit_visit,
)
from app.models import Company, Project, PurchaseOrder
from app.seed import DOC_TYPES, EQUIPMENT

WORKSHOP = (35.755, 50.958)


def _add_user(session: Session, username: str, name: str, role: str, company_id: int | None = None) -> User:
    user = User(
        username=username,
        name=name,
        role=role,
        password_hash=hash_password("demo1234"),
        company_id=company_id,
    )
    session.add(user)
    session.flush()
    return user


def build_campaign(session: Session) -> dict:
    buyer_co = Company(name="کارفرمای آزمایشگاهی", kind="buyer")
    vendor_co = Company(name="کارگاه آزمایشگاهی", kind="vendor")
    session.add_all([buyer_co, vendor_co])
    session.flush()
    buyer = _add_user(session, "lab.buyer", "کارفرما", "buyer", buyer_co.id)
    manager = _add_user(session, "lab.manager", "مدیر پروژه", "manager", buyer_co.id)
    unit_manager = _add_user(session, "lab.unit.manager", "مدیر واحد", "unit_manager")
    vendor = _add_user(session, "lab.vendor", "سازنده", "vendor", vendor_co.id)
    coordinator = _add_user(session, "lab.coordinator", "هماهنگ‌کننده", "coordinator")
    roster = [
        ("lab.w1", "جوش نزدیک", 35.760, 50.970, 40, 4.6, ["welding"]),
        ("lab.w2", "جوش دوم", 35.790, 51.040, 50, 4.4, ["welding"]),
        ("lab.ndt", "NDT", 35.770, 50.990, 40, 4.7, ["ndt"]),
        ("lab.mech", "مکانیک و تست", 35.750, 51.020, 60, 4.5, ["mechanical", "hydrotest", "material"]),
        ("lab.coat", "پوشش", 35.730, 51.080, 70, 4.5, ["coating"]),
        ("lab.docs", "مدارک محلی", 35.748, 50.950, 30, 4.4, ["documentation"]),
        ("lab.far", "بازرس اصفهان", 32.654, 51.668, 20, 5.0, ["welding", "documentation"]),
        ("lab.off", "بازرس آفلاین", 35.760, 50.960, 40, 4.0, ["welding", "ndt", "mechanical"]),
    ]
    far_id = None
    for username, name, lat, lng, radius, rating, disciplines in roster:
        user = _add_user(session, username, name, "inspector")
        online = username != "lab.off"
        inspector = Inspector(
            user_id=user.id,
            city=name,
            lat=lat,
            lng=lng,
            radius_km=radius,
            online=online,
            rating=rating,
            max_parallel=3,
            disciplines_json=json.dumps(disciplines),
            certifications_json="[]",
        )
        session.add(inspector)
        session.flush()
        if username == "lab.far":
            far_id = inspector.id
    project = Project(code="LAB-40", name="کمپین ۴۰ نقطه", buyer_company_id=buyer_co.id, description="اعتبارسنجی محیط مرتبط")
    session.add(project)
    session.flush()
    order = PurchaseOrder(project_id=project.id, vendor_company_id=vendor_co.id, number="PO-LAB-40", title="تجهیزات نمونه")
    session.add(order)
    session.flush()
    for tag, clazz, title in EQUIPMENT:
        class_title, standard, templates = EQUIPMENT_CLASSES[clazz]
        item = Equipment(
            po_id=order.id,
            tag=tag,
            title=title,
            clazz=clazz,
            standard=standard,
            workshop_name="کارگاه آزمایشگاهی کرج",
            city="کرج",
            lat=WORKSHOP[0],
            lng=WORKSHOP[1],
        )
        session.add(item)
        session.flush()
        for doc_type in DOC_TYPES:
            add_document(
                session,
                equipment_id=item.id,
                doc_type=doc_type,
                title=DOC_LABELS.get(doc_type, doc_type),
                filename=f"{tag}-{doc_type}.pdf",
                actor=vendor,
            )
        for seq, template in enumerate(templates, start=1):
            session.add(
                InspectionPoint(
                    equipment_id=item.id,
                    seq=seq,
                    title=template.title,
                    discipline=template.discipline,
                    point_type=template.point_type,
                    standard_ref=template.standard_ref,
                    remote_allowed=template.remote_allowed,
                    required_docs_json=json.dumps(list(template.required_docs)),
                    checklist_json=json.dumps(
                        [{"id": check.id, "text": check.text, "mandatory": True} for check in template.checklist],
                        ensure_ascii=False,
                    ),
                )
            )
    session.flush()
    point_ids = list(session.scalars(select(InspectionPoint.id).order_by(InspectionPoint.id)).all())
    if len(point_ids) != 40:
        raise RuntimeError(f"expected 40 points, got {len(point_ids)}")
    for point_id in point_ids:
        session.get(InspectionPoint, point_id).unit_manager_id = unit_manager.id
    return {
        "vendor": vendor,
        "buyer": buyer,
        "manager": manager,
        "unit_manager": unit_manager,
        "coordinator": coordinator,
        "far_inspector_id": far_id,
        "point_ids": point_ids,
    }


def _user_of(session: Session, inspector_id: int) -> User:
    inspector = session.get(Inspector, inspector_id)
    return session.get(User, inspector.user_id)


def _complete(session, point, visit, user: User, *, fail: bool) -> str:
    answers = []
    for index, item in enumerate(point.checklist):
        if fail and index == 0:
            answers.append({"item_id": item["id"], "value": "fail", "note": "خارج از معیار پذیرش"})
        else:
            answers.append({"item_id": item["id"], "value": "pass", "note": ""})
    save_checklist(session, visit.id, user, answers)
    if point.point_type in {"H", "W"} and not visit.remote:
        add_site_photos(session, visit.id, user, WORKSHOP[0], WORKSHOP[1])
    result = "reject" if fail else "accept"
    note = "شرح بازبینی مدارک از راه دور برای این نقطه ثبت شد." if visit.remote else "نتیجه بازدید کارگاهی ثبت شد."
    submit_visit(session, visit.id, user, result, note, require_signature=False, require_in_report=False)
    return result


def run_campaign(session: Session) -> dict:
    world = build_campaign(session)
    coordinator = world["coordinator"]
    buyer = world["buyer"]
    vendor = world["vendor"]
    manager = world["manager"]
    unit_manager = world["unit_manager"]
    far_id = world["far_inspector_id"]
    points = [session.get(InspectionPoint, pid) for pid in world["point_ids"]]

    first = next(point for point in points if point.discipline == "welding")
    mark_ready(session, first.id, vendor)
    broadcast(session, first.id, coordinator, ttl_seconds=60)
    probe = session.scalars(select(Offer).where(Offer.point_id == first.id, Offer.status == "pending")).first()
    expired = expire_offers(session, now=probe.expires_at + timedelta(seconds=1))
    session.refresh(first)
    successor = session.scalars(select(Offer).where(Offer.point_id == first.id, Offer.status == "pending")).first()
    if expired < 1 or first.status != "offering" or successor is None or successor.inspector_id == probe.inspector_id:
        raise RuntimeError("expire drill failed")
    try:
        accept_offer(session, probe.id, _user_of(session, probe.inspector_id), now=probe.expires_at + timedelta(seconds=1))
        raise RuntimeError("expired offer was accepted")
    except DomainError as exc:
        double_accept_blocked = exc.code in {"offer_expired", "offer_closed"}
    session.execute(delete(Offer).where(Offer.point_id == first.id))
    first.status = "ready"
    session.flush()

    geofence_blocked = False
    declined = 0
    remote_taken_by_far = 0
    site_offers_to_far = 0
    ncr_count = 0
    fail_once = {"welding", "ndt", "hydrotest"}
    failed_done: set[str] = set()

    for point in points:
        remote = bool(point.remote_allowed and point.discipline == "documentation")
        mark_ready(session, point.id, vendor, remote_requested=remote)
        offers = broadcast(session, point.id, coordinator, ttl_seconds=600)
        if not offers:
            raise RuntimeError(f"no offer for {point.title}")
        if any(item.inspector_id == far_id for item in offers):
            if remote:
                remote_taken_by_far += 1
            else:
                site_offers_to_far += 1
        if len(offers) >= 2 and not double_accept_blocked:
            winner = accept_offer(session, offers[0].id, _user_of(session, offers[0].inspector_id))
            try:
                accept_offer(session, offers[1].id, _user_of(session, offers[1].inspector_id))
            except DomainError as exc:
                double_accept_blocked = exc.code in {"offer_taken", "offer_closed"}
            visit = winner
            user = _user_of(session, offers[0].inspector_id)
        else:
            if len(offers) >= 2:
                decline_offer(session, offers[-1].id, _user_of(session, offers[-1].inspector_id))
                declined += 1
                offers = [item for item in offers if item.status == "pending"]
            visit = accept_offer(session, offers[0].id, _user_of(session, offers[0].inspector_id))
            user = _user_of(session, offers[0].inspector_id)
        if remote:
            start_remote(session, visit.id, user)
            confirm_remote_location(session, visit.id, user, equipment.lat, equipment.lng)
        else:
            mark_en_route(session, visit.id, user)
            if not geofence_blocked:
                try:
                    mark_arrived(session, visit.id, user, 36.30, 59.60)
                except DomainError as exc:
                    geofence_blocked = exc.code == "geofence"
            equipment = session.get(Equipment, point.equipment_id)
            mark_arrived(session, visit.id, user, equipment.lat, equipment.lng)
        fail = point.discipline in fail_once and point.discipline not in failed_done and point.point_type == "H"
        result = _complete(session, point, visit, user, fail=fail)
        if result == "reject":
            review_visit(session, visit.id, unit_manager, "return", "بازرس باید ایراد ثبت‌شده را اصلاح کند")
            failed_done.add(point.discipline)
            ncr_count += 1
            _complete(session, point, visit, user, fail=False)
            review_visit(session, visit.id, unit_manager, "approve")
            review_visit(session, visit.id, manager, "approve")
            confirm_by_client(session, visit.id, buyer)
        else:
            review_visit(session, visit.id, unit_manager, "approve")
            review_visit(session, visit.id, manager, "approve")
            confirm_by_client(session, visit.id, buyer)

    accepted = session.scalar(select(func.count(InspectionPoint.id)).where(InspectionPoint.status == "accepted"))
    ledgers = session.scalars(select(Ledger)).all()
    fee = sum(row.fee_irr for row in ledgers)
    commission = sum(row.commission_irr for row in ledgers)
    open_ncr = session.scalar(select(func.count(InspectionPoint.id)).where(InspectionPoint.ncr_open.is_(True)))
    visits = session.scalar(select(func.count(Visit.id)))
    report = {
        "points": 40,
        "accepted": int(accepted or 0),
        "ledgers": len(ledgers),
        "fee_irr": fee,
        "commission_irr": commission,
        "commission_rate": round(commission / fee, 4) if fee else 0,
        "expected_rate": PLATFORM_COMMISSION,
        "open_ncr": int(open_ncr or 0),
        "visits": int(visits or 0),
        "ncr_reworked": ncr_count,
        "declined": declined,
        "geofence_blocked": geofence_blocked,
        "double_accept_blocked": double_accept_blocked,
        "expire_drill": expired,
        "remote_offers_to_far_inspector": remote_taken_by_far,
        "site_offers_to_far_inspector": site_offers_to_far,
        "offline_offers": int(
            session.scalar(
                select(func.count(Offer.id)).where(
                    Offer.inspector_id == session.scalar(select(Inspector.id).where(Inspector.online.is_(False)))
                )
            )
            or 0
        ),
    }
    problems = []
    if report["accepted"] != 40:
        problems.append("accepted")
    if report["ledgers"] != 40:
        problems.append("ledgers")
    if report["open_ncr"] != 0:
        problems.append("ncr")
    if not report["geofence_blocked"] or not report["double_accept_blocked"]:
        problems.append("guards")
    if report["site_offers_to_far_inspector"] != 0:
        problems.append("radius")
    if report["offline_offers"] != 0:
        problems.append("offline")
    if ncr_count != 3:
        problems.append("rework")
    if abs(report["commission_rate"] - PLATFORM_COMMISSION) > 0.001:
        problems.append("commission")
    report["problems"] = problems
    report["passed"] = not problems
    return report

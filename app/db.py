import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


_engine = None
SessionLocal = sessionmaker(autocommit=False, expire_on_commit=False)


def database_url() -> str:
    return os.environ.get("NSI_DATABASE_URL", "sqlite:///data/snapp.db")


def get_engine():
    global _engine
    if _engine is None:
        url = database_url()
        kwargs = {"connect_args": {"check_same_thread": False}}
        if url == "sqlite://":
            kwargs["poolclass"] = StaticPool
        elif url.startswith("sqlite:///"):
            path = url.removeprefix("sqlite:///")
            folder = os.path.dirname(path)
            if folder:
                os.makedirs(folder, exist_ok=True)
        _engine = create_engine(url, **kwargs)
        SessionLocal.configure(bind=_engine)
    return _engine


def init_db() -> None:
    from app import models  # noqa: F401

    engine = get_engine()
    Base.metadata.create_all(engine)
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        rows = conn.exec_driver_sql("PRAGMA table_info(projects)").fetchall()
        names = {row[1] for row in rows}
        if names and "kind" not in names:
            conn.exec_driver_sql("ALTER TABLE projects ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'project'")
        evidence = conn.exec_driver_sql("PRAGMA table_info(evidence)").fetchall()
        evidence_names = {row[1] for row in evidence}
        if evidence_names and "kind" not in evidence_names:
            conn.exec_driver_sql("ALTER TABLE evidence ADD COLUMN kind VARCHAR(32) NOT NULL DEFAULT 'item'")
        if evidence_names and "stored_name" not in evidence_names:
            conn.exec_driver_sql("ALTER TABLE evidence ADD COLUMN stored_name VARCHAR(80) NOT NULL DEFAULT ''")
        if evidence_names and "filename" not in evidence_names:
            conn.exec_driver_sql("ALTER TABLE evidence ADD COLUMN filename VARCHAR(200) NOT NULL DEFAULT ''")
        if evidence_names and "media_type" not in evidence_names:
            conn.exec_driver_sql("ALTER TABLE evidence ADD COLUMN media_type VARCHAR(120) NOT NULL DEFAULT ''")
        documents = conn.exec_driver_sql("PRAGMA table_info(documents)").fetchall()
        document_names = {row[1] for row in documents}
        if document_names and "stored_name" not in document_names:
            conn.exec_driver_sql("ALTER TABLE documents ADD COLUMN stored_name VARCHAR(80) NOT NULL DEFAULT ''")
        points = conn.exec_driver_sql("PRAGMA table_info(inspection_points)").fetchall()
        point_names = {row[1] for row in points}
        if point_names and "request_status" not in point_names:
            conn.exec_driver_sql("ALTER TABLE inspection_points ADD COLUMN request_status VARCHAR(32) NOT NULL DEFAULT 'draft'")
        if point_names and "request_note" not in point_names:
            conn.exec_driver_sql("ALTER TABLE inspection_points ADD COLUMN request_note TEXT NOT NULL DEFAULT ''")
        if point_names and "request_form_id" not in point_names:
            conn.exec_driver_sql("ALTER TABLE inspection_points ADD COLUMN request_form_id INTEGER")
        if point_names and "request_department" not in point_names:
            conn.exec_driver_sql("ALTER TABLE inspection_points ADD COLUMN request_department VARCHAR(80) NOT NULL DEFAULT ''")
        if point_names and "unit_manager_id" not in point_names:
            conn.exec_driver_sql("ALTER TABLE inspection_points ADD COLUMN unit_manager_id INTEGER")
        visits = conn.exec_driver_sql("PRAGMA table_info(visits)").fetchall()
        visit_names = {row[1] for row in visits}
        if visit_names and "client_approved_at" not in visit_names:
            conn.exec_driver_sql("ALTER TABLE visits ADD COLUMN client_approved_at DATETIME")
        if visit_names and "client_rejection_note" not in visit_names:
            conn.exec_driver_sql("ALTER TABLE visits ADD COLUMN client_rejection_note TEXT NOT NULL DEFAULT ''")
        inspectors = conn.exec_driver_sql("PRAGMA table_info(inspectors)").fetchall()
        inspector_names = {row[1] for row in inspectors}
        if inspector_names and "engagement" not in inspector_names:
            conn.exec_driver_sql("ALTER TABLE inspectors ADD COLUMN engagement VARCHAR(16) NOT NULL DEFAULT 'fixed'")
        visits = conn.exec_driver_sql("PRAGMA table_info(visits)").fetchall()
        visit_names = {row[1] for row in visits}
        if visit_names and "report_stage" not in visit_names:
            conn.exec_driver_sql("ALTER TABLE visits ADD COLUMN report_stage VARCHAR(32) NOT NULL DEFAULT ''")
        if visit_names and "review_note" not in visit_names:
            conn.exec_driver_sql("ALTER TABLE visits ADD COLUMN review_note TEXT NOT NULL DEFAULT ''")
        if visit_names and "report_form_json" not in visit_names:
            conn.exec_driver_sql("ALTER TABLE visits ADD COLUMN report_form_json TEXT NOT NULL DEFAULT '{}'")
        if visit_names:
            conn.exec_driver_sql(
                "UPDATE visits SET report_stage = CASE "
                "WHEN phase = 'submitted' THEN 'unit_review' "
                "WHEN phase = 'client' THEN 'client_review' "
                "WHEN phase = 'confirmed' THEN 'confirmed' "
                "ELSE report_stage END "
                "WHERE report_stage = ''"
            )
        offers = conn.exec_driver_sql("PRAGMA table_info(offers)").fetchall()
        offer_names = {row[1] for row in offers}
        if offer_names and "travel_irr" not in offer_names:
            conn.exec_driver_sql("ALTER TABLE offers ADD COLUMN travel_irr INTEGER NOT NULL DEFAULT 0")
        ledger = conn.exec_driver_sql("PRAGMA table_info(ledger)").fetchall()
        ledger_names = {row[1] for row in ledger}
        if ledger_names and "travel_irr" not in ledger_names:
            conn.exec_driver_sql("ALTER TABLE ledger ADD COLUMN travel_irr INTEGER NOT NULL DEFAULT 0")
        if conn.exec_driver_sql("PRAGMA table_info(users)").fetchall():
            conn.exec_driver_sql(
                "UPDATE users SET role = 'coordinator', name = 'هماهنگ‌کننده اعزام', username = 'coordinator.legacy' "
                "WHERE role = 'executive_manager' AND username = 'executive' "
                "AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'coordinator.legacy')"
            )
            conn.exec_driver_sql(
                "UPDATE users SET role = 'coordinator', name = 'هماهنگ‌کننده اعزام' "
                "WHERE role = 'executive_manager'"
            )
        conn.exec_driver_sql(
            "UPDATE inspection_points SET request_status = 'manager_review' "
            "WHERE request_status = 'executive_review'"
        )
        bills = conn.exec_driver_sql("PRAGMA table_info(bills)").fetchall()
        bill_names = {row[1] for row in bills}
        if bill_names and "accounting_status" not in bill_names:
            conn.exec_driver_sql("ALTER TABLE bills ADD COLUMN accounting_status VARCHAR(32) NOT NULL DEFAULT 'issued'")
        if bill_names and "accounting_note" not in bill_names:
            conn.exec_driver_sql("ALTER TABLE bills ADD COLUMN accounting_note TEXT NOT NULL DEFAULT ''")
        if bill_names and "accounting_updated_at" not in bill_names:
            conn.exec_driver_sql("ALTER TABLE bills ADD COLUMN accounting_updated_at DATETIME")
        if bill_names and "claim_status" not in bill_names:
            conn.exec_driver_sql("ALTER TABLE bills ADD COLUMN claim_status VARCHAR(32) NOT NULL DEFAULT 'unpaid'")
        if bill_names and "claim_note" not in bill_names:
            conn.exec_driver_sql("ALTER TABLE bills ADD COLUMN claim_note TEXT NOT NULL DEFAULT ''")
        if bill_names and "claim_updated_at" not in bill_names:
            conn.exec_driver_sql("ALTER TABLE bills ADD COLUMN claim_updated_at DATETIME")


def open_session() -> Session:
    get_engine()
    return SessionLocal()


def session_scope() -> Iterator[Session]:
    db = open_session()
    try:
        yield db
    finally:
        db.close()


def reset_engine() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None

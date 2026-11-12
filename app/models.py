import json
from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    """ساعت محلی بدون منطقه زمانی تا شمارش معکوس مرورگر با سرور یکی باشد."""
    return datetime.now()


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(32))


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(32))
    phone: Mapped[str] = mapped_column(String(32), default="")
    password_hash: Mapped[str] = mapped_column(String(160))
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"), nullable=True)


class Inspector(Base):
    __tablename__ = "inspectors"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    city: Mapped[str] = mapped_column(String(80))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    radius_km: Mapped[float] = mapped_column(Float, default=60)
    online: Mapped[bool] = mapped_column(Boolean, default=True)
    rating: Mapped[float] = mapped_column(Float, default=4.5)
    max_parallel: Mapped[int] = mapped_column(Integer, default=2)
    engagement: Mapped[str] = mapped_column(String(16), default="fixed")
    disciplines_json: Mapped[str] = mapped_column(Text, default="[]")
    certifications_json: Mapped[str] = mapped_column(Text, default="[]")

    @property
    def disciplines(self) -> list[str]:
        return json.loads(self.disciplines_json)

    @property
    def certifications(self) -> list[str]:
        return json.loads(self.certifications_json)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16), default="project")
    buyer_company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    description: Mapped[str] = mapped_column(Text, default="")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    vendor_company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    number: Mapped[str] = mapped_column(String(40), unique=True)
    title: Mapped[str] = mapped_column(String(200))


class Equipment(Base):
    __tablename__ = "equipment"
    id: Mapped[int] = mapped_column(primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"))
    tag: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(160))
    clazz: Mapped[str] = mapped_column(String(40))
    standard: Mapped[str] = mapped_column(String(80))
    workshop_name: Mapped[str] = mapped_column(String(160))
    city: Mapped[str] = mapped_column(String(80))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)


class InspectionPoint(Base):
    __tablename__ = "inspection_points"
    id: Mapped[int] = mapped_column(primary_key=True)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.id"))
    seq: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    discipline: Mapped[str] = mapped_column(String(40))
    point_type: Mapped[str] = mapped_column(String(4))
    standard_ref: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(32), default="planned")
    remote_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    remote_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    required_docs_json: Mapped[str] = mapped_column(Text, default="[]")
    checklist_json: Mapped[str] = mapped_column(Text, default="[]")
    ncr_open: Mapped[bool] = mapped_column(Boolean, default=False)
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    window_note: Mapped[str] = mapped_column(String(200), default="")
    request_status: Mapped[str] = mapped_column(String(32), default="draft")
    request_note: Mapped[str] = mapped_column(Text, default="")
    request_form_id: Mapped[int | None] = mapped_column(ForeignKey("form_sheets.id"), nullable=True)
    request_department: Mapped[str] = mapped_column(String(80), default="")
    unit_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    __table_args__ = (UniqueConstraint("equipment_id", "seq"),)

    @property
    def required_docs(self) -> list[str]:
        return json.loads(self.required_docs_json)

    @property
    def checklist(self) -> list[dict]:
        return json.loads(self.checklist_json)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.id"))
    doc_type: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str] = mapped_column(String(200))
    stored_name: Mapped[str] = mapped_column(String(80), default="")
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Offer(Base):
    __tablename__ = "offers"
    id: Mapped[int] = mapped_column(primary_key=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("inspection_points.id"))
    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    score: Mapped[float] = mapped_column(Float)
    distance_km: Mapped[float] = mapped_column(Float)
    fee_irr: Mapped[int] = mapped_column(Integer)
    commission_irr: Mapped[int] = mapped_column(Integer)
    net_irr: Mapped[int] = mapped_column(Integer)
    travel_irr: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime] = mapped_column()
    decided_at: Mapped[datetime | None] = mapped_column(nullable=True)


class Visit(Base):
    __tablename__ = "visits"
    id: Mapped[int] = mapped_column(primary_key=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("inspection_points.id"))
    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"))
    offer_id: Mapped[int | None] = mapped_column(ForeignKey("offers.id"), nullable=True)
    phase: Mapped[str] = mapped_column(String(20), default="assigned")
    report_stage: Mapped[str] = mapped_column(String(32), default="")
    review_note: Mapped[str] = mapped_column(Text, default="")
    report_form_json: Mapped[str] = mapped_column(Text, default="{}")
    result: Mapped[str] = mapped_column(String(20), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    ivr_no: Mapped[str] = mapped_column(String(40), default="")
    remote: Mapped[bool] = mapped_column(Boolean, default=False)
    arrive_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    arrive_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    arrive_distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    arrived_at: Mapped[datetime | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    client_approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    client_rejection_note: Mapped[str] = mapped_column(Text, default="")


class ChecklistAnswer(Base):
    __tablename__ = "checklist_answers"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"))
    item_id: Mapped[str] = mapped_column(String(80))
    value: Mapped[str] = mapped_column(String(8))
    note: Mapped[str] = mapped_column(Text, default="")


class ReportComment(Base):
    __tablename__ = "report_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class InspectionRequestComment(Base):
    __tablename__ = "inspection_request_comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("inspection_points.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class InspectionRequestApproval(Base):
    __tablename__ = "inspection_request_approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    point_id: Mapped[int] = mapped_column(ForeignKey("inspection_points.id"))
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    stage: Mapped[str] = mapped_column(String(20))
    signature_filename: Mapped[str] = mapped_column(String(200))
    signature_stored_name: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"))
    caption: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(32), default="item")
    stored_name: Mapped[str] = mapped_column(String(80), default="")
    filename: Mapped[str] = mapped_column(String(200), default="")
    media_type: Mapped[str] = mapped_column(String(120), default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Mom(Base):
    __tablename__ = "moms"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    held_on: Mapped[str] = mapped_column(String(20))
    attendees: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))


class FormSheet(Base):
    __tablename__ = "form_sheets"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(8))
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    read: Mapped[bool] = mapped_column(Boolean, default=False)


class Bill(Base):
    __tablename__ = "bills"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), unique=True)
    kind: Mapped[str] = mapped_column(String(16), default="project")
    statement_no: Mapped[str] = mapped_column(String(40))
    invoice_no: Mapped[str] = mapped_column(String(40))
    gross_irr: Mapped[int] = mapped_column(Integer)
    performance_rate: Mapped[int] = mapped_column(Integer)
    performance_irr: Mapped[int] = mapped_column(Integer)
    insurance_rate: Mapped[int] = mapped_column(Integer)
    insurance_irr: Mapped[int] = mapped_column(Integer)
    tax_rate: Mapped[int] = mapped_column(Integer)
    tax_irr: Mapped[int] = mapped_column(Integer)
    vat_rate: Mapped[int] = mapped_column(Integer)
    vat_irr: Mapped[int] = mapped_column(Integer)
    net_irr: Mapped[int] = mapped_column(Integer)
    client_name: Mapped[str] = mapped_column(String(160), default="")
    company_name: Mapped[str] = mapped_column(String(160), default="")
    tag: Mapped[str] = mapped_column(String(40), default="")
    title: Mapped[str] = mapped_column(String(200), default="")
    ivr_no: Mapped[str] = mapped_column(String(40), default="")
    basis: Mapped[str] = mapped_column(Text, default="")
    issued_at: Mapped[datetime] = mapped_column(default=utcnow)
    accounting_status: Mapped[str] = mapped_column(String(32), default="issued")
    accounting_note: Mapped[str] = mapped_column(Text, default="")
    accounting_updated_at: Mapped[datetime] = mapped_column(default=utcnow)
    claim_status: Mapped[str] = mapped_column(String(32), default="unpaid")
    claim_note: Mapped[str] = mapped_column(Text, default="")
    claim_updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class Ledger(Base):
    __tablename__ = "ledger"
    id: Mapped[int] = mapped_column(primary_key=True)
    visit_id: Mapped[int] = mapped_column(ForeignKey("visits.id"), unique=True)
    inspector_id: Mapped[int] = mapped_column(ForeignKey("inspectors.id"))
    fee_irr: Mapped[int] = mapped_column(Integer)
    commission_irr: Mapped[int] = mapped_column(Integer)
    net_irr: Mapped[int] = mapped_column(Integer)
    travel_irr: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(60))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

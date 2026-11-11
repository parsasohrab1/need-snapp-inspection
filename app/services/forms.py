import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.blanks import known_kinds, normalize, template
from app.domain.errors import DomainError
from app.models import Equipment, FormSheet, InspectionPoint, Project, PurchaseOrder, User, utcnow


def _require_form_access(actor: User, kind: str) -> None:
    if kind not in known_kinds():
        raise DomainError("unknown_form", "این فرم تعریف نشده است.", 404)
    if actor.role == "executive_manager":
        return
    if kind == "in" and actor.role == "buyer":
        return
    if kind != "ivr":
        raise DomainError("forbidden", "دسترسی کامل و مدیریت همهٔ فرم‌ها فقط برای مدیر اجرایی است.", 403)


def blank_template(kind: str, actor: User) -> dict:
    _require_form_access(actor, kind)
    return template(kind)


def list_sheets(session: Session, actor: User, kind: str | None = None) -> list[dict]:
    if kind is not None:
        _require_form_access(actor, kind)
    query = select(FormSheet).order_by(FormSheet.id.desc())
    if kind:
        query = query.where(FormSheet.kind == kind)
    if actor.role != "executive_manager":
        allowed_kinds = ["ivr", "in"] if actor.role == "buyer" else ["ivr"]
        query = query.where(FormSheet.created_by == actor.id, FormSheet.kind.in_(allowed_kinds))
    rows = []
    for sheet in session.scalars(query).all():
        payload = json.loads(sheet.payload_json)
        rows.append(
            {
                "id": sheet.id,
                "kind": sheet.kind,
                "number": payload.get("number") or "پیش‌نویس",
                "updated_at": sheet.updated_at.isoformat(sep=" ", timespec="seconds"),
            }
        )
    return rows


def get_sheet(session: Session, actor: User, sheet_id: int) -> dict:
    sheet = session.get(FormSheet, sheet_id)
    if sheet is None:
        raise DomainError("not_found", "فرم پیدا نشد.", 404)
    if actor.role == "manager" and sheet.kind == "in":
        point = session.scalar(select(InspectionPoint).where(InspectionPoint.request_form_id == sheet.id))
        item = session.get(Equipment, point.equipment_id) if point else None
        order = session.get(PurchaseOrder, item.po_id) if item else None
        project = session.get(Project, order.project_id) if order else None
        if project is None or actor.company_id != project.buyer_company_id:
            raise DomainError("forbidden", "این فرم IN برای پروژهٔ شما نیست.", 403)
        body = template(sheet.kind)
        body["id"] = sheet.id
        body["payload"] = json.loads(sheet.payload_json)
        return body
    if actor.role == "unit_manager" and sheet.kind == "in":
        point = session.scalar(select(InspectionPoint).where(InspectionPoint.request_form_id == sheet.id))
        if point is None or point.unit_manager_id != actor.id:
            raise DomainError("forbidden", "این فرم IN برای واحد شما ارجاع نشده است.", 403)
        body = template(sheet.kind)
        body["id"] = sheet.id
        body["payload"] = json.loads(sheet.payload_json)
        return body
    _require_form_access(actor, sheet.kind)
    if actor.role != "executive_manager" and sheet.created_by != actor.id:
        raise DomainError("forbidden", "فقط مدیر اجرایی یا سازندهٔ فرم به آن دسترسی دارد.", 403)
    body = template(sheet.kind)
    body["id"] = sheet.id
    body["payload"] = json.loads(sheet.payload_json)
    return body


def save_sheet(session: Session, actor: User, kind: str, payload: dict, sheet_id: int | None) -> FormSheet:
    _require_form_access(actor, kind)
    clean = normalize(kind, payload)
    encoded = json.dumps(clean, ensure_ascii=False)
    now = utcnow()
    if sheet_id:
        sheet = session.get(FormSheet, sheet_id)
        if sheet is None or sheet.kind != kind:
            raise DomainError("not_found", "فرم پیدا نشد.", 404)
        if actor.role != "executive_manager" and sheet.created_by != actor.id:
            raise DomainError("forbidden", "فقط مدیر اجرایی یا سازندهٔ فرم می‌تواند آن را ویرایش کند.", 403)
        sheet.payload_json = encoded
        sheet.updated_at = now
    else:
        sheet = FormSheet(kind=kind, payload_json=encoded, created_by=actor.id, created_at=now, updated_at=now)
        session.add(sheet)
    session.flush()
    return sheet

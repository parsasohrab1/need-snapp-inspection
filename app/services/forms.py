import json
from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.blanks import known_kinds, normalize, template
from app.domain.errors import DomainError
from app.models import Equipment, FormSheet, InspectionPoint, Inspector, Project, PurchaseOrder, User, Visit, utcnow


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
    if actor.role in {"manager", "unit_manager", "inspector"} and sheet.kind == "in":
        point = session.scalar(select(InspectionPoint).where(InspectionPoint.request_form_id == sheet.id))
        if actor.role == "inspector":
            inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
            visit = session.scalar(
                select(Visit).where(
                    Visit.point_id == point.id if point else False,
                    Visit.inspector_id == inspector.id if inspector else False,
                    Visit.phase.in_(("assigned", "en_route", "on_site", "submitted", "client", "confirmed")),
                )
            ) if point and inspector else None
            if visit is None:
                raise DomainError("forbidden", "فرم IN فقط برای بازرس اعزام‌شده به این درخواست قابل مشاهده است.", 403)
            body = template(sheet.kind)
            body["id"] = sheet.id
            body["payload"] = json.loads(sheet.payload_json)
            return body
        if actor.role == "unit_manager":
            if point is None or point.unit_manager_id != actor.id:
                raise DomainError("forbidden", "این فرم IN برای واحد شما ارجاع نشده است.", 403)
            body = template(sheet.kind)
            body["id"] = sheet.id
            body["payload"] = json.loads(sheet.payload_json)
            return body
        item = session.get(Equipment, point.equipment_id) if point else None
        order = session.get(PurchaseOrder, item.po_id) if item else None
        project = session.get(Project, order.project_id) if order else None
        if actor.role == "manager" and (project is None or actor.company_id != project.buyer_company_id):
            raise DomainError("forbidden", "این فرم IN برای پروژهٔ شما نیست.", 403)
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


def visit_report_form(session: Session, actor: User, visit_id: int) -> dict:
    visit = session.get(Visit, visit_id)
    if visit is None:
        raise DomainError("not_found", "بازدید پیدا نشد.", 404)
    point = session.get(InspectionPoint, visit.point_id)
    if point is None or point.request_form_id is None:
        raise DomainError("not_found", "فرم IN پیوست‌شده به این بازدید پیدا نشد.", 404)
    sheet = session.get(FormSheet, point.request_form_id)
    if sheet is None or sheet.kind != "in":
        raise DomainError("not_found", "فرم IN پیوست‌شده به این بازدید پیدا نشد.", 404)

    has_report_form = bool(visit.report_form_json and visit.report_form_json != "{}")
    can_edit = False
    if actor.role == "inspector":
        inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
        if inspector is None or inspector.id != visit.inspector_id:
            raise DomainError("forbidden", "فقط بازرس اعزام‌شده به این درخواست می‌تواند فرم گزارش را مشاهده کند.", 403)
        can_edit = visit.phase in {"assigned", "en_route", "on_site"}
        if not can_edit and not has_report_form:
            raise DomainError("illegal_transition", "فرم گزارش فقط هنگام انجام یا اصلاح بازرسی در دسترس است.", 409)
    elif not has_report_form:
        raise DomainError("report_form_missing", "بازرس هنوز نسخهٔ تکمیل‌شدهٔ فرم IN را ثبت نکرده است.", 409)

    body = template("in")
    body["sections"] = deepcopy(body["sections"])
    body["id"] = sheet.id
    body["original_payload"] = json.loads(sheet.payload_json)
    body["payload"] = json.loads(visit.report_form_json) if has_report_form else json.loads(sheet.payload_json)
    if not has_report_form:
        today = utcnow().date().isoformat()
        user = session.get(User, actor.id)
        body["payload"]["inspection_date"] = body["payload"].get("inspection_date") or today
        body["payload"]["inspector"] = body["payload"].get("inspector") or (user.name if user else "")
        body["payload"]["sign_inspector"] = body["payload"].get("sign_inspector") or (user.name if user else "")
        body["payload"]["sign_date"] = body["payload"].get("sign_date") or today
    for section in body["sections"]:
        for field in section["fields"]:
            if field["key"] in {"duration", "observation"}:
                field["required"] = True
    body["note"] = "نسخهٔ مخصوص گزارش این بازدید است؛ فرم خام کارفرما تغییر نمی‌کند. مدت بازرسی و شرح مشاهده الزامی است."
    body["can_edit"] = can_edit
    body["completed"] = has_report_form
    return body


def save_visit_report_form(session: Session, actor: User, visit_id: int, payload: dict) -> None:
    visit = session.get(Visit, visit_id)
    if visit is None:
        raise DomainError("not_found", "بازدید پیدا نشد.", 404)
    point = session.get(InspectionPoint, visit.point_id)
    inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id)) if actor.role == "inspector" else None
    if inspector is None or inspector.id != visit.inspector_id:
        raise DomainError("forbidden", "فقط بازرس اعزام‌شده می‌تواند فرم گزارش را ویرایش کند.", 403)
    if point is None or point.request_form_id is None:
        raise DomainError("not_found", "فرم IN پیوست‌شده به این بازدید پیدا نشد.", 404)
    if visit.phase not in {"assigned", "en_route", "on_site"}:
        raise DomainError("illegal_transition", "فرم گزارش در این مرحله قابل ویرایش نیست.", 409)

    clean = normalize("in", payload)
    for key, label in (("duration", "مدت بازرسی"), ("observation", "شرح مشاهده")):
        if not clean[key]:
            raise DomainError("required_field", f"تکمیل فیلد «{label}» الزامی است.", 400)
    visit.report_form_json = json.dumps(clean, ensure_ascii=False)

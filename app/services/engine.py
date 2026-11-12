"""حلقه عملیاتی اعزام: مدارک، پیشنهاد، حضور در کارگاه، IVR و عدم انطباق."""

import json
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.billing import compute_bill, fiscal_year
from app.domain.catalog import DOC_LABELS
from app.domain.commercial import quote
from app.domain.errors import DomainError
from app.domain.geo import haversine_km
from app.domain.matching import GEOFENCE_KM, OFFER_TOP_N, InspectorView, rank_inspectors, within_geofence
from app.domain.states import ACTIVE_VISIT, move_point
from app.models import (
    AuditEvent,
    Bill,
    ChecklistAnswer,
    Company,
    Document,
    Equipment,
    Evidence,
    InspectionPoint,
    InspectionRequestApproval,
    InspectionRequestComment,
    Inspector,
    Ledger,
    Notification,
    Offer,
    Project,
    PurchaseOrder,
    ReportComment,
    User,
    Visit,
    utcnow,
)

OFFER_TTL_SECONDS = 30 * 60
VENDOR_ROLES = {"vendor", "coordinator", "admin"}
PM_ROLES = {"manager", "coordinator", "admin"}
DISPATCH_ROLES = {"coordinator", "unit_manager", "admin"}


def audit(session: Session, entity: str, entity_id: int, action: str, actor: User | None, detail: str = "") -> None:
    session.add(
        AuditEvent(
            entity=entity,
            entity_id=entity_id,
            action=action,
            actor_id=None if actor is None else actor.id,
            detail=detail,
        )
    )


def notify(session: Session, user_id: int, title: str, body: str) -> None:
    session.add(Notification(user_id=user_id, title=title, body=body))


def _point(session: Session, point_id: int) -> InspectionPoint:
    point = session.get(InspectionPoint, point_id)
    if point is None:
        raise DomainError("not_found", "نقطه بازرسی پیدا نشد.", 404)
    return point


def _visit(session: Session, visit_id: int) -> Visit:
    visit = session.get(Visit, visit_id)
    if visit is None:
        raise DomainError("not_found", "بازدید پیدا نشد.", 404)
    return visit


def _equipment(session: Session, equipment_id: int) -> Equipment:
    item = session.get(Equipment, equipment_id)
    if item is None:
        raise DomainError("not_found", "تجهیز پیدا نشد.", 404)
    return item


def _order(session: Session, po_id: int) -> PurchaseOrder:
    order = session.get(PurchaseOrder, po_id)
    if order is None:
        raise DomainError("not_found", "سفارش خرید پیدا نشد.", 404)
    return order


def _require(actor: User, roles: set[str]) -> None:
    if actor.role not in roles:
        raise DomainError("forbidden", "این نقش مجاز به این کار نیست.", 403)


def vendor_owns(session: Session, actor: User, point: InspectionPoint) -> None:
    if actor.role in {"coordinator", "admin"}:
        return
    if actor.role != "vendor":
        raise DomainError("forbidden", "فقط سازنده یا هماهنگ‌کننده آمادگی را اعلام می‌کند.", 403)
    order = _order(session, _equipment(session, point.equipment_id).po_id)
    if actor.company_id != order.vendor_company_id:
        raise DomainError("forbidden", "این سفارش برای شرکت شما نیست.", 403)


def buyer_sees(session: Session, actor: User, point: InspectionPoint) -> None:
    if actor.role in {"coordinator", "admin"}:
        return
    order = _order(session, _equipment(session, point.equipment_id).po_id)
    from app.models import Project

    project = session.get(Project, order.project_id)
    if actor.role in {"buyer", "manager"} and project and actor.company_id == project.buyer_company_id:
        return
    if actor.role == "vendor" and actor.company_id == order.vendor_company_id:
        return
    raise DomainError("forbidden", "دسترسی به این سفارش ندارید.", 403)


def missing_docs(session: Session, point: InspectionPoint) -> list[str]:
    present = set(
        session.scalars(select(Document.doc_type).where(Document.equipment_id == point.equipment_id)).all()
    )
    return [doc for doc in point.required_docs if doc not in present]


def active_job_count(session: Session, inspector_id: int) -> int:
    return int(
        session.scalar(
            select(func.count(Visit.id)).where(
                Visit.inspector_id == inspector_id,
                Visit.phase.in_(tuple(ACTIVE_VISIT)),
            )
        )
        or 0
    )


def declined_inspector_ids(session: Session, point_id: int) -> set[int]:
    """بازرس‌هایی که این نقطه را رد کرده‌اند یا مهلتشان گذشته؛ دوباره نوبت نمی‌گیرند."""
    rows = session.scalars(
        select(Offer.inspector_id).where(
            Offer.point_id == point_id,
            Offer.status.in_(("declined", "expired")),
        )
    ).all()
    return set(rows)


def add_document(
    session: Session,
    *,
    equipment_id: int,
    doc_type: str,
    title: str,
    filename: str,
    actor: User,
) -> Document:
    _require(actor, VENDOR_ROLES | {"buyer"})
    item = _equipment(session, equipment_id)
    order = _order(session, item.po_id)
    if actor.role == "vendor" and actor.company_id != order.vendor_company_id:
        raise DomainError("forbidden", "مدارک این سفارش را شرکت دیگری بارگذاری می‌کند.", 403)
    row = Document(
        equipment_id=equipment_id,
        doc_type=doc_type,
        title=title,
        filename=filename,
        uploaded_by=actor.id,
    )
    session.add(row)
    session.flush()
    audit(session, "document", row.id, "upload", actor, doc_type)
    return row


def mark_ready(
    session: Session,
    point_id: int,
    actor: User,
    *,
    remote_requested: bool = False,
    window_note: str = "",
) -> InspectionPoint:
    point = _point(session, point_id)
    vendor_owns(session, actor, point)
    if point.status not in {"planned", "ready"}:
        move_point(point.status, "ready")
    missing = missing_docs(session, point)
    if missing:
        raise DomainError("docs_missing", "مدارک لازم هنوز بارگذاری نشده: " + "، ".join(missing), 409)
    if remote_requested and not point.remote_allowed:
        raise DomainError("remote_forbidden", "این نقطه باید حضوری بازرسی شود.", 409)
    if point.status == "planned":
        point.status = move_point("planned", "ready")
    point.remote_requested = remote_requested
    point.window_note = window_note
    audit(session, "point", point.id, "ready", actor, window_note)
    return point


def _project_contacts(session: Session, point: InspectionPoint) -> tuple[Project, PurchaseOrder]:
    equipment = _equipment(session, point.equipment_id)
    order = _order(session, equipment.po_id)
    project = session.get(Project, order.project_id)
    if project is None:
        raise DomainError("not_found", "پروژهٔ سفارش پیدا نشد.", 404)
    return project, order


def _notify_role(session: Session, role: str, title: str, body: str, *, company_id: int | None = None) -> None:
    query = select(User).where(User.role == role)
    if company_id is not None:
        query = query.where(User.company_id == company_id)
    for user in session.scalars(query).all():
        notify(session, user.id, title, body)


def request_inspection(
    session: Session,
    point_id: int,
    actor: User,
    *,
    remote_requested: bool = False,
    note: str = "",
    form_sheet_id: int | None = None,
) -> InspectionPoint:
    _require(actor, {"buyer"})
    point = _point(session, point_id)
    buyer_sees(session, actor, point)
    if remote_requested and not point.remote_allowed:
        raise DomainError("remote_forbidden", "این نقطه باید حضوری بازرسی شود.", 409)
    if point.request_status not in {"draft", "documents_missing", "returned"}:
        raise DomainError("request_in_progress", "این درخواست در حال بررسی است یا قبلاً تأیید شده است.", 409)
    if form_sheet_id is None:
        raise DomainError("request_form_required", "ثبت فرم IN برای ارسال درخواست بازرسی الزامی است.", 400)
    from app.models import FormSheet

    request_form = session.get(FormSheet, form_sheet_id)
    if request_form is None or request_form.kind != "in" or request_form.created_by != actor.id:
        raise DomainError("request_form_required", "فرم IN این درخواست پیدا نشد یا متعلق به کارفرما نیست.", 400)

    project, order = _project_contacts(session, point)
    equipment = _equipment(session, point.equipment_id)
    point.request_form_id = request_form.id
    missing = missing_docs(session, point)
    if missing:
        labels = [DOC_LABELS.get(kind, kind) for kind in missing]
        message = f"{equipment.tag} — {point.title}: مدارک پیوست نشده: {'، '.join(labels)}"
        point.request_status = "documents_missing"
        point.request_note = message
        notify(session, actor.id, "مدرک بازرسی ناقص است", message)
        _notify_role(session, "manager", "مدرک بازرسی ناقص است", message, company_id=project.buyer_company_id)
        _notify_role(session, "vendor", "مدرک لازم برای درخواست بازرسی", message, company_id=order.vendor_company_id)
        audit(session, "point", point.id, "request_documents_missing", actor, message)
        return point

    point.request_status = "manager_review"
    point.request_note = note.strip()
    point.remote_requested = remote_requested
    equipment_label = f"{equipment.tag} — {point.title}"
    _notify_role(session, "manager", "درخواست بازرسی کارفرما", equipment_label, company_id=project.buyer_company_id)
    audit(session, "point", point.id, "buyer_request", actor, note.strip())
    return point


def approve_inspection_as_manager(
    session: Session,
    point_id: int,
    actor: User,
    unit_manager_id: int,
    department: str,
    signature_stored_name: str,
    signature_filename: str,
    note: str = "",
) -> InspectionPoint:
    _require(actor, {"manager", "admin"})
    point = _point(session, point_id)
    project, _order_row = _project_contacts(session, point)
    if actor.role == "manager" and actor.company_id != project.buyer_company_id:
        raise DomainError("forbidden", "این درخواست برای پروژهٔ شما نیست.", 403)
    if point.request_status != "manager_review":
        raise DomainError("illegal_transition", "درخواست در مرحلهٔ بررسی مدیر پروژه نیست.", 409)
    if not signature_stored_name or not signature_filename:
        raise DomainError("signature_required", "تصویر مهر و امضای مدیر پروژه الزامی است.", 400)
    unit_manager = session.get(User, unit_manager_id)
    if unit_manager is None or unit_manager.role != "unit_manager":
        raise DomainError("bad_unit_manager", "مدیر واحد انتخاب‌شده معتبر نیست.", 400)
    if not department.strip() or len(department.strip()) > 80:
        raise DomainError("bad_department", "واحد بازرسی را مشخص کنید.", 400)
    equipment = _equipment(session, point.equipment_id)
    if not missing_docs(session, point):
        point.unit_manager_id = unit_manager.id
        point.request_department = department.strip()
        point.request_status = "unit_review"
        point.request_note = note.strip()
        session.add(
            InspectionRequestApproval(
                point_id=point.id,
                actor_id=actor.id,
                stage="manager",
                signature_filename=signature_filename,
                signature_stored_name=signature_stored_name,
            )
        )
        notify(
            session,
            unit_manager.id,
            "درخواست بازرسی نیازمند تأیید مدیر واحد",
            f"{equipment.tag} — {point.title} — واحد {point.request_department}",
        )
        audit(session, "point", point.id, "manager_approved_for_unit", actor, note.strip())
    else:
        missing = [DOC_LABELS.get(kind, kind) for kind in missing_docs(session, point)]
        point.request_status = "documents_missing"
        point.request_note = "مدارک پیوست نشده: " + "، ".join(missing)
        _notify_role(
            session,
            "vendor",
            "درخواست بازرسی برگشت؛ مدرک ناقص",
            f"{equipment.tag} — {point.request_note}",
            company_id=_order(session, equipment.po_id).vendor_company_id,
        )
        _notify_role(session, "buyer", "مدرک بازرسی ناقص است", point.request_note, company_id=project.buyer_company_id)
        audit(session, "point", point.id, "manager_returned_missing_docs", actor, point.request_note)
    return point


def approve_inspection_as_unit_manager(
    session: Session,
    point_id: int,
    actor: User,
    signature_stored_name: str,
    signature_filename: str,
    note: str = "",
) -> tuple[InspectionPoint, list[Offer]]:
    _require(actor, {"unit_manager", "admin"})
    point = _point(session, point_id)
    if actor.role == "unit_manager" and point.unit_manager_id != actor.id:
        raise DomainError("forbidden", "این درخواست به واحد شما ارجاع نشده است.", 403)
    if point.request_status != "unit_review":
        raise DomainError("illegal_transition", "درخواست در مرحلهٔ بررسی مدیر واحد نیست.", 409)
    if not signature_stored_name or not signature_filename:
        raise DomainError("signature_required", "تصویر مهر و امضای مدیر واحد الزامی است.", 400)
    equipment = _equipment(session, point.equipment_id)
    missing = missing_docs(session, point)
    if missing:
        labels = [DOC_LABELS.get(kind, kind) for kind in missing]
        message = f"{equipment.tag} — مدارک بازرسی ناقص است: {'، '.join(labels)}"
        point.request_status = "documents_missing"
        point.request_note = message
        project, order = _project_contacts(session, point)
        _notify_role(session, "buyer", "مدرک بازرسی ناقص است", message, company_id=project.buyer_company_id)
        _notify_role(session, "manager", "مدرک بازرسی ناقص است", message, company_id=project.buyer_company_id)
        _notify_role(session, "vendor", "درخواست بازرسی برگشت؛ مدرک ناقص", message, company_id=order.vendor_company_id)
        audit(session, "point", point.id, "unit_manager_returned_missing_docs", actor, message)
        return point, []

    point.request_status = "inspection_queue"
    point.request_note = note.strip()
    session.add(
        InspectionRequestApproval(
            point_id=point.id,
            actor_id=actor.id,
            stage="unit_manager",
            signature_filename=signature_filename,
            signature_stored_name=signature_stored_name,
        )
    )
    if point.status == "planned":
        point.status = move_point("planned", "ready")
    elif point.status not in {"ready", "offering"}:
        raise DomainError("illegal_transition", "نقطهٔ بازرسی در وضعیت قابل اعزام نیست.", 409)
    audit(session, "point", point.id, "unit_manager_approved", actor, note.strip())
    try:
        offers = broadcast(session, point.id, actor)
    except DomainError as exc:
        if exc.code != "no_inspector":
            raise
        point.request_status = "approved_no_inspector"
        point.request_note = f"{equipment.tag} — {point.title}: بازرس واجد شرایط آنلاین نیست."
        project, _order = _project_contacts(session, point)
        _notify_role(session, "manager", "درخواست تأیید شد؛ بازرس آنلاین نیست", point.request_note, company_id=project.buyer_company_id)
        _notify_role(session, "executive_manager", "درخواست تأیید شد؛ بازرس آنلاین نیست", point.request_note)
        notify(session, actor.id, "درخواست تأیید شد؛ بازرس آنلاین نیست", point.request_note)
        return point, []
    project, _order = _project_contacts(session, point)
    dispatch_message = f"{equipment.tag} — {point.title} — پیشنهاد بازرسی برای {len(offers)} بازرس ارسال شد."
    _notify_role(session, "manager", "درخواست IN وارد مرحله اعزام شد", dispatch_message, company_id=project.buyer_company_id)
    _notify_role(session, "executive_manager", "درخواست IN وارد مرحله اعزام شد", dispatch_message)
    notify(session, actor.id, "درخواست IN وارد مرحله اعزام شد", dispatch_message)
    return point, offers


def return_inspection_request(session: Session, point_id: int, actor: User, reason: str) -> InspectionPoint:
    point = _point(session, point_id)
    text = reason.strip()
    if len(text) < 3 or len(text) > 2000:
        raise DomainError("return_reason_required", "دلیل مرجوعی باید بین ۳ تا ۲۰۰۰ نویسه باشد.", 400)
    project, _order = _project_contacts(session, point)
    unit_manager = session.get(User, point.unit_manager_id) if point.unit_manager_id else None
    if point.request_status == "manager_review":
        _require(actor, {"manager", "admin"})
        if actor.role == "manager" and actor.company_id != project.buyer_company_id:
            raise DomainError("forbidden", "این درخواست برای پروژهٔ شما نیست.", 403)
        point.request_status = "returned"
        recipients = list(session.scalars(select(User).where(User.role == "buyer", User.company_id == project.buyer_company_id)).all())
        audit_action = "request_returned_to_buyer"
    elif point.request_status == "unit_review":
        _require(actor, {"unit_manager", "admin"})
        if actor.role == "unit_manager" and point.unit_manager_id != actor.id:
            raise DomainError("forbidden", "این درخواست به واحد شما ارجاع نشده است.", 403)
        point.request_status = "manager_review"
        recipients = list(session.scalars(select(User).where(User.role == "manager", User.company_id == project.buyer_company_id)).all())
        audit_action = "request_returned_to_project_manager"
    elif point.request_status in {"inspection_queue", "approved_no_inspector"}:
        _require(actor, {"coordinator", "admin"})
        if point.request_status == "inspection_queue":
            active_visit = session.scalar(
                select(Visit.id).where(
                    Visit.point_id == point.id,
                    Visit.phase.in_(("assigned", "en_route", "on_site", "submitted", "client", "confirmed")),
                )
            )
            if active_visit:
                raise DomainError("request_locked", "درخواست به بازرس تخصیص یافته یا گزارش آن در جریان است و فعلاً قابل مرجوع کردن نیست.", 409)
            pending_offers = session.scalars(
                select(Offer).where(Offer.point_id == point.id, Offer.status == "pending")
            ).all()
            for offer in pending_offers:
                offer.status = "lost"
                offer.decided_at = utcnow()
                inspector = session.get(Inspector, offer.inspector_id)
                if inspector:
                    notify(session, inspector.user_id, "پیشنهاد بازرسی لغو شد", f"{point.title} — درخواست به مدیر واحد برگشت.")
            if point.status == "offering":
                point.status = move_point("offering", "ready")
        point.request_status = "unit_review"
        recipients = [unit_manager] if unit_manager else []
        audit_action = "request_returned_to_unit_manager"
    elif point.request_status == "executive_review":
        _require(actor, {"executive_manager", "admin"})
        point.request_status = "manager_review"
        recipients = list(session.scalars(select(User).where(User.role == "manager", User.company_id == project.buyer_company_id)).all())
        audit_action = "request_returned_to_project_manager"
    else:
        raise DomainError("illegal_transition", "درخواست در وضعیت قابل مرجوع کردن نیست.", 409)
    point.request_note = text
    session.add(InspectionRequestComment(point_id=point.id, user_id=actor.id, body=text))
    for recipient in recipients:
        if recipient:
            notify(session, recipient.id, "درخواست بازرسی مرجوع شد", f"{point.title} — {text}")
    audit(session, "point", point.id, audit_action, actor, text)
    return point


def add_inspection_request_comment(session: Session, point_id: int, actor: User, body: str) -> InspectionRequestComment:
    point = _point(session, point_id)
    project, order = _project_contacts(session, point)
    inspector = session.get(User, point.unit_manager_id) if point.unit_manager_id else None
    allowed = (
        actor.role in {"admin", "coordinator", "executive_manager"}
        or actor.role == "unit_manager" and point.unit_manager_id == actor.id
        or actor.role in {"buyer", "manager"} and actor.company_id == project.buyer_company_id
        or actor.role == "vendor" and actor.company_id == order.vendor_company_id
    )
    if not allowed:
        raise DomainError("forbidden", "دسترسی به گفت‌وگوی این درخواست ندارید.", 403)
    text = body.strip()
    if len(text) < 2 or len(text) > 4000:
        raise DomainError("bad_comment", "نظر باید بین ۲ تا ۴۰۰۰ نویسه باشد.", 400)
    comment = InspectionRequestComment(point_id=point.id, user_id=actor.id, body=text)
    session.add(comment)
    session.flush()
    recipients = set(
        session.scalars(
            select(User.id).where(
                User.role == "manager",
                User.company_id == project.buyer_company_id,
            )
        ).all()
    )
    recipients.update(
        session.scalars(
            select(User.id).where(
                User.role == "buyer",
                User.company_id == project.buyer_company_id,
            )
        ).all()
    )
    recipients.update(session.scalars(select(User.id).where(User.role == "coordinator")).all())
    if point.unit_manager_id:
        recipients.add(point.unit_manager_id)
    for user_id in recipients - {actor.id}:
        notify(session, user_id, "نظر تازه روی درخواست بازرسی", f"{point.title} — {actor.name}: {text}")
    audit(session, "point", point.id, "request_comment", actor, text)
    return comment


def approve_inspection_as_executive(
    session: Session,
    point_id: int,
    actor: User,
    note: str = "",
) -> tuple[InspectionPoint, list[Offer]]:
    _require(actor, {"executive_manager", "admin"})
    point = _point(session, point_id)
    if point.request_status != "executive_review":
        raise DomainError("illegal_transition", "درخواست در مرحلهٔ بررسی مدیر اجرایی نیست.", 409)
    equipment = _equipment(session, point.equipment_id)
    missing = missing_docs(session, point)
    if missing:
        labels = [DOC_LABELS.get(kind, kind) for kind in missing]
        message = f"{equipment.tag} — مدارک پیوست نشده: {'، '.join(labels)}"
        point.request_status = "documents_missing"
        point.request_note = message
        project, order = _project_contacts(session, point)
        _notify_role(session, "vendor", "درخواست بازرسی برگشت؛ مدرک ناقص", message, company_id=order.vendor_company_id)
        _notify_role(session, "buyer", "مدرک بازرسی ناقص است", message, company_id=project.buyer_company_id)
        audit(session, "point", point.id, "executive_returned_missing_docs", actor, message)
        return point, []

    point.request_status = "approved"
    point.request_note = note.strip()
    if point.status == "planned":
        point.status = move_point("planned", "ready")
    elif point.status not in {"ready", "offering"}:
        raise DomainError("illegal_transition", "نقطهٔ بازرسی در وضعیت قابل اعزام نیست.", 409)
    audit(session, "point", point.id, "executive_approved", actor, note.strip())
    try:
        offers = broadcast(session, point.id, actor)
    except DomainError as exc:
        if exc.code != "no_inspector":
            raise
        project, _order_row = _project_contacts(session, point)
        message = f"{equipment.tag} — {point.title}: بازرس واجد شرایط آنلاین نیست."
        point.request_status = "approved_no_inspector"
        point.request_note = message
        _notify_role(session, "coordinator", "تأیید شد؛ بازرس آنلاین نیست", message)
        _notify_role(session, "manager", "تأیید شد؛ بازرس آنلاین نیست", message, company_id=project.buyer_company_id)
        return point, []
    return point, offers


def add_report_comment(session: Session, visit_id: int, actor: User, body: str) -> ReportComment:
    visit = _visit(session, visit_id)
    point = _point(session, visit.point_id)
    inspector = session.scalar(select(Inspector).where(Inspector.id == visit.inspector_id))
    project, order = _project_contacts(session, point)
    allowed = (
        actor.role in {"admin", "coordinator", "executive_manager"}
        or (actor.role == "manager" and actor.company_id == project.buyer_company_id)
        or (actor.role == "buyer" and actor.company_id == project.buyer_company_id)
        or (actor.role == "vendor" and actor.company_id == order.vendor_company_id)
        or (actor.role == "inspector" and inspector is not None and inspector.user_id == actor.id)
    )
    if not allowed:
        raise DomainError("forbidden", "به تبادل نظر این گزارش دسترسی ندارید.", 403)
    text = body.strip()
    if len(text) < 2 or len(text) > 4000:
        raise DomainError("bad_comment", "نظر باید بین ۲ تا ۴۰۰۰ نویسه باشد.", 400)
    comment = ReportComment(visit_id=visit.id, user_id=actor.id, body=text)
    session.add(comment)
    session.flush()
    participants = {actor.id}
    if inspector:
        participants.add(inspector.user_id)
    if project.buyer_company_id:
        participants.update(
            session.scalars(select(User.id).where(User.company_id == project.buyer_company_id, User.role.in_(("buyer", "manager")))).all()
        )
    participants.update(
        session.scalars(select(User.id).where(User.company_id == order.vendor_company_id, User.role == "vendor")).all()
    )
    if point.unit_manager_id:
        participants.add(point.unit_manager_id)
    equipment = _equipment(session, point.equipment_id)
    for user_id in participants - {actor.id}:
        notify(session, user_id, "نظر تازه روی گزارش بازرسی", f"{equipment.tag} — {visit.ivr_no or point.title}: {actor.name} نظر ثبت کرد.")
    audit(session, "visit", visit.id, "comment", actor, text)
    return comment


def _inspector_views(session: Session) -> list[InspectorView]:
    rows = session.scalars(select(Inspector)).all()
    return [
        InspectorView(
            id=row.id,
            disciplines=tuple(row.disciplines),
            lat=row.lat,
            lng=row.lng,
            radius_km=row.radius_km,
            online=row.online,
            rating=row.rating,
            active_jobs=active_job_count(session, row.id),
            max_parallel=row.max_parallel,
            engagement=row.engagement or "fixed",
        )
        for row in rows
    ]


def broadcast(
    session: Session,
    point_id: int,
    actor: User | None,
    *,
    now: datetime | None = None,
    ttl_seconds: int = OFFER_TTL_SECONDS,
) -> list[Offer]:
    if actor is not None:
        _require(actor, DISPATCH_ROLES)
    point = _point(session, point_id)
    if point.status == "ready":
        point.status = move_point("ready", "offering")
    elif point.status != "offering":
        move_point(point.status, "offering")
    now = now or utcnow()
    equipment = _equipment(session, point.equipment_id)
    remote = bool(point.remote_requested and point.remote_allowed)
    ranked = rank_inspectors(
        _inspector_views(session),
        discipline=point.discipline,
        lat=equipment.lat,
        lng=equipment.lng,
        remote=remote,
        declined_ids=declined_inspector_ids(session, point.id),
    )
    pending = session.scalars(
        select(Offer.inspector_id).where(Offer.point_id == point.id, Offer.status == "pending")
    ).all()
    chosen = [item for item in ranked if item.inspector_id not in set(pending)][:OFFER_TOP_N]
    if not chosen and not pending:
        point.status = "ready"
        raise DomainError("no_inspector", "بازرس واجد شرایط در شعاع و تخصص این نقطه آنلاین نیست.", 409)
    fee, commission, net = quote(point.point_type, point.discipline, remote)
    created: list[Offer] = []
    for item in chosen:
        offer = Offer(
            point_id=point.id,
            inspector_id=item.inspector_id,
            status="pending",
            score=item.score,
            distance_km=item.distance_km,
            fee_irr=fee,
            commission_irr=commission,
            net_irr=net,
            travel_irr=round(item.distance_km * 12_000),
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        session.add(offer)
        created.append(offer)
        inspector = session.get(Inspector, item.inspector_id)
        if inspector:
            notify(
                session,
                inspector.user_id,
                "درخواست بازرسی",
                f"{equipment.tag} — {point.title} — {item.distance_km} کیلومتر",
            )
    point.attempt += len(created)
    session.flush()
    audit(session, "point", point.id, "broadcast", actor, f"{len(created)} offer")
    return created


def _close_other_offers(session: Session, point_id: int, keep_id: int, now: datetime) -> None:
    others = session.scalars(
        select(Offer).where(Offer.point_id == point_id, Offer.status == "pending", Offer.id != keep_id)
    ).all()
    for offer in others:
        offer.status = "lost"
        offer.decided_at = now


def accept_offer(session: Session, offer_id: int, actor: User, *, now: datetime | None = None) -> Visit:
    offer = session.get(Offer, offer_id)
    if offer is None:
        raise DomainError("not_found", "پیشنهاد پیدا نشد.", 404)
    inspector = session.get(Inspector, offer.inspector_id)
    if inspector is None or inspector.user_id != actor.id:
        raise DomainError("forbidden", "این پیشنهاد برای بازرس دیگری است.", 403)
    now = now or utcnow()
    if offer.status != "pending":
        raise DomainError("offer_closed", "این پیشنهاد دیگر باز نیست.", 409)
    if offer.expires_at < now:
        offer.status = "expired"
        offer.decided_at = now
        raise DomainError("offer_expired", "مهلت پذیرش تمام شده است.", 409)
    point = _point(session, offer.point_id)
    open_visit = session.scalar(
        select(Visit.id).where(
            Visit.point_id == point.id,
            Visit.phase.in_(("assigned", "en_route", "on_site", "submitted")),
        )
    )
    if open_visit:
        offer.status = "lost"
        offer.decided_at = now
        raise DomainError("offer_taken", "بازرس دیگری این بازدید را پذیرفته است.", 409)
    offer.status = "accepted"
    offer.decided_at = now
    _close_other_offers(session, point.id, offer.id, now)
    if point.status == "offering":
        point.status = move_point("offering", "assigned")
    elif point.status != "assigned":
        move_point(point.status, "assigned")
    visit = Visit(
        point_id=point.id,
        inspector_id=inspector.id,
        offer_id=offer.id,
        phase="assigned",
        remote=bool(point.remote_requested and point.remote_allowed),
        created_at=now,
    )
    session.add(visit)
    session.flush()
    audit(session, "visit", visit.id, "accept", actor, "")
    equipment = _equipment(session, point.equipment_id)
    project, _order = _project_contacts(session, point)
    inspector_user = session.get(User, actor.id)
    dispatch_message = f"{equipment.tag} — {point.title} — {inspector_user.name if inspector_user else 'بازرس'} پیشنهاد را پذیرفت."
    _notify_role(session, "manager", "بازرس برای درخواست IN انتخاب شد", dispatch_message, company_id=project.buyer_company_id)
    _notify_role(session, "executive_manager", "بازرس برای درخواست IN انتخاب شد", dispatch_message)
    unit_manager = session.get(User, point.unit_manager_id) if point.unit_manager_id else None
    if unit_manager:
        notify(session, unit_manager.id, "بازرس برای درخواست IN انتخاب شد", dispatch_message)
    return visit


def decline_offer(session: Session, offer_id: int, actor: User, *, now: datetime | None = None) -> Offer:
    offer = session.get(Offer, offer_id)
    if offer is None:
        raise DomainError("not_found", "پیشنهاد پیدا نشد.", 404)
    inspector = session.get(Inspector, offer.inspector_id)
    if inspector is None or inspector.user_id != actor.id:
        raise DomainError("forbidden", "این پیشنهاد برای شما نیست.", 403)
    if offer.status != "pending":
        raise DomainError("offer_closed", "این پیشنهاد دیگر باز نیست.", 409)
    now = now or utcnow()
    offer.status = "declined"
    offer.decided_at = now
    audit(session, "offer", offer.id, "decline", actor, "")
    _offer_next(session, offer.point_id, now)
    return offer


def _reopen_if_no_pending(session: Session, point_id: int) -> None:
    session.flush()
    point = _point(session, point_id)
    if point.status != "offering":
        return
    pending = session.scalar(
        select(func.count(Offer.id)).where(Offer.point_id == point_id, Offer.status == "pending")
    )
    open_visit = session.scalar(
        select(func.count(Visit.id)).where(
            Visit.point_id == point_id,
            Visit.phase.in_(("assigned", "en_route", "on_site", "submitted")),
        )
    )
    if not pending and not open_visit:
        point.status = move_point("offering", "ready")
        session.flush()


def expire_offers(session: Session, *, now: datetime | None = None) -> int:
    now = now or utcnow()
    due = session.scalars(select(Offer).where(Offer.status == "pending", Offer.expires_at < now)).all()
    points: set[int] = set()
    for offer in due:
        offer.status = "expired"
        offer.decided_at = now
        points.add(offer.point_id)
    for point_id in points:
        _offer_next(session, point_id, now)
    return len(due)


def _offer_next(session: Session, point_id: int, now: datetime) -> None:
    """اگر پیشنهاد بازی نمانده، همان درخواست به بازرس بعدی صف می‌رود."""
    session.flush()
    point = _point(session, point_id)
    if point.status != "offering":
        return
    pending = session.scalar(
        select(func.count(Offer.id)).where(Offer.point_id == point_id, Offer.status == "pending")
    )
    if pending:
        return
    open_visit = session.scalar(
        select(func.count(Visit.id)).where(
            Visit.point_id == point_id,
            Visit.phase.in_(("assigned", "en_route", "on_site", "submitted")),
        )
    )
    if open_visit:
        return
    try:
        broadcast(session, point_id, None, now=now)
    except DomainError as exc:
        if exc.code != "no_inspector":
            raise


def force_assign(session: Session, point_id: int, inspector_id: int, actor: User, reason: str) -> Visit:
    _require(actor, DISPATCH_ROLES)
    if not reason.strip():
        raise DomainError("reason_required", "ارجاع دستی دلیل می‌خواهد.", 400)
    point = _point(session, point_id)
    if point.status != "ready":
        if point.status == "planned":
            mark_ready(session, point_id, actor)
        else:
            raise DomainError("not_ready", "فقط نقطه آماده را می‌توان دستی ارجاع داد.", 409)
    inspector = session.get(Inspector, inspector_id)
    if inspector is None:
        raise DomainError("not_found", "بازرس پیدا نشد.", 404)
    if point.discipline not in inspector.disciplines:
        raise DomainError("discipline", "تخصص بازرس با این نقطه یکی نیست.", 409)
    equipment = _equipment(session, point.equipment_id)
    remote = bool(point.remote_requested and point.remote_allowed)
    distance = haversine_km(inspector.lat, inspector.lng, equipment.lat, equipment.lng)
    if not remote and distance > inspector.radius_km:
        raise DomainError("out_of_radius", "بازرس خارج از شعاع کارگاه است. اعزام خودکار او را انتخاب نمی‌کند.", 409)
    now = utcnow()
    fee, commission, net = quote(point.point_type, point.discipline, remote)
    offer = Offer(
        point_id=point.id,
        inspector_id=inspector.id,
        status="accepted",
        score=1,
        distance_km=round(distance, 2),
        fee_irr=fee,
        commission_irr=commission,
        net_irr=net,
        created_at=now,
        expires_at=now,
        decided_at=now,
    )
    session.add(offer)
    session.flush()
    point.status = move_point(point.status if point.status == "ready" else "ready", "assigned")
    visit = Visit(
        point_id=point.id,
        inspector_id=inspector.id,
        offer_id=offer.id,
        phase="assigned",
        remote=remote,
        created_at=now,
    )
    session.add(visit)
    session.flush()
    notify(session, inspector.user_id, "ارجاع مستقیم", f"{equipment.tag} — {point.title}")
    audit(session, "visit", visit.id, "force_assign", actor, reason)
    return visit


def _own_visit(session: Session, visit: Visit, actor: User) -> Inspector:
    inspector = session.get(Inspector, visit.inspector_id)
    if inspector is None or inspector.user_id != actor.id:
        raise DomainError("forbidden", "این بازدید برای بازرس دیگری است.", 403)
    return inspector


def mark_en_route(session: Session, visit_id: int, actor: User) -> Visit:
    visit = _visit(session, visit_id)
    _own_visit(session, visit, actor)
    point = _point(session, visit.point_id)
    if visit.phase != "assigned" or point.status != "assigned":
        raise DomainError("illegal_transition", "حرکت فقط بعد از پذیرش ثبت می‌شود.", 409)
    point.status = move_point("assigned", "en_route")
    visit.phase = "en_route"
    audit(session, "visit", visit.id, "en_route", actor, "")
    return visit


def mark_arrived(session: Session, visit_id: int, actor: User, lat: float, lng: float) -> Visit:
    visit = _visit(session, visit_id)
    _own_visit(session, visit, actor)
    point = _point(session, visit.point_id)
    if visit.remote:
        raise DomainError("remote_visit", "بازبینی از راه دور ورود کارگاهی ندارد.", 409)
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise DomainError("invalid_location", "مختصات جغرافیایی معتبر نیست.", 400)
    if point.status != "en_route":
        move_point(point.status, "on_site")
    equipment = _equipment(session, point.equipment_id)
    distance = haversine_km(lat, lng, equipment.lat, equipment.lng)
    if not within_geofence(lat, lng, equipment.lat, equipment.lng):
        raise DomainError(
            "geofence",
            f"موقعیت شما {distance:.2f} کیلومتر با کارگاه فاصله دارد. حد حضور {GEOFENCE_KM} کیلومتر است.",
            409,
        )
    point.status = move_point("en_route", "on_site")
    visit.phase = "on_site"
    visit.arrive_lat = lat
    visit.arrive_lng = lng
    visit.arrive_distance_km = round(distance, 3)
    visit.arrived_at = utcnow()
    audit(session, "visit", visit.id, "arrive", actor, f"{distance:.3f} km")
    return visit


def start_remote(session: Session, visit_id: int, actor: User) -> Visit:
    visit = _visit(session, visit_id)
    _own_visit(session, visit, actor)
    point = _point(session, visit.point_id)
    if not visit.remote:
        raise DomainError("not_remote", "این بازدید حضوری است.", 409)
    if point.status == "assigned":
        point.status = move_point("assigned", "on_site")
    elif point.status != "on_site":
        move_point(point.status, "on_site")
    visit.phase = "on_site"
    audit(session, "visit", visit.id, "remote_start", actor, "")
    return visit


def confirm_remote_location(session: Session, visit_id: int, actor: User, lat: float, lng: float) -> Visit:
    visit = _visit(session, visit_id)
    _own_visit(session, visit, actor)
    if not visit.remote or visit.phase != "on_site":
        raise DomainError("location_not_allowed", "ثبت موقعیت فقط برای بازبینی از راه دور در محل انجام می‌شود.", 409)
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise DomainError("invalid_location", "مختصات جغرافیایی معتبر نیست.", 400)
    visit.arrive_lat = lat
    visit.arrive_lng = lng
    visit.arrived_at = utcnow()
    audit(session, "visit", visit.id, "location_confirmed", actor, f"{lat:.6f},{lng:.6f}")
    return visit


def save_checklist(session: Session, visit_id: int, actor: User, answers: list[dict]) -> Visit:
    visit = _visit(session, visit_id)
    _own_visit(session, visit, actor)
    if visit.phase != "on_site":
        raise DomainError("not_on_site", "چک‌لیست بعد از حضور در محل یا شروع بازبینی باز می‌شود.", 409)
    point = _point(session, visit.point_id)
    known = {item["id"] for item in point.checklist}
    existing = {
        row.item_id: row
        for row in session.scalars(select(ChecklistAnswer).where(ChecklistAnswer.visit_id == visit.id)).all()
    }
    for raw in answers:
        item_id = str(raw.get("item_id", ""))
        value = str(raw.get("value", ""))
        note = str(raw.get("note", "") or "")
        if item_id not in known:
            raise DomainError("unknown_item", "بند چک‌لیست ناشناخته است.", 400)
        if value not in {"pass", "fail", "na"}:
            raise DomainError("bad_value", "نتیجه بند فقط قبول، رد یا موضوعیت‌ندارد است.", 400)
        if value == "fail" and len(note.strip()) < 3:
            raise DomainError("fail_note", "رد هر بند توضیح می‌خواهد.", 400)
        row = existing.get(item_id)
        if row is None:
            row = ChecklistAnswer(visit_id=visit.id, item_id=item_id, value=value, note=note)
            session.add(row)
            existing[item_id] = row
        else:
            row.value = value
            row.note = note
    return visit


PHOTO_KINDS = {
    "item": "مورد بازرسی",
    "environment": "محیط",
    "marker": "پیکان‌کار",
}


def add_evidence(
    session: Session,
    visit_id: int,
    actor: User,
    caption: str,
    lat: float | None,
    lng: float | None,
    *,
    kind: str = "item",
    stored_name: str = "",
) -> Evidence:
    visit = _visit(session, visit_id)
    _own_visit(session, visit, actor)
    if visit.phase != "on_site":
        raise DomainError("not_on_site", "عکس فقط حین بازرسی ثبت می‌شود.", 409)
    if visit.arrive_lat is None or visit.arrive_lng is None or visit.arrived_at is None:
        raise DomainError("location_required", "برای پیوست مدرک، موقعیت جغرافیایی را فعال و تأیید کنید.", 409)
    if kind not in PHOTO_KINDS and kind != "inspector_signature":
        raise DomainError("bad_photo", "نوع عکس باید مورد بازرسی، محیط یا پیکان‌کار باشد.", 400)
    text = caption.strip() or ("مهر و امضای بازرس" if kind == "inspector_signature" else PHOTO_KINDS[kind])
    row = Evidence(visit_id=visit.id, caption=text[:200], kind=kind, stored_name=stored_name, lat=lat, lng=lng)
    session.add(row)
    session.flush()
    audit(session, "evidence", row.id, "photo", actor, f"{kind}:{text}")
    return row


def add_site_photos(session: Session, visit_id: int, actor: User, lat: float | None, lng: float | None) -> None:
    """سه شاهد متنی برای بازدیدهای شبیه‌سازی‌شده. ثبت موبایل فایل عکس می‌فرستد."""
    for kind in PHOTO_KINDS:
        add_evidence(session, visit_id, actor, PHOTO_KINDS[kind], lat, lng, kind=kind)


def submit_visit(
    session: Session,
    visit_id: int,
    actor: User,
    result: str,
    note: str,
    *,
    require_signature: bool = True,
    require_in_report: bool = True,
) -> Visit:
    visit = _visit(session, visit_id)
    _own_visit(session, visit, actor)
    point = _point(session, visit.point_id)
    if visit.phase != "on_site" or point.status != "on_site":
        raise DomainError("illegal_transition", "گزارش فقط از وضعیت در محل ارسال می‌شود.", 409)
    if visit.arrive_lat is None or visit.arrive_lng is None or visit.arrived_at is None:
        raise DomainError("location_required", "برای ارسال گزارش، موقعیت جغرافیایی را فعال و تأیید کنید.", 409)
    if result not in {"accept", "reject"}:
        raise DomainError("bad_result", "نتیجه بازدید قبول یا رد است.", 400)
    if require_in_report and point.request_form_id:
        try:
            report_form = json.loads(visit.report_form_json or "{}")
        except json.JSONDecodeError:
            report_form = {}
        if not report_form.get("duration") or not report_form.get("observation"):
            raise DomainError("in_report_incomplete", "ابتدا نسخهٔ گزارش فرم IN را با مدت و شرح بازرسی تکمیل و ذخیره کنید.", 409)
    answers = session.scalars(select(ChecklistAnswer).where(ChecklistAnswer.visit_id == visit.id)).all()
    by_id = {row.item_id: row for row in answers}
    for item in point.checklist:
        if not item.get("mandatory", True):
            continue
        row = by_id.get(item["id"])
        if row is None:
            raise DomainError("checklist_incomplete", f"بند اجباری خالی است: {item['text']}", 409)
    fails = [row for row in answers if row.value == "fail"]
    if result == "accept" and fails:
        raise DomainError("result_conflict", "با بند مردود نمی‌توان نتیجه قبول ثبت کرد.", 409)
    if result == "reject" and not fails:
        raise DomainError("result_conflict", "رد بازدید حداقل یک بند مردود می‌خواهد.", 409)
    if point.point_type in {"H", "W"} and not visit.remote:
        present = set(
            session.scalars(select(Evidence.kind).where(Evidence.visit_id == visit.id)).all()
        )
        missing = [PHOTO_KINDS[kind] for kind in PHOTO_KINDS if kind not in present]
        if missing:
            raise DomainError("photo_required", "عکس‌های لازم با موبایل ثبت نشده: " + "، ".join(missing), 409)
    if require_signature:
        signature = session.scalar(
            select(Evidence)
            .where(
                Evidence.visit_id == visit.id,
                Evidence.kind == "inspector_signature",
                Evidence.stored_name != "",
            )
            .order_by(Evidence.id.desc())
        )
        if signature is None or (visit.reviewed_at and signature.created_at <= visit.reviewed_at):
            raise DomainError("signature_required", "برای ارسال گزارش، مهر و امضای تصویری بازرس را بارگذاری کنید.", 409)
    if visit.remote and len(note.strip()) < 10:
        raise DomainError("remote_note", "بازبینی از راه دور شرح حداقل ده‌حرفی می‌خواهد.", 400)
    point.status = move_point("on_site", "submitted")
    visit.phase = "submitted"
    visit.report_stage = "unit_review"
    visit.review_note = ""
    visit.result = result
    point.ncr_open = result == "reject"
    visit.note = note.strip()
    visit.submitted_at = utcnow()
    visit.ivr_no = f"IVR-{visit.submitted_at:%Y}-{visit.id:05d}"
    audit(session, "visit", visit.id, "submit", actor, result)
    _notify_project_managers(session, point, visit, actor)
    return visit


def _project_of(session: Session, point: InspectionPoint) -> Project | None:
    equipment = _equipment(session, point.equipment_id)
    order = _order(session, equipment.po_id)
    return session.get(Project, order.project_id)


def _notify_users(session: Session, users: list[User], title: str, body: str) -> None:
    seen: set[int] = set()
    for user in users:
        if user.id in seen:
            continue
        seen.add(user.id)
        notify(session, user.id, title, body)


def _notify_project_managers(session: Session, point: InspectionPoint, visit: Visit, actor: User) -> None:
    """گزارش ثبت‌شده را برای مدیر واحدِ مسئول ارسال می‌کند."""
    equipment = _equipment(session, point.equipment_id)
    manager = session.get(User, point.unit_manager_id) if point.unit_manager_id else None
    inspector = session.get(Inspector, visit.inspector_id)
    inspector_user = session.get(User, inspector.user_id) if inspector else None
    verdict = "قبول" if visit.result == "accept" else "رد"
    who = inspector_user.name if inspector_user else actor.name
    body = f"{visit.ivr_no} — {equipment.tag} — {point.title} — {who} — {verdict}"
    if manager is not None:
        notify(session, manager.id, "گزارش بازرسی نیازمند بررسی مدیر واحد", body)


def _notify_client(session: Session, point: InspectionPoint, visit: Visit) -> None:
    equipment = _equipment(session, point.equipment_id)
    project = _project_of(session, point)
    if project is None:
        return
    buyers = session.scalars(
        select(User).where(User.role == "buyer", User.company_id == project.buyer_company_id)
    ).all()
    body = f"{visit.ivr_no} — {equipment.tag} — {point.title} — تأیید مدیر پروژه"
    _notify_users(session, list(buyers), "گزارش تأییدشده در کارتابل کارفرما", body)


def _notify_return(session: Session, point: InspectionPoint, visit: Visit) -> None:
    inspector = session.get(Inspector, visit.inspector_id)
    if inspector is None:
        return
    equipment = _equipment(session, point.equipment_id)
    notify(
        session,
        inspector.user_id,
        "گزارش به‌خاطر مغایرت برگشت",
        f"{visit.ivr_no} — {equipment.tag} — {point.title}",
    )


def review_visit(session: Session, visit_id: int, actor: User, decision: str, note: str = "") -> Visit:
    _require(actor, {"manager", "unit_manager", "admin"})
    visit = _visit(session, visit_id)
    point = _point(session, visit.point_id)
    project, _order_row = _project_contacts(session, point)
    stage_roles = {
        "unit_review": {"unit_manager", "admin"},
        "manager_review": {"manager", "admin"},
    }
    if actor.role not in stage_roles.get(visit.report_stage, set()):
        raise DomainError("illegal_transition", "گزارش در کارتابل این نقش نیست.", 409)
    if actor.role == "unit_manager" and point.unit_manager_id != actor.id:
        raise DomainError("forbidden", "این گزارش به واحد شما ارجاع نشده است.", 403)
    if actor.role == "manager" and actor.company_id != project.buyer_company_id:
        raise DomainError("forbidden", "این گزارش برای پروژهٔ شما نیست.", 403)
    if visit.phase != "submitted":
        raise DomainError("illegal_transition", "گزارش ارسال‌شده برای بازبینی در دسترس نیست.", 409)
    text = note.strip()
    if decision == "return" and not 3 <= len(text) <= 2000:
        raise DomainError("return_reason_required", "برای مرجوع کردن گزارش، دلیل ۳ تا ۲۰۰۰ نویسه‌ای لازم است.", 400)
    if len(text) > 2000:
        raise DomainError("bad_note", "یادداشت بیش از حد طولانی است.", 400)
    now = utcnow()
    if decision in {"approve", "accept"}:
        if visit.result != "accept":
            raise DomainError("result_conflict", "گزارش مردود را نمی‌توان تأیید کرد. باید برگردد.", 409)
        if visit.report_stage == "unit_review":
            visit.report_stage = "manager_review"
            visit.reviewed_at = now
            managers = session.scalars(
                select(User).where(User.role == "manager", User.company_id == project.buyer_company_id)
            ).all()
            equipment = _equipment(session, point.equipment_id)
            _notify_users(
                session,
                list(managers),
                "گزارش بازرسی نیازمند تأیید مدیر پروژه",
                f"{visit.ivr_no} — {equipment.tag} — {point.title}",
            )
            audit(session, "visit", visit.id, "unit_review_approved", actor, text or visit.ivr_no)
        else:
            visit.report_stage = "client_review"
            visit.phase = "client"
            visit.reviewed_at = now
            point.ncr_open = False
            offer = session.get(Offer, visit.offer_id) if visit.offer_id else None
            if offer and session.scalar(select(Ledger.id).where(Ledger.visit_id == visit.id)) is None:
                session.add(
                    Ledger(
                        visit_id=visit.id,
                        inspector_id=visit.inspector_id,
                        fee_irr=offer.fee_irr,
                        commission_irr=offer.commission_irr,
                        net_irr=offer.net_irr + offer.travel_irr,
                        travel_irr=offer.travel_irr,
                    )
                )
            audit(session, "visit", visit.id, "project_review_approved", actor, text or visit.ivr_no)
            _notify_client(session, point, visit)
    elif decision == "return":
        visit.review_note = text
        if visit.report_stage == "unit_review":
            point.status = move_point("submitted", "on_site")
            visit.phase = "on_site"
            visit.report_stage = "inspector_revision"
            inspector = session.get(Inspector, visit.inspector_id)
            if inspector is not None:
                notify(session, inspector.user_id, "گزارش برای اصلاح برگشت", f"{visit.ivr_no} — {text}")
            audit(session, "visit", visit.id, "unit_returned_to_inspector", actor, text)
        else:
            visit.report_stage = "unit_review"
            manager = session.get(User, point.unit_manager_id) if point.unit_manager_id else None
            if manager is not None:
                notify(session, manager.id, "گزارش برای بررسی مجدد مدیر واحد برگشت", f"{visit.ivr_no} — {text}")
            audit(session, "visit", visit.id, "project_returned_to_unit_manager", actor, text)
        visit.reviewed_at = now
    else:
        raise DomainError("bad_decision", "تصمیم بازبینی باید تأیید یا مرجوعی باشد.", 400)
    return visit


def issue_bill(session: Session, visit: Visit) -> Bill:
    """صورت‌وضعیت و فاکتور تأیید نهایی. اگر قبلاً صادر شده باشد همان را برمی‌گرداند."""
    if visit.phase != "confirmed":
        raise DomainError("illegal_transition", "صورتحساب فقط پس از تأیید کارفرما صادر می‌شود.", 409)
    found = session.scalar(select(Bill).where(Bill.visit_id == visit.id))
    if found is not None:
        return found
    point = _point(session, visit.point_id)
    equipment = _equipment(session, point.equipment_id)
    order = _order(session, equipment.po_id)
    project = session.get(Project, order.project_id)
    buyer = session.get(Company, project.buyer_company_id) if project else None
    vendor = session.get(Company, order.vendor_company_id)
    offer = session.get(Offer, visit.offer_id) if visit.offer_id else None
    ledger = session.scalar(select(Ledger).where(Ledger.visit_id == visit.id))
    gross = offer.fee_irr if offer is not None else (ledger.fee_irr if ledger is not None else 0)
    amounts = compute_bill(gross)
    moment = visit.client_approved_at or utcnow()
    year = fiscal_year(moment)
    bill = Bill(
        visit_id=visit.id,
        kind=project.kind if project is not None else "project",
        statement_no=f"PS-{year}-{visit.id:05d}",
        invoice_no=f"FA-{year}-{visit.id:05d}",
        client_name=buyer.name if buyer else "",
        company_name=vendor.name if vendor else "",
        tag=equipment.tag,
        title=point.title,
        ivr_no=visit.ivr_no,
        basis=amounts["basis"],
        issued_at=moment,
        gross_irr=amounts["gross_irr"],
        performance_rate=amounts["performance_rate"],
        performance_irr=amounts["performance_irr"],
        insurance_rate=amounts["insurance_rate"],
        insurance_irr=amounts["insurance_irr"],
        tax_rate=amounts["tax_rate"],
        tax_irr=amounts["tax_irr"],
        vat_rate=amounts["vat_rate"],
        vat_irr=amounts["vat_irr"],
        net_irr=amounts["net_irr"],
    )
    session.add(bill)
    session.flush()
    return bill


def update_bill_accounting_status(session: Session, bill_id: int, actor: User, status: str, note: str = "") -> Bill:
    _require(actor, {"manager", "admin"})
    bill = session.get(Bill, bill_id)
    if bill is None:
        raise DomainError("not_found", "صورت‌وضعیت پیدا نشد.", 404)
    if actor.role == "manager":
        visit = _visit(session, bill.visit_id)
        buyer_sees(session, actor, _point(session, visit.point_id))
    if status not in {"issued", "sent_to_accounting", "returned", "overdue"}:
        raise DomainError("bad_accounting_status", "وضعیت مالی نامعتبر است.", 400)
    text = note.strip()
    if status == "returned" and len(text) < 3:
        raise DomainError("return_reason_required", "برای مرجوع کردن، دلیل حداقل سه نویسه‌ای لازم است.", 400)
    if len(text) > 2000:
        raise DomainError("bad_note", "یادداشت بیش از حد طولانی است.", 400)
    bill.accounting_status = status
    bill.accounting_note = text
    bill.accounting_updated_at = utcnow()
    audit(session, "bill", bill.id, f"accounting_{status}", actor, text)
    visit = _visit(session, bill.visit_id)
    point = _point(session, visit.point_id)
    project, _order_row = _project_contacts(session, point)
    status_label = {
        "issued": "ارسال نشده به ذی‌حسابی",
        "sent_to_accounting": "ارسال شده به ذی‌حسابی",
        "returned": "مرجوع‌شده",
        "overdue": "معوقه",
    }[status]
    message = f"{bill.statement_no} — {status_label}" + (f" — {text}" if text else "")
    _notify_role(session, "manager", "وضعیت صورت‌وضعیت تغییر کرد", message, company_id=project.buyer_company_id)
    _notify_role(session, "buyer", "وضعیت صورت‌حساب تغییر کرد", message, company_id=project.buyer_company_id)
    return bill


def update_claim_status(session: Session, bill_id: int, actor: User, status: str, note: str = "") -> Bill:
    _require(actor, {"manager", "admin"})
    bill = session.get(Bill, bill_id)
    if bill is None:
        raise DomainError("not_found", "Claim پیدا نشد.", 404)
    visit = _visit(session, bill.visit_id)
    point = _point(session, visit.point_id)
    project, _order = _project_contacts(session, point)
    if actor.role == "manager" and actor.company_id != project.buyer_company_id:
        raise DomainError("forbidden", "این Claim برای پروژهٔ شما نیست.", 403)
    if status not in {"unpaid", "paid", "needs_correction"}:
        raise DomainError("bad_claim_status", "وضعیت Claim نامعتبر است.", 400)
    text = note.strip()
    if status == "needs_correction" and len(text) < 3:
        raise DomainError("claim_note_required", "برای درخواست اصلاح، دلیل حداقل سه نویسه‌ای لازم است.", 400)
    if len(text) > 2000:
        raise DomainError("bad_note", "یادداشت بیش از حد طولانی است.", 400)
    bill.claim_status = status
    bill.claim_note = text
    bill.claim_updated_at = utcnow()
    labels = {"unpaid": "پرداخت‌نشده", "paid": "پرداخت‌شده", "needs_correction": "نیازمند اصلاح"}
    message = f"Claim {bill.statement_no}: {labels[status]}"
    if text:
        message = f"{message} — {text}"
    _notify_role(session, "buyer", "به‌روزرسانی وضعیت Claim", message, company_id=project.buyer_company_id)
    _notify_role(session, "manager", "به‌روزرسانی وضعیت Claim", message, company_id=project.buyer_company_id)
    audit(session, "bill", bill.id, f"claim_{status}", actor, text)
    return bill


def ensure_confirmed_bills(session: Session) -> None:
    visits = session.scalars(select(Visit).where(Visit.phase == "confirmed")).all()
    for visit in visits:
        issue_bill(session, visit)


def confirm_by_client(session: Session, visit_id: int, actor: User) -> Visit:
    """تأیید کارفرما گزارش را در کارنامهٔ همان بازرس می‌نشاند."""
    _require(actor, {"buyer", "admin"})
    visit = _visit(session, visit_id)
    point = _point(session, visit.point_id)
    if actor.role == "buyer":
        buyer_sees(session, actor, point)
    if visit.phase != "client" or visit.report_stage != "client_review":
        raise DomainError("illegal_transition", "فقط گزارش تأییدشدهٔ مدیر پروژه در کارتابل کارفرما تأیید می‌شود.", 409)
    if visit.result != "accept":
        raise DomainError("result_conflict", "کارفرما فقط گزارش قبول را تأیید می‌کند.", 409)
    now = utcnow()
    if point.status == "submitted":
        point.status = move_point("submitted", "accepted")
    elif point.status != "accepted":
        raise DomainError("illegal_transition", "وضعیت نقطه برای تأیید کارفرما معتبر نیست.", 409)
    visit.phase = "confirmed"
    visit.report_stage = "confirmed"
    visit.client_approved_at = now
    audit(session, "visit", visit.id, "client_confirm", actor, visit.ivr_no)
    inspector = session.get(Inspector, visit.inspector_id)
    equipment = _equipment(session, point.equipment_id)
    if inspector is not None:
        notify(
            session,
            inspector.user_id,
            "بازرسی در کارنامه نشست",
            f"{visit.ivr_no} — {equipment.tag} — {point.title} — تأیید کارفرما",
        )
    bill = issue_bill(session, visit)
    _notify_bill(session, point, bill)
    return visit


def reject_by_client(session: Session, visit_id: int, actor: User, reason: str) -> Visit:
    _require(actor, {"buyer", "admin"})
    visit = _visit(session, visit_id)
    point = _point(session, visit.point_id)
    if actor.role == "buyer":
        buyer_sees(session, actor, point)
    text = reason.strip()
    if len(text) < 3 or len(text) > 2000:
        raise DomainError("client_rejection_reason_required", "دلیل رد باید بین ۳ تا ۲۰۰۰ نویسه باشد.", 400)
    if visit.phase != "client" or visit.report_stage != "client_review" or visit.result != "accept":
        raise DomainError("illegal_transition", "فقط گزارش تأییدشدهٔ مدیر پروژه در کارتابل کارفرما قابل مرجوعی است.", 409)
    if point.status == "accepted":
        point.status = move_point("accepted", "submitted")
    visit.phase = "submitted"
    visit.report_stage = "manager_review"
    visit.review_note = text
    visit.client_rejection_note = text
    visit.reviewed_at = utcnow()
    project = _project_of(session, point)
    message = f"{visit.ivr_no} — {point.title} — رد کارفرما: {text}"
    if project:
        _notify_role(session, "manager", "گزارش بازرسی برای بررسی مجدد برگشت", message, company_id=project.buyer_company_id)
    audit(session, "visit", visit.id, "client_reject", actor, text)
    return visit


def _notify_bill(session: Session, point: InspectionPoint, bill: Bill) -> None:
    project = _project_of(session, point)
    if project is None:
        return
    buyers = session.scalars(
        select(User).where(User.role == "buyer", User.company_id == project.buyer_company_id)
    ).all()
    kind = "پروژه‌ای" if bill.kind == "project" else "موردی"
    body = f"{bill.statement_no} — فاکتور {bill.invoice_no} — مشتری {kind} — خالص {bill.net_irr:,} ریال"
    _notify_users(session, list(buyers), "صورت‌وضعیت و فاکتور صادر شد", body)


def company_name(session: Session, company_id: int | None) -> str:
    if not company_id:
        return ""
    company = session.get(Company, company_id)
    return company.name if company else ""

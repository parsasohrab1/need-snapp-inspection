import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.catalog import DISCIPLINE_LABELS, DOC_LABELS, POINT_TYPE_LABELS
from app.domain.errors import DomainError
from app.models import (
    AuditEvent,
    ChecklistAnswer,
    Company,
    Document,
    Equipment,
    Evidence,
    Bill,
    FormSheet,
    InspectionPoint,
    InspectionRequestApproval,
    InspectionRequestComment,
    Inspector,
    Ledger,
    Mom,
    Notification,
    Offer,
    Project,
    PurchaseOrder,
    ReportComment,
    User,
    Visit,
)
from app.services.engine import active_job_count, ensure_confirmed_bills, missing_docs


def _equipment_map(session: Session) -> dict[int, Equipment]:
    return {row.id: row for row in session.scalars(select(Equipment)).all()}


def _order_map(session: Session) -> dict[int, PurchaseOrder]:
    return {row.id: row for row in session.scalars(select(PurchaseOrder)).all()}


def visible_points(session: Session, actor: User) -> list[InspectionPoint]:
    points = session.scalars(select(InspectionPoint).order_by(InspectionPoint.id)).all()
    if actor.role in {"admin", "coordinator"}:
        return list(points)
    if actor.role == "unit_manager":
        return [point for point in points if point.unit_manager_id == actor.id]
    equipment = _equipment_map(session)
    orders = _order_map(session)
    projects = {row.id: row for row in session.scalars(select(Project)).all()}
    kept = []
    for point in points:
        item = equipment[point.equipment_id]
        order = orders[item.po_id]
        if actor.role == "vendor" and actor.company_id == order.vendor_company_id:
            kept.append(point)
        elif actor.role in {"buyer", "manager"}:
            project = projects[order.project_id]
            if actor.company_id == project.buyer_company_id:
                kept.append(point)
        elif actor.role == "inspector":
            kept.append(point)
    return kept


KIND_LABELS = {"project": "بازرسی پروژه‌ها", "case": "بازرسی موردی"}
LIVE_STATUSES = {"offering", "assigned", "en_route", "on_site"}


def project_by_equipment(session: Session) -> dict[int, Project]:
    orders = _order_map(session)
    projects = {row.id: row for row in session.scalars(select(Project)).all()}
    found = {}
    for item in _equipment_map(session).values():
        order = orders[item.po_id]
        found[item.id] = projects[order.project_id]
    return found


def dashboard(session: Session, actor: User, kind: str | None = None) -> dict:
    projects = project_by_equipment(session)
    everyone = visible_points(session, actor)
    modes = []
    for key in ("project", "case"):
        subset = [point for point in everyone if projects[point.equipment_id].kind == key]
        modes.append(
            {
                "id": key,
                "title": KIND_LABELS[key],
                "points": len(subset),
                "accepted": sum(1 for point in subset if point.status == "accepted"),
                "live": sum(1 for point in subset if point.status in LIVE_STATUSES),
            }
        )
    points = everyone if kind is None else [point for point in everyone if projects[point.equipment_id].kind == kind]
    by_status: dict[str, int] = {}
    for point in points:
        by_status[point.status] = by_status.get(point.status, 0) + 1
    ids = [point.id for point in points]
    offers = []
    if ids:
        offers = session.scalars(select(Offer).where(Offer.point_id.in_(ids))).all()
    decided = [offer for offer in offers if offer.status in {"accepted", "declined", "expired"}]
    accepted_offers = [offer for offer in decided if offer.status == "accepted"]
    ledgers = session.scalars(select(Ledger)).all() if actor.role in {"admin", "coordinator", "buyer", "manager"} else []
    if kind and ledgers:
        visit_ids = set(session.scalars(select(Visit.id).where(Visit.point_id.in_(ids))).all()) if ids else set()
        ledgers = [row for row in ledgers if row.visit_id in visit_ids]
    inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id)) if actor.role == "inspector" else None
    my_offers = []
    my_net = 0
    active_visit = None
    if inspector:
        my_offers = session.scalars(
            select(Offer).where(Offer.inspector_id == inspector.id, Offer.status == "pending")
        ).all()
        my_net = int(
            session.scalar(select(func.coalesce(func.sum(Ledger.net_irr), 0)).where(Ledger.inspector_id == inspector.id))
            or 0
        )
        active_visit = session.scalar(
            select(Visit).where(Visit.inspector_id == inspector.id, Visit.phase.in_(("assigned", "en_route", "on_site")))
        )
    return {
        "kind": kind or "all",
        "modes": modes,
        "points_total": len(points),
        "by_status": by_status,
        "open_ncr": sum(1 for point in points if point.ncr_open),
        "offers_pending": sum(1 for offer in offers if offer.status == "pending"),
        "acceptance_rate": round(len(accepted_offers) / len(decided), 3) if decided else None,
        "fees_irr": sum(row.fee_irr for row in ledgers),
        "commission_irr": sum(row.commission_irr for row in ledgers),
        "inspector_net_irr": sum(row.net_irr for row in ledgers),
        "mine": {
            "pending_offers": len(my_offers),
            "active_visit_id": None if active_visit is None else active_visit.id,
            "net_irr": my_net,
            "inspector_id": None if inspector is None else inspector.id,
        },
    }


OPEN_PHASES = ("assigned", "en_route", "on_site", "submitted")


def dispatch_for_points(session: Session, points: list[InspectionPoint]) -> dict[int, dict]:
    """Who the system actually sent, and who is still waiting to accept."""
    empty = {"inspector": "", "method": "", "label": "", "sentence": "", "offered": []}
    if not points:
        return {}
    point_ids = [point.id for point in points]
    visits = session.scalars(select(Visit).where(Visit.point_id.in_(point_ids))).all()
    offers = session.scalars(select(Offer).where(Offer.point_id.in_(point_ids))).all()
    inspector_ids = {visit.inspector_id for visit in visits} | {offer.inspector_id for offer in offers}
    inspectors = (
        {row.id: row for row in session.scalars(select(Inspector).where(Inspector.id.in_(inspector_ids))).all()}
        if inspector_ids
        else {}
    )
    user_ids = [row.user_id for row in inspectors.values()]
    users = (
        {row.id: row for row in session.scalars(select(User).where(User.id.in_(user_ids))).all()}
        if user_ids
        else {}
    )

    def inspector_name(inspector_id: int) -> str:
        inspector = inspectors.get(inspector_id)
        user = users.get(inspector.user_id) if inspector else None
        return user.name if user else ""

    visit_ids = [visit.id for visit in visits]
    audits = (
        session.scalars(
            select(AuditEvent).where(
                AuditEvent.entity == "visit",
                AuditEvent.entity_id.in_(visit_ids),
                AuditEvent.action.in_(("accept", "force_assign")),
            )
        ).all()
        if visit_ids
        else []
    )
    method_by_visit = {
        event.entity_id: "manual" if event.action == "force_assign" else "first_accept" for event in audits
    }
    visits_by_point: dict[int, list[Visit]] = {}
    for visit in visits:
        visits_by_point.setdefault(visit.point_id, []).append(visit)
    offers_by_point: dict[int, list[Offer]] = {}
    for offer in offers:
        offers_by_point.setdefault(offer.point_id, []).append(offer)

    found: dict[int, dict] = {}
    for point in points:
        point_visits = sorted(visits_by_point.get(point.id, []), key=lambda visit: visit.id)
        point_offers = offers_by_point.get(point.id, [])
        open_visit = next((visit for visit in reversed(point_visits) if visit.phase in OPEN_PHASES), None)
        accepted_visit = next(
            (visit for visit in reversed(point_visits) if visit.phase in {"closed", "client", "confirmed"} and visit.result == "accept"),
            None,
        )
        chosen = open_visit or (accepted_visit if point.status == "accepted" else None)
        pending_names = [
            inspector_name(offer.inspector_id)
            for offer in sorted(point_offers, key=lambda offer: (-offer.score, offer.id))
            if offer.status == "pending" and inspector_name(offer.inspector_id)
        ]
        if chosen:
            who = inspector_name(chosen.inspector_id)
            method = method_by_visit.get(chosen.id, "first_accept")
            if method == "manual":
                label = f"اعزام دستی: {who}"
                sentence = f"هماهنگ‌کننده {who} را مستقیم اعزام کرد."
            else:
                label = f"انتخاب سامانه: {who}"
                sentence = f"سامانه {who} را پس از تأیید او انتخاب و اعزام کرد."
            found[point.id] = {
                "inspector": who,
                "method": method,
                "label": label,
                "sentence": sentence,
                "offered": pending_names,
            }
        elif pending_names:
            names = "، ".join(pending_names)
            found[point.id] = {
                "inspector": "",
                "method": "",
                "label": "",
                "sentence": f"درخواست نزد {names} است. هر پیشنهاد ۳۰ دقیقه مهلت دارد؛ در صورت عدم پذیرش، به نزدیک‌ترین بازرس بعدی می‌رسد.",
                "offered": pending_names,
            }
        else:
            found[point.id] = dict(empty)
    return found


def board(session: Session, actor: User, kind: str | None = None) -> list[dict]:
    equipment = _equipment_map(session)
    projects = project_by_equipment(session)
    points = visible_points(session, actor)
    if kind:
        points = [point for point in points if projects[point.equipment_id].kind == kind]
    dispatched = dispatch_for_points(session, points)
    rows = []
    for point in points:
        item = equipment[point.equipment_id]
        choice = dispatched.get(point.id, {})
        rows.append(
            {
                "id": point.id,
                "equipment_id": item.id,
                "tag": item.tag,
                "equipment": item.title,
                "title": point.title,
                "kind": projects[point.equipment_id].kind,
                "kind_label": KIND_LABELS.get(projects[point.equipment_id].kind, projects[point.equipment_id].kind),
                "project_code": projects[point.equipment_id].code,
                "project_name": projects[point.equipment_id].name,
                "discipline": point.discipline,
                "discipline_label": DISCIPLINE_LABELS.get(point.discipline, point.discipline),
                "point_type": point.point_type,
                "point_type_label": POINT_TYPE_LABELS.get(point.point_type, point.point_type),
                "status": point.status,
                "ncr_open": point.ncr_open,
                "remote_allowed": point.remote_allowed,
                "remote_requested": point.remote_requested,
                "attempt": point.attempt,
                "request_status": point.request_status,
                "request_note": point.request_note,
                "request_form_id": point.request_form_id,
                "missing_docs": missing_docs(session, point),
                "assignee": "" if actor.role in {"buyer", "vendor"} else choice.get("inspector", ""),
                "dispatch_method": "" if actor.role in {"buyer", "vendor"} else choice.get("method", ""),
                "dispatch_label": "" if actor.role in {"buyer", "vendor"} else choice.get("label", ""),
                "dispatch_sentence": "" if actor.role in {"buyer", "vendor"} else choice.get("sentence", ""),
                "offered": [] if actor.role in {"buyer", "vendor"} else choice.get("offered", []),
            }
        )
    return rows


def point_detail(session: Session, point_id: int, actor: User | None = None) -> dict:
    point = session.get(InspectionPoint, point_id)
    item = session.get(Equipment, point.equipment_id)
    order = session.get(PurchaseOrder, item.po_id)
    project = session.get(Project, order.project_id)
    vendor = session.get(Company, order.vendor_company_id)
    buyer = session.get(Company, project.buyer_company_id)
    docs = session.scalars(select(Document).where(Document.equipment_id == item.id)).all()
    request_approvals = session.scalars(
        select(InspectionRequestApproval)
        .where(InspectionRequestApproval.point_id == point.id)
        .order_by(InspectionRequestApproval.created_at, InspectionRequestApproval.id)
    ).all()
    approver_ids = {row.actor_id for row in request_approvals}
    approvers = {
        row.id: row
        for row in session.scalars(select(User).where(User.id.in_(approver_ids))).all()
    } if approver_ids else {}
    offers = session.scalars(select(Offer).where(Offer.point_id == point.id).order_by(Offer.id.desc())).all()
    visits = session.scalars(select(Visit).where(Visit.point_id == point.id).order_by(Visit.id)).all()
    return {
        "point": {
            "id": point.id,
            "seq": point.seq,
            "title": point.title,
            "status": point.status,
            "request_status": point.request_status,
            "request_note": point.request_note,
            "request_form_id": point.request_form_id,
            "request_department": point.request_department,
            "unit_manager_id": point.unit_manager_id,
            "request_approvals": [
                {
                    "id": approval.id,
                    "stage": approval.stage,
                    "actor": approvers[approval.actor_id].name if approval.actor_id in approvers else "کاربر",
                    "filename": approval.signature_filename,
                    "url": f"/api/request-approvals/{approval.id}/signature",
                    "created_at": approval.created_at.isoformat(sep=" ", timespec="seconds"),
                }
                for approval in request_approvals
            ],
            "request_comments": request_comments(session, point.id),
            "discipline": point.discipline,
            "discipline_label": DISCIPLINE_LABELS.get(point.discipline, point.discipline),
            "point_type": point.point_type,
            "point_type_label": POINT_TYPE_LABELS.get(point.point_type, point.point_type),
            "standard_ref": point.standard_ref,
            "ncr_open": point.ncr_open,
            "remote_allowed": point.remote_allowed,
            "remote_requested": point.remote_requested,
            "window_note": point.window_note,
            "checklist": point.checklist,
            "required_docs": [
                {"type": doc, "label": DOC_LABELS.get(doc, doc)} for doc in point.required_docs
            ],
            "missing_docs": [
                {"type": doc, "label": DOC_LABELS.get(doc, doc)} for doc in missing_docs(session, point)
            ],
        },
        "equipment": {
            "id": item.id,
            "tag": item.tag,
            "title": item.title,
            "standard": item.standard,
            "workshop_name": item.workshop_name,
            "city": item.city,
            "lat": item.lat,
            "lng": item.lng,
        },
        "order": {"number": order.number, "title": order.title},
        "project": {
            "code": project.code,
            "name": project.name,
            "kind": project.kind,
            "kind_label": KIND_LABELS.get(project.kind, project.kind),
        },
        "companies": {"buyer": buyer.name, "vendor": vendor.name},
        "documents": [
            {"id": doc.id, "type": doc.doc_type, "label": DOC_LABELS.get(doc.doc_type, doc.doc_type), "title": doc.title, "filename": doc.filename}
            for doc in docs
        ],
        "offers": [
            _offer(
                session,
                offer,
                include_travel=actor is not None and actor.role in {"inspector", "manager", "unit_manager"},
            )
            for offer in offers
        ],
        "visits": [_visit_brief(session, visit) for visit in visits],
        "history": stage_history(session, point.id),
        "selection": dispatch_for_points(session, [point]).get(point.id, {}),
    }


def manager_dashboard(session: Session, actor: User, kind: str | None = None) -> dict:
    if actor.role != "manager":
        raise DomainError("forbidden", "این میز کار برای مدیر پروژه است.", 403)
    points = visible_points(session, actor)
    project_index = project_by_equipment(session)
    if kind:
        points = [point for point in points if project_index[point.equipment_id].kind == kind]
    equipment = _equipment_map(session)
    orders = _order_map(session)
    projects = {
        row.id: row for row in session.scalars(select(Project)).all()
    }
    companies = {
        row.id: row for row in session.scalars(select(Company)).all()
    }
    project_equipment: dict[int, set[int]] = {}
    project_points: dict[int, list[InspectionPoint]] = {}
    for point in points:
        item = equipment[point.equipment_id]
        order = orders[item.po_id]
        project_equipment.setdefault(order.project_id, set()).add(item.id)
        project_points.setdefault(order.project_id, []).append(point)

    clients = {}
    project_rows = []
    for project_id, project_rows_for_id in project_points.items():
        project = projects[project_id]
        buyer = companies.get(project.buyer_company_id)
        if buyer:
            clients[buyer.id] = buyer
        project_rows.append({
            "id": project.id,
            "code": project.code,
            "name": project.name,
            "buyer": buyer.name if buyer else "",
            "equipment_count": len(project_equipment[project_id]),
            "itp_count": len(project_equipment[project_id]),
            "itp_point_count": len(project_rows_for_id),
            "inspection_count": len(project_rows_for_id),
            "incomplete_count": sum(1 for point in project_rows_for_id if point.ncr_open),
            "not_done_count": sum(1 for point in project_rows_for_id if point.status != "accepted"),
        })

    dispatch_statuses = {"offering", "assigned", "en_route", "on_site"}
    dispatches = dispatch_for_points(session, points)
    selected_for_dispatch = []
    for point in points:
        if point.status not in dispatch_statuses:
            continue
        item = equipment[point.equipment_id]
        order = orders[item.po_id]
        project = projects[order.project_id]
        dispatch = dispatches.get(point.id, {})
        selected_for_dispatch.append({
            "point_id": point.id,
            "project": project.name,
            "project_code": project.code,
            "tag": item.tag,
            "title": point.title,
            "status": point.status,
            "inspector": dispatch.get("inspector", ""),
            "dispatch_sentence": dispatch.get("sentence", ""),
            "offered": dispatch.get("offered", []),
        })

    latest_visits = {}
    point_ids = [point.id for point in points]
    if point_ids:
        visits = session.scalars(
            select(Visit).where(Visit.point_id.in_(point_ids)).order_by(Visit.id.desc())
        ).all()
        for visit in visits:
            latest_visits.setdefault(visit.point_id, visit)
    inspector_rows = inspectors_public(session)
    inspector_names = {row["id"]: row["name"] for row in inspector_rows}
    request_forms = {
        row.id: row
        for row in session.scalars(
            select(FormSheet).where(
                FormSheet.id.in_(
                    [point.request_form_id for point in points if point.request_form_id is not None]
                )
            ).order_by(FormSheet.updated_at.desc())
        ).all()
    } if any(point.request_form_id is not None for point in points) else {}
    in_forms = []
    for point in points:
        form = request_forms.get(point.request_form_id)
        if form is None:
            continue
        item = equipment[point.equipment_id]
        order = orders[item.po_id]
        project = projects[order.project_id]
        buyer = companies.get(project.buyer_company_id)
        payload = json.loads(form.payload_json)
        in_forms.append({
            "form_id": form.id,
            "point_id": point.id,
            "number": payload.get("number", ""),
            "date": payload.get("date", ""),
            "project": project.name,
            "buyer": buyer.name if buyer else "",
            "tag": item.tag,
            "title": point.title,
            "request_status": point.request_status,
        })

    def inspection_row(point: InspectionPoint, visit: Visit | None = None) -> dict:
        item = equipment[point.equipment_id]
        visit = visit or latest_visits.get(point.id)
        return {
            "point_id": point.id,
            "visit_id": visit.id if visit else None,
            "ivr_no": visit.ivr_no if visit else "",
            "tag": item.tag,
            "project": projects[orders[item.po_id].project_id].name,
            "title": point.title,
            "status": point.status,
            "request_status": point.request_status,
            "ncr_open": point.ncr_open,
            "inspector": inspector_names.get(visit.inspector_id, "") if visit else "",
            "reason": (visit.client_rejection_note or visit.note) if visit and (visit.result == "reject" or visit.client_rejection_note) else point.request_note,
            "client_approved_at": visit.client_approved_at.isoformat(sep=" ", timespec="seconds") if visit and visit.client_approved_at else "",
        }

    incomplete = [
        inspection_row(point) for point in points
        if point.ncr_open or (
            (visit := latest_visits.get(point.id)) is not None and visit.result == "reject"
        )
    ]
    not_done = [inspection_row(point) for point in points if point.status != "accepted"]
    point_by_id = {point.id: point for point in points}
    scoped_visit_rows = []
    if point_ids := list(point_by_id):
        scoped_visit_rows = session.scalars(
            select(Visit).where(Visit.point_id.in_(point_ids)).order_by(Visit.id.desc())
        ).all()
    approved_reports = [
        inspection_row(point_by_id[visit.point_id], visit)
        for visit in scoped_visit_rows
        if visit.phase == "confirmed"
    ]
    rejected_reports = [
        inspection_row(point_by_id[visit.point_id], visit)
        for visit in scoped_visit_rows
        if visit.result == "reject" or visit.client_rejection_note
    ]
    performed_reports = [
        inspection_row(point_by_id[visit.point_id], visit)
        for visit in scoped_visit_rows
        if visit.submitted_at is not None
    ]
    awaiting_report_review = [
        inspection_row(point_by_id[visit.point_id], visit)
        for visit in scoped_visit_rows
        if visit.phase == "submitted"
    ]
    missing_documents = [
        {
            **inspection_row(point),
            "missing_docs": [
                DOC_LABELS.get(doc, doc) for doc in missing_docs(session, point)
            ],
        }
        for point in points
        if missing_docs(session, point)
    ]
    bill_rows = list_bills(session, actor)
    all_visible_points = visible_points(session, actor)
    return {
        "clients": [{"id": row.id, "name": row.name} for row in clients.values()],
        "projects": sorted(project_rows, key=lambda row: row["code"]),
        "selected_for_dispatch": selected_for_dispatch,
        "modes": [
            {
                "id": mode,
                "title": KIND_LABELS[mode],
                "points": sum(1 for point in all_visible_points if project_index[point.equipment_id].kind == mode),
                "accepted": sum(1 for point in all_visible_points if point.status == "accepted" and project_index[point.equipment_id].kind == mode),
            }
            for mode in ("project", "case")
        ],
        "kind": kind or "all",
        "unit_managers": [
            {"id": user.id, "name": user.name}
            for user in session.scalars(select(User).where(User.role == "unit_manager").order_by(User.name)).all()
        ],
        "inspectors": inspector_rows,
        "in_forms": in_forms,
        "incomplete_inspections": incomplete,
        "not_done_inspections": not_done,
        "approved_reports": approved_reports,
        "performed_reports": performed_reports,
        "awaiting_report_review": awaiting_report_review,
        "rejected_reports": rejected_reports,
        "missing_documents": missing_documents,
        "statements": bill_rows,
    }


def unit_manager_dashboard(session: Session, actor: User) -> dict:
    if actor.role not in {"unit_manager", "admin"}:
        raise DomainError("forbidden", "این میز کار فقط برای مدیر واحد است.", 403)
    points = [point for point in visible_points(session, actor) if point.request_status == "unit_review"]
    rows = []
    for point in points:
        item = session.get(Equipment, point.equipment_id)
        order = session.get(PurchaseOrder, item.po_id)
        project = session.get(Project, order.project_id)
        buyer = session.get(Company, project.buyer_company_id)
        rows.append({
            "point_id": point.id,
            "tag": item.tag,
            "project": project.name,
            "buyer": buyer.name if buyer else "",
            "title": point.title,
            "department": point.request_department,
            "discipline": DISCIPLINE_LABELS.get(point.discipline, point.discipline),
            "request_note": point.request_note,
            "request_form_id": point.request_form_id,
        })
    return {"requests": rows}


def request_comments(session: Session, point_id: int) -> list[dict]:
    rows = session.scalars(
        select(InspectionRequestComment)
        .where(InspectionRequestComment.point_id == point_id)
        .order_by(InspectionRequestComment.created_at, InspectionRequestComment.id)
    ).all()
    users = {
        row.id: row
        for row in session.scalars(
            select(User).where(User.id.in_({comment.user_id for comment in rows}))
        ).all()
    } if rows else {}
    return [
        {
            "id": comment.id,
            "author": users[comment.user_id].name if comment.user_id in users else "کاربر",
            "body": comment.body,
            "created_at": comment.created_at.isoformat(sep=" ", timespec="seconds"),
        }
        for comment in rows
    ]


def _offer(session: Session, offer: Offer, *, include_travel: bool = False) -> dict:
    inspector = session.get(Inspector, offer.inspector_id)
    user = session.get(User, inspector.user_id)
    result = {
        "id": offer.id,
        "inspector_id": inspector.id,
        "inspector": user.name,
        "status": offer.status,
        "score": offer.score,
        "distance_km": offer.distance_km,
        "fee_irr": offer.fee_irr,
        "commission_irr": offer.commission_irr,
        "net_irr": offer.net_irr,
        "expires_at": offer.expires_at.isoformat(sep=" ", timespec="seconds"),
        "engagement": inspector.engagement or "fixed",
        "engagement_label": "بازرس ثابت" if (inspector.engagement or "fixed") == "fixed" else "بازرس ساعتی",
    }
    if include_travel:
        result["travel_irr"] = offer.travel_irr
    return result


def stage_history(session: Session, focus_point_id: int) -> list[dict]:
    """گزارش مرحله‌های قبلی همان تجهیز، با ایرادهای ثبت‌شده."""
    focus = session.get(InspectionPoint, focus_point_id)
    if focus is None:
        return []
    points = session.scalars(
        select(InspectionPoint).where(InspectionPoint.equipment_id == focus.equipment_id).order_by(InspectionPoint.seq)
    ).all()
    by_id = {point.id: point for point in points}
    visits = session.scalars(
        select(Visit).where(Visit.point_id.in_(list(by_id)), Visit.phase.in_(("submitted", "closed", "client", "confirmed"))).order_by(Visit.id)
    ).all()
    if not visits:
        return []
    visit_ids = [visit.id for visit in visits]
    answers = session.scalars(select(ChecklistAnswer).where(ChecklistAnswer.visit_id.in_(visit_ids))).all()
    failed: dict[int, list[ChecklistAnswer]] = {}
    for answer in answers:
        if answer.value == "fail":
            failed.setdefault(answer.visit_id, []).append(answer)
    inspector_ids = {visit.inspector_id for visit in visits}
    inspectors = {row.id: row for row in session.scalars(select(Inspector).where(Inspector.id.in_(inspector_ids))).all()}
    user_ids = [row.user_id for row in inspectors.values()]
    users = {row.id: row for row in session.scalars(select(User).where(User.id.in_(user_ids))).all()} if user_ids else {}
    rows = []
    for visit in visits:
        point = by_id[visit.point_id]
        labels = {item["id"]: item["text"] for item in point.checklist}
        inspector = inspectors.get(visit.inspector_id)
        user = users.get(inspector.user_id) if inspector else None
        defects = [
            {"text": labels.get(answer.item_id, answer.item_id), "note": answer.note}
            for answer in failed.get(visit.id, [])
        ]
        rows.append(
            {
                "visit_id": visit.id,
                "point_id": point.id,
                "same_point": point.id == focus.id,
                "seq": point.seq,
                "title": point.title,
                "ivr_no": visit.ivr_no or "پیش‌نویس",
                "result": visit.result,
                "note": visit.note,
                "client_rejection_note": visit.client_rejection_note,
                "inspector": user.name if user else "",
                "defects": defects,
            }
        )
    rows.sort(key=lambda row: (row["seq"], row["visit_id"]))
    return rows


def _visit_brief(session: Session, visit: Visit) -> dict:
    inspector = session.get(Inspector, visit.inspector_id)
    user = session.get(User, inspector.user_id)
    return {
        "id": visit.id,
        "phase": visit.phase,
        "result": visit.result,
        "ivr_no": visit.ivr_no,
        "inspector": user.name,
        "remote": visit.remote,
        "note": visit.note,
    }


def visit_ivr(session: Session, visit_id: int, actor: User | None = None) -> dict:
    visit = session.get(Visit, visit_id)
    detail = point_detail(session, visit.point_id, actor)
    inspector = session.get(Inspector, visit.inspector_id)
    user = session.get(User, inspector.user_id)
    answers = session.scalars(select(ChecklistAnswer).where(ChecklistAnswer.visit_id == visit.id)).all()
    photos = session.scalars(select(Evidence).where(Evidence.visit_id == visit.id)).all()
    timeline = session.scalars(
        select(AuditEvent).where(AuditEvent.entity == "visit", AuditEvent.entity_id == visit.id).order_by(AuditEvent.id)
    ).all()
    offer = session.get(Offer, visit.offer_id) if visit.offer_id else None
    return {
        "visit": {
            "id": visit.id,
            "ivr_no": visit.ivr_no or "پیش‌نویس",
            "phase": visit.phase,
            "result": visit.result,
            "note": visit.note,
            "remote": visit.remote,
            "arrive_distance_km": visit.arrive_distance_km,
            "location_confirmed": visit.arrive_lat is not None and visit.arrive_lng is not None and visit.arrived_at is not None,
            "inspector": user.name,
            "city": inspector.city,
            "certifications": inspector.certifications,
            "signature_verified": visit.phase in {"submitted", "client", "confirmed"} and visit.submitted_at is not None,
        },
        "context": detail,
        "answers": [{"item_id": row.item_id, "value": row.value, "note": row.note} for row in answers],
        "photos": [
            {
                "id": row.id,
                "kind": row.kind,
                "caption": row.caption,
                "filename": row.filename,
                "media_type": row.media_type,
                "lat": row.lat,
                "lng": row.lng,
                "url": f"/api/evidence/{row.id}/file" if row.stored_name else "",
            }
            for row in photos
        ],
        "timeline": [{"action": row.action, "detail": row.detail, "at": row.created_at.isoformat(sep=" ", timespec="seconds")} for row in timeline],
        "money": None
        if offer is None
        else {
            "fee_irr": offer.fee_irr,
            "commission_irr": offer.commission_irr,
            "net_irr": offer.net_irr,
            **(
                {"travel_irr": offer.travel_irr}
                if actor is not None and actor.role in {"inspector", "manager", "unit_manager"}
                else {}
            ),
        },
        "comments": report_comments(session, visit.id),
    }


def can_access_visit(session: Session, actor: User, visit: Visit) -> bool:
    if actor.role in {"admin", "coordinator"}:
        return True
    point = session.get(InspectionPoint, visit.point_id)
    if point is None:
        return False
    item = session.get(Equipment, point.equipment_id)
    order = session.get(PurchaseOrder, item.po_id) if item else None
    project = session.get(Project, order.project_id) if order else None
    if item is None or order is None or project is None:
        return False
    if actor.role in {"buyer", "manager"}:
        return actor.company_id == project.buyer_company_id
    if actor.role == "vendor":
        return actor.company_id == order.vendor_company_id
    if actor.role == "unit_manager":
        return point.unit_manager_id == actor.id
    if actor.role == "inspector":
        inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
        return inspector is not None and inspector.id == visit.inspector_id
    return False


def report_comments(session: Session, visit_id: int) -> list[dict]:
    rows = session.scalars(
        select(ReportComment).where(ReportComment.visit_id == visit_id).order_by(ReportComment.created_at, ReportComment.id)
    ).all()
    users = {
        row.id: row
        for row in session.scalars(select(User).where(User.id.in_({comment.user_id for comment in rows}))).all()
    } if rows else {}
    return [
        {
            "id": comment.id,
            "author": users[comment.user_id].name if comment.user_id in users else "کاربر",
            "role": users[comment.user_id].role if comment.user_id in users else "",
            "body": comment.body,
            "created_at": comment.created_at.isoformat(sep=" ", timespec="seconds"),
        }
        for comment in rows
    ]


def map_payload(session: Session) -> dict:
    equipment = session.scalars(select(Equipment)).all()
    inspectors = []
    for row in session.scalars(select(Inspector)).all():
        user = session.get(User, row.user_id)
        inspectors.append(
            {
                "id": row.id,
                "name": user.name,
                "city": row.city,
                "lat": row.lat,
                "lng": row.lng,
                "online": row.online,
                "engagement": row.engagement or "fixed",
                "engagement_label": "ثابت" if (row.engagement or "fixed") == "fixed" else "ساعتی",
                "rating": row.rating,
                "radius_km": row.radius_km,
                "disciplines": row.disciplines,
                "active_jobs": active_job_count(session, row.id),
            }
        )
    return {
        "workshops": [
            {"tag": item.tag, "name": item.workshop_name, "city": item.city, "lat": item.lat, "lng": item.lng}
            for item in equipment
        ],
        "inspectors": inspectors,
    }


def inbox(session: Session, actor: User) -> list[dict]:
    inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
    if inspector is None:
        return []
    offers = session.scalars(
        select(Offer).where(Offer.inspector_id == inspector.id, Offer.status == "pending").order_by(Offer.id.desc())
    ).all()
    rows = []
    for offer in offers:
        detail = point_detail(session, offer.point_id, actor)
        rows.append(
            {
                "offer": _offer(session, offer, include_travel=True),
                "point": detail["point"],
                "equipment": detail["equipment"],
                "companies": detail["companies"],
                "history": detail["history"],
            }
        )
    return rows


def my_visit(session: Session, actor: User) -> dict | None:
    inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
    if inspector is None:
        return None
    visit = session.scalar(
        select(Visit)
        .where(Visit.inspector_id == inspector.id, Visit.phase.in_(("assigned", "en_route", "on_site")))
        .order_by(Visit.id.desc())
    )
    if visit is None:
        return None
    return visit_ivr(session, visit.id)


def list_documents(session: Session, actor: User) -> list[dict]:
    rows = []
    equipment_ids = {point.equipment_id for point in visible_points(session, actor)}
    for doc in session.scalars(select(Document).order_by(Document.id)).all():
        if doc.equipment_id not in equipment_ids:
            continue
        item = session.get(Equipment, doc.equipment_id)
        rows.append(
            {
                "id": doc.id,
                "equipment_id": item.id,
                "tag": item.tag,
                "type": doc.doc_type,
                "label": DOC_LABELS.get(doc.doc_type, doc.doc_type),
                "filename": doc.filename,
                "download_url": f"/api/documents/{doc.id}/file" if doc.stored_name else "",
            }
        )
    return rows


def can_access_equipment(session: Session, actor: User, equipment_id: int) -> bool:
    item = session.get(Equipment, equipment_id)
    if item is None:
        return False
    order = session.get(PurchaseOrder, item.po_id)
    project = session.get(Project, order.project_id) if order else None
    if order is None or project is None:
        return False
    if actor.role in {"admin", "coordinator"}:
        return True
    if actor.role in {"buyer", "manager"}:
        return actor.company_id == project.buyer_company_id
    if actor.role == "vendor":
        return actor.company_id == order.vendor_company_id
    if actor.role == "inspector":
        inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
        if inspector is None:
            return False
        point_ids = select(InspectionPoint.id).where(InspectionPoint.equipment_id == equipment_id)
        return session.scalar(
            select(func.count(Visit.id)).where(
                Visit.point_id.in_(point_ids),
                Visit.inspector_id == inspector.id,
            )
        ) > 0
    return False


def project_archive(session: Session, actor: User) -> list[dict]:
    """Completed inspection reports grouped under their awarded project purchase orders."""
    projects = session.scalars(select(Project).where(Project.kind == "project").order_by(Project.id.desc())).all()
    orders = session.scalars(select(PurchaseOrder)).all()
    equipment = _equipment_map(session)
    points = session.scalars(select(InspectionPoint).order_by(InspectionPoint.seq)).all()
    visits = session.scalars(
        select(Visit)
        .where(Visit.result == "accept", Visit.phase.in_(("client", "confirmed")))
        .order_by(Visit.submitted_at, Visit.id)
    ).all()
    completed_by_point: dict[int, list[Visit]] = {}
    for visit in visits:
        completed_by_point.setdefault(visit.point_id, []).append(visit)

    orders_by_project: dict[int, list[PurchaseOrder]] = {}
    for order in orders:
        orders_by_project.setdefault(order.project_id, []).append(order)
    equipment_by_order: dict[int, list[Equipment]] = {}
    for item in equipment.values():
        equipment_by_order.setdefault(item.po_id, []).append(item)
    points_by_equipment: dict[int, list[InspectionPoint]] = {}
    for point in points:
        points_by_equipment.setdefault(point.equipment_id, []).append(point)

    inspectors = {
        row.id: row
        for row in session.scalars(select(Inspector)).all()
    }
    users = {row.id: row for row in session.scalars(select(User)).all()}
    companies = {row.id: row for row in session.scalars(select(Company)).all()}
    documents_by_equipment: dict[int, list[Document]] = {}
    for document in session.scalars(select(Document).order_by(Document.created_at, Document.id)).all():
        documents_by_equipment.setdefault(document.equipment_id, []).append(document)
    visit_ids = [visit.id for visit in visits]
    signatures = {
        event.entity_id: event
        for event in session.scalars(
            select(AuditEvent).where(
                AuditEvent.entity == "visit",
                AuditEvent.entity_id.in_(visit_ids),
                AuditEvent.action == "submit",
            )
        ).all()
    } if visit_ids else {}
    evidence_by_visit: dict[int, list[Evidence]] = {}
    if visit_ids:
        for evidence in session.scalars(
            select(Evidence).where(Evidence.visit_id.in_(visit_ids)).order_by(Evidence.created_at, Evidence.id)
        ).all():
            evidence_by_visit.setdefault(evidence.visit_id, []).append(evidence)

    archived = []
    for project in projects:
        project_orders = orders_by_project.get(project.id, [])
        if not project_orders:
            continue
        vendor_ids = {order.vendor_company_id for order in project_orders}
        if actor.role not in {"admin", "coordinator"}:
            if actor.role in {"buyer", "manager"} and actor.company_id == project.buyer_company_id:
                pass
            elif actor.role == "vendor" and actor.company_id in vendor_ids:
                pass
            elif actor.role == "inspector":
                own_inspector_ids = {
                    inspector.id for inspector in inspectors.values() if inspector.user_id == actor.id
                }
                if not any(
                    visit.inspector_id in own_inspector_ids
                    for order in project_orders
                    for item in equipment_by_order.get(order.id, [])
                    for point in points_by_equipment.get(item.id, [])
                    for visit in completed_by_point.get(point.id, [])
                ):
                    continue
            else:
                continue

        project_items = [
            item
            for order in project_orders
            for item in equipment_by_order.get(order.id, [])
        ]
        equipment_rows = []
        archive_visits = []
        for item in project_items:
            docs = [
                {
                    "id": document.id,
                    "type": document.doc_type,
                    "label": DOC_LABELS.get(document.doc_type, document.doc_type),
                    "title": document.title,
                    "filename": document.filename,
                    "download_url": f"/api/documents/{document.id}/file" if document.stored_name else "",
                    "uploaded_by": users.get(document.uploaded_by).name if users.get(document.uploaded_by) else "",
                    "uploaded_at": document.created_at.isoformat(sep=" ", timespec="seconds"),
                }
                for document in documents_by_equipment.get(item.id, [])
            ]
            item_points = points_by_equipment.get(item.id, [])
            completed_points = []
            for point in item_points:
                point_visits = completed_by_point.get(point.id, [])
                if not point_visits:
                    continue
                completed_reports = []
                for visit in point_visits:
                    inspector = inspectors.get(visit.inspector_id)
                    inspector_user = users.get(inspector.user_id) if inspector else None
                    signature = signatures.get(visit.id)
                    signed_by = users.get(signature.actor_id) if signature and signature.actor_id else None
                    photos = [
                        {
                            "id": photo.id,
                            "kind": photo.kind,
                            "label": {"environment": "محل بازرسی", "item": "تجهیز بازرسی", "marker": "نشانگر بازرسی"}.get(photo.kind, photo.kind),
                            "caption": photo.caption,
                            "url": f"/api/evidence/{photo.id}/file" if photo.stored_name else "",
                        }
                        for photo in evidence_by_visit.get(visit.id, [])
                    ]
                    report = {
                        "visit_id": visit.id,
                        "ivr_no": visit.ivr_no,
                        "inspector": inspector_user.name if inspector_user else "",
                        "signed_by": signed_by.name if signed_by else "",
                        "signed_at": signature.created_at.isoformat(sep=" ", timespec="seconds") if signature else "",
                        "signature_verified": bool(signature and inspector and signature.actor_id == inspector.user_id),
                        "submitted_at": visit.submitted_at.isoformat(sep=" ", timespec="seconds") if visit.submitted_at else "",
                        "client_approved": visit.phase == "confirmed",
                        "client_approved_at": visit.client_approved_at.isoformat(sep=" ", timespec="seconds") if visit.client_approved_at else "",
                        "photos": photos,
                    }
                    completed_reports.append(report)
                    archive_visits.append(report)
                completed_points.append(
                    {
                        "seq": point.seq,
                        "title": point.title,
                        "discipline": DISCIPLINE_LABELS.get(point.discipline, point.discipline),
                        "reports": completed_reports,
                    }
                )
            equipment_rows.append(
                {
                    "tag": item.tag,
                    "title": item.title,
                    "workshop": item.workshop_name,
                    "documents": docs,
                    "completed_points": completed_points,
                }
            )
        if not archive_visits:
            continue
        buyer = companies.get(project.buyer_company_id)
        vendor_names = sorted(
            {
                companies[order.vendor_company_id].name
                for order in project_orders
                if order.vendor_company_id in companies
            }
        )
        all_points = [
            point
            for order in project_orders
            for item in equipment_by_order.get(order.id, [])
            for point in points_by_equipment.get(item.id, [])
        ]
        archived.append(
            {
                "id": project.id,
                "code": project.code,
                "name": project.name,
                "buyer": buyer.name if buyer else "",
                "vendors": vendor_names,
                "purchase_orders": [order.number for order in project_orders],
                "equipment": equipment_rows,
                "completed_points": sum(len(item["completed_points"]) for item in equipment_rows),
                "total_points": len(all_points),
                "reports": len(archive_visits),
                "client_approved_reports": sum(1 for report in archive_visits if report["client_approved"]),
                "inspections": archive_visits,
            }
        )
    return archived


def list_moms(session: Session) -> list[dict]:
    rows = []
    for mom in session.scalars(select(Mom).order_by(Mom.id)).all():
        rows.append(
            {
                "id": mom.id,
                "title": mom.title,
                "body": mom.body,
                "held_on": mom.held_on,
                "attendees": mom.attendees,
            }
        )
    return rows


def manager_inbox(session: Session, actor: User) -> list[dict]:
    if actor.role not in {"manager", "coordinator", "admin"}:
        raise DomainError("forbidden", "کارتابل هماهنگ‌کننده/مدیر پروژه برای این نقش نیست.", 403)
    return _report_rows(session, actor, "submitted")


def unit_report_inbox(session: Session, actor: User) -> list[dict]:
    if actor.role not in {"unit_manager", "admin"}:
        raise DomainError("forbidden", "کارتابل گزارش مدیر واحد برای این نقش نیست.", 403)
    return _report_rows(session, actor, "unit_review")


def client_inbox(session: Session, actor: User) -> list[dict]:
    if actor.role not in {"buyer", "coordinator", "admin"}:
        raise DomainError("forbidden", "کارتابل کارفرما برای این نقش نیست.", 403)
    return _report_rows(session, actor, "client")


def _report_rows(session: Session, actor: User, phase: str) -> list[dict]:
    points = {point.id: point for point in visible_points(session, actor)}
    if actor.role in {"buyer", "unit_manager"}:
        points = {point_id: point for point_id, point in points.items() if point.request_form_id is not None}
    if not points:
        return []
    visits = session.scalars(
        select(Visit)
        .where(Visit.point_id.in_(list(points)), Visit.phase == phase)
        .order_by(Visit.submitted_at.desc(), Visit.id.desc())
    ).all()
    if not visits:
        return []
    equipment = _equipment_map(session)
    inspector_ids = {visit.inspector_id for visit in visits}
    inspectors = {row.id: row for row in session.scalars(select(Inspector).where(Inspector.id.in_(inspector_ids))).all()}
    user_ids = [row.user_id for row in inspectors.values()]
    users = {row.id: row for row in session.scalars(select(User).where(User.id.in_(user_ids))).all()}
    visit_ids = [visit.id for visit in visits]
    answers = session.scalars(select(ChecklistAnswer).where(ChecklistAnswer.visit_id.in_(visit_ids), ChecklistAnswer.value == "fail")).all()
    by_visit = {visit.id: visit for visit in visits}
    failed: dict[int, list[str]] = {}
    for answer in answers:
        point = points[by_visit[answer.visit_id].point_id]
        text = next((item["text"] for item in point.checklist if item["id"] == answer.item_id), answer.item_id)
        failed.setdefault(answer.visit_id, []).append(f"{text} — {answer.note}")
    rows = []
    for visit in visits:
        point = points[visit.point_id]
        item = equipment[point.equipment_id]
        inspector = inspectors.get(visit.inspector_id)
        user = users.get(inspector.user_id) if inspector else None
        rows.append(
            {
                "visit_id": visit.id,
                "point_id": point.id,
                "ivr_no": visit.ivr_no,
                "result": visit.result,
                "note": visit.note,
                "client_rejection_note": visit.client_rejection_note,
                "submitted_at": None if visit.submitted_at is None else visit.submitted_at.isoformat(sep=" ", timespec="seconds"),
                "tag": item.tag,
                "title": point.title,
                "inspector": user.name if user else "",
                "defects": failed.get(visit.id, []),
            }
        )
    return rows


def _clock(value) -> str:
    if value is None:
        return ""
    return f"{value:%H:%M}"


def _day(value) -> str:
    if value is None:
        return ""
    return f"{value:%Y-%m-%d}"


def _span(start, end) -> str:
    if start is None or end is None:
        return ""
    if start.date() == end.date():
        return f"{start:%H:%M} تا {end:%H:%M}"
    return f"{start:%Y-%m-%d %H:%M} تا {end:%Y-%m-%d %H:%M}"


def inspector_record(session: Session, actor: User) -> list[dict]:
    """کارنامه بازرس: فقط بازرسی‌هایی که کارفرما تأیید کرده است."""
    if actor.role != "inspector":
        raise DomainError("forbidden", "کارنامه بازرسی مخصوص بازرس است.", 403)
    inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
    if inspector is None:
        return []
    visits = session.scalars(
        select(Visit)
        .where(
            Visit.inspector_id == inspector.id,
            Visit.result == "accept",
            Visit.phase.in_(("confirmed", "closed")),
        )
        .order_by(Visit.client_approved_at.desc(), Visit.submitted_at.desc(), Visit.id.desc())
    ).all()
    if not visits:
        return []
    point_ids = [visit.point_id for visit in visits]
    points = {row.id: row for row in session.scalars(select(InspectionPoint).where(InspectionPoint.id.in_(point_ids))).all()}
    equipment = _equipment_map(session)
    orders = _order_map(session)
    projects = {row.id: row for row in session.scalars(select(Project)).all()}
    companies = {row.id: row for row in session.scalars(select(Company)).all()}
    rows = []
    for visit in visits:
        point = points.get(visit.point_id)
        if point is None:
            continue
        if visit.phase == "closed" and point.status != "accepted":
            continue
        item = equipment[point.equipment_id]
        order = orders[item.po_id]
        project = projects[order.project_id]
        vendor = companies.get(order.vendor_company_id)
        buyer = companies.get(project.buyer_company_id)
        start = visit.arrived_at or visit.created_at
        end = visit.submitted_at or visit.client_approved_at
        approved = visit.client_approved_at or visit.reviewed_at
        rows.append(
            {
                "visit_id": visit.id,
                "ivr_no": visit.ivr_no,
                "date": _day(end),
                "time": _clock(end),
                "at": None if end is None else end.isoformat(sep=" ", timespec="seconds"),
                "company": vendor.name if vendor else "",
                "client": buyer.name if buyer else "",
                "window": _span(start, end),
                "started_at": None if start is None else start.isoformat(sep=" ", timespec="seconds"),
                "ended_at": None if end is None else end.isoformat(sep=" ", timespec="seconds"),
                "approved_at": None if approved is None else approved.isoformat(sep=" ", timespec="seconds"),
                "tag": item.tag,
                "title": point.title,
                "workshop": item.workshop_name,
                "result": visit.result,
                "discipline": DISCIPLINE_LABELS.get(point.discipline, point.discipline),
            }
        )
    return rows


def company_inspections(session: Session, actor: User) -> list[dict]:
    if actor.role not in {"buyer", "admin"}:
        raise DomainError("forbidden", "این فهرست مخصوص کارفرما است.", 403)
    points = {point.id: point for point in visible_points(session, actor)}
    if not points:
        return []
    visits = session.scalars(
        select(Visit)
        .where(Visit.point_id.in_(list(points)), Visit.submitted_at.is_not(None))
        .order_by(Visit.submitted_at.desc(), Visit.id.desc())
    ).all()
    if actor.role == "buyer":
        visits = [visit for visit in visits if visit.phase == "confirmed" and points[visit.point_id].request_form_id is not None]
    equipment = _equipment_map(session)
    orders = _order_map(session)
    projects = {row.id: row for row in session.scalars(select(Project)).all()}
    inspectors = {
        row.id: row
        for row in session.scalars(select(Inspector).where(Inspector.id.in_({visit.inspector_id for visit in visits}))).all()
    } if visits else {}
    users = {
        row.id: row
        for row in session.scalars(select(User).where(User.id.in_({inspector.user_id for inspector in inspectors.values()}))).all()
    } if inspectors else {}
    rows = []
    for visit in visits:
        point = points[visit.point_id]
        item = equipment[point.equipment_id]
        project = projects[orders[item.po_id].project_id]
        inspector = inspectors.get(visit.inspector_id)
        inspector_user = users.get(inspector.user_id) if inspector else None
        rows.append({
            "visit_id": visit.id,
            "ivr_no": visit.ivr_no,
            "project": project.name,
            "tag": item.tag,
            "title": point.title,
            "inspector": inspector_user.name if inspector_user else "",
            "result": visit.result,
            "result_label": "رد" if visit.result == "reject" else "قبول",
            "client_approved": visit.client_approved_at is not None,
            "client_rejection_note": visit.client_rejection_note or "",
            "submitted_at": visit.submitted_at.isoformat(sep=" ", timespec="seconds"),
        })
    return rows


def list_bills(session: Session, actor: User) -> list[dict]:
    if actor.role not in {"buyer", "manager", "admin"}:
        raise DomainError("forbidden", "دسترسی صورت‌وضعیت برای این نقش نیست.", 403)
    ensure_confirmed_bills(session)
    bills = session.scalars(select(Bill).order_by(Bill.issued_at.desc(), Bill.id.desc())).all()
    if actor.role in {"buyer", "manager"}:
        visible_point_rows = visible_points(session, actor)
        visible = {point.id for point in visible_point_rows}
        requested_point_ids = {
            point.id for point in visible_point_rows if point.request_form_id is not None
        }
        visit_ids = [bill.visit_id for bill in bills]
        visits = {
            row.id: row
            for row in session.scalars(select(Visit).where(Visit.id.in_(visit_ids))).all()
        } if visit_ids else {}
        bills = [
            bill for bill in bills
            if visits.get(bill.visit_id)
            and visits[bill.visit_id].point_id in visible
            and (
                actor.role != "buyer"
                or (
                    visits[bill.visit_id].phase == "confirmed"
                    and visits[bill.visit_id].point_id in requested_point_ids
                )
            )
        ]
    rows = []
    for bill in bills:
        rows.append(
            {
                "id": bill.id,
                "visit_id": bill.visit_id,
                "kind": bill.kind,
                "kind_label": "مشتری پروژه‌ای" if bill.kind == "project" else "مشتری موردی",
                "statement_no": bill.statement_no,
                "invoice_no": bill.invoice_no,
                "gross_irr": bill.gross_irr,
                "performance_rate": bill.performance_rate,
                "performance_irr": bill.performance_irr,
                "insurance_rate": bill.insurance_rate,
                "insurance_irr": bill.insurance_irr,
                "tax_rate": bill.tax_rate,
                "tax_irr": bill.tax_irr,
                "vat_rate": bill.vat_rate,
                "vat_irr": bill.vat_irr,
                "net_irr": bill.net_irr,
                "client": bill.client_name,
                "company": bill.company_name,
                "tag": bill.tag,
                "title": bill.title,
                "ivr_no": bill.ivr_no,
                "basis": bill.basis,
                "issued_at": bill.issued_at.isoformat(sep=" ", timespec="seconds"),
                "accounting_status": bill.accounting_status or "issued",
                "accounting_note": bill.accounting_note or "",
                "accounting_updated_at": None if bill.accounting_updated_at is None else bill.accounting_updated_at.isoformat(sep=" ", timespec="seconds"),
                "claim_status": bill.claim_status or "unpaid",
                "claim_note": bill.claim_note or "",
                "claim_updated_at": None if bill.claim_updated_at is None else bill.claim_updated_at.isoformat(sep=" ", timespec="seconds"),
            }
        )
    return rows


def list_notifications(session: Session, actor: User) -> list[dict]:
    rows = session.scalars(
        select(Notification).where(Notification.user_id == actor.id).order_by(Notification.id.desc()).limit(20)
    ).all()
    notifications = []
    for row in rows:
        target = None
        if row.title == "گزارش تأییدشده در کارتابل نشست":
            ivr_no = row.body.split(" — ", 1)[0].strip()
            visit = session.scalar(select(Visit).where(Visit.ivr_no == ivr_no)) if ivr_no else None
            if visit is not None and can_access_visit(session, actor, visit):
                target = {"type": "ivr", "id": visit.id}
        notifications.append(
            {"id": row.id, "title": row.title, "body": row.body, "read": row.read, "target": target}
        )
    return notifications


def inspectors_public(session: Session) -> list[dict]:
    payload = map_payload(session)["inspectors"]
    for row in payload:
        row["discipline_labels"] = [DISCIPLINE_LABELS.get(item, item) for item in row["disciplines"]]
    return payload


def ledger_summary(session: Session, actor: User) -> dict:
    inspector = session.scalar(select(Inspector).where(Inspector.user_id == actor.id))
    query = select(Ledger)
    if inspector and actor.role == "inspector":
        query = query.where(Ledger.inspector_id == inspector.id)
    rows = session.scalars(query).all()
    return {
        "count": len(rows),
        "fee_irr": sum(row.fee_irr for row in rows),
        "commission_irr": sum(row.commission_irr for row in rows),
        "net_irr": sum(row.net_irr for row in rows),
    }


def dump_user(user: User, session: Session) -> dict:
    company = session.get(Company, user.company_id) if user.company_id else None
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "company": None if company is None else company.name,
    }

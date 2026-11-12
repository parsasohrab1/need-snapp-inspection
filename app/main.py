from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import __version__
from app.db import get_engine, init_db, open_session
from app.domain.errors import DomainError
from app.models import Document, Evidence, InspectionPoint, InspectionRequestApproval, Mom, Project, User, Visit
from app.services import forms as form_sheets
from app.schemas import (
    AccountingStatusIn,
    ClaimStatusIn,
    ClientRejectIn,
    ApprovalNoteIn,
    ArriveIn,
    ChecklistIn,
    DocumentIn,
    EvidenceIn,
    ForceIn,
    LoginIn,
    LocationIn,
    InspectionRequestIn,
    FormIn,
    MomIn,
    ReadyIn,
    ReviewIn,
    SubmitIn,
    VisitInReportFormIn,
    ReportCommentIn,
    RequestCommentIn,
    RequestReturnIn,
)
from app.security import make_token, read_token, verify_password
from app.content.benchmark import benchmark_payload
from app.content.technology import technology_payload
from app.seed import ensure_case_demo, ensure_engagement, ensure_project_manager, seed_demo
from app.services import engine
from app.services.files import (
    MAX_DOCUMENT_BYTES,
    MAX_REQUEST_SIGNATURE_BYTES,
    document_media_type,
    document_path,
    photo_path,
    request_signature_path,
    sniff_image,
    store_request_signature,
    store_evidence_attachment,
    store_document,
    store_photo,
)
from app.services import read as views

STATIC = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    db = open_session()
    try:
        if not db.scalar(select(func.count()).select_from(User)):
            seed_demo(db)
        else:
            ensure_case_demo(db)
            ensure_project_manager(db)
            ensure_engagement(db)
        db.commit()
    finally:
        db.close()
    yield


app = FastAPI(title="اسنپ‌بازرس", version=__version__, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def db_session(request: Request, call_next):
    db = open_session()
    request.state.db = db
    try:
        response = await call_next(request)
        if response.status_code >= 400:
            db.rollback()
        else:
            db.commit()
        return response
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def db_of(request: Request) -> Session:
    return request.state.db


def current_user(request: Request, db: Session = Depends(db_of)) -> User:
    user_id = read_token(request.cookies.get("session"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="وارد شوید")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="وارد شوید")
    return user


@app.exception_handler(DomainError)
async def domain_error(_request: Request, exc: DomainError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": str(exc)})


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health():
    get_engine()
    return {"status": "ok", "version": __version__, "trl": 5}


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(db_of)):
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="نام کاربری یا گذرواژه نادرست است")
    response = JSONResponse(views.dump_user(user, db))
    response.set_cookie("session", make_token(user.id), httponly=True, samesite="lax")
    return response


@app.post("/api/auth/logout")
def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("session")
    return response


@app.get("/api/me")
def me(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.dump_user(actor, db)


def _kind(kind: str | None) -> str | None:
    if kind is None:
        return None
    if kind not in {"project", "case"}:
        raise HTTPException(status_code=400, detail="نوع بازرسی نامعتبر است")
    return kind


@app.get("/api/dashboard")
def dashboard(kind: str | None = None, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.dashboard(db, actor, _kind(kind))


@app.get("/api/manager/desk")
def manager_dashboard(kind: str | None = None, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.manager_dashboard(db, actor, _kind(kind))


@app.get("/api/unit-manager/desk")
def unit_manager_dashboard(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.unit_manager_dashboard(db, actor)


@app.get("/api/unit-managers")
def unit_managers(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    if actor.role not in {"manager", "executive_manager", "admin"}:
        raise DomainError("forbidden", "فقط مدیران می‌توانند مدیر واحد را انتخاب کنند.", 403)
    return [{"id": user.id, "name": user.name} for user in db.scalars(select(User).where(User.role == "unit_manager").order_by(User.name)).all()]


@app.get("/api/board")
def board(kind: str | None = None, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.board(db, actor, _kind(kind))


@app.get("/api/points/{point_id}")
def point_detail(point_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    point = db.get(InspectionPoint, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="پیدا نشد")
    if point not in views.visible_points(db, actor):
        raise HTTPException(status_code=403, detail="به این بازرسی دسترسی ندارید")
    detail = views.point_detail(db, point_id, actor)
    if actor.role in {"buyer", "vendor"}:
        detail["selection"] = {}
        detail["offers"] = []
    return detail


@app.get("/api/request-approvals/{approval_id}/signature")
def request_approval_signature(
    approval_id: int,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    approval = db.get(InspectionRequestApproval, approval_id)
    if approval is None or not approval.signature_stored_name:
        raise HTTPException(status_code=404, detail="تصویر مهر و امضا پیدا نشد")
    point = db.get(InspectionPoint, approval.point_id)
    if point is None or point not in views.visible_points(db, actor):
        raise HTTPException(status_code=403, detail="به این مهر و امضا دسترسی ندارید")
    path = request_signature_path(approval.signature_stored_name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="تصویر مهر و امضا پیدا نشد")
    return FileResponse(path, media_type=document_media_type(approval.signature_filename))


@app.post("/api/points/{point_id}/ready")
def ready(point_id: int, body: ReadyIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.mark_ready(db, point_id, actor, remote_requested=body.remote_requested, window_note=body.window_note)
    return views.point_detail(db, point_id)


@app.post("/api/points/{point_id}/request")
def request_inspection(
    point_id: int,
    body: InspectionRequestIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    in_payload = dict(body.in_payload)
    if not str(in_payload.get("number", "")).strip():
        in_payload["number"] = f"IN-{point_id}-{engine.utcnow():%Y%m%d%H%M%S}"
    if not str(in_payload.get("date", "")).strip():
        in_payload["date"] = engine.utcnow().strftime("%Y-%m-%d")
    detail = views.point_detail(db, point_id, actor)
    in_defaults = {
        "customer_location": "iran",
        "client": detail["companies"]["buyer"],
        "project": detail["project"]["name"],
        "po": detail["order"]["number"],
        "contractor": detail["companies"]["vendor"],
        "vendor": detail["companies"]["vendor"],
        "manufacturer": detail["companies"]["vendor"],
        "location": f"{detail['equipment']['workshop_name']}، {detail['equipment']['city']}",
        "tag": detail["equipment"]["tag"],
        "itp_item": str(detail["point"]["seq"]),
        "discipline": detail["point"]["discipline_label"],
        "reference": detail["point"]["standard_ref"],
        "scope": detail["point"]["title"],
        "category": "درخواست بازرسی",
    }
    for key, value in in_defaults.items():
        if not str(in_payload.get(key, "")).strip():
            in_payload[key] = value
    form_sheet = form_sheets.save_sheet(db, actor, "in", in_payload, None)
    point = engine.request_inspection(
        db,
        point_id,
        actor,
        remote_requested=body.remote_requested,
        note=body.note,
        form_sheet_id=form_sheet.id,
    )
    return {"request_status": point.request_status, "message": point.request_note, "form_id": form_sheet.id}


@app.post("/api/points/{point_id}/manager-approval")
async def manager_approval(
    point_id: int,
    unit_manager_id: int = Form(...),
    department: str = Form(...),
    note: str = Form(""),
    file: UploadFile = File(...),
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="نام فایل مهر و امضا معتبر نیست")
    raw = await file.read(MAX_REQUEST_SIGNATURE_BYTES + 1)
    stored_name = store_request_signature(raw, filename)
    try:
        point = engine.approve_inspection_as_manager(
            db,
            point_id,
            actor,
            unit_manager_id=unit_manager_id,
            department=department,
            signature_stored_name=stored_name,
            signature_filename=filename,
            note=note,
        )
    except DomainError:
        request_signature_path(stored_name).unlink(missing_ok=True)
        raise
    if point.request_status != "unit_review":
        request_signature_path(stored_name).unlink(missing_ok=True)
    return {"request_status": point.request_status, "message": point.request_note}


@app.post("/api/points/{point_id}/unit-approval")
async def unit_approval(
    point_id: int,
    note: str = Form(""),
    file: UploadFile = File(...),
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="نام فایل مهر و امضا معتبر نیست")
    raw = await file.read(MAX_REQUEST_SIGNATURE_BYTES + 1)
    stored_name = store_request_signature(raw, filename)
    try:
        point, offers = engine.approve_inspection_as_unit_manager(
            db,
            point_id,
            actor,
            signature_stored_name=stored_name,
            signature_filename=filename,
            note=note,
        )
    except DomainError:
        request_signature_path(stored_name).unlink(missing_ok=True)
        raise
    if point.request_status not in {"inspection_queue", "approved_no_inspector"}:
        request_signature_path(stored_name).unlink(missing_ok=True)
    return {"request_status": point.request_status, "message": point.request_note, "offers": len(offers)}


@app.post("/api/points/{point_id}/return")
def return_inspection_request(
    point_id: int,
    body: RequestReturnIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    point = engine.return_inspection_request(db, point_id, actor, body.reason)
    return {"request_status": point.request_status, "message": point.request_note}


@app.post("/api/points/{point_id}/request-comments")
def request_comment(
    point_id: int,
    body: RequestCommentIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    comment = engine.add_inspection_request_comment(db, point_id, actor, body.body)
    return {"id": comment.id, "author": actor.name, "body": comment.body}


@app.post("/api/points/{point_id}/executive-approval")
def executive_approval(
    point_id: int,
    body: ApprovalNoteIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    point, offers = engine.approve_inspection_as_executive(db, point_id, actor, body.note)
    return {
        "request_status": point.request_status,
        "message": point.request_note,
        "offers": len(offers),
    }


@app.post("/api/points/{point_id}/broadcast")
def broadcast(point_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.broadcast(db, point_id, actor)
    return views.point_detail(db, point_id)


@app.post("/api/points/{point_id}/force")
def force(point_id: int, body: ForceIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.force_assign(db, point_id, body.inspector_id, actor, body.reason)
    return views.point_detail(db, point_id)


@app.get("/api/offers/inbox")
def inbox(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.inbox(db, actor)


@app.post("/api/offers/{offer_id}/accept")
def accept(offer_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    visit = engine.accept_offer(db, offer_id, actor)
    return {"visit_id": visit.id}


@app.post("/api/offers/{offer_id}/decline")
def decline(offer_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.decline_offer(db, offer_id, actor)
    return {"ok": True}


@app.post("/api/dispatch/tick")
def tick(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return {"expired": engine.expire_offers(db)}


@app.get("/api/visits/active")
def active_visit(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.my_visit(db, actor)


@app.post("/api/visits/{visit_id}/en-route")
def en_route(visit_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.mark_en_route(db, visit_id, actor)
    return views.visit_ivr(db, visit_id, actor)


@app.post("/api/visits/{visit_id}/arrive")
def arrive(visit_id: int, body: ArriveIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.mark_arrived(db, visit_id, actor, body.lat, body.lng)
    return views.visit_ivr(db, visit_id)


@app.post("/api/visits/{visit_id}/remote")
def remote(visit_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.start_remote(db, visit_id, actor)
    return views.visit_ivr(db, visit_id)


@app.post("/api/visits/{visit_id}/location")
def confirm_location(visit_id: int, body: LocationIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.confirm_remote_location(db, visit_id, actor, body.lat, body.lng)
    return views.visit_ivr(db, visit_id)


@app.post("/api/visits/{visit_id}/checklist")
def checklist(visit_id: int, body: ChecklistIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.save_checklist(db, visit_id, actor, [item.model_dump() for item in body.answers])
    return views.visit_ivr(db, visit_id)


@app.post("/api/visits/{visit_id}/evidence")
def evidence(visit_id: int, body: EvidenceIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.add_evidence(db, visit_id, actor, body.caption, body.lat, body.lng, kind=body.kind)
    return {"ok": True}


@app.post("/api/visits/{visit_id}/photo")
async def upload_photo(
    visit_id: int,
    kind: str = Form(...),
    caption: str = Form(""),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    file: UploadFile = File(...),
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    raw = await file.read()
    row = engine.add_evidence(db, visit_id, actor, caption, lat, lng, kind=kind)
    row.stored_name = store_photo(raw)
    row.filename = Path(file.filename or "evidence.jpg").name
    row.media_type = file.content_type or document_media_type(row.filename)
    return {"id": row.id, "kind": row.kind}


@app.post("/api/visits/{visit_id}/attachments")
async def upload_visit_attachment(
    visit_id: int,
    kind: str = Form("item"),
    caption: str = Form(""),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    file: UploadFile = File(...),
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="نام فایل معتبر نیست")
    max_bytes = MAX_REQUEST_SIGNATURE_BYTES if kind == "inspector_signature" else MAX_DOCUMENT_BYTES
    raw = await file.read(max_bytes + 1)
    if kind == "inspector_signature":
        image_suffix = sniff_image(raw)
        suffix = Path(filename).suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".webp"} or (image_suffix != suffix and not (image_suffix == ".jpg" and suffix == ".jpeg")):
            raise HTTPException(status_code=400, detail="مهر و امضای بازرس باید تصویر JPEG، PNG یا WebP باشد")
    row = engine.add_evidence(db, visit_id, actor, caption, lat, lng, kind=kind)
    row.stored_name, row.media_type = store_evidence_attachment(raw, filename)
    row.filename = filename
    return {"id": row.id, "filename": row.filename, "media_type": row.media_type}


@app.get("/api/evidence/{evidence_id}/file")
def evidence_file(evidence_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    row = db.get(Evidence, evidence_id)
    if row is None or not row.stored_name:
        raise HTTPException(status_code=404, detail="عکس پیدا نشد")
    visit = db.get(Visit, row.visit_id)
    if visit is None or not views.can_access_visit(db, actor, visit):
        raise HTTPException(status_code=403, detail="به این پیوست دسترسی ندارید")
    path = photo_path(row.stored_name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="عکس پیدا نشد")
    filename = row.filename or path.name
    return FileResponse(path, filename=filename, media_type=row.media_type or document_media_type(filename))


@app.post("/api/visits/{visit_id}/submit")
def submit(visit_id: int, body: SubmitIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.submit_visit(db, visit_id, actor, body.result, body.note)
    return views.visit_ivr(db, visit_id, actor)


@app.get("/api/visits/{visit_id}/in-report-form")
def visit_in_report_form(visit_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    visit = db.get(Visit, visit_id)
    if visit is None or not views.can_access_visit(db, actor, visit):
        raise HTTPException(status_code=403, detail="به فرم گزارش این بازدید دسترسی ندارید")
    return form_sheets.visit_report_form(db, actor, visit_id)


@app.put("/api/visits/{visit_id}/in-report-form")
def save_visit_in_report_form(
    visit_id: int,
    body: VisitInReportFormIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    form_sheets.save_visit_report_form(db, actor, visit_id, body.payload)
    return form_sheets.visit_report_form(db, actor, visit_id)


@app.post("/api/visits/{visit_id}/review")
def review(visit_id: int, body: ReviewIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.review_visit(db, visit_id, actor, body.decision, body.note)
    return views.visit_ivr(db, visit_id, actor)


@app.post("/api/visits/{visit_id}/confirm")
def confirm(visit_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    engine.confirm_by_client(db, visit_id, actor)
    return views.visit_ivr(db, visit_id, actor)


@app.post("/api/visits/{visit_id}/client-reject")
def client_reject(
    visit_id: int,
    body: ClientRejectIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    visit = engine.reject_by_client(db, visit_id, actor, body.reason)
    return {"id": visit.id, "phase": visit.phase, "reason": visit.client_rejection_note}


@app.get("/api/visits/{visit_id}/ivr")
def ivr(visit_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    visit = db.get(Visit, visit_id)
    if visit is None:
        raise HTTPException(status_code=404, detail="پیدا نشد")
    if not views.can_access_visit(db, actor, visit):
        raise HTTPException(status_code=403, detail="به این گزارش دسترسی ندارید")
    return views.visit_ivr(db, visit_id, actor)


@app.post("/api/visits/{visit_id}/comments")
def report_comment(
    visit_id: int,
    body: ReportCommentIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    comment = engine.add_report_comment(db, visit_id, actor, body.body)
    return {
        "id": comment.id,
        "author": actor.name,
        "role": actor.role,
        "body": comment.body,
        "created_at": comment.created_at.isoformat(sep=" ", timespec="seconds"),
    }


@app.get("/api/map")
def map_data(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    if actor.role not in {"manager", "executive_manager", "coordinator", "admin"}:
        raise DomainError("forbidden", "دسترسی نقشه بازرسان برای این نقش فعال نیست.", 403)
    return views.map_payload(db)


@app.get("/api/inspectors")
def inspectors(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    if actor.role not in {"manager", "executive_manager", "coordinator", "admin"}:
        raise DomainError("forbidden", "فهرست بازرسان برای این نقش فعال نیست.", 403)
    return views.inspectors_public(db)


@app.get("/api/documents")
def documents(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.list_documents(db, actor)


@app.post("/api/documents/upload")
async def upload_document(
    equipment_id: int = Form(...),
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="نام فایل معتبر نیست")
    row = engine.add_document(
        db,
        equipment_id=equipment_id,
        doc_type=doc_type,
        title=filename,
        filename=filename,
        actor=actor,
    )
    row.stored_name = store_document(await file.read(MAX_DOCUMENT_BYTES + 1), filename)
    return {"id": row.id, "filename": row.filename}


@app.get("/api/documents/{document_id}/file")
def document_file(document_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    document = db.get(Document, document_id)
    if document is None or not document.stored_name:
        raise HTTPException(status_code=404, detail="فایل سند پیدا نشد")
    if not views.can_access_equipment(db, actor, document.equipment_id):
        raise HTTPException(status_code=403, detail="به این سند دسترسی ندارید")
    path = document_path(document.stored_name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="فایل سند پیدا نشد")
    return FileResponse(path, filename=document.filename, media_type=document_media_type(document.filename))


@app.post("/api/documents")
def add_document(body: DocumentIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    row = engine.add_document(
        db,
        equipment_id=body.equipment_id,
        doc_type=body.doc_type,
        title=body.title,
        filename=body.filename,
        actor=actor,
    )
    return {"id": row.id}


@app.get("/api/archive/projects")
def project_archive(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.project_archive(db, actor)


@app.get("/api/forms/template/{kind}")
def form_template(kind: str, actor: User = Depends(current_user)):
    return form_sheets.blank_template(kind, actor)


@app.get("/api/forms")
def form_list(kind: str | None = None, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return form_sheets.list_sheets(db, actor, kind)


@app.get("/api/forms/{sheet_id}")
def form_one(sheet_id: int, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return form_sheets.get_sheet(db, actor, sheet_id)


@app.post("/api/forms")
def form_save(body: FormIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    sheet = form_sheets.save_sheet(db, actor, body.kind, body.payload, body.sheet_id)
    return {"id": sheet.id}


@app.get("/api/moms")
def moms(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.list_moms(db)


@app.post("/api/moms")
def add_mom(body: MomIn, actor: User = Depends(current_user), db: Session = Depends(db_of)):
    if actor.role not in {"coordinator", "admin", "buyer"}:
        raise HTTPException(status_code=403, detail="مجاز نیست")
    project = db.scalar(select(Project).order_by(Project.id))
    row = Mom(
        project_id=project.id,
        title=body.title,
        body=body.body,
        held_on=body.held_on,
        attendees=body.attendees,
        created_by=actor.id,
    )
    db.add(row)
    db.flush()
    return {"id": row.id}


@app.get("/api/reports/inbox")
def report_inbox(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.manager_inbox(db, actor)


@app.get("/api/reports/client")
def client_reports(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.client_inbox(db, actor)


@app.get("/api/inspector/record")
def inspector_record(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.inspector_record(db, actor)


@app.get("/api/company/inspections")
def company_inspection_record(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.company_inspections(db, actor)


@app.get("/api/bills")
def bills(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.list_bills(db, actor)


@app.post("/api/bills/{bill_id}/accounting-status")
def update_bill_status(
    bill_id: int,
    body: AccountingStatusIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    bill = engine.update_bill_accounting_status(db, bill_id, actor, body.status, body.note)
    return {"id": bill.id, "accounting_status": bill.accounting_status, "accounting_note": bill.accounting_note}


@app.post("/api/bills/{bill_id}/claim-status")
def claim_status(
    bill_id: int,
    body: ClaimStatusIn,
    actor: User = Depends(current_user),
    db: Session = Depends(db_of),
):
    bill = engine.update_claim_status(db, bill_id, actor, body.status, body.note)
    return {"id": bill.id, "claim_status": bill.claim_status, "claim_note": bill.claim_note}


@app.get("/api/notifications")
def notifications(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.list_notifications(db, actor)


@app.get("/api/ledger")
def ledger(actor: User = Depends(current_user), db: Session = Depends(db_of)):
    return views.ledger_summary(db, actor)


@app.get("/api/benchmark")
def benchmark(actor: User = Depends(current_user)):
    if actor.role not in {"manager", "executive_manager", "coordinator", "admin"}:
        raise DomainError("forbidden", "بنچ‌مارک برای این نقش فعال نیست.", 403)
    return benchmark_payload()


@app.get("/api/technology")
def technology(actor: User = Depends(current_user)):
    if actor.role not in {"manager", "executive_manager", "coordinator", "admin"}:
        raise DomainError("forbidden", "این بخش برای این نقش فعال نیست.", 403)
    return technology_payload()

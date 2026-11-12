"""دنیای نمایشی طرح فلامینگو. گذرواژه همه حساب‌ها demo1234 است."""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.catalog import EQUIPMENT_CLASSES
from app.domain.errors import DomainError
from app.models import Company, Equipment, InspectionPoint, Inspector, Mom, Project, PurchaseOrder, User
from app.security import hash_password
from app.services.engine import (
    accept_offer,
    add_site_photos,
    broadcast,
    confirm_by_client,
    confirm_remote_location,
    force_assign,
    mark_arrived,
    mark_en_route,
    mark_ready,
    review_visit,
    save_checklist,
    start_remote,
    submit_visit,
    add_document,
)

PASSWORD = "demo1234"
HOURLY_INSPECTORS = {"inspector.kaveh", "inspector.payam", "inspector.nima"}

INSPECTORS = [
    ("inspector.reza", "رضا نعمتی", "کرج", 35.762, 50.972, 50, True, 4.8, ["welding", "material"], ["AWS CWI"]),
    ("inspector.maryam", "مریم کاویانی", "کرج", 35.791, 50.995, 45, True, 4.7, ["ndt"], ["ASNT RT II", "UT II"]),
    ("inspector.hossein", "حسین مرادی", "تهران", 35.744, 51.176, 70, True, 4.6, ["mechanical", "hydrotest"], ["ابعادی"]),
    ("inspector.sara", "سارا احمدی", "تهران", 35.721, 51.248, 80, True, 4.5, ["coating"], ["NACE CIP"]),
    ("inspector.kaveh", "کاوه شریفی", "گرمدره", 35.786, 51.046, 60, True, 4.4, ["welding"], ["ISO 9606"]),
    ("inspector.elham", "الهام رضایی", "کرج", 35.748, 50.941, 40, True, 4.9, ["documentation"], ["بازرس مدارک"]),
    ("inspector.payam", "پیام جعفری", "فردیس", 35.768, 51.012, 40, False, 4.3, ["ndt"], ["MT II"]),
    ("inspector.nima", "نیما حسینی", "قزوین", 36.268, 50.004, 35, True, 4.2, ["mechanical", "hydrotest"], ["هیدروتست"]),
]

EQUIPMENT = [
    ("V-101", "vessel", "مخزن تحت فشار خوراک"),
    ("E-201", "exchanger", "مبدل حرارتی خنک‌کننده"),
    ("SP-310", "piping", "اسپول خط انتقال"),
    ("SK-401", "skid", "شاسی پکیج تزریق"),
]

DOC_TYPES = (
    "drawing",
    "mtc",
    "wps",
    "pqr",
    "ndt_procedure",
    "test_procedure",
    "coating_spec",
    "packing_list",
    "purchase_order",
    "origin_certificate",
    "model_3d",
)


def _user(session: Session, username: str) -> User:
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        raise RuntimeError(username)
    return user


def _inspector_user(session: Session, inspector_id: int) -> User:
    inspector = session.get(Inspector, inspector_id)
    return session.get(User, inspector.user_id)


def _finish_pass(session, point, visit, user: User) -> None:
    save_checklist(
        session,
        visit.id,
        user,
        [{"item_id": item["id"], "value": "pass", "note": ""} for item in point.checklist],
    )
    if point.point_type in {"H", "W"} and not visit.remote:
        add_site_photos(session, visit.id, user, visit.arrive_lat, visit.arrive_lng)
    note = "بازبینی مدارک از راه دور انجام شد و ردیابی پرونده برقرار است." if visit.remote else "بازدید حضوری مطابق ITP ثبت شد."
    submit_visit(
        session,
        visit.id,
        user,
        "accept",
        note,
        require_signature=False,
        require_in_report=False,
    )


def _open_visit(session, point, coordinator, vendor, *, remote: bool) -> tuple[InspectionPoint, object, User]:
    mark_ready(session, point.id, vendor, remote_requested=remote, window_note="پنجره ساخت همین هفته")
    offers = broadcast(session, point.id, coordinator)
    if not offers:
        raise DomainError("no_inspector", point.title)
    user = _inspector_user(session, offers[0].inspector_id)
    visit = accept_offer(session, offers[0].id, user)
    if remote:
        start_remote(session, visit.id, user)
        equipment = session.get(Equipment, point.equipment_id)
        confirm_remote_location(session, visit.id, user, equipment.lat, equipment.lng)
    else:
        mark_en_route(session, visit.id, user)
        equipment = session.get(Equipment, point.equipment_id)
        mark_arrived(session, visit.id, user, equipment.lat, equipment.lng)
    return point, visit, user


def seed_demo(session: Session) -> None:
    buyer = Company(name="کارفرمای طرح فلامینگو", kind="buyer")
    vendor_co = Company(name="ماشین‌سازی البرز", kind="vendor")
    session.add_all([buyer, vendor_co])
    session.flush()

    users = [
        User(username="admin", name="مدیر سامانه", role="admin", phone="02100000000", password_hash=hash_password(PASSWORD)),
        User(username="coordinator", name="هماهنگ‌کننده اعزام", role="coordinator", phone="02100000001", password_hash=hash_password(PASSWORD)),
        User(username="buyer", name="نماینده کارفرما", role="buyer", phone="02100000002", password_hash=hash_password(PASSWORD), company_id=buyer.id),
        User(username="manager", name="مدیر پروژه", role="manager", phone="02100000004", password_hash=hash_password(PASSWORD), company_id=buyer.id),
        User(username="unit.manager", name="مدیر واحد بازرسی", role="unit_manager", phone="02100000006", password_hash=hash_password(PASSWORD)),
        User(username="executive", name="مدیر اجرایی", role="executive_manager", phone="02100000005", password_hash=hash_password(PASSWORD)),
        User(username="vendor", name="نماینده سازنده", role="vendor", phone="02600000003", password_hash=hash_password(PASSWORD), company_id=vendor_co.id),
    ]
    for spec in INSPECTORS:
        username, name, *_rest = spec
        users.append(
            User(username=username, name=name, role="inspector", phone="09120000000", password_hash=hash_password(PASSWORD))
        )
    session.add_all(users)
    session.flush()

    for spec in INSPECTORS:
        username, _name, city, lat, lng, radius, online, rating, disciplines, certs = spec
        user = _user(session, username)
        session.add(
            Inspector(
                user_id=user.id,
                city=city,
                lat=lat,
                lng=lng,
                radius_km=radius,
                online=online,
                rating=rating,
                max_parallel=2,
                disciplines_json=json.dumps(disciplines, ensure_ascii=False),
                certifications_json=json.dumps(certs, ensure_ascii=False),
                engagement="hourly" if username in HOURLY_INSPECTORS else "fixed",
            )
        )
    session.flush()

    project = Project(
        code="FLM-1405",
        kind="project",
        name="طرح فلامینگو — بازرسی خرید تجهیزات ثابت",
        buyer_company_id=buyer.id,
        description="بازرسی پروژه‌ای: اعزام بازرس شخص ثالث به کارگاه ساخت، روی ITP، با گزارش IVR و صورتجلسه.",
    )
    session.add(project)
    session.flush()
    order = PurchaseOrder(
        project_id=project.id,
        vendor_company_id=vendor_co.id,
        number="PO-FLM-014",
        title="ساخت مخزن، مبدل، اسپول و شاسی",
    )
    session.add(order)
    session.flush()

    workshop = ("کارگاه ماشین‌سازی البرز، سیمین‌دشت", "کرج", 35.755, 50.958)
    for tag, clazz, title in EQUIPMENT:
        class_title, standard, _templates = EQUIPMENT_CLASSES[clazz]
        session.add(
            Equipment(
                po_id=order.id,
                tag=tag,
                title=f"{title} ({class_title})",
                clazz=clazz,
                standard=standard,
                workshop_name=workshop[0],
                city=workshop[1],
                lat=workshop[2],
                lng=workshop[3],
            )
        )
    session.flush()
    equipment_rows = session.scalars(select(Equipment).order_by(Equipment.id)).all()
    vendor = _user(session, "vendor")
    for item in equipment_rows:
        for doc_type in DOC_TYPES:
            if item.tag == "SK-401" and doc_type == "coating_spec":
                continue
            add_document(
                session,
                equipment_id=item.id,
                doc_type=doc_type,
                title=doc_type,
                filename=f"{item.tag}-{doc_type}.pdf",
                actor=vendor,
            )
        _title, _standard, templates = EQUIPMENT_CLASSES[item.clazz]
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
                        [{"id": check.id, "text": check.text, "mandatory": check.mandatory} for check in template.checklist],
                        ensure_ascii=False,
                    ),
                )
            )
    session.flush()

    coordinator = _user(session, "coordinator")
    points = session.scalars(select(InspectionPoint).order_by(InspectionPoint.id)).all()
    groups: dict[str, list[InspectionPoint]] = {}
    for point in points:
        groups.setdefault(point.discipline, []).append(point)

    def take(discipline: str, count: int) -> list[InspectionPoint]:
        found = groups[discipline][:count]
        groups[discipline] = groups[discipline][count:]
        return found

    accepted = (
        take("welding", 4)
        + take("ndt", 3)
        + take("material", 2)
        + take("mechanical", 2)
        + take("hydrotest", 2)
        + take("coating", 1)
        + take("documentation", 1)
    )
    ncr_point = take("welding", 1)[0]
    submitted = take("ndt", 1)[0]
    en_route = take("mechanical", 1)[0]
    offering = take("welding", 1)[0]
    ready_points = take("material", 1) + take("welding", 1) + take("ndt", 1) + take("coating", 1) + take("hydrotest", 1)

    manager = _user(session, "manager")
    unit_manager = _user(session, "unit.manager")
    buyer_user = _user(session, "buyer")
    for point in accepted:
        point.unit_manager_id = unit_manager.id
        remote = point.discipline == "documentation" and point.remote_allowed
        _point, visit, user = _open_visit(session, point, coordinator, vendor, remote=remote)
        _finish_pass(session, point, visit, user)
        review_visit(session, visit.id, unit_manager, "approve")
        review_visit(session, visit.id, manager, "approve")
        confirm_by_client(session, visit.id, buyer_user)

    ncr_point.unit_manager_id = unit_manager.id
    _point, visit, user = _open_visit(session, ncr_point, coordinator, vendor, remote=False)
    answers = []
    for index, item in enumerate(ncr_point.checklist):
        if index == 0:
            answers.append({"item_id": item["id"], "value": "fail", "note": "بریدگی لبه جوش خارج از حد پذیرش است"})
        else:
            answers.append({"item_id": item["id"], "value": "pass", "note": ""})
    save_checklist(session, visit.id, user, answers)
    add_site_photos(session, visit.id, user, visit.arrive_lat, visit.arrive_lng)
    submit_visit(
        session,
        visit.id,
        user,
        "reject",
        "عدم انطباق جوش؛ تعمیر و بازرسی مجدد لازم است.",
        require_signature=False,
        require_in_report=False,
    )

    submitted.unit_manager_id = unit_manager.id
    _point, visit, user = _open_visit(session, submitted, coordinator, vendor, remote=False)
    _finish_pass(session, submitted, visit, user)
    review_visit(session, visit.id, unit_manager, "approve")

    unit_review_point = ready_points.pop(0)
    unit_review_point.unit_manager_id = unit_manager.id
    _point, unit_review_visit, unit_review_inspector = _open_visit(
        session, unit_review_point, coordinator, vendor, remote=False
    )
    _finish_pass(session, unit_review_point, unit_review_visit, unit_review_inspector)

    hossein = session.scalar(select(User).where(User.username == "inspector.hossein"))
    hossein_inspector = session.scalar(select(Inspector).where(Inspector.user_id == hossein.id))
    visit = force_assign(
        session,
        en_route.id,
        hossein_inspector.id,
        coordinator,
        "ارجاع نمایشی برای بازدید ابعادی در مسیر",
    )
    mark_en_route(session, visit.id, hossein)

    mark_ready(session, offering.id, vendor, window_note="آماده بازدید جوش")
    broadcast(session, offering.id, coordinator)
    for point in ready_points:
        if point.discipline == "coating" and point.equipment_id == next(item.id for item in equipment_rows if item.tag == "SK-401"):
            continue
        mark_ready(session, point.id, vendor, window_note="اعلام آمادگی سازنده")

    session.add(
        Mom(
            project_id=project.id,
            title="جلسه هماهنگی قبل از ساخت",
            held_on="1405-08-12",
            attendees="کارفرما، سازنده، هماهنگ‌کننده، بازرس جوش",
            body="نقاط Hold جوش و هیدروتست بدون حضور بازرس ادامه پیدا نمی‌کند. مدارک WPS و گواهی مواد پیش از اعلام آمادگی بارگذاری می‌شود. اعزام از مسیر پیشنهاد نزد بازرس انجام می‌شود و ارجاع دستی فقط با ذکر دلیل است.",
            created_by=coordinator.id,
        )
    )
    ensure_case_demo(session)


def ensure_engagement(session: Session) -> None:
    """بازرس‌های ساعتی را روی پایگاه موجود هم مشخص می‌کند."""
    for username in HOURLY_INSPECTORS:
        user = session.scalar(select(User).where(User.username == username))
        if user is None:
            continue
        inspector = session.scalar(select(Inspector).where(Inspector.user_id == user.id))
        if inspector is not None and inspector.engagement != "hourly":
            inspector.engagement = "hourly"


def ensure_project_manager(session: Session) -> None:
    """Keep distinct workflow accounts for coordination, project review, and executive approval."""
    coordinator = session.scalar(select(User).where(User.username == "coordinator"))
    if coordinator is not None:
        coordinator.role = "coordinator"
        coordinator.name = "هماهنگ‌کننده اعزام"
    buyer = session.scalar(select(Company).where(Company.kind == "buyer"))
    legacy_account = session.scalar(select(User).where(User.username == "manager"))
    if legacy_account is not None:
        legacy_account.role = "manager"
        legacy_account.name = "مدیر پروژه"
        if buyer is not None:
            legacy_account.company_id = buyer.id
    executive = session.scalar(select(User).where(User.username == "executive"))
    if executive is None:
        session.add(
            User(
                username="executive",
                name="مدیر اجرایی",
                role="executive_manager",
                phone="02100000005",
                password_hash=hash_password(PASSWORD),
            )
        )
    else:
        executive.role = "executive_manager"
        executive.name = "مدیر اجرایی"
    unit_manager = session.scalar(select(User).where(User.username == "unit.manager"))
    if unit_manager is None:
        session.add(
            User(
                username="unit.manager",
                name="مدیر واحد بازرسی",
                role="unit_manager",
                phone="02100000006",
                password_hash=hash_password(PASSWORD),
            )
        )
    else:
        unit_manager.role = "unit_manager"
        unit_manager.name = "مدیر واحد بازرسی"


def ensure_case_demo(session: Session) -> None:
    """یک بازرسی موردی، جدا از ITP طرح. اگر از قبل باشد دوباره ساخته نمی‌شود."""
    if session.scalar(select(Project).where(Project.kind == "case")):
        return
    buyer = session.scalar(select(Company).where(Company.kind == "buyer"))
    vendor_co = session.scalar(select(Company).where(Company.kind == "vendor"))
    vendor = session.scalar(select(User).where(User.username == "vendor"))
    if buyer is None or vendor_co is None or vendor is None:
        return
    project = Project(
        code="CASE-PSV-018",
        kind="case",
        name="بازرسی موردی شیر ایمنی",
        buyer_company_id=buyer.id,
        description="درخواست جدا برای یک قلم. برنامه ITP و چند نقطه ندارد؛ همان اعزام، حضور و IVR را طی می‌کند.",
    )
    session.add(project)
    session.flush()
    order = PurchaseOrder(
        project_id=project.id,
        vendor_company_id=vendor_co.id,
        number="CASE-PSV-018",
        title="شیر ایمنی مخزن روزانه",
    )
    session.add(order)
    session.flush()
    item = Equipment(
        po_id=order.id,
        tag="PSV-12",
        title="شیر ایمنی مخزن روزانه",
        clazz="item",
        standard="API 526",
        workshop_name="انبار قطعات ماشین‌سازی البرز",
        city="کرج",
        lat=35.768,
        lng=50.99,
        )
    session.add(item)
    session.flush()
    add_document(
        session,
        equipment_id=item.id,
        doc_type="drawing",
        title="نقشه شیر ایمنی",
        filename="PSV-12-drawing.pdf",
        actor=vendor,
    )
    point = InspectionPoint(
        equipment_id=item.id,
        seq=1,
        title="بازرسی ظاهری و پلاک شیر ایمنی",
        discipline="mechanical",
        point_type="W",
        standard_ref="API 526",
        remote_allowed=False,
        required_docs_json=json.dumps(["drawing"]),
        checklist_json=json.dumps(
            [
                {"id": "set", "text": "فشار تنظیم پلاک با درخواست یکی است", "mandatory": True},
                {"id": "seal", "text": "پلمب و نشانه‌گذاری شیر سالم است", "mandatory": True},
            ],
            ensure_ascii=False,
        ),
    )
    session.add(point)
    session.flush()
    mark_ready(session, point.id, vendor, window_note="قلم در انبار آماده بازدید موردی است")

"""جاهای خالی فرم‌های IN، ITP، IVR و MOM. مقدار اولیه خالی است تا در محل پر شود."""

from copy import deepcopy

from app.domain.errors import DomainError


def _field(key: str, label: str, kind: str = "line", *, required: bool = False) -> dict:
    return {"key": key, "label": label, "kind": kind, "required": required}


def _table(
    key: str,
    title: str,
    columns: list[tuple[str, str]],
    rows: int,
    *,
    required_columns: tuple[str, ...] = (),
) -> dict:
    return {
        "key": key,
        "title": title,
        "columns": [
            {"key": key_name, "label": label, "required": key_name in required_columns}
            for key_name, label in columns
        ],
        "rows": rows,
        "required_columns": list(required_columns),
    }


ITP_COLUMNS = [
    ("item", "ردیف"),
    ("activity", "فعالیت بازرسی / آزمون"),
    ("reference", "استاندارد یا رویه"),
    ("criteria", "معیار پذیرش"),
    ("record", "مدرک اثبات"),
    ("intervention", "H / W / R / S"),
    ("vendor", "سازنده"),
    ("tpi", "بازرس ثالث"),
    ("client", "کارفرما"),
]

FORMS = {
    "in": {
        "code": "IN",
        "title": "Inspection Note",
        "title_fa": "یادداشت بازرسی",
        "note": "یادداشت کوتاه میدانی است و جای گزارش کامل بازدید را نمی‌گیرد.",
        "sections": [
            {
                "title": "شناسه",
                "fields": [
                    _field("customer_location", "موقعیت کارفرما", "select", required=True),
                    _field("client", "کارفرما", required=True),
                    _field("number", "شماره IN", required=True),
                    _field("date", "تاریخ", required=True),
                    _field("project", "پروژه", required=True),
                    _field("po", "شماره سفارش", required=True),
                    _field("pi", "شماره PI"),
                    _field("contractor", "پیمانکار"),
                    _field("vendor", "فروشنده"),
                    _field("manufacturer", "سازنده"),
                    _field("inspection_date", "تاریخ بازرسی"),
                    _field("duration", "مدت زمان بازرسی"),
                    _field("contact", "اطلاعات تماس"),
                    _field("location", "محل", required=True),
                    _field("tag", "تگ تجهیز", required=True),
                    _field("itp_item", "ردیف ITP", required=True),
                    _field("inspector", "نام بازرس"),
                    _field("discipline", "تخصص", required=True),
                ],
            },
            {
                "title": "مشاهده",
                "fields": [
                    _field("reference", "مدرک مرجع", required=True),
                    _field("reference_documents", "مدارک مرجع", "area"),
                    _field("materials", "مواد و اقلام", "area"),
                    _field("scope", "دامنه بازرسی", "area", required=True),
                    _field("category", "نوع: اطلاعات / پانچ / Hold", required=True),
                    _field("observation", "متن یادداشت", "area"),
                    _field("follow_up", "اقدام بعدی", "area"),
                    _field("advance_notice", "مهلت اعلام قبلی"),
                    _field("remarks", "توضیحات تکمیلی", "area"),
                ],
            },
            {
                "title": "امضا",
                "fields": [
                    _field("sign_inspector", "نام و امضای بازرس"),
                    _field("sign_date", "تاریخ امضا"),
                    _field("sign_ack", "تأییدکننده و شرکت"),
                    _field("sign_ack_date", "تاریخ تأیید"),
                ],
            },
        ],
    },
    "itp": {
        "code": "ITP",
        "title": "Inspection and Test Plan",
        "title_fa": "برنامه بازرسی و آزمون",
        "note": "H توقف تا حضور بازرس است، W شاهد، R بررسی مدرک، و S پایش. سلول‌ها خالی‌اند.",
        "sections": [
            {
                "title": "سربرگ",
                "fields": [
                    _field("number", "شماره ITP", required=True),
                    _field("revision", "رویزین"),
                    _field("date", "تاریخ", required=True),
                    _field("client", "کارفرما", required=True),
                    _field("vendor", "سازنده", required=True),
                    _field("project", "پروژه", required=True),
                    _field("po", "شماره سفارش", required=True),
                    _field("tag", "تگ تجهیز", required=True),
                    _field("code", "کد یا استاندارد ساخت", required=True),
                ],
            }
        ],
        "tables": [
            _table(
                "lines",
                "ردیف‌های برنامه",
                ITP_COLUMNS,
                8,
                required_columns=("item", "activity", "reference", "criteria", "intervention"),
            ),
        ],
        "tail": {
            "title": "امضای تصویب",
            "fields": [
                _field("prep_name", "تهیه‌کننده — نام"),
                _field("prep_date", "تهیه‌کننده — تاریخ"),
                _field("vendor_name", "سازنده — نام"),
                _field("vendor_date", "سازنده — تاریخ"),
                _field("client_name", "کارفرما — نام"),
                _field("client_date", "کارفرما — تاریخ"),
                _field("tpi_name", "بازرس ثالث — نام"),
                _field("tpi_date", "بازرس ثالث — تاریخ"),
            ],
        },
    },
    "ivr": {
        "code": "IVR",
        "title": "Inspection Visit Report",
        "title_fa": "گزارش بازدید بازرسی",
        "note": "گزارش بازدید. نتیجه هر بند: قبول، رد، یا موضوعیت ندارد. امضاها خالی است.",
        "sections": [
            {
                "title": "شناسه بازدید",
                "fields": [
                    _field("number", "شماره IVR", required=True),
                    _field("date", "تاریخ بازدید", required=True),
                    _field("client", "کارفرما", required=True),
                    _field("vendor", "سازنده", required=True),
                    _field("project", "پروژه", required=True),
                    _field("po", "شماره سفارش", required=True),
                    _field("location", "محل", required=True),
                    _field("tag", "تگ تجهیز", required=True),
                    _field("itp_item", "ردیف ITP", required=True),
                    _field("inspector", "نام بازرس", required=True),
                    _field("certificate", "شماره گواهی صلاحیت"),
                ],
            },
            {
                "title": "دامنه",
                "fields": [
                    _field("scope", "دامنه بازدید", "area", required=True),
                    _field("documents", "مدارک بررسی‌شده", "area", required=True),
                    _field("ncr", "شماره عدم انطباق"),
                    _field("conclusion", "نتیجه بازدید", "area", required=True),
                ],
            },
        ],
        "tables": [
            _table(
                "instruments",
                "وسایل اندازه‌گیری",
                [("name", "وسیله"), ("identity", "شماره شناسایی"), ("calibration", "سررسید کالیبراسیون")],
                3,
            ),
            _table(
                "findings",
                "یافته‌ها",
                [("item", "بند"), ("result", "قبول / رد / موضوعیت ندارد"), ("remark", "شرح")],
                5,
                required_columns=("item", "result"),
            ),
        ],
        "tail": {
            "title": "امضا",
            "fields": [
                _field("sign_inspector", "بازرس — نام"),
                _field("sign_inspector_date", "بازرس — تاریخ"),
                _field("sign_vendor", "نماینده سازنده — نام"),
                _field("sign_vendor_date", "نماینده سازنده — تاریخ"),
                _field("sign_client", "نماینده کارفرما — نام"),
                _field("sign_client_date", "نماینده کارفرما — تاریخ"),
            ],
        },
    },
    "mom": {
        "code": "MOM",
        "title": "Minutes of Meeting",
        "title_fa": "صورتجلسه",
        "note": "صورتجلسه جدا از گزارش بازدید است. حاضرین و اقدامات خالی‌اند.",
        "sections": [
            {
                "title": "جلسه",
                "fields": [
                    _field("number", "شماره MOM", required=True),
                    _field("date", "تاریخ", required=True),
                    _field("start", "ساعت شروع"),
                    _field("end", "ساعت پایان"),
                    _field("place", "محل", required=True),
                    _field("project", "پروژه", required=True),
                    _field("subject", "موضوع", "area", required=True),
                    _field("agenda", "دستور جلسه", "area", required=True),
                    _field("discussion", "خلاصه بحث", "area", required=True),
                    _field("next_meeting", "جلسه بعد"),
                    _field("distribution", "توزیع"),
                ],
            }
        ],
        "tables": [
            _table("attendees", "حاضرین", [("name", "نام"), ("company", "شرکت"), ("role", "سمت")], 5),
            _table("actions", "اقدامات", [("action", "اقدام"), ("owner", "مسئول"), ("due", "موعد")], 4),
        ],
        "tail": {
            "title": "امضا",
            "fields": [
                _field("prepared_by", "تهیه‌کننده — نام"),
                _field("prepared_date", "تهیه‌کننده — تاریخ"),
                _field("approved_by", "تصویب‌کننده — نام"),
                _field("approved_date", "تصویب‌کننده — تاریخ"),
            ],
        },
    },
}


def known_kinds() -> list[str]:
    return list(FORMS)


def _blank_table(table: dict) -> list[dict]:
    empty_row = {column["key"]: "" for column in table["columns"]}
    return [deepcopy(empty_row) for _ in range(table["rows"])]


def empty_payload(kind: str) -> dict:
    spec = FORMS[kind]
    payload: dict = {}
    for section in spec["sections"]:
        for field in section["fields"]:
            payload[field["key"]] = ""
    for table in spec.get("tables", []):
        payload[table["key"]] = _blank_table(table)
    tail = spec.get("tail")
    if tail:
        for field in tail["fields"]:
            payload[field["key"]] = ""
    return payload


def _text(value, limit: int = 400) -> str:
    return str(value or "").strip()[:limit]


def normalize(kind: str, payload: dict | None) -> dict:
    if kind not in FORMS:
        raise KeyError(kind)
    clean = empty_payload(kind)
    given = payload or {}
    spec = FORMS[kind]
    for section in spec["sections"]:
        for field in section["fields"]:
            clean[field["key"]] = _text(given.get(field["key"]), 2000 if field["kind"] == "area" else 200)
            if field.get("required") and not clean[field["key"]]:
                raise DomainError("required_field", f"تکمیل فیلد «{field['label']}» الزامی است.", 400)
    tail = spec.get("tail")
    if tail:
        for field in tail["fields"]:
            clean[field["key"]] = _text(given.get(field["key"]))
            if field.get("required") and not clean[field["key"]]:
                raise DomainError("required_field", f"تکمیل فیلد «{field['label']}» الزامی است.", 400)
    for table in spec.get("tables", []):
        rows = given.get(table["key"])
        if not isinstance(rows, list):
            rows = []
        built = []
        for index in range(table["rows"]):
            source = rows[index] if index < len(rows) and isinstance(rows[index], dict) else {}
            built.append({column["key"]: _text(source.get(column["key"])) for column in table["columns"]})
            if index == 0:
                for column in table["columns"]:
                    if column.get("required") and not built[-1][column["key"]]:
                        raise DomainError(
                            "required_field",
                            f"تکمیل «{table['title']} - {column['label']}» الزامی است.",
                            400,
                        )
        clean[table["key"]] = built
    return clean


def template(kind: str) -> dict:
    spec = FORMS[kind]
    return {
        "kind": kind,
        "code": spec["code"],
        "title": spec["title"],
        "title_fa": spec["title_fa"],
        "note": spec["note"],
        "sections": spec["sections"],
        "tables": spec.get("tables", []),
        "tail": spec.get("tail"),
        "payload": empty_payload(kind),
    }

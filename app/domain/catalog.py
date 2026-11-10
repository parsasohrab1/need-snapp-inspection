"""قالب ITP تجهیزات ثابت. چک‌لیست نمونه کارگاهی است، نه جایگزین رویه مصوب پروژه."""

from dataclasses import dataclass


@dataclass(frozen=True)
class CheckItem:
    id: str
    text: str
    mandatory: bool = True


@dataclass(frozen=True)
class PointTemplate:
    title: str
    discipline: str
    point_type: str
    standard_ref: str
    required_docs: tuple[str, ...]
    checklist: tuple[CheckItem, ...]
    remote_allowed: bool = False


def _checks(*rows: tuple[str, str]) -> tuple[CheckItem, ...]:
    return tuple(CheckItem(key, text) for key, text in rows)


MATERIAL = _checks(
    ("heat", "شماره ذوب گواهی با لیست مواد یکی است"),
    ("grade", "گرید و استاندارد با درخواست خرید می‌خواند"),
    ("mark", "نشانه‌گذاری ردیابی روی قطعه خوانا است"),
)
WPS = _checks(
    ("wps-id", "شماره WPS/PQR با طرح جوش یکی است"),
    ("range", "محدوده تأیید ضخامت و فرآیند پوشش می‌دهد"),
)
FITUP = _checks(
    ("gap", "فاصله درز و هم‌ترازی در رواداری است"),
    ("clean", "لبه‌ها پیش از جوش تمیز شده‌اند"),
    ("wps", "جوشکار مجاز WPS را در محل دارد"),
)
WELD = _checks(
    ("visual", "بازرسی چشمی جوش بدون ترک و بریدگی غیرمجاز است"),
    ("stamp", "مهر جوشکار ثبت شده است"),
    ("consumable", "دسته الکترود یا بچ سیم‌جوش قابل ردیابی است"),
)
NDT = _checks(
    ("coverage", "پوشش آزمون با نقشه NDT یکی است"),
    ("accept", "عیب باقی‌مانده از معیار پذیرش رد شده است"),
    ("report", "گزارش آزمون شماره یکتا و امضا دارد"),
)
HYDRO = _checks(
    ("gauge", "فشارسنج کالیبره و در بازه آزمون است"),
    ("hold", "زمان نگهداشت فشار کامل شده است"),
    ("leak", "نشتی، تعریق یا افت فشار غیرمجاز دیده نشد"),
)
DIM = _checks(
    ("drawing", "ابعاد اصلی با نقشه ساخت مطابقت دارد"),
    ("nozzle", "راستای نازل و ارتفاع نشیمن در رواداری است"),
)
COAT = _checks(
    ("surface", "آماده‌سازی سطح با درجه خواسته‌شده مطابق است"),
    ("dft", "ضخامت فیلم خشک در محدوده است"),
    ("holiday", "ناپیوستگی پوشش در ناحیه بحرانی نیست"),
)
DOSSIER = _checks(
    ("index", "فهرست پرونده با مدارک بارگذاری‌شده می‌خواند"),
    ("trace", "گواهی مواد تا قطعه نهایی قابل ردیابی است"),
    ("punch", "اقلام باز پرونده صفر است یا مهلت دارد"),
)
TUBE = _checks(
    ("expansion", "اتساع لوله در حد رویه است"),
    ("leak", "نشتی از اتصال لوله به تیوب‌شیت دیده نشد"),
)
MARKING = _checks(
    ("tag", "تگ و نشانه‌گذاری حمل با پکینگ‌لیست یکی است"),
    ("protect", "سطوح ماشین‌کاری‌شده برای حمل محافظت شده‌اند"),
)


def p(title, discipline, point_type, standard, docs, checklist, remote=False) -> PointTemplate:
    return PointTemplate(title, discipline, point_type, standard, docs, checklist, remote)


VESSEL = [
    p("بازرسی مواد ورق و فلنج", "material", "H", "EN 10204 3.1", ("mtc", "drawing"), MATERIAL),
    p("بازبینی WPS/PQR", "documentation", "R", "ASME IX", ("wps", "pqr"), WPS, True),
    p("فیت‌آپ بدنه", "welding", "W", "ASME VIII", ("drawing", "wps"), FITUP),
    p("جوش درز طولی", "welding", "H", "ASME VIII UW", ("drawing", "wps"), WELD),
    p("NDT درز طولی", "ndt", "H", "ASME V / VIII", ("ndt_procedure", "drawing"), NDT),
    p("جوش نازل و منهول", "welding", "W", "ASME VIII", ("drawing", "wps"), WELD),
    p("NDT نازل", "ndt", "W", "ASME V", ("ndt_procedure", "drawing"), NDT),
    p("عملیات حرارتی", "welding", "R", "ASME VIII UCS", ("wps", "test_procedure"), WPS),
    p("آزمون هیدرواستاتیک", "hydrotest", "H", "ASME VIII UG-99", ("test_procedure", "drawing"), HYDRO),
    p("کنترل ابعادی نهایی", "mechanical", "W", "نقشه ساخت", ("drawing",), DIM),
    p("رنگ و پوشش", "coating", "W", "ISO 12944", ("coating_spec",), COAT),
    p("پرونده نهایی ساخت", "documentation", "R", "ITP dossier", ("packing_list", "mtc", "drawing", "purchase_order"), DOSSIER, True),
]

EXCHANGER = [
    p("بازرسی مواد پوسته و لوله", "material", "H", "EN 10204 3.1", ("mtc", "drawing"), MATERIAL),
    p("بازبینی WPS", "documentation", "R", "ASME IX", ("wps",), WPS, True),
    p("فیت‌آپ پوسته", "welding", "W", "TEMA / ASME VIII", ("drawing", "wps"), FITUP),
    p("جوش تیوب‌شیت", "welding", "H", "ASME VIII", ("drawing", "wps"), WELD),
    p("NDT جوش‌های فشاری", "ndt", "H", "ASME V", ("ndt_procedure", "drawing"), NDT),
    p("اتساع لوله", "mechanical", "W", "TEMA", ("drawing", "test_procedure"), TUBE),
    p("آزمون هیدرواستاتیک", "hydrotest", "H", "ASME VIII", ("test_procedure",), HYDRO),
    p("کنترل ابعادی", "mechanical", "W", "نقشه ساخت", ("drawing",), DIM),
    p("پوشش خارجی", "coating", "W", "ISO 12944", ("coating_spec",), COAT),
    p("پرونده نهایی", "documentation", "R", "ITP dossier", ("packing_list", "mtc", "drawing"), DOSSIER, True),
]

PIPING = [
    p("بازرسی مواد لوله و فیتینگ", "material", "H", "EN 10204 3.1", ("mtc", "drawing"), MATERIAL),
    p("بازبینی WPS", "documentation", "R", "ASME IX", ("wps",), WPS, True),
    p("فیت‌آپ اسپول", "welding", "W", "ASME B31.3", ("drawing", "wps"), FITUP),
    p("جوش بات‌ولد", "welding", "H", "ASME B31.3", ("drawing", "wps"), WELD),
    p("NDT جوش", "ndt", "H", "ASME B31.3 / V", ("ndt_procedure", "drawing"), NDT),
    p("کنترل ابعادی اسپول", "mechanical", "W", "نقشه ایزومتریک", ("drawing",), DIM),
    p("آزمون نشتی", "hydrotest", "H", "ASME B31.3", ("test_procedure",), HYDRO),
    p("نشانه‌گذاری و محافظت", "coating", "S", "نقشه حمل", ("coating_spec", "packing_list"), MARKING),
    p("پکینگ", "documentation", "S", "packing list", ("packing_list",), MARKING),
    p("پرونده اسپول", "documentation", "R", "ITP dossier", ("packing_list", "mtc", "drawing"), DOSSIER, True),
]

SKID = [
    p("بازرسی مواد سازه", "material", "H", "EN 10204", ("mtc", "drawing"), MATERIAL),
    p("بازبینی نقشه ساخت", "documentation", "R", "نقشه کارگاهی", ("drawing",), DIM, True),
    p("فیت‌آپ سازه", "welding", "W", "AWS D1.1", ("drawing", "wps"), FITUP),
    p("جوش سازه", "welding", "H", "AWS D1.1", ("drawing", "wps"), WELD),
    p("NDT جوش گوشه بحرانی", "ndt", "W", "AWS D1.1", ("ndt_procedure",), NDT),
    p("کنترل ابعادی شاسی", "mechanical", "W", "نقشه ساخت", ("drawing",), DIM),
    p("پوشش سازه", "coating", "W", "ISO 12944", ("coating_spec",), COAT),
    p("پرونده شاسی", "documentation", "R", "ITP dossier", ("packing_list", "drawing", "mtc"), DOSSIER, True),
]

EQUIPMENT_CLASSES = {
    "vessel": ("مخزن تحت فشار", "ASME VIII Div.1", VESSEL),
    "exchanger": ("مبدل حرارتی", "TEMA / ASME VIII", EXCHANGER),
    "piping": ("اسپول پایپینگ", "ASME B31.3", PIPING),
    "skid": ("شاسی و مخزن روزانه", "AWS D1.1", SKID),
}

DOC_LABELS = {
    "drawing": "نقشه ساخت",
    "mtc": "گواهی مواد",
    "wps": "WPS",
    "pqr": "PQR",
    "ndt_procedure": "رویّه NDT",
    "test_procedure": "رویّه آزمون",
    "coating_spec": "مشخصات پوشش",
    "packing_list": "پکینگ‌لیست",
    "purchase_order": "سفارش خرید",
    "origin_certificate": "گواهی مبدأ",
    "model_3d": "مدل سه‌بعدی",
    "mom": "صورتجلسه",
}

DISCIPLINE_LABELS = {
    "material": "مواد",
    "welding": "جوش",
    "ndt": "آزمون غیرمخرب",
    "mechanical": "مکانیک و ابعاد",
    "hydrotest": "هیدروتست",
    "coating": "پوشش",
    "documentation": "مدارک",
}

POINT_TYPE_LABELS = {
    "H": "Hold",
    "W": "Witness",
    "R": "Review",
    "S": "Surveillance",
}

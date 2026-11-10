"""تعرفه بازدید و سهم سامانه. اعداد نمونه عملیاتی‌اند، نه قرارداد واقعی."""

POINT_FEE_IRR = {
    "H": 8_500_000,
    "W": 6_000_000,
    "R": 3_500_000,
    "S": 2_500_000,
}

DISCIPLINE_FACTOR = {
    "material": 1.0,
    "welding": 1.15,
    "ndt": 1.35,
    "mechanical": 1.05,
    "hydrotest": 1.25,
    "coating": 0.95,
    "documentation": 0.9,
}

PLATFORM_COMMISSION = 0.18
REMOTE_FACTOR = 0.60


def quote(point_type: str, discipline: str, remote: bool) -> tuple[int, int, int]:
    if point_type not in POINT_FEE_IRR:
        raise ValueError(point_type)
    base = POINT_FEE_IRR[point_type] * DISCIPLINE_FACTOR.get(discipline, 1.0)
    if remote:
        base *= REMOTE_FACTOR
    fee = int(round(base))
    commission = int(round(fee * PLATFORM_COMMISSION))
    return fee, commission, fee - commission

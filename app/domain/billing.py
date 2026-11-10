"""نرخ صورت‌وضعیت و فاکتور برای سال ۱۴۰۵.

ارزش افزوده به بهای ناخالص اضافه می‌شود. سپرده بیمه و حسن انجام کار از آن کم می‌شوند.
مالیات تکلیفی ماده ۱۰۴ از ابتدای ۱۳۹۵ حذف شده و مبلغش صفر است.
"""

VAT_RATE = 10
INSURANCE_DEPOSIT_RATE = 5
PERFORMANCE_RATE = 10
WITHHOLDING_TAX_RATE = 0

BASIS = (
    "نرخ عمومی ارزش افزوده در سال ۱۴۰۵ برابر ۱۰ درصد است: ۹ درصد ماده ۷ قانون مالیات بر ارزش افزوده "
    "به‌علاوه یک واحد درصد ردیف ۱-۶-۳ احکام مالیاتی بودجه ۱۴۰۵. این مبلغ به بهای بازرسی اضافه می‌شود. "
    "سپرده بیمه ۵ درصد بهای کار است و طبق ماده ۳۸ قانون تأمین اجتماعی تا ارائه مفاصاحساب نگه داشته می‌شود. "
    "حسن انجام تعهدات ۱۰ درصد هر پرداخت است و طبق ماده ۳۵ شرایط عمومی پیمان کسر می‌شود. "
    "مالیات تکلیفی ماده ۱۰۴ قانون مالیات‌های مستقیم با اصلاح ۳۱ تیر ۱۳۹۴ از ابتدای ۱۳۹۵ حذف شده و در این فاکتور صفر است."
)


def portion(gross_irr: int, percent: int) -> int:
    return (gross_irr * percent + 50) // 100


def fiscal_year(moment) -> int:
    """سال شمسی سند. مرز سال، اول فروردین است."""
    if moment.month > 3 or (moment.month == 3 and moment.day >= 21):
        return moment.year - 621
    return moment.year - 622


def compute_bill(gross_irr: int) -> dict:
    performance = portion(gross_irr, PERFORMANCE_RATE)
    insurance = portion(gross_irr, INSURANCE_DEPOSIT_RATE)
    tax = portion(gross_irr, WITHHOLDING_TAX_RATE)
    vat = portion(gross_irr, VAT_RATE)
    net = gross_irr - performance - insurance - tax + vat
    return {
        "gross_irr": gross_irr,
        "performance_rate": PERFORMANCE_RATE,
        "performance_irr": performance,
        "insurance_rate": INSURANCE_DEPOSIT_RATE,
        "insurance_irr": insurance,
        "tax_rate": WITHHOLDING_TAX_RATE,
        "tax_irr": tax,
        "vat_rate": VAT_RATE,
        "vat_irr": vat,
        "net_irr": net,
        "basis": BASIS,
    }

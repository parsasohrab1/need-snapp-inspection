"""اجرای کمپین محیط مرتبط و ثبت گزارش TRL 5."""

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.scenarios import run_campaign

REPORT = Path(__file__).resolve().parents[1] / "docs" / "validation" / "TRL5_REPORT.md"


def main() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as session:
        report = run_campaign(session)
    lines = [
        "# گزارش کمپین محیط مرتبط",
        "",
        "محیط: کارگاه ساخت تجهیزات ثابت در کرج، هشت بازرس (یکی آفلاین، یکی در اصفهان و خارج از شعاع)، چهار تجهیز و چهل نقطه ITP.",
        "داده واقعی یک سفارش صنعتی در این اجرا نیست. اعداد تعرفه نمونه‌اند.",
        "",
        "| معیار | نتیجه |",
        "| --- | --- |",
        f"| نقاط تأییدشده | {report['accepted']} از {report['points']} |",
        f"| ردیف تسویه | {report['ledgers']} |",
        f"| عدم انطباق اصلاح‌شده | {report['ncr_reworked']} |",
        f"| عدم انطباق باز در پایان | {report['open_ncr']} |",
        f"| رد پیشنهاد | {report['declined']} |",
        f"| جلوگیری از پذیرش دوم | {report['double_accept_blocked']} |",
        f"| رد ورود خارج از فنس | {report['geofence_blocked']} |",
        f"| پیشنهاد حضوری به بازرس خارج از شعاع | {report['site_offers_to_far_inspector']} |",
        f"| پیشنهاد مدارکی به بازرس دور | {report['remote_offers_to_far_inspector']} |",
        f"| پیشنهاد به بازرس آفلاین | {report['offline_offers']} |",
        f"| نرخ سهم سامانه | {report['commission_rate']} |",
        f"| مشکلات | {', '.join(report['problems']) or 'هیچ'} |",
        "",
        f"نتیجه: {'قبول' if report['passed'] else 'مردود'}.",
        "",
    ]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(REPORT)
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

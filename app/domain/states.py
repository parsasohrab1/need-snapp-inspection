"""ماشین حالت نقطه بازرسی. گذار غیرمجاز رد می‌شود."""

from app.domain.errors import DomainError


# planned → ready → offering → assigned → en_route → on_site → submitted → accepted
POINT_TRANSITIONS: dict[str, set[str]] = {
    "planned": {"ready"},
    "ready": {"offering", "assigned"},
    "offering": {"assigned", "ready"},
    "assigned": {"en_route", "on_site"},
    "en_route": {"on_site"},
    "on_site": {"submitted"},
    "submitted": {"accepted", "ready", "on_site"},
    "accepted": {"ready", "submitted"},
}

TERMINAL_POINT = {"accepted"}
ACTIVE_VISIT = {"assigned", "en_route", "on_site"}


def move_point(current: str, target: str) -> str:
    allowed = POINT_TRANSITIONS.get(current)
    if allowed is None:
        raise DomainError("unknown_state", f"وضعیت ناشناخته است: {current}", 400)
    if target not in allowed:
        raise DomainError(
            "illegal_transition",
            f"گذار از {current} به {target} مجاز نیست.",
            409,
        )
    return target

"""انتخاب بازرس شبیه پذیرش سفر: تخصص، آنلاین بودن، شعاع، بار کار، امتیاز."""

from dataclasses import dataclass

from app.domain.geo import haversine_km


GEOFENCE_KM = 0.8
OFFER_TOP_N = 1


@dataclass(frozen=True)
class InspectorView:
    id: int
    disciplines: tuple[str, ...]
    lat: float
    lng: float
    radius_km: float
    online: bool
    rating: float
    active_jobs: int
    max_parallel: int
    engagement: str = "fixed"


@dataclass(frozen=True)
class Candidate:
    inspector_id: int
    distance_km: float
    score: float
    engagement: str = "fixed"


def rank_inspectors(
    inspectors: list[InspectorView],
    *,
    discipline: str,
    lat: float,
    lng: float,
    remote: bool,
    declined_ids: set[int] | None = None,
) -> list[Candidate]:
    """شعاع برای بازدید کارگاهی سخت است. بازبینی مدارکی از راه دور شعاع را نادیده می‌گیرد."""
    declined = declined_ids or set()
    found: list[Candidate] = []
    for ins in inspectors:
        if ins.id in declined or not ins.online:
            continue
        if discipline not in ins.disciplines:
            continue
        if ins.active_jobs >= ins.max_parallel:
            continue
        distance = haversine_km(ins.lat, ins.lng, lat, lng)
        if not remote and distance > ins.radius_km:
            continue
        distance_score = 1.0 if remote else max(0.0, 1.0 - distance / max(ins.radius_km, 1.0))
        rating_score = max(0.0, min(ins.rating / 5.0, 1.0))
        load_score = 1.0 - (ins.active_jobs / ins.max_parallel)
        score = 0.50 * distance_score + 0.30 * rating_score + 0.20 * load_score
        found.append(Candidate(ins.id, round(distance, 2), round(score, 4), ins.engagement or "fixed"))
    found.sort(key=lambda item: (item.distance_km, item.inspector_id))
    return found


def within_geofence(lat: float, lng: float, workshop_lat: float, workshop_lng: float) -> bool:
    return haversine_km(lat, lng, workshop_lat, workshop_lng) <= GEOFENCE_KM

"""مسافت کروی. محیط مرتبط همین مختصات کارگاه و بازرس است، نه نقشه زنده."""

from math import asin, cos, radians, sin, sqrt


EARTH_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlmb = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlmb / 2) ** 2
    return 2 * EARTH_KM * asin(sqrt(a))

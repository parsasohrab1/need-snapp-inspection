from app.domain.commercial import quote
from app.domain.errors import DomainError
from app.domain.geo import haversine_km
from app.domain.matching import InspectorView, rank_inspectors, within_geofence
from app.domain.states import move_point
import pytest


def test_tehran_karaj_distance_is_regional():
    distance = haversine_km(35.6892, 51.3890, 35.8400, 50.9391)
    assert 40 < distance < 60


def test_rank_respects_discipline_radius_and_presence():
    near = InspectorView(1, ("welding",), 35.76, 50.97, 40, True, 4.5, 0, 2)
    far = InspectorView(2, ("welding",), 32.65, 51.67, 20, True, 5, 0, 2)
    offline = InspectorView(3, ("welding",), 35.76, 50.96, 40, False, 5, 0, 2)
    other = InspectorView(4, ("ndt",), 35.76, 50.96, 40, True, 5, 0, 2)
    ranked = rank_inspectors([near, far, offline, other], discipline="welding", lat=35.755, lng=50.958, remote=False)
    assert [item.inspector_id for item in ranked] == [1]


def test_remote_review_ignores_radius():
    far = InspectorView(2, ("documentation",), 32.65, 51.67, 20, True, 5, 0, 2)
    ranked = rank_inspectors([far], discipline="documentation", lat=35.755, lng=50.958, remote=True)
    assert ranked and ranked[0].inspector_id == 2


def test_rank_prioritizes_distance_over_engagement():
    farther_fixed = InspectorView(1, ("welding",), 35.79, 51.04, 50, True, 4.5, 0, 2, "fixed")
    closer_hourly = InspectorView(2, ("welding",), 35.76, 50.97, 40, True, 4.5, 0, 2, "hourly")
    ranked = rank_inspectors(
        [farther_fixed, closer_hourly],
        discipline="welding",
        lat=35.755,
        lng=50.958,
        remote=False,
    )
    assert [item.inspector_id for item in ranked] == [2, 1]


def test_geofence_rejects_another_city():
    assert within_geofence(35.755, 50.958, 35.755, 50.960)
    assert not within_geofence(36.30, 59.60, 35.755, 50.958)


def test_hold_costs_more_than_review_and_remote_is_discounted():
    hold, _, _ = quote("H", "welding", False)
    review, commission, net = quote("R", "documentation", True)
    assert hold > review
    assert commission + net == review


def test_illegal_transition():
    with pytest.raises(DomainError) as caught:
        move_point("planned", "accepted")
    assert caught.value.code == "illegal_transition"

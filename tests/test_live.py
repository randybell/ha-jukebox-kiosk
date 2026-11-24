"""#103 live feed: jukebox_kiosk/subscribe_live (snapshot, then MA's pushed changes, with running numbers)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from homeassistant.core import HomeAssistant

from .conftest import PLAYER_A, PLAYER_B, SYNCGROUP, FakeMa, seed_playing

pytestmark = pytest.mark.usefixtures("kiosk")

UNMAPPED = "player_without_entity_placeholder"


async def _call(ws: Any, **msg: Any) -> dict[str, Any]:
    await ws.send_json_auto_id(msg)
    return await ws.receive_json()


def _ev(name: str, object_id: str | None, data: Any = None) -> Any:
    return SimpleNamespace(event=SimpleNamespace(value=name), object_id=object_id, data=data)


class _Model:
    """Stands in for a music_assistant_models Player/PlayerQueue (to_dict)."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    def to_dict(self) -> dict[str, Any]:
        return dict(self.data)


def _seed(fake_ma: FakeMa) -> None:
    fake_ma.players[PLAYER_A] = {"player_id": PLAYER_A, "name": "Kitchen", "type": "player", "synced_to": None,
                                 "active_group": None, "group_members": [], "can_group_with": [PLAYER_B]}
    fake_ma.players[PLAYER_B] = _Model({"player_id": PLAYER_B, "name": "Den", "type": "player"})
    fake_ma.players[SYNCGROUP] = {"player_id": SYNCGROUP, "name": "Everywhere", "type": "group",
                                  "group_members": [PLAYER_A, PLAYER_B], "static_group_members": []}
    fake_ma.player_queues[PLAYER_A] = {"queue_id": PLAYER_A, "active": False, "items": 3}
    fake_ma.player_queues[SYNCGROUP] = _Model({"queue_id": SYNCGROUP, "active": True, "items": 12})
    fake_ma.player_queues[UNMAPPED] = {"queue_id": UNMAPPED, "active": True, "items": 1}


async def test_capability(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/capabilities")
    assert res["result"]["features"]["live_feed"] is True


async def test_snapshot_then_changes_in_order(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa
) -> None:
    _seed(fake_ma)
    ws = await hass_ws_client(access_token=admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert res["success"]
    # one listener, not pinned to any id, for exactly the events MA's app keeps players and queues from
    assert len(fake_ma.subs) == 1
    cb, events, id_filter = fake_ma.subs[0]
    assert id_filter is None
    assert {e.value for e in events} == {"player_added", "player_updated", "player_removed",
                                          "queue_added", "queue_updated", "queue_items_updated"}
    snap = (await ws.receive_json())["event"]
    assert snap["seq"] == 1 and snap["kind"] == "snapshot"
    assert {p["player_id"] for p in snap["players"]} == {PLAYER_A, PLAYER_B, SYNCGROUP}
    assert {q["queue_id"] for q in snap["queues"]} == {PLAYER_A, SYNCGROUP, UNMAPPED}  # admin: every queue
    assert next(p for p in snap["players"] if p["player_id"] == PLAYER_A)["can_group_with"] == [PLAYER_B]
    # the snapshot comes from the client's in-memory lists: no MA command
    assert fake_ma.calls == []

    cb(_ev("player_updated", PLAYER_A, {"player_id": PLAYER_A, "synced_to": PLAYER_B}))
    cb(_ev("queue_time_updated", SYNCGROUP, 42))  # not forwarded (progress uses HA's position)
    cb(_ev("queue_items_updated", SYNCGROUP, _Model({"queue_id": SYNCGROUP, "items": 13})))
    cb(_ev("player_removed", PLAYER_B))
    got = [(await ws.receive_json())["event"] for _ in range(3)]
    assert [g["seq"] for g in got] == [2, 3, 4]
    assert [g["event"] for g in got] == ["player_updated", "queue_items_updated", "player_removed"]
    assert got[0] == {"seq": 2, "kind": "event", "event": "player_updated", "object_id": PLAYER_A,
                      "data": {"player_id": PLAYER_A, "synced_to": PLAYER_B}}
    assert got[1]["data"] == {"queue_id": SYNCGROUP, "items": 13}
    assert got[2]["object_id"] == PLAYER_B and got[2]["data"] is None

    await _call(ws, type="unsubscribe_events", subscription=res["id"])
    assert fake_ma.subs == []


async def test_each_subscription_counts_from_one(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa
) -> None:
    _seed(fake_ma)
    ws = await hass_ws_client(access_token=admin_token[1])
    a = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert (await ws.receive_json())["event"]["seq"] == 1
    await _call(ws, type="unsubscribe_events", subscription=a["id"])
    b = await _call(ws, type="jukebox_kiosk/subscribe_live")
    snap = await ws.receive_json()
    assert snap["id"] == b["id"] and snap["event"]["seq"] == 1 and snap["event"]["kind"] == "snapshot"
    await _call(ws, type="unsubscribe_events", subscription=b["id"])


async def test_queues_only_for_readable_players(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    """A non-admin gets every player (as players/all) but only queues of players whose entity they may read."""
    _seed(fake_ma)
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert res["success"]
    snap = (await ws.receive_json())["event"]
    assert {p["player_id"] for p in snap["players"]} == {PLAYER_A, PLAYER_B, SYNCGROUP}
    assert {q["queue_id"] for q in snap["queues"]} == {PLAYER_A, SYNCGROUP}
    cb = fake_ma.subs[0][0]
    cb(_ev("queue_updated", UNMAPPED, {"queue_id": UNMAPPED}))  # no entity: dropped, and no number used up
    cb(_ev("queue_updated", PLAYER_A, {"queue_id": PLAYER_A, "active": True}))
    ev = (await ws.receive_json())["event"]
    assert ev["seq"] == 2 and ev["object_id"] == PLAYER_A
    await _call(ws, type="unsubscribe_events", subscription=res["id"])


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": []}])
async def test_needs_read(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    assert fake_ma.subs == []


async def test_empty_client_lists(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    """Before MA has sent anything (or with no players) the snapshot is empty, not an error."""
    ws = await hass_ws_client(access_token=admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert res["success"]
    snap = (await ws.receive_json())["event"]
    assert snap == {"seq": 1, "kind": "snapshot", "players": [], "queues": [], "active_queues": {}}
    await _call(ws, type="unsubscribe_events", subscription=res["id"])


async def test_old_subscribe_queue_still_answers(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    """The entity push stays registered for cached older cards."""
    seed_playing(fake_ma, SYNCGROUP)
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_queue", entity_id="media_player.everywhere")
    assert res["success"] and res["result"]["queue_id"] == SYNCGROUP

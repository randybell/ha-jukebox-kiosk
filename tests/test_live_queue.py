"""2.5: the live feed says which queue each player is playing (the one active-queue rule), so the card follows its
speaker's queue from subscribe_live instead of the old entity-pinned subscribe_queue.

The rule itself is tested in test_active_queue.py; these check that the feed carries its answer in the snapshot, sends
a numbered {"kind": "active_queue"} message right after the change that moves one (and only then), and starts over on
the new client after a Music Assistant restart.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant

from .conftest import ENTITY_A, PLAYER_A, PLAYER_B, SYNCGROUP, FakeMa
from .test_offline import _come_back, _go_offline

pytestmark = pytest.mark.usefixtures("kiosk")


async def _call(ws: Any, **msg: Any) -> dict[str, Any]:
    await ws.send_json_auto_id(msg)
    return await ws.receive_json()


def _ev(name: str, object_id: str | None, data: Any = None) -> Any:
    return SimpleNamespace(event=SimpleNamespace(value=name), object_id=object_id, data=data)


def _seed(fake_ma: FakeMa) -> None:
    # A plays the group's queue (MA resolves a member's active_source to the group's), B an outside source, the group
    # its own active queue
    fake_ma.players[PLAYER_A] = {"player_id": PLAYER_A, "name": "Kitchen", "active_source": SYNCGROUP}
    fake_ma.players[PLAYER_B] = {"player_id": PLAYER_B, "name": "Den", "active_source": "airplay_source"}
    fake_ma.players[SYNCGROUP] = {"player_id": SYNCGROUP, "name": "Everywhere", "type": "group", "active_source": None}
    fake_ma.player_queues[PLAYER_A] = {"queue_id": PLAYER_A, "active": False}
    fake_ma.player_queues[PLAYER_B] = {"queue_id": PLAYER_B, "active": False}
    fake_ma.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True}


async def _subscribe(ws: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    res = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert res["success"]
    return res, (await ws.receive_json())["event"]


async def test_snapshot_carries_each_players_active_queue(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa
) -> None:
    _seed(fake_ma)
    ws = await hass_ws_client(access_token=admin_token[1])
    res, snap = await _subscribe(ws)
    assert snap["kind"] == "snapshot" and snap["seq"] == 1
    assert snap["active_queues"] == {PLAYER_A: SYNCGROUP, PLAYER_B: None, SYNCGROUP: SYNCGROUP}
    assert fake_ma.calls == []  # from the client's in-memory lists
    await _call(ws, type="unsubscribe_events", subscription=res["id"])


async def test_a_change_that_moves_a_queue_is_followed_by_active_queue(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa
) -> None:
    _seed(fake_ma)
    ws = await hass_ws_client(access_token=admin_token[1])
    res, _snap = await _subscribe(ws)
    cb = fake_ma.subs[0][0]

    # A leaves the group (MA updates its lists, then sends player_updated): the change, then the new queue (none: its
    # own queue is not active)
    fake_ma.players[PLAYER_A]["active_source"] = None
    cb(_ev("player_updated", PLAYER_A, {"player_id": PLAYER_A, "active_source": None}))
    got = [(await ws.receive_json())["event"] for _ in range(2)]
    assert got[0]["seq"] == 2 and got[0]["kind"] == "event" and got[0]["event"] == "player_updated"
    assert got[1] == {"seq": 3, "kind": "active_queue", "player_id": PLAYER_A, "queue_id": None}

    # nothing moved: only the change itself
    cb(_ev("player_updated", PLAYER_A, {"player_id": PLAYER_A, "volume_level": 20}))
    # its own queue starts (queue_updated with active: true): A now plays its own queue
    fake_ma.player_queues[PLAYER_A]["active"] = True
    cb(_ev("queue_updated", PLAYER_A, {"queue_id": PLAYER_A, "active": True}))
    got = [(await ws.receive_json())["event"] for _ in range(3)]
    assert [g["seq"] for g in got] == [4, 5, 6]
    assert [g["kind"] for g in got] == ["event", "event", "active_queue"]
    assert got[2] == {"seq": 6, "kind": "active_queue", "player_id": PLAYER_A, "queue_id": PLAYER_A}

    # B comes back from AirPlay and joins the group
    fake_ma.players[PLAYER_B]["active_source"] = SYNCGROUP
    cb(_ev("player_updated", PLAYER_B, {"player_id": PLAYER_B, "active_source": SYNCGROUP}))
    got = [(await ws.receive_json())["event"] for _ in range(2)]
    assert got[1] == {"seq": 8, "kind": "active_queue", "player_id": PLAYER_B, "queue_id": SYNCGROUP}

    # a new player that already plays a queue
    fake_ma.players["player_c_placeholder"] = {"player_id": "player_c_placeholder", "active_source": SYNCGROUP}
    cb(_ev("player_added", "player_c_placeholder", {"player_id": "player_c_placeholder", "active_source": SYNCGROUP}))
    got = [(await ws.receive_json())["event"] for _ in range(2)]
    assert got[0]["event"] == "player_added"
    assert got[1] == {"seq": 10, "kind": "active_queue", "player_id": "player_c_placeholder", "queue_id": SYNCGROUP}

    # the group's queue goes away: everyone on it has no queue now
    del fake_ma.player_queues[SYNCGROUP]
    cb(_ev("player_updated", SYNCGROUP, {"player_id": SYNCGROUP}))
    got = [(await ws.receive_json())["event"] for _ in range(4)]
    assert got[0]["kind"] == "event"
    assert {(g["player_id"], g["queue_id"]) for g in got[1:]} == {
        (PLAYER_B, None), (SYNCGROUP, None), ("player_c_placeholder", None)}
    assert [g["seq"] for g in got] == [11, 12, 13, 14]
    assert fake_ma.calls == []
    await _call(ws, type="unsubscribe_events", subscription=res["id"])


async def test_unreadable_player_active_queue_is_not_sent(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    """#105: a non-admin gets neither the queue nor the player nor the active queue of a player it may not read."""
    unmapped = "player_without_entity_placeholder"
    fake_ma.players[PLAYER_A] = {"player_id": PLAYER_A, "active_source": None}
    fake_ma.player_queues[PLAYER_A] = {"queue_id": PLAYER_A, "active": True}
    fake_ma.players[unmapped] = {"player_id": unmapped, "active_source": None}
    fake_ma.player_queues[unmapped] = {"queue_id": unmapped, "active": False}
    ws = await hass_ws_client(access_token=user_token[1])
    res, snap = await _subscribe(ws)
    assert {q["queue_id"] for q in snap["queues"]} == {PLAYER_A}
    assert {p["player_id"] for p in snap["players"]} == {PLAYER_A}
    assert snap["active_queues"] == {PLAYER_A: PLAYER_A}
    cb = fake_ma.subs[0][0]
    fake_ma.player_queues[unmapped]["active"] = True
    cb(_ev("queue_updated", unmapped, {"queue_id": unmapped, "active": True}))  # nothing at all, no number used up
    fake_ma.player_queues[PLAYER_A]["active"] = False
    cb(_ev("queue_updated", PLAYER_A, {"queue_id": PLAYER_A, "active": False}))
    got = [(await ws.receive_json())["event"] for _ in range(2)]
    assert got[0]["seq"] == 2 and got[0]["kind"] == "event" and got[0]["object_id"] == PLAYER_A
    assert got[1] == {"seq": 3, "kind": "active_queue", "player_id": PLAYER_A, "queue_id": None}
    await _call(ws, type="unsubscribe_events", subscription=res["id"])


async def test_restart_starts_over_on_the_new_client(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    """After MA comes back the fresh snapshot carries the new client's active queues, and changes compare against it."""
    _seed(fake_ma)
    ws = await hass_ws_client(access_token=admin_token[1])
    res, _snap = await _subscribe(ws)
    _go_offline(hass, ma_entry)
    assert (await ws.receive_json())["event"] == {"seq": 2, "kind": "offline"}

    new = FakeMa()
    new.players[PLAYER_A] = {"player_id": PLAYER_A, "active_source": None}
    new.player_queues[PLAYER_A] = {"queue_id": PLAYER_A, "active": True}
    _come_back(hass, ma_entry, new)
    snap = (await ws.receive_json())["event"]
    assert snap["seq"] == 3 and snap["kind"] == "snapshot" and snap["active_queues"] == {PLAYER_A: PLAYER_A}

    new.subs[0][0](_ev("player_updated", PLAYER_A, {"player_id": PLAYER_A, "volume_level": 5}))  # nothing moved
    new.player_queues[PLAYER_A]["active"] = False
    new.subs[0][0](_ev("queue_updated", PLAYER_A, {"queue_id": PLAYER_A, "active": False}))
    got = [(await ws.receive_json())["event"] for _ in range(3)]
    assert [g["kind"] for g in got] == ["event", "event", "active_queue"]
    assert got[2] == {"seq": 6, "kind": "active_queue", "player_id": PLAYER_A, "queue_id": None}
    await _call(ws, type="unsubscribe_events", subscription=res["id"])


async def test_old_subscribe_queue_still_registered(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    """The card no longer uses it; a cached older card still gets its answer for one more release."""
    fake_ma.players[PLAYER_A] = {"player_id": PLAYER_A, "active_source": None}
    fake_ma.player_queues[PLAYER_A] = {"queue_id": PLAYER_A, "active": True}
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_queue", entity_id=ENTITY_A)
    assert res["success"] and res["result"] == {"queue_id": PLAYER_A}
    caps = await _call(ws, type="jukebox_kiosk/capabilities")
    assert caps["result"]["features"]["queue_push"] is True
    await _call(ws, type="unsubscribe_events", subscription=res["id"])

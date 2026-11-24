"""#100: one active-queue rule (Music Assistant app 2.17.297.post3 helpers.ts resolvePlayerQueue), used by every command."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from homeassistant.core import HomeAssistant

from custom_components.jukebox_kiosk.players import active_queue_id

from .conftest import ENTITY_A, ENTITY_G, PLAYER_A, PLAYER_B, SYNCGROUP, FakeMa, FakePlayers, FakeQueues

pytestmark = pytest.mark.usefixtures("kiosk")

NO_QUEUE = "Nothing queued on this speaker"


def _client(players: dict[str, Any], queues: dict[str, Any]) -> Any:
    return SimpleNamespace(players=FakePlayers(players), player_queues=FakeQueues(queues))


@pytest.mark.parametrize(
    ("player", "queues", "expected"),
    [
        # 1. active_source naming a queue: that queue (a group member points at its group, a follower at its leader)
        ({"active_source": SYNCGROUP}, {SYNCGROUP: {"active": True}, PLAYER_A: {"active": True}}, SYNCGROUP),
        ({"active_source": PLAYER_A}, {PLAYER_A: {"active": False}}, PLAYER_A),
        # an external source (Spotify Connect, AirPlay, line-in): no queue, even with an active own queue
        ({"active_source": "spotify_connect"}, {PLAYER_A: {"active": True}}, None),
        # 2. no active_source: own queue only when it is active
        ({"active_source": None}, {PLAYER_A: {"active": True}}, PLAYER_A),
        ({"active_source": ""}, {PLAYER_A: {"active": True}}, PLAYER_A),
        ({"active_source": None}, {PLAYER_A: {"active": False}}, None),
        ({}, {PLAYER_A: {}}, None),
        # 3. otherwise none
        ({"active_source": None}, {}, None),
    ],
)
def test_rule(player: dict[str, Any], queues: dict[str, Any], expected: str | None) -> None:
    assert active_queue_id(_client({PLAYER_A: {"player_id": PLAYER_A, **player}}, queues), PLAYER_A) == expected


def test_rule_unknown_player_and_models() -> None:
    assert active_queue_id(_client({}, {PLAYER_A: {"active": True}}), PLAYER_A) is None
    # music-assistant-client keeps models, not dicts
    models = _client({PLAYER_A: SimpleNamespace(active_source=None)}, {PLAYER_A: SimpleNamespace(active=True)})
    assert active_queue_id(models, PLAYER_A) == PLAYER_A


def _idle(fake_ma: FakeMa, pid: str = PLAYER_A) -> None:
    fake_ma.players[pid] = {"player_id": pid, "active_source": None}
    fake_ma.player_queues[pid] = {"queue_id": pid, "active": False}


def _set(fake_ma: FakeMa, pid: str, source: str | None, active: bool = True) -> None:
    fake_ma.players[pid] = {"player_id": pid, "active_source": source}
    fake_ma.player_queues.setdefault(pid, {"queue_id": pid, "active": active})


async def _call(ws: Any, **msg: Any) -> dict[str, Any]:
    await ws.send_json_auto_id(msg)
    return await ws.receive_json()


async def test_queue_items_follows_group(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    """A speaker in a group shows the group's queue; HA's active_queue attribute is not read."""
    _set(fake_ma, PLAYER_A, SYNCGROUP)
    fake_ma.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True}
    hass.states.async_set(ENTITY_A, "playing", {"active_queue": PLAYER_B})
    ws = await hass_ws_client(access_token=admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_A)
    assert res["success"] and res["result"]["queue_id"] == SYNCGROUP and "no_queue" not in res["result"]
    assert [kw["queue_id"] for c, kw in fake_ma.calls if c.startswith("player_queues/")] == [SYNCGROUP, SYNCGROUP]


async def test_queue_items_no_queue_is_normal(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    _idle(fake_ma)
    hass.states.async_set(ENTITY_A, "idle", {"active_queue": PLAYER_A})
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_A)
    assert res["success"]
    assert res["result"]["no_queue"] is True and res["result"]["queue_id"] is None
    assert res["result"]["items"] == [] and res["result"]["total"] == 0
    assert fake_ma.calls == []


@pytest.mark.parametrize(
    "msg",
    [
        {"type": "jukebox_kiosk/set_autoplay", "enabled": True},
        {"type": "jukebox_kiosk/autoplay_options"},
        {"type": "jukebox_kiosk/set_autoplay_mode", "mode": "auto"},
    ],
)
async def test_autoplay_needs_a_queue(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa, msg: dict[str, Any]) -> None:
    _set(fake_ma, PLAYER_A, "spotify_connect")
    ws = await hass_ws_client(access_token=admin_token[1])
    res = await _call(ws, entity_id=ENTITY_A, **msg)
    assert not res["success"] and res["error"] == {"code": "no_queue", "message": NO_QUEUE}
    assert fake_ma.calls == []


async def test_autoplay_uses_the_active_queue(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    _set(fake_ma, PLAYER_A, SYNCGROUP)
    fake_ma.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True}
    ws = await hass_ws_client(access_token=admin_token[1])
    assert (await _call(ws, type="jukebox_kiosk/set_autoplay", entity_id=ENTITY_A, enabled=False))["result"]["queue_id"] == SYNCGROUP
    assert (await _call(ws, type="jukebox_kiosk/autoplay_options", entity_id=ENTITY_A))["result"]["queue_id"] == SYNCGROUP
    assert {kw.get("queue_id") for c, kw in fake_ma.calls if "queue" in c and "core" not in c} == {SYNCGROUP}


@pytest.mark.parametrize("kind", ["favorite_current", "unfavorite_current"])
async def test_favorites_need_a_queue(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa, kind: str) -> None:
    _idle(fake_ma)
    ws = await hass_ws_client(access_token=admin_token[1])
    res = await _call(ws, type=f"jukebox_kiosk/{kind}", entity_id=ENTITY_A)
    assert res["error"]["code"] == "not_found" and res["error"]["message"] == "Nothing is playing"
    assert fake_ma.calls == []


async def test_favorite_uses_the_active_queue(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    _set(fake_ma, PLAYER_A, SYNCGROUP)
    fake_ma.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True}
    ws = await hass_ws_client(access_token=admin_token[1])
    assert (await _call(ws, type="jukebox_kiosk/favorite_current", entity_id=ENTITY_A))["success"]
    assert fake_ma.calls[0] == ("player_queues/get", {"queue_id": SYNCGROUP})


async def test_active_queue_command(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    _set(fake_ma, PLAYER_A, SYNCGROUP)
    fake_ma.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True}
    _idle(fake_ma, PLAYER_B)
    ws = await hass_ws_client(access_token=user_token[1])
    assert (await _call(ws, type="jukebox_kiosk/active_queue", entity_id=ENTITY_A))["result"] == {"queue_id": SYNCGROUP}
    assert (await _call(ws, type="jukebox_kiosk/active_queue", entity_id="media_player.den"))["result"] == {"queue_id": None}
    caps = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert caps["features"]["active_queue"] is True
    assert fake_ma.calls == []


async def test_active_queue_refuses_non_ma_entity(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    from homeassistant.helpers import entity_registry as er

    er.async_get(hass).async_get_or_create("media_player", "cast", "cast_uid_placeholder", suggested_object_id="kitchen_2")
    hass.states.async_set("media_player.kitchen_2", "playing", {"active_queue": PLAYER_A})
    ws = await hass_ws_client(access_token=admin_token[1])
    for kind in ("active_queue", "subscribe_queue", "favorite_current"):
        res = await _call(ws, type=f"jukebox_kiosk/{kind}", entity_id="media_player.kitchen_2")
        assert res["error"]["code"] == "not_found", kind
    assert fake_ma.calls == [] and fake_ma.subs == []


async def test_subscribe_queue_follows_the_music(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    """Joining a group, leaving it and an external source each move the followed queue; old-queue changes stay quiet."""
    _set(fake_ma, PLAYER_A, PLAYER_A)
    fake_ma.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True}
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_queue", entity_id=ENTITY_A)
    assert res["result"] == {"queue_id": PLAYER_A}
    cb = fake_ma.subs[0][0]

    def fire(name: str, oid: str) -> None:
        cb(SimpleNamespace(event=SimpleNamespace(value=name), object_id=oid))

    fire("queue_items_updated", PLAYER_B)  # someone else's queue: nothing
    fire("queue_items_updated", PLAYER_A)
    assert (await ws.receive_json())["event"] == {"event": "queue_items_updated", "queue_id": PLAYER_A}

    fake_ma.players[PLAYER_A]["active_source"] = SYNCGROUP  # joins the group (MA sends player_updated)
    fire("player_updated", PLAYER_A)
    assert (await ws.receive_json())["event"] == {"event": "queue_changed", "queue_id": SYNCGROUP}
    fire("player_updated", PLAYER_A)  # nothing moved: nothing sent
    fire("queue_items_updated", PLAYER_A)  # its own (now unused) queue: nothing
    fire("queue_updated", SYNCGROUP)
    assert (await ws.receive_json())["event"] == {"event": "queue_updated", "queue_id": SYNCGROUP}

    fake_ma.players[PLAYER_A]["active_source"] = "airplay_source"  # an external source takes over
    fire("player_updated", PLAYER_A)
    assert (await ws.receive_json())["event"] == {"event": "queue_changed", "queue_id": None}
    fire("queue_items_updated", PLAYER_A)
    fire("queue_items_updated", SYNCGROUP)

    fake_ma.players[PLAYER_A]["active_source"] = None  # back home, own queue active again
    fire("queue_updated", PLAYER_A)
    assert (await ws.receive_json())["event"] == {"event": "queue_changed", "queue_id": PLAYER_A}
    await _call(ws, type="unsubscribe_events", subscription=res["id"])
    assert fake_ma.subs == []
    assert fake_ma.calls == []


async def test_group_entity_own_queue(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    _set(fake_ma, SYNCGROUP, SYNCGROUP)
    ws = await hass_ws_client(access_token=user_token[1])
    assert (await _call(ws, type="jukebox_kiosk/active_queue", entity_id=ENTITY_G))["result"] == {"queue_id": SYNCGROUP}

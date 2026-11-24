"""2.4: Music Assistant offline, and the live subscriptions moving to the new client Home Assistant makes.

When MA drops out, Home Assistant reloads its music_assistant entry (unload, then setup, setup_retry while MA is away)
and builds a brand-new client. These tests walk the entry through those states, as HA 2026.11 does, and swap in a new
fake client, then check that subscribe_ma_status, subscribe_live and subscribe_queue tell the card and come back on the
new client with fresh state.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

from custom_components.jukebox_kiosk.link import DATA_LINKS, async_get_link

from .conftest import ENTITY_A, MA_ENTRY_ID, PLAYER_A, SYNCGROUP, FakeMa, seed_playing

pytestmark = pytest.mark.usefixtures("kiosk")


async def _call(ws: Any, **msg: Any) -> dict[str, Any]:
    await ws.send_json_auto_id(msg)
    return await ws.receive_json()


def _ev(name: str, object_id: str | None, data: Any = None) -> Any:
    return SimpleNamespace(event=SimpleNamespace(value=name), object_id=object_id, data=data)


def _go_offline(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    """MA dropped out: HA's listen task ends and it reloads the entry; MA is still away, so setup is retried later."""
    for state in (ConfigEntryState.UNLOAD_IN_PROGRESS, ConfigEntryState.NOT_LOADED,
                  ConfigEntryState.SETUP_IN_PROGRESS, ConfigEntryState.SETUP_RETRY):
        entry.mock_state(hass, state)


def _come_back(hass: HomeAssistant, entry: MockConfigEntry, client: FakeMa) -> None:
    """MA is back: HA's setup builds a new client, waits for its first sync, then the entry is loaded."""
    entry.mock_state(hass, ConfigEntryState.SETUP_IN_PROGRESS)
    entry.runtime_data = SimpleNamespace(mass=client)
    entry.mock_state(hass, ConfigEntryState.LOADED)


def _new_client() -> FakeMa:
    new = FakeMa()
    new.players[PLAYER_A] = {"player_id": PLAYER_A, "name": "Kitchen", "active_source": SYNCGROUP}
    new.players[SYNCGROUP] = {"player_id": SYNCGROUP, "name": "Everywhere", "type": "group", "active_source": SYNCGROUP}
    new.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True, "items": 7}
    return new


async def test_capability(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/capabilities")
    assert res["result"]["features"]["ma_status"] is True


async def test_status_follows_the_connection(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    """One "false" when HA's MA entry stops being loaded, one "true" once a new client is loaded. No MA call."""
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_ma_status")
    assert res["success"]
    assert (await ws.receive_json())["event"] == {"connected": True}
    _go_offline(hass, ma_entry)
    assert (await ws.receive_json())["event"] == {"connected": False}
    new = _new_client()
    _come_back(hass, ma_entry, new)
    assert (await ws.receive_json())["event"] == {"connected": True}
    assert fake_ma.calls == [] and new.calls == []
    await _call(ws, type="unsubscribe_events", subscription=res["id"])
    assert hass.data[DATA_LINKS][MA_ENTRY_ID]._listeners == []


async def test_live_feed_moves_to_the_new_client(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    """offline, then a fresh snapshot from the new client on the same subscription; the old client is let go."""
    seed_playing(fake_ma)
    ws = await hass_ws_client(access_token=admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert res["success"]
    assert (await ws.receive_json())["event"]["kind"] == "snapshot"
    old_cb = fake_ma.subs[0][0]

    _go_offline(hass, ma_entry)
    assert (await ws.receive_json())["event"] == {"seq": 2, "kind": "offline"}
    assert fake_ma.subs == []  # the dead client holds no listener of ours
    old_cb(_ev("player_updated", PLAYER_A, {"player_id": PLAYER_A}))  # a late message from the old client: dropped

    new = _new_client()
    _come_back(hass, ma_entry, new)
    snap = (await ws.receive_json())["event"]
    assert snap["seq"] == 3 and snap["kind"] == "snapshot"
    assert {p["player_id"] for p in snap["players"]} == {PLAYER_A, SYNCGROUP}  # the new client's lists, not the old
    assert snap["queues"] == [{"queue_id": SYNCGROUP, "active": True, "items": 7}]
    assert len(new.subs) == 1 and new.subs[0][2] is None

    new.subs[0][0](_ev("player_updated", PLAYER_A, {"player_id": PLAYER_A, "volume_level": 30}))
    ev = (await ws.receive_json())["event"]
    assert ev["seq"] == 4 and ev["event"] == "player_updated" and ev["data"]["volume_level"] == 30
    assert fake_ma.calls == [] and new.calls == []

    await _call(ws, type="unsubscribe_events", subscription=res["id"])
    assert new.subs == []
    assert hass.data[DATA_LINKS][MA_ENTRY_ID]._listeners == []


async def test_queue_push_moves_to_the_new_client(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    """offline, then queue_changed with the new client's active queue (always sent, so the card reads it fresh)."""
    seed_playing(fake_ma, PLAYER_A)
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_queue", entity_id=ENTITY_A)
    assert res["result"] == {"queue_id": PLAYER_A}

    _go_offline(hass, ma_entry)
    assert (await ws.receive_json())["event"] == {"event": "offline", "queue_id": None}
    assert fake_ma.subs == []

    new = FakeMa()
    seed_playing(new, PLAYER_A)  # the same queue id after the restart: still announced
    _come_back(hass, ma_entry, new)
    assert (await ws.receive_json())["event"] == {"event": "queue_changed", "queue_id": PLAYER_A}
    cb = new.subs[0][0]
    cb(_ev("queue_items_updated", PLAYER_A))
    assert (await ws.receive_json())["event"] == {"event": "queue_items_updated", "queue_id": PLAYER_A}
    new.players[PLAYER_A]["active_source"] = SYNCGROUP
    new.player_queues[SYNCGROUP] = {"queue_id": SYNCGROUP, "active": True}
    cb(_ev("player_updated", PLAYER_A))
    assert (await ws.receive_json())["event"] == {"event": "queue_changed", "queue_id": SYNCGROUP}
    assert new.calls == []
    await _call(ws, type="unsubscribe_events", subscription=res["id"])
    assert new.subs == []


async def test_subscriptions_accepted_while_offline(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    """A kiosk that starts while MA is down subscribes anyway, hears "offline", and comes alive when MA returns."""
    _go_offline(hass, ma_entry)
    ws = await hass_ws_client(access_token=admin_token[1])
    status = await _call(ws, type="jukebox_kiosk/subscribe_ma_status")
    assert status["success"]
    assert (await ws.receive_json())["event"] == {"connected": False}
    live = await _call(ws, type="jukebox_kiosk/subscribe_live")
    assert live["success"]
    assert (await ws.receive_json())["event"] == {"seq": 1, "kind": "offline"}
    queue = await _call(ws, type="jukebox_kiosk/subscribe_queue", entity_id=ENTITY_A)
    assert queue["result"] == {"queue_id": None}
    assert (await ws.receive_json())["event"] == {"event": "offline", "queue_id": None}
    # one-shot commands still fail plainly while offline
    res = await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_A)
    assert res["error"]["code"] == "ma_unavailable"

    new = _new_client()
    _come_back(hass, ma_entry, new)
    got = {m["id"]: m["event"] for m in [await ws.receive_json() for _ in range(3)]}
    assert got[status["id"]] == {"connected": True}
    assert got[live["id"]]["seq"] == 2 and got[live["id"]]["kind"] == "snapshot"
    assert got[queue["id"]] == {"event": "queue_changed", "queue_id": SYNCGROUP}
    assert len(new.subs) == 2


async def test_ended_subscription_does_not_reattach(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    ws = await hass_ws_client(access_token=admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_live")
    await ws.receive_json()
    _go_offline(hass, ma_entry)
    await ws.receive_json()
    await _call(ws, type="unsubscribe_events", subscription=res["id"])
    new = _new_client()
    _come_back(hass, ma_entry, new)
    assert new.subs == []
    assert hass.data[DATA_LINKS][MA_ENTRY_ID]._listeners == []


async def test_link_lookup_and_old_listener_already_gone(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    """The link uses the commands' own client lookup; a dead client that already dropped our listener is fine."""
    link = async_get_link(hass, MA_ENTRY_ID)
    assert link is async_get_link(hass, MA_ENTRY_ID)
    assert link.client is fake_ma and link.connected
    ws = await hass_ws_client(access_token=admin_token[1])
    await _call(ws, type="jukebox_kiosk/subscribe_live")
    await ws.receive_json()
    fake_ma.subs.clear()  # the old client forgot its listeners on its own
    _go_offline(hass, ma_entry)
    assert (await ws.receive_json())["event"]["kind"] == "offline"
    assert link.client is None and not link.connected
    new = _new_client()
    _come_back(hass, ma_entry, new)
    assert (await ws.receive_json())["event"]["kind"] == "snapshot"
    assert link.client is new


async def test_listener_error_does_not_stop_others(
    hass: HomeAssistant, ma_entry: MockConfigEntry, fake_ma: FakeMa
) -> None:
    link = async_get_link(hass, MA_ENTRY_ID)
    heard: list[Any] = []

    def boom(_client: Any) -> None:
        raise RuntimeError("boom")

    link.async_listen(boom)
    link.async_listen(heard.append)
    _go_offline(hass, ma_entry)
    assert heard == [None]


async def test_non_ma_entity_refused_before_attaching(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    """Non-MA entities are still refused by subscribe_queue, before anything is attached."""
    ws = await hass_ws_client(access_token=user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_queue", entity_id="media_player.kitchen_2")
    assert res["error"]["code"] == "not_found"
    assert fake_ma.subs == [] and hass.data[DATA_LINKS][MA_ENTRY_ID]._listeners == []

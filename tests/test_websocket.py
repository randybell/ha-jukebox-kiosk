"""Websocket allowlist, permission classes and shapes."""

from __future__ import annotations

from typing import Any

import pytest

from homeassistant.core import HomeAssistant

from .conftest import ENTITY_A, ENTITY_G, PLAYER_A, PLAYER_B, SYNCGROUP, FakeMa

pytestmark = pytest.mark.usefixtures("kiosk")


async def _ws(hass_ws_client: Any, token: str) -> Any:
    return await hass_ws_client(access_token=token)


async def _call(ws: Any, **msg: Any) -> dict[str, Any]:
    await ws.send_json_auto_id(msg)
    return await ws.receive_json()


async def test_capabilities_admin(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/capabilities")
    assert res["success"]
    r = res["result"]
    assert r["backend"] == "kiosk" and r["version"] == "0.6.0" and r["ma_connected"]
    assert not r["guest"] and "admin" in r["classes"]
    assert r["features"]["unfavorite"] and r["features"]["queue_edit"]
    assert "player_queues/play_index" in r["commands"]
    assert all(c not in r["commands"] for c in r["todo_verify"])


async def test_capabilities_guest_default(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert r["guest"]
    assert r["classes"] == ["playback", "queue", "read", "speakers"]
    assert not r["features"]["unfavorite"] and not r["features"]["library_write"]
    assert "music/favorites/add_item" not in r["commands"]


async def test_not_allowlisted_refused(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    for cmd in ("auth/users", "config/providers/remove", "players/remove", "music/sync", "made/up"):
        res = await _call(ws, type="jukebox_kiosk/ma", command=cmd, args={})
        assert not res["success"] and res["error"]["code"] == "not_allowed", cmd
    assert fake_ma.calls == []


async def test_reserved_args_refused(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/search", args={"search_query": "x", "user": "someone"})
    assert res["error"]["code"] == "invalid_args"
    assert fake_ma.calls == []


async def test_guest_allowed_queue_edit(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="player_queues/move_item",
                      args={"queue_id": PLAYER_A, "queue_item_id": "qi1", "pos_shift": 1})
    assert res["success"], res
    assert fake_ma.calls[-1] == ("player_queues/move_item", {"queue_id": PLAYER_A, "queue_item_id": "qi1", "pos_shift": 1})


async def test_non_admin_denied_library_write(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/add_item", args={"item": "library://track/1"})
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    res = await _call(ws, type="jukebox_kiosk/unfavorite_current", entity_id=ENTITY_A)
    assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


async def test_non_admin_denied_raw(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/raw", command="players/all", args={})
    assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


async def test_admin_raw_but_never_auth(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    assert (await _call(ws, type="jukebox_kiosk/raw", command="players/all", args={}))["success"]
    res = await _call(ws, type="jukebox_kiosk/raw", command="auth/users", args={})
    assert res["error"]["code"] == "not_allowed"


async def test_unknown_player_denied_for_non_admin(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="players/cmd/set_members",
                      args={"target_player": SYNCGROUP, "player_ids_to_add": ["hidden_player_placeholder"]})
    assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


async def test_set_members_allowed(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="players/cmd/set_members",
                      args={"target_player": SYNCGROUP, "player_ids_to_add": [PLAYER_B]})
    assert res["success"], res


async def test_impersonation_only_where_honoured(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    user, token = user_token
    ws = await _ws(hass_ws_client, token)
    await _call(ws, type="jukebox_kiosk/ma", command="music/search", args={"search_query": "rock"})
    assert fake_ma.calls[-1][1]["user"] == {"provider": "homeassistant", "user_id": user.id, "required": False}
    await _call(ws, type="jukebox_kiosk/ma", command="music/recently_played_items", args={"limit": 5})
    assert "user" not in fake_ma.calls[-1][1]


async def test_impersonation_old_server_plain_id(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    fake_ma.server_info.schema_version = 40  # soft LinkedUser on old server -> dropped
    ws = await _ws(hass_ws_client, user_token[1])
    await _call(ws, type="jukebox_kiosk/ma", command="music/search", args={"search_query": "rock"})
    assert "user" not in fake_ma.calls[-1][1]


async def test_group_config_redacted_for_guest(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, admin_token: Any) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/ma", command="config/players/get", args={"player_id": SYNCGROUP}))["result"]
    assert set(r["values"]) == {"group_members", "dynamic_members"}
    ws2 = await _ws(hass_ws_client, admin_token[1])
    r = (await _call(ws2, type="jukebox_kiosk/ma", command="config/players/get", args={"player_id": SYNCGROUP}))["result"]
    assert "secret_thing" in r["values"]


async def test_lyrics_library_track_refused(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="metadata/get_track_lyrics",
                      args={"track": {"uri": "library://track/1", "provider": "library"}})
    assert res["error"]["code"] == "library_track"
    res = await _call(ws, type="jukebox_kiosk/ma", command="metadata/get_track_lyrics",
                      args={"track": {"uri": "spotify://track/x", "provider": "spotify"}})
    assert res["success"]
    assert [c for c, _ in fake_ma.calls] == ["metadata/get_track_lyrics"]


async def test_queue_items_shape(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_A, limit_before=1, limit_after=3)
    r = res["result"]
    assert r["current_index"] == 4 and r["total"] == 10 and r["offset"] == 3
    assert [i["queue_item_id"] for i in r["items"]] == ["qi3", "qi4", "qi5", "qi6", "qi7"]
    first = r["items"][0]
    assert first == {"queue_item_id": "qi3", "media_title": "Song 3", "media_album_name": "Album",
                     "media_artist": "Artist", "media_content_id": "library://track/3",
                     "media_image": "https://img.example/a.jpg", "favorite": False, "duration": 180}
    assert ("player_queues/items", {"queue_id": PLAYER_A, "limit": 5, "offset": 3}) in fake_ma.calls


async def test_queue_items_not_ma_entity(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/queue_items", entity_id="media_player.not_ma")
    assert res["error"]["code"] == "not_found"


async def test_item_tracks_paged(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/item_tracks", uri="spotify://playlist/abc", page=3, page_size=100))["result"]
    assert r["total"] == 250 and r["page"] == 3 and not r["more"]
    assert len(r["tracks"]) == 50 and r["tracks"][0]["position"] == 201
    assert fake_ma.calls[-1] == ("music/playlists/playlist_tracks", {"item_id": "abc", "provider_instance_id_or_domain": "spotify"})
    bad = await _call(ws, type="jukebox_kiosk/item_tracks", uri="spotify://track/abc")
    assert bad["error"]["code"] == "unsupported"


async def test_unfavorite_current_admin(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/unfavorite_current", entity_id=ENTITY_A)
    assert res["success"], res
    assert fake_ma.calls[-1] == ("music/favorites/remove_item", {"media_type": "track", "library_item_id": "4"})


async def test_subscribe_queue_push(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    from types import SimpleNamespace

    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/subscribe_queue", entity_id=ENTITY_G)
    assert res["success"] and res["result"]["queue_id"] == SYNCGROUP
    cb, events, id_filter = fake_ma.subs[0]
    assert id_filter == SYNCGROUP and {e.value for e in events} == {"queue_updated", "queue_items_updated"}
    cb(SimpleNamespace(event=SimpleNamespace(value="queue_items_updated"), object_id=SYNCGROUP))
    ev = await ws.receive_json()
    assert ev["type"] == "event" and ev["event"] == {"event": "queue_items_updated", "queue_id": SYNCGROUP}
    await _call(ws, type="unsubscribe_events", subscription=res["id"])
    assert fake_ma.subs == []


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["read"]}])
async def test_read_only_guest_cannot_play(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="player_queues/play_index", args={"queue_id": PLAYER_A, "index": 1})
    assert res["error"]["code"] == "unauthorized"
    assert (await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_A))["success"]


async def test_ma_not_loaded(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, ma_entry: Any) -> None:
    from homeassistant.config_entries import ConfigEntryState

    ma_entry.mock_state(hass, ConfigEntryState.NOT_LOADED)
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="players/all", args={})
    assert res["error"]["code"] == "ma_unavailable"
    caps = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert caps["ma_connected"] is False

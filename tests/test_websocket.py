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
    assert r["todo_verify"] == []
    for cmd in ("music/genres/overview", "music/podcasts/library_items", "music/audiobooks/library_items", "music/item_by_uri"):
        assert cmd in r["commands"], cmd
    assert r["features"]["genre_overview"] and r["features"]["podcast_library"] and r["features"]["audiobook_library"]


async def test_capabilities_guest_default(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert r["guest"]
    assert r["classes"] == ["library", "playback", "queue", "read"]
    f = r["features"]
    assert f["unfavorite"] and f["library_write"] and f["queue_edit"] and f["undo"]
    assert not f["speakers"]
    assert "music/favorites/add_item" in r["commands"] and "music/favorites/remove_item" in r["commands"]
    for cmd in ("players/cmd/set_members", "player_queues/transfer", "players/cmd/stop"):
        assert cmd not in r["commands"], cmd


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


async def test_guest_default_library_write(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    """Default guests may favourite and unfavourite (Library class)."""
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/add_item", args={"item": "library://track/1"})
    assert res["success"], res
    assert fake_ma.calls[-1] == ("music/favorites/add_item", {"item": "library://track/1"})
    res = await _call(ws, type="jukebox_kiosk/unfavorite_current", entity_id=ENTITY_A)
    assert res["success"], res
    assert fake_ma.calls[-1][0] == "music/favorites/remove_item"


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["read", "playback", "queue"]}])
async def test_guest_without_library_denied(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
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


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True,
                                      "guest_classes": ["read", "playback", "queue", "speakers"]}])
async def test_unknown_player_denied_for_non_admin(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="players/cmd/set_members",
                      args={"target_player": SYNCGROUP, "player_ids_to_add": ["hidden_player_placeholder"]})
    assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


async def test_guest_default_cannot_regroup(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    """Default guests have no Speakers class: set_members, transfer and stop are refused before MA is called."""
    ws = await _ws(hass_ws_client, user_token[1])
    for cmd, args in (
        ("players/cmd/set_members", {"target_player": SYNCGROUP, "player_ids_to_add": [PLAYER_B]}),
        ("players/cmd/set_members", {"target_player": SYNCGROUP, "player_ids_to_remove": [PLAYER_A]}),
        ("player_queues/transfer", {"source_queue_id": SYNCGROUP, "target_queue_id": PLAYER_A}),
        ("players/cmd/stop", {"player_id": SYNCGROUP}),
    ):
        res = await _call(ws, type="jukebox_kiosk/ma", command=cmd, args=args)
        assert not res["success"] and res["error"]["code"] == "unauthorized", (cmd, res)
    res = await _call(ws, type="jukebox_kiosk/raw", command="players/cmd/set_members",
                      args={"target_player": SYNCGROUP, "player_ids_to_add": [PLAYER_B]})
    assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


async def test_admin_set_members_allowed(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="players/cmd/set_members",
                      args={"target_player": SYNCGROUP, "player_ids_to_add": [PLAYER_B]})
    assert res["success"], res


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True,
                                      "guest_classes": ["read", "playback", "queue", "speakers"]}])
async def test_set_members_allowed_when_speakers_granted(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
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


async def test_item_by_uri_forces_allow_update_metadata_false(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/item_by_uri", args={"uri": "apple_music://track/XXXXXXXX"})
    assert res["success"]
    assert fake_ma.calls[-1] == ("music/item_by_uri", {"uri": "apple_music://track/XXXXXXXX", "allow_update_metadata": False})
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/item_by_uri",
                      args={"uri": "apple_music://track/XXXXXXXX", "allow_update_metadata": False})
    assert res["success"] and fake_ma.calls[-1][1]["allow_update_metadata"] is False
    n = len(fake_ma.calls)
    for bad in (True, 1, "yes"):
        res = await _call(ws, type="jukebox_kiosk/ma", command="music/item_by_uri",
                          args={"uri": "apple_music://track/XXXXXXXX", "allow_update_metadata": bad})
        assert not res["success"] and res["error"]["code"] == "invalid_args", bad
    assert len(fake_ma.calls) == n


async def test_allow_update_metadata_true_refused_everywhere(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa
) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/genres/overview",
                      args={"item_id": "1", "allow_update_metadata": True})
    assert res["error"]["code"] == "invalid_args"
    assert fake_ma.calls == []


async def test_verified_followup_commands_forwarded(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    user, token = user_token
    ws = await _ws(hass_ws_client, token)
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/genres/overview",
                      args={"item_id": "6", "provider_instance_id_or_domain": "library", "limit": 25})
    assert res["success"]
    assert fake_ma.calls[-1] == ("music/genres/overview", {"item_id": "6", "provider_instance_id_or_domain": "library", "limit": 25})
    for cmd in ("music/podcasts/library_items", "music/audiobooks/library_items"):
        res = await _call(ws, type="jukebox_kiosk/ma", command=cmd, args={"limit": 500, "offset": 0, "summary": False})
        assert res["success"], cmd
        c, args = fake_ma.calls[-1]
        assert c == cmd and args["summary"] is False and args["limit"] == 500
        assert args["user"] == {"provider": "homeassistant", "user_id": user.id, "required": False}

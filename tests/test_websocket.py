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
    assert r["backend"] == "kiosk" and r["version"] == "0.7.3" and r["ma_connected"]
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


async def test_search_radio_heart_commands(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    """0.6.2 Search radio heart: a provider station uri is favourited as is, a library station removed by id (Library class)."""
    ws = await _ws(hass_ws_client, user_token[1])
    caps = await _call(ws, type="jukebox_kiosk/capabilities")
    assert caps["result"]["features"]["library_write"]
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/add_item", args={"item": "radiobrowser://radio/00000000-0000-0000-0000-000000000001"})
    assert res["success"], res
    assert fake_ma.calls[-1] == ("music/favorites/add_item", {"item": "radiobrowser://radio/00000000-0000-0000-0000-000000000001"})
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/remove_item", args={"media_type": "radio", "library_item_id": "7"})
    assert res["success"], res
    assert fake_ma.calls[-1] == ("music/favorites/remove_item", {"media_type": "radio", "library_item_id": "7"})


async def test_radio_heart_lookup_then_remove(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    """v0.7 heart: un-hearting a provider station first looks up its library copy (music/item_by_uri, Read class,
    allow_update_metadata forced False), then removes the favourite by library id (Library class). No new command."""
    ws = await _ws(hass_ws_client, user_token[1])
    uri = "radiobrowser://radio/00000000-0000-0000-0000-000000000001"
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/item_by_uri", args={"uri": uri})
    assert res["success"], res
    assert fake_ma.calls[-1] == ("music/item_by_uri", {"uri": uri, "allow_update_metadata": False})
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/remove_item", args={"media_type": "radio", "library_item_id": "7"})
    assert res["success"], res
    assert fake_ma.calls[-1] == ("music/favorites/remove_item", {"media_type": "radio", "library_item_id": "7"})


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["read", "playback", "queue"]}])
async def test_radio_heart_lookup_is_read_class_only(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    """Without the Library class the lookup (a read) still works, but the remove is refused and never reaches MA."""
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/item_by_uri", args={"uri": "radiobrowser://radio/00000000-0000-0000-0000-000000000001"})
    assert res["success"], res
    n = len(fake_ma.calls)
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/remove_item", args={"media_type": "radio", "library_item_id": "7"})
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    assert len(fake_ma.calls) == n


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["read", "playback", "queue"]}])
async def test_search_radio_heart_hidden_without_library(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    """Without the Library class the card gets library_write False (no heart) and the server refuses the write anyway."""
    ws = await _ws(hass_ws_client, user_token[1])
    caps = await _call(ws, type="jukebox_kiosk/capabilities")
    assert caps["result"]["features"]["library_write"] is False
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/add_item", args={"item": "radiobrowser://radio/00000000-0000-0000-0000-000000000001"})
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["read", "playback", "queue"]}])
async def test_guest_without_library_denied(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/favorites/add_item", args={"item": "library://track/1"})
    assert not res["success"] and res["error"]["code"] == "unauthorized"
    res = await _call(ws, type="jukebox_kiosk/unfavorite_current", entity_id=ENTITY_A)
    assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


async def test_raw_command_removed(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, user_token: Any,
                                   fake_ma: FakeMa) -> None:
    """jukebox_kiosk/raw bypassed the allowlist; it is no longer registered, for admins or anyone else."""
    for token in (admin_token[1], user_token[1]):
        ws = await _ws(hass_ws_client, token)
        res = await _call(ws, type="jukebox_kiosk/raw", command="players/all", args={})
        assert not res["success"] and res["error"]["code"] == "unknown_command", res
    assert fake_ma.calls == []


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


async def test_v07_discover_search_features(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    for flag in ("genres", "radio_browse", "discover", "resume"):
        assert r["features"][flag] is True, flag
    for cmd in ("music/browse", "music/recommendations", "music/recommendations/items", "music/in_progress_items",
                "music/genres/overview", "music/genres/tracks", "music/search"):
        assert cmd in r["commands"], cmd


@pytest.mark.parametrize(
    "options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["playback"]}]
)
async def test_v07_features_off_without_read(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    for flag in ("genres", "radio_browse", "discover", "resume"):
        assert r["features"][flag] is False, flag


async def test_v07_discover_reads_forwarded(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/recommendations", args={})
    assert res["success"] and fake_ma.calls[-1] == ("music/recommendations", {})
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/recommendations/items",
                      args={"provider": "recommendations", "item_id": "recently_played"})
    assert res["success"]
    assert fake_ma.calls[-1] == ("music/recommendations/items", {"provider": "recommendations", "item_id": "recently_played"})
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/search",
                      args={"search_query": "ja", "media_types": ["genre"], "limit": 5, "library_only": True})
    assert res["success"]
    c, args = fake_ma.calls[-1]
    assert c == "music/search" and args["media_types"] == ["genre"] and "user" in args


async def test_v07_browse_guest_radio_only(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    for path in ("radiobrowser://", "radiobrowser://category/country/xx", "radiobrowser://popularity/popular"):
        res = await _call(ws, type="jukebox_kiosk/ma", command="music/browse", args={"path": path})
        assert res["success"], path
        assert fake_ma.calls[-1] == ("music/browse", {"path": path})
    n = len(fake_ma.calls)
    for args in ({}, {"path": None}, {"path": ""}, {"path": "filesystem_local--x://"}, {"path": "builtin://"},
                 {"path": "RADIOBROWSER://"}, {"path": 5}, {"path": " radiobrowser://"}):
        res = await _call(ws, type="jukebox_kiosk/ma", command="music/browse", args=args)
        assert not res["success"] and res["error"]["code"] == "invalid_args", args
    assert len(fake_ma.calls) == n


async def test_v07_browse_admin_any_path(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa
) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    for args in ({}, {"path": "builtin://"}, {"path": "radiobrowser://tag/jazz"}):
        res = await _call(ws, type="jukebox_kiosk/ma", command="music/browse", args=args)
        assert res["success"], args
        assert fake_ma.calls[-1] == ("music/browse", args)


# ---- Autoplay ("Don't stop the music"), MA 2.10.9 player_queues/autoplay


async def test_capabilities_autoplay_follows_queue_class(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert r["features"]["autoplay"] is True
    assert "player_queues/autoplay" not in r["commands"] and "player_queues/dont_stop_the_music" not in r["commands"]


async def test_queue_items_autoplay_state(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_G))["result"]
    assert r["autoplay"] is True and r["dynamic"] is False and r["queue_id"] == SYNCGROUP
    fake_ma.autoplay_key = "dont_stop_the_music_enabled"
    assert (await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_G))["result"]["autoplay"] is True
    fake_ma.autoplay_key = None
    assert "autoplay" not in (await _call(ws, type="jukebox_kiosk/queue_items", entity_id=ENTITY_G))["result"]


async def test_set_autoplay_targets_entity_queue(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/set_autoplay", entity_id=ENTITY_G, enabled=True)
    assert res["success"], res
    assert res["result"] == {"queue_id": SYNCGROUP, "autoplay": True}
    assert fake_ma.calls == [("player_queues/autoplay", {"queue_id": SYNCGROUP, "autoplay_enabled": True})]


async def test_set_autoplay_legacy_alias_fallback(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    fake_ma.autoplay_error = "Invalid command: player_queues/autoplay"
    res = await _call(ws, type="jukebox_kiosk/set_autoplay", entity_id=ENTITY_A, enabled=False)
    assert res["success"], res
    assert [c for c, _ in fake_ma.calls] == ["player_queues/autoplay", "player_queues/dont_stop_the_music"]
    assert fake_ma.calls[-1][1] == {"queue_id": PLAYER_A, "dont_stop_the_music_enabled": False}


async def test_set_autoplay_other_errors_not_retried(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    fake_ma.autoplay_error = "boom"
    res = await _call(ws, type="jukebox_kiosk/set_autoplay", entity_id=ENTITY_A, enabled=True)
    assert res["error"]["code"] == "ma_error"
    assert [c for c, _ in fake_ma.calls] == ["player_queues/autoplay"]


async def test_set_autoplay_needs_bool(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    res = await _call(ws, type="jukebox_kiosk/set_autoplay", entity_id=ENTITY_A, enabled="yes")
    assert not res["success"] and fake_ma.calls == []


async def test_autoplay_not_forwarded_by_ma(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    for cmd in ("player_queues/autoplay", "player_queues/dont_stop_the_music"):
        res = await _call(ws, type="jukebox_kiosk/ma", command=cmd, args={"queue_id": PLAYER_B, "autoplay_enabled": True})
        assert res["error"]["code"] == "not_allowed", cmd
    assert fake_ma.calls == []


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["read", "playback"]}])
async def test_set_autoplay_needs_queue_class(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    assert (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]["features"]["autoplay"] is False
    res = await _call(ws, type="jukebox_kiosk/set_autoplay", entity_id=ENTITY_G, enabled=True)
    assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


# ---- Autoplay style (MA 2.10.9 config/player_queues/get_entries|get_value|save)


async def test_autoplay_options_follows_default(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    assert (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]["features"]["autoplay_mode"] is True
    res = await _call(ws, type="jukebox_kiosk/autoplay_options", entity_id=ENTITY_G)
    r = res["result"]
    assert r["queue_id"] == SYNCGROUP and r["mode"] == "auto" and r["follows_default"] is True and r["playlist"] is None
    assert [m["mode"] for m in r["modes"]] == ["auto", "similar", "library", "playlist"]  # never "global"
    assert all(m["available"] for m in r["modes"])
    assert r["playlists"] == [{"uri": "library://playlist/1", "name": "Sunday Morning Mix"},
                              {"uri": "library://playlist/2", "name": "Kitchen Dance Party"}]
    assert ("config/core/get_value", {"domain": "player_queues", "key": "autoplay_mode"}) in fake_ma.calls
    assert all(c[0] != "config/player_queues/save" for c in fake_ma.calls)


async def test_autoplay_options_pinned_and_similar_unavailable(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    fake_ma.ap_mode, fake_ma.ap_playlist, fake_ma.similar_available = "playlist", "library://playlist/2", False
    ws = await _ws(hass_ws_client, user_token[1])
    r = (await _call(ws, type="jukebox_kiosk/autoplay_options", entity_id=ENTITY_A))["result"]
    assert r["mode"] == "playlist" and r["follows_default"] is False
    assert r["playlist"] == {"uri": "library://playlist/2", "name": "Kitchen Dance Party"}
    assert {m["mode"]: m["available"] for m in r["modes"]}["similar"] is False
    assert all(c[0] != "config/core/get_value" for c in fake_ma.calls)


async def test_set_autoplay_mode_saves_two_keys(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/set_autoplay_mode", entity_id=ENTITY_G, mode="playlist",
                      playlist="library://playlist/1")
    assert res["result"] == {"queue_id": SYNCGROUP, "mode": "playlist", "follows_default": False,
                             "playlist": {"uri": "library://playlist/1", "name": "Sunday Morning Mix"}}
    saves = [c for c in fake_ma.calls if c[0] == "config/player_queues/save"]
    assert saves == [("config/player_queues/save", {"queue_id": SYNCGROUP, "values": {
        "autoplay_mode": "playlist", "autoplay_playlist": "library://playlist/1"}})]
    res = await _call(ws, type="jukebox_kiosk/set_autoplay_mode", entity_id=ENTITY_G, mode="library")
    assert res["result"]["mode"] == "library" and res["result"]["playlist"] is None
    assert fake_ma.calls[-1] == ("config/player_queues/save", {"queue_id": SYNCGROUP, "values": {"autoplay_mode": "library"}})


@pytest.mark.parametrize(
    ("args", "code"),
    [
        ({"mode": "playlist"}, "invalid_args"),
        ({"mode": "playlist", "playlist": "spotify://playlist/x"}, "invalid_args"),
        ({"mode": "library", "playlist": "library://playlist/1"}, "invalid_args"),
        ({"mode": "global"}, "invalid_format"),
        ({"mode": "venue"}, "invalid_format"),
        ({"mode": "auto", "queue_id": PLAYER_B}, "invalid_format"),
    ],
)
async def test_set_autoplay_mode_rejects(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa, args: dict[str, Any], code: str
) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/set_autoplay_mode", entity_id=ENTITY_A, **args)
    assert res["error"]["code"] == code
    assert all(c[0] != "config/player_queues/save" for c in fake_ma.calls)


async def test_set_autoplay_mode_similar_needs_provider(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    fake_ma.similar_available = False
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/set_autoplay_mode", entity_id=ENTITY_A, mode="similar")
    assert res["error"]["code"] == "unsupported"
    assert all(c[0] != "config/player_queues/save" for c in fake_ma.calls)


async def test_autoplay_mode_unsupported_server(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    fake_ma.ap_mode = None
    ws = await _ws(hass_ws_client, user_token[1])
    assert (await _call(ws, type="jukebox_kiosk/autoplay_options", entity_id=ENTITY_A))["error"]["code"] == "unsupported"
    res = await _call(ws, type="jukebox_kiosk/set_autoplay_mode", entity_id=ENTITY_A, mode="auto")
    assert res["error"]["code"] == "unsupported"


async def test_autoplay_config_not_forwarded_by_ma(hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, admin_token[1])
    for cmd in ("config/player_queues/save", "config/player_queues/get_entries", "config/player_queues/get_value",
                "config/core/get_value"):
        res = await _call(ws, type="jukebox_kiosk/ma", command=cmd, args={"queue_id": PLAYER_B})
        assert res["error"]["code"] == "not_allowed", cmd
    assert fake_ma.calls == []


@pytest.mark.parametrize("options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["read", "playback"]}])
async def test_autoplay_mode_needs_queue_class(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    assert (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]["features"]["autoplay_mode"] is False
    for msg in ({"type": "jukebox_kiosk/autoplay_options"}, {"type": "jukebox_kiosk/set_autoplay_mode", "mode": "auto"}):
        res = await _call(ws, entity_id=ENTITY_G, **msg)
        assert res["error"]["code"] == "unauthorized"
    assert fake_ma.calls == []


async def test_repeat_queue_command_not_forwarded(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    """0.6.5: there is no repeat path through the integration (the card uses media_player.repeat_set)."""
    ws = await _ws(hass_ws_client, user_token[1])
    for mode in ("one", "all", "off"):
        res = await _call(ws, type="jukebox_kiosk/ma", command="player_queues/repeat",
                          args={"queue_id": PLAYER_A, "repeat_mode": mode})
        assert not res["success"] and res["error"]["code"] == "not_allowed", mode
    caps = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert not any("repeat" in c for c in caps["commands"])
    assert fake_ma.calls == []


async def test_repeat_one_mapped_to_all_if_ever_forwarded(
    hass: HomeAssistant, hass_ws_client: Any, admin_token: Any, fake_ma: FakeMa, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If a repeat command is ever allowlisted, 'one' still goes to MA as 'all'."""
    from custom_components.jukebox_kiosk import const, websocket_api
    from custom_components.jukebox_kiosk.const import MaCommand, PermClass

    table = {**const.MA_COMMANDS, "player_queues/repeat": MaCommand(PermClass.PLAYBACK, "client")}
    monkeypatch.setattr(websocket_api, "MA_COMMANDS", table)
    ws = await _ws(hass_ws_client, admin_token[1])
    for sent, want in (("one", "all"), ("ONE", "all"), ("all", "all"), ("off", "off")):
        res = await _call(ws, type="jukebox_kiosk/ma", command="player_queues/repeat",
                          args={"queue_id": PLAYER_A, "repeat_mode": sent})
        assert res["success"], sent
        assert fake_ma.calls[-1] == ("player_queues/repeat", {"queue_id": PLAYER_A, "repeat_mode": want}), sent


# ---- 0.7.2: combined Library tab (search source picker, genres list) ----


async def test_v072_search_providers(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    caps = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert caps["features"]["search_providers"] is True
    res = await _call(ws, type="jukebox_kiosk/search_providers")
    assert res["success"]
    # available music/plugin providers with the search feature only, deduped, sorted by name, 3 keys each
    assert res["result"]["providers"] == [
        {"instance_id": "apple_music--demo0001", "domain": "apple_music", "name": "Apple Music"},
        {"instance_id": "spotify--demo0002", "domain": "spotify", "name": "Spotify"},
        {"instance_id": "tunein--demo0003", "domain": "tunein", "name": "TuneIn"},
    ]
    assert "secret" not in str(res["result"])
    n = len(fake_ma.calls)
    await _call(ws, type="jukebox_kiosk/search_providers")
    assert len(fake_ma.calls) == n  # read from the client's provider list, no MA command


async def test_v072_search_providers_empty(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    fake_ma.providers = None
    ws = await _ws(hass_ws_client, user_token[1])
    res = await _call(ws, type="jukebox_kiosk/search_providers")
    assert res["success"] and res["result"]["providers"] == []


@pytest.mark.parametrize(
    "options", [{"guest_users": [], "non_admins_are_guests": True, "guest_classes": ["playback"]}]
)
async def test_v072_search_providers_needs_read(hass: HomeAssistant, hass_ws_client: Any, user_token: Any) -> None:
    ws = await _ws(hass_ws_client, user_token[1])
    caps = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert caps["features"]["search_providers"] is False
    res = await _call(ws, type="jukebox_kiosk/search_providers")
    assert not res["success"]


async def test_v072_search_limited_and_genre_list(
    hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa
) -> None:
    user, token = user_token
    ws = await _ws(hass_ws_client, token)
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/search",
                      args={"search_query": "mo", "media_types": ["playlist"], "limit": 25, "providers": ["spotify--demo0002"]})
    assert res["success"]
    c, args = fake_ma.calls[-1]
    assert c == "music/search" and args["providers"] == ["spotify--demo0002"] and args["media_types"] == ["playlist"]
    assert args["user"]["user_id"] == user.id
    res = await _call(ws, type="jukebox_kiosk/ma", command="music/genres/library_items", args={"limit": 500, "offset": 0})
    assert res["success"]
    c, args = fake_ma.calls[-1]
    assert c == "music/genres/library_items" and args["limit"] == 500 and args["user"]["user_id"] == user.id

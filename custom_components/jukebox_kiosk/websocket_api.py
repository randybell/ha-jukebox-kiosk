"""Websocket commands for the Jukebox Card.

Why websocket and not services: a websocket handler sees `connection.user`, so
we can enforce per-command permission classes, and it does not write a
`call_service` event to the recorder for every queue poll.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import probatio

from homeassistant.auth.models import User
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized

from . import format as fmt
from .client import MaUnavailable, async_get_ma_client
from .const import (
    AUTOPLAY_COMMAND,
    AUTOPLAY_LEGACY_COMMAND,
    AUTOPLAY_MODE_GLOBAL,
    AUTOPLAY_MODE_KEY,
    AUTOPLAY_MODES,
    AUTOPLAY_PLAYLIST_KEY,
    DOMAIN,
    LIVE_EVENTS,
    LIVE_QUEUE_EVENTS,
    MA_COMMANDS,
    NO_WRITE_ARG_KEYS,
    PLAYER_ARG_KEYS,
    PLAYER_LIST_ARG_KEYS,
    QUEUE_EVENTS,
    # #156 sleep timer off (Randy: kept for a standalone player):
    # SLEEP_TIMER_EVENT,
    QUEUE_LIMIT_MAX,
    RESERVED_ARG_KEYS,
    SEARCH_PROVIDER_TYPES,
    TODO_VERIFY,
    TRACK_PAGE_DEFAULT,
    TRACK_PAGE_MAX,
    PermClass,
    is_denied,
    todo_verify_commands,
)
from .link import MaLink, async_get_link
from .permissions import Policy, allowed_classes, check_class, check_entity, is_guest
from .players import PlayerNotFound, active_queue_id, active_queues, entity_for_player, player_id_for_entity, player_ids, queue_id_for_entity

if TYPE_CHECKING:
    from music_assistant_client import MusicAssistantClient

try:
    from music_assistant_models.auth import AuthProviderType

    HA_PROVIDER = str(AuthProviderType.HOME_ASSISTANT)
except ImportError:  # pragma: no cover
    HA_PROVIDER = "homeassistant"

try:
    from music_assistant_client.helpers import impersonation_arg
except ImportError:  # pragma: no cover
    impersonation_arg = None  # type: ignore[assignment]

COMMAND_TIMEOUT = 30
# Lyrics lookups can take 8-33 s the first time (rate limits), and the card waits 60 s for them (src/lyrics/store.ts CALL_TIMEOUT).
COMMAND_TIMEOUTS: dict[str, float] = {"metadata/get_track_lyrics": 60}

TRACK_COMMANDS = {
    "album": ("music/albums/album_tracks", "tracks"),
    "artist": ("music/artists/artist_tracks", "tracks"),
    "playlist": ("music/playlists/playlist_tracks", "tracks"),
    "podcast": ("music/podcasts/podcast_episodes", "episodes"),
}


class KioskError(HomeAssistantError):
    """Error with a websocket error code."""

    def __init__(self, code: str, message: str) -> None:
        """Init."""
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- helpers


def _entry(hass: HomeAssistant) -> ConfigEntry:
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        raise KioskError("not_configured", "Jukebox Kiosk is not set up")
    return entries[0]


def _context(hass: HomeAssistant) -> tuple[ConfigEntry, Policy, MusicAssistantClient]:
    entry = _entry(hass)
    data = entry.runtime_data
    return entry, data.policy, async_get_ma_client(hass, data.ma_entry_id)


def _link(hass: HomeAssistant) -> MaLink:
    """2.4: the Music Assistant connection Home Assistant holds for our MA entry, followed across MA restarts."""
    return async_get_link(hass, _entry(hass).runtime_data.ma_entry_id)


class _Follow:
    """2.4: a websocket subscription's listener on the MA client, moved to each new client Home Assistant makes.

    When MA drops out, Home Assistant reloads its music_assistant entry and builds a brand-new client (see link.py), so a
    listener left on the old client would go quiet for good. The listener (`on_event(client, event)`, for `events`, no
    id filter) is attached to the client held now, if any, and again to every new client; the old client's is removed,
    and a late call from an old client is dropped. `changed(client | None)` runs right after each switch (None: the
    client went away), so the subscription can tell the card and send fresh state, with no await between attaching to
    the new client and reading its lists.
    """

    def __init__(
        self,
        link: MaLink,
        events: tuple[Any, ...],
        on_event: Callable[[Any, Any], None],
        changed: Callable[[Any | None], None],
    ) -> None:
        self._events = events
        self._on_event = on_event
        self._changed = changed
        self._detach: CALLBACK_TYPE | None = None
        self.client: Any | None = link.client
        self._attach()
        self._unlink = link.async_listen(self._on_link)

    @callback
    def _attach(self) -> None:
        client = self.client
        if client is None:
            return

        @callback
        def _relay(event: Any) -> None:
            if self.client is client:
                self._on_event(client, event)

        self._detach = client.subscribe(_relay, self._events, None)

    @callback
    def _on_link(self, client: Any | None) -> None:
        self._drop()
        self.client = client
        self._attach()
        self._changed(client)

    @callback
    def _drop(self) -> None:
        detach, self._detach = self._detach, None
        if detach is None:
            return
        try:
            detach()
        except ValueError:  # the old client already dropped its listener list entry
            pass

    @callback
    def close(self) -> None:
        """Unsubscribe from the link and the current client (the websocket subscription ended)."""
        self._unlink()
        self._drop()
        self.client = None


def _player_ids_in(args: dict[str, Any]) -> list[str]:
    ids = [args[k] for k in PLAYER_ARG_KEYS if isinstance(args.get(k), str)]
    for key in PLAYER_LIST_ARG_KEYS:
        val = args.get(key)
        if isinstance(val, list):
            ids.extend(v for v in val if isinstance(v, str))
    return ids


def _check_players(hass: HomeAssistant, user: User | None, args: dict[str, Any], *, control: bool) -> None:
    """Non-admins must hold HA entity permission on every MA player named in args."""
    if user is not None and user.is_admin:
        return
    for pid in _player_ids_in(args):
        entity_id = entity_for_player(hass, pid)
        if entity_id is None:
            raise Unauthorized(perm_category="jukebox_kiosk:unknown_player")
        check_entity(user, entity_id, control=control)


def _guard_lyrics_track(track: Any) -> None:
    """MA writes metadata to its DB when asked for lyrics of a library track
    that has none, so only provider tracks (queue current_item.media_item) pass."""
    if not isinstance(track, dict):
        raise KioskError("invalid_args", "track must be a full Track object")
    uri = str(track.get("uri") or "")
    if track.get("provider") == "library" or uri.startswith("library://"):
        raise KioskError("library_track", "Pass the provider track, not the library track")


def _impersonation(client: MusicAssistantClient, user: User | None) -> dict[str, Any]:
    if user is None or impersonation_arg is None:
        return {}
    linked = {"provider": HA_PROVIDER, "user_id": user.id, "required": False}
    try:
        return impersonation_arg(getattr(client, "server_info", None), linked)  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001 - old server: just don't impersonate
        return {}


async def _send(client: MusicAssistantClient, command: str, **kwargs: Any) -> Any:
    try:
        async with asyncio.timeout(COMMAND_TIMEOUTS.get(command, COMMAND_TIMEOUT)):
            return await client.send_command(command, **kwargs)
    except TimeoutError as err:
        raise KioskError("timeout", f"Music Assistant did not answer {command}") from err
    except (HomeAssistantError, Unauthorized):
        raise
    except Exception as err:  # MusicAssistantError and friends
        raise KioskError("ma_error", f"{command}: {err}") from err


async def forward(
    hass: HomeAssistant,
    user: User | None,
    command: str,
    args: dict[str, Any] | None,
) -> Any:
    """Allowlist + permission check, then send to MA. Used by the `ma` command."""
    args = dict(args or {})
    spec = MA_COMMANDS.get(command)
    if spec is None or is_denied(command):
        raise KioskError("not_allowed", f"{command} is not allowlisted")
    if RESERVED_ARG_KEYS & args.keys():
        raise KioskError("invalid_args", "Reserved argument names are not allowed")
    if any(args.get(k) for k in NO_WRITE_ARG_KEYS & args.keys()):
        raise KioskError("invalid_args", "allow_update_metadata must be false (it lets MA write to the library)")
    for key, value in spec.forced:
        if key in args and args[key] != value:
            raise KioskError("invalid_args", f"{key} is fixed to {value!r} for {command}")
        args[key] = value
    if command == "metadata/get_track_lyrics":
        _guard_lyrics_track(args.get("track"))
    if spec.guest_arg_prefixes and not (user and user.is_admin):
        for key, prefixes in spec.guest_arg_prefixes:
            value = args.get(key)
            if not isinstance(value, str) or not value.startswith(prefixes):
                raise KioskError("invalid_args", f"{key} must start with {' or '.join(prefixes)} for {command}")
    _entry_, policy, client = _context(hass)
    check_class(user, policy, spec.perm)
    _check_players(hass, user, args, control=spec.perm is not PermClass.READ)
    if spec.impersonate:
        args.update(_impersonation(client, user))
    result = await _send(client, command, **args)
    if spec.redact == "group_config" and not (user and user.is_admin):
        result = fmt.redact_group_config(result)
    return result


def _wrap(handler: Callable[..., Any]) -> Callable[..., Any]:
    """Turn our exceptions into clean websocket errors."""

    async def inner(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        try:
            await handler(hass, connection, msg)
        except Unauthorized:
            connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Not allowed for this user")
        except MaUnavailable as err:
            connection.send_error(msg["id"], "ma_unavailable", str(err))
        except PlayerNotFound as err:
            connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, str(err))
        except KioskError as err:
            connection.send_error(msg["id"], err.code, str(err))

    inner.__name__ = handler.__name__
    inner.__doc__ = handler.__doc__
    return inner


# ---------------------------------------------------------------- commands


@websocket_api.websocket_command({probatio.Required("type"): f"{DOMAIN}/capabilities"})
@websocket_api.async_response
@_wrap
async def ws_capabilities(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """What this backend can do for the calling user."""
    entry = _entry(hass)
    data = entry.runtime_data
    user = connection.user
    classes = allowed_classes(user, data.policy)
    connected, schema = True, None
    try:
        client = async_get_ma_client(hass, data.ma_entry_id)
        schema = getattr(getattr(client, "server_info", None), "schema_version", None)
    except MaUnavailable:
        connected = False
    has = classes.__contains__
    connection.send_result(
        msg["id"],
        {
            "backend": "kiosk",
            "version": data.version,
            "ma_entry_id": data.ma_entry_id,
            "ma_connected": connected,
            "ma_schema": schema,
            "guest": bool(user and is_guest(user, data.policy)),
            "classes": sorted(c.value for c in classes),
            "commands": sorted(
                k for k, v in MA_COMMANDS.items() if v.perm in classes and v.status != TODO_VERIFY
            ),
            "todo_verify": todo_verify_commands(),
            "features": {
                "queue": has(PermClass.READ),
                "queue_play": has(PermClass.PLAYBACK),
                "queue_edit": has(PermClass.QUEUE),
                "undo": has(PermClass.QUEUE) and has(PermClass.PLAYBACK),
                "ma_commands": True,
                "lyrics": has(PermClass.READ),
                "track_lists": has(PermClass.READ),
                "podcast_episodes": has(PermClass.READ),
                "genre_overview": has(PermClass.READ),
                "podcast_library": has(PermClass.READ),
                "audiobook_library": has(PermClass.READ),
                "favorite": has(PermClass.LIBRARY),
                "unfavorite": has(PermClass.LIBRARY),
                "library_write": has(PermClass.LIBRARY),
                "speakers": has(PermClass.SPEAKERS),
                "group_configs": has(PermClass.READ),
                "queue_push": has(PermClass.READ),
                # v0.7 Discover & Search
                "genres": has(PermClass.READ),
                "radio_browse": has(PermClass.READ),
                "discover": has(PermClass.READ),
                "resume": has(PermClass.READ),
                # Autoplay ("Don't stop the music"): jukebox_kiosk/set_autoplay + queue_items.autoplay
                "autoplay": has(PermClass.QUEUE),
                # Autoplay style picker: jukebox_kiosk/autoplay_options + set_autoplay_mode (same class as the toggle)
                "autoplay_mode": has(PermClass.QUEUE),
                # 0.7.2 Search source picker: jukebox_kiosk/search_providers + music/search providers=[...]
                "search_providers": has(PermClass.READ),
                # #99: jukebox_kiosk/player_ids, the MA player id of every MA media_player (HA entity registry)
                "player_ids": has(PermClass.READ),
                # #103: jukebox_kiosk/subscribe_live, MA's players and queues as a snapshot, then each pushed change
                "live_feed": has(PermClass.READ),
                # #100: jukebox_kiosk/active_queue, the entity's active queue by Music Assistant's rule (or null)
                "active_queue": has(PermClass.READ),
                # 2.4: jukebox_kiosk/subscribe_ma_status, {"connected": bool} now and whenever HA's MA connection changes
                "ma_status": True,
            },
        },
    )


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/ma",
        probatio.Required("command"): str,
        probatio.Optional("args", default={}): dict,
    }
)
@websocket_api.async_response
@_wrap
async def ws_ma(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Forward one allowlisted MA command."""
    result = await forward(hass, connection.user, msg["command"], msg["args"])
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({probatio.Required("type"): f"{DOMAIN}/player_ids"})
@websocket_api.async_response
@_wrap
async def ws_player_ids(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """#99: {entity_id: MA player_id} for every Music Assistant media_player, from HA's entity registry.

    The same lookup the commands that take an entity use (players.player_id_for_entity). Entities from other
    integrations are not listed. Needs only the registry, so it answers while Music Assistant is offline.
    """
    user = connection.user
    check_class(user, _entry(hass).runtime_data.policy, PermClass.READ)
    # #105: a non-admin gets only the entities they may read
    connection.send_result(msg["id"], {"players": {e: p for e, p in player_ids(hass).items() if _may_read_entity(user, e)}})


def _field(obj: Any, key: str) -> Any:
    return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)


# #100: the speaker plays no queue (idle, or an external source). A normal answer, not a failure.
NO_QUEUE = "Nothing queued on this speaker"


def _queue_or_none(hass: HomeAssistant, client: MusicAssistantClient, entity_id: str) -> str | None:
    """The entity's active queue by the one rule (players.active_queue_id), or None."""
    return queue_id_for_entity(hass, client, entity_id)


def _queue_or_raise(hass: HomeAssistant, client: MusicAssistantClient, entity_id: str) -> str:
    """The entity's active queue, or KioskError no_queue for commands that need one."""
    queue_id = _queue_or_none(hass, client, entity_id)
    if queue_id is None:
        raise KioskError("no_queue", NO_QUEUE)
    return queue_id


def _plain(value: Any) -> str:
    """Enum or str -> its plain string value."""
    return str(getattr(value, "value", value) or "")


def search_providers(providers: Any) -> list[dict[str, str]]:
    """MA provider instances -> the music sources Search can be limited to.

    Only available music/plugin providers that list the `search` feature, with MA's display
    name (user-set name, or the provider name with MA's [2] postfix for a second instance).
    Nothing else of the provider (config, features, ids of other types) leaves the server.
    """
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for prov in providers or []:
        if _plain(_field(prov, "type")) not in SEARCH_PROVIDER_TYPES or _field(prov, "available") is False:
            continue
        features = {_plain(f) for f in (_field(prov, "supported_features") or ())}
        if "search" not in features:
            continue
        instance_id = _plain(_field(prov, "instance_id"))
        if not instance_id or instance_id in seen:
            continue
        seen.add(instance_id)
        domain = _plain(_field(prov, "domain"))
        out.append({"instance_id": instance_id, "domain": domain, "name": str(_field(prov, "name") or domain or instance_id)})
    out.sort(key=lambda p: (p["name"].casefold(), p["instance_id"]))
    return out


@websocket_api.websocket_command({probatio.Required("type"): f"{DOMAIN}/search_providers"})
@websocket_api.async_response
@_wrap
async def ws_search_providers(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Music providers configured in MA that Search can be limited to (permission class read).

    Read from the MA client's provider list (kept current by MA's providers_updated event), so
    no extra MA command and no provider config ever reaches the card.
    """
    _e, policy, client = _context(hass)
    check_class(connection.user, policy, PermClass.READ)
    connection.send_result(msg["id"], {"providers": search_providers(getattr(client, "providers", None))})


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/queue_items",
        probatio.Required("entity_id"): str,
        probatio.Optional("limit_before", default=1): probatio.All(int, probatio.Range(min=0, max=50)),
        probatio.Optional("limit_after", default=100): probatio.All(int, probatio.Range(min=0, max=QUEUE_LIMIT_MAX)),
    }
)
@websocket_api.async_response
@_wrap
async def ws_queue_items(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Queue window around the current item, in the card's QueueItem shape."""
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.READ)
    check_entity(user, msg["entity_id"], control=False)
    queue_id = _queue_or_none(hass, client, msg["entity_id"])
    if queue_id is None:
        # #100: no active queue is a normal answer (MA's app shows no queue too), not an error
        connection.send_result(
            msg["id"],
            {"queue_id": None, "no_queue": True, "current_index": None, "index_in_buffer": None,
             "current_item_id": None, "total": 0, "offset": 0, "items": []},
        )
        return
    queue = await _send(client, "player_queues/get", queue_id=queue_id) or {}
    current = queue.get("current_index")
    cur = current if isinstance(current, int) and current >= 0 else 0
    offset = max(0, cur - msg["limit_before"])
    limit = (cur - offset) + 1 + msg["limit_after"]
    items = await _send(client, "player_queues/items", queue_id=queue_id, limit=limit, offset=offset) or []
    current_item = queue.get("current_item") or {}
    extra: dict[str, Any] = {}
    autoplay = _autoplay_state(queue)
    if autoplay is not None:
        extra["autoplay"] = autoplay
    if isinstance(queue.get("is_dynamic"), bool):
        extra["dynamic"] = queue["is_dynamic"]
    if isinstance(queue.get("active"), bool):
        extra["active"] = queue["active"]
    # MA isQueueInfiniteStream reads only current_item.media_item.media_type (helpers.ts:50-54).
    media = current_item.get("media_item") if isinstance(current_item.get("media_item"), dict) else {}
    mt = media.get("media_type")
    if isinstance(mt, str) and mt:
        extra["current_media_type"] = mt
    rm = queue.get("repeat_mode")
    if rm in ("off", "one", "all"):
        extra["repeat_mode"] = rm
    connection.send_result(
        msg["id"],
        {
            **extra,
            "queue_id": queue_id,
            "current_index": current,
            "index_in_buffer": queue.get("index_in_buffer"),
            "current_item_id": current_item.get("queue_item_id"),
            "total": queue.get("items"),
            "offset": offset,
            "items": [fmt.format_queue_item(i) for i in items if isinstance(i, dict)],
        },
    )


def _autoplay_state(queue: dict[str, Any]) -> bool | None:
    """MA 2.10.9 `autoplay_enabled`; older servers only send `dont_stop_the_music_enabled`."""
    for key in ("autoplay_enabled", "dont_stop_the_music_enabled"):
        if isinstance(queue.get(key), bool):
            return bool(queue[key])
    return None


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/set_autoplay",
        probatio.Required("entity_id"): str,
        probatio.Required("enabled"): bool,
    }
)
@websocket_api.async_response
@_wrap
async def ws_set_autoplay(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Turn MA Autoplay (formerly "Don't stop the music") on or off for the entity's active queue.

    The queue always comes from an HA entity the user may control, never from the caller. MA 2.10.9 names the command
    player_queues/autoplay; older servers only know player_queues/dont_stop_the_music (still an alias in 2.10.9)."""
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.QUEUE)
    check_entity(user, msg["entity_id"], control=True)
    queue_id = _queue_or_raise(hass, client, msg["entity_id"])
    enabled = msg["enabled"]
    try:
        await _send(client, AUTOPLAY_COMMAND, queue_id=queue_id, autoplay_enabled=enabled)
    except KioskError as err:
        if err.code != "ma_error" or not re.search(rf"invalid command:?\s*{re.escape(AUTOPLAY_COMMAND)}", str(err), re.I):
            raise
        await _send(client, AUTOPLAY_LEGACY_COMMAND, queue_id=queue_id, dont_stop_the_music_enabled=enabled)
    connection.send_result(msg["id"], {"queue_id": queue_id, "autoplay": enabled})


def _entry_options(entries: Any, key: str) -> list[dict[str, Any]] | None:
    """Options of one config entry from config/player_queues/get_entries (None when MA doesn't list the key)."""
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, dict) and entry.get("key") == key:
            return [o for o in entry.get("options") or [] if isinstance(o, dict)]
    return None


async def _autoplay_options(client: MusicAssistantClient, queue_id: str) -> dict[str, Any]:
    """Current Autoplay style for a queue, the styles MA offers and the library playlists for the playlist style."""
    entries = await _send(client, "config/player_queues/get_entries", queue_id=queue_id)
    mode_opts = _entry_options(entries, AUTOPLAY_MODE_KEY)
    if mode_opts is None:
        raise KioskError("unsupported", "This Music Assistant has no Autoplay style setting")
    offered = {str(o.get("value")): not o.get("disabled") for o in mode_opts}
    modes = [{"mode": m, "available": offered[m]} for m in AUTOPLAY_MODES if m in offered]
    playlists = [
        {"uri": str(o["value"]), "name": str(o.get("title") or o["value"])}
        for o in _entry_options(entries, AUTOPLAY_PLAYLIST_KEY) or []
        if isinstance(o.get("value"), str)
    ]
    raw = await _send(client, "config/player_queues/get_value", queue_id=queue_id, key=AUTOPLAY_MODE_KEY)
    follows = raw in (None, AUTOPLAY_MODE_GLOBAL) or raw not in AUTOPLAY_MODES
    if follows:
        try:
            effective = await _send(client, "config/core/get_value", domain="player_queues", key=AUTOPLAY_MODE_KEY)
            playlist = await _send(client, "config/core/get_value", domain="player_queues", key=AUTOPLAY_PLAYLIST_KEY)
        except KioskError:
            effective, playlist = "auto", None
    else:
        effective = raw
        playlist = await _send(client, "config/player_queues/get_value", queue_id=queue_id, key=AUTOPLAY_PLAYLIST_KEY)
    names = {p["uri"]: p["name"] for p in playlists}
    return {
        "queue_id": queue_id,
        "mode": effective if effective in AUTOPLAY_MODES else "auto",
        "follows_default": follows,
        "playlist": {"uri": playlist, "name": names.get(playlist, "")} if isinstance(playlist, str) and playlist else None,
        "modes": modes,
        "playlists": playlists,
    }


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/autoplay_options",
        probatio.Required("entity_id"): str,
    }
)
@websocket_api.async_response
@_wrap
async def ws_autoplay_options(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Autoplay style for the entity's queue: current style, which styles MA can do, and the library playlists."""
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.QUEUE)
    check_entity(user, msg["entity_id"], control=True)
    queue_id = _queue_or_raise(hass, client, msg["entity_id"])
    connection.send_result(msg["id"], await _autoplay_options(client, queue_id))


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/set_autoplay_mode",
        probatio.Required("entity_id"): str,
        probatio.Required("mode"): probatio.In(AUTOPLAY_MODES),
        probatio.Optional("playlist"): str,
    }
)
@websocket_api.async_response
@_wrap
async def ws_set_autoplay_mode(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Pin the Autoplay style of the entity's queue (MA config/player_queues/save, two keys only).

    MA itself does not check the values (config/player_queues/save accepts any string), so we do: the style must be one
    MA offers as enabled ('similar' is disabled when no provider can find similar tracks) and the playlist must be one
    of MA's library playlists. MA reads the style at every refill, so it applies to the next batch, no restart."""
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.QUEUE)
    check_entity(user, msg["entity_id"], control=True)
    queue_id = _queue_or_raise(hass, client, msg["entity_id"])
    opts = await _autoplay_options(client, queue_id)
    mode = msg["mode"]
    if not any(m["mode"] == mode and m["available"] for m in opts["modes"]):
        raise KioskError("unsupported", f"Autoplay style {mode} is not available")
    values: dict[str, Any] = {AUTOPLAY_MODE_KEY: mode}
    if mode == "playlist":
        uri = msg.get("playlist")
        if not uri:
            raise KioskError("invalid_args", "Pick a playlist")
        if uri not in {p["uri"] for p in opts["playlists"]}:
            raise KioskError("invalid_args", "Only playlists in the library can be used")
        values[AUTOPLAY_PLAYLIST_KEY] = uri
    elif "playlist" in msg:
        raise KioskError("invalid_args", "playlist is only used with the playlist style")
    await _send(client, "config/player_queues/save", queue_id=queue_id, values=values)
    names = {p["uri"]: p["name"] for p in opts["playlists"]}
    connection.send_result(
        msg["id"],
        {
            "queue_id": queue_id,
            "mode": mode,
            "follows_default": False,
            "playlist": {"uri": values[AUTOPLAY_PLAYLIST_KEY], "name": names[values[AUTOPLAY_PLAYLIST_KEY]]}
            if mode == "playlist"
            else None,
        },
    )


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/item_tracks",
        probatio.Required("uri"): str,
        probatio.Optional("page", default=1): probatio.All(int, probatio.Range(min=1)),
        probatio.Optional("page_size", default=TRACK_PAGE_DEFAULT): probatio.All(
            int, probatio.Range(min=1, max=TRACK_PAGE_MAX)
        ),
    }
)
@websocket_api.async_response
@_wrap
async def ws_item_tracks(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Tracks of an album/artist/playlist, or episodes of a podcast (paged here)."""
    _e, policy, client = _context(hass)
    check_class(connection.user, policy, PermClass.READ)
    try:
        provider, media_type, item_id = fmt.parse_uri(msg["uri"])
    except ValueError as err:
        raise KioskError("invalid_uri", str(err)) from err
    if media_type not in TRACK_COMMANDS:
        raise KioskError("unsupported", f"No track list for {media_type}")
    command, key = TRACK_COMMANDS[media_type]
    raw = await _send(client, command, item_id=item_id, provider_instance_id_or_domain=provider) or []
    rows = [r for r in raw if isinstance(r, dict)] if isinstance(raw, list) else []
    size, page = msg["page_size"], msg["page"]
    start = (page - 1) * size
    chunk = rows[start : start + size]
    connection.send_result(
        msg["id"],
        {
            key: [fmt.format_track(r, start + i + 1) for i, r in enumerate(chunk)],
            "total": len(rows),
            "page": page,
            "more": start + size < len(rows),
        },
    )


@websocket_api.websocket_command(
    {probatio.Required("type"): f"{DOMAIN}/favorite_current", probatio.Required("entity_id"): str}
)
@websocket_api.async_response
@_wrap
async def ws_favorite_current(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Add the playing item to favourites (the Now Playing heart; no button entity needed)."""
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.LIBRARY)
    check_entity(user, msg["entity_id"], control=True)
    queue_id = _queue_or_none(hass, client, msg["entity_id"])
    if queue_id is None:
        raise KioskError("not_found", "Nothing is playing")
    queue = await _send(client, "player_queues/get", queue_id=queue_id) or {}
    media = (queue.get("current_item") or {}).get("media_item") or {}
    uri = media.get("uri") or ""
    try:
        fmt.parse_uri(uri)
    except ValueError as err:
        raise KioskError("not_found", "Nothing is playing") from err
    await _send(client, "music/favorites/add_item", item=uri)
    connection.send_result(msg["id"], {"uri": uri})


@websocket_api.websocket_command(
    {probatio.Required("type"): f"{DOMAIN}/unfavorite_current", probatio.Required("entity_id"): str}
)
@websocket_api.async_response
@_wrap
async def ws_unfavorite_current(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Remove the playing library track from favourites."""
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.LIBRARY)
    check_entity(user, msg["entity_id"], control=True)
    queue_id = _queue_or_none(hass, client, msg["entity_id"])
    if queue_id is None:
        raise KioskError("not_found", "Nothing is playing")
    queue = await _send(client, "player_queues/get", queue_id=queue_id) or {}
    media = (queue.get("current_item") or {}).get("media_item") or {}
    uri = media.get("uri") or ""
    try:
        provider, media_type, item_id = fmt.parse_uri(uri)
    except ValueError as err:
        raise KioskError("not_found", "Nothing is playing") from err
    if provider != "library":
        raise KioskError("not_library", "Only library items can be unfavourited")
    await _send(client, "music/favorites/remove_item", media_type=media_type, library_item_id=item_id)
    connection.send_result(msg["id"], {"uri": uri})


@websocket_api.websocket_command(
    {probatio.Required("type"): f"{DOMAIN}/active_queue", probatio.Required("entity_id"): str}
)
@websocket_api.async_response
@_wrap
async def ws_active_queue(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """#100: {"queue_id": ...} the entity's active queue by the one rule (players.active_queue_id), or null.

    For card code that reads the playing queue itself (the lyrics lookup), so it never guesses from HA's active_queue.
    """
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.READ)
    check_entity(user, msg["entity_id"], control=False)
    connection.send_result(msg["id"], {"queue_id": _queue_or_none(hass, client, msg["entity_id"])})


@websocket_api.websocket_command(
    {probatio.Required("type"): f"{DOMAIN}/subscribe_queue", probatio.Required("entity_id"): str}
)
@websocket_api.async_response
@_wrap
async def ws_subscribe_queue(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Push a small event whenever the entity's active MA queue or its items change.

    2.5: the card no longer uses this (it follows its queue from subscribe_live's active queues). It stays registered for
    one release so a tablet still running a cached older card keeps working until it reloads (SOW 5, 6).

    #100: the queue followed is the one the active-queue rule gives, worked out again on every player or queue change
    (from the MA client's in-memory lists, no MA call). When it moves (the speaker joins or leaves a group, starts or
    stops playing its own queue, or an external source takes over), {"event": "queue_changed", "queue_id": new or null}
    is sent, so the Queue screen follows the music. Item changes are sent only for the queue being followed.

    2.4: the listener follows Home Assistant's Music Assistant connection (_Follow). When the client goes away,
    {"event": "offline", "queue_id": null} is sent; when HA has a new client, the listener moves to it and
    {"event": "queue_changed", "queue_id": ...} is always sent, so the card reads the queue fresh. The subscription is
    accepted while MA is offline (it starts with "offline") and comes alive when MA returns.
    """
    link = _link(hass)
    policy = _entry(hass).runtime_data.policy
    user = connection.user
    check_class(user, policy, PermClass.READ)
    check_entity(user, msg["entity_id"], control=False)
    player_id = player_id_for_entity(hass, msg["entity_id"])
    held: dict[str, str | None] = {"queue": None}
    msg_id = msg["id"]

    def _push(event: str, queue_id: str | None) -> None:
        connection.send_message(websocket_api.event_message(msg_id, {"event": event, "queue_id": queue_id}))

    @callback
    def _on_event(client: Any, event: Any) -> None:
        name = str(getattr(getattr(event, "event", None), "value", getattr(event, "event", "")))
        # the client updates its own lists before subscribers run (both are its listeners, in order)
        now = active_queue_id(client, player_id)
        if now != held["queue"]:
            held["queue"] = now
            _push("queue_changed", now)
            return
        if name in QUEUE_EVENTS and now is not None and getattr(event, "object_id", None) == now:
            _push(name, now)

    @callback
    def _changed(client: Any | None) -> None:
        if client is None:
            held["queue"] = None
            _push("offline", None)
            return
        held["queue"] = active_queue_id(client, player_id)
        _push("queue_changed", held["queue"])

    from music_assistant_models.enums import EventType  # noqa: PLC0415

    follow = _Follow(link, tuple(EventType(e) for e in LIVE_EVENTS), _on_event, _changed)
    connection.subscriptions[msg_id] = follow.close
    if follow.client is not None:
        held["queue"] = active_queue_id(follow.client, player_id)
    connection.send_result(msg_id, {"queue_id": held["queue"]})
    if follow.client is None:
        _push("offline", None)


def _live_dict(obj: Any) -> dict[str, Any] | None:
    """A player or queue from the MA client's in-memory lists (a model with to_dict, or a plain dict) as a dict."""
    if isinstance(obj, dict):
        return obj
    to_dict = getattr(obj, "to_dict", None)
    if not callable(to_dict):
        return None
    try:
        out = to_dict()
    except Exception:  # noqa: BLE001 - one bad model must not break the snapshot
        return None
    return out if isinstance(out, dict) else None


def _live_items(container: Any, attr: str) -> list[dict[str, Any]]:
    """client.players.players / client.player_queues.player_queues as dicts (the lists the client keeps from MA's events)."""
    items = getattr(container, attr, None) if container is not None else None
    if callable(items):  # pragma: no cover - defensive, both are properties in music-assistant-client 1.5/1.6
        items = items()
    out: list[dict[str, Any]] = []
    for item in items or ():
        data = _live_dict(item)
        if data is not None:
            out.append(data)
    return out


def _may_read_queue(hass: HomeAssistant, user: User | None, queue_id: Any) -> bool:
    """Queues reach a non-admin only for players whose Home Assistant entity they may read (as player_queues/get)."""
    return _may_read_player(hass, user, queue_id)


def _may_read_player(hass: HomeAssistant, user: User | None, player_id: Any) -> bool:
    """#105: an MA player (or its queue, which has the player's id) reaches a non-admin only when the user may read the
    player's Home Assistant entity. A player with no HA entity never does."""
    if user is not None and user.is_admin:
        return True
    if not isinstance(player_id, str) or not player_id:
        return False
    entity_id = entity_for_player(hass, player_id)
    return entity_id is not None and _may_read_entity(user, entity_id)


def _may_read_entity(user: User | None, entity_id: str) -> bool:
    """HA lets this user read the entity (admins: always)."""
    try:
        check_entity(user, entity_id, control=False)
    except Unauthorized:
        return False
    return True


@websocket_api.websocket_command({probatio.Required("type"): f"{DOMAIN}/subscribe_live"})
@websocket_api.async_response
@_wrap
async def ws_subscribe_live(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """#103: Music Assistant's players and queues, live, the way Music Assistant's own app keeps them.

    One full snapshot first ({"seq": 1, "kind": "snapshot", "players": [...], "queues": [...]}), built from the lists
    the MA client already keeps in memory (no MA call), then every pushed change as
    {"seq": n, "kind": "event", "event": ..., "object_id": ..., "data": ...}. `seq` counts up by one per message on
    this subscription, so the card can tell a missed or late message and ask for a fresh snapshot.

    2.4: the feed follows Home Assistant's Music Assistant connection (_Follow). When the client goes away,
    {"seq": n, "kind": "offline"} is sent and nothing more until HA has a new client; then the listener moves to the new
    client and a fresh full snapshot follows (the same subscription, `seq` keeps counting). The subscription is accepted
    while MA is offline: it starts with "offline" and the first snapshot comes when MA returns.

    Players and queues reach a non-admin only for players whose entity they may read (#105; queues as
    player_queues/get), and so do their active-queue entries and changes. queue_time_updated (elapsed seconds, about once a second while playing) is forwarded for the regroup signal; Now Playing progress still uses Home Assistant's media_position.

    2.5: the feed also says which queue each player is playing, by the one active-queue rule (players.active_queue_id,
    Music Assistant's app rule), so the card follows its speaker's queue from the feed and never needs its own copy of
    the rule: the snapshot carries "active_queues" ({player_id: queue_id or null}), and after any change that moves
    one, {"seq": n, "kind": "active_queue", "player_id": ..., "queue_id": ... or null} follows the change's own message.
    """
    link = _link(hass)
    policy = _entry(hass).runtime_data.policy
    user = connection.user
    check_class(user, policy, PermClass.READ)
    msg_id = msg["id"]
    state = {"seq": 0}
    # 2.5: each player's active queue as last sent (a player missing here counts as no queue)
    held: dict[str, str | None] = {}

    def _emit(payload: dict[str, Any]) -> None:
        state["seq"] += 1
        connection.send_message(websocket_api.event_message(msg_id, {"seq": state["seq"], **payload}))

    def _follow_queues(client: Any) -> None:
        # the client updates its own lists before subscribers run (both are its listeners, in order)
        now = active_queues(client)
        for player_id, queue_id in now.items():
            if held.get(player_id) != queue_id and _may_read_player(hass, user, player_id):
                _emit({"kind": "active_queue", "player_id": player_id, "queue_id": queue_id})
        held.clear()
        held.update(now)

    @callback
    def _on_event(client: Any, event: Any) -> None:
        name = str(getattr(getattr(event, "event", None), "value", getattr(event, "event", "")))
        if name not in LIVE_EVENTS:
            return
        object_id = getattr(event, "object_id", None)
        # #105: queue changes as player_queues/get, player changes only for players whose entity the user may read
        if _may_read_queue(hass, user, object_id) if name in LIVE_QUEUE_EVENTS else _may_read_player(hass, user, object_id):
            data = getattr(event, "data", None)
            if data is not None and not isinstance(data, (dict, list, str, int, float, bool)):
                data = _live_dict(data)
            _emit({"kind": "event", "event": name, "object_id": object_id, "data": data})
        _follow_queues(client)

    def _snapshot(client: Any) -> None:
        # #105: players, like queues, only for players whose entity the user may read (admins: all)
        players = [
            p for p in _live_items(getattr(client, "players", None), "players")
            if _may_read_player(hass, user, p.get("player_id"))
        ]
        queues = [
            q for q in _live_items(getattr(client, "player_queues", None), "player_queues")
            if _may_read_queue(hass, user, q.get("queue_id"))
        ]
        held.clear()
        held.update(active_queues(client))
        shown = {pid: qid for pid, qid in held.items() if _may_read_player(hass, user, pid)}
        _emit({"kind": "snapshot", "players": players, "queues": queues, "active_queues": shown})

    @callback
    def _changed(client: Any | None) -> None:
        # listening on the new client already, and no await before its lists are read: no change can fall between
        if client is None:
            _emit({"kind": "offline"})
        else:
            _snapshot(client)

    from music_assistant_models.enums import EventType  # noqa: PLC0415

    # listen first, then read the lists, with no await in between: no change can fall between the two
    follow = _Follow(link, tuple(EventType(e) for e in LIVE_EVENTS), _on_event, _changed)
    connection.subscriptions[msg_id] = follow.close
    connection.send_result(msg_id)
    _changed(follow.client)


@websocket_api.websocket_command({probatio.Required("type"): f"{DOMAIN}/subscribe_ma_status"})
@websocket_api.async_response
@_wrap
async def ws_subscribe_ma_status(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """2.4: {"connected": bool}: whether Home Assistant holds a working Music Assistant connection, now and on change.

    `false` as soon as HA's music_assistant entry stops being loaded (MA dropped out and HA is restarting its connection,
    or waiting to retry); `true` once HA has a new client with MA's players and queues loaded. The card shows its
    "Music Assistant is offline" notice from this and reloads fresh on the way back. No MA call and no permission class
    (the same fact `ma_connected` in capabilities gives every user).
    """
    link = _link(hass)
    msg_id = msg["id"]

    @callback
    def _send(client: Any | None) -> None:
        connection.send_message(websocket_api.event_message(msg_id, {"connected": client is not None}))

    connection.subscriptions[msg_id] = link.async_listen(_send)
    connection.send_result(msg_id)
    _send(link.client)


# #156 sleep timer off (Randy: kept for a standalone player):
# def _expires_payload(raw: Any) -> dict[str, Any]:
    # """Shape MA's sleep_timer get/set return (unix seconds or None) for the card."""
    # exp = raw if isinstance(raw, (int, float)) and raw > 0 else None
    # return {"expires_at": exp}


# _SLEEP_MODES = frozenset({"duration", "end_of_item", "end_of_chapter"})


# async def _sleep_payload(client: Any, player_id: str, raw: Any) -> dict[str, Any]:
    # """Expiry from players/sleep_timer/get, plus sleep_timer_mode from the playback owner.

    # MA's get command returns only expires_at (None while an end-of-item timer is paused).
    # The mode is stored on the playback owner (sleep_timer.py _get_sleep_timer_player
    # → _resolve_playback_owner in base.py:581-597; player.set_sleep_timer). MA's
    # frontend reads player.sleep_timer_mode on that owner (sleep_timer.ts:38).
    # """
    # out = _expires_payload(raw)
    # owner_id = await _playback_owner_id(client, player_id)
    # player = await _ma_player(client, owner_id)
    # if player is not None:
        # mode = player.get("sleep_timer_mode")
        # if mode in _SLEEP_MODES:
            # out["mode"] = mode
    # return out


# async def _ma_player(client: Any, player_id: str) -> dict[str, Any] | None:
    # """Return players/get as a dict, or None if the command fails or the result is not a player."""
    # try:
        # player = await _send(client, "players/get", player_id=player_id)
    # except Exception:
        # return None
    # return player if isinstance(player, dict) else None


# async def _playback_owner_id(client: Any, player_id: str, groups: dict[str, tuple[str | None, str | None]] | None = None) -> str:
    # """Return the id of the player that owns this player's playback.

    # MA `_resolve_playback_owner` (server-dev base.py:581-597): the sync leader, or
    # the group player capturing that leader. 2.10.12 `_get_player_with_redirect`
    # (controller.py:3169-3191) is the same two steps. Sleep commands and
    # `player_sleep_timer_updated` use that player's id (sleep_timer.py:183-196,
    # 168-171).
    # """
    # def _note(pid: str, raw: dict[str, Any] | None) -> None:
        # if groups is not None:
            # groups[pid] = _group_fields(raw) or (None, None)

    # player = await _ma_player(client, player_id)
    # _note(player_id, player)
    # if player is None:
        # return player_id
    # owner_id, owner = player_id, player
    # synced_to = owner.get("synced_to")
    # if isinstance(synced_to, str) and synced_to:
        # leader = await _ma_player(client, synced_to)
        # _note(synced_to, leader)
        # if leader is not None:
            # owner_id, owner = synced_to, leader
    # active_group = owner.get("active_group")
    # if isinstance(active_group, str) and active_group:
        # group = await _ma_player(client, active_group)
        # _note(active_group, group)
        # if group is not None:
            # owner_id = active_group
    # return owner_id


# def _sleep_id_filter(player_id: str, owner_id: str) -> str | tuple[str, ...]:
    # """The card's player plus its current playback owner, when that owner is someone else."""
    # return (player_id, owner_id) if owner_id != player_id else player_id


# def _group_fields(data: Any) -> tuple[str | None, str | None] | None:
    # """synced_to and active_group from a players/get or player_updated payload, or None if it is not a player dict."""
    # if not isinstance(data, dict):
        # return None
    # def _id(v: Any) -> str | None:
        # return v if isinstance(v, str) and v else None
    # return (_id(data.get("synced_to")), _id(data.get("active_group")))


# @websocket_api.websocket_command(
    # {probatio.Required("type"): f"{DOMAIN}/sleep_timer_get", probatio.Required("entity_id"): str}
# )
# @websocket_api.async_response
# @_wrap
# async def ws_sleep_timer_get(
    # hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
# ) -> None:
    # """Return the MA sleep timer expiry (and mode, when the player has one) for the entity's player."""
    # _e, _, client = _context(hass)
    # player_id = player_id_for_entity(hass, msg["entity_id"])
    # raw = await _send(client, "players/sleep_timer/get", player_id=player_id)
    # connection.send_result(msg["id"], {**await _sleep_payload(client, player_id, raw), "player_id": player_id})


# @websocket_api.websocket_command(
    # {
        # probatio.Required("type"): f"{DOMAIN}/sleep_timer_set",
        # probatio.Required("entity_id"): str,
        # probatio.Required("seconds"): int,
    # }
# )
# @websocket_api.async_response
# @_wrap
# async def ws_sleep_timer_set(
    # hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
# ) -> None:
    # """Set the MA sleep timer for the entity's player (registry unique_id)."""
    # _e, _, client = _context(hass)
    # seconds = msg["seconds"]
    # if not isinstance(seconds, int) or seconds <= 0:
        # raise KioskError("invalid_args", "seconds must be greater than zero")
    # player_id = player_id_for_entity(hass, msg["entity_id"])
    # raw = await _send(client, "players/sleep_timer/set", player_id=player_id, seconds=seconds)
    # connection.send_result(msg["id"], {**await _sleep_payload(client, player_id, raw), "player_id": player_id})


# @websocket_api.websocket_command(
    # {probatio.Required("type"): f"{DOMAIN}/sleep_timer_clear", probatio.Required("entity_id"): str}
# )
# @websocket_api.async_response
# @_wrap
# async def ws_sleep_timer_clear(
    # hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
# ) -> None:
    # """Clear the MA sleep timer for the entity's player (registry unique_id)."""
    # _e, _, client = _context(hass)
    # player_id = player_id_for_entity(hass, msg["entity_id"])
    # await _send(client, "players/sleep_timer/clear", player_id=player_id)
    # connection.send_result(msg["id"], {**await _sleep_payload(client, player_id, None), "player_id": player_id})


# @websocket_api.websocket_command(
    # {probatio.Required("type"): f"{DOMAIN}/subscribe_sleep_timer", probatio.Required("entity_id"): str}
# )
# @websocket_api.async_response
# @_wrap
# async def ws_subscribe_sleep_timer(
    # hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
# ) -> None:
    # """Push the entity's current sleep expiry whenever a player_sleep_timer_updated event fires.

    # The subscription is filtered to this entity's player plus its current playback
    # owner (the id MA emits on). The filter is updated when the group changes.
    # """
    # _e, _, client = _context(hass)
    # player_id = player_id_for_entity(hass, msg["entity_id"])
    # msg_id = msg["id"]
    # from music_assistant_models.enums import EventType  # noqa: PLC0415

    # event_filter = (EventType(SLEEP_TIMER_EVENT), EventType.PLAYER_UPDATED)
    # held: dict[str, Any] = {"unsub": None, "ids": None, "groups": {}, "closed": False}

    # def _close() -> None:
        # if held["closed"]:
            # return
        # held["closed"] = True
        # unsub = held["unsub"]
        # held["unsub"] = None
        # if unsub is not None:
            # unsub()

    # async def _push() -> None:
        # if held["closed"]:
            # return
        # raw = await _send(client, "players/sleep_timer/get", player_id=player_id)
        # if held["closed"]:
            # return
        # connection.send_message(
            # websocket_api.event_message(msg_id, {**await _sleep_payload(client, player_id, raw), "player_id": player_id})
        # )

    # def _listen(owner_id: str) -> None:
        # if held["closed"]:
            # return
        # unsub = held["unsub"]
        # held["unsub"] = None
        # if unsub is not None:
            # unsub()
        # if held["closed"]:
            # return
        # ids = _sleep_id_filter(player_id, owner_id)
        # held["unsub"] = client.subscribe(_on_event, event_filter, ids)
        # held["ids"] = ids
        # connection.subscriptions[msg_id] = _close

    # async def _retarget() -> None:
        # if held["closed"]:
            # return
        # seen: dict[str, tuple[str | None, str | None]] = {}
        # owner_id = await _playback_owner_id(client, player_id, seen)
        # if held["closed"]:
            # return
        # held["groups"].update(seen)
        # ids = _sleep_id_filter(player_id, owner_id)
        # if ids == held["ids"]:
            # return
        # _listen(owner_id)
        # await _push()

    # @callback
    # def _on_event(event: Any) -> None:
        # name = str(getattr(getattr(event, "event", None), "value", getattr(event, "event", "")))
        # if name == "player_updated":
            # fields = _group_fields(getattr(event, "data", None))
            # if fields is None:
                # return
            # oid = getattr(event, "object_id", None)
            # if isinstance(oid, str) and held["groups"].get(oid) == fields:
                # return
            # if isinstance(oid, str):
                # held["groups"][oid] = fields
            # hass.async_create_task(_retarget())
        # elif name == SLEEP_TIMER_EVENT:
            # hass.async_create_task(_push())

    # seed: dict[str, tuple[str | None, str | None]] = {}
    # _listen(await _playback_owner_id(client, player_id, seed))
    # held["groups"].update(seed)
    # connection.send_result(msg_id, {"player_id": player_id})


HANDLERS = (
    ws_capabilities,
    ws_ma,
    ws_player_ids,
    ws_search_providers,
    ws_queue_items,
    ws_set_autoplay,
    ws_autoplay_options,
    ws_set_autoplay_mode,
    ws_item_tracks,
    ws_favorite_current,
    ws_unfavorite_current,
    ws_active_queue,
    ws_subscribe_queue,
    ws_subscribe_live,
    ws_subscribe_ma_status,
    # #156 sleep timer off (Randy: kept for a standalone player):
    # ws_sleep_timer_get,
    # ws_sleep_timer_set,
    # ws_sleep_timer_clear,
    # ws_subscribe_sleep_timer,
)


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register all commands (once, from async_setup)."""
    for handler in HANDLERS:
        websocket_api.async_register_command(hass, handler)

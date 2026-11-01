"""Websocket commands for the Jukebox Card.

Why websocket and not services: a websocket handler sees `connection.user`, so
we can enforce per-command permission classes, and it does not write a
`call_service` event to the recorder for every queue poll.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import probatio

from homeassistant.auth.models import User
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized

from . import format as fmt
from .client import MaUnavailable, async_get_ma_client
from .const import (
    DOMAIN,
    LOGGER,
    MA_COMMANDS,
    NO_WRITE_ARG_KEYS,
    PLAYER_ARG_KEYS,
    PLAYER_LIST_ARG_KEYS,
    QUEUE_EVENTS,
    QUEUE_LIMIT_MAX,
    RESERVED_ARG_KEYS,
    TODO_VERIFY,
    TRACK_PAGE_DEFAULT,
    TRACK_PAGE_MAX,
    PermClass,
    is_denied,
    todo_verify_commands,
)
from .permissions import Policy, allowed_classes, check_class, check_entity, is_guest
from .players import PlayerNotFound, entity_for_player, queue_id_for_entity

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
        async with asyncio.timeout(COMMAND_TIMEOUT):
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
    queue_id = queue_id_for_entity(hass, msg["entity_id"])
    queue = await _send(client, "player_queues/get", queue_id=queue_id) or {}
    current = queue.get("current_index")
    cur = current if isinstance(current, int) and current >= 0 else 0
    offset = max(0, cur - msg["limit_before"])
    limit = (cur - offset) + 1 + msg["limit_after"]
    items = await _send(client, "player_queues/items", queue_id=queue_id, limit=limit, offset=offset) or []
    current_item = queue.get("current_item") or {}
    connection.send_result(
        msg["id"],
        {
            "queue_id": queue_id,
            "current_index": current,
            "index_in_buffer": queue.get("index_in_buffer"),
            "current_item_id": current_item.get("queue_item_id"),
            "total": queue.get("items"),
            "offset": offset,
            "items": [fmt.format_queue_item(i) for i in items if isinstance(i, dict)],
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
    queue_id = queue_id_for_entity(hass, msg["entity_id"])
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
    {probatio.Required("type"): f"{DOMAIN}/subscribe_queue", probatio.Required("entity_id"): str}
)
@websocket_api.async_response
@_wrap
async def ws_subscribe_queue(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Push a small event whenever the entity's MA queue or its items change."""
    _e, policy, client = _context(hass)
    user = connection.user
    check_class(user, policy, PermClass.READ)
    check_entity(user, msg["entity_id"], control=False)
    queue_id = queue_id_for_entity(hass, msg["entity_id"])
    msg_id = msg["id"]

    @callback
    def _on_event(event: Any) -> None:
        name = str(getattr(getattr(event, "event", None), "value", getattr(event, "event", "")))
        connection.send_message(
            websocket_api.event_message(msg_id, {"event": name, "queue_id": getattr(event, "object_id", queue_id)})
        )

    from music_assistant_models.enums import EventType  # noqa: PLC0415

    unsub = client.subscribe(_on_event, tuple(EventType(e) for e in QUEUE_EVENTS), queue_id)
    connection.subscriptions[msg_id] = unsub
    connection.send_result(msg_id, {"queue_id": queue_id})


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/raw",
        probatio.Required("command"): str,
        probatio.Optional("args", default={}): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
@_wrap
async def ws_raw(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Admin-only escape hatch for diagnostics. Still refuses auth/*."""
    if msg["command"].startswith("auth/"):
        raise KioskError("not_allowed", "auth/* is never forwarded")
    _e, _p, client = _context(hass)
    LOGGER.debug("raw MA command by admin: %s", msg["command"])
    connection.send_result(msg["id"], await _send(client, msg["command"], **msg["args"]))


HANDLERS = (
    ws_capabilities,
    ws_ma,
    ws_queue_items,
    ws_item_tracks,
    ws_unfavorite_current,
    ws_subscribe_queue,
    ws_raw,
)


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register all commands (once, from async_setup)."""
    for handler in HANDLERS:
        websocket_api.async_register_command(hass, handler)

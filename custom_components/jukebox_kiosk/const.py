"""Constants for Jukebox Kiosk.

The MA_COMMANDS table below is the single place that lists every Music Assistant
command this integration will forward, the permission class a caller needs for it,
and how sure we are that the command name and arguments are right.

Status values:
  "client"      - music-assistant-client 1.5.1 has a wrapper that sends this exact
                  command name (checked in the client source).
  "live"        - no client wrapper, but the Jukebox Card already sends it to a live
                  MA 2.10.x server through mass_queue.send_command and it works.
  "checked"     - confirmed by the read-only command check against a live MA 2.10.9
                  server (2026-11-01): name and argument names; writes were NOT called.
  "TODO-VERIFY" - name and/or arguments not confirmed. Do not build card features on
                  these until a read-only check against a live server confirms them.
                  (No command has this status at the moment; the read-only follow-up
                  check of 2026-11-01 confirmed the last three.)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import logging
from typing import Final

DOMAIN: Final = "jukebox_kiosk"
MA_DOMAIN: Final = "music_assistant"
LOGGER = logging.getLogger(__package__)

CONF_MA_ENTRY_ID: Final = "ma_entry_id"
CONF_GUEST_USERS: Final = "guest_users"
CONF_NON_ADMINS_ARE_GUESTS: Final = "non_admins_are_guests"
CONF_GUEST_CLASSES: Final = "guest_classes"

# Frontend
CARD_FILENAME: Final = "jukebox-card.js"
STATIC_URL_BASE: Final = "/jukebox_kiosk_static"
CARD_URL: Final = f"{STATIC_URL_BASE}/{CARD_FILENAME}"
# Home Assistant 2026.11 (HACS built in as the Marketplace) serves plugin resources from /local/community/
# and keeps /hacsfiles/ working, so the old card can sit under either path.
LEGACY_RESOURCE_MARKERS: Final = (
    "/hacsfiles/ha-jukebox-kiosk-card/",
    "/hacsfiles/ha-jukebox-card/",
    "/local/community/ha-jukebox-kiosk-card/",
    "/local/community/ha-jukebox-card/",
)

# Repairs issue ids
ISSUE_CLIENT_API: Final = "ma_client_api_changed"
ISSUE_LEGACY_PLUGIN: Final = "legacy_card_plugin_installed"
ISSUE_MA_ENTRY_MISSING: Final = "ma_entry_missing"

# Track list paging (MA returns full lists; we slice server side)
TRACK_PAGE_DEFAULT: Final = 100
TRACK_PAGE_MAX: Final = 1000
QUEUE_LIMIT_MAX: Final = 1000


class PermClass(StrEnum):
    """Permission classes. A command needs exactly one."""

    READ = "read"  # browse, search, queue/lyrics reads
    PLAYBACK = "playback"  # play/enqueue media, jump in queue
    QUEUE = "queue"  # reorder/remove/re-add queue items
    LIBRARY = "library"  # favourites, library and playlist writes
    SPEAKERS = "speakers"  # MA grouping (set_members), transfer, stop. Volume/mute is not here: the card
    # sends it as HA media_player services, which this integration does not gate.
    ADMIN = "admin"  # never granted to guests


ALL_CLASSES: Final = frozenset(PermClass)
GUEST_ASSIGNABLE: Final = frozenset(ALL_CLASSES - {PermClass.ADMIN})
# Guests (by default every non-admin user, e.g. a kiosk login) may browse, play, edit the queue and
# favourite/unfavourite, but not regroup speakers. Only used when an entry is created and as the fallback
# for options that lack the key; a saved entry keeps the classes stored in its options.
DEFAULT_GUEST_CLASSES: Final = (
    PermClass.READ,
    PermClass.PLAYBACK,
    PermClass.QUEUE,
    PermClass.LIBRARY,
)


@dataclass(frozen=True, slots=True)
class MaCommand:
    """One allowlisted Music Assistant command."""

    perm: PermClass
    status: str  # "client" | "live" | "checked" | "TODO-VERIFY"
    # Pass the calling HA user to MA. MA only honours `user` on commands it marks
    # allow_impersonation (search, item_by_name, verify_item_uri, play_media,
    # <type>/library_items, get_collection) and silently ignores it elsewhere, so
    # recents/favourites/recommendations are NOT per-user.
    impersonate: bool = False
    redact: str | None = None  # name of a response filter for non-admins
    # Args always sent with these values, whatever the caller passed. A caller that
    # passes a different value is refused (see forward()).
    forced: tuple[tuple[str, object], ...] = ()
    # For non-admin callers: (arg, allowed prefixes). The arg must be a string that
    # starts with one of the prefixes, or the call is refused. Admins are exempt.
    guest_arg_prefixes: tuple[tuple[str, tuple[str, ...]], ...] = ()
    note: str = ""


TODO_VERIFY: Final = "TODO-VERIFY"

_LIBRARY_ITEMS_ARGS: Final = (
    "favorite, search, limit=500, offset=0, order_by='sort_name', provider, genre, played_only; "
    "keyword-only summary=True, collapse_collections, reachable_via. summary=False returns full items "
    "with fully_played / resume_position_ms"
)

RADIO_BROWSE_PREFIX: Final = "radiobrowser://"

R, P, Q, L, S = (
    PermClass.READ,
    PermClass.PLAYBACK,
    PermClass.QUEUE,
    PermClass.LIBRARY,
    PermClass.SPEAKERS,
)

# Single source of truth for forwarded commands. Anything not listed is refused.
MA_COMMANDS: Final[dict[str, MaCommand]] = {
    # --- queue (mass_queue parity) ---
    "player_queues/get": MaCommand(R, "checked", note="`items` field is the queue length"),
    "player_queues/items": MaCommand(R, "checked", note="plain slice: queue_id, limit, offset"),
    "player_queues/get_active_queue": MaCommand(R, "client"),
    "player_queues/play_index": MaCommand(P, "client"),
    "player_queues/play_media": MaCommand(P, "client", impersonate=True),
    "player_queues/move_item": MaCommand(Q, "client"),
    "player_queues/delete_item": MaCommand(Q, "client"),
    "player_queues/transfer": MaCommand(S, "client"),
    # --- players / speakers ---
    "players/all": MaCommand(R, "client"),
    "players/cmd/set_members": MaCommand(S, "client"),
    "players/cmd/stop": MaCommand(S, "client"),
    "config/players/get": MaCommand(
        R, "client", redact="group_config", note="non-admins only get group_members/dynamic_members"
    ),
    "players/add_currently_playing_to_favorites": MaCommand(L, "client"),
    # --- music reads ---
    "music/item_by_uri": MaCommand(
        R,
        "checked",
        forced=(("allow_update_metadata", False),),
        note="uri; read-only only with allow_update_metadata=False (forced). Returns the full Track, "
        "but the LIBRARY copy (provider 'library') when the track is in the library",
    ),
    "music/search": MaCommand(R, "checked", impersonate=True, note="result has a genres key"),
    "music/browse": MaCommand(
        R,
        "checked",
        guest_arg_prefixes=(("path", (RADIO_BROWSE_PREFIX,)),),
        note="path; skip leading '..' entries. Non-admins may only browse the Radio Browser tree "
        "(the root also lists builtin and provider libraries, a filesystem provider lists file names)",
    ),
    "music/albums/album_tracks": MaCommand(R, "client"),
    "music/artists/artist_tracks": MaCommand(R, "client"),
    "music/playlists/playlist_tracks": MaCommand(R, "client"),
    "music/podcasts/podcast_episodes": MaCommand(R, "client"),
    "music/recently_played_items": MaCommand(R, "checked", note="returns ItemMappings; not per-user"),
    "music/recommendations": MaCommand(R, "checked", note="rows have empty items"),
    "music/in_progress_items": MaCommand(R, "checked", note="limit"),
    "music/tracks/similar_tracks": MaCommand(R, "client"),
    "music/tracks/library_items": MaCommand(R, "client", impersonate=True),
    "music/albums/library_items": MaCommand(R, "client", impersonate=True),
    "music/artists/library_items": MaCommand(R, "client", impersonate=True),
    "music/playlists/library_items": MaCommand(R, "client", impersonate=True),
    "metadata/get_track_lyrics": MaCommand(
        R, "checked", redact=None, note="track=FULL provider Track -> [plain, lrc]; library tracks refused (MA would write metadata)"
    ),
    # --- library writes ---
    "music/favorites/add_item": MaCommand(L, "checked", note="item: uri or item"),
    "music/favorites/remove_item": MaCommand(L, "checked", note="media_type, library_item_id"),
    "music/library/add_item": MaCommand(L, "checked", note="item, overwrite_existing"),
    "music/mark_played": MaCommand(L, "client"),
    "music/playlists/create_playlist": MaCommand(L, "client"),
    "music/playlists/add_playlist_tracks": MaCommand(L, "checked", note="db_playlist_id, uris"),
    "music/playlists/remove_playlist_tracks": MaCommand(L, "checked", note="db_playlist_id, positions_to_remove"),
    # --- roadmap (MA web-app parity); names/args from the live check, card does not use yet ---
    "music/recommendations/items": MaCommand(R, "checked", note="provider, item_id; rows from music/recommendations come back empty"),
    "music/genres/library_items": MaCommand(R, "checked", impersonate=True),
    "music/genres/count": MaCommand(R, "checked"),
    "music/genres/get": MaCommand(R, "checked"),
    "music/genres/tracks": MaCommand(R, "checked", note="item_id, limit, offset, order_by"),
    "music/genres/albums": MaCommand(R, "checked"),
    "players/sleep_timer/get": MaCommand(R, "checked"),
    "players/sleep_timer/set": MaCommand(P, "checked", note="player_id, seconds; write not exercised"),
    "players/sleep_timer/clear": MaCommand(P, "checked", note="player_id; write not exercised"),
    "player_queues/set_playback_speed": MaCommand(P, "checked", note="queue_id, speed 0.5-3.0, queue_item_id; write not exercised"),
    "player_queues/save_as_playlist": MaCommand(L, "checked", note="queue_id, name; write not exercised"),
    # --- confirmed by the read-only follow-up check (2026-11-01) ---
    "music/genres/overview": MaCommand(
        R,
        "checked",
        note="item_id, provider_instance_id_or_domain='library', limit=25 (per row). Returns folders "
        "Artists/Albums/Tracks/Playlists (… radio/podcast/audiobook when present) with item_id genre_<type>",
    ),
    "music/podcasts/library_items": MaCommand(R, "checked", impersonate=True, note=_LIBRARY_ITEMS_ARGS),
    "music/audiobooks/library_items": MaCommand(R, "checked", impersonate=True, note=_LIBRARY_ITEMS_ARGS),
}

# Never forwarded, even for admins via the generic proxy (admins can use
# jukebox_kiosk/raw on purpose). Prefix match.
DENY_PREFIXES: Final = (
    "auth/",
    "config/core/",
    "config/providers/",
    "players/remove",
    "music/sync",
)
DENY_SUFFIXES: Final = ("/remove",)

# Keys a caller may never set in forwarded args (we inject impersonation ourselves).
RESERVED_ARG_KEYS: Final = frozenset({"user", "username", "message_id", "command"})

# Args that make MA write to its library/DB when true. Refused as true on every
# allowlisted command (MA defaults them to the safe value where it matters, and
# item_by_uri forces False).
NO_WRITE_ARG_KEYS: Final = frozenset({"allow_update_metadata"})

# Arg keys that name MA players/queues; non-admin callers must be allowed to
# control the matching HA media_player entity.
PLAYER_ARG_KEYS: Final = (
    "queue_id",
    "player_id",
    "target_player",
    "source_queue_id",
    "target_queue_id",
)
PLAYER_LIST_ARG_KEYS: Final = ("player_ids_to_add", "player_ids_to_remove")

QUEUE_EVENTS: Final = ("queue_updated", "queue_items_updated")


def is_denied(command: str) -> bool:
    """Return True for commands that are never forwarded."""
    return command.startswith(DENY_PREFIXES) or command.endswith(DENY_SUFFIXES)


def todo_verify_commands() -> list[str]:
    """Commands still marked TODO-VERIFY."""
    return sorted(k for k, v in MA_COMMANDS.items() if v.status == TODO_VERIFY)

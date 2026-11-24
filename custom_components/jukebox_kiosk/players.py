"""Map between HA media_player entities and MA player/queue ids."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import MA_DOMAIN


class PlayerNotFound(HomeAssistantError):
    """Entity is not an MA media player."""


def _is_ma_player(ent: er.RegistryEntry) -> bool:
    """A media_player that Home Assistant's Music Assistant integration created.

    HA's music_assistant media_player uses the MA player_id as the entity's unique_id
    (HA 2026.11 music_assistant/entity.py:62-69, media_player.py:504, 690), so the registry is the one
    place that ties an entity to its MA player. No name matching, no state attributes.
    """
    return ent.platform == MA_DOMAIN and ent.domain == "media_player"


def player_id_for_entity(hass: HomeAssistant, entity_id: str) -> str:
    """MA player_id behind a media_player entity (registry unique_id)."""
    ent = er.async_get(hass).async_get(entity_id)
    if ent is None or not _is_ma_player(ent):
        raise PlayerNotFound(f"{entity_id} is not a Music Assistant player")
    return ent.unique_id


def player_ids(hass: HomeAssistant) -> dict[str, str]:
    """Every Music Assistant media_player in the registry → its MA player_id (same rule as player_id_for_entity)."""
    return {ent.entity_id: ent.unique_id for ent in er.async_get(hass).entities.values() if _is_ma_player(ent)}


def _field(obj: Any, key: str) -> Any:
    """A field of an MA model (music-assistant-client keeps models) or of a plain dict."""
    return obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)


def active_queue_id(client: Any, player_id: str) -> str | None:
    """#100: the one active-queue rule, Music Assistant's own app rule (frontend 2.17.297.post3 helpers.ts:248-261
    `resolvePlayerQueue`), read from the player and queue lists the MA client keeps current from MA's events.

    1. The player's active_source, when it names a queue: that queue.
    2. With no active_source: the player's own queue, only when that queue is active.
    3. Otherwise no queue (None). An external source (Spotify Connect, AirPlay, line-in...) is attached to no queue.

    MA already resolves active_source for a synced follower or a member of an active group to the leader's / group's
    source (server models/player.py __final_active_source), the same owner walk as players/controller.py
    get_active_queue and as the sleep timer's _playback_owner_id, so the three agree on group and sync members.
    """
    players = getattr(client, "players", None)
    queues = getattr(client, "player_queues", None)
    player = players.get(player_id) if players is not None else None
    if player is None or queues is None:
        return None
    source = _field(player, "active_source")
    if isinstance(source, str) and source:
        return source if queues.get(source) is not None else None
    own = queues.get(player_id)
    return player_id if own is not None and _field(own, "active") is True else None


def queue_id_for_entity(hass: HomeAssistant, client: Any, entity_id: str) -> str | None:
    """Active MA queue for an MA media_player entity (active_queue_id on its registry player id), or None."""
    return active_queue_id(client, player_id_for_entity(hass, entity_id))


def entity_for_player(hass: HomeAssistant, player_id: str) -> str | None:
    """media_player entity for an MA player id, if HA has one."""
    return er.async_get(hass).async_get_entity_id("media_player", MA_DOMAIN, player_id)

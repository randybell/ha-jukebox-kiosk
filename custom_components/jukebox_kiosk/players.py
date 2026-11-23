"""Map between HA media_player entities and MA player/queue ids."""

from __future__ import annotations

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


def queue_id_for_entity(hass: HomeAssistant, entity_id: str) -> str:
    """Active MA queue for an entity: state attr `active_queue`, else its player id."""
    player_id = player_id_for_entity(hass, entity_id)
    state = hass.states.get(entity_id)
    active = state.attributes.get("active_queue") if state else None
    return active if isinstance(active, str) and active else player_id


def entity_for_player(hass: HomeAssistant, player_id: str) -> str | None:
    """media_player entity for an MA player id, if HA has one."""
    return er.async_get(hass).async_get_entity_id("media_player", MA_DOMAIN, player_id)

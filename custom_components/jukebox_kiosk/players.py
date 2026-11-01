"""Map between HA media_player entities and MA player/queue ids."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import MA_DOMAIN


class PlayerNotFound(HomeAssistantError):
    """Entity is not an MA media player."""


def player_id_for_entity(hass: HomeAssistant, entity_id: str) -> str:
    """MA player_id behind a media_player entity (registry unique_id)."""
    ent = er.async_get(hass).async_get(entity_id)
    if ent is None or ent.platform != MA_DOMAIN or ent.domain != "media_player":
        raise PlayerNotFound(f"{entity_id} is not a Music Assistant player")
    return ent.unique_id


def queue_id_for_entity(hass: HomeAssistant, entity_id: str) -> str:
    """Active MA queue for an entity: state attr `active_queue`, else its player id."""
    player_id = player_id_for_entity(hass, entity_id)
    state = hass.states.get(entity_id)
    active = state.attributes.get("active_queue") if state else None
    return active if isinstance(active, str) and active else player_id


def entity_for_player(hass: HomeAssistant, player_id: str) -> str | None:
    """media_player entity for an MA player id, if HA has one."""
    return er.async_get(hass).async_get_entity_id("media_player", MA_DOMAIN, player_id)

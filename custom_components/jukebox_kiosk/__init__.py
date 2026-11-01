"""Jukebox Kiosk: Music Assistant backend and bundled card for touch kiosks."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, issue_registry as ir
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from . import frontend, websocket_api
from .const import CONF_MA_ENTRY_ID, DOMAIN, ISSUE_MA_ENTRY_MISSING, MA_DOMAIN
from .permissions import Policy

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


@dataclass(slots=True)
class KioskData:
    """Runtime data."""

    ma_entry_id: str
    policy: Policy
    version: str


type KioskConfigEntry = ConfigEntry[KioskData]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register websocket commands once."""
    websocket_api.async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: KioskConfigEntry) -> bool:
    """Set up from a config entry."""
    integration = await async_get_integration(hass, DOMAIN)
    version = str(integration.version or "0")
    ma_entry_id = entry.data[CONF_MA_ENTRY_ID]

    ma = hass.config_entries.async_get_entry(ma_entry_id)
    if ma is None or ma.domain != MA_DOMAIN:
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_MA_ENTRY_MISSING,
            is_fixable=False,
            severity=ir.IssueSeverity.ERROR,
            translation_key=ISSUE_MA_ENTRY_MISSING,
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, ISSUE_MA_ENTRY_MISSING)

    entry.runtime_data = KioskData(ma_entry_id=ma_entry_id, policy=Policy.from_entry(entry), version=version)

    await frontend.async_register_static(hass)
    frontend.async_add_card(hass, version)
    frontend.async_schedule_cleanup(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: KioskConfigEntry) -> bool:
    """Unload."""
    frontend.async_remove_card(hass, entry.runtime_data.version)
    return True

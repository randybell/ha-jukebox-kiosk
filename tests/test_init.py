"""Setup, unload, config flow."""

from __future__ import annotations

from typing import Any

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.jukebox_kiosk.const import DOMAIN

from .conftest import MA_ENTRY_ID, mark_frontend_loaded


async def test_setup_adds_card(hass: HomeAssistant, kiosk: Any) -> None:
    kiosk.js_urls.add.assert_called_once_with("/jukebox_kiosk_static/jukebox-card.js?v=0.7.14")
    assert kiosk.state is config_entries.ConfigEntryState.LOADED


async def test_flow_auto_picks_single_ma(hass: HomeAssistant, ma_entry: MockConfigEntry) -> None:
    await mark_frontend_loaded(hass)
    from unittest.mock import patch

    with patch("custom_components.jukebox_kiosk.async_setup_entry", return_value=True):
        res = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert res["data"] == {"ma_entry_id": MA_ENTRY_ID}
    assert res["options"]["non_admins_are_guests"] is True
    assert res["options"]["guest_classes"] == ["read", "playback", "queue", "library"]


async def test_flow_asks_when_two_ma(hass: HomeAssistant, ma_entry: MockConfigEntry) -> None:
    await mark_frontend_loaded(hass)
    MockConfigEntry(domain="music_assistant", entry_id="second_placeholder").add_to_hass(hass)
    res = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert res["type"] is FlowResultType.FORM and res["step_id"] == "user"


async def test_flow_aborts_without_ma(hass: HomeAssistant) -> None:
    await mark_frontend_loaded(hass)
    res = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert res["type"] is FlowResultType.ABORT and res["reason"] == "no_music_assistant"


async def test_options_flow(hass: HomeAssistant, kiosk: Any) -> None:
    res = await hass.config_entries.options.async_init(kiosk.entry_id)
    assert res["type"] is FlowResultType.FORM
    from unittest.mock import patch

    with (
        patch("custom_components.jukebox_kiosk.frontend.async_register_static"),
        patch("custom_components.jukebox_kiosk.frontend.async_schedule_cleanup"),
    ):
        res = await hass.config_entries.options.async_configure(
            res["flow_id"], {"guest_users": [], "non_admins_are_guests": False, "guest_classes": ["read"]}
        )
        await hass.async_block_till_done()
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert kiosk.runtime_data.policy.non_admins_are_guests is False


async def test_unload(hass: HomeAssistant, kiosk: Any) -> None:
    from unittest.mock import patch

    assert await hass.config_entries.async_unload(kiosk.entry_id)
    kiosk.js_urls.remove.assert_called_once_with("/jukebox_kiosk_static/jukebox-card.js?v=0.7.14")

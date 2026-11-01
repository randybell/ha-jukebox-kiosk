"""Client wrapper: core helper, runtime_data fallback, repairs issue."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import issue_registry as ir

from custom_components.jukebox_kiosk import client as kclient
from custom_components.jukebox_kiosk.const import DOMAIN, ISSUE_CLIENT_API

from .conftest import MA_ENTRY_ID, FakeMa


async def test_core_helper_used(hass: HomeAssistant, ma_entry: MockConfigEntry, fake_ma: FakeMa) -> None:
    assert kclient._core_helper is not None  # present in HA 2026.10
    assert kclient.async_get_ma_client(hass, MA_ENTRY_ID) is fake_ma


async def test_fallback_when_helper_missing(hass: HomeAssistant, ma_entry: MockConfigEntry, fake_ma: FakeMa) -> None:
    with patch.object(kclient, "_core_helper", None):
        assert kclient.async_get_ma_client(hass, MA_ENTRY_ID) is fake_ma


async def test_fallback_when_helper_signature_drifts(hass: HomeAssistant, ma_entry: MockConfigEntry, fake_ma: FakeMa) -> None:
    def broken(*_a: object, **_k: object) -> None:
        raise TypeError("new signature")

    with patch.object(kclient, "_core_helper", broken):
        assert kclient.async_get_ma_client(hass, MA_ENTRY_ID) is fake_ma


async def test_helper_validation_error_is_unavailable(hass: HomeAssistant, ma_entry: MockConfigEntry) -> None:
    def not_loaded(*_a: object) -> None:
        raise ServiceValidationError("Entry not loaded")

    with patch.object(kclient, "_core_helper", not_loaded), pytest.raises(kclient.MaUnavailable) as err:
        kclient.async_get_ma_client(hass, MA_ENTRY_ID)
    assert err.value.reason == "not_loaded"
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CLIENT_API) is None


async def test_issue_when_both_paths_fail(hass: HomeAssistant, ma_entry: MockConfigEntry, fake_ma: FakeMa) -> None:
    ma_entry.runtime_data = SimpleNamespace(client=fake_ma)  # attribute renamed upstream
    with patch.object(kclient, "_core_helper", lambda *_a: None), pytest.raises(kclient.MaUnavailable) as err:
        kclient.async_get_ma_client(hass, MA_ENTRY_ID)
    assert err.value.reason == "api_changed"
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CLIENT_API) is not None
    ma_entry.runtime_data = SimpleNamespace(mass=fake_ma)
    kclient.async_get_ma_client(hass, MA_ENTRY_ID)
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CLIENT_API) is None


async def test_missing_and_not_loaded(hass: HomeAssistant) -> None:
    with pytest.raises(kclient.MaUnavailable) as err:
        kclient.async_get_ma_client(hass, "nope_placeholder")
    assert err.value.reason == "not_found"
    e = MockConfigEntry(domain="music_assistant", entry_id="other_placeholder", state=ConfigEntryState.SETUP_ERROR)
    e.add_to_hass(hass)
    with pytest.raises(kclient.MaUnavailable) as err:
        kclient.async_get_ma_client(hass, "other_placeholder")
    assert err.value.reason == "not_loaded"

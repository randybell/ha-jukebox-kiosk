"""Serve the bundled Jukebox Card and clean up the old HACS plugin resource."""

from __future__ import annotations

import os

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, Event, HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .const import (
    CARD_FILENAME,
    CARD_URL,
    DOMAIN,
    ISSUE_LEGACY_PLUGIN,
    LEGACY_RESOURCE_MARKERS,
    LOGGER,
    STATIC_URL_BASE,
)

WWW = Path(__file__).parent / "www"
DATA_STATIC = f"{DOMAIN}_static_registered"


def card_url(version: str) -> str:
    """Card URL with a cache-busting version query."""
    return f"{CARD_URL}?v={version}"


async def async_register_static(hass: HomeAssistant) -> None:
    """Register /jukebox_kiosk_static once per HA run (cannot be unregistered)."""
    if hass.data.get(DATA_STATIC):
        return
    if not (WWW / CARD_FILENAME).is_file():
        LOGGER.warning("Bundled card %s is missing; build the frontend", CARD_FILENAME)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL_BASE, str(WWW), cache_headers=False)]
    )
    hass.data[DATA_STATIC] = True


@callback
def async_add_card(hass: HomeAssistant, version: str) -> None:
    """Load the card on every dashboard."""
    add_extra_js_url(hass, card_url(version))


@callback
def async_remove_card(hass: HomeAssistant, version: str) -> None:
    """Stop loading the card (entry unload)."""
    remove_extra_js_url(hass, card_url(version))


def _is_legacy(url: str) -> bool:
    return any(marker in url for marker in LEGACY_RESOURCE_MARKERS)


LEGACY_PLUGIN_DIR = ("www", "community", "ha-jukebox-kiosk-card")


def _legacy_files_present(hass: HomeAssistant) -> bool:
    """True while the old HACS plugin folder is still on disk (runs in the executor)."""
    return os.path.isdir(hass.config.path(*LEGACY_PLUGIN_DIR))


async def async_cleanup_legacy_resources(hass: HomeAssistant) -> int:
    """Remove old HACS plugin Lovelace resources (storage mode only).

    Returns how many were removed. In YAML mode we cannot edit, so we raise a
    Repairs issue instead. The plugin files themselves are left for the user
    to remove in HACS; while they are still on disk the Repairs issue stays
    (also after the restart that follows the automatic resource removal).
    """
    items: list[dict] = []
    mode = None
    resources = None
    lovelace = hass.data.get("lovelace")
    if lovelace is not None:
        resources = getattr(lovelace, "resources", None)
        mode = getattr(lovelace, "resource_mode", None)
    if resources is not None:
        if hasattr(resources, "async_get_info"):
            await resources.async_get_info()  # forces storage load
        items = [i for i in (resources.async_items() or []) if _is_legacy(str(i.get("url", "")))]
    if not items:
        if await hass.async_add_executor_job(_legacy_files_present, hass):
            ir.async_create_issue(
                hass,
                DOMAIN,
                ISSUE_LEGACY_PLUGIN,
                is_fixable=False,
                is_persistent=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key="legacy_card_plugin_files",
            )
        else:
            ir.async_delete_issue(hass, DOMAIN, ISSUE_LEGACY_PLUGIN)
        return 0
    removed = 0
    if mode == "storage" and hasattr(resources, "async_delete_item"):
        for item in items:
            try:
                await resources.async_delete_item(item["id"])
                removed += 1
            except Exception as err:  # noqa: BLE001
                LOGGER.warning("Could not remove old card resource %s: %s", item.get("url"), err)
    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_LEGACY_PLUGIN,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="legacy_card_plugin_yaml" if mode != "storage" else ISSUE_LEGACY_PLUGIN,
        translation_placeholders={"count": str(len(items)), "removed": str(removed)},
    )
    return removed


@callback
def async_schedule_cleanup(hass: HomeAssistant) -> None:
    """Run the cleanup once HA has fully started."""

    async def _run(_event: Event | None = None) -> None:
        await async_cleanup_legacy_resources(hass)

    if hass.state is CoreState.running:
        hass.async_create_task(_run(), eager_start=True)
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _run)

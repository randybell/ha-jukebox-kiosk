"""Frontend loader and legacy resource cleanup."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.jukebox_kiosk import frontend
from custom_components.jukebox_kiosk.const import DOMAIN, ISSUE_LEGACY_PLUGIN


class FakeResources:
    def __init__(self, items: list[dict[str, Any]]) -> None:
        self.items = items
        self.deleted: list[str] = []

    async def async_get_info(self) -> dict[str, int]:
        return {"resources": len(self.items)}

    def async_items(self) -> list[dict[str, Any]]:
        return list(self.items)

    async def async_delete_item(self, item_id: str) -> None:
        self.deleted.append(item_id)
        self.items = [i for i in self.items if i["id"] != item_id]


ITEMS = [
    {"id": "r1", "url": "/hacsfiles/ha-jukebox-kiosk-card/jukebox-card.js?hacstag=1", "type": "module"},
    {"id": "r2", "url": "/hacsfiles/other-card/other.js", "type": "module"},
]


def test_card_url_has_version() -> None:
    assert frontend.card_url("0.6.0") == "/jukebox_kiosk_static/jukebox-card.js?v=0.6.0"


async def test_storage_mode_removes_legacy(hass: HomeAssistant) -> None:
    res = FakeResources(list(ITEMS))
    hass.data["lovelace"] = SimpleNamespace(resource_mode="storage", resources=res)
    assert await frontend.async_cleanup_legacy_resources(hass) == 1
    assert res.deleted == ["r1"]
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_LEGACY_PLUGIN)
    assert issue is not None and issue.translation_key == ISSUE_LEGACY_PLUGIN
    # second run: nothing left, issue cleared
    assert await frontend.async_cleanup_legacy_resources(hass) == 0
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_LEGACY_PLUGIN) is None


async def test_yaml_mode_only_warns(hass: HomeAssistant) -> None:
    res = FakeResources(list(ITEMS))
    hass.data["lovelace"] = SimpleNamespace(resource_mode="yaml", resources=res)
    assert await frontend.async_cleanup_legacy_resources(hass) == 0
    assert res.deleted == []
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_LEGACY_PLUGIN)
    assert issue.translation_key == "legacy_card_plugin_yaml"


async def test_no_lovelace(hass: HomeAssistant) -> None:
    assert await frontend.async_cleanup_legacy_resources(hass) == 0


async def test_issue_stays_while_plugin_files_remain(hass: HomeAssistant, tmp_path) -> None:
    """After the restart that follows the automatic removal, the HACS files still need removing."""
    hass.config.config_dir = str(tmp_path)
    res = FakeResources(list(ITEMS))
    hass.data["lovelace"] = SimpleNamespace(resource_mode="storage", resources=res)
    plugin = tmp_path / "www" / "community" / "ha-jukebox-kiosk-card"
    plugin.mkdir(parents=True)
    (plugin / "jukebox-card.js").write_text("// placeholder")
    assert await frontend.async_cleanup_legacy_resources(hass) == 1
    # next start: no legacy resources left, but the plugin folder is still there
    assert await frontend.async_cleanup_legacy_resources(hass) == 0
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_LEGACY_PLUGIN)
    assert issue is not None and issue.translation_key == "legacy_card_plugin_files"
    # the user removes the plugin in HACS: the issue clears on the next run
    (plugin / "jukebox-card.js").unlink()
    plugin.rmdir()
    assert await frontend.async_cleanup_legacy_resources(hass) == 0
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_LEGACY_PLUGIN) is None


async def test_plugin_files_without_lovelace(hass: HomeAssistant, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    (tmp_path / "www" / "community" / "ha-jukebox-kiosk-card").mkdir(parents=True)
    assert await frontend.async_cleanup_legacy_resources(hass) == 0
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_LEGACY_PLUGIN)
    assert issue is not None and issue.translation_key == "legacy_card_plugin_files"


async def test_marketplace_local_community_path(hass: HomeAssistant) -> None:
    """Home Assistant 2026.11 moves plugin resources to /local/community/; those are legacy too."""
    res = FakeResources([
        {"id": "m1", "url": "/local/community/ha-jukebox-kiosk-card/jukebox-card.js?hacstag=2", "type": "module"},
        {"id": "m2", "url": "/local/community/other-card/other.js", "type": "module"},
        {"id": "m3", "url": "/local/jukebox-card.js", "type": "module"},
    ])
    hass.data["lovelace"] = SimpleNamespace(resource_mode="storage", resources=res)
    assert await frontend.async_cleanup_legacy_resources(hass) == 1
    assert res.deleted == ["m1"]

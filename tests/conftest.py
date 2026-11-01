"""Fixtures: a fake MA client behind a fake core music_assistant entry.

All ids below are placeholders, not real MA/HA ids.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry, MockUser

from homeassistant.auth.const import GROUP_ID_USER
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL
from homeassistant.setup import async_setup_component
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from custom_components.jukebox_kiosk.const import (
    CONF_GUEST_CLASSES,
    CONF_GUEST_USERS,
    CONF_MA_ENTRY_ID,
    CONF_NON_ADMINS_ARE_GUESTS,
    DOMAIN,
)

MA_ENTRY_ID = "ma_entry_placeholder"
PLAYER_A = "player_a_placeholder"
PLAYER_B = "player_b_placeholder"
SYNCGROUP = "syncgroup_placeholder"
ENTITY_A = "media_player.kitchen"
ENTITY_B = "media_player.den"
ENTITY_G = "media_player.everywhere"


def _qi(n: int) -> dict[str, Any]:
    return {
        "queue_item_id": f"qi{n}",
        "name": f"Song {n}",
        "duration": 180,
        "media_item": {
            "uri": f"library://track/{n}",
            "name": f"Song {n}",
            "provider": "library",
            "favorite": n % 2 == 0,
            "artists": [{"name": "Artist"}],
            "album": {"name": "Album", "metadata": {"images": [{"path": "https://img.example/a.jpg", "remotely_accessible": True}]}},
        },
    }


class FakeMa:
    """Records send_command calls and answers from a small table."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.server_info = SimpleNamespace(schema_version=44)
        self.queue = [_qi(n) for n in range(10)]
        self.subs: list[tuple[Any, Any, Any]] = []
        self.autoplay_key = "autoplay_enabled"  # older MA: "dont_stop_the_music_enabled"; None: no field
        self.autoplay_error: str | None = None  # raised by player_queues/autoplay when set
        # per-queue Autoplay style config (MA 2.10.9 config/player_queues/*); None = MA without the setting
        self.ap_mode: str | None = "global"
        self.ap_playlist: str | None = None
        self.ap_core = {"autoplay_mode": "auto", "autoplay_playlist": None}
        self.similar_available = True
        self.ap_playlists = [("library://playlist/1", "Sunday Morning Mix"), ("library://playlist/2", "Kitchen Dance Party")]

    async def send_command(self, command: str, require_schema: int | None = None, **kwargs: Any) -> Any:
        self.calls.append((command, kwargs))
        if command == "player_queues/get":
            q = {"queue_id": kwargs["queue_id"], "current_index": 4, "index_in_buffer": 4,
                 "items": len(self.queue), "current_item": self.queue[4], "is_dynamic": False}
            if self.autoplay_key:
                q[self.autoplay_key] = True
            return q
        if command == "config/player_queues/get_entries":
            if self.ap_mode is None:
                return [{"key": "crossfade", "options": []}]
            modes = [{"title": m, "value": m, "disabled": m == "similar" and not self.similar_available}
                     for m in ("global", "auto", "similar", "library", "playlist")]
            pls = [{"title": n, "value": u} for u, n in self.ap_playlists]
            return [{"key": "autoplay_mode", "options": modes}, {"key": "autoplay_playlist", "options": pls}]
        if command == "config/player_queues/get_value":
            return {"autoplay_mode": self.ap_mode, "autoplay_playlist": self.ap_playlist}[kwargs["key"]]
        if command == "config/core/get_value":
            return self.ap_core[kwargs["key"]]
        if command == "config/player_queues/save":
            self.ap_mode = kwargs["values"].get("autoplay_mode", self.ap_mode)
            self.ap_playlist = kwargs["values"].get("autoplay_playlist", self.ap_playlist)
            return None
        if command == "player_queues/autoplay" and self.autoplay_error:
            raise RuntimeError(self.autoplay_error)
        if command == "player_queues/items":
            o, lim = kwargs["offset"], kwargs["limit"]
            return self.queue[o : o + lim]
        if command == "music/playlists/playlist_tracks":
            return [{"uri": f"spotify://track/{n}", "name": f"T{n}", "duration": 100, "favorite": False} for n in range(250)]
        if command == "config/players/get":
            return {"player_id": kwargs["player_id"], "values": {"group_members": {"value": [PLAYER_A]},
                    "dynamic_members": {"value": True}, "secret_thing": {"value": "x"}}}
        if command == "players/all":
            return [{"player_id": PLAYER_A}, {"player_id": PLAYER_B}]
        return {"ok": command}

    def subscribe(self, cb: Any, event_filter: Any = None, id_filter: Any = None) -> Any:
        self.subs.append((cb, event_filter, id_filter))
        return lambda: self.subs.remove((cb, event_filter, id_filter))


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Load custom_components/."""


@pytest.fixture
def fake_ma() -> FakeMa:
    """The fake client."""
    return FakeMa()


@pytest.fixture
def ma_entry(hass: HomeAssistant, fake_ma: FakeMa) -> MockConfigEntry:
    """A loaded core music_assistant entry holding the fake client."""
    hass.config.components.add("music_assistant")
    entry = MockConfigEntry(domain="music_assistant", entry_id=MA_ENTRY_ID, title="MA", state=ConfigEntryState.LOADED)
    entry.add_to_hass(hass)
    entry.runtime_data = SimpleNamespace(mass=fake_ma)
    reg = er.async_get(hass)
    for pid, ent in ((PLAYER_A, ENTITY_A), (PLAYER_B, ENTITY_B), (SYNCGROUP, ENTITY_G)):
        reg.async_get_or_create("media_player", "music_assistant", pid, suggested_object_id=ent.split(".")[1],
                                config_entry=entry)
        hass.states.async_set(ent, "playing", {"active_queue": pid})
    return entry


@pytest.fixture
def options() -> dict[str, Any]:
    """Default options."""
    return {CONF_GUEST_USERS: [], CONF_NON_ADMINS_ARE_GUESTS: True,
            CONF_GUEST_CLASSES: ["read", "playback", "queue", "library"]}


@pytest.fixture
async def kiosk(hass: HomeAssistant, ma_entry: MockConfigEntry, options: dict[str, Any]) -> MockConfigEntry:
    """Set up jukebox_kiosk (frontend/http side effects patched out)."""
    await mark_frontend_loaded(hass)
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_MA_ENTRY_ID: MA_ENTRY_ID}, options=options)
    entry.add_to_hass(hass)
    with (
        patch("custom_components.jukebox_kiosk.frontend.async_register_static"),
        patch("custom_components.jukebox_kiosk.frontend.async_schedule_cleanup"),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    entry.js_urls = hass.data[DATA_EXTRA_MODULE_URL]  # type: ignore[attr-defined]
    return entry


async def mark_frontend_loaded(hass: HomeAssistant) -> None:
    """Real http, fake frontend (the frontend package is not installed in tests)."""
    assert await async_setup_component(hass, "http", {})
    hass.config.components.add("frontend")
    hass.data.setdefault(DATA_EXTRA_MODULE_URL, MagicMock())


async def _token_for(hass: HomeAssistant, user: MockUser) -> str:
    refresh = await hass.auth.async_create_refresh_token(user, "https://example.invalid/")
    return hass.auth.async_create_access_token(refresh)


@pytest.fixture
async def user_token(hass: HomeAssistant, local_auth: Any) -> tuple[MockUser, str]:
    """A plain non-admin user and its access token."""
    group = await hass.auth.async_get_group(GROUP_ID_USER)
    user = MockUser(name="Kiosk", groups=[group]).add_to_hass(hass)
    return user, await _token_for(hass, user)


@pytest.fixture
async def admin_token(hass: HomeAssistant, hass_admin_user: MockUser) -> tuple[MockUser, str]:
    """Admin user and token."""
    return hass_admin_user, await _token_for(hass, hass_admin_user)

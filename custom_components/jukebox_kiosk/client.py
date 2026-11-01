"""Access to the Music Assistant client owned by the core integration.

We never open our own MA connection. We borrow the one the core
`music_assistant` integration already holds:

1. `homeassistant.components.music_assistant.helpers.get_music_assistant_client`
   (present in HA 2026.10; internal API, may move), else
2. `entry.runtime_data.mass` (what that helper returns today).

If neither works we raise MaUnavailable and open a Repairs issue so the user
knows an HA update changed something under us.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import issue_registry as ir

from .const import DOMAIN, ISSUE_CLIENT_API, LOGGER, MA_DOMAIN

if TYPE_CHECKING:
    from music_assistant_client import MusicAssistantClient

try:  # internal core helper; keep optional so a refactor upstream degrades, not breaks
    from homeassistant.components.music_assistant.helpers import (
        get_music_assistant_client as _core_helper,
    )
except ImportError:  # pragma: no cover - depends on HA version
    _core_helper: Callable[[HomeAssistant, str], Any] | None = None  # type: ignore[no-redef]


class MaUnavailable(HomeAssistantError):
    """Music Assistant client cannot be reached right now."""

    def __init__(self, reason: str, message: str) -> None:
        """Store a machine-readable reason next to the message."""
        super().__init__(message)
        self.reason = reason


def _looks_like_client(obj: Any) -> bool:
    return obj is not None and callable(getattr(obj, "send_command", None))


@callback
def async_get_ma_client(hass: HomeAssistant, ma_entry_id: str) -> MusicAssistantClient:
    """Return the core MA client for an entry, or raise MaUnavailable."""
    entry = hass.config_entries.async_get_entry(ma_entry_id)
    if entry is None or entry.domain != MA_DOMAIN:
        raise MaUnavailable("not_found", "Music Assistant entry not found")
    if entry.state is not ConfigEntryState.LOADED:
        raise MaUnavailable("not_loaded", "Music Assistant is not loaded")

    helper = _core_helper
    if helper is not None:
        try:
            client = helper(hass, ma_entry_id)
        except ServiceValidationError as err:
            raise MaUnavailable("not_loaded", str(err)) from err
        except Exception as err:  # noqa: BLE001 - upstream signature drift
            LOGGER.debug("Core MA helper failed (%s); trying runtime_data", err)
        else:
            if _looks_like_client(client):
                _clear_issue(hass)
                return client

    client = getattr(getattr(entry, "runtime_data", None), "mass", None)
    if _looks_like_client(client):
        if helper is None:
            LOGGER.debug("Core MA helper missing; using entry.runtime_data.mass")
        _clear_issue(hass)
        return client

    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_CLIENT_API,
        is_fixable=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key=ISSUE_CLIENT_API,
    )
    raise MaUnavailable(
        "api_changed",
        "Cannot reach the Music Assistant client. Home Assistant may have changed "
        "its internal API; update Jukebox Kiosk.",
    )


@callback
def _clear_issue(hass: HomeAssistant) -> None:
    ir.async_delete_issue(hass, DOMAIN, ISSUE_CLIENT_API)

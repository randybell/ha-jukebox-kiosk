"""2.4: follow Home Assistant's Music Assistant connection, so live subscriptions survive an MA restart.

Home Assistant's music_assistant integration owns the one MA connection we borrow (client.py). When MA drops out, its
listen task ends and it reloads its config entry (HA 2026.11 music_assistant/__init__.py `_client_listen`). The reload
builds a brand-new MusicAssistantClient; while MA stays away the entry waits in setup_retry. A listener attached with
`client.subscribe` stays on the old client, which never speaks again.

MaLink watches that config entry's state (`ConfigEntry.async_on_state_change`) and looks the client up again on every
change, with the same lookup every command uses (`client.async_get_ma_client`: the entry must be LOADED). Listeners hear
`None` as soon as the client goes away (unload starts, setup in progress, setup_retry), and the new client once the
entry is LOADED again. Home Assistant only reaches LOADED after the client's first full sync of MA's players and queues
(`init_ready`), so the new client's in-memory lists are complete when listeners hear it.

One MaLink per Music Assistant entry and Home Assistant instance, made on first use and kept for the life of hass
(subscriptions outlive a reload of our own entry). It makes no MA calls.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.util.hass_dict import HassKey

from .client import MaUnavailable, async_get_ma_client
from .const import DOMAIN, LOGGER

type LinkListener = Callable[[Any | None], None]

DATA_LINKS: HassKey[dict[str, MaLink]] = HassKey(f"{DOMAIN}_ma_links")


class MaLink:
    """The Music Assistant client Home Assistant currently holds for one MA entry (None while it has none)."""

    def __init__(self, hass: HomeAssistant, ma_entry_id: str) -> None:
        """Start watching the MA config entry; read the client it holds now."""
        self._hass = hass
        self._ma_entry_id = ma_entry_id
        self._listeners: list[LinkListener] = []
        self._client: Any | None = self._lookup()
        self._watched: Any = None
        self._unwatch: CALLBACK_TYPE | None = None
        self._watch()

    @property
    def client(self) -> Any | None:
        """The live client, or None while Music Assistant is offline (or HA is restarting its connection)."""
        self._watch()  # the MA entry may only exist now (added after us)
        return self._client

    @property
    def connected(self) -> bool:
        """True while Home Assistant holds a loaded Music Assistant client."""
        return self.client is not None

    @callback
    def async_listen(self, listener: LinkListener) -> CALLBACK_TYPE:
        """Call listener(client | None) whenever the client goes away or a new one is ready. Returns an unsubscribe."""
        self._watch()
        self._listeners.append(listener)

        @callback
        def _remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return _remove

    @callback
    def _lookup(self) -> Any | None:
        try:
            return async_get_ma_client(self._hass, self._ma_entry_id)
        except MaUnavailable:
            return None

    @callback
    def _watch(self) -> None:
        """Follow the MA entry's state changes (once per entry object)."""
        entry = self._hass.config_entries.async_get_entry(self._ma_entry_id)
        if entry is None or entry is self._watched:
            return
        if self._unwatch is not None:
            self._unwatch()
        self._watched = entry
        self._unwatch = entry.async_on_state_change(self._check)
        self._check()

    @callback
    def _check(self) -> None:
        client = self._lookup()
        if client is self._client:
            return
        self._client = client
        LOGGER.debug("Music Assistant client %s", "ready" if client is not None else "gone")
        for listener in list(self._listeners):
            try:
                listener(client)
            except Exception:  # noqa: BLE001 - one subscription must not stop the others
                LOGGER.exception("Music Assistant connection listener failed")


@callback
def async_get_link(hass: HomeAssistant, ma_entry_id: str) -> MaLink:
    """The MaLink for an MA entry (made on first use)."""
    links = hass.data.setdefault(DATA_LINKS, {})
    link = links.get(ma_entry_id)
    if link is None:
        link = links[ma_entry_id] = MaLink(hass, ma_entry_id)
    return link

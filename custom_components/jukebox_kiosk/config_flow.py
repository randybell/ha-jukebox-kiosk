"""Config and options flow."""

from __future__ import annotations

from typing import Any

import probatio

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlowWithReload
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_GUEST_CLASSES,
    CONF_GUEST_USERS,
    CONF_MA_ENTRY_ID,
    CONF_NON_ADMINS_ARE_GUESTS,
    DEFAULT_GUEST_CLASSES,
    DOMAIN,
    GUEST_ASSIGNABLE,
    MA_DOMAIN,
)


class JukeboxKioskConfigFlow(ConfigFlow, domain=DOMAIN):
    """Pick the Music Assistant entry to use."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Auto-pick a single MA entry, else ask."""
        entries = self.hass.config_entries.async_entries(MA_DOMAIN)
        if not entries:
            return self.async_abort(reason="no_music_assistant")
        if user_input is not None:
            return self._create(user_input[CONF_MA_ENTRY_ID])
        if len(entries) == 1:
            return self._create(entries[0].entry_id)
        return self.async_show_form(
            step_id="user",
            data_schema=probatio.Schema(
                {
                    probatio.Required(CONF_MA_ENTRY_ID): selector.ConfigEntrySelector(
                        selector.ConfigEntrySelectorConfig(integration=MA_DOMAIN)
                    )
                }
            ),
        )

    def _create(self, ma_entry_id: str) -> ConfigFlowResult:
        ma = self.hass.config_entries.async_get_entry(ma_entry_id)
        title = f"Jukebox Kiosk ({ma.title})" if ma else "Jukebox Kiosk"
        return self.async_create_entry(
            title=title,
            data={CONF_MA_ENTRY_ID: ma_entry_id},
            options={
                CONF_GUEST_USERS: [],
                CONF_NON_ADMINS_ARE_GUESTS: True,
                CONF_GUEST_CLASSES: [c.value for c in DEFAULT_GUEST_CLASSES],
            },
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> JukeboxKioskOptionsFlow:
        """Options."""
        return JukeboxKioskOptionsFlow()


class JukeboxKioskOptionsFlow(OptionsFlowWithReload):
    """Guest users and what guests may do."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show the options form."""
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        users = [
            selector.SelectOptionDict(value=u.id, label=u.name or u.id)
            for u in await self.hass.auth.async_get_users()
            if not u.system_generated and u.is_active
        ]
        opts = self.config_entry.options
        schema = probatio.Schema(
            {
                probatio.Optional(CONF_GUEST_USERS, default=list(opts.get(CONF_GUEST_USERS, []))): (
                    selector.SelectSelector(selector.SelectSelectorConfig(options=users, multiple=True))
                ),
                probatio.Optional(
                    CONF_NON_ADMINS_ARE_GUESTS, default=bool(opts.get(CONF_NON_ADMINS_ARE_GUESTS, True))
                ): selector.BooleanSelector(),
                probatio.Optional(
                    CONF_GUEST_CLASSES,
                    default=list(opts.get(CONF_GUEST_CLASSES, [c.value for c in DEFAULT_GUEST_CLASSES])),
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=sorted(c.value for c in GUEST_ASSIGNABLE),
                        multiple=True,
                        translation_key=CONF_GUEST_CLASSES,
                    )
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)

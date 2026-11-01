"""Who may run which Music Assistant command.

Home Assistant lets any authenticated user call any service. This integration
only exposes websocket commands, so we can see `connection.user` and decide
per command. Rules, first match wins:

1. user id listed in `guest_users`   -> guest classes
2. admin                             -> everything
3. non-admin and non_admins_are_guests (default) -> guest classes
4. other non-admin                   -> everything except ADMIN

Guests never get ADMIN. Non-admins also need HA's own entity permission
(POLICY_CONTROL) on the media_player that maps to any MA player they touch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.auth.models import User
from homeassistant.auth.permissions.const import POLICY_CONTROL, POLICY_READ
from homeassistant.config_entries import ConfigEntry
from homeassistant.exceptions import Unauthorized

from .const import (
    ALL_CLASSES,
    CONF_GUEST_CLASSES,
    CONF_GUEST_USERS,
    CONF_NON_ADMINS_ARE_GUESTS,
    DEFAULT_GUEST_CLASSES,
    GUEST_ASSIGNABLE,
    PermClass,
)


@dataclass(frozen=True, slots=True)
class Policy:
    """Resolved permission options."""

    guest_users: frozenset[str] = frozenset()
    non_admins_are_guests: bool = True
    guest_classes: frozenset[PermClass] = frozenset(DEFAULT_GUEST_CLASSES)

    @classmethod
    def from_options(cls, options: dict[str, Any]) -> Policy:
        """Build from config entry options, ignoring unknown classes."""
        raw = options.get(CONF_GUEST_CLASSES, [c.value for c in DEFAULT_GUEST_CLASSES])
        classes = frozenset(PermClass(c) for c in raw if c in PermClass._value2member_map_)
        return cls(
            guest_users=frozenset(options.get(CONF_GUEST_USERS, [])),
            non_admins_are_guests=bool(options.get(CONF_NON_ADMINS_ARE_GUESTS, True)),
            guest_classes=classes & GUEST_ASSIGNABLE,
        )

    @classmethod
    def from_entry(cls, entry: ConfigEntry) -> Policy:
        """Build from a config entry."""
        return cls.from_options(dict(entry.options))


def is_guest(user: User, policy: Policy) -> bool:
    """Return True when the guest rules apply to this user."""
    if user.id in policy.guest_users:
        return True
    if user.is_admin:
        return False
    return policy.non_admins_are_guests


def allowed_classes(user: User | None, policy: Policy) -> frozenset[PermClass]:
    """Permission classes this user holds."""
    if user is None:
        return frozenset()
    if is_guest(user, policy):
        return policy.guest_classes
    if user.is_admin:
        return ALL_CLASSES
    return frozenset(ALL_CLASSES - {PermClass.ADMIN})


def check_class(user: User | None, policy: Policy, perm: PermClass) -> None:
    """Raise Unauthorized unless the user holds `perm`."""
    if perm not in allowed_classes(user, policy):
        raise Unauthorized(perm_category=f"jukebox_kiosk:{perm.value}")


def check_entity(user: User | None, entity_id: str, *, control: bool) -> None:
    """Raise Unauthorized unless HA lets this user read/control the entity."""
    if user is None:
        raise Unauthorized(entity_id=entity_id)
    if user.is_admin:
        return
    policy = POLICY_CONTROL if control else POLICY_READ
    if not user.permissions.check_entity(entity_id, policy):
        raise Unauthorized(entity_id=entity_id, permission=policy)

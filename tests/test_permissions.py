"""Pure permission rules."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from homeassistant.exceptions import Unauthorized

from custom_components.jukebox_kiosk.const import ALL_CLASSES, PermClass
from custom_components.jukebox_kiosk.permissions import Policy, allowed_classes, check_class


def _u(uid: str, admin: bool) -> SimpleNamespace:
    return SimpleNamespace(id=uid, is_admin=admin)


def test_admin_gets_everything() -> None:
    assert allowed_classes(_u("a", True), Policy()) == ALL_CLASSES


def test_listed_admin_is_guest() -> None:
    p = Policy(guest_users=frozenset({"kiosk"}))
    assert PermClass.ADMIN not in allowed_classes(_u("kiosk", True), p)


def test_non_admin_default_guest() -> None:
    got = allowed_classes(_u("u", False), Policy())
    assert got == {PermClass.READ, PermClass.PLAYBACK, PermClass.QUEUE, PermClass.SPEAKERS}


def test_non_admin_not_guest_mode() -> None:
    got = allowed_classes(_u("u", False), Policy(non_admins_are_guests=False))
    assert got == ALL_CLASSES - {PermClass.ADMIN}


def test_options_cannot_grant_admin_to_guests() -> None:
    p = Policy.from_options({"guest_classes": ["read", "admin", "bogus"]})
    assert p.guest_classes == {PermClass.READ}


def test_no_user_denied() -> None:
    with pytest.raises(Unauthorized):
        check_class(None, Policy(), PermClass.READ)

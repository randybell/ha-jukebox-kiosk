"""Volume needs no Speakers class: the card sends it as HA media_player services, which this integration does not gate."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from unittest.mock import patch

import pytest

from homeassistant.components.demo.media_player import DemoMusicPlayer
from homeassistant.components.media_player import DOMAIN as MP_DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_component import DATA_INSTANCES
from homeassistant.setup import async_setup_component

from .conftest import FakeMa

pytestmark = pytest.mark.usefixtures("kiosk")

DEMO = "media_player.walkman"  # core demo player: volume set / step / mute


@pytest.fixture(autouse=True)
def _ma_unload() -> Iterator[None]:
    """Loading media_player makes teardown unload the fake core MA entry for real; skip that."""
    with patch("homeassistant.components.music_assistant.async_unload_entry", return_value=True):
        yield


async def _call(ws: Any, **msg: Any) -> dict[str, Any]:
    await ws.send_json_auto_id(msg)
    return await ws.receive_json()


async def test_default_guest_volume_works(hass: HomeAssistant, hass_ws_client: Any, user_token: Any, fake_ma: FakeMa) -> None:
    assert await async_setup_component(hass, MP_DOMAIN, {})
    await hass.data[DATA_INSTANCES][MP_DOMAIN].async_add_entities([DemoMusicPlayer()])
    await hass.async_block_till_done()
    ws = await hass_ws_client(access_token=user_token[1])
    caps = (await _call(ws, type="jukebox_kiosk/capabilities"))["result"]
    assert caps["guest"] and "speakers" not in caps["classes"] and not caps["features"]["speakers"]

    async def svc(service: str, **data: Any) -> Any:
        res = await _call(ws, type="call_service", domain=MP_DOMAIN, service=service,
                          service_data=data, target={"entity_id": DEMO})
        assert res["success"], (service, res)
        await hass.async_block_till_done()
        return hass.states.get(DEMO).attributes

    assert (await svc("volume_set", volume_level=0.3))["volume_level"] == pytest.approx(0.3)
    up = (await svc("volume_up"))["volume_level"]
    assert up > 0.3
    assert (await svc("volume_down"))["volume_level"] < up
    assert (await svc("volume_mute", is_volume_muted=True))["is_volume_muted"] is True
    assert (await svc("volume_mute", is_volume_muted=False))["is_volume_muted"] is False
    assert fake_ma.calls == []  # nothing went through the kiosk MA proxy

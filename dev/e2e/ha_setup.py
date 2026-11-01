#!/usr/bin/env python3
"""Onboard the throwaway e2e Home Assistant and wire it to the box Music Assistant.

Box-only test env: random throwaway passwords live in $E2E_DIR/secrets.env, tokens in
$E2E_DIR/*.token. Nothing here talks to a real Home Assistant.

Steps (each skipped when already done):
  1. onboarding: admin user "testadmin", core config (country US), analytics, integration step
  2. non-admin user "kiosk" (local only)
  3. long-lived tokens for both users
  4. music_assistant config entry (manual token path) -> MA at $MA_HTTP
  5. optional: storage-mode legacy resource and a stand-in HACS plugin folder (--legacy-resource)
     BEFORE jukebox_kiosk is added
  6. jukebox_kiosk config entry (must auto-pick the single MA entry)
  7. dashboard "jukebox-e2e" with the card in panel mode
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import aiohttp

E2E_DIR = Path(os.environ.get("E2E_DIR", "/tmp/jbe2e"))
HA = os.environ.get("HA_URL", "http://127.0.0.1:8123")
MA_HTTP = os.environ.get("MA_HTTP", "http://127.0.0.1:8095")
CLIENT_ID = f"{HA}/"
LEGACY_URL = "/hacsfiles/ha-jukebox-kiosk-card/jukebox-card.js"


def secrets() -> dict[str, str]:
    out = {}
    for line in (E2E_DIR / "secrets.env").read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k] = v
    return out


class WS:
    def __init__(self, session: aiohttp.ClientSession, token: str) -> None:
        self.s, self.token, self.id = session, token, 0

    async def __aenter__(self) -> WS:
        self.ws = await self.s.ws_connect(HA.replace("http", "ws") + "/api/websocket", max_msg_size=0)
        await self.ws.receive_json()
        await self.ws.send_json({"type": "auth", "access_token": self.token})
        msg = await self.ws.receive_json()
        if msg["type"] != "auth_ok":
            raise RuntimeError(msg)
        return self

    async def __aexit__(self, *a) -> None:
        await self.ws.close()

    async def call(self, type_: str, **kw):
        self.id += 1
        await self.ws.send_json({"id": self.id, "type": type_, **kw})
        while True:
            msg = await self.ws.receive_json()
            if msg.get("id") == self.id and msg.get("type") == "result":
                if not msg["success"]:
                    raise RuntimeError(f"{type_}: {msg['error']}")
                return msg["result"]


async def password_login(s: aiohttp.ClientSession, user: str, pw: str) -> str:
    async with s.post(f"{HA}/auth/login_flow", json={"client_id": CLIENT_ID, "handler": ["homeassistant", None], "redirect_uri": CLIENT_ID}) as r:
        flow = await r.json()
    async with s.post(f"{HA}/auth/login_flow/{flow['flow_id']}", json={"client_id": CLIENT_ID, "username": user, "password": pw}) as r:
        res = await r.json()
    if res.get("type") != "create_entry":
        raise RuntimeError(f"login failed for {user}: {res}")
    return await exchange(s, res["result"])


async def exchange(s: aiohttp.ClientSession, code: str) -> str:
    async with s.post(f"{HA}/auth/token", data={"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID}) as r:
        return (await r.json())["access_token"]


async def ma_long_lived_token() -> str:
    path = E2E_DIR / "ma_ha.token"
    if path.exists():
        return path.read_text().strip()
    sys.path.insert(0, str(Path(__file__).parent))
    from ma_ws import call_many  # noqa: PLC0415

    (tok,) = await call_many([("auth/token/create", {"name": "Home Assistant (e2e)"})])
    path.write_text(tok)
    path.chmod(0o600)
    return tok


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--legacy-resource", action="store_true", help="pre-create the old HACS card resource")
    ap.add_argument("--card-config", default="{}", help="extra JSON for the card config")
    opts = ap.parse_args()
    sec = secrets()
    async with aiohttp.ClientSession() as s:
        async with s.get(f"{HA}/api/onboarding") as r:
            # 404 once onboarding is finished (the view is unregistered)
            steps = {x["step"]: x["done"] for x in await r.json()} if r.status == 200 else {k: True for k in ("user", "core_config", "analytics", "integration")}
        if not steps.get("user"):
            async with s.post(f"{HA}/api/onboarding/users", json={"client_id": CLIENT_ID, "name": "Test Admin", "username": "testadmin", "password": sec["HA_ADMIN_PW"], "language": "en"}) as r:
                code = (await r.json())["auth_code"]
            access = await exchange(s, code)
        else:
            access = await password_login(s, "testadmin", sec["HA_ADMIN_PW"])
        hdr = {"Authorization": f"Bearer {access}"}
        for step, body in (("core_config", {}), ("analytics", {}), ("integration", {"client_id": CLIENT_ID, "redirect_uri": CLIENT_ID})):
            if not steps.get(step):
                async with s.post(f"{HA}/api/onboarding/{step}", json=body, headers=hdr) as r:
                    print("onboarding", step, r.status)

        async with WS(s, access) as ws:
            # a country keeps the unrelated "country has not been configured" repair out of the Repairs screenshots
            await ws.call("config/core/update", country="US")
            # admin long-lived token
            tok_admin = E2E_DIR / "ha_admin.token"
            if not tok_admin.exists():
                tok_admin.write_text(await ws.call("auth/long_lived_access_token", client_name="e2e-admin", lifespan=30))
            # kiosk user
            users = await ws.call("config/auth/list")
            if not any(u.get("username") == "kiosk" for u in users):
                u = await ws.call("config/auth/create", name="Kiosk", group_ids=["system-users"], local_only=True)
                await ws.call("config/auth_provider/homeassistant/create", user_id=u["user"]["id"], username="kiosk", password=sec["HA_KIOSK_PW"])
                print("created kiosk user")
            # MA entry
            entries = await ws.call("config_entries/get")
            if not any(e["domain"] == "music_assistant" for e in entries):
                matok = await ma_long_lived_token()
                async with s.post(f"{HA}/api/config/config_entries/flow", json={"handler": "music_assistant"}, headers=hdr) as r:
                    flow = await r.json()
                async with s.post(f"{HA}/api/config/config_entries/flow/{flow['flow_id']}", json={"url": MA_HTTP}, headers=hdr) as r:
                    res = await r.json()
                if res.get("type") == "external":
                    # The MA login page would redirect to return_url&code=<token>; do that hop
                    # ourselves with the token minted over the MA API (what the login page returns).
                    from urllib.parse import parse_qs, urlparse  # noqa: PLC0415

                    ret = parse_qs(urlparse(res["url"]).query)["return_url"][0]
                    state = parse_qs(urlparse(ret).query)["state"][0]
                    # return_url points at my.home-assistant.io; stay on the box and call HA's
                    # local OAuth callback directly (that is where the my-link redirects to).
                    async with s.get(f"{HA}/auth/external/callback", params={"state": state, "code": matok}, allow_redirects=False) as r:
                        print("external callback", r.status)
                    async with s.get(f"{HA}/api/config/config_entries/flow/{flow['flow_id']}", headers=hdr) as r:
                        res = await r.json()
                if res.get("type") == "form":
                    async with s.post(f"{HA}/api/config/config_entries/flow/{flow['flow_id']}", json={"token": matok}, headers=hdr) as r:
                        res = await r.json()
                print("music_assistant flow:", res.get("type"), res.get("reason") or res.get("title"))
            entries = await ws.call("config_entries/get")
            # only on the first run: once jukebox_kiosk exists, a new legacy resource would only be
            # cleaned up at the next restart
            if opts.legacy_resource and not any(e["domain"] == "jukebox_kiosk" for e in entries):
                res = await ws.call("lovelace/resources")
                if not any(LEGACY_URL in x["url"] for x in res):
                    await ws.call("lovelace/resources/create", res_type="module", url=LEGACY_URL)
                    print("created legacy resource", LEGACY_URL)
                # a stand-in for the old HACS plugin folder (the Repairs issue stays while it exists)
                plugin = E2E_DIR / "ha-config" / "www" / "community" / "ha-jukebox-kiosk-card"
                plugin.mkdir(parents=True, exist_ok=True)
                (plugin / "jukebox-card.js").write_text("// e2e stand-in for the old HACS plugin file\n")
            entries = await ws.call("config_entries/get")
            if not any(e["domain"] == "jukebox_kiosk" for e in entries):
                async with s.post(f"{HA}/api/config/config_entries/flow", json={"handler": "jukebox_kiosk"}, headers=hdr) as r:
                    res = await r.json()
                print("jukebox_kiosk flow:", res.get("type"), res.get("title") or res.get("reason") or res.get("step_id"))
            # kiosk token (after the user exists)
            tok_kiosk = E2E_DIR / "ha_kiosk.token"
            if not tok_kiosk.exists():
                kacc = await password_login(s, "kiosk", sec["HA_KIOSK_PW"])
                async with WS(s, kacc) as kws:
                    tok_kiosk.write_text(await kws.call("auth/long_lived_access_token", client_name="e2e-kiosk", lifespan=30))
            # dashboard
            dashes = await ws.call("lovelace/dashboards/list")
            if not any(d["url_path"] == "jukebox-e2e" for d in dashes):
                await ws.call("lovelace/dashboards/create", url_path="jukebox-e2e", title="Jukebox E2E", icon="mdi:music", show_in_sidebar=True, require_admin=False, mode="storage")
            card = {"type": "custom:jukebox-card", **json.loads(opts.card_config)}
            await ws.call("lovelace/config/save", url_path="jukebox-e2e", config={"title": "Jukebox E2E", "views": [{"title": "Jukebox", "path": "jukebox", "type": "panel", "cards": [card]}]})
            print("dashboard saved")
        for p in E2E_DIR.glob("*.token"):
            p.chmod(0o600)


if __name__ == "__main__":
    asyncio.run(main())

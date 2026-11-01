#!/usr/bin/env python3
"""Bootstrap the throwaway e2e Music Assistant (box only; test server, test media).

Steps (each skipped when already done):
  1. first-run admin "admin" with the random password MA_ADMIN_PW from $E2E_DIR/secrets.env
     (POST /setup), or a login (POST /auth/login) when the server is already set up;
     the session token goes to $E2E_DIR/ma_admin_token (0600)
  2. onboarding marked complete
  3. filesystem_local provider on /media (the sine-tone tracks from make-media.sh), via the setup flow
  4. snapcast provider (built-in snapserver; the two snapclient containers become test players)
  5. a library sync
  --name-players (after the snapclient containers start): wait for the two snapcast test players and
     name them "Kitchen Test" / "Patio Test" (snapcast names players after the machine's hostname), so
     HA creates media_player.kitchen_test / media_player.patio_test

Usage: ma_setup.py [--name-players]   (env E2E_DIR, MA_HTTP default http://127.0.0.1:8095)
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import aiohttp

E2E_DIR = Path(os.environ.get("E2E_DIR", "/tmp/jbe2e"))
MA_HTTP = os.environ.get("MA_HTTP", "http://127.0.0.1:8095")


def secret(key: str) -> str:
    for line in (E2E_DIR / "secrets.env").read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1]
    raise KeyError(key)


async def admin_token(s: aiohttp.ClientSession) -> str:
    creds = {"username": "admin", "password": secret("MA_ADMIN_PW")}
    async with s.post(f"{MA_HTTP}/setup", json={**creds, "device_name": "e2e setup"}) as r:
        body = await r.json(content_type=None) if r.content_type == "application/json" else {}
        if r.status == 200 and body.get("token"):
            print("ma: first-run admin created")
            return body["token"]
    async with s.post(f"{MA_HTTP}/auth/login", json={"provider_id": "builtin", "credentials": creds, "device_name": "e2e setup"}) as r:
        body = await r.json(content_type=None)
        tok = body.get("token") or body.get("access_token")
        if not tok:
            raise RuntimeError(f"MA login failed: HTTP {r.status} {body.get('error')}")
        return tok


async def main() -> None:
    async with aiohttp.ClientSession() as s:
        for _ in range(60):  # wait for the server
            try:
                async with s.get(f"{MA_HTTP}/info") as r:
                    if r.status == 200:
                        break
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(2)
        tok = await admin_token(s)
    path = E2E_DIR / "ma_admin_token"
    path.write_text(tok)
    path.chmod(0o600)
    os.environ["MA_TOKEN"] = tok
    sys.path.insert(0, str(Path(__file__).parent))
    from ma_ws import call_many  # noqa: PLC0415

    async def call(cmd: str, **args):
        return (await call_many([(cmd, args)]))[0]

    if "--name-players" in sys.argv:
        want = {"ma_kitchentest": "Kitchen Test", "ma_patiotest": "Patio Test"}
        for _ in range(60):
            have = {p["player_id"] for p in await call("players/all")}
            if set(want) <= have:
                break
            await asyncio.sleep(2)
        else:
            raise RuntimeError("snapcast test players did not show up in MA")
        for pid, name in want.items():
            await call("config/players/save", player_id=pid, values={"name": name})
        print("ma: test players named")
        return
    try:
        await call("config/onboard_complete")
    except RuntimeError:
        pass  # already onboarded
    have = {p["domain"] for p in await call("config/providers")}
    for domain, values in (("filesystem_local", {"content_type": "music", "path": "/media"}), ("snapcast", {})):
        if domain in have:
            continue
        step = await call("config/providers/setup", provider_domain=domain)
        while step.get("type") == "form":
            step = await call("config/flows/submit", flow_id=step["flow_id"], values=values)
            if step.get("errors"):
                raise RuntimeError(f"{domain} setup: {step['errors']}")
        print(f"ma: {domain} -> {step.get('type')}")
    await call("music/sync")
    print("ma: library sync started")


if __name__ == "__main__":
    asyncio.run(main())

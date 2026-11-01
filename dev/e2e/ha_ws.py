#!/usr/bin/env python3
"""ha_ws.py TYPE [JSON_KW] [--kiosk]  - one HA WS call with the e2e admin (or kiosk) token."""
import asyncio, json, os, sys
from pathlib import Path

import aiohttp

sys.path.insert(0, str(Path(__file__).parent))
from ha_setup import E2E_DIR, WS  # noqa: E402


async def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--kiosk"]
    who = "kiosk" if "--kiosk" in sys.argv else "admin"
    tok = (E2E_DIR / f"ha_{who}.token").read_text().strip()
    async with aiohttp.ClientSession() as s, WS(s, tok) as ws:
        try:
            print(json.dumps(await ws.call(args[0], **(json.loads(args[1]) if len(args) > 1 else {})), indent=1))
        except RuntimeError as e:
            print("ERROR", e)
            sys.exit(2)


asyncio.run(main())

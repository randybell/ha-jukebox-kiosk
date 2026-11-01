#!/usr/bin/env python3
"""Tiny Music Assistant WebSocket client for the e2e env (box only; test server, test token).

Usage: ma_ws.py COMMAND [JSON_ARGS]   (env MA_URL, default ws://127.0.0.1:8095/ws; MA_TOKEN or $E2E_DIR/ma_admin_token)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

import aiohttp

MA_URL = os.environ.get("MA_URL", "ws://127.0.0.1:8095/ws")


def token() -> str:
    if t := os.environ.get("MA_TOKEN"):
        return t
    with open(os.path.join(os.environ.get("E2E_DIR", "/tmp/jbe2e"), "ma_admin_token")) as f:
        return f.read().strip()


async def call_many(cmds: list[tuple[str, dict]]) -> list:
    out = []
    async with aiohttp.ClientSession() as s, s.ws_connect(MA_URL, max_msg_size=0) as ws:
        await ws.receive_json()  # server info
        mid = 0

        async def call(command: str, args: dict):
            nonlocal mid
            mid += 1
            await ws.send_json({"message_id": str(mid), "command": command, "args": args})
            parts = []
            while True:
                msg = await ws.receive_json()
                if msg.get("message_id") != str(mid):
                    continue  # events
                if "error_code" in msg:
                    raise RuntimeError(f"{command}: {msg.get('error_code')} {msg.get('details')}")
                if msg.get("partial"):
                    parts.extend(msg.get("result") or [])
                    continue
                res = msg.get("result")
                return parts + res if parts and isinstance(res, list) else res

        await call("auth", {"token": token()})
        for c, a in cmds:
            out.append(await call(c, a))
    return out


def main() -> None:
    cmd = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    print(json.dumps(asyncio.run(call_many([(cmd, args)]))[0], indent=1, default=str))


if __name__ == "__main__":
    main()

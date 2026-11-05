# Development

Maintainer notes for building, testing and releasing Jukebox Kiosk (the `jukebox_kiosk` integration and the bundled Jukebox Card). Install and configuration for Home Assistant are in the [README](../README.md).

Nothing in this repository talks to a real Home Assistant server. Card development and tests run against `dev/mock-hass.js`; integration tests run against `pytest-homeassistant-custom-component` with a mocked Music Assistant client.

## Integration

```bash
python3.14 -m venv .venv && . .venv/bin/activate
pip install -r requirements_test.txt
pytest -q                          # tests/ (websocket API, permissions, client, frontend, setup)
```

Every Music Assistant command the integration forwards is in `MA_COMMANDS` in `custom_components/jukebox_kiosk/const.py`, with its permission class and a status (`client`, `live`, `checked`, `TODO-VERIFY`). Anything not in that table is refused. Commands marked `TODO-VERIFY` are left out of `capabilities.commands`; none are marked that way at present. `allow_update_metadata: true` is refused on every command, and `music/item_by_uri` always gets `false`.

## Build

```bash
# lit 3, rollup 4, typescript 5.9 (TS 7 breaks @rollup/plugin-typescript), fontsource
npm ci                # or npm install
npm run build         # -> custom_components/jukebox_kiosk/www/jukebox-card.js (single ES module) + www/fonts/*
npm run watch         # rebuild on change
npm run typecheck     # tsc --noEmit
```

## Dev harness and tests (no Home Assistant needed)

```bash
python3 -m http.server 8765 --bind 127.0.0.1     # only to open the harness by hand, from the project root (it won't run from file://)
# open http://127.0.0.1:8765/dev/index.html?log=1
npm test                                           # typecheck + every unit test + every browser e2e suite (puppeteer-core + /usr/bin/google-chrome; CHROME=... to override)
npm run test:unit                                  # every test/unit/*.unit.mjs (no server or browser); scripts/run-tests.mjs picks new files up automatically
npm run test:e2e                                   # test/run.mjs + every test/*.e2e.mjs except fit
npm run test:fit                                   # fit-to-height checks: 11 sizes x HA toolbar / kiosk / full screen, every tab (Now Playing, Library with keyboard, source and category buttons, Queue, Lyrics), sidebar, resize, emulated Mac Chrome zoom, Speakers panel / large buttons / queue overlays, Library on the integration backend -> test/shots/v042/
node scripts/run-tests.mjs --list                  # which files each group runs
# The browser tests and screenshot scripts start their own static server (test/serve.mjs) on a free 127.0.0.1 port, so a server
# already running elsewhere can't be tested by mistake. JB_PORT=8765 picks a fixed port (and fails clearly if it is taken);
# JB_URL=http://127.0.0.1:8765/dev/index.html (or JB_ROOT=http://127.0.0.1:8765/dev/) uses a server you started.
npm run shots                                      # = node tools/screenshots/shots-m2.mjs
node tools/screenshots/shots-m2.mjs f1             # every tab at 1920x1080, 1280x800, 820x1180 and 390x844 -> test/shots/m2/
JB_SIZES=1920x1080 node tools/screenshots/shots-m2.mjs x1 '&backdrop=light'   # one size, one mode
node tools/screenshots/shots-v040.mjs              # lyrics surfaces, states and the editor at 1280x800, 1920x1080, 390x844 -> test/shots/v040/
node tools/screenshots/shots-v050.mjs              # speakers panel (fixed, dynamic, guest, presets, move, large buttons), queue row icons and the segmented tab bar at 390x844, 1280x800, 1920x1080 and 1024x666 below the HA toolbar -> test/shots/v050/
node test/perf.mjs 3                               # frame-time benchmark, see "Backdrop and performance"
```

`dev/mock-hass.js` is a fake `hass`. It uses the shapes from the real exports (`dev/fixtures/`):
- `search` always returns the 7 lists.
- Items carry no provider field; the provider comes from the URI scheme (`library://`, `apple_music://`, `apple_music--XXXXXXXX://`).
- `get_library` returns `{items, limit, offset, order_by, media_type}` with `library://` URIs.
- `mass_queue.get_queue_items` returns a list keyed by entity.
- `mass_queue.get_album_tracks` / `get_playlist_tracks` return the real 0.10.x shape (`{tracks: [{media_title, media_artist, media_album_name, media_content_id, media_image, duration, favorite, position}]}`); `library://album/1448` and `library://playlist/158` answer with the real exports in `dev/fixtures/mass-queue-tracks-sample.json`.
- The player has an absolute `entity_picture` (`http://<ma-host>:8095/imageproxy?…`) and a relative `entity_picture_local`, as on the real system.
- The fixtures are scrubbed: provider instance ids are `--XXXXXXXX`, HA context ids are placeholders and `user_id` is `null`.
- `play_media` is rejected unless the target is `media_player.everywhere`.
- Every service call changes the mock state and pushes a new `hass`, as HA does.

URL parameters:

| Parameter | Effect |
|---|---|
| `latency=ms` / `jitter=ms` | reply latency and its random variation |
| `mode=inverse` | shorter queries reply more slowly, which forces out-of-order replies |
| `fail=1` | the mock search fails |
| `real=1` | search returns the real "eagles" export from `dev/fixtures/ma-search-sample.json` |
| `radio=1` | Radio Browser stations in search only (library radio stays empty, so Browse > Radio uses the search fallback) |
| `radio=lib` | the same stations also in the library (`get_library media_type: radio`) |
| `mqpage=all\|paged\|ignore` | how `get_*_tracks` treats `page`: `all` (default, mass_queue 0.10: page 0 = everything), `paged` (50 per page), `ignore` (every page returns the same list) |
| `noart=1` | the player has no `entity_picture_local`, so art falls back to the queue item's https image |
| `legacyq=1` | configures the old `queue_config_entry_id` key instead of `mass_queue_entry_id` |
| `idle=1` / `paused=1` | nothing playing / paused |
| `empty=1` | empty library and queue |
| `qfail=1` | `mass_queue.get_queue_items` fails |
| `noqueue=1` | no `mass_queue_entry_id`, so drill-down uses the search fallback |
| `saver=min` | `screensaver_minutes`; for example `saver=0.05` is 3 seconds |
| `recents=1` | seeds the recent-search chips |
| `fresh=1` | clears localStorage |
| `log=1` | shows a panel with every `callService` call |
| `tab=now\|browse\|search\|queue\|lyrics` | opens that tab (default `now`) |
| `lyrics=none` | every lyrics lookup finds nothing |
| `lyrfail=perm\|err` | lyrics lookups fail with a permission error / a generic error |
| `lyrlat=ms` | lyrics reply latency (the live first lookup takes 8–33 s) |
| `overlay=1\|0` | preset the art lyrics overlay toggle |
| `keeplyrics=1` | with `fresh=1`, keep the lyrics "not found" markers |
| `admin=1`, `user=<name>`, `uid=<id>` | the HA user (default: a non-admin guest) |
| `spk=dyn`, `target=<entity>`, `cfg=<json>` | dynamic speaker mode, the starting target, extra card config (merged last) |
| `ma=split\|busy`, `grp=` / `xfer=fail\|slow\|timeout`, `gap=ms`, `malat=ms` | mock Music Assistant situations and failures (`dev/mock-ma.js`, log in `window.__maLog`) |
| `qbuf=1`, `qadd=fail`, `qitems=fail` | next track already buffered in MA; queue re-add / item lookup fails (Remove → Undo) |
| `cfg=<json>` | merged into the card config |
| `kiosk=1` | loads the Jukebox Kiosk integration mock (`dev/mock-kiosk.js`): `jukebox_kiosk` in `hass.config.components` and its WebSocket API on `callWS` / `connection.subscribeMessage`, so `backend: auto` picks `kiosk`. Every message is logged in `window.__ws`; `window.__kioskPush(entity)` sends a queue push, `window.__kioskSubs()` lists subscriptions |
| `kcaps=<json>` | with `kiosk=1`, overrides the `features` returned by `jukebox_kiosk/capabilities` |
| `kfail=<type>` | with `kiosk=1`, that `jukebox_kiosk/<type>` message fails |
| `backdrop=auto\|full\|light\|static\|off` | sets the `backdrop` option |
| `ha=toolbar\|kiosk\|masonry` | emulates a Home Assistant view around the card: fixed 56 px toolbar (`--header-height`), toolbar hidden (kiosk mode), or a masonry view with padding and a card above |
| `sidebar=open\|narrow\|closed\|none` | with `ha=`, the HA sidebar width (256 px, 56 px, or none; default `narrow`) |

Every call is recorded in `window.__calls`, except read-only lyrics lookups (`mass_queue.send_command`), which go to `window.__lyricsLog`. `window.__setNowPlaying({artist, title, radio, uri, duration, position})` and `window.__playTrack(name, position)` change what is playing. `test/run.mjs` drives the card with real CDP mouse, touch and keyboard input and writes `test/shots/results.json`. The browser tests are hermetic (`test/intercept.mjs`): `/api/media_player_proxy/…` and https images are answered with a generated SVG, and any request to a plain-http host other than the dev server fails (test 16o checks that the card never asks the MA host directly).

## Real Home Assistant e2e (throwaway env on a dev machine)

`dev/e2e/` brings up a disposable Home Assistant plus Music Assistant with docker (host network) and drives the card in the real HA frontend. It never touches a production system. All state lives in `$E2E_DIR` (default `/tmp/jbe2e`); `secrets.env` holds random throwaway passwords and `*.token` the long-lived tokens (mode 0600).

```bash
sh dev/e2e/up.sh                       # MA 2.10.9 + HA 2026.10 + integration from this checkout + dashboard
node dev/e2e/ha-e2e.mjs                # the checks below (puppeteer-core + /usr/bin/google-chrome, clock America/Chicago)
node dev/e2e/ha-e2e.mjs --shots test/shots/v060-e2e   # same, plus screenshots at 1920x1080 and 390x844
sh dev/e2e/down.sh                     # remove the containers, keep $E2E_DIR (--purge deletes it)
```

What `up.sh` does (each step is skipped when already done, so it is safe to re-run after a code change; it re-copies the integration and restarts HA):

1. `make-media.sh`: 16 tagged sine-tone MP3s (2 artists x 2 albums x 4 tracks; ffmpeg) in `$E2E_DIR/media`.
2. `jbe2e-ma` (`ghcr.io/music-assistant/server:2.10.9`, `:8095`), then `ma_setup.py`: first-run admin (`POST /setup`, or `POST /auth/login` later), onboarding complete, the `filesystem_local` provider on `/media` through the setup flow (`config/providers/setup` + `config/flows/submit`), the `snapcast` provider (built-in snapserver) and a library sync.
3. Two snapclient containers (`--hostID kitchen-test` / `patio-test`, audio to `/dev/null`) are named "Kitchen Test" / "Patio Test" in MA (`ma_setup.py --name-players`) and become `media_player.kitchen_test` and `media_player.patio_test` in HA.
4. `jbe2e-ha` (`ghcr.io/home-assistant/home-assistant:2026.10`, `:8123`, `TZ=America/Chicago`), then `ha_setup.py`: onboarding (admin `testadmin`, country US), a non-admin `kiosk` user, the `music_assistant` entry (token path, no cloud hop), an old-plugin Lovelace resource plus a stand-in `www/community/ha-jukebox-kiosk-card/` folder (`--legacy-resource`), the `jukebox_kiosk` entry and the dashboard `jukebox-e2e`. The MA entry id for the card config is read at runtime into `$E2E_DIR/ma_entry_id`; it is never committed.

Helpers: `ha_ws.py TYPE [JSON] [--kiosk]` and `ma_ws.py COMMAND [JSON]` send one WebSocket command as the e2e admin (or kiosk user).

`ha-e2e.mjs` checks (42): the card element is registered and renders (E1), `backend: auto` picks the kiosk backend (E2), no manual resource (E3), migration Repairs issue while the old plugin files remain, across restarts (R1), capabilities for admin (E4) and the kiosk user with the default guest classes (U1–U14: may search, read the queue, favourite and unfavourite, change volume and mute through `media_player` services and sees the volume mixer; refused `set_members`, `transfer` and `stop`; `jukebox_kiosk/raw` is not registered since 0.7.3), keyboard search through `music_assistant.search` (S1), Replace / Add to queue through `music_assistant.play_media` (P1, P2), Up next, Play next, Remove + Undo, Play now and queue push from an outside MA edit (Q0–Q5), Now Playing (N1), the Speakers sheet (K1), lyrics resolve to "No lyrics found" for local files and the library copy is never asked (L1, L2), `item_tracks` paging and the album detail (T1–T3), and the double load of the old card file next to the bundled one with no console errors (D1, D2).

Other checks that need no HA: `node test/unit/define.unit.mjs` (element re-definition when HA swaps the custom element registry; part of `npm test`), `pytest tests/` from the `.venv` with `homeassistant` installed, and hassfest:

```bash
docker run --rm -v "$PWD/custom_components:/github/workspace/custom_components" ghcr.io/home-assistant/hassfest:latest
```

## Repository, releases and HACS

- `hacs.json`: `{"name": "Jukebox Kiosk", "homeassistant": "2026.10.0"}`, category **integration**.
- The built card **is committed** in `custom_components/jukebox_kiosk/www/` (bundle, fonts, notices). HACS installs an integration from the tagged source, so the bundle has to be in the tree. `.github/workflows/release.yaml` runs on a `v*` tag: it checks that the tag matches `package.json` and `manifest.json`, runs pytest, the typecheck and the card unit tests, rebuilds, **fails if the committed bundle or notices differ from the rebuild**, runs the browser e2e and fit suites in Chrome (`browser-actions/setup-chrome`), then attaches `jukebox_kiosk.zip` to a GitHub release.
  - To release: bump `version` in `package.json` (and `package-lock.json`), `custom_components/jukebox_kiosk/manifest.json` and `VERSION` in `src/jukebox-card.ts`, run `npm run build`, commit, then `git tag -a v0.7.3 -m 'Jukebox Kiosk 0.7.3' && git push origin v0.7.3` (push only that tag).
- `.github/workflows/hassfest.yaml` and `hacs.yaml` validate the integration on every push and nightly.
- `.github/workflows/ci.yaml` (workflow `CI`) runs on every push and pull request with four jobs: `unit` (typecheck, unit tests, build, committed-bundle check), `e2e` (`npm run test:e2e` in Chrome), `fit` (`npm run test:fit` in Chrome) and `pytest`.
- `test/shots/` (generated by the tests and screenshot scripts) is git-ignored; the curated screenshots used in the README are in `docs/`.
- License: MIT (`LICENSE`), Copyright (c) 2026 Randy Bell. The bundled fonts are OFL (licence files ship in `www/fonts/`). Third-party licenses are in `THIRD_PARTY_NOTICES.md`.

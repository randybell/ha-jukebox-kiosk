# Changelog

All notable changes to Jukebox Card. Versions follow [semver](https://semver.org/).

## Unreleased

## 0.7.9

- Library search: Recent searches are gone (no row, no saved history; any old history is cleared), so the on-screen keyboard no longer moves down when you start typing.
- Library: the Genres and Sort buttons are gone from the top of the Library, leaving more room for results. Lists keep their usual order (A–Z; radio stations most played first). The other category buttons and the Favorites heart stay.
- Library: the "Recently played" row at the top is gone, so results get the whole screen (and nothing starts playing from a stray tap there).
- Search: each result offers Add to queue, Play next, Play now and Start radio (in that order); no Remove. Stations just Play (with the replace-queue warning). Podcasts and episodes get no Start radio (Music Assistant can't start one from them).
- Radio: playing a station when the queue has songs now asks first ("This will replace your queue": Replace or Cancel). With an empty queue it plays right away.

## 0.7.8 — 2026-11-07

- Queue: tapping a track no longer plays it; use the play icon.
- Queue: Move up/down icons now match the other icons.
- Now Playing: bigger Next/Previous buttons.
- Now Playing: sleep timer moved to the album art corner, away from Play/Pause.
- Now Playing: buttons and sleep timer choices fit on phones with large buttons.
- Lyrics: tap anywhere to go back to the player.
- Speakers: a clear Close button replaces the small X.
- Lyrics full screen: tap anywhere to go back; on-screen controls removed.
- Screensaver and full-screen lyrics are now one screen: album art fills the background, with "Tap to close".
- Every screen now closes the same way: tap anywhere, or a clear Close button. No more small X.

### Tested
- Tested live on the owner's system with Apple Music and TuneIn, on Music Assistant 2.10.9.
- Known issue unchanged: removing an Apple Music favorite still sends a Dislike in Music Assistant 2.10.9 (re-checked 2026-11-07, see #52).

## 0.7.7 — 2026-11-05

### Added
- **Sleep timer.** On Now Playing, Sleep offers Off, 15, 30 and 60 minutes. While it is on, the control shows the time left. Music Assistant's sleep timer is used when the player accepts it, so playback still stops if the kiosk screen sleeps. Otherwise the card pauses the player when the time is up.
- **Recently played.** On the Library tab, with an empty search box, a Recently played row sits above the categories. It shows the last items from Music Assistant and hides when there are none.

### Changed
- **Library keyboard.** Restores the v0.7.4 always-open on-screen keyboard on tablets and touchscreen monitors: 7 columns when narrow, 10 columns with a number row when wide. On a landscape tablet the keyboard sits on the left with search and results beside it; on a portrait tablet the keyboard sits under the results. The 0.7.5 filled 6×5 side grid is gone. Theme, colours and fonts are unchanged.
- **Search and tiles.** On a tablet or monitor the search box is full width and the source control sits under it. Playlist provider badges sit under the square artwork, and titles wrap. Play Next, Play Now and Remove each stay on one line, large enough to read on a touchscreen.
- **Radio stations.** Playing a station replaces the queue. A station row offers Play Now only. Songs, albums and playlists still have Play Next, Play Now and Remove.

## 0.7.6 — 2026-11-05

### Added
- **Search queue.** On the Queue tab, **Search queue** opens an on-screen keyboard that stays open. The list narrows to songs whose title, artist or album matches what you type. **Done** closes the search.

### Changed
- **Play Next, Play Now and Remove.** Song rows in the Library, in search, on a playlist or artist page, and on the Queue tab show the same three actions, each with an icon and those words, in that order. On a phone, and when the row is narrow, the three sit on their own line under the title.
- On the Queue tab, an action that cannot be used stays on the row, greyed out, instead of disappearing. **Remove** still offers **Undo**.
- In the Library, in search and on a detail page, **Play Next** and **Remove** run straight away. **Play Now**, and **Start radio** where that is offered, still ask first. **Add to queue** is no longer a button on the song row. The row button that used to say Replace queue now says **Play Now**.

## 0.7.5 — 2026-11-05

### Changed
- **Library keyboard.** On the combined Library tab the always-open keyboard is a full grid, 6 columns by 5 rows, with no empty keys. The bottom row of letters is Y, Z, 123, Space, Backspace and Clear. Space and Clear show as ␣ and ×. The apostrophe and the hyphen are on the 123 page, not with the letters. On a tablet or a wider screen the keyboard sits on the left, the search box and All sources sit just above the keys, and the category buttons and results sit on the right. On a phone held upright the keyboard sits at the bottom. On a phone turned sideways the keyboard stays on the left and the search box stays with the results. All sources reads All, or how many are on. Colours and fonts are unchanged. `library_keyboard: tap` and the separate Search tab keep the older keyboard.

## 0.7.4 — 2026-11-05

### Changed
- **Library tab buttons.** On the combined Library tab, Playlists, Artists, Songs, Genres and Radio are large buttons with an icon. The one you are in is solid white. The row of source buttons is now an **All sources** button beside the search box. Tap it to open the same choices under the box (All, Library, then each music service). You can still pick more than one. The button turns white while any is on: on a larger screen it shows their names (shortened if they do not fit); on a phone it says how many are on. Tap it again to close the row. The screensaver closes it too when `idle_clear_filters` is on (the default). Favorites and sort are small buttons at the end of the category row, on the library list: a heart for favorites only, and a button that cycles A–Z, Recently added and Recently played. Radio opens on Popular. Genres have no heart, and they cycle A–Z and Recently added. Those two buttons hide while you are typing, while a music service is chosen, while Search in an artist or album is on, or on a detail page. On a phone, and on a very short screen, the sort button is only the icon. Favorites and sort are no longer chips in a bar above the list. The separate Search tab still keeps its source buttons in a row under the box. The keyboard stays open by default.

## 0.7.3 — 2026-11-05

### Added
- **Keyboard always open on the Library tab.** The combined tab's on-screen keyboard is shown by default on every screen size (portrait tablets and phones included), with the search box, source buttons, category buttons, list and tab bar arranged around it; no Keyboard pill or hide handle. `library_keyboard: tap` (YAML only) restores the tap-to-open keyboard in portrait / on phones as a small-screen fallback.

### Fixed
- **The on-screen keyboard stays above the tab bar on short landscape screens.** At 1024×600 under the Home Assistant toolbar the Library keyboard ran under the tab bar (9 px, 21 px with `large_buttons`): the recents are hidden there, but their grid row and its gap were still taking space. That row is dropped, and with the source buttons on the keys are sized to the room left (36–46 px; they stay 46 px where there is room).
- README header shows the released version (no draft wording).

### Removed
- The `jukebox_kiosk/raw` admin diagnostic command (it forwarded any non-denied Music Assistant command for admins). Nothing in the card used it; the `admin` class stays reserved. Calls now get `unknown_command`.

### Development
- `test/fit.e2e.mjs` checks the 0.7.2 four-tab bar (Now Playing, Library, Queue, Lyrics) and the combined Library tab (search box, source buttons, category buttons, keyboard above the tab bar) on all 11 screen sizes, plus the integration backend.
- `test/v072.e2e.mjs` KB1–KB3 cover the always-open keyboard default and the `library_keyboard: tap` fallback.
- `npm run test:unit` runs every `test/unit/*.unit.mjs` (via `scripts/run-tests.mjs`); `npm run test:e2e` runs every browser suite; `npm run test:fit` runs the fit suite.
- Browser tests start their own static server on a free port (`test/serve.mjs`); `JB_PORT` picks a fixed port and fails clearly if it is taken, `JB_URL` / `JB_ROOT` point them at a running server. `CHROME` overrides the browser path everywhere, including `test/perf.mjs`.
- Screenshot scripts moved from `test/` to `tools/screenshots/` (`npm run shots`).
- CI: new `CI` workflow on push and pull request (unit, browser e2e, fit, pytest; Node 20, Python 3.14); the release workflow also runs the browser e2e and fit suites in Chrome and fails the release if they fail.

## 0.7.2 — 2026-11-04

### Changed
- **Search and Library are one tab.** The **Library** tab (`library_label`) now has the search box with the on-screen keyboard on top, a row of source buttons directly under it, and category buttons under those: Playlists (default), Artists, Songs, Genres, Radio. There is no Search tab and no tile home by default (`library_layout: combined`).
  - Empty box with source All or Library: the library list of the selected category. Typed text: results for that category and source only; with **All**, library matches first, then providers.
  - One provider with an empty box shows its folders (`music/browse`, admins) or an inline "Type to search …" hint; several providers show the hint. No popups.
  - The artist/album chip, **Clear filters** and `idle_clear_filters` stay. Clearing (by hand or on idle) also empties the box and resets the source to All.
- `library_home` defaults to `false` again and only applies with `library_layout: separate`; a 0.7.1 `library_home: true` gets the combined tab.

### Added
- **Source buttons (`search_sources`, default `true`).** An always-visible row of touch-sized chips under the search box (no dropdown): All, Library, then the search-capable music providers configured in Music Assistant, by display name (new `jukebox_kiosk/search_providers` command, class `read`, served from the MA client's provider list; mass_queue backend: MA `providers`).
  - Multi-select: All by default; tapping a provider turns All off and selects it, more taps add providers, tapping a selected one removes it, none left = All again, tapping All clears them. Status and placeholder name the selection ("Apple Music + TuneIn").
  - The selected providers go together in `music/search`'s `providers`; Library alone = library only; Library plus providers = library first, then those providers. With an empty box, one provider shows its browse (or a hint); several show the inline hint to type.
- **Genres button.** The genre list comes from `music/genres/library_items` (now allowed, class `read`); a genre opens its page.
- `library_layout` (default `combined`; `separate` = the 0.7.1 Library + Search tabs) and `library_categories` (default `[playlist, artist, track, genre, radio]`; `album`, `podcast`, `audiobook` by config). Both in the visual editor.

### Back-compat
- `default_tab: search`, a saved Search tab, and every "search" shortcut (e.g. Search stations) open the Library tab with the keyboard up, on the matching category. Configs need no change; `library_layout: separate` restores the 0.7.1 tabs and chip row.

## 0.7.1 — 2026-11-04

### Changed
- The Browse tab is now Library by default (`library_home` defaults to `true`; set `false` for the old Browse). The tab, the Library back button, the empty-queue and idle Now Playing hints and the editor follow the new default, and `library_label` renames the tab as before.

## 0.7.0 — 2026-11-04

### Added
- **Hearts everywhere (`hearts`, default `true`).** A favourite heart on Search and Library rows and tiles (tracks, albums, artists, playlists, radio), on playlist rows, in the header of album, artist and playlist pages, on Now Playing and on the radio station sheet. Hearts use Music Assistant favourites through the integration (`music/favorites/add_item` / `remove_item`; removing looks up the library id first). Every heart for the same item updates together. They need the `library` class; without it they are hidden, including on Now Playing. There is no confirmation when you remove a heart. The heart flips at once and flips back if Music Assistant refuses or the call fails. `hearts: false` keeps only the 0.6 hearts.
- **Search filters (`search_filters`, default `true`).** Artist and album pages in Search offer **Search in …**. The next searches stay inside it, shown as a removable chip (`Artist: … ✕`) with **Clear filters**. The Library gets a **Filter** button (type to narrow the list) and **Filter by** on artist pages.
- **Library first (`library_first`, default `true`).** Search lists your library matches first ("In your library"), then provider results ("From your providers") with copies of library items removed.
- **Idle reset clears filters (`idle_clear_filters`, default `true`).** When the screensaver comes on, the Search scope chips and the Library filters are cleared.
- **Library home (`library_home`, default off).** The Browse tab becomes **Library** (`library_label`) and opens on big shortcut tiles (`library_tiles`).
- **Autoplay (`show_autoplay`, default off).** Music Assistant's "don't stop the music" toggle in the Queue header, with a style picker (long-press), class `queue`.
- *(Off by default)* Search categories (`search_categories`, `search_default_category`) including genres, podcasts and audiobooks; genre pages; Browse › Radio "Stations by" country, language, tag (`radio_browse`, `radio_country`); a **Discover** chip with Music Assistant recommendation rows (`discover`).
- `radio_favorites_only` (default `false`): Browse › Radio **My stations** shows favourite stations only.

### Changed
- **Heart messages use the top-right status chip.** "Added … to favorites" shows in the 0.6.4 chip; a refused or failed heart shows there in the error style with ✕. The chip stays above the radio station sheet. Views no longer show their own heart toasts.
- A pending speakers question in the chip is no longer replaced (and answered "no") by a late status message; that message is held until the question is answered or times out.

### Includes 0.6.5
- Repeat is queue-level off ↔ all only, and `coerce_repeat_one` (default `true`). One implementation, merged from 0.6.5.

### Known issues
- Music Assistant 2.10.9 sends an Apple Music un-favourite as a *Dislike*. The card has no workaround; expected to be fixed in Music Assistant 2.11.

### Planned for a later version
- Joining a speaker to a dynamic group so that playback resumes on it.
- An admin form to add a radio station by URL.
- Playlist dedupe.
- "Playing from <playlist>" with a heart on Now Playing.

## 0.6.5 — 2026-11-03

### Fixed
- **Repeat one is never an option.** Repeat is a queue setting with two states: off and all ("Repeat queue", the whole queue). The button toggles off ↔ all; the old off → all → one → off cycle is gone, and the repeat-one icon was removed. A stray tap can no longer leave a group looping one song.
- **A player stuck on repeat one is fixed automatically.** If the player reports repeat "one" (for example set from another app), the card shows it as repeat queue and sends one `media_player.repeat_set {repeat: all}` to that player: once per detection after about 1.5 s, at most once a minute (so it can't loop if Music Assistant keeps reporting "one"), and only for a user with Playback permission. New option `coerce_repeat_one` (default `true`) turns this off.
- **Shuffle and repeat are queue-level only.** Both always go to the active target (the group or player the card is playing on, e.g. Everywhere), never to member speakers; the buttons are labelled "Shuffle queue" and "Repeat queue".
- The integration maps a forwarded repeat "one" to "all" if a repeat command is ever allowlisted (none is today; `player_queues/repeat` stays refused).

## 0.6.4 — 2026-11-01

### Changed
- **No popup in the middle of the card when grouping speakers.** Dropping a room, including the room that leads the group (for example Garage from Everywhere), now happens on tap. There is no centred "Drop …?" dialog.
- **One small status chip, top right.** Every grouping message ("Regrouping…", "Garage left", "Kitchen joined Indoor", "Moved to …") appears in one Black Frame chip under the header clock. It doesn't cover the clock or block taps elsewhere, hides after about 4 s, and a new message replaces the old one. It replaces the grouping toasts and the Undo bar. Undo stays in the chip while it shows. It is readable on a kiosk tablet, an iPad and a 390 px phone, and respects reduced motion.
- **Errors use the chip in an error style** (inverted white with an alert icon, about 6 s, with ✕), for example "Couldn't drop Garage: …".
- **The last room is non-modal.** Tapping the last room in a group shows "Garage is the last speaker in Everywhere · Pause" in the chip. Pause keeps the room and the queue, then "Everywhere paused · Undo" resumes. Ignoring the chip does nothing. Music Assistant stops and dissolves a group when its last speaker leaves, so the card still pauses instead of dropping.
- **Taking a speaker from another group** asks in the chip ("Garage stops what it is playing. · Add") instead of a dialog.

### Added
- `confirm_drop` (default `false`). `true` restores the 0.6.3 centred dialogs for drop, takeover and last-room. Also in the editor.

### Unchanged
- `leader_drop` (`allow` / `block`) works as before. Dialogs that aren't about grouping (the Start guard, queue Undo, other toasts) are unchanged.

## 0.6.3 — 2026-11-01

### Added
- **Now Playing speaker controls.** Each room row in the Now Playing volume card has a Drop / Add button. It uses the same confirm, Undo and Regrouping steps as the Speakers panel, and the panel stays closed. The volume card header has a Speakers button that opens the panel. Guests without the speakers class see the volumes only.
- **Station sheet for radio.** Tapping a radio station no longer plays it or replaces the queue. This covers Browse › Radio tiles (including Favorites), Search radio rows and Library home radio. Instead a sheet opens with the logo, name, description, provider (for example TuneIn), genre and stream quality. Music Assistant fills these in through the read-only `music/item_by_uri`, and empty fields are hidden. The sheet has a big Play button (this replaces the queue, as the old tap did), a heart for users with the library class, and Close. The Play icon on Search rows still works as before.

### Fixed
- **Speakers: the room that leads a group can be dropped and re-added.** With a dynamic Music Assistant sync group ("Enable dynamic members"), the leading room used to show a greyed "Leader" button, so it could not be removed (for example, the Garage speaker from Everywhere). `leader_drop` now defaults to `allow`. Drop asks first, then calls `players/cmd/set_members` on the group (never an ungroup of the speaker). Music Assistant hands the group to the other rooms, there are a few seconds of silence, and the queue plays on. The panel says "Regrouping…" until it does. Join adds the room back. `leader_drop: block` keeps the old behaviour.
- **The header pill no longer says "idle" while a group plays.** Home Assistant can report `group_members: []` for a playing Music Assistant group. The pill now counts the speakers from Music Assistant, or from the rooms playing the same title.
- **Un-hearting a radio station from search works.** Search often returns the provider copy of a station (for example `radiobrowser://…`). The heart now looks up the library id with `music/item_by_uri` before `music/favorites/remove_item`. A station that isn't in the library says so instead of failing. The Search heart and the station sheet share this logic.
- **Rooms in the playing group are no longer labelled "elsewhere".** The leading room reads "Leads the group".
- **A saved speaker target that no longer exists is forgotten with a notice.** Before, it was dropped silently. The pill also no longer labels a missing entity "Everywhere".

### Changed
- The header pill reads "Playing on: Everywhere · 3 speakers".
- The last room in a group can't be dropped, because Music Assistant would stop the group. Instead the panel offers to pause the group: the room stays in it and the queue is kept.
- While a dynamic group is idle, Join is shown greyed with a "start playback first" hint instead of being hidden.
- Dev mock: `every=dyn` makes Everywhere a dynamic sync group led by Garage, with `group_members: []` on its Home Assistant entity, which is the shape seen live.

## 0.6.2 — 2026-11-01

### Added
- **Heart on Search radio results.** Radio stations in Search results now have a favourite heart, so you can add or remove a station from your Music Assistant favourites without playing it. It needs the `library` permission, which guests have by default. Browse › Radio reloads after a change, and the row layout no longer wraps on narrow (390px) phone screens.

## 0.6.1 — 2026-11-01

### Fixed
- **Browse > Radio no longer lists keyword-search junk.** 0.6.0 fell back to `music_assistant.search` for the word "radio" when the library had no stations, which filled the grid with unrelated stations. Radio now shows **My stations**: favourite stations first, then the other stations in your Music Assistant library under **More stations**. Stations a provider adds to the library without marking them favourite still appear. With no library stations, Radio shows "No stations yet" and a **Search stations** button that opens Search.

## 0.6.0 — 2026-11-01

The card moves into a Home Assistant integration, **Jukebox Kiosk** (`jukebox_kiosk`), and no longer needs mass_queue. The repository becomes `randybell/ha-jukebox-kiosk` (HACS category integration).

### Added
- **Integration** `custom_components/jukebox_kiosk`: a config flow that picks the Music Assistant entry, guest permission options, and a `jukebox_kiosk/*` WebSocket API (`capabilities`, `ma` with an allowlist, `queue_items`, `item_tracks` with server-side paging, `unfavorite_current`, `subscribe_queue`). It serves and auto-loads the card, and removes old `/hacsfiles/ha-jukebox-kiosk-card/` resources with a Repairs issue.
- **Card backends**: `backend: auto | kiosk | mass_queue | native`. On `kiosk`, the server's feature flags hide controls the user may not use.
- Lyrics send Music Assistant the provider copy of the track, never a library item (asking for a library track writes to MA's database).
- No allowlisted MA command is still `TODO-VERIFY`. The last three passed read-only checks against MA 2.10.9, and `capabilities.todo_verify` is empty. Confirmed: `music/genres/overview` (`item_id`, `provider_instance_id_or_domain`=`library`, `limit` per row), and `music/podcasts/library_items` / `music/audiobooks/library_items` (user impersonation; `summary: false` for resume fields). New feature flags: `genre_overview`, `podcast_library` and `audiobook_library`.
- `music/item_by_uri` always gets `allow_update_metadata: false`. The allowlist refuses `allow_update_metadata: true` on every command, and nothing is sent to MA.
- Lyrics fallback: when `music/item_by_uri` returns the library copy of a track that is in the library, the card skips it and never sends it to `get_track_lyrics`. With no provider copy, the card shows "No lyrics found", because it has no direct LRCLIB path.
- Lyrics are fetched and displayed through Music Assistant only, and never stored. Lyric text is no longer written to `localStorage`; only "not found" markers are kept (`jukebox-card:lyrics:v2`, 1 day), and the old v1 cache with lyric text is deleted on load.
- THIRD_PARTY_NOTICES.md now credits the icon path data (Google Material Icons, Apache-2.0, full text included). The README has a note on music licensing for public or commercial venues, and on lyrics being fetched live through Music Assistant, never bundled.
- Tests: `test/unit/backend.unit.mjs`, `test/kiosk.e2e.mjs` (against `dev/mock-kiosk.js`), and pytest for the integration (including a default guest: favourites allowed, `set_members` / `transfer` / `stop` refused, volume through `media_player` services).

### Changed
- **Guest defaults** (every non-admin user, or the listed guest users): `read`, `playback`, `queue` and `library`. Guests can now favourite and unfavourite; `speakers` (Music Assistant grouping: `set_members`, `transfer`, `stop`) is off by default, so guests can't regroup. Volume and mute are unaffected: the card sends them as `media_player` services, which need no class. Entries that already saved `guest_classes` in their options keep them; the defaults apply to new entries and to options without the key. Change it under Settings → Devices & services → Jukebox Kiosk → Configure.
- The build goes to `custom_components/jukebox_kiosk/www/` and is committed. The card's `customElements.define` calls are guarded so a second copy doesn't throw.
- Workflows: `hassfest.yaml`, `hacs.yaml` (integration) and `release.yaml` (tests, bundle freshness check, `jukebox_kiosk.zip`).

## 0.5.1 — 2026-10-31

Docs and repo housekeeping for HACS: MIT license file, HACS validation workflow, README restructure, developer docs. No card changes.

Docs, license and workflow housekeeping for HACS default-store inclusion. No card change and no version bump.

### Changed
- **LICENSE** is the standard MIT text only, with `Copyright (c) 2026 Randy Bell`. The SIL Open Font License paragraph that used to follow it is removed so GitHub can detect MIT. Bundled fonts (Inter, Plus Jakarta Sans) stay OFL-1.1; that is already recorded in `THIRD_PARTY_NOTICES.md`, and each family's `LICENSE-*.txt` ships next to the font files.
- **README** order is intro, screenshots, requirements, install, configuration, options, troubleshooting and license. Screenshot paths are absolute URLs on `main`. The duplicated changelog list is now a link to `CHANGELOG.md`. Maintainer build, dev harness, tests and release steps moved to `docs/DEVELOPMENT.md`. The "Open questions" section and personal setup notes are removed.
- **Install:** HACS custom repository for now (default-store listing is pending). HACS downloads the release assets into `/config/www/community/ha-jukebox-kiosk-card/` and does not unzip `jukebox-card-fonts.zip`. Custom fonts load only after that archive is unzipped into `fonts/` next to the JavaScript, or `font_base` is set. Otherwise the card uses system fonts.
- **Validate workflow** added at `.github/workflows/validate.yml` (`hacs/action`, category `plugin`, no `ignore`).
- **Release workflow** comment only: HACS installs the release assets, not `dist/jukebox-card.js` from the git tree.

## 0.5.0 — 2026-10-31

### Added
- **Speakers panel**, opened by tapping the header status. Responsive at 390x844, 1280x800 and 1920x1080. It opens in the middle of the card, between the header and the tab bar, so it works inside the 0.4.2 fitted height (including the compact `short` / `tiny` layouts): the tab bar stays visible and a tab tap closes the panel; the panel scrolls when it is taller than the room.
  - `speaker_mode: fixed` (default): a per-room volume mixer only; every call still goes to `entity`, so a 0.4 config makes identical calls.
  - `speaker_mode: dynamic`: "Play on" target chips (remembered per device), join / drop / move with Music Assistant only (`mass_queue.send_command` → `players/cmd/set_members`, `player_queues/transfer`; never HA `media_player.join` / `unjoin`), players read with `players/all`. Static MA sync groups are shown as fixed. Start / move warnings name the groups that would lose speakers.
  - Leader drop: `leader_drop: block` (default) or `allow` (MA hands off / re-forms the group).
  - Optimistic changes with timeouts, a toast on failure and Undo.
  - Per-room now-playing line.
  - `presets` (rooms + volumes + optional target).
  - `quiet_hours` volume cap (guests by default), applied to the panel and Now Playing sliders.
  - `large_buttons`.
- **Permissions** (`grouping`, `grouping_users`, `guest_access`): guests get volume only. This is a UI lock, not security.
- **Queue row icons** for users who may group: Play now (confirmation "Play this now? The current song will stop." → `player_queues/play_index`), Play next (`player_queues/move_item`, `pos_shift = (current + 1) − index`), Move up / Move down, and Remove (`player_queues/delete_item`, no dialog, "Removed <title>. Undo" for 5 s; Undo = `player_queues/play_media` option `add` + `player_queues/items` + `move_item`, and the toast says when the place can't be restored). Never on the playing row. On phones Play next and Remove stay inline and ⋯ opens an action sheet with the rest. Without `mass_queue_entry_id` the 0.4 mass_queue services are used.
- Editor: a **Speakers** section and `large_buttons` under Display.
- **Tab bar redesign (segmented bar).** The bottom tabs are now real buttons on one rounded translucent track: equal segments with hairline dividers, 16 px labels (labels ellipsize instead of wrapping on wide cards, wrap to two lines on phones), and the active tab is a solid white segment with dark text and icon. Hover, pressed (`scale(.97)`) and keyboard focus states use only colour / transform transitions. Short (`data-fit=short`) and tiny (`data-fit=tiny`, icon + label in one row, icons only on phones) layouts are compacted, and `large_buttons` keeps larger tabs there too (60 px short, 52 px tiny, 80 px otherwise).
- **Tab bar keyboard support** (roving tabindex): the active tab is the one tab stop (`tabindex=0`, the others `-1`), and ←/→/Home/End switch tabs and move the focus ring with them. Switching tabs from the keyboard also closes the Speakers panel.
- Dev mock of Music Assistant (`dev/mock-ma.js`, placeholder ids only) with the live MA behaviour: set_members, transfer, play_index, move_item (buffered items raise, out-of-range is a silent no-op), delete_item (buffered items ignored), play_media add, items.
- Tests: `test/unit/speakers.unit.mjs`, `test/speakers.e2e.mjs`, screenshots `test/shots-v050.mjs` (including the segmented tab bar at 1024x666 below the HA toolbar, 1280x800 and 390x844).
- `test/speakers.e2e.mjs` section P: every Play now path (row icon, a played row's icon, the phone ⋯ sheet, the 0.4 long-press menu, a row tap, and the 0.4-service fallback) only jumps playback to that item in place: Music Assistant's queue keeps the same items in the same order, the card's rows match it, and nothing but `play_index` / `play_queue_item` is sent (no `play_media`, replace, clear, move or delete).
- The queue's phone action sheet scrolls inside the card when it is taller than the room (short screens with `large_buttons`).
- `test/fit.e2e.mjs` section F6: the Speakers panel, large-button mode, the queue ⋯ sheet, the Undo bar and the Play-now confirm all stay between the header and the tab bar, with no page scroll and the tab bar fully visible, at 1024x666 / 1024x600 / 1280x720 / 1280x800 / 844x390 / 390x844 / 390x600 below the HA toolbar.

- **Matches live Music Assistant 2.10.9** (checked 31 Oct; mock `&live=1` gives the live timings):
  - Dynamic groups: MA's own default member list (`config/players/get` → `group_members`) is offered as an "<Group> default" preset chip next to the card presets; if the config can't be read, only the card presets show. Current members still come from `players/all`.
  - Static groups never get `set_members` (MA answers 500 "does not support group commands").
  - HA entities carry `mass_player_id: null` and idle groups report another group's `active_queue`, so a target is matched to its MA group by name first and by `active_queue` only while it plays.
  - Dropping a group's leader: MA goes silent ~6 s before the next member leads; the panel says "Regrouping…" until it plays again (the header says "regrouping…" while a group buffers).
  - Queue: rows up to MA's buffered item (`player_queues/get` → `index_in_buffer`) are locked (no Play next / Remove, Move disabled, also in the long-press menu); Play next lands after the buffered row. If MA refuses a move (500 "already played/buffered") or ignores a delete, the toast says "That track is already loading" and the queue reloads.

### Fixed
- **Lyrics scrolled the wrong way when idle.** Lines now always move up, with new lines coming in from the bottom, on every surface. The Stage view no longer jumps down (a stale scroll position plus browser scroll anchoring made 177–185 of its moves go down). The screensaver now slides up instead of jumping (synced) or not moving at all (plain), because lines were replaced instead of kept and their flex sizing collapsed. Only `transform` is animated, with no blur; reduced motion and the `.rm` setting switch the slide off. Covered by direction tests on the overlay, Stage, Lyrics tab and screensaver, synced and plain (3+ line changes each, never down).

### Compatibility
- 0.4 configs load unchanged and make the same calls (fixed mode). Tapping a queue row and the long-press menu keep the 0.4 behaviour, except that the menu no longer offers Play next / Move / Remove on the track MA is already loading.
- Play now never re-sorts, replaces or clears the queue: it only moves playback to the chosen item (`play_index` / `play_queue_item`).

## 0.4.2 — 2026-10-31

Hotfix: the bottom tab bar was cut off on standard monitors.

### Fixed
- **Tab bar pushed below the fold.** The card was sized to the full viewport height (`100dvh`/`100vh`), but in a Home Assistant dashboard it starts below HA's fixed 56 px toolbar, so the tab bar ran 56 px past the bottom of the window (for example tabs at 643–722 px in a 1024x666 window). Viewport units grow with browser zoom-out, so zooming out (Cmd-minus) did not help. In 0.4.0 the page could still be scrolled to reach the tabs, but the wheel over the middle of the card is captured by its scroll areas (`overscroll-behavior: contain`, including the lyrics overlay once real lyrics load), so in practice the tabs could not be reached.
- The card now measures the space it really has: its top edge on the page against the visible viewport (`innerHeight`, `clientHeight` and `visualViewport`), re-measured on window and visual-viewport resize, orientation change, full screen changes, HA navigation, and a `ResizeObserver` on the page and the card's parent. The result is set as an internal CSS variable; there is no hard-coded toolbar height (HA's `--header-height` is only a fallback). Any padding below the card in a masonry or sections view is subtracted. Minimum height 320 px; safe-area insets are still respected. The `height` option still overrides it.
- In full screen and in kiosk mode with the toolbar hidden the card still fills the whole screen.
- Short viewports (under 700 px tall) get a slightly more compact header and tab bar, and under 560 px more compact again, so the header and tabs always stay fully visible while the middle shrinks or scrolls.
- Phones in landscape and other short, wide screens: the search keyboard sits beside the query and results instead of above them, so it is no longer clipped.
- Nothing changes at 1920x1080 (same layout, same large-screen zoom, same frame times).

### Tests
- New `test/fit.e2e.mjs` (`npm run test:fit`): the dev harness can emulate HA's toolbar, sidebar, kiosk mode and a masonry view (`?ha=toolbar|kiosk|masonry&sidebar=open|narrow|closed`). Checks that the header and every tab are fully visible and clickable with no page scroll on every tab (Search with the keyboard open) at 1024x666, 1280x720, 1366x768, 1440x900, 1280x800, 1920x1080, 390x844, 844x390, 820x1180, 1180x820 and 1024x600, with and without the toolbar and in full screen; with the sidebar open and closed; while resizing, rotating and hiding or showing the toolbar; and an emulated Mac Chrome check (1024x666, device scale 2, browser zoom 100 %, 80 % and 67 %). Screenshots go to `test/shots/v042/`.

## 0.4.1 — 2026-10-31

Credits, requirements and third-party notices, plus one small screensaver change.

### Changed
- **Screensaver lyrics status.** When screensaver lyrics are on but there are none to show, the screensaver now shows a small, translucent status line under the track info: "No lyrics", "Lyrics unavailable" or "Looking for lyrics…". It sits inside the drifting clock block, so it moves with the anti-burn-in drift (and the reduced-motion hop). It is hidden while lyrics are showing and when `show_lyrics` or `screensaver_lyrics` is off. Before, the screensaver showed nothing in these states.

### Docs and licensing
- README: new Requirements section (Home Assistant, Music Assistant and its integration, a Music Assistant player, mass_queue from HACS, and what works without mass_queue) and Credits section with a non-affiliation note.
- New `THIRD_PARTY_NOTICES.md`, generated by the build from `node_modules`: the bundled Lit packages (BSD-3-Clause) and the OFL fonts with their authors, each with its full license text. The release attaches it and also puts it in `jukebox-card-fonts.zip`.
- The minified bundle now keeps license comments (Lit's `@license` headers and a Jukebox Card banner).
- LICENSE: `Copyright (c) 2026 Randy Bell`; `package.json` gains `"author": "Randy Bell"`. Still MIT.
- Tests: e2e checks for the screensaver status line in each state; `test/shots-v041.mjs` takes its screenshots.

## 0.4.0 — 2026-10-31

### Added
- **Lyrics** from Music Assistant through mass_queue (`mass_queue.send_command`: `music/item_by_uri`, falling back to `metadata/get_track_lyrics`). Requires `mass_queue_entry_id`.
- Four lyrics surfaces sharing one store:
  - art overlay with a toggle at the top right of the art (remembered per device);
  - **Stage**: full-screen lyrics (Fullscreen API, WebKit fallback, fixed-overlay fallback); tap for controls and ✕, Esc closes;
  - a 5th **Lyrics** tab;
  - screensaver lyrics (previous / current / next line when synced, slow scroll when plain).
- Synced lyrics: current-line highlight and auto-centring from the interpolated position; **long-press** a line to seek (`media_player.media_seek`), with feedback. Taps do nothing.
- Plain lyrics: progress-proportional scroll, manual override, "Unsynced" chip.
- Radio: lyrics via `music/search` best match + `get_track_lyrics`; never seeks.
- States: "Looking for lyrics…", "No lyrics found", "Lyrics unavailable" (with Retry and a permission hint).
- Caching: memory LRU + localStorage keyed by URI (or artist|title for radio), 30-day positive / 1-day negative TTL, in-flight de-duplication, 60 s error back-off.
- Options: `show_lyrics`, `lyrics_tab`, `screensaver_lyrics`, `lyrics_seek`, `lyrics_offset_ms` (default 500); `default_tab: lyrics`.
- Editor: **Display** section with screensaver presets Off / 1 / 5 / 10 / 15 / 30 / 60 min plus Custom (any 0–1440 still loads; default 10), and a **Lyrics** section.
- Tests: lyrics unit tests (`test/unit/lyrics.unit.mjs`), lyrics end-to-end tests (`test/lyrics.e2e.mjs`), screenshots (`test/shots-v040.mjs`).

### Changed
- The editor no longer writes untouched defaults (`rooms: []`, `screensaver_minutes: 10`, lyrics switches) into YAML.
- The dev mock records read-only lyrics lookups in `window.__lyricsLog` instead of `window.__calls`.

### Compatibility
- Existing 0.3.x configs load unchanged; lyrics are on by default but need `mass_queue_entry_id`.

## 0.3.2
- Search results as list rows with Add to queue / Play next / Replace queue / Start radio; confirmations; detail pages with Play / Shuffle; phone layouts.

## 0.3.1
- Live API fixes: mass_queue track lists and paging, proxy-only player art, Radio Browser stations.

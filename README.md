# Jukebox Kiosk (`ha-jukebox-kiosk`)

A touchscreen Jukebox music player for Home Assistant

> This README covers the integration and the card bundled in it. Since 0.7.9 the card works only through the Jukebox Kiosk integration (or, with fewer features, the official Music Assistant integration); mass_queue support is gone.

Jukebox Kiosk is a Home Assistant integration that ships the **Jukebox Kiosk** card, a Lovelace card for a Home Assistant + Music Assistant jukebox kiosk. It also gives the card its own WebSocket API to Music Assistant.

- **One install.** Setting up the integration serves the card from `/jukebox_kiosk_static/jukebox-card.js` and loads it on every dashboard. You don't add a resource, and there are no font files to install.
- **Its own Music Assistant API.** The integration borrows the connection the official Music Assistant integration already holds and exposes it as `jukebox_kiosk/*` WebSocket commands. It forwards only an allowlist of Music Assistant commands, and every one is checked against the calling Home Assistant user (see [Permissions](#permissions)).
- **Every card feature through one integration.** Queue reading and editing (Play Now, Play Next, Move, Remove with Undo), album/artist/playlist/podcast track lists with server-side paging, lyrics, speaker grouping and transfer, and favourites.
- **Live queue.** The card subscribes to queue changes (`jukebox_kiosk/subscribe_queue`) instead of polling.

The card's element is still `custom:jukebox-card`, so existing dashboards keep working. Version history is in [CHANGELOG.md](CHANGELOG.md), and building and tests are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Screenshots

> Since 0.7.20 the Library lists show as rows by default (not tiles, and artists are no longer round). Since 0.9.1 Playlists, Albums and Radio start as tiles, and each part of the card has its own Rows or Tiles setting. Since 0.8.0 the card follows your Home Assistant theme, so colors, corners and fonts come from the theme, in light and in dark. Since 0.8.4 Now Playing always follows the theme too: it has no album-art background and no option for one (album art is a background on the screensaver only).

> The pictures below were retaken for 0.9.0 (before the 0.9.1 Rows or Tiles settings), once with a light theme and once with a dark theme, using Home Assistant's default theme and font (Roboto). They show Library lists as rows, Genres among the category buttons, and the Queue without row buttons. The Screensaver pictures show landscape, which has not changed; in portrait the screensaver now has a bigger track and a smaller clock.

**One Library tab, keyboard always open.** The on-screen keyboard stays open on every screen size. Below the search box is an **All sources** button. Tap it and a row opens under the box: All, Library, then each music service set up in Music Assistant. You can turn on more than one. The button names the ones you picked and gets Home Assistant's soft selected highlight while any is on. Tap it again to close the row. Big buttons pick Playlists, Artists, Tracks, Genres or Radio, and the one you are in has the soft selected highlight. On the library list, a heart sits at the end of that row. There is no Keyboard pill and no hide handle. An empty box lists your library; typing searches that category, library first.

| Library, light theme | Library, dark theme |
|---|---|
| ![Library, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-light-090-1024x712.png) | ![Library, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-dark-090-1024x712.png) |

| Library, typing, light theme | Library, typing, dark theme |
|---|---|
| ![Library, typing, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-typing-light-090-1024x712.png) | ![Library, typing, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-typing-dark-090-1024x712.png) |

| All sources open, light theme | All sources open, dark theme |
|---|---|
| ![All sources open, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-sources-light-090-1024x712.png) | ![All sources open, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-sources-dark-090-1024x712.png) |

| Library search, Spotify only, light theme | Library search, Spotify only, dark theme |
|---|---|
| ![Library search, Spotify only, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-provider-light-090-1024x712.png) | ![Library search, Spotify only, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-provider-dark-090-1024x712.png) |

| Now Playing, light theme | Now Playing, dark theme |
|---|---|
| ![Now Playing, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/now-light-090-1024x712.png) | ![Now Playing, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/now-dark-090-1024x712.png) |

| Queue, light theme | Queue, dark theme |
|---|---|
| ![Queue, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/queue-light-090-1024x712.png) | ![Queue, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/queue-dark-090-1024x712.png) |

| Screensaver, light theme | Screensaver, dark theme |
|---|---|
| ![Screensaver, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/screensaver-light-090-1024x600.png) | ![Screensaver, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/screensaver-dark-090-1024x600.png) |

The Screensaver looks the same in both themes: the current art fills the background, with white text. Only its font comes from the theme.

## Requirements

- **Home Assistant 2026.11.0** or newer.
- **[Music Assistant](https://music-assistant.io)** 2.10 or newer, and the official **Music Assistant** integration (`music_assistant`) set up in Home Assistant. Jukebox Kiosk uses that integration's connection, so it has no server URL or token of its own.
- **A Music Assistant player** to play to. Group players such as `media_player.everywhere` work too.
- mass_queue is **not** used. The card no longer knows it; you can uninstall it.

> **Music licensing and lyrics.** Jukebox Kiosk plays whatever your Music Assistant providers give it; it ships no music and no lyrics. Personal streaming subscriptions are usually for private listening only, so a public or commercial venue (a bar, shop, gym or event) needs music services and performance licenses that cover public playback. Lyrics are fetched live through Music Assistant's metadata providers when you open them; they are never bundled, and the card keeps lyric text in memory only.

## Install

### Marketplace (custom repository)

1. Go to **Settings → Marketplace** and select **Add from link** in the upper-right corner. Enter `https://github.com/randybell/ha-jukebox-kiosk` (or `randybell/ha-jukebox-kiosk`) and select **Add**. The Marketplace works out the type by itself. Adding a custom repository needs a GitHub connection, and the Marketplace asks you to connect one if you haven't yet.
2. Open **Jukebox Kiosk** in the list and select **Install**, then **Install** again in the dialog. If Home Assistant asks for a restart (a repair under **Settings → System → Repairs**), restart it. New versions show up under **Settings → Updates**.
3. **Settings → Devices & services → Add integration → Jukebox Kiosk**, then choose your Music Assistant entry.
4. Add `type: custom:jukebox-card` to a dashboard (see [Configuration](#configuration)).

### Manual

Copy `custom_components/jukebox_kiosk/` (from the repository or the `jukebox_kiosk.zip` release asset) into `/config/custom_components/`, restart, then follow steps 3–4.

### Coming from the old Jukebox Card plugin (0.5.x)

The integration finds dashboard resources that point at the old card file, `/hacsfiles/ha-jukebox-kiosk-card/jukebox-card.js` (or `/local/community/ha-jukebox-kiosk-card/jukebox-card.js`, where Home Assistant 2026.11's Marketplace serves plugins), and removes them, so the card doesn't load twice. Since 0.8.8 only that exact file counts (a `?…` ending such as `?hacstag=…` is fine); other resources, even ones with a similar name, are left alone. It then raises a Repairs issue that asks you to remove the old **Jukebox Card** plugin under **Settings → Marketplace**. The issue stays, also across restarts, until the old plugin files are gone. YAML-mode resources can't be edited automatically; the Repairs issue lists the line to delete. Card configs keep working as they are. `mass_queue_entry_id` is ignored unless you set `backend: mass_queue`.

## Backends

The card picks its backend by itself; you don't set anything. The resolved backend is shown on the element as `data-backend`. There is no option for it (since 0.7.9); an old `backend:` line in YAML is ignored.

| Backend | Uses | Notes |
|---|---|---|
| picked automatically | `kiosk` if `jukebox_kiosk` is loaded, otherwise `native` | |
| `kiosk` | `jukebox_kiosk/*` WebSocket commands | Every feature. What the server doesn't allow for this user is hidden, or greyed in the hold pop-up (see below). |
| `native` | the official `music_assistant` services only | Search, Browse grid, transport, volume and playing music. No queue tab, track lists, lyrics or grouping. |

On the kiosk backend the card asks `jukebox_kiosk/capabilities` once per connection. It hides what the server reports as unavailable: Undo, the remove-favourite heart (`unfavorite`), the Speakers panel's grouping (`speakers`) and lyrics (`lyrics`). Queue actions are in the hold pop-up; the Queue rows have no buttons. When `queue_edit` is off, Move up and Move down stay in the pop-up, greyed, and do nothing — they are not hidden. Play Now, Play Next and Remove stay in the pop-up too. When `queue_play` is off, Play Now is greyed. When both are off, Play Now, Play Next, Move up, Move down and Remove are all greyed. Guests follow the same greying as admins: `queue_edit` off greys only Move up and Move down; Play Next and Remove still work when `queue_play` is on. The capabilities also carry the Music Assistant entry id (`ma_entry_id`), which is how the card finds Music Assistant for every user, admin or not.

## Permissions

Admins can do everything. In the integration's options (**Settings → Devices & services → Jukebox Kiosk → Configure**, form "Guest permissions") you choose:

- **Guest users**: these users get guest rights even if they are admins. This is handy for a kiosk login.
- **Treat every non-admin user as a guest** (default on): when this is off, non-admins get every class except `admin`.
- **What guests may do**: any of the classes below. `admin` can never be given to guests.

| Class | Allows | Guest default |
|---|---|---|
| `read` | queue, search, browse, lyrics | ✅ |
| `playback` | play and add music, jump in the queue | ✅ |
| `queue` | reorder, remove, undo | ✅ |
| `library` | favourite / unfavourite (every heart: Now Playing, Search and Library rows, playlists, the radio station sheet), playlists | ✅ |
| `speakers` | Music Assistant grouping: join / drop speakers (`players/cmd/set_members`), Move (`player_queues/transfer`), stop a group (`players/cmd/stop`) | — |
| `admin` | reserved; no command needs it since 0.7.3 (the `jukebox_kiosk/raw` diagnostic command was removed) | never for guests |

**Volume needs no class.** Volume and mute (the Now Playing sliders and the Speakers panel mixer, in fixed and dynamic mode) are sent as Home Assistant `media_player.volume_set` / `volume_mute` services, not through the integration, so a guest without `speakers` keeps the mixer. Without `speakers` the card hides grouping and the server refuses `set_members`, `transfer` and `stop`.

**Existing entries keep their saved choice.** The defaults apply when the integration is added (they are written into the entry's options) and when the options have no `guest_classes` key at all. An entry that already saved a list, for example one added from an earlier 0.6.0 draft with read, playback, queue and speakers, keeps exactly that list until you change it under **Configure**.

The server enforces these on every command. Hiding a control in the card is a convenience only; the card's own `grouping` option is still not a security boundary.

**Not per user.** Music Assistant passes the Home Assistant user only on search, library listings and `play_media`. Recently played, favourites and recommendations are shared by everyone on the Music Assistant server.

## Checked Music Assistant commands

No allowlisted command in `MA_COMMANDS` (`custom_components/jukebox_kiosk/const.py`) is still marked `TODO-VERIFY`. Each one is confirmed by the `music-assistant-client` signatures, by a live read, or by a read-only check against Music Assistant 2.10.9. `jukebox_kiosk/capabilities` therefore returns an empty `todo_verify` list. The last commands confirmed, all with read-only checks, were:

- **`music/genres/overview`** takes `item_id`, `provider_instance_id_or_domain` (default `library`) and `limit`, which is applied per row (default 25). It returns rows for Artists, Albums, Tracks and Playlists, whose ids are `genre_<type>`.
- **`music/podcasts/library_items`** and **`music/audiobooks/library_items`** take `favorite`, `search`, `limit` (500), `offset` (0), `order_by` (`sort_name`), `provider`, `genre` and `played_only`. They also take the keyword-only arguments `summary` (default true), `collapse_collections` and `reachable_via`. Send `summary: false` when you need `fully_played` and `resume_position_ms`. Both commands pass the Home Assistant user to Music Assistant, like the other library listings.
- **`music/item_by_uri`** is read-only only while `allow_update_metadata` is false, so the integration always sends `false`. It refuses any other value, and it refuses `allow_update_metadata: true` on every allowlisted command. For a track in your library, this command returns the library copy (provider `library`), even when you ask with a provider URI.

**Lyrics.** On the kiosk backend the card never sends a library track to `metadata/get_track_lyrics`, because Music Assistant would write to its library. It uses the provider copy in the queue (`current_item.media_item`) instead. If that isn't there, it looks up each provider mapping with `music/item_by_uri`, without `allow_update_metadata`. If the lookup returns the library copy, the card skips it. The card doesn't fetch from LRCLIB directly, so when it finds no provider copy it shows "No lyrics found".

## Configuration

> The card reference below was written for 0.5.x. Wherever it still names a `mass_queue.*` action, read the matching `jukebox_kiosk/*` command: that is what the card sends since 0.7.9. Track lists are paged by the server 100 at a time.

**A fresh card needs nothing typed.** When you add the card, **Player** is already filled in with the first Music Assistant player Home Assistant knows; change it if you want another one. If Home Assistant has no Music Assistant player yet, pick one before the card works. The card finds the Music Assistant entry through the integration (non-admins too), and the heart finds a way to favourite by itself.

**A player is required.** The card plays only on the player you picked (`entity`). It never falls back to another player. A card with no `entity`, or with an entity that is not a media player, shows Home Assistant's error "Specify an entity from within the media_player domain" until you pick a player. Before 0.8.6, a card with no `entity:` line quietly played on `media_player.everywhere`.

Add the card to a dashboard. A single **panel** view is the layout it is built for. Entity ids in the example are labeled `example:`. `entity` is required. Other keys you leave out use the defaults in [Options](#options).

```yaml
# Example configuration. Entity ids below are examples; replace them with yours.
views:
  - title: Jukebox
    path: jukebox
    type: panel
    cards:
      - type: custom:jukebox-card
        entity: media_player.everywhere                # required; example: Music Assistant group player; every play_media goes here
        rooms:                                         # example
          - { name: Living Room, entity: media_player.living_room }
          - { name: Kitchen,     entity: media_player.kitchen }
          - { name: Garage,      entity: media_player.garage }
        screensaver_minutes: 10
        default_tab: now                               # now | browse | search (separate layout) | queue
        show_lyrics: true
```

The rest of this section is how each part of the card behaves.

### Themes

Since 0.8.0 the card follows the Home Assistant theme you use, the way Home Assistant's own cards do. 0.8.1 finished the job on light themes.

- **Colors, light and dark.** Text, backgrounds, lines and highlights come from the theme. Light and dark themes both work on every screen, also on themes with see-through cards. Buttons, chips, tags, the search boxes and the on-screen keyboard use Home Assistant's chip and input colors: a chip has an outline and no fill, a search box has Home Assistant's input fill, and the keyboard has no dark grey panel. A selected chip (the Library category, picked sources, the Queue choices) has Home Assistant's soft selected highlight, not a solid color. The tab you are on is marked the way Home Assistant marks the selected item in its own sidebar: a light tint of the theme's "sidebar selected" color (the main color by default) with that color for the label. The Play button, the playing row in the Queue, the heart and active shuffle and repeat use the theme's main color.
- **Corners, shadow and border.** The card takes them from the theme's card settings. The card draws no black shadows of its own (not on the cover, the Play button, the slider knob or the selected Library category); it uses Home Assistant's own card shadow only if your theme sets one. Pop-ups use the theme's dialog corners, shadow and maximum height, and they dim the screen behind them once, the way Home Assistant's own dialogs do. If your theme does not say how much, the card uses Home Assistant's own default (68% brightness); a theme that sets it, even to none, wins. Messages (toasts) look like Home Assistant's own.
- **Fonts.** The card uses the theme's fonts and its text sizes, weights and line spacing. With Home Assistant's default theme that is Roboto. The Inter and Plus Jakarta Sans fonts are no longer bundled, the `fonts/` folder is gone, and the card no longer downloads fonts. Titles and the clock look plainer than before. `font_base` no longer does anything, and since 0.8.9 it is no longer a setting at all; old setups that still have it keep loading, and you can remove it.
- **Now Playing title.** It can't be larger than the biggest size in Home Assistant's text scale (40 px with the default theme).
- **Now Playing.** It is a plain card in your theme's colors, like Library and Queue, and the cover shows in its own square. There is no background option for it any more (since 0.8.4, there are no Background or Large buttons settings in the card editor). An old config that still has `backdrop` or `large_buttons` keeps working: the card loads it without an error and ignores both keys, so you can remove them. Album art is a background on the screensaver only.
- **No picture.** A cover with no picture, and a radio station with no logo, show a plain square in the theme's main color. The colored radio-tower picture is gone.
- **Panels on Now Playing.** The speakers panel and "up next" are solid theme cards with theme text.
- **Screensaver and Stage.** They stay black with white text. Only their font comes from the theme.
- **Card-specific color settings.** There are none. Old `--jb-…` style overrides (from a theme or card-mod) no longer have any effect. Change the colors in your Home Assistant theme instead.

After updating, the card looks different: fonts and colors now come from your theme, and Now Playing has no album-art background.

### Reduced motion

With `prefers-reduced-motion: reduce` (Android: Settings → Accessibility → Remove animations), the screensaver turns off its Ken Burns zoom and its continuous drift. To still protect the panel from burn-in, the clock block jumps to a new position every 60 s with no animation (`step-end`), cycling through 10 spots over 10 minutes.

### Large screens (1920x1080)

The layout is designed around a 1280x800 tablet. On larger screens the whole card is zoomed (CSS `zoom`, set from a `ResizeObserver`) so the art, text and touch targets grow, rather than spreading out with empty space. At 1920x1080 the zoom is 1.35, which gives the 1280x800 layout's proportions at full resolution. Popover menus correct their position for the zoom (`localRect` in `src/shared.ts`; test 15k). Use `scale: 1` to turn this off, or a number to force a size.

### Acting on a row

Since 0.9.0 the buttons on list rows (Add to queue, Play Next, Play Now, Start radio, Remove, Move up, Move down, More and a station's Play) are gone. To act on a track, tap it or press and hold it: both open the large pop-up with the choices. A station's **Play** is on the station panel: tap the station to open it.

What stays: the heart and the LIBRARY tag, and the Genres list arrow in the older separate-tabs Library (if you use it).

### Now Playing

- **Art.** The card never loads the player's absolute `entity_picture` (`http://<ma-host>:8095/imageproxy?…` is mixed content on an https dashboard and unreachable off the LAN). It uses, in order: `entity_picture_local` (HA's relative `/api/media_player_proxy/…` URL), a relative `entity_picture`, the current mass_queue item's `media_image`, then the placeholder. The same order feeds Now Playing and the screensaver. Since 0.8.9 each picture is tried only once per track: if one fails to load, the card moves on to the next one, then the placeholder (on the screensaver, the no-art background), and starts fresh when the next track begins, so a picture that failed never keeps later covers blank. Item images are used only when they are https, `data:image` or relative, and, since 0.8.9, plain http when the dashboard itself is open over plain http. On an https dashboard plain http pictures are left out, because the browser would block them.
- **Display.** Now Playing is a plain card in your theme's colors, like Library and Queue, and the cover shows in its own square. The tab shows the art, title, artist · album, a provider badge from the URI scheme and "Playing on" with your player's name (for example "Playing on Everywhere").
- **Seek bar.** Tap or drag it to send `media_player.media_seek {seek_position}`. The time label follows the drag.
- **Transport.** All transport calls target `entity` only:

  | Button | Call |
  |---|---|
  | Previous | `media_previous_track` |
  | Play / pause | `media_play` or `media_pause`, chosen from the state |
  | Next | `media_next_track` |
  | Shuffle queue | `shuffle_set {shuffle}` on the player the card is playing on (its Music Assistant queue) |
  | Repeat | `repeat_set {repeat}` on the same player. The button switches only between **Repeat off** and **Repeat entire queue**. There is no repeat-one in the cycle. If the player is already on repeat-one (set somewhere else), the button shows as pressed, labelled **Repeat single track**, and a tap turns repeat off. |

  Shuffle and repeat are queue settings: they always go to the active target (the group or player the card is playing on, e.g. Everywhere), never to individual member speakers, and there is no per-track or per-row shuffle or repeat.
  Active shuffle and repeat use your theme's main color with a dot under them (on a solid main-color screen they use the theme's light text color); inactive ones are dimmer. The UI updates optimistically and reconciles when HA reports the new state.
- **Heart.** The heart adds the playing track to Music Assistant's favourites through the integration (`jukebox_kiosk/favorite_current`, needs the `library` class), or, on the native backend, presses the player's own Music Assistant "Favorite current song" button, found on the player's device. A filled heart removes it with `jukebox_kiosk/unfavorite_current`. When the card has no way to favourite, the heart is hidden. There is no option for it (since 0.7.9); an old `favorite_entity:` line in YAML is ignored.
- **Sleep timer.** The moon button on the cover opens Music Assistant's choices: 15 minutes, 30 minutes, 45 minutes, 1 hour and 2 hours. While a timer runs, the choices show "Stops in" with the time left and a red **Cancel sleep timer** button, and the cover shows the moon and the time left (minutes and seconds, or hours, minutes and seconds from an hour). Since 0.9.1 the timer runs in Music Assistant through the integration (`jukebox_kiosk/sleep_timer_set`, `sleep_timer_clear`, `sleep_timer_get` and `subscribe_sleep_timer`), for the same player Music Assistant's own app uses, so a timer started or cancelled in either place shows in both. A timer set in Music Assistant to stop at the end of the track shows as End of track (or End of episode, End of audiobook or End of chapter). The card has no backup timer of its own.
- **Autoplay.** Since 0.9.1 an **Autoplay** button sits next to "Playing on": outlined when off, filled with your theme's main color when on. Tap it to switch Autoplay. It shows when the server supports Autoplay and the queue is active, and is hidden while a radio station or other live stream plays. While Repeat is on it is greyed and does nothing, as in Music Assistant, because repeat turns Autoplay off. When Music Assistant keeps the queue going by itself, it shows as on and does nothing. The Queue's Autoplay button follows the same rules.
- **Up next strip.** It shows the next queue item and "+ N more". Tapping it opens the Queue tab. On a card narrower than about 520 px the strip is left out; the Queue tab still shows what is next.
- **Volume:**
  - **The player's own slider** (the top one, named after your player, for example Everywhere) sends `volume_set` to `entity`.
  - **Each room** sends `volume_set {volume_level}` to **that room's entity only**.
  - **Many rooms.** When the rooms don't fit, only the room sliders scroll; since 0.8.8 the player's own slider stays in place at the top. The **More speakers** button scrolls the rooms down.
  - Slide sideways to change the volume: the slider waits for a short sideways movement before the number follows your finger. A tap, a stray touch or scrolling up and down does not change it. This applies to Now Playing and the Speakers panel; the seek bar is unchanged.
  - While you drag, the card sends at most one call every 200 ms, and always sends the final value on release.
  - Tapping a speaker icon sends `volume_mute {is_volume_muted}` to that entity. If Home Assistant is disconnected, the card keeps the last mute for each speaker and sends it once when the connection comes back, the same way volume already does.
  - The card never joins or unjoins players.
- **Layouts.** In landscape the art is on the left; in portrait it sits on top, with rooms in a three-column grid on tablets. Phone layout applies at ≤520 px. Since 0.7.12 the top bar, the tab bar and the Library layout follow the card's own width rather than the browser window's, so a narrow card in a wide window (such as the card editor preview) is laid out as a narrow card.

### Queue

- **Reading.** The queue comes from `jukebox_kiosk/queue_items {entity_id, limit_before: 1, limit_after: queue_limit (1–1000)}`, and the card subscribes to changes (`jukebox_kiosk/subscribe_queue`).
- **Layout.** The previous track is dimmed. "Now playing" is the highlighted row, filled with your theme's main color, then a numbered "Up next" list. "+ N more in Music Assistant" appears when the queue is longer than the list. With **Show Queue as** set to Tiles (since 0.9.1), every track is a tile in one grid, **Tiles across** wide: the track playing now is highlighted, tracks already played are dimmed, and Up next tiles carry their number. Tap and press and hold work the same as on rows.
- **Tapping a row.** Since 0.7.13, tapping a track opens the same large pop-up as pressing and holding it (see below). Before that a tap did nothing. A radio station in the queue is the exception: tapping it still does nothing.
- **Row actions.** Tap or press and hold a track row to open the large pop-up. Since 0.7.12 it always lists **Play Now**, **Play Next**, **Move up**, **Move down** and **Remove**, in that order, then **More Info** (see the press-and-hold pop-up under Library), then **Cancel**. A choice that can't be used for that track stays in its place, greyed, and does nothing: for example Play Next and Move up on the track that is already next, Move down on the last track, and Play Now, Play Next, Move up, Move down and Remove on the track playing now. Guests get the same list and the same greying, including Play Now greyed on the track playing now. A radio station in the queue has no More Info.

| Queue press-and-hold options, light theme | Queue press-and-hold options, dark theme |
|---|---|
| ![Queue press-and-hold options, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/queue-popup-light-090-1024x712.png) | ![Queue press-and-hold options, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/queue-popup-dark-090-1024x712.png) |

- **Search queue.** **Search queue** in the header opens a box and an on-screen keyboard that stays open. The list shows tracks whose title, artist or album contains what you type. Press and hold a track in the results (since 0.7.12), or tap it (since 0.7.13), to open the same pop-up as a normal Queue row, with the same choices and the same greyed-out rules. With a physical keyboard, typing goes into the search (since 0.7.13): letters, digits and punctuation are typed and Backspace deletes, so keys such as e, c, d, a and m no longer set off Home Assistant's own shortcuts (its search bar, Assist and so on). This applies only while Queue search is open on the Queue tab, and Esc is left to the card. **Done** closes the search and clears it.
- **Header.** The Queue tab badge shows how many items are left, and the header says how many are up next.
- **Play Now, Play Next and Remove** go through `jukebox_kiosk/ma` with the MA queue id. They appear in the hold pop-up, not on the rows. When `queue_play` is off, Play Now is greyed in the pop-up and does nothing. When `queue_edit` is off, Move up and Move down stay in the pop-up, greyed; Play Next and Remove still work when `queue_play` is on, for guests as well as admins.
  - **Play Now** asks first, "Play this now? The current track will stop.", then sends `player_queues/play_index {queue_id, index: queue_item_id}`. It only moves playback to that item: the queue keeps its items and order, and nothing is replaced, cleared or moved. Guests get the same question, and Play Now is greyed on the track that is playing for them too.
  - **Play Next** sends `player_queues/move_item {queue_id, queue_item_id, pos_shift: (current + 1) − index}`, no dialog. It is greyed on the row that is already next, on the track playing now, and on tracks that have already played, for guests as well as admins. If MA has already buffered the next track it ignores the move and the card shows MA's order again.
  - **Move up / Move down**: no dialog.
  - **Remove** sends `player_queues/delete_item {queue_id, item_id_or_index: queue_item_id}`, no dialog, and shows "Removed <title>. Undo" for 5 s. Guests get the same Undo. **Undo** re-adds the track's URI (`player_queues/play_media {queue_id, media: uri, option: add}`), finds the new row (`player_queues/items`) and moves it back (`move_item`). If it can only be re-added at the end, or not at all, the toast says so. When `queue_play` is off and `queue_edit` is on, Remove has no Undo. Remove is greyed on the track playing now, on tracks already played, and on the track Music Assistant is already loading.
  - A choice that cannot be used stays in the pop-up, greyed. It is not hidden.
  - The track Music Assistant is already loading (the one after the playing track, near its end) can't be moved or removed: Play Next, Move up, Move down and Remove are greyed in the pop-up. If MA refuses a move anyway the toast says "That track is already loading, so it can't move right now."; a refused or ignored Remove says "That track is already loading, so it can't be removed right now." The queue reloads either way.

### Speakers (0.5.0)

- **Header status** ("Everywhere · 3 rooms synced", or "N speakers") opens the Speakers panel. Since 0.7.12 the number of speakers in the header matches the Speakers panel, so a four-speaker group shows "Everywhere · 4 speakers" (it used to show "1 speaker" when Home Assistant listed only the speaker that leads the group). The panel opens on the right side of the card, between the header and the tab bar (so it fits the measured height below the HA toolbar), scrolls when it is taller than that, and closes on a tab tap or the **Close** button.
- **Fixed mode (default).** The panel is a mixer: one volume slider per room, nothing else. Every call goes to `entity`, exactly as in 0.4.
- **Dynamic mode.** "Play on" chips choose the target (remembered per device); joining, dropping and moving use Music Assistant only: `jukebox_kiosk/ma` with `players/cmd/set_members` and `player_queues/transfer` (never `media_player.join` / `unjoin`). Players are read with `players/all`. A static MA sync group is shown as fixed (no join/drop). Each room shows what it is playing. Presets (one per dynamic group, from Music Assistant's own default members) regroup in one tap. Changes are optimistic and time out. Every grouping message (joined, left, Regrouping…, errors, Undo) appears in one small status chip at the top right, under the header clock; it never covers the rest of the card, hides itself after about 4 s, and a new message replaces the old one. **Undo** in the chip works while it shows. Errors use the same chip in an inverted (white) style and stay a little longer. Since 0.6.4 drops happen on tap, with no centred dialog; a question that does need an answer (taking a speaker from another group, or the last room) is asked in the chip with one action button and ✕, and ignoring it does nothing. `confirm_drop: true` brings back the centred dialogs. Any room can be dropped and re-added, including the one that leads the group: the card asks MA to remove it from the group (`players/cmd/set_members` on the group, never an ungroup of the speaker), MA re-forms the group on the other rooms after about 6 s of silence and the queue plays on; the panel says "Regrouping…" until it does. `leader_drop: block` keeps the old behaviour (hand off with Move). The last room in a group can't be dropped (MA would stop and dissolve the group): tapping it shows "<Room> is the last speaker in <Group> · Pause" in the chip; Pause keeps the room and the queue, and "<Group> paused · Undo" resumes. While the group is idle, Join is shown greyed with a hint to start playback first. For dynamic MA groups the panel also offers MA's own default line-up as a "<Group> default" preset. Moving music to another target has a silence of about 5 s on the new target.
- **Permissions are a UI lock, not security.** `grouping` / `grouping_users` / `guest_access` only hide or disable controls in this card. Anyone with dashboard access can still call the same services from elsewhere in Home Assistant. Use HA users and dashboards to restrict access.
- **Editor:** a Speakers section. **Speakers panel** offers "Volume only: always play on the chosen player" or "Choose speakers: pick, group and drop speakers from the card". Only Choose speakers shows the rest: targets, who may change speakers, extra people, everyone else, **Removing the main speaker from a group** ("Allow: the music keeps playing on the other speakers after a short pause" / "Don't allow: use Move to hand the music to another speaker first") and the ask-before-dropping switch. Presets come from Music Assistant's group defaults; there is nothing to set.

| Speakers panel with room volumes, light theme | Speakers panel with room volumes, dark theme |
|---|---|
| ![Speakers panel with room volumes, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/speakers-light-090-1024x712.png) | ![Speakers panel with room volumes, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/speakers-dark-090-1024x712.png) |

### Library (search and browse in one tab)

- **One tab.** Since 0.7.2 the **Library** tab (`library_label`) is where you browse and search; there is no Search tab and no tile home by default (`library_layout: combined`).
- **Search box, with All sources below it.** The box uses the on-screen keyboard and searches on every keystroke (see [How search behaves](#how-search-behaves)). **All sources** sits below the box. Tap it to open a row under the box: **All** (the usual choice), **Library**, then the music services set up in Music Assistant, using the names you gave them. A service that is not available is left out. The row wraps when there are many, and on a phone it scrolls sideways. It does not cover the screen. Tap **All sources** again to close the row.
  - **Picking more than one.** Tapping a service while All is on selects just that service. Tapping more adds them. Tapping a selected one turns it off. When none is left, it goes back to **All**. Tapping **All** clears the others. While any are picked, the button gets Home Assistant's soft selected highlight. On a larger screen the button shows the names (shortened if they do not fit); on a phone it says **All** or how many are on. The open row still shows each name in full, and the line under the box is hidden. With `library_keyboard: tap`, and on the separate Search tab, a larger screen shows the names on the button (for example "Apple Music + TuneIn"), shortened if they do not fit, a phone says **All** or how many are on, and the line under the box names the selection.
  - `search_sources: false` hides the button and the row.
- **Category buttons.** Big buttons with an icon and a name: Playlists (where the tab opens), Artists, Tracks, Radio, and Genres when Music Assistant can search genres (Genres is in the default `library_categories` row). The one you are in has the soft selected highlight. Albums, Podcasts and Audiobooks appear only if you list them in `library_categories`, which also sets the order. Radio and Podcasts stay separate buttons.
- **Favorites.** On the library list (nothing typed, and All or Library chosen) a small heart sits at the end of the category row. It shows favorites only. There is no sort button (since 0.7.9): lists keep their usual order, A–Z, and radio stations most played first. The heart is hidden while you are typing, while a music service is chosen, while Search in an artist or album is on, or on a detail page. Favorites is no longer a chip in a bar above the list.
- **Empty box, All or Library alone:** the library list of the selected category. The Genres list (on the combined tab when the backend can search genres, and on the older separate-tabs Library layout) comes from `music/genres/library_items`. There is still no genre page. Tapping a genre adds a genre filter, shown as a removable **Genre: <name>** chip with **Clear filters**; the results are that genre's artists, albums and tracks in your library. Words you typed to find the genre are cleared; typing again searches inside the genre. The status line says the search is in your library only. With `search_filters: false`, a genre row or tile is plain text and does nothing.
- **Typed text:** results for the selected category and source only. With **All**, library matches come first ("In your library"), then provider results ("From your providers"); **Library** shows library matches only; providers send one `music/search` with all of them in `providers`; **Library** plus providers shows library matches first, then those providers.
- **Provider with an empty box:** one provider shows its folders (`music/browse <provider>://`, admins) or an inline hint "Type to search <provider>"; several providers show the inline hint ("Type to search Apple Music + TuneIn") — never a popup.
- **Filters.** "Search in <artist / album>" adds the artist/album chip and **Clear filters** next to the box. Tapping a genre adds a **Genre: <name>** chip the same way. While an artist filter is on, that artist's page shows **Clear filter by <artist>** with an X in place of **Search in <artist>** (or **Filter by <artist>**), and a tap clears only the artist filter: the page stays open and any typed text stays. Clear filters also empties the box and puts the source back to All. If the All sources row is open, it stays open. The screensaver, with `idle_clear_filters` on (the default), clears the same things and also closes that row.
- **Old configs.** `default_tab: search`, a saved Search tab or any "search" shortcut opens the Library tab with the keyboard up. `library_home: true` from 0.7.1 is ignored (no tiles). `library_layout: separate` brings back the 0.7.1 Library + Search tabs (tile home with `library_home: true`, the 0.7.1 chip row). On that Search tab the source buttons stay in a row under the box.

| Library artists, light theme | Library artists, dark theme |
|---|---|
| ![Library artists, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-artists-light-090-1024x712.png) | ![Library artists, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-artists-dark-090-1024x712.png) |

| Search in Abba with the Artist: Abba chip, light theme | Search in Abba with the Artist: Abba chip, dark theme |
|---|---|
| ![Search in Abba with the Artist: Abba chip, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-artist-clear-light-090-1024x712.png) | ![Search in Abba with the Artist: Abba chip, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-artist-clear-dark-090-1024x712.png) |

| Genre: Jazz filter, light theme | Genre: Jazz filter, dark theme |
|---|---|
| ![Genre: Jazz filter, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-genre-filter-light-090-1024x712.png) | ![Genre: Jazz filter, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-genre-filter-dark-090-1024x712.png) |

| Library track rows, light theme | Library track rows, dark theme |
|---|---|
| ![Library track rows, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-tracks-light-090-1024x712.png) | ![Library track rows, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-tracks-dark-090-1024x712.png) |

#### Library list details (all layouts)
- **Categories.** On the combined tab the buttons are the ones above. On the separate Library tab the chips are Playlists, Albums, Artists, Tracks, Radio, Podcasts and Audiobooks.
  - Each call is `music_assistant.get_library {config_entry_id, media_type, favorite?, limit, offset, order_by}` with `return_response`.
  - At start the card makes one `limit: 1` call per category and **hides the categories that are empty**, such as Radio, Podcasts and Audiobooks when the library has none.
- **Favorites and sort.** On the combined tab there is only the heart at the end of the category row, and no sort button (since 0.7.9). On the separate Library tab they stay in the bar above the list: a **Favorites** toggle, and a sort chip. The cycle is A–Z (`name`), then Recently added (`timestamp_added_desc`), then Recently played (`last_played_desc`). Radio starts on Popular (`play_count_desc`; `get_library` has no popularity order, so this is your own play count), then A–Z, Recently added and Recently played. Genres use A–Z and Recently added, and have no Favorites control.
- **Layout: rows or tiles.** Since 0.9.1 each part of the card has its own Rows or Tiles setting (`library_views`): each Library button (Playlists, Artists, Tracks, Genres, Radio, Albums, Podcasts and Audiobooks), the Queue, Discover, artist pages, album pages, playlist pages and search results. In the editor each one is **Show … as** (for example **Show Playlists as**), with the choices **Rows** and **Tiles**.
  - On a new setup, Playlists, Albums and Radio start as Tiles. Everything else starts as Rows.
  - **Rows** are list rows: a small square cover, the title, the line under it (such as the artist or the owner), the source badge, the heart, and an arrow where a tap opens a page. Rows have no row buttons. A tap or a press and hold does the same as on the matching tile.
  - **Tiles** are big covers in a grid. `library_columns` (**Tiles across** in the editor) sets how many tiles go across: a whole number from 1 to 8, default 3, and the card shows exactly that many. It counts for every part set to Tiles, and the editor always shows it. A number outside the range is brought to the nearest end (0 becomes 1, 9 becomes 8), a number with decimals is rounded (4.4 becomes 4), a number written in quotes such as "4" is accepted, and anything else, including an empty value, counts as 3. The editor does the same and drops a value that is not a number.
  - The Radio setting covers Favorites, More stations and the online Radio Browser station lists. The folders in Radio Browser stay rows. Podcast pages and the optional Library home screen stay as they were.
  - Queue as Tiles: every track in the queue is a tile in one grid. The track playing now is highlighted, tracks already played are dimmed, and the tracks under Up next carry their number.
  - Discover as Rows shows each Discover row as a list; as Tiles, as a grid. The side-scrolling strips of covers are gone. In both, Continue listening shows how far you are into each podcast episode or audiobook with a progress bar that is easy to read on any cover. In search results as Tiles, artists are round.
  - Older setups: the 0.7.20 `library_view` setting is not changed or removed. While it is set, all eight Library buttons follow it, unless you pick a different choice for one of them. It does not change the Queue, Discover, pages or search results. Saving in the editor stores only the choices you changed. A value other than `rows` or `tiles` is ignored. No setting stops the card from loading, whatever is typed.

  ```yaml
  library_views:
    playlist: tiles       # playlist, artist, track, genre, radio, album, podcast, audiobook,
    queue: rows           # queue, discover, artist_page, album_page, playlist_page, search
    discover: tiles
  library_columns: 4      # tiles across, 1 to 8, default 3
  ```

  Pages are cached per category, favorite and sort, and load more on scroll.
- **Tap never plays.** Artists, albums, playlists (and podcasts) open the detail view described under Search, with the same buttons and confirmations. On album, artist, playlist and podcast pages a tap or a press and hold on a track or episode opens the large pop-up (since 0.7.20; see below). On an artist page, press and hold an album row to open the pop-up for that album. **A tap on a track in the Tracks list opens the large pop-up** (since 0.7.13), the same one that pressing and holding the row opens, in both the combined and the older separate-tabs Library layout. The old small menu is gone for tracks. A tap on a track also opens the pop-up in Search results and in the Queue, and on track tiles in Discover rows. Since 0.7.20 a tap or a press and hold on a track or podcast episode on an artist, album, playlist or podcast page opens it too. It lists Add to queue, Play next, Play now, Start radio and More Info, then Cancel, the same as in the Tracks list (there is no Remove), and Play now and Start radio still ask first. A podcast episode has no Start radio. A radio station row on those pages is still only highlighted by a tap. A tap on a station opens the station panel with its details, a heart where allowed, Play and Close; Play asks "This will replace your queue" (Cancel / Play) when the queue has tracks. **Press and hold** (since 0.7.10) opens a large options panel with the item's art and name: Open (when the item has a page), Add to queue, Play next, Play now, Start radio, and Cancel. Since 0.7.12 Start radio is always listed on track, album, artist and playlist pop-ups; when that item can't start a radio it stays in its place, greyed, and does nothing. Podcast, episode and audiobook pop-ups have no Start radio. Tracks, podcast episodes and audiobooks also get **More Info**, just above Cancel (since 0.7.12). More Info changes the same pop-up to a details view; **Back** returns to the choices. It shows only what Music Assistant already sent with the item, and leaves out any line that is unknown. Tracks show Album, Year, Length, Source and Quality. Podcast episodes show Show, Episode (the episode number), Published (a date such as "Nov 1, 2026"), Length, Left, Source and Quality. Audiobooks show Author, Narrator, Publisher, Published, Length, Left, Source and Quality. Left is the time remaining, and only appears once you're partway through; it reads "Played" when the episode or book is finished. Episodes and audiobooks show no description. More Info is greyed and does nothing when no line other than Source has anything to show (a source on its own doesn't count). Album, artist, playlist, whole-podcast and station pop-ups have no More Info, and More Info is not a button on the rows. Stations get Open, Play now and Cancel. Since 0.7.12 every pop-up is only as tall as its buttons need and stays between the top bar and the bottom tab bar, with one shared button and text size, so all pop-ups look alike. The press-and-hold pop-up uses the same height ceiling as the others (the smaller of that ceiling and the space between the bars). If the choices would not fit, the buttons never shrink below 48 px; the art, text and gaps shrink instead. Cancel comes right after the last choice. Tap outside the panel or Cancel to close it.
- Tapping an audiobook in Library → Audiobooks opens a menu with Play Now, Play Next, Remove and Cancel.
- **Radio.** Browse > Radio lists `get_library {media_type: radio}`. Favorites appear first, followed by other library stations. If there are none, the card shows "No stations yet" with a **Search stations** button and a hint to search by name; it no longer fills the grid with a search for "radio". With `radio_favorites_only`, only favorites appear, and an empty list says "No favorite stations yet". Station names are trimmed (Radio Browser pads some with tabs), every station has a **Radio** badge, and a station with no logo or a dead logo gets a radio-tower image. A tap does not play the station: it opens the station panel with its details, a heart where allowed, Play and Close. Play asks "This will replace your queue" (Cancel / Play) when the queue has tracks, then sends `play_media {media_id: radiobrowser://radio/…, media_type: radio, enqueue: replace}` to your player (`entity`), never with `radio_mode`.
- **Drill-down.** The › button on artist, album and playlist tiles (or the › arrow at the end of their rows), or Open in the menu, opens a detail page:
  - a back button, Play, Shuffle, Add to queue and Start radio (`radio_mode: true`, tracks / artists / albums only), and a track list. Tapping or pressing and holding a track opens the pop-up (since 0.7.20; before that a tap only highlighted the row).
  - tracks come from `jukebox_kiosk/item_tracks {uri, page, page_size: 100}`. Each row shows its duration, and the header shows the count and total time ("9 tracks · 43 min", with "+" while more pages may follow)
  - long lists are paged by the server: the next page loads when you scroll to the end or tap **Load more tracks**
  - artists also get an Albums row from `music_assistant.search`
  - without the integration (native backend), albums and artists fall back to a search, labelled "matched by search", and playlists show a note that the integration is needed
- **Search's Open action** jumps to the same detail page.
- **Target.** Every `play_media` goes to the configured player (example: `media_player.everywhere`). Room players are volume targets.

| Library radio stations, light theme | Library radio stations, dark theme |
|---|---|
| ![Library radio stations, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-radio-light-090-1024x712.png) | ![Library radio stations, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-radio-dark-090-1024x712.png) |

### Favourites (hearts)

*(0.7)* With the Jukebox Kiosk backend, a heart sits on Search and Library rows and tiles (tracks, albums, artists, playlists, radio), on playlist rows and in the header of album, artist and playlist pages, on Now Playing and on the radio station sheet. A filled heart means the item is a Music Assistant favourite; tapping it adds or removes it through the integration (`music/favorites/add_item` / `remove_item`). Every heart for the same item updates at once.

- Needs the `library` permission class. Without it (for example a guest you removed it from) the hearts are hidden, including the one on Now Playing.
- No confirmation when you remove a heart. The heart flips immediately; if Music Assistant refuses or the call fails it flips back and the top-right status chip shows the error (with ✕). Successful changes show a short "Added … to favorites" in the same chip. There are no popups in the middle of the screen.
- `hearts: false` hides the 0.7 row, tile and page hearts.

| Library Radio with the favorites heart filter, light theme | Library Radio with the favorites heart filter, dark theme |
|---|---|
| ![Library Radio with the favorites heart filter, light theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-favorites-light-090-1024x712.png) | ![Library Radio with the favorites heart filter, dark theme](https://raw.githubusercontent.com/randybell/ha-jukebox-kiosk/main/docs/library-favorites-dark-090-1024x712.png) |

### Screensaver

- **Start.** After `screensaver_minutes` with no touches or keys, a full-screen overlay appears: the current art with a slow Ken Burns zoom, and a big clock, date and the current track, all drifting slowly (240 s loop) to avoid burn-in.
- **Reduced motion.** No zoom and no drift; the clock block jumps to a new spot every 60 s instead.
- **Portrait.** Since 0.8.2, in portrait the track (title and artist) is bigger and the clock is smaller, so what is playing leads; the date is a little bigger and a long title may take two lines.
- **Landscape clock.** Since 0.8.8 the clock in landscape is 10% smaller than before, with or without lyrics on the screensaver. Portrait is unchanged.
- **Clock and date.** Since 0.8.9 the clock, in the top bar and on the screensaver, follows the 12-hour or 24-hour setting and the time zone in your Home Assistant profile, the same way Home Assistant shows times. The screensaver date uses your profile's language and time zone too. The clock changes right on the minute (it used to update every 15 s, so it could be up to 15 s late).
- **Wake.** A tap wakes it. The tap is swallowed, so it never presses whatever is underneath, and the overlay fades out over 350 ms.

### How search behaves

- **Searches on every keystroke, backspace included, from 1 character.** There is no debounce and no minimum length.
- **The call:**
  ```
  hass.callService('music_assistant', 'search', {config_entry_id, name, limit, media_type: [artist, album, track, playlist, radio, audiobook, podcast]}, undefined, false, true)
  ```
- **Newer results always win.** Every request gets a sequence number, and a reply that is older than the results on screen is dropped. Dropped replies are still cached.
- **No blank flash.** The old results stay on screen until the new ones arrive. A thin hairline under the query bar shows a search is loading.
- **Cache.** Up to 100 queries are kept for 5 minutes (LRU). Backspacing back to an earlier query shows its results instantly, without a new call.
- **Slow Music Assistant.** If a reply takes more than `slow_ms` (800 ms), the card keeps one call in flight and queues only the latest query. Keystrokes in between are merged into that one.
- **Results.** They are grouped as Artists, Albums, Tracks, Playlists, Radio, Audiobooks and Podcasts, with filter chips. Genres is its own group and filter when Music Assistant can search them (on the combined tab, when Genres is among the category buttons; on the separate Search tab, when `search_categories` includes `genres`, or when those chips are unset). Radio and Podcasts stay separate. **Empty groups and their chips are hidden**, so Radio (when no radio provider answers), Audiobooks and Podcasts don't show. Radio items get a **Radio** badge, a 'Live radio' subtitle, and no Start radio action. Each item has a provider badge taken from its URI scheme, because MA items have no provider field (`library://…` → LIBRARY, `apple_music://…` and `apple_music--XXXXXXXX://…` → APPLE MUSIC).
- **Every result is a list row**: art (round for artists) or an icon, title, subtitle (provider badge, type, artist / album; on phones the track length joins the subtitle). Titles truncate with an ellipsis; rows are at least 56 px tall.
- **Row actions.** Tap or press and hold a row to open its pop-up. Each choice (Add to queue, Play next, Play now, Start radio) sends:

  | Button | What it sends | Confirmation |
  |---|---|---|
  | Add to queue | `play_media` with `enqueue: add` (to the end of the queue) | none; it runs at once |
  | Play next | `play_media` with `enqueue: next` | none; it runs at once |
  | Play now | `play_media` with `enqueue: replace` | "Replace the current queue? This clears what's playing for everyone." Cancel / Replace |
  | Start radio | `play_media` with `enqueue: replace, radio_mode: true` | "Start radio from “…”? This replaces the current queue for everyone." Cancel / Start radio |

  Start radio is listed for tracks, artists, albums and playlists. It is not listed for radio stations, podcasts, episodes and audiobooks. A radio station row opens the station panel; **Play** there asks "This will replace your queue" (Cancel / Play) when the queue has tracks. Add to queue and Play next send at once. Play now and Start radio send nothing until you confirm; Cancel, Esc or tapping outside sends nothing.
- **Tapping a row never plays.** An artist, album, playlist (or podcast) opens its detail view in place. Since 0.7.13 a tap on a track opens the large options panel described under Library, the same one that pressing and holding the row opens (before that the row was only highlighted). A station row opens the station panel, and an episode or audiobook row is only highlighted. Press and hold a row to open the panel for any kind of result.
- **Detail views** (from Search, Browse or Enter on the top result): Back, Play, Shuffle, Add to queue and, where the seed is supported, Start radio. Play and Shuffle replace the queue, so they ask first; Add to queue does not. Since 0.7.20 a tap or a press and hold on a track or podcast episode opens the large pop-up (Add to queue, Play next, Play now, Start radio for tracks, More Info, then Cancel; there is no Remove). Since 0.8.9 the Published date in More Info (podcast episodes and audiobooks) uses the language and time zone in your Home Assistant profile. A date with no time of day (such as `2026-11-09`, `2026-11` or `2026`) shows exactly as written in every time zone, so it no longer shows a day early. Press and hold an album row on an artist page to open the pop-up for that album. A tap on an album row inside an artist opens that album.
  - **Play** sends `play_media … enqueue: replace`; if the player is shuffling it first sends `media_player.shuffle_set {shuffle: false}` (awaited) so the list plays in order.
  - **Shuffle** sends `media_player.shuffle_set {shuffle: true}` to the player, waits for it, then `play_media … enqueue: replace`. Music Assistant applies the queue's shuffle flag as it loads the new items, so the whole album / playlist / artist plays in random order using documented services only (no client-side reordering of URIs).
  - Track lists come from the integration. Without it (native backend), albums and artists fall back to a search, labelled "matched by search" with a note; playlists say that the integration is needed for their tracks (Play / Shuffle still work).
- **Service call:** `music_assistant.play_media {media_id: <uri>, media_type, enqueue[, radio_mode]}` with target `{entity_id: <entity>}`.
- **Recents.** After a play or opening a detail view, the query is saved to localStorage (`jukebox-card:recents:v1`, up to 8). Tap a chip to search it again; hold a chip 0.7 s to remove it.
- **Hardware keyboard:**

  | Key | Action |
  |---|---|
  | Letters, digits, punctuation | Type (shown uppercase) |
  | Backspace | Delete a character |
  | Esc | Close the confirmation or menu, then leave a detail view, otherwise clear the query |
  | Enter | Open the top result's detail (or highlight a track); never plays |

  Ctrl, Alt and Meta shortcuts are ignored. Queue search takes the same keys since 0.7.13 (see [Queue](#queue)).
- **On-screen keyboard:**
  - Seven letter keys a row, or ten once ten 48 px keys fit (the same point that adds the digit row). Keys stay at least 48 px wide when they fit. On a short landscape card the key height comes from the room left, so the keys end above the tab bar. Since 0.8.2 the letters are one step bigger (and grow a little more on large landscape screens), and so are the words on the bottom row. Since 0.8.4 those words (`123`, Space and Clear) use the same text size and weight as the letters, and the backspace icon grows with them. `123` / `#+=` and backspace are a bit wider than before, Space is the widest key, and Space and Clear are a bit narrower to make room.
  - `123` / `#+=` switches to symbols.
  - Holding backspace clears the query.
  - Keys fire on release (pointerup), so a touch that slides off a key does not type.
  - On the combined Library tab the keyboard is always shown, on every screen size (no hide handle, no "Keyboard" button): the search box, the All sources button, the category buttons and the list sit around it, and a guest can just start typing. On short phones the keys get smaller and the status line under the search box is dropped so a row of the list stays visible. `library_keyboard: tap` is an optional fallback for small screens (see [Options](#options)).
  - With `library_keyboard: tap`, and on the separate (0.7.1) Search tab, you can hide the keyboard in portrait with its handle; a "Keyboard" button brings it back.
- **Focus.** No keyboard ever pops up: there is no input, textarea or contenteditable element anywhere. Every button is `tabindex=-1` and calls `preventDefault` on pointerdown, except the active bottom tab (0.5.0), which is the tab bar's one keyboard stop: ←/→/Home/End switch tabs. A focusin guard blurs anything editable.


**Radio, audiobooks and podcasts.** These groups (and their filter chips) are hidden whenever they come back empty. With Radio Browser in Music Assistant, stations appear in search results (`radiobrowser://radio/<uuid>`) and in Browse > Radio. Try it in the harness with `?radio=1` or `?radio=lib`.

### Lyrics

Lyrics come from Music Assistant's own metadata (its LRCLIB provider, with Genius as an optional fallback) through the Jukebox Kiosk integration; without it the lyrics surfaces say "Lyrics unavailable".

- **Lookup.** `jukebox_kiosk/ma {command: "music/item_by_uri", args: {uri}}`; lyrics are read from `metadata.lrc_lyrics` / `metadata.lyrics`. If both are empty the card calls `metadata/get_track_lyrics {track: <provider copy>}`, which answers `[plain, lrc]`.
- **Radio.** For a station, the card searches `music/search` for the stream's artist + title, takes the best track match (exact title first, then prefix; "(Live)" / "Remastered" variants rank below the plain title) and asks `get_track_lyrics` for it. Radio lyrics never seek.
- **Surfaces** (all share one store, so a track is looked up once):
  - **Art overlay**: the lyrics toggle at the top right of the art; remembered per device (`localStorage`, `jukebox-card:lyrics-overlay:v1`).
  - **Stage**: the expand button next to it opens a full-screen lyrics view (Fullscreen API, WebKit fallback, or a fixed overlay where fullscreen is not allowed). Tap to show the transport controls and ✕; Esc or ✕ closes it.
  - **Screensaver**: previous / current / next line for synced lyrics, a slow scroll for plain lyrics (`screensaver_lyrics`). With no lyrics to show, a small translucent status line ("No lyrics", "Lyrics unavailable", "Looking for lyrics…") sits under the track info and drifts with the clock.
- **Synced lyrics** highlight the current line from the interpolated player position (plus `lyrics_offset_ms`) and keep it centred. **Long-press** a line for 0.55 s to send `media_player.media_seek {seek_position}` to `entity`; the line flashes and a toast confirms it. A plain tap does nothing, so scrolling never seeks.
- **Plain lyrics** scroll in proportion to the track's progress and show an **Unsynced** chip. Scrolling by hand pauses the auto-scroll for a few seconds.
- **States**: "Looking for lyrics…", "No lyrics found", and "Lyrics unavailable". Failures back off for 60 s; there is never more than one lookup per track in flight.
- **Wait.** The card waits up to 60 s for a lookup. Since 0.8.9 the Jukebox Kiosk integration waits the same 60 s for Music Assistant's `metadata/get_track_lyrics` (first lookups can be slow); every other command still times out after 30 s.
- **Lyrics come only from Music Assistant.** The card fetches and displays them through Music Assistant and never stores or redistributes lyric text. Lyric text stays in memory (an LRU of 50 tracks) for the page session only, and a reload fetches it again. `localStorage` (`jukebox-card:lyrics:v2`, 100 tracks, keyed by URI or by `artist|title` for radio) only remembers "not found" markers, with no text, for 1 day. The old `jukebox-card:lyrics:v1` cache, which held lyric text, is deleted on load.
- **Look**: the current line is bold and bright, and the others are dimmer. On the Stage and the screensaver the text is white. The lyrics use your theme's font.

## Options

Entity ids in the [configuration example](#configuration) are examples. The defaults in this table are the card's defaults.

| key | default | |
|---|---|---|
| `entity` | *(required)* | Player for transport, its own volume slider, the queue and every `play_media`. Since 0.8.8 the editor's picker lists only Music Assistant players. A new card fills it in with the first Music Assistant player. Missing, or not a media player: the card shows "Specify an entity from within the media_player domain". Since 0.8.6 there is no default; before that it was `media_player.everywhere` |
| `rooms` | `[]` | `[{name, entity, icon?}]`, or bare entity ids (the name then comes from `friendly_name`). Each room gets its own volume slider. Since 0.8.8 the editor's picker lists only Music Assistant players |
| `screensaver_minutes` | `10` (0–1440) | Idle minutes before the screensaver. `0` turns it off. The editor offers Off, 1, 5, 10, 15, 30, 60 and Custom; any 0–1440 value from YAML still loads |
| `browse_limit` | `60` (1–500) | Items per Browse page (infinite scroll pages by `offset`) |
| `queue_limit` | `200` (1–1000) | Upcoming items requested from `jukebox_kiosk/queue_items` (`limit_after`); out-of-range values are clamped |
| `limit` | `8` (1–50) | Search results per type. 1-character queries always use 5 |
| `default_tab` | `now` | `now`, `browse`, `search` (separate layout only) or `queue`. An unknown tab is ignored and Now Playing opens |
| `library_only` | `false` | Search only the MA library |
| `search_filters` | `true` | v0.7 filters. An artist page in Search offers **Search in JJ Grey** (an album page: **Search in** that album); the next searches stay inside it, shown as a removable chip (`Artist: JJ Grey ✕`) with **Clear filters**. Tapping a genre adds a **Genre: <name>** chip the same way, and the results are that genre's artists, albums and tracks in your library. Library gets a **Filter** button (type to narrow the list) and **Filter by** on artist pages (that artist's albums / tracks). While that filter is on, the button reads **Clear filter by <artist>** and clears only the artist filter, in Library and in Search. Since 0.8.9 the Library's **Filter by** reads the artist's library albums and tracks 100 at a time, up to 1,000 of each, not just the first 100. `false` hides all of it: a genre row or tile is then plain text, with no Filter pill, and tapping it does nothing |
| `idle_clear_filters` | `true` | When the screensaver comes on (`screensaver_minutes`), the Search scope chips (`Artist: … ✕`) and the Library filters are cleared, so the next person starts from everything. `false` keeps them until ✕ / Clear filters |
| `library_first` | `true` | Search lists your library matches first ("In your library"), then provider results ("From your providers") with copies of library items removed. Applies to scoped searches too. `false` keeps Music Assistant's order |
| `slow_ms` | `800` | Search replies slower than this switch on in-flight limiting |
| `height` | fits the window | Card height. By default the card fills the space from its top edge to the bottom of the window (below the HA toolbar, minimum 320 px); set a fixed value such as `700px` to override |
| `scale` | `auto` | Large-screen zoom. `auto` scales the whole UI by min(width/1420, height/800) once that is ≥ 1.15 (1920x1080 → 1.35, capped at 1.8). A number forces it; `1` turns it off |
| `title` | `Jukebox` | Brand text in the header |
| `show_lyrics` | `true` | Master switch for lyrics: art overlay toggle, Stage and screensaver lyrics |
| `screensaver_lyrics` | `true` | Previous / current / next line (synced) or a slow scroll (plain) on the screensaver |
| `lyrics_seek` | `true` | Long-press (0.55 s) a synced line to seek there. Never on radio |
| `lyrics_offset_ms` | `500` (−5000–5000) | Shift for synced lyrics; positive shows lines sooner |
| `speaker_mode` | `fixed` | `fixed`: always play on `entity`; the Speakers panel is a volume mixer and a 0.4 config makes exactly the same calls. `dynamic`: pick where to play, group, move and use Music Assistant's group presets. See [Speakers](#speakers-050) |
| `targets` | all MA players | `dynamic` only: `[{entity, name?, members?}]` or entity ids the card may play on. Since 0.8.8 the editor's picker lists only Music Assistant players |
| `grouping` | `admins` | Who may group, pick the target, and use Move in the Speakers panel (not Move up or Move down on the queue): `admins`, `everyone` or `nobody`. This does not change the Queue pop-up: guests still get the same Play Now confirmation as admins, with Play Now greyed on the playing track, and the same Undo after Remove. **A UI lock, not security** |
| `grouping_users` | `[]` | Extra users (name or user id) treated like admins for the above |
| `guest_access` | `volume` | Everyone else in the Speakers panel: `volume` or `none` (read only) |
| `leader_drop` | `allow` | Dropping the leader of a playing group: `allow` (MA re-forms the group on the other rooms after about 6 s of silence; the panel shows "Regrouping…"), or `block` (hand off with Move) |
| `confirm_drop` | `false` | `true` asks in a centred dialog before a drop, a takeover or pausing the last room (the 0.6.3 behaviour). `false` (default) drops on tap and shows a small status chip top-right with Undo; a takeover or last-room question is asked in the chip |
| `hearts` | `true` | *(0.7)* A favourite heart on Search and Library rows and tiles, on playlist rows and on album, artist and playlist pages. See [Favourites (hearts)](#favourites-hearts). Needs the Jukebox Kiosk backend and the `library` class. `false` keeps the 0.6 hearts only (Search radio rows, the station sheet and Now Playing) |
| `radio_favorites_only` | `false` | *(0.7)* Browse › Radio **My stations** lists favourite stations only. Default: favourites first, then the other library stations |
| `library_keyboard` | `always` | *(0.7.3, combined Library tab)* `always`: the on-screen keyboard is always shown on every screen size. `tap`: optional fallback for small screens: in portrait and on phones the list shows first and tapping the search box opens the keyboard (landscape tablets keep it on the left either way) |
| `library_layout` | `combined` | *(0.7.2)* `combined`: one Library tab with the search box, the All sources button and the big category buttons (no Search tab). `separate`: the 0.7.1 Library + Search tabs |
| `library_categories` | `[playlist, artist, track, genre, radio]` | *(0.7.2)* Category buttons in order; also `album`, `podcast`, `audiobook` |
| `library_views` | see right | *(0.9.1)* `rows` or `tiles` for each part: `playlist`, `artist`, `track`, `genre`, `radio`, `album`, `podcast`, `audiobook`, `queue`, `discover`, `artist_page`, `album_page`, `playlist_page`, `search`. Unset = Tiles for `playlist`, `album` and `radio`, Rows for the rest. Any other value is ignored. In the editor: **Show … as**. See [Library](#library-search-and-browse-in-one-tab) |
| `library_view` | *(unset)* | *(0.7.20; older setups)* `rows` or `tiles` for all eight Library buttons at once. The editor no longer shows it and leaves it in place. A Library button with its own `library_views` choice follows that instead |
| `library_columns` | `3` | *(0.7.20; 1 to 8 since 0.9.1)* Tiles across, a whole number from 1 to 8, for every part set to Tiles. Numbers outside the range are brought to the nearest end, decimals are rounded, anything that is not a number counts as 3. In the editor: **Tiles across** |
| `search_sources` | `true` | *(0.7.2)* On the combined Library tab, the **All sources** button below the search box (All, Library, then your Music Assistant services; you can pick more than one). On the separate Search tab those buttons stay in a row under the box. `false` hides them. Jukebox Kiosk backend |
| `library_home` | `false` | *(0.7; only with `library_layout: separate`; was `true` in 0.7.1)* The Library tab opens on big shortcut tiles |
| `library_tiles` | see right | *(0.7; only with `library_layout: separate` and `library_home: true`)* Tiles in order: `playlist`, `artist`, `album`, `radio`, `search`, `track`, `podcast`, `audiobook`, `discover`; each an id or `{tile, label}`. An old `genre` tile is ignored (since 0.7.12). Unset = playlist, artist, album, radio, search (plus discover when `discover` is set) |
| `library_label` | `Library` | *(0.7)* The Library tab's name |
| `search_categories` | unset | *(0.7, off by default)* Search category chips, in order: `tracks`, `artists`, `albums`, `playlists`, `radio`, `podcasts`, `audiobooks`, and `genres`. `genres` is optional and is shown only when the backend can search genres. Unset keeps the 0.6 search, which also searches genres when the backend can. Radio and Podcasts stay separate |
| `search_default_category` | `all` | *(0.7)* Chip selected when Search opens |
| `discover` | off | *(0.7)* `true` or a list of Music Assistant recommendation rows (`recently_played`, `favorite_radio`, `provider:item_id`, ...) shown as a **Discover** tile in the Library (the first chip on Browse with `library_home: false`). Jukebox Kiosk backend only |
| `radio_browse` | off | *(0.7)* `true` or a list of `popular`, `country`, `language`, `tag`: "Stations by" modes on Library → Radio (Radio Browser provider). Since 0.8.9 these lists open the Radio Browser provider by the id in Music Assistant's provider list; if Music Assistant refuses that (for example for a guest), or lists no Radio Browser provider, the card uses the plain `radiobrowser://` path as before. Hidden on the native backend |
| `radio_country` | HA's country | *(0.7)* Two-letter code the Country mode opens on |

*(0.7.9)* `config_entry_id`, `favorite_entity`, `presets` and `backend` are gone: the card always finds the Music Assistant entry itself (through the integration, else an admin lookup), the heart always works out who adds the favourite, and the backend is always automatic. Leftover lines for them in YAML are simply ignored.

*(0.8.9)* `accent` and `font_base` are gone too. Neither did anything any more (`accent` had only `mono`, and `font_base` had done nothing since 0.8.0). Old setups that still have them keep loading; the card ignores them, and you can remove them.

*(0.9.0)* `show_action_icons` and `coerce_repeat_one` are gone. An old config that still has either one loads without an error; the keys are ignored, and the editor does not write them back.

The visual editor shows on-screen wording only. Top: **Player** and **Room volume sliders**. **Display**: Start tab (the bar's names: Now Playing, Library, Queue, plus Search in the separate layout), screensaver, screensaver lyrics. **Speakers** (see [Speakers](#speakers-050)). **Lyrics**: lyrics on/off, press-and-hold to jump, timing. **Search** and **Library** sections; in Library, the **Show … as** settings (Rows or Tiles for each part) come after the category buttons, then **Tiles across**. There is no Lyrics tab and no Autoplay switch (Now Playing and the Queue show the Autoplay button whenever Music Assistant supports it). Quiet hours were removed in 0.7.9.


## Known issues

- **Apple Music: removing a heart can mark the song as disliked.** In Music Assistant 2.10.9, un-favouriting an Apple Music item is sent to Apple Music as a *Dislike*. The card doesn't work around it; it is expected to be fixed in Music Assistant 2.11. Until then, remove Apple Music favourites in the Music app if this matters to you.
- While the status chip is asking a speakers question (for example "Garage stops what it is playing. · Add"), a heart message ("Added … to favorites", or a heart error) is held behind it. If the question is answered quickly the message shows afterwards; otherwise it is dropped. The heart itself (and a rollback after an error) still updates immediately.

## Planned for a later version

Not in 0.7.x: joining a speaker to a dynamic group so playback resumes on it, an admin form to add a radio station by URL, playlist dedupe, and "Playing from <playlist>" with a heart on Now Playing.

## Troubleshooting

- **The card says "Specify an entity from within the media_player domain".** The card has no player, or the one in `entity` is not a media player. Open the card's settings and pick one under **Player**, or add `entity:` with your player's id to the YAML. Since 0.8.6 the card no longer plays on `media_player.everywhere` by itself.
- **The card says "Entity not available:" and a player id.** The player in `entity` is not in Home Assistant (renamed or removed). Pick another one under **Player**. This is Home Assistant's own warning, so it shows in your Home Assistant language.
- **The card says "Custom element doesn't exist: jukebox-card".** Make sure Jukebox Kiosk is set up (not only installed), then reload the browser. Fully Kiosk may need **Clear cache**.
- **The card loads twice, or shows the old version.** An old `/hacsfiles/ha-jukebox-kiosk-card/jukebox-card.js` (or `/local/community/ha-jukebox-kiosk-card/jukebox-card.js`) resource is still there. See the Repairs issue, or delete it under **Settings → Dashboards → Resources**.
- **Play Now, Play Next, Move or Remove are greyed in the hold pop-up, or the heart or grouping is missing, for one user.** Move up is greyed on the track that is already next, and Move down on the last track; both are greyed on the playing track and on a track Music Assistant is already loading, and also when `queue_edit` is off. Play Now is greyed when `queue_play` is off. Guests follow the same greying as admins: `queue_edit` off greys only Move up and Move down; Play Next and Remove still work when `queue_play` is on. A missing heart means no `library` class (see [Permissions](#permissions)).
- **Lyrics say "Lyrics unavailable".** Music Assistant has no lyrics provider enabled, or the user lacks `read`. Music Assistant won't fetch lyrics for library tracks, so the card asks for the provider copy of the track.
- **No album art.** The card never loads the player's absolute `entity_picture` (mixed content on https). It uses `entity_picture_local`, then a relative `entity_picture`, then the queue item's image (https, or plain http on a plain http dashboard). A picture that fails to load is skipped for the rest of that track and tried again on the next one.

## License

[MIT License](LICENSE). Copyright (c) 2026 Randy Bell.

The icon path data is Apache-2.0 (Google Material Icons), not MIT. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists everything bundled, with full license texts.

### Credits

- **[Music Assistant](https://music-assistant.io)** ([GitHub](https://github.com/music-assistant)) does the real work: library, players, search, queue and metadata. Jukebox Kiosk talks to it through the official [Home Assistant integration](https://www.home-assistant.io/integrations/music_assistant/) and [music-assistant-client](https://github.com/music-assistant/client).
- **[Home Assistant](https://www.home-assistant.io)**: the platform and dashboard.
- **Lyrics**: [LRCLIB](https://lrclib.net) (and optionally [Genius](https://genius.com)) are Music Assistant metadata providers. Music Assistant fetches the lyrics, and neither the integration nor the card contacts them. Lyrics remain the copyright of their owners.
- **Inspiration**: [mass_queue](https://github.com/droans/mass_queue) (Music Assistant Queue Actions) by [droans](https://github.com/droans), which powered the card up to 0.5.x and shaped this API, and **Kiosk MA Cards**. No code from either is included.
- **[Lit](https://lit.dev)** by Google LLC, BSD-3-Clause, is bundled into `jukebox-card.js`.
- **Icons**: the UI glyph paths come from, or are adapted from, [Google Material Icons](https://github.com/google/material-design-icons) (Apache-2.0); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This project is not affiliated with or endorsed by Music Assistant, Home Assistant, WiiM, Apple or Genius. All trademarks belong to their owners.

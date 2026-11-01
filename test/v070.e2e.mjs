// v0.7 Discover & Search e2e: search categories (genres, podcasts, audiobooks), genre detail, radio "Stations by…" and the
// Discover rows, on the kiosk backend (dev/mock-kiosk.js + dev/mock-v07.js). Every flag is off by default; placeholder data only.
// Usage: (serve the project root) JB_URL=http://127.0.0.1:8797/dev/index.html node test/v070.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';

const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const ALL = { search_categories: ['tracks', 'artists', 'albums', 'playlists', 'radio', 'podcasts', 'audiobooks', 'genres'], radio_browse: true, discover: true };

async function open(query = '', cfg = {}, vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.goto(`${BASE}?fresh=1&latency=30&kiosk=1&pods=1&radio=1${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await page.waitForFunction('window.__ready === true');
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jukebox-card:rb:')).forEach((k) => localStorage.removeItem(k)));
  await sleep(200);
  return page;
}
async function tap(page, expr) {
  const r = await page.evaluate((expr) => { const el = eval(expr); if (!el) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(80);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
const maOf = (page, cmd) => page.evaluate((cmd) => window.__ws.filter((m) => m.type === 'ma' && m.command === cmd).map((m) => ({ ...m.args })), cmd);
const plays = (page) => page.evaluate(() => window.__calls.filter((c) => c.service === 'play_media').length);
const typeQ = async (page, q) => { await page.keyboard.type(q, { delay: 40 }); await sleep(400); };

// ---------------- 1. flags off: nothing new ----------------
{
  const p = await open('&tab=browse');
  await wait(p, `${BR}.querySelectorAll('.tile').length > 0`);
  const cats = await ev(p, `[...${BR}.querySelectorAll('.cats .fc')].map((b) => b.dataset.cat)`);
  check('F1 defaults: no Discover chip, no Stations-by row, no v0.7 MA reads', !cats.includes('discover') && !(await ev(p, `!!${BR}.querySelector('.modes')`))
    && (await maOf(p, 'music/recommendations')).length === 0 && (await maOf(p, 'music/browse')).length === 0, J(cats));
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  check('F2 defaults: Radio has no mode chips', !(await ev(p, `!!${BR}.querySelector('.modes')`)));
  await p.close();
}
// ---------------- 2. search categories ----------------
{
  const p = await open('&tab=search', ALL);
  await typeQ(p, 'r');
  await wait(p, `${SV}.querySelectorAll('.cats .fc').length > 0`);
  const chips = await ev(p, `[...${SV}.querySelectorAll('.cats .fc')].map((b) => b.dataset.cat)`);
  check('S1 chips: All + the configured categories in order', J(chips) === J(['all', ...ALL.search_categories]), J(chips));
  const g = await maOf(p, 'music/search');
  check('S2 genres searched over MA (media_types [genre], library_only) from the first character', g.some((a) => J(a.media_types) === J(['genre']) && a.library_only === true && a.search_query.toLowerCase() === 'r'), J(g));
  await typeQ(p, 'ock');
  await wait(p, `${SV}.querySelector('.row[data-group="genres"]')`);
  await tap(p, `${SV}.querySelector('.cats .fc[data-cat="genres"]')`);
  const rows = await ev(p, `[...${SV}.querySelectorAll('.row[data-group="genres"]')].map((r) => r.querySelector('b').textContent.trim())`);
  check('S3 Genres chip shows only genre rows ("Rock")', rows.includes('Rock') && (await ev(p, `${SV}.querySelectorAll('.row:not([data-group="genres"])').length`)) === 0, J(rows));
  const n0 = await plays(p);
  await tap(p, `${SV}.querySelector('.row[data-group="genres"]')`);
  await wait(p, `${SD}?.querySelector('.list.sec')`);
  const ov = await maOf(p, 'music/genres/overview');
  check('G1 tapping a genre opens its detail (never plays), overview {item_id, library, limit 12}',
    (await plays(p)) === n0 && ov.length === 1 && ov[0].item_id === '1' && ov[0].provider_instance_id_or_domain === 'library' && ov[0].limit === 12, J(ov));
  const secs = await ev(p, `[...${SD}.querySelectorAll('.list.sec')].map((s) => s.dataset.sec)`);
  check('G2 sections Artists / Albums / Playlists, tracks list, header with the genre icon and no Play/Shuffle',
    J(secs) === J(['artist', 'album', 'playlist']) && (await ev(p, `${SD}.querySelectorAll('.row[data-uri]').length`)) > 0
    && (await ev(p, `!!${SD}.querySelector('.dart.gen')`)) && (await ev(p, `${SD}.querySelectorAll('.da').length`)) === 0, J(secs));
  const more = await ev(p, `[...${SD}.querySelectorAll('button')].find((b) => /See all tracks/.test(b.textContent))?.textContent.trim()`);
  check('G3 "See all tracks" button; no music/genres/tracks before it is tapped', !!more && (await maOf(p, 'music/genres/tracks')).length === 0, more);
  await tap(p, `[...${SD}.querySelectorAll('button')].find((b) => /See all tracks/.test(b.textContent))`);
  await wait(p, `window.__ws.some((m) => m.command === 'music/genres/tracks')`);
  const gt = await maOf(p, 'music/genres/tracks');
  check('G4 See all tracks → music/genres/tracks {item_id, limit 100, offset 0}', gt[0]?.item_id === '1' && gt[0]?.limit === 100 && gt[0]?.offset === 0, J(gt));
  await tap(p, `${SD}.querySelector('.list.sec[data-sec="artist"] .row')`);
  await wait(p, `${SD}?.querySelector('h2')?.textContent && !/Rock/.test(${SD}.querySelector('h2').textContent)`);
  check('G5 tapping an artist inside the genre drills further (no play)', (await plays(p)) === n0 && (await ev(p, `${SV}.querySelector('jb-detail').trail.length`)) === 2);
  await p.close();
}
// ---------------- 3. podcasts & audiobooks categories; genres need the flag + backend ----------------
{
  const p = await open('&tab=search', { search_categories: ['tracks', 'podcasts', 'audiobooks'] });
  await typeQ(p, 'mock');
  await wait(p, `${SV}.querySelector('.row[data-group="podcasts"]')`);
  const groups = await ev(p, `[...new Set([...${SV}.querySelectorAll('.row')].map((r) => r.dataset.group))]`);
  check('S4 podcasts + audiobooks found; nothing outside the configured categories', groups.every((x) => ['tracks', 'podcasts', 'audiobooks'].includes(x)) && groups.includes('audiobooks'), J(groups));
  check('S5 no genre search when genres is not listed', (await maOf(p, 'music/search')).every((a) => J(a.media_types) !== J(['genre'])));
  await p.close();
  const q = await open('&tab=search&kcaps=' + encodeURIComponent(J({ genres: false })), ALL);
  await typeQ(q, 'ro');
  await sleep(300);
  check('S6 backend without genres: no Genres chip, no genre search', !(await ev(q, `!!${SV}.querySelector('.cats .fc[data-cat="genres"]')`)) && (await maOf(q, 'music/search')).every((a) => J(a.media_types) !== J(['genre'])));
  await q.close();
}
// ---------------- 4. radio "Stations by…" ----------------
{
  const p = await open('&tab=browse', { radio_browse: ['popular', 'country', 'tag'], radio_country: 'de' });
  await wait(p, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await wait(p, `${BR}.querySelector('.modes')`);
  const modes = await ev(p, `[...${BR}.querySelectorAll('.modes .fc')].map((b) => b.dataset.rmode)`);
  check('R1 mode chips: My stations + configured modes in order', J(modes) === J(['library', 'popular', 'country', 'tag']), J(modes));
  await tap(p, `${BR}.querySelector('.modes .fc[data-rmode="popular"]')`);
  await wait(p, `${BR}.querySelectorAll('.grid.radio .tile').length > 0`);
  const b1 = await maOf(p, 'music/browse');
  check('R2 Popular → music/browse radiobrowser://popularity/popular, stations as tiles, no Favorites/sort', b1.at(-1)?.path === 'radiobrowser://popularity/popular'
    && (await ev(p, `${BR}.querySelectorAll('.grid.radio .tile').length`)) === 24 && !(await ev(p, `!!${BR}.querySelector('.fc.sort')`)), J(b1));
  const names = await ev(p, `[...${BR}.querySelectorAll('.grid.radio .tile b')].map((b) => b.textContent)`);
  check('R3 station names trimmed, ".." never shown', names.every((n) => n === n.trim() && n !== '..'));
  const n0 = await plays(p);
  await tap(p, `${BR}.querySelector('.grid.radio .tile')`);
  await wait(p, `${BR}.querySelector('.menu')`, 1500);
  check('R4 tapping a station opens the action sheet (Play now only, no queue actions), does not play yet',
    (await plays(p)) === n0 && J(await ev(p, `[...${BR}.querySelectorAll('.menu .mi')].map((b) => b.dataset.action)`)) === J(['play', 'cancel']));
  await tap(p, `${BR}.querySelector('.menu [data-action="cancel"]')`);
  await tap(p, `${BR}.querySelector('.modes .fc[data-rmode="country"]')`);
  await wait(p, `/Stations in/.test(${BR}.querySelector('.rbt')?.textContent ?? '')`);
  const b2 = await maOf(p, 'music/browse');
  check('R5 Country opens the default (radio_country de) straight away', b2.at(-1)?.path === 'radiobrowser://category/country/de' && /Germany/.test(await ev(p, `${BR}.querySelector('.rbt').textContent`)), J(b2.at(-1)));
  await tap(p, `${BR}.querySelector('[data-action="rb-change"]')`);
  await wait(p, `${BR}.querySelectorAll('.row.fold').length > 5`);
  check('R6 Change → the country list (folders, no "..")', (await maOf(p, 'music/browse')).at(-1)?.path === 'radiobrowser://category/country'
    && !(await ev(p, `[...${BR}.querySelectorAll('.row.fold b')].some((b) => b.textContent === '..')`)));
  await tap(p, `${BR}.querySelector('.row.fold[data-path$="/jp"]')`);
  await wait(p, `/Japan/.test(${BR}.querySelector('.rbt')?.textContent ?? '') && ${BR}.querySelectorAll('.grid.radio .tile').length > 0`);
  check('R7 picking a country lists its stations', (await maOf(p, 'music/browse')).at(-1)?.path === 'radiobrowser://category/country/jp');
  await tap(p, `${BR}.querySelector('.modes .fc[data-rmode="tag"]')`);
  await wait(p, `${BR}.querySelectorAll('.tagc .fc').length > 5`);
  await tap(p, `${BR}.querySelector('.tagc .fc[data-path$="/jazz"]')`);
  await wait(p, `/jazz/.test(${BR}.querySelector('.rbt')?.textContent ?? '') && ${BR}.querySelectorAll('.grid.radio .tile').length > 0`);
  check('R8 Tag: chips → stations for the tag', (await maOf(p, 'music/browse')).at(-1)?.path === 'radiobrowser://category/tag/jazz');
  const nb = (await maOf(p, 'music/browse')).length;
  await tap(p, `${BR}.querySelector('.modes .fc[data-rmode="popular"]')`);
  await wait(p, `${BR}.querySelectorAll('.grid.radio .tile').length === 24`);
  check('R9 listings are cached (24 h): Popular again makes no MA call', (await maOf(p, 'music/browse')).length === nb, `${nb} → ${(await maOf(p, 'music/browse')).length}`);
  check('R10 cache in localStorage under jukebox-card:rb:v1:', await ev(p, `Object.keys(localStorage).some((k) => k === 'jukebox-card:rb:v1:radiobrowser://popularity/popular')`));
  await tap(p, `${BR}.querySelector('.modes .fc[data-rmode="library"]')`);
  await wait(p, `${BR}.querySelector('.fc.sort')`);
  check('R11 My stations returns to the library list with Favorites + sort', await ev(p, `!!${BR}.querySelector('.fc[data-cat="favorites"]')`));
  await p.close();
}
{
  const p = await open('&tab=browse&rbfail=1', { radio_browse: true });
  await tap(p, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(p, `${BR}.querySelector('.modes .fc[data-rmode="popular"]')`);
  await wait(p, `${BR}.querySelector('.rberr')`);
  check('R12 Radio Browser down, no cached copy → error + Retry', await ev(p, `!!${BR}.querySelector('[data-action="rb-retry"]')`));
  await p.close();
  const q = await open('&tab=browse', { radio_browse: true });
  await q.evaluate(() => localStorage.setItem('jukebox-card:rb:v1:radiobrowser://popularity/popular', JSON.stringify({ t: 1, d: { folders: [], stations: [{ media_type: 'radio', uri: 'radiobrowser://radio/00000000-0000-0000-0000-000000000001', name: 'Saved Placeholder FM' }] } })));
  await q.goto(q.url().replace('&tab=browse', '&tab=browse&rbfail=1').replace('fresh=1', 'fresh=0'));
  await q.waitForFunction('window.__ready === true');
  await tap(q, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  await tap(q, `${BR}.querySelector('.modes .fc[data-rmode="popular"]')`);
  await wait(q, `${BR}.querySelector('.grid.radio .tile')`);
  check('R13 refresh fails → the stale saved list is shown (+ toast)', /Saved Placeholder FM/.test(await ev(q, `${BR}.querySelector('.grid.radio').textContent`))
    && /saved list/.test(await ev(q, `${BR}.textContent`) ?? ''));
  await q.close();
  const g = await open('&tab=browse&kcaps=' + encodeURIComponent(J({ radio_browse: false })), { radio_browse: true });
  await tap(g, `${BR}.querySelector('.cats .fc[data-cat="radio"]')`);
  check('R14 backend without radio_browse: no mode chips', !(await ev(g, `!!${BR}.querySelector('.modes')`)));
  await g.close();
}
// ---------------- 5. Discover ----------------
{
  const p = await open('&tab=browse', { discover: true });
  await wait(p, `${BR}.querySelector('.drow')`);
  const cats = await ev(p, `[...${BR}.querySelectorAll('.cats .fc')].map((b) => b.dataset.cat)`);
  check('D1 Discover is the first chip and selected by default', cats[0] === 'discover' && (await ev(p, `${BR}.querySelector('.cats .fc.on')?.dataset.cat`)) === 'discover', J(cats));
  await wait(p, `[...${BR}.querySelectorAll('.drow')].some((r) => r.querySelector('.hs:not(.skel) .tile'))`);
  const rows = await ev(p, `[...${BR}.querySelectorAll('.drow')].map((r) => r.dataset.row)`);
  check('D2 default rows in order (library rows, missing ones skipped)', J(rows) === J(['in_progress', 'recently_played', 'recently_added_albums', 'favorite_playlists', 'favorite_radio', 'random_albums', 'most_played_tracks']), J(rows));
  const its = await maOf(p, 'music/recommendations/items');
  check('D3 rows load lazily: not every row fetched at once at 800 px tall', its.length >= 1 && its.length < rows.length && its.every((a) => a.provider === 'recommendations'), J(its));
  await ev(p, `${BR}.querySelector('.scroll').scrollTo({ top: 99999 })`);
  await wait(p, `window.__ws.filter((m) => m.command === 'music/recommendations/items').length >= 7`);
  check('D4 scrolling loads the remaining rows', (await maOf(p, 'music/recommendations/items')).length === 7);
  check('D5 one music/recommendations call (rows cached)', (await maOf(p, 'music/recommendations')).length === 1);
  const rp = await ev(p, `[...${BR}.querySelectorAll('.drow[data-row="in_progress"] .rp')].map((x) => x.getAttribute('aria-valuenow'))`);
  check('D6 Continue listening shows resume progress', rp.length >= 2 && rp.includes('35') && rp.includes('67'), J(rp));
  const n0 = await plays(p);
  await ev(p, `${BR}.querySelector('.scroll').scrollTo({ top: 0 })`); await sleep(100);
  await tap(p, `${BR}.querySelector('.drow[data-row="recently_added_albums"] .tile')`);
  await wait(p, `${BD}?.querySelector('h2')`);
  check('D7 album tile opens the detail, never plays', (await plays(p)) === n0 && (await ev(p, `${BR}.querySelector('jb-detail').trail[0]`)) === 'Browse Discover');
  await p.close();
}
{
  const p = await open('&tab=browse', { discover: ['favorite_radio', 'mock_stream--XXXXXXXX:stations_for_you', 'never_played_tracks', 'no_such_row'] });
  await wait(p, `${BR}.querySelectorAll('.drow .hs:not(.skel)').length >= 2`, 6000);
  await sleep(300);
  const rows = await ev(p, `[...${BR}.querySelectorAll('.drow')].map((r) => r.dataset.row)`);
  check('D8 custom list: provider:id rows, empty rows hidden, unknown rows skipped', J(rows) === J(['favorite_radio', 'stations_for_you']), J(rows));
  await p.close();
  const q = await open('&tab=browse&recfail=1', { discover: true });
  await wait(q, `/Discover unavailable/.test(${BR}.textContent)`);
  check('D9 recommendations fail → message + Retry', await ev(q, `!!${BR}.querySelector('[data-action="disc-retry"]')`));
  await q.close();
  const e = await open('&tab=browse&v07=empty', { discover: true });
  await ev(e, `${BR}.querySelector('.scroll').scrollTo({ top: 99999 })`);
  await wait(e, `/Nothing to discover yet/.test(${BR}.textContent)`, 6000);
  check('D10 every row empty → "Nothing to discover yet"', /Nothing to discover yet/.test(await ev(e, `${BR}.textContent`)));
  await e.close();
  const k = await open('&tab=browse&kcaps=' + encodeURIComponent(J({ discover: false })), { discover: true });
  await wait(k, `${BR}.querySelectorAll('.tile').length > 0`);
  check('D11 backend without discover: chip hidden, library category shown', !(await ev(k, `!!${BR}.querySelector('.fc[data-cat="discover"]')`)) && (await maOf(k, 'music/recommendations')).length === 0);
  await k.close();
  const m = await open('&tab=browse', { discover: true }, { width: 390, height: 844 });
  await wait(m, `${BR}.querySelector('.drow .hs:not(.skel) .tile')`);
  const w = await ev(m, `${BR}.querySelector('.drow .hs .tile').getBoundingClientRect().width`);
  const ov = await ev(m, `document.documentElement.scrollWidth <= 390`);
  check('D12 phone: compact tiles, rows scroll sideways, no page overflow', w < 130 && ov, String(w));
  await m.close();
}
// ---------------- 6. Autoplay ("don't stop the music") prototype, flag show_autoplay ----------------
{
  const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
  const NV = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
  const AP = encodeURIComponent(J({ autoplay: true }));
  // flag off (default): no pill even when the server supports it
  const a = await open('&tab=queue&kcaps=' + AP);
  await wait(a, `${QV}.querySelectorAll('.qr').length > 0`);
  check('AP1 default (show_autoplay off): no Autoplay pill', !(await ev(a, `!!${QV}.querySelector('.ap')`)));
  await a.close();
  // flag on, server without autoplay: still hidden
  const b = await open('&tab=queue', { show_autoplay: true });
  await wait(b, `${QV}.querySelectorAll('.qr').length > 0`);
  check('AP2 show_autoplay on but server lacks it: hidden', !(await ev(b, `!!${QV}.querySelector('.ap')`)));
  await b.close();
  // flag on + server: pill off -> tap -> on, set_autoplay sent for the card's entity; Now Playing shows the indicator
  const c = await open('&tab=queue&kcaps=' + AP, { show_autoplay: true });
  const shown = await wait(c, `${QV}.querySelector('.ap')`);
  check('AP3 pill shown, off, aria-pressed=false', shown && (await ev(c, `${QV}.querySelector('.ap').getAttribute('aria-pressed')`)) === 'false');
  await tap(c, `${QV}.querySelector('.ap')`);
  await wait(c, `${QV}.querySelector('.ap.on')`);
  const sent = await c.evaluate(() => window.__ws.filter((m) => m.type === 'set_autoplay').map((m) => ({ e: m.entity_id, on: m.enabled })));
  check('AP4 tap → jukebox_kiosk/set_autoplay {enabled: true}, pill on, no raw ma command',
    sent.length === 1 && sent[0].on === true && /^media_player\./.test(sent[0].e) && (await maOf(c, 'player_queues/autoplay')).length === 0, J(sent));
  await tap(c, `__card.shadowRoot.querySelector('.tab[data-tab="now"]')`);
  const ind = await wait(c, `/Autoplay/.test(${NV}.querySelector('.upn')?.textContent ?? '')`);
  check('AP5 Now Playing: "Up next · Autoplay" indicator only (no 7th transport button)', ind
    && !(await ev(c, `!!${NV}.querySelector('.tb[aria-label*="Autoplay"]')`)), String(await ev(c, `${NV}.querySelector('.upn')?.textContent?.replace(/\\s+/g, ' ')`)));
  await c.close();
}
check('no page errors', pageErrors.length === 0, J(pageErrors.slice(0, 3)));
await browser.close();
console.log(`\n${total - failures}/${total} v0.7 checks passed`);
process.exit(failures ? 1 : 0);

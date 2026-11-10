// 0.7.14 (issue #81, Randy's rule): a tap on a song (track) never opens the old small anchored menu (Play Now / Play Next / Remove / Cancel).
// Where a tap opens anything it is the big pop-up (jb-hold-sheet), the same one a hold opens. Audit of every track list a tap can land on,
// 1024x600, touch tap and mouse click (+ the physical Esc key closing the pop-up):
//   ARTIST-FILTER  Library > artist page > "Filter by <artist>" > Tracks (the artist-scoped Songs list)
//   DISCOVER       a track tile in a Library Discover row (Most played tracks)
//   ARTIST / ALBUM / PLAYLIST pages  a tap or hold on a track row opens the same pop-up as Library Tracks (0.7.20); Esc closes it and
//                                    clears the row highlight; nothing plays by itself and the old small menu never shows
// Together with library-song-tap (Library list, Favorites), song-tap-pages (Queue, Queue search, Library search) and search-tap this covers every
// track-row tap path. In every case: the old menu (.menu) never shows, and the tap plays and changes nothing by itself.
// Usage: node test/track-tap-audit.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes the screenshots.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); };
const J = JSON.stringify;
const SHOTS = process.env.SHOTS;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const effects = (p) => ev(p, `[...(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => 'play:' + c.data.enqueue),
  ...(window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /^player_queues\\//.test(m.command)).map((m) => m.command)]`);
const clear = (p) => ev(p, `window.__calls = []; window.__mark = (window.__ws || []).length`);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const sheetOf = (p) => ev(p, `(() => { const r = ${HS}, sh = r.querySelector('.sh'); if (!sh) return null;
  return { uri: r.host.state?.item?.uri, items: [...sh.querySelectorAll('.it')].map((b) => b.dataset.action + ':' + b.textContent.trim() + (b.classList.contains('off') ? ':off' : '')) }; })()`);
// the old small menu is a .menu element in whichever view hosts the list (and in the card-level sheet root)
const oldMenu = (p) => ev(p, `(() => { const q = (r) => { try { return !!r?.querySelector('.menu'); } catch { return false; } };
  const roots = [${SV}, ${HS}]; try { roots.push(${BR}) } catch {} try { roots.push(${SV}.querySelector('jb-browse').shadowRoot) } catch {} try { roots.push(${BD}) } catch {} try { roots.push(${SD}) } catch {}
  return roots.some(q); })()`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function tapAt(p, kind, c) { if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); }
async function holdAt(p, kind, c, ms = 700) {
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(ms); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(ms); await p.mouse.up(); }
  await sleep(350);
}
const rowHeld = (p, row) => ev(p, `!!(${row})?.classList.contains('held')`);
const newPage = async (url) => {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1${url}`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  return p;
};
const wait = (p, expr, timeout = 8000) => p.waitForFunction((e) => !!eval(e), { timeout }, expr).then(() => true, () => false);
const clickAt = async (p, expr) => { await ev(p, `${expr}.scrollIntoView({ block: 'center' })`); await sleep(250); const c = await center(p, expr); if (!c) throw new Error('nothing at ' + expr); await p.mouse.click(c.x, c.y); await sleep(700); };
const typeOnScreen = async (p, kbExpr, text) => {
  for (const ch of text) { const c = await center(p, `[...${kbExpr}.shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`); await p.touchscreen.tap(c.x, c.y); await sleep(120); }
  await sleep(500);
};

// ---- setups: each returns { p, row (expr of the track row/tile), at (expr of the spot to tap) } ----
const SETUPS = {
  'ARTIST-FILTER': async () => {
    const p = await newPage('&layout=separate&jjgrey=1&tab=browse&lhome=0');
    await wait(p, `${BR}.querySelector('.cats .fc[data-cat="artist"]')`);
    await clickAt(p, `${BR}.querySelector('.cats .fc[data-cat="artist"]')`);
    await wait(p, `${BR}.querySelector('.tile[data-type="artist"]')`);
    await clickAt(p, `[...${BR}.querySelectorAll('.tile[data-type="artist"]')].find((x) => x.querySelector('b').textContent === 'JJ Grey')`);
    await wait(p, `${BD}?.querySelector('[data-action="scope"]')`);
    await clickAt(p, `${BD}.querySelector('[data-action="scope"]')`);
    await clickAt(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
    await wait(p, `${BR}.querySelectorAll('.list[data-scope="artist"] .row[data-type="track"]').length > 1`);
    const row = `${BR}.querySelectorAll('.list[data-scope="artist"] .row[data-type="track"]')[1]`;
    return { p, row, at: `${row}.querySelector('.rt')`, opens: true };
  },
  'DISCOVER': async () => {
    const p = await newPage(`&layout=separate&tab=browse&lhome=0&cfg=${encodeURIComponent(J({ discover: true }))}`);
    await wait(p, `${BR}.querySelector('.drow')`);
    await ev(p, `${BR}.querySelector('.scroll').scrollTo({ top: 99999 })`);
    await wait(p, `${BR}.querySelector('.drow[data-row="most_played_tracks"] .hs:not(.skel) .tile')`);
    const row = `${BR}.querySelector('.drow[data-row="most_played_tracks"] .hs .tile[data-type="track"]') || ${BR}.querySelector('.drow[data-row="most_played_tracks"] .hs .tile')`;
    return { p, row, at: row, opens: true };
  },
};
// artist / album / playlist pages reached from Library search (EAGLES): a tap on a track row inside the page
for (const [name, sel] of [['ARTIST-PAGE', 'artist'], ['ALBUM-PAGE', 'album'], ['PLAYLIST-PAGE', 'playlist']]) {
  SETUPS[name] = async () => {
    const p = await newPage(`&tab=browse&cfg=${encodeURIComponent(J({ library_categories: ['playlist', 'artist', 'album', 'track'] }))}`);
    const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
    await typeOnScreen(p, `${SV}.querySelector('jb-keyboard')`, 'EAGLES');
    await wait(p, `${SV}.querySelector('.row .ra-b[data-act="add"]')`);
    if (sel !== 'playlist') {
      await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*${sel}s\\s*$/i.test(x.textContent))?.click()`); await sleep(600);
    }
    await wait(p, `${SV}.querySelector('.row[data-type="${sel}"]')`);
    await clickAt(p, `${SV}.querySelector('.row[data-type="${sel}"] .rt')`);
    await wait(p, `${SD}?.querySelectorAll('.row[data-type="track"]').length > 0`);
    const row = `${SD}.querySelectorAll('.row[data-type="track"]')[0]`;
    return { p, row, at: `${row}.querySelector('.rt')`, opens: true, hold: true };
  };
}

for (const name of Object.keys(SETUPS)) for (const kind of ['touch', 'mouse']) {
  const tag = `1024x600 ${name}, ${kind === 'touch' ? 'tap' : 'click'}`;
  let setup;
  try { setup = await SETUPS[name](); } catch (e) { check(`${tag}: screen set up`, false, e.message); continue; }
  const { p, row, at, opens, hold } = setup;
  await ev(p, `(${row}).scrollIntoView({ block: 'center' })`); await sleep(250);
  check(`${tag}: a track row is on screen, no pop-up and no old menu yet`, !!(await center(p, row)) && !(await sheetOpen(p)) && !(await oldMenu(p)));
  await clear(p);
  const c = await center(p, at);
  await tapAt(p, kind, c); await sleep(150);
  const s = await sheetOf(p);
  const menuNow = await oldMenu(p);
  await sleep(450);
  check(`${tag}: the old small menu never shows (not on the tap, not after)`, !menuNow && !(await oldMenu(p)), String(menuNow));
  check(`${tag}: the tap plays and changes nothing by itself`, J(await effects(p)) === '[]', J(await effects(p)));
  if (opens) {
    check(`${tag}: the tap opens the big pop-up (jb-hold-sheet) and it stays open`, !!s && (await sheetOpen(p)), J(s));
    if (hold) check(`${tag}: the tapped row stays highlighted while the pop-up is open`, await rowHeld(p, row));
    await shot(p, `0720-tap-${name.toLowerCase()}-${kind}`);
    // physical keyboard: Esc closes the pop-up, nothing played, highlight clears
    await p.keyboard.press('Escape'); await sleep(400);
    check(`${tag} + physical Esc: the pop-up closes, nothing played`, !(await sheetOpen(p)) && J(await effects(p)) === '[]', J(await effects(p)));
    if (hold) check(`${tag} + physical Esc: the row highlight clears`, !(await rowHeld(p, row)));
    if (hold) {
      const htag = tag.replace(/, (tap|click)$/, kind === 'touch' ? ', hold' : ', press-and-hold');
      const c2 = await center(p, at);
      await holdAt(p, kind, c2); await sleep(150);
      const sHold = await sheetOf(p);
      check(`${htag}: a hold opens the same pop-up, plays nothing, no old menu`, !!sHold && (await sheetOpen(p)) && !(await oldMenu(p)) && J(await effects(p)) === '[]', J(sHold));
      check(`${htag}: the held row is highlighted`, await rowHeld(p, row));
      await p.keyboard.press('Escape'); await sleep(400);
      check(`${htag} + physical Esc: the pop-up closes and the highlight clears, nothing played`, !(await sheetOpen(p)) && !(await rowHeld(p, row)) && J(await effects(p)) === '[]', J(await effects(p)));
    }
  } else {
    check(`${tag}: the tap only highlights the row (no pop-up, no menu of either kind)`, !(await sheetOpen(p)) && !(await oldMenu(p)));
    await shot(p, `0714-tap-${name.toLowerCase()}-${kind}`);
  }
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} track-tap-audit checks passed`);
process.exit(failures ? 1 : 0);

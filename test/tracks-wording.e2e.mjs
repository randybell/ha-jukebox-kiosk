// 0.7.14 (issue #82, Randy's rule): the card says "tracks", never "songs", wherever it talks to the user (Music Assistant's word is "track").
// At 1024x600 (touch tap, mouse click and physical keyboard): the Library category button reads Tracks, the search hint and placeholders say
// tracks, the artist-filter placeholder and empty state say tracks, the Queue's empty search says "No matching tracks", the Play Now confirm says
// "The current track will stop.", and the card editor's labels and options contain no "song". Config keys and mock song titles are not user text.
// Every screen is also scanned: no visible text, aria-label, title or placeholder outside the item rows contains the word song(s).
// Usage: node test/tracks-wording.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes screenshots.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex, devRoot } from './serve.mjs';

const BASE = await devIndex();
const ROOT = await devRoot();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); };
const J = JSON.stringify;
const SHOTS = process.env.SHOTS;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const BRC = `${SV}.querySelector('jb-browse').shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function tapAt(p, kind, c) { if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); }
const newPage = async (url, root = BASE) => {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${root}?fresh=1&latency=20&kiosk=1${url}`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  return p;
};
// every piece of the card's own wording that is on the page right now: text nodes, aria-label, title, placeholder, in every shadow root,
// leaving out the item rows / tiles / queue rows (they show the mock's own titles)
const wording = (p) => p.evaluate(() => {
  const out = [], SKIP = '.row, .qr, .tile, .rt';
  const walk = (n) => {
    if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push(t); return; }
    if (n.nodeType !== 1 && n.nodeType !== 11) return;
    if (n.nodeType === 1) {
      if (n.matches?.(SKIP) || n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return;
      for (const a of ['aria-label', 'title', 'placeholder']) { const v = n.getAttribute(a); if (v) out.push(v); }
    }
    if (n.shadowRoot) walk(n.shadowRoot);
    for (const c of n.childNodes) walk(c);
  };
  walk(document.body);
  return out;
});
const songWords = async (p) => (await wording(p)).filter((t) => /\bsongs?\b/i.test(t));

for (const kind of ['touch', 'mouse']) {
  const tag = `1024x600 ${kind === 'touch' ? 'tap' : 'click'}`;
  // ---- Library: category button, hint, placeholders ----
  const p = await newPage('&tab=browse');
  const btns = await ev(p, `[...${SV}.querySelectorAll('.lcats .lc')].map((b) => b.dataset.lcat + ':' + b.textContent.trim())`);
  check(`${tag}: Library category buttons read Playlists, Artists, Tracks, Radio (no Songs)`, J(btns) === J(['playlist:Playlists', 'artist:Artists', 'track:Tracks', 'radio:Radio']), J(btns));
  const c = await center(p, `${SV}.querySelector('.lcats .lc[data-lcat="track"]')`);
  await tapAt(p, kind, c); await sleep(600);
  const w = (await wording(p)).join(' | ');
  check(`${tag}: Library > Tracks: hint "Tracks in your library · type to search all providers"`, w.includes('Tracks in your library · type to search all providers'), w);
  check(`${tag}: Library > Tracks: search placeholder "Search tracks…"`, w.includes('Search tracks…'), w);
  check(`${tag}: Library > Tracks: no visible wording says song(s)`, (await songWords(p)).length === 0, J(await songWords(p)));
  await shot(p, `0714-library-tracks-${kind}`);
  if (kind === 'mouse') {
    // physical keyboard: typing goes into the Library search; the wording around it still says tracks
    await p.keyboard.type('eagles'); await sleep(900);
    check(`${tag} + physical keyboard: typing fills the search`, (await ev(p, `${SV}.querySelector('.q')?.dataset.query ?? ''`)).toLowerCase() === 'eagles');
    check(`${tag} + physical keyboard: results screen wording has no song(s)`, (await songWords(p)).length === 0, J(await songWords(p)));
    await shot(p, '0714-library-tracks-search');
  }
  await p.close();
}

// ---- Library: Playlists tab placeholder, and the separate (older) layout's Tracks button ----
{
  const p = await newPage('&tab=browse');
  const w = (await wording(p)).join(' | ');
  check('1024x600 Library > Playlists: nothing says song(s)', (await songWords(p)).length === 0 && w.includes('Search playlists…'), w);
  await p.close();
}

// ---- artist filter: placeholder and empty state say tracks ----
{
  const p = await newPage('&layout=separate&jjgrey=1&tab=browse&lhome=0');
  const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
  const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
  await p.waitForFunction((b) => !!eval(b).querySelector('.cats .fc[data-cat="artist"]'), {}, BR);
  await ev(p, `${BR}.querySelector('.cats .fc[data-cat="artist"]').click()`); await sleep(700);
  await p.waitForFunction((b) => !!eval(b).querySelector('.tile[data-type="artist"]'), {}, BR);
  const JJ = `[...${BR}.querySelectorAll('.tile[data-type="artist"]')].find((x) => x.querySelector('b').textContent === 'JJ Grey')`;
  await ev(p, `${JJ}.scrollIntoView({ block: 'center' })`); await sleep(300);
  let jc = await center(p, JJ); await p.mouse.click(jc.x, jc.y); await sleep(900);
  await p.waitForFunction((b) => !!eval(b)?.querySelector('[data-action="scope"]'), {}, BD);
  jc = await center(p, `${BD}.querySelector('[data-action="scope"]')`); await p.mouse.click(jc.x, jc.y); await sleep(900);
  await ev(p, `${BR}.querySelector('.cats .fc[data-cat="track"]').click()`); await sleep(700);
  await ev(p, `${BR}.querySelector('[data-act="filter"]').click()`); await sleep(600);
  const w1 = (await wording(p)).join(' | ');
  check('1024x600 artist filter > Tracks: filter placeholder "Filter JJ Grey tracks…"', w1.includes('Filter JJ Grey tracks…'), w1);
  const KB = `${BR}.querySelector('jb-keyboard').shadowRoot`;
  for (const k of 'QQ') { const kc = await center(p, `${KB}.querySelector('[data-key="k-${k}"]')`); await p.touchscreen.tap(kc.x, kc.y); await sleep(150); }
  await sleep(900);
  const em = await ev(p, `${BR}.querySelector('.empty.scoped')?.textContent.replace(/\\s+/g, ' ') ?? ''`);
  check('1024x600 artist filter > Tracks: no match says "… “QQ” in your library tracks"', /“QQ” in your library tracks/.test(em) && !/songs?/i.test(em), em);
  check('1024x600 artist filter: nothing visible says song(s)', (await songWords(p)).length === 0, J(await songWords(p)));
  await shot(p, '0714-artist-filter-tracks-empty');
  await p.close();
}

// ---- Queue: empty search, Play Now confirm ----
for (const kind of ['touch', 'mouse']) {
  const tag = `1024x600 Queue, ${kind === 'touch' ? 'tap' : 'click'}`;
  const p = await newPage('&tab=queue&qbuf=0&admin=1');
  await p.waitForFunction((e) => eval(e).querySelectorAll('.qr').length > 4, {}, QV);
  check(`${tag}: nothing visible says song(s)`, (await songWords(p)).length === 0, J(await songWords(p)));
  const s = await center(p, `${QV}.querySelector('[data-action="queue-search"]')`); await tapAt(p, kind, s); await sleep(400);
  await p.keyboard.type('zqx'); await sleep(700);
  const empty = await ev(p, `${QV}.querySelector('.empty')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
  check(`${tag}: a search with no match says "No matching tracks"`, /^No matching tracks\b/.test(empty), empty);
  check(`${tag}: empty-search screen says no song(s)`, (await songWords(p)).length === 0, J(await songWords(p)));
  await shot(p, `0714-queue-no-matching-tracks-${kind}`);
  await p.keyboard.press('Escape'); await sleep(400);
  // hold a row, Play Now (a jump): the confirm says "The current track will stop."
  const row = `[...${QV}.querySelectorAll('.qr.next:not(.buf)')][2]`;
  await ev(p, `${row}.scrollIntoView({ block: 'center' })`); await sleep(200);
  const h = await center(p, `${row}.querySelector('.rt')`);
  if (kind === 'touch') { await p.touchscreen.touchStart(h.x, h.y); await sleep(700); await p.touchscreen.touchEnd(); } else { await p.mouse.move(h.x, h.y); await p.mouse.down(); await sleep(700); await p.mouse.up(); }
  await sleep(400);
  const pn = await center(p, `${HS}.querySelector('.it[data-action="play"], .it[data-action="replace"], .it[data-action="jump"]')`);
  if (pn) await tapAt(p, kind, pn); await sleep(500);
  const dlg = await ev(p, `(() => { const d = ${QV}.querySelector('.cf, .confirm, [role="dialog"], [role="alertdialog"]'); return d ? d.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`);
  check(`${tag}: Play Now confirm says "The current track will stop."`, /The current track will stop\./.test(dlg), dlg);
  await shot(p, `0714-queue-play-now-confirm-${kind}`);
  await p.close();
}

// ---- card editor ----
{
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 });
  await p.goto(`${ROOT}editor.html?fresh=1&cfg=${encodeURIComponent(J({ type: 'custom:jukebox-card', entity: 'media_player.everywhere' }))}`);
  await p.waitForFunction('window.__editor && __editor.shadowRoot && __editor.shadowRoot.querySelector("ha-form")', { timeout: 8000 });
  await sleep(600);
  const texts = await p.evaluate(() => {
    const out = [];
    const walk = (n) => { if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push(t); return; }
      if (n.nodeType === 1) { if (n.tagName === 'STYLE') return; for (const a of ['aria-label', 'title', 'placeholder', 'label', 'helper']) { const v = n.getAttribute?.(a); if (v) out.push(v); } }
      if (n.shadowRoot) walk(n.shadowRoot); for (const c of n.childNodes) walk(c); };
    walk(__editor.shadowRoot); return out;
  });
  check('card editor: has Tracks (Library buttons) and no label or option says song(s)', texts.some((t) => /Tracks/.test(t)) && !texts.some((t) => /\bsongs?\b/i.test(t)), J(texts.filter((t) => /song|track/i.test(t))));
  await shot(p, '0714-editor');
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} tracks-wording checks passed`);
process.exit(failures ? 1 : 0);

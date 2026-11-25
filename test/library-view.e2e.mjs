// Library tops: an existing leftover library_view is still read at runtime (no copying). library_columns is exact tiles across, 1..8 (default 3).
// #146: per-section library_views, including Albums, Podcasts and Audiobooks; Radio Favorites and Browse share radio; Queue / Discover / pages / search have their own keys.
// New installs (no library_view, no library_views): Playlists, Albums and Radio start as Tiles; every other section starts as Rows, including Discover (a list, not the sideways strip).
// (Playlists, Artists, Tracks, Genres, Radio, Albums, Podcasts, Audiobooks), no circles at the top tier, track tiles with no action buttons.
// #85: song-row action buttons and show_action_icons are gone; an old YAML value is ignored and the rows stay without buttons. Pages you open
// (artist / album / playlist) stay rows (their own layout, not library_view). Library search results also have no row buttons. The Queue stays
// hidden by default. Genres only exist in the separate-tabs layout (the combined tab has no Genres button).
// 1024x600, touch tap / hold / swipe, mouse click / press-and-hold, physical Esc. Usage: node test/library-view.e2e.mjs (own dev server). SHOTS=<dir> also writes screenshots.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 500) : ''}`); };
const J = JSON.stringify;
const SHOTS = process.env.SHOTS;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const BRC = `${SV}.querySelector('jb-browse').shadowRoot`;           // combined Library tab
const BRS = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`; // separate tabs layout
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const wait = (p, expr, timeout = 8000) => p.waitForFunction((e) => !!eval(e), { timeout }, expr).then(() => true, () => false);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const stationOpen = (p) => ev(p, `!!__card._station`);
const effects = (p) => ev(p, `[...(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => 'play:' + c.data.enqueue),
  ...(window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /^player_queues\\//.test(m.command)).map((m) => m.command)]`);
const clear = (p) => ev(p, `window.__calls = []; window.__mark = (window.__ws || []).length`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/0720-${name}.png` }); };
async function tapAt(p, kind, c) { if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); }
async function holdAt(p, kind, c, ms = 700) {
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(ms); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(ms); await p.mouse.up(); }
  await sleep(350);
}
const ALL = ['playlist', 'artist', 'track', 'radio', 'album', 'podcast', 'audiobook'];
const ALLG = ['playlist', 'artist', 'track', 'genre', 'radio', 'album', 'podcast', 'audiobook'];
const NAMES = { playlist: 'Playlists', artist: 'Artists', track: 'Tracks', genre: 'Genres', radio: 'Radio', album: 'Albums', podcast: 'Podcasts', audiobook: 'Audiobooks' };
// the section's list/grid: setups return { p, BR } where BR is the browse shadow root expression
const open = async (cfg, { separate = false, extra = '' } = {}) => {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  const c = { library_categories: separate ? ALLG : ALL, ...cfg };
  await p.goto(`${BASE}?fresh=1&latency=20&legacy=0&kiosk=1&pods=1&radio=lib&jjgrey=1${separate ? '&layout=separate&lhome=0' : ''}&tab=browse${extra}&cfg=${encodeURIComponent(J(c))}`);
  await p.waitForFunction('window.__ready === true'); await sleep(900);
  return { p, BR: separate ? BRS : BRC, separate };
};
const section = async (s, cat) => {
  const { p, BR, separate } = s;
  if (separate) await wait(p, `${BR}.querySelector('.cats .fc[data-cat="${cat}"]')`), await ev(p, `${BR}.querySelector('.cats .fc[data-cat="${cat}"]').click()`);
  else await wait(p, `${SV}.querySelector('.lcats .lc[data-lcat="${cat}"]')`), await ev(p, `${SV}.querySelector('.lcats .lc[data-lcat="${cat}"]').click()`);
  await wait(p, `${BR}.querySelector('.lib .tile, .lib .row')`); await sleep(500);
};
const layoutOf = (s) => ev(s.p, `(() => { const r = ${s.BR}; const l = [...r.querySelectorAll('.lib')];
  return { layouts: [...new Set(l.map((x) => x.dataset.layout))], tiles: r.querySelectorAll('.lib .tile').length, rows: r.querySelectorAll('.lib .row').length,
    otherTiles: r.querySelectorAll('.tile:not(.lib .tile)').length, circ: r.querySelectorAll('.circ').length, artistTiles: r.querySelectorAll('.tile.artist').length }; })()`);
// #146: library_columns is exact; the first row shows that many tiles (no auto-fill shrink).
const cols = (s) => ev(s.p, `(() => { const g = ${s.BR}.querySelector('.grid.lib'); if (!g) return null; const ts = [...g.querySelectorAll('.tile')]; const top = Math.round(ts[0].getBoundingClientRect().top);
  const first = ts.filter((t) => Math.round(t.getBoundingClientRect().top) === top); const w = first.map((t) => Math.round(t.getBoundingClientRect().width));
  return { tracks: getComputedStyle(g).gridTemplateColumns.split(' ').length, first: first.length, wMin: Math.min(...w), wMax: Math.max(...w), gw: Math.round(g.getBoundingClientRect().width), fit: (() => { const cs = getComputedStyle(g), gap = parseFloat(cs.columnGap) || 0, tmin = parseFloat(cs.getPropertyValue('--_tmin')) || 0; return tmin ? Math.max(1, Math.floor((g.clientWidth + gap) / (tmin + gap))) : 99; })(), right: Math.round(Math.max(...first.map((t) => t.getBoundingClientRect().right))), grid: Math.round(g.getBoundingClientRect().right) }; })()`);
const targetOf = (s, cat, view, i = 1) => view === 'tiles'
  ? `[...${s.BR}.querySelectorAll('.lib .tile')][${i}].querySelector('.ar')`
  : `[...${s.BR}.querySelectorAll('.lib .row')][${i}].querySelector('.rt')`;
const outcome = (p, BR) => ev(p, `({ sheet: !!${HS}.querySelector('.sh'), station: !!__card._station, detail: !!${BR}.querySelector('jb-detail'), menu: !!${BR}.querySelector('.menu') })`);

// ============ 1. rows vs tiles on every section; new-install defaults and leftover library_view ============
const defaultWant = (cat) => (['playlist', 'album', 'radio'].includes(cat) ? 'tiles' : 'rows');
for (const [tag, cfg, wantOf] of [
  ['default (no library_view)', {}, defaultWant],
  ['leftover library_view: rows', { library_view: 'rows' }, () => 'rows'],
  ['leftover library_view: tiles', { library_view: 'tiles' }, () => 'tiles'],
  ['invalid library_view uses new-install defaults', { library_view: 'grid' }, defaultWant],
]) {
  for (const separate of [false, true]) {
    const s = await open(cfg, { separate });
    for (const cat of separate ? ALLG : ALL) {
      const want = wantOf(cat);
      await section(s, cat);
      const l = await layoutOf(s);
      const ok = J(l.layouts) === J([want]) && (want === 'tiles' ? l.tiles > 0 && l.rows === 0 : l.rows > 0 && l.tiles === 0) && l.otherTiles === 0;
      check(`${tag}, ${separate ? 'separate tabs' : 'combined tab'}, ${NAMES[cat]}: top level is ${want} (${l.tiles} tiles, ${l.rows} rows)`, ok, J(l));
      check(`${tag}, ${separate ? 'separate tabs' : 'combined tab'}, ${NAMES[cat]}: no circles anywhere in the list`, l.circ === 0 && l.artistTiles === 0, J(l));
    }
    if (!separate && tag.startsWith('leftover library_view') && SHOTS) {
      for (const cat of ALL) { await section(s, cat); await ev(s.p, `${s.BR}.querySelector('.scroll').scrollTo({ top: 0 })`); await sleep(250); await shot(s.p, `${NAMES[cat].toLowerCase()}-${wantOf(cat)}`); }
    }
    await s.p.close();
  }
}

// ============ 2. columns: exact 1–8, default 3, clamping ============
{
  const CASES = [[1, 1], [2, 2], [3, 3], [6, 6], [8, 8], [undefined, 3], [0, 1], [-4, 1], [9, 8], [99, 8], [4.4, 4], [4.6, 5], ['4', 4], ['x', 3], [null, 3], [NaN, 3]];
  for (const [val, want] of CASES) {
    const cfg = { library_view: 'tiles', ...(val === undefined ? {} : { library_columns: val }) };
    const s = await open(cfg);
    await section(s, 'artist');
    const c = await cols(s);
    check(`tiles, library_columns ${J(val) ?? 'missing'} → exactly ${want} columns (grid tracks ${c?.tracks}, tiles on the first row ${c?.first}, ${c?.wMin}-${c?.wMax}px wide)`,
      !!c && c.tracks === want && c.first === want && c.wMax - c.wMin <= 1 && c.right <= c.grid, J(c));
    if (SHOTS && [2, 6].includes(val)) { await ev(s.p, `${s.BR}.querySelector('.scroll').scrollTo({ top: 0 })`); await sleep(250); await shot(s.p, `artists-tiles-${val}`); }
    if (SHOTS && val === undefined) { await ev(s.p, `${s.BR}.querySelector('.scroll').scrollTo({ top: 0 })`); await sleep(250); await shot(s.p, `artists-tiles-3`); }
    await s.p.close();
  }
  // every tile section follows the same count, separate tabs too (Genres, Radio's Favorites and More stations)
  for (const separate of [false, true]) {
    const s = await open({ library_view: 'tiles', library_columns: 5 }, { separate });
    for (const cat of separate ? ALLG : ALL) {
      await section(s, cat);
      const c = await cols(s);
      if (cat === 'podcast' || cat === 'audiobook') check(`5 columns, ${separate ? 'separate' : 'combined'}, ${NAMES[cat]}: ${c?.tracks} tracks (only ${(await ev(s.p, `${s.BR}.querySelectorAll('.lib .tile').length`))} tiles)`, !!c && c.tracks === 5, J(c));
      else check(`5 columns, ${separate ? 'separate' : 'combined'}, ${NAMES[cat]}: exactly five on a row`, !!c && c.tracks === 5 && c.first === 5, J(c));
    }
    await s.p.close();
  }
  // columns are ignored for rows
  const s = await open({ library_view: 'rows', library_columns: 6 });
  await section(s, 'artist');
  check('rows ignore library_columns (no grid at all)', (await cols(s)) === null && (await layoutOf(s)).rows > 0);
  await s.p.close();
}

// ============ 3. radio: Favorites + More stations both follow the layout ============
for (const view of ['rows', 'tiles']) {
  const s = await open({ library_view: view }, { separate: true, extra: '&radioinlib=3' });
  await section(s, 'radio');
  const r = await ev(s.p, `(() => { const R = ${s.BR}; return { secs: [...R.querySelectorAll('.sec')].map((x) => x.dataset.sec), lib: [...R.querySelectorAll('.lib')].map((x) => x.dataset.layout + ':' + x.dataset.src), other: R.querySelectorAll('.grid:not(.lib), .list:not(.lib)').length }; })()`);
  check(`Radio, ${view}: every station list (${r.lib.join(', ')}) is ${view}`, r.lib.length > 0 && r.lib.every((x) => x.startsWith(view + ':')) && r.other === 0, J(r));
  await s.p.close();
}

// ============ 4. tap / hold per item type: same outcome in rows and tiles, as today ============
const EXPECT = { playlist: 'detail', artist: 'detail', album: 'detail', radio: 'station', track: 'sheet' };
for (const view of ['rows', 'tiles']) for (const kind of ['touch', 'mouse']) for (const cat of ['playlist', 'artist', 'album', 'radio', 'track']) {
  const tag = `${view}, ${NAMES[cat]}, ${kind === 'touch' ? 'tap' : 'click'}`;
  const s = await open({ library_view: view }); await section(s, cat); await clear(s.p);
  const c = await center(s.p, targetOf(s, cat, view)); await sleep(250);
  await tapAt(s.p, kind, c); await sleep(900);
  const o = await outcome(s.p, s.BR);
  const got = o.sheet ? 'sheet' : o.station ? 'station' : o.detail ? 'detail' : o.menu ? 'menu' : 'nothing';
  check(`${tag}: ${EXPECT[cat]} (as today), plays nothing, no old menu`, got === EXPECT[cat] && !o.menu && J(await effects(s.p)) === '[]', J({ o, fx: await effects(s.p) }));
  if (cat === 'track' && kind === 'touch') {
    await p_esc(s.p);
    async function p_esc(p) { await p.keyboard.press('Escape'); await sleep(400); check(`${tag} + physical Esc: the pop-up closes, nothing played`, !(await sheetOpen(p)) && J(await effects(p)) === '[]', J(await effects(p))); }
  }
  if (cat === 'track' && view === 'tiles' && kind === 'touch') await shot(s.p, 'track-tile-tap-popup');
  await s.p.close();
  // hold: the same pop-up (jb-hold-sheet), plays nothing
  const h = await open({ library_view: view }); await section(h, cat); await clear(h.p);
  const c2 = await center(h.p, targetOf(h, cat, view)); await sleep(250); await holdAt(h.p, kind, c2);
  const o2 = await outcome(h.p, h.BR);
  check(`${tag.replace(/,? (tap|click)$/, '')}, ${kind === 'touch' ? 'hold' : 'press-and-hold'}: opens the pop-up (${cat === 'radio' ? 'a station: pop-up or station sheet, as today' : 'jb-hold-sheet'}), plays nothing`,
    (o2.sheet || (cat === 'radio' && o2.station)) && J(await effects(h.p)) === '[]', J({ o2, fx: await effects(h.p) }));
  await h.p.close();
}
// rows and tiles give the same answer for a hold on every type (parity), including podcasts and audiobooks
for (const cat of ['podcast', 'audiobook']) for (const kind of ['touch', 'mouse']) {
  const got = {};
  for (const view of ['rows', 'tiles']) {
    const s = await open({ library_view: view }); await section(s, cat); await clear(s.p);
    const c = await center(s.p, targetOf(s, cat, view, 0)); await tapAt(s.p, kind, c); await sleep(800);
    const o = await outcome(s.p, s.BR);
    // KNOWN, not from 0.7.20 (tap() is unchanged): with a finger the small menu opens under it and the finger's own click can land on a menu choice (Audiobook TILE tap → Play next). A mouse click is exact, so the full outcome is compared for the mouse only.
    got[view] = J(kind === 'mouse' ? { ...o, fx: await effects(s.p) } : { sheet: o.sheet, station: o.station, detail: o.detail });
    await s.p.close();
  }
  check(`${NAMES[cat]}, ${kind === 'touch' ? 'tap' : 'click'}: rows and tiles do the same thing`, got.rows === got.tiles, J(got));
}

// ============ 5. track tile: no action buttons or hearts, ever ============
for (const [tag, cfg] of [['default', {}], ['old show_action_icons: true', { show_action_icons: true }]]) {
  const s = await open({ library_view: 'tiles', ...cfg }); await section(s, 'track');
  const b = await ev(s.p, `(() => { const r = ${s.BR}; return { tiles: r.querySelectorAll('.tile[data-type="track"]').length, buttons: r.querySelectorAll('.tile button').length, hearts: r.querySelectorAll('.tile [data-act=fav], .tile .tfav').length }; })()`);
  check(`track tiles (${tag}): no action buttons or hearts on any tile`, b.tiles > 0 && b.buttons === 0 && b.hearts === 0, J(b));
  await s.p.close();
}

// ============ 6. swipe / scroll: a drag scrolls the list, opens nothing, plays nothing ============
for (const view of ['rows', 'tiles']) {
  const s = await open({ library_view: view }); await section(s, 'track'); await clear(s.p);
  const box = await ev(s.p, `(() => { const r = ${s.BR}.querySelector('.scroll').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height - 40, top: r.top + 60 }; })()`);
  const before = await ev(s.p, `${s.BR}.querySelector('.scroll').scrollTop`);
  await s.p.touchscreen.touchStart(box.x, box.y);
  for (let i = 1; i <= 12; i++) { await s.p.touchscreen.touchMove(box.x, box.y - i * 25); await sleep(16); }
  await s.p.touchscreen.touchEnd(); await sleep(700);
  const after = await ev(s.p, `${s.BR}.querySelector('.scroll').scrollTop`);
  check(`${view}, Tracks: a swipe scrolls the list (${before} → ${after}), no pop-up, nothing played`, after > before + 100 && !(await sheetOpen(s.p)) && J(await effects(s.p)) === '[]', J({ before, after }));
  await s.p.close();
}

// ============ 7. drill-down pages, Library search, library_home: layout unchanged; track-row buttons stay gone ============
for (const view of ['rows', 'tiles']) {
  // artist page: same header (circle art there is the page's own, unchanged); track-row buttons gone
  const s = await open({ library_view: view }); await section(s, 'artist');
  const c = await center(s.p, targetOf(s, 'artist', view)); await tapAt(s.p, 'mouse', c); await wait(s.p, `${s.BR}.querySelector('jb-detail')?.shadowRoot?.querySelector('.dart')`); await sleep(600);
  const d = await ev(s.p, `(() => { const r = ${s.BR}.querySelector('jb-detail').shadowRoot; const a = r.querySelector('.dart');
    return { dartCirc: a?.classList.contains('circ'), rows: r.querySelectorAll('.row').length, tiles: r.querySelectorAll('.tile').length, libs: r.querySelectorAll('.lib').length,
      trackBtns: [...r.querySelectorAll('.row[data-type="track"] .ra-b')].filter((b) => b.getBoundingClientRect().width > 0).length }; })()`);
  check(`${view}: artist page unchanged (its own circle art kept, rows, no Library layout classes, track-row buttons gone: ${d.trackBtns})`, d.dartCirc === true && d.rows > 0 && d.libs === 0 && d.trackBtns === 0, J(d));
  await shot(s.p, `artist-page-from-${view}`);
  await s.p.close();
  // album page
  const a = await open({ library_view: view }); await section(a, 'album');
  const c2 = await center(a.p, targetOf(a, 'album', view)); await tapAt(a.p, 'mouse', c2); await wait(a.p, `${a.BR}.querySelector('jb-detail')?.shadowRoot?.querySelector('.row[data-type="track"]')`); await sleep(500);
  const d2 = await ev(a.p, `(() => { const r = ${a.BR}.querySelector('jb-detail').shadowRoot; return { rows: r.querySelectorAll('.row[data-type="track"]').length, libs: r.querySelectorAll('.lib').length,
    btns: [...r.querySelectorAll('.row[data-type="track"] .ra-b')].filter((b) => b.getBoundingClientRect().width > 0).length }; })()`);
  check(`${view}: album page unchanged (track rows, no Library layout classes, buttons gone: ${d2.btns})`, d2.rows > 0 && d2.libs === 0 && d2.btns === 0, J(d2));
  await a.p.close();
  // playlist page
  const l = await open({ library_view: view }); await section(l, 'playlist');
  const c3 = await center(l.p, targetOf(l, 'playlist', view)); await tapAt(l.p, 'mouse', c3); await wait(l.p, `${l.BR}.querySelector('jb-detail')?.shadowRoot?.querySelector('.row[data-type="track"]')`); await sleep(500);
  const d3 = await ev(l.p, `(() => { const r = ${l.BR}.querySelector('jb-detail').shadowRoot; return { rows: r.querySelectorAll('.row[data-type="track"]').length, libs: r.querySelectorAll('.lib').length,
    btns: [...r.querySelectorAll('.row[data-type="track"] .ra-b')].filter((b) => b.getBoundingClientRect().width > 0).length }; })()`);
  check(`${view}: playlist page unchanged (track rows, no Library layout classes, buttons gone: ${d3.btns})`, d3.rows > 0 && d3.libs === 0 && d3.btns === 0, J(d3));
  await l.p.close();
  // Library search results: rows, artists keep their circle, no Library layout classes
  const q = await open({ library_view: view });
  const qb = await center(q.p, `${SV}.querySelector('.qbar')`); await q.p.touchscreen.tap(qb.x, qb.y); await sleep(300);
  for (const ch of 'EAGLES') { const k = await center(q.p, `[...${SV}.querySelector('jb-keyboard').shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`); await q.p.touchscreen.tap(k.x, k.y); await sleep(100); }
  await ev(q.p, `${SV}.querySelector('.lcats .lc[data-lcat="artist"]').click()`); await sleep(900);
  const r = await ev(q.p, `(() => { const R = ${SV}; const row = R.querySelector('.row[data-type="artist"]'); return { rows: R.querySelectorAll('.row').length, tiles: R.querySelectorAll('.tile').length, circ: !!row?.querySelector('.circ') }; })()`);
  check(`${view}: Library search results unchanged (rows, artist rows keep their own circle)`, r.rows > 0 && r.tiles === 0 && r.circ === true, J(r));
  await q.p.close();
}
{
  // Library home tiles (separate tabs + library_home) are the same with either value
  const sigs = [];
  for (const view of ['rows', 'tiles']) {
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600, hasTouch: true });
    await p.goto(`${BASE}?fresh=1&latency=20&legacy=0&kiosk=1&layout=separate&tab=browse&cfg=${encodeURIComponent(J({ library_home: true, library_view: view, library_columns: 6 }))}`); await p.waitForFunction('window.__ready === true'); await sleep(900);
    sigs.push(await ev(p, `(() => { const R = ${BRS}; return J([...R.querySelectorAll('.home .lt')].map((t) => t.dataset.tile + ':' + Math.round(t.getBoundingClientRect().width))); function J(x) { return JSON.stringify(x); } })()`));
    await p.close();
  }
  check(`Library home tiles are the same with rows and tiles (${sigs[0]})`, sigs[0] === sigs[1] && JSON.parse(sigs[0]).length >= 4, J(sigs));
}

// ============ 8. show_action_icons is gone: rows never show the old buttons, even when an old config still sets it ============
const BTN = `(r) => [...r.querySelectorAll('.ra-b')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && x.height > 0 && getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).display !== 'none'; }).length`;
for (const [tag, cfg] of [['missing', {}], ['false', { show_action_icons: false }], ['old true (YAML)', { show_action_icons: true }]]) {
  const s = await open({ library_view: 'rows', ...cfg }); await section(s, 'track');
  const n = await ev(s.p, `(${BTN})(${s.BR})`);
  check(`show_action_icons ${tag}: Library Tracks rows have no action buttons (${n})`, n === 0, String(n));
  await s.p.close();
  const q = await browser.newPage(); await hermetic(q); await q.setViewport({ width: 1024, height: 600, hasTouch: true });
  await q.goto(`${BASE}?fresh=1&latency=20&legacy=0&kiosk=1&tab=queue&qbuf=0&admin=1&cfg=${encodeURIComponent(J(cfg))}`); await q.waitForFunction('window.__ready === true'); await sleep(900);
  await wait(q, `__card.shadowRoot.querySelector('jb-queue').shadowRoot.querySelectorAll('.qr').length > 4`);
  const nq = await ev(q, `(${BTN})(__card.shadowRoot.querySelector('jb-queue').shadowRoot)`);
  check(`show_action_icons ${tag}: Queue rows carry no action buttons (${nq})`, nq === 0, String(nq));
  await q.close();
}
{
  // the card accepts true / false / missing / a junk value (the old key is ignored)
  const p = await browser.newPage(); await hermetic(p); await p.goto(`${BASE}?fresh=1`); await p.waitForFunction('window.__ready === true'); await sleep(500);
  const r = await ev(p, `(() => { const out = {}; for (const v of [false, true, undefined, 'no']) { try { const el = document.createElement('jukebox-card'); el.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.everywhere', ...(v === undefined ? {} : { show_action_icons: v }) }); out[String(v)] = 'ok'; } catch (e) { out[String(v)] = e.message; } } return out; })()`);
  check('card accepts true, false, missing and a junk show_action_icons without errors', r.true === 'ok' && r.false === 'ok' && r.undefined === 'ok' && r.no === 'ok', J(r));
  // library_view / library_columns never stop the card from loading, whatever is typed
  const r2 = await ev(p, `(() => { const out = {}; for (const [k, v] of [['library_view', 'tiles'], ['library_view', 'rows'], ['library_view', 'grid'], ['library_view', 5], ['library_columns', 4], ['library_columns', 99], ['library_columns', 'abc'], ['library_columns', null]]) { try { const el = document.createElement('jukebox-card'); el.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.everywhere', [k]: v }); out[k + '=' + v] = 'ok'; } catch (e) { out[k + '=' + v] = e.message; } } return out; })()`);
  check('library_view / library_columns: odd values never stop the card loading', Object.values(r2).every((x) => x === 'ok'), J(r2));
  await p.close();
}

// ============ 9. #146 per-section library_views, Radio share, Queue / Discover / pages / search ============
{
  const s = await open({ library_views: { playlist: 'tiles', artist: 'rows' }, library_columns: 4 });
  await section(s, 'playlist');
  const pl = await layoutOf(s);
  const pc = await cols(s);
  check('library_views.playlist: tiles uses a 4-column tile grid', J(pl.layouts) === J(['tiles']) && pl.tiles > 0 && pl.rows === 0 && pc?.first === 4 && pc?.tracks === 4, J({ pl, pc }));
  await section(s, 'artist');
  const ar = await layoutOf(s);
  check('library_views.artist: rows stays a list (other sections are independent)', J(ar.layouts) === J(['rows']) && ar.rows > 0 && ar.tiles === 0, J(ar));
  await s.p.close();
}
{
  // Radio Favorites and Browse share the radio key (library_view fallback also already covered in section 3)
  const s = await open({ library_views: { radio: 'tiles' }, library_columns: 4 }, { separate: true, extra: '&radioinlib=3' });
  await section(s, 'radio');
  const r = await ev(s.p, `(() => { const R = ${s.BR}; return { lib: [...R.querySelectorAll('.lib')].map((x) => x.dataset.layout + ':' + x.dataset.src), first: (() => { const g = R.querySelector('.grid.lib'); if (!g) return 0; const ts = [...g.querySelectorAll('.tile')]; const top = Math.round(ts[0].getBoundingClientRect().top); return ts.filter((t) => Math.round(t.getBoundingClientRect().top) === top).length; })() }; })()`);
  check('Radio Favorites and Browse both follow library_views.radio: tiles', r.lib.length > 0 && r.lib.every((x) => x.startsWith('tiles:')) && r.first === 4, J(r));
  await s.p.close();
}
{
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&legacy=0&kiosk=1&tab=queue&qbuf=0&admin=1&cfg=${encodeURIComponent(J({ library_views: { queue: 'tiles' }, library_columns: 4 }))}`);
  await p.waitForFunction('window.__ready === true'); await sleep(900);
  await wait(p, `__card.shadowRoot.querySelector('jb-queue').shadowRoot.querySelector('.qg')`);
  const q = await ev(p, `(() => { const R = __card.shadowRoot.querySelector('jb-queue').shadowRoot; const g = R.querySelector('.qg');
    const ts = [...g.querySelectorAll('.qt.next')]; const top = ts.length ? Math.round(ts[0].getBoundingClientRect().top) : 0;
    const first = ts.filter((t) => Math.round(t.getBoundingClientRect().top) === top).length;
    return { layout: g.dataset.layout, tiles: [...g.querySelectorAll('.qt')].length, next: ts.length, rows: R.querySelectorAll('.qr').length, tracks: getComputedStyle(g).gridTemplateColumns.split(' ').length, first }; })()`);
  check('Queue library_views.queue: tiles shows an exact 4-column tile grid', q.layout === 'tiles' && q.tiles > 0 && q.rows === 0 && q.tracks === 4 && q.first === Math.min(4, q.next), J(q));
  const look = await ev(p, `(() => { const R = __card.shadowRoot.querySelector('jb-queue').shadowRoot; const g = R.querySelector('.qg');
    const now = R.querySelector('.qt.now'), past = R.querySelector('.qt.past'), nx = [...R.querySelectorAll('.qt.next')];
    const items = [...R.querySelectorAll('.qt.past, .qt.now, .qt.next')]; const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
    const tw = Math.round(nx[0].getBoundingClientRect().width);
    return { badges: nx.slice(0, 4).map((t) => t.querySelector('.qn')?.textContent.trim()), hasPast: !!past, hasNow: !!now,
      sameGrid: items.every((t) => t.parentElement === g), sameWidth: items.every((t) => Math.abs(Math.round(t.getBoundingClientRect().width) - tw) <= 1), cols,
      nowBg: getComputedStyle(now).backgroundColor !== 'rgba(0, 0, 0, 0)', pastDim: past ? Number(getComputedStyle(past).opacity) < 1 : true }; })()`);
  check('Queue tiles: played, playing and Up next are all tiles in one grid with Tiles across columns; numbered badges on Up next, playing highlighted, played dimmed',
    J(look.badges) === J(['1', '2', '3', '4']) && look.hasPast && look.hasNow && look.sameGrid && look.sameWidth && look.cols === 4 && look.nowBg && look.pastDim, J(look));
  await p.close();
}
{
  // Discover is a Browse chip when `discover` is on (separate tabs, no tile home), not a library_categories button
  const openDisc = async (cfg) => {
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600, hasTouch: true });
    await p.goto(`${BASE}?fresh=1&latency=20&legacy=0&kiosk=1&pods=1&layout=separate&lhome=0&tab=browse&cfg=${encodeURIComponent(J({ discover: true, ...cfg }))}`);
    await p.waitForFunction('window.__ready === true'); await sleep(900);
    await wait(p, `${BRS}.querySelector('.cats .fc[data-cat="discover"]')`);
    await ev(p, `${BRS}.querySelector('.cats .fc[data-cat="discover"]').click()`);
    await wait(p, `${BRS}.querySelector('.hs, .grid.lib, .list.lib')`); await sleep(500);
    return p;
  };
  const d0 = await openDisc({});
  const def = await ev(d0, `(() => { const r = ${BRS}; return { hs: r.querySelectorAll('.drow .hs').length, layout: r.querySelector('.drow .lib')?.dataset.layout, rows: r.querySelectorAll('.drow .list .row').length, tiles: r.querySelectorAll('.drow .grid .tile').length }; })()`);
  check('Discover with no key is Rows (a list), not the 0.9.0 sideways strip', def.hs === 0 && def.layout === 'rows' && def.rows > 0 && def.tiles === 0, J(def));
  await d0.close();
  const dL = await openDisc({ library_view: 'tiles' });
  const leftover = await ev(dL, `(() => { const r = ${BRS}; return { hs: r.querySelectorAll('.drow .hs').length, layout: r.querySelector('.drow .lib')?.dataset.layout, rows: r.querySelectorAll('.drow .list .row').length }; })()`);
  check('leftover library_view does not change Discover (still Rows, not the sideways strip)', leftover.hs === 0 && leftover.layout === 'rows' && leftover.rows > 0, J(leftover));
  await dL.close();
  const t = await openDisc({ library_views: { discover: 'tiles' }, library_columns: 4 });
  const d = await ev(t, `(() => { const R = ${BRS}; const g = R.querySelector('.grid.lib'); const ts = g ? [...g.querySelectorAll('.tile')] : []; const top = ts[0] ? Math.round(ts[0].getBoundingClientRect().top) : 0;
    return { hs: R.querySelectorAll('.hs').length, layout: g?.dataset.layout, tiles: ts.length, tracks: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0, first: ts.filter((t) => Math.round(t.getBoundingClientRect().top) === top).length }; })()`);
  check('Discover library_views.discover: tiles uses an exact 4-column grid, not the horizontal scroller', d.hs === 0 && d.layout === 'tiles' && d.tiles > 0 && d.tracks === 4 && d.first === Math.min(4, d.tiles), J(d));
  await t.close();
  const r = await openDisc({ library_views: { discover: 'rows' } });
  const rows = await ev(r, `(() => { const R = ${BRS}; return { hs: R.querySelectorAll('.hs').length, layout: R.querySelector('.list.lib')?.dataset.layout, rows: R.querySelectorAll('.list.lib .row').length }; })()`);
  check('Discover library_views.discover: rows is a list, not the horizontal scroller', rows.hs === 0 && rows.layout === 'rows' && rows.rows > 0, J(rows));
  await r.close();
}
{
  const s = await open({ library_views: { artist_page: 'tiles' }, library_columns: 4, library_view: 'rows' });
  await section(s, 'artist');
  const c = await center(s.p, targetOf(s, 'artist', 'rows')); await tapAt(s.p, 'mouse', c); await wait(s.p, `${s.BR}.querySelector('jb-detail')?.shadowRoot?.querySelector('.grid.lib, .list')`); await sleep(600);
  const d = await ev(s.p, `(() => { const r = ${s.BR}.querySelector('jb-detail').shadowRoot; const g = r.querySelector('.grid.lib');
    const ts = g ? [...g.querySelectorAll('.tile')] : []; const top = ts[0] ? Math.round(ts[0].getBoundingClientRect().top) : 0;
    return { layout: g?.dataset.layout, tiles: ts.length, rows: r.querySelectorAll('.list .row').length, tracks: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0, first: ts.filter((t) => Math.round(t.getBoundingClientRect().top) === top).length }; })()`);
  check('artist page library_views.artist_page: tiles uses an exact 4-column grid', d.layout === 'tiles' && d.tiles > 0 && d.tracks === 4 && d.first === Math.min(4, d.tiles), J(d));
  await s.p.close();
}
{
  const s = await open({ library_views: { search: 'tiles' }, library_columns: 4 });
  const qb = await center(s.p, `${SV}.querySelector('.qbar')`); await s.p.touchscreen.tap(qb.x, qb.y); await sleep(300);
  for (const ch of 'EAGLES') { const k = await center(s.p, `[...${SV}.querySelector('jb-keyboard').shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`); await s.p.touchscreen.tap(k.x, k.y); await sleep(100); }
  await ev(s.p, `${SV}.querySelector('.lcats .lc[data-lcat="artist"]').click()`); await sleep(900);
  const r = await ev(s.p, `(() => { const R = ${SV}; const g = R.querySelector('.grid.lib');
    const ts = g ? [...g.querySelectorAll('.tile')] : []; const top = ts[0] ? Math.round(ts[0].getBoundingClientRect().top) : 0;
    return { layout: g?.dataset.layout, tiles: ts.length, rows: R.querySelectorAll('.list .row').length, tracks: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0, first: ts.filter((t) => Math.round(t.getBoundingClientRect().top) === top).length }; })()`);
  check('search results library_views.search: tiles uses an exact 4-column grid', r.layout === 'tiles' && r.tiles > 0 && r.tracks === 4 && r.first === Math.min(4, r.tiles), J(r));
  await s.p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} library-view checks passed`);
process.exit(failures ? 1 : 0);

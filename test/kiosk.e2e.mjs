// 0.6.0 Jukebox Kiosk backend e2e: the card on hass with the jukebox_kiosk integration loaded (dev/mock-kiosk.js plays its
// WebSocket API on top of the mock Music Assistant). Every id is a placeholder.
// Usage: (serve the project root on :8765) node test/kiosk.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';

const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const EV = 'media_player.everywhere';
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const NP = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse')`;
const BDs = `${BR}.shadowRoot.querySelector('jb-detail')?.shadowRoot`;
const LY = `__card.shadowRoot.querySelector('jb-lyrics[mode=tab]')`;

async function open(query = '', vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.evaluateOnNewDocument(() => { window.__jbUndoMs = 8000; });
  await page.goto(`${BASE}?layout=separate&fresh=1&latency=30&gap=500&kiosk=1${query.includes('tab=') ? '' : '&tab=now'}${query}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(150);
  return page;
}
async function tap(page, expr) {
  const r = await page.evaluate((expr) => { const el = eval(expr); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(60);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
const ws = (page, since = 0) => page.evaluate((n) => window.__ws.slice(n).map((m) => ({ ...m })), since);
const nws = (page) => page.evaluate(() => window.__ws.length);
const maOf = (msgs, cmd) => msgs.filter((m) => m.type === 'ma' && (!cmd || m.command === cmd));
/** mass_queue / music_assistant service calls (none expected on the kiosk backend, except core playback services) */
const mqCalls = (page) => page.evaluate(() => window.__calls.filter((c) => c.domain === 'mass_queue' && c.service !== 'send_command').map((c) => c.service));
const openQ = async (q = '') => { const p = await open(`&tab=queue${q}`); await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`); await sleep(150); return p; };
const nextIds = (p) => ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
const maQueue = (p) => ev(p, `window.__queues['${EV}'].items.map((x) => x.queue_item_id)`);

// ---------------- 1. auto picks the kiosk backend ----------------
{
  const p = await openQ('&admin=1');
  const b = await ev(p, `__card.dataset.backend`);
  const m = await ws(p);
  check('A1 backend: auto + jukebox_kiosk in hass.config.components → kiosk (data-backend)', b === 'kiosk', b);
  check('A2 capabilities asked once, queue window from jukebox_kiosk/queue_items {entity_id, limit_before 1}',
    m.filter((x) => x.type === 'capabilities').length === 1 && m.some((x) => x.type === 'queue_items' && x.entity_id === EV && x.limit_before === 1), J(m.map((x) => x.type)));
  check('A3 queue push subscribed for the target (jukebox_kiosk/subscribe_queue)', J(await ev(p, `window.__kioskSubs()`)) === J([EV]));
  const rows = await ev(p, `${QV}.querySelectorAll('.qr.next').length`);
  check('A4 Up next rows rendered from the WS window', rows > 3, String(rows));
  check('A5 no mass_queue services used', (await mqCalls(p)).length === 0 && (await ev(p, `window.__calls.filter((c) => c.domain === 'mass_queue').length`)) === 0, J(await mqCalls(p)));
  await p.close();
}
// ---------------- 2. queue actions over the WS ----------------
{
  const p = await openQ('&admin=1');
  let ids = await nextIds(p);
  let n = await nws(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids[3]}"] .qa[data-action="playnext"]')`);
  await wait(p, `${QV}.querySelector('.qr.next')?.dataset.id === '${ids[3]}' || [...${QV}.querySelectorAll('.qr.next')][1]?.dataset.id === '${ids[3]}'`, 3000);
  await sleep(800);
  let m = maOf(await ws(p, n), 'player_queues/move_item');
  let q = await maQueue(p);
  check('Q1 Play next → jukebox_kiosk/ma player_queues/move_item {queue_id, queue_item_id, pos_shift}; MA queue agrees',
    m.length === 1 && m[0].args.queue_item_id === ids[3] && typeof m[0].args.pos_shift === 'number' && typeof m[0].args.queue_id === 'string' && q.indexOf(ids[3]) === q.indexOf(ids[0]) - 1, J({ m: m.map((x) => x.args), q: q.slice(0, 6) }));
  const pushed = (await ws(p, n)).filter((x) => x.type === 'queue_items').length;
  check('Q2 the server push (queue_updated) refreshes the window', pushed >= 1, String(pushed));
  ids = await nextIds(p);
  n = await nws(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids[4]}"] .qa[data-action="remove"]')`);
  await sleep(900);
  m = maOf(await ws(p, n), 'player_queues/delete_item');
  check('Q3 Remove → player_queues/delete_item {item_id_or_index}; the row is gone', m.length === 1 && m[0].args.item_id_or_index === ids[4] && !(await maQueue(p)).includes(ids[4]) && !(await nextIds(p)).includes(ids[4]), J(m.map((x) => x.args)));
  ids = await nextIds(p);
  n = await nws(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids[2]}"] .qa[data-action="playnow"]')`);
  await wait(p, `!!${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`, 2000);
  await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  await sleep(900);
  m = maOf(await ws(p, n), 'player_queues/play_index');
  const cur = await ev(p, `(() => { const Q = window.__queues['${EV}']; return Q.items[Q.index]?.queue_item_id; })()`);
  check('Q4 Play now (after the confirm) → player_queues/play_index {index: queue_item_id}; MA plays it', m.length === 1 && m[0].args.index === ids[2] && cur === ids[2], J({ m: m.map((x) => x.args), cur }));
  // an outside change (another client edits the queue) reaches the card through the push alone
  n = await nws(p);
  await ev(p, `(() => { const Q = window.__queues['${EV}']; Q.items.splice(Q.items.length - 1, 1); window.__kioskPush('${EV}'); })()`);
  await sleep(700);
  check('Q5 push without any card action → one more queue_items read', (await ws(p, n)).filter((x) => x.type === 'queue_items').length >= 1);
  // (the mock MA logs its raw commands as mass_queue send_command; only real mass_queue services count here)
  check('Q6 still no mass_queue services', (await mqCalls(p)).length === 0, J(await mqCalls(p)));
  await p.close();
}
// ---------------- 3. detail track lists (server paging) ----------------
{
  const p = await open('&tab=browse&lhome=0');
  const rows = () => ev(p, `[...(${BDs}?.querySelectorAll('.detail .list.tracks .row') ?? [])].map((r) => r.querySelector('b')?.textContent)`);
  let n = await nws(p);
  await p.evaluate((b) => eval(b).openDetail({ media_type: 'album', uri: 'library://album/1448', name: 'Hotel California', artists: [{ name: 'Eagles' }] }, 'album'), BR);
  await sleep(600);
  let m = (await ws(p, n)).filter((x) => x.type === 'item_tracks');
  const ar = await rows();
  check('D1 album detail → jukebox_kiosk/item_tracks {uri, page 1, page_size 100}; rows rendered', m.length === 1 && m[0].uri === 'library://album/1448' && m[0].page === 1 && m[0].page_size === 100 && ar.length > 0, J({ m, n: ar.length }));
  await p.evaluate((b) => [...eval(b).shadowRoot.querySelectorAll('[data-cat="playlist"]')][0]?.click(), BR);
  await sleep(400);
  n = await nws(p);
  await p.evaluate((b) => [...eval(b).shadowRoot.querySelectorAll('.tile')].find((t) => t.querySelector('b').textContent === 'Long Drive').querySelector('.open').click(), BR);
  await sleep(600);
  for (let i = 0; i < 8; i++) { await p.evaluate((b) => { const s = eval(b)?.querySelector('.scroll'); if (s) { s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')); } }, BDs); await sleep(250); }
  m = (await ws(p, n)).filter((x) => x.type === 'item_tracks');
  const lr = await rows();
  const more = await ev(p, `!!${BDs}?.querySelector('.more-t')`);
  check('D2 Long Drive (120 tracks): pages 1, 2 of 100 → 120 unique rows, paging stops on more=false', J(m.map((x) => x.page)) === J([1, 2]) && lr.length === 120 && new Set(lr).size === 120 && !more, J({ pages: m.map((x) => x.page), n: lr.length, more }));
  await p.close();
}
// ---------------- 4. lyrics ----------------
{
  const p = await open('&tab=lyrics');
  const ok = await wait(p, `${LY}?.dataset.status === 'synced' || ${LY}?.dataset.status === 'plain'`, 8000);
  const m = maOf(await ws(p));
  const lyr = m.filter((x) => x.command === 'metadata/get_track_lyrics').map((x) => x.args.track);
  check('L1 lyrics tab shows lyrics on the kiosk backend', ok, await ev(p, `${LY}?.dataset.status`));
  check('L2 the library track is never sent to get_track_lyrics; the queue\'s provider copy is (player_queues/get)',
    lyr.length >= 1 && lyr.every((t) => t.provider !== 'library' && !String(t.uri).startsWith('library://')) && m.some((x) => x.command === 'player_queues/get'), J(lyr.map((t) => t.uri)));
  const byUri = m.filter((x) => x.command === 'music/item_by_uri').map((x) => x.args);
  check('L3 music/item_by_uri never carries allow_update_metadata (the server forces False)',
    byUri.length >= 1 && byUri.every((a) => !('allow_update_metadata' in a)), J(byUri));
  await p.close();
}
// ---------------- 5. limited capabilities hide controls ----------------
{
  const caps = encodeURIComponent(J({ queue_play: false, queue_edit: false, undo: false, unfavorite: false, speakers: false, lyrics: false, library_write: true }));
  const p = await openQ(`&admin=1&kcaps=${caps}`);
  await sleep(300);
  const acts = await ev(p, `[...${QV}.querySelectorAll('.qr .qa')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.dataset.action ?? 'more')`);
  check('G1 no queue_play / queue_edit → no Play now / Play next / Move / Remove icons', !acts.some((a) => ['playnow', 'playnext', 'up', 'down', 'remove'].includes(a)), J([...new Set(acts)]));
  const tabs = await ev(p, `[...__card.shadowRoot.querySelectorAll('.tab')].map((t) => t.dataset.tab)`);
  check('G2 lyrics feature off → no Lyrics tab', !tabs.includes('lyrics') && tabs.includes('queue'), J(tabs));
  const n = await nws(p);
  await tap(p, `__card.shadowRoot.querySelector('.tab[data-tab="now"]')`); await sleep(300);
  await tap(p, `${NP}.querySelector('.tb.fv')`); await sleep(400);
  const toast = await ev(p, `__card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelector('.st .ct')?.textContent?.trim() ?? ''`); // v0.7: the top-right status chip
  check('G3 no unfavorite → heart on a favorite shows "Can\'t remove favorites here", nothing sent', /can.t remove favorites/i.test(toast) && !(await ws(p, n)).some((x) => x.type === 'unfavorite_current'), toast);
  check('G4 speakers feature off → grouping unavailable', (await ev(p, `__card.speakers.available`)) === false);
  await p.close();
}
{
  const p = await open(`&kcaps=${encodeURIComponent(J({ library_write: true }))}`); // v0.7: the Now Playing heart needs the library class
  const n = await nws(p);
  await tap(p, `${NP}.querySelector('.tb.fv')`); await sleep(500);
  const m = (await ws(p, n)).filter((x) => x.type === 'unfavorite_current');
  check('G5 full caps: heart on a favorite → jukebox_kiosk/unfavorite_current {entity_id}', m.length === 1 && m[0].entity_id === EV && (await mqCalls(p)).length === 0, J(m));
  await p.close();
}
// ---------------- 5b. default guest (no Speakers class): volume still works, grouping stays off ----------------
{
  // the server's caps for the 0.6.0 guest default (read, playback, queue, library): only speakers is off
  const caps = encodeURIComponent(J({ speakers: false }));
  const p = await open(`&kcaps=${caps}`); // not admin=1: a plain (kiosk) user
  const SPK = `__card.shadowRoot.querySelector('jb-speakers')`, SR = `${SPK}.shadowRoot`;
  check('V1 default guest (speakers feature off): grouping unavailable', (await ev(p, `__card.speakers.available`)) === false);
  await tap(p, `__card.shadowRoot.querySelector('.pill')`);
  await wait(p, `${SPK}.open && !!${SR}.querySelector('section.sheet')`); await sleep(250);
  const sh = await ev(p, `(() => { const r = ${SR}; return { mode: r.querySelector('.sheet')?.dataset.mode, sliders: [...r.querySelectorAll('jb-slider')].filter((s) => !s.disabled).length, chips: r.querySelectorAll('[data-target]').length, acts: r.querySelectorAll('.act').length }; })()`);
  check('V2 default guest: Speakers panel = enabled volume mixer, no join/drop/move', sh.mode === 'fixed' && sh.sliders >= 1 && sh.chips === 0 && sh.acts === 0, J(sh));
  const c0 = await ev(p, `window.__calls.length`), w0 = await nws(p);
  const r = await ev(p, `(() => { const b = ${SR}.querySelector('[data-room] jb-slider').getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width, id: ${SR}.querySelector('[data-room]').dataset.room }; })()`);
  await p.mouse.move(r.x + r.w * 0.4, r.y); await p.mouse.down(); await sleep(30); await p.mouse.up(); await sleep(250);
  await tap(p, `${SR}.querySelector('[data-room] .vm')`); await sleep(250);
  const vc = await ev(p, `window.__calls.slice(${c0}).filter((c) => c.domain === 'media_player').map((c) => ({ s: c.service, e: c.target?.entity_id }))`);
  check('V3 default guest: room slider → media_player.volume_set, mute → media_player.volume_mute (HA services)',
    vc.some((c) => c.s === 'volume_set' && c.e === r.id) && vc.some((c) => c.s === 'volume_mute' && c.e === r.id), J(vc));
  const sent = (await ws(p, w0)).filter((x) => x.type === 'ma').map((x) => x.command);
  check('V4 default guest: volume sends nothing through jukebox_kiosk/ma (no set_members / transfer / stop)',
    !sent.some((c) => /set_members|transfer|cmd\/stop/.test(c)), J(sent));
  await p.close();
}
// ---------------- 6. explicit backend: mass_queue still wins over auto ----------------
{
  const p = await open(`&cfg=${encodeURIComponent(J({ backend: 'mass_queue' }))}&tab=queue`);
  await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`);
  check('X1 backend: mass_queue with the integration loaded → legacy services, no kiosk queue reads',
    (await ev(p, `__card.dataset.backend`)) === 'mass_queue' && (await ev(p, `window.__calls.some((c) => c.domain === 'mass_queue' && c.service === 'get_queue_items')`)) && !(await ws(p)).some((x) => x.type === 'queue_items'));
  await p.close();
}
// ---------------- 7. 0.6.2 Search radio heart (library class): favourite a station from Search ----------------
{
  const SV = `__card.shadowRoot.querySelector('jb-search')`;
  const rows = (p) => ev(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].map((r) => ({ g: r.dataset.group, uri: r.dataset.uri,
    fav: r.querySelector('[data-act=fav]')?.getAttribute('aria-pressed') ?? null }))`);
  const query = async (p, q) => { await ev(p, `${SV}.setQuery(${J(q)})`); await wait(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'radio')`); await sleep(150); };
  const toast = (p) => ev(p, `__card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelector('.st .ct')?.textContent?.trim() ?? ''`); // v0.7: hearts report in the top-right status chip
  const heart = (uri) => `${SV}.shadowRoot.querySelector('.row[data-uri="${uri}"] [data-act=fav]')`;
  const tapHeart = async (p, uri) => { await ev(p, `${heart(uri)}.scrollIntoView({ block: 'center' })`); await sleep(80); await tap(p, heart(uri)); };

  // default kiosk mock: library_write off (a guest without the library class) → no hearts at all
  let p = await open('&tab=search&radio=1&stations=fake');
  await query(p, 'radio');
  let r = await rows(p);
  check('R1 no library_write → Search radio rows have no heart', r.some((x) => x.g === 'radio') && r.every((x) => x.fav === null), J(r.slice(0, 3)));
  await p.close();

  p = await open(`&tab=search&radio=1&stations=fake&kcaps=${encodeURIComponent(J({ library_write: true }))}`);
  await query(p, 'mock');
  r = await rows(p);
  const radio = r.filter((x) => x.g === 'radio'), other = r.filter((x) => x.g !== 'radio');
  // v0.7 hearts (default on): every result row but genres has a heart; `hearts: false` keeps the 0.6.2 radio-only heart (R2b)
  check('R2 library_write → a heart on every radio row (off) and on the other groups but genres (v0.7 hearts)', radio.length > 0 && radio.every((x) => x.fav === 'false')
    && other.filter((x) => x.g !== 'genres').length > 0 && other.every((x) => (x.g === 'genres' ? x.fav === null : x.fav !== null)), J({ radio, other: other.map((x) => x.g + ':' + x.fav) }));
  {
    const p2 = await open(`&tab=search&radio=1&stations=fake&kcaps=${encodeURIComponent(J({ library_write: true }))}&cfg=${encodeURIComponent(J({ hearts: false }))}`);
    await query(p2, 'mock');
    const r2 = await rows(p2);
    check('R2b hearts: false → 0.6.2: hearts on radio rows only', r2.some((x) => x.g === 'radio' && x.fav === 'false') && r2.filter((x) => x.g !== 'radio').length > 0
      && r2.filter((x) => x.g !== 'radio').every((x) => x.fav === null), J(r2.map((x) => x.g + ':' + x.fav)));
    await p2.close();
  }
  const st = radio[0].uri;
  let n = await nws(p);
  await tapHeart(p, st); await sleep(150);
  let m = maOf(await ws(p, n));
  check('R3 heart → jukebox_kiosk/ma music/favorites/add_item {item: the station uri}; heart on; toast', m.length === 1 && m[0].command === 'music/favorites/add_item' && J(m[0].args) === J({ item: st })
    && (await ev(p, `${heart(st)}.getAttribute('aria-pressed')`)) === 'true' && /^Added .+ to favorites$/.test(await toast(p)), J({ m, t: await toast(p) }));
  // 0.6.3 (ported from the design branch): the row still shows the provider copy; the heart looks up the library id first, then removes
  n = await nws(p);
  await tapHeart(p, st); await sleep(200);
  m = maOf(await ws(p, n));
  check('R4 provider result already in favorites → music/item_by_uri {uri}, then remove_item {radio, library id}; heart off',
    m.length === 2 && m[0].command === 'music/item_by_uri' && J(m[0].args) === J({ uri: st })
    && m[1].command === 'music/favorites/remove_item' && m[1].args.media_type === 'radio' && /^\d+$/.test(String(m[1].args.library_item_id))
    && (await ev(p, `${heart(st)}.getAttribute('aria-pressed')`)) === 'false' && /^Removed .+ from favorites$/.test(await toast(p)), J({ m, t: await toast(p) }));
  await tapHeart(p, st); await sleep(200); // favourite again for R5–R7
  // MA now returns the station's library copy: the heart is on and removes it
  await query(p, 'mockingbird');
  r = (await rows(p)).filter((x) => x.g === 'radio');
  const lib = r.find((x) => x.uri.startsWith('library://radio/'));
  check('R5 next search returns the library copy, heart on', !!lib && lib.fav === 'true', J(r));
  n = await nws(p);
  await tapHeart(p, lib.uri); await sleep(150);
  m = maOf(await ws(p, n));
  check('R6 heart on a library station → music/favorites/remove_item {media_type radio, library_item_id}; heart off',
    m.length === 1 && m[0].command === 'music/favorites/remove_item' && m[0].args.media_type === 'radio' && `library://radio/${m[0].args.library_item_id}` === lib.uri
    && (await ev(p, `${heart(lib.uri)}.getAttribute('aria-pressed')`)) === 'false' && /^Removed .+ from favorites$/.test(await toast(p)), J({ m, t: await toast(p) }));
  // favourite it again, then Browse > Radio (empty library before) lists it under Favorites
  await tapHeart(p, lib.uri); await sleep(200);
  await ev(p, `__card._tab = 'browse'`); await sleep(200);
  // 0.7.2: no tile home by default (separate layout here) → the Radio chip
  await wait(p, `${BR}.shadowRoot.querySelector('.cats .fc[data-cat=radio]')`);
  await sleep(300); await ev(p, `${BR}.shadowRoot.querySelector('.cats .fc[data-cat=radio]').click()`);
  const ok = await wait(p, `${BR}.shadowRoot.querySelector('[data-src=favorites]')?.children.length === 1`);
  check('R7 Browse › Radio → My stations shows the new favourite under Favorites', ok, J(await ev(p, `({ cats: [...${BR}.shadowRoot.querySelectorAll('[data-cat]')].map((b) => b.dataset.cat + (b.classList.contains('on') ? '*' : '')), cat: ${BR}._cat, secs: [...${BR}.shadowRoot.querySelectorAll('[data-src]')].map((g) => g.dataset.src + ':' + g.children.length), empty: ${BR}.shadowRoot.querySelector('[data-empty]')?.dataset.empty })`)));
  await p.close();

  // Browse › Radio already open (empty: "No stations yet"), then a heart in Search → Radio reloads with the favourite
  p = await open(`&tab=browse&lhome=0&radio=1&stations=fake&kcaps=${encodeURIComponent(J({ library_write: true }))}`);
  await wait(p, `${BR}.shadowRoot.querySelector('[data-cat=radio]')`); await sleep(200);
  await ev(p, `${BR}.shadowRoot.querySelector('[data-cat=radio]').click()`);
  const empty = await wait(p, `${BR}.shadowRoot.querySelector('[data-empty=stations]')`);
  await ev(p, `__card._tab = 'search'`); await sleep(200);
  await query(p, 'mock');
  const st3 = (await rows(p)).find((x) => x.g === 'radio').uri;
  await tapHeart(p, st3); await sleep(200);
  await ev(p, `__card._tab = 'browse'`);
  const fresh = await wait(p, `${BR}.shadowRoot.querySelector('[data-src=favorites]')?.children.length === 1 && !${BR}.shadowRoot.querySelector('[data-empty=stations]')`);
  check('R9 Browse › Radio cached empty → after a Search heart it reloads (Favorites: 1, no empty hint)', empty && fresh);
  await p.close();

  // failure: the server refuses → heart goes back off, toast says so
  p = await open(`&tab=search&radio=1&stations=fake&kcaps=${encodeURIComponent(J({ library_write: true }))}`);
  await query(p, 'mock');
  const st2 = (await rows(p)).find((x) => x.g === 'radio').uri;
  await ev(p, `(${SV}.config._backend.send = () => Promise.reject(new Error('unauthorized')))`);
  await tapHeart(p, st2); await sleep(200);
  check('R8 refused → heart back off, "Couldn\'t add … to favorites"', (await ev(p, `${heart(st2)}.getAttribute('aria-pressed')`)) === 'false' && /^Couldn.t add .+ to favorites$/.test(await toast(p)), await toast(p));
  await p.close();
}
// ---------------- 8. heart lookup (0.6.3, ported from the design branch): un-heart a non-library (provider) search result ----------------
{
  const SV = `__card.shadowRoot.querySelector('jb-search')`;
  const rows = (p) => ev(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].filter((r) => r.dataset.group === 'radio').map((r) => ({ uri: r.dataset.uri,
    name: r.querySelector('.t, .name, .title')?.textContent?.trim() ?? r.textContent.trim().slice(0, 40), fav: r.querySelector('[data-act=fav]')?.getAttribute('aria-pressed') ?? null }))`);
  const query = async (p, q) => { await ev(p, `${SV}.setQuery(${J(q)})`); await wait(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'radio')`); await sleep(150); };
  const toast = (p) => ev(p, `__card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelector('.st .ct')?.textContent?.trim() ?? ''`); // v0.7: hearts report in the top-right status chip
  const heart = (uri) => `${SV}.shadowRoot.querySelector('.row[data-uri="${uri}"] [data-act=fav]')`;
  const tapHeart = async (p, uri) => { await ev(p, `${heart(uri)}.scrollIntoView({ block: 'center' })`); await sleep(80); await tap(p, heart(uri)); };
  const pressed = (p, uri) => ev(p, `${heart(uri)}.getAttribute('aria-pressed')`);
  // station 1 (Mockingbird FM): favourite AND in the library; station 2: favourite on the provider only (not in the library).
  // radiohit=provider: MA's search returns the radiobrowser:// copies, not the library copy.
  const KQ = `&tab=search&radio=1&stations=fake&radiofav=2&radioinlib=1&radiohit=provider&kcaps=${encodeURIComponent(J({ library_write: true }))}`;
  let p = await open(KQ);
  await query(p, 'mockingbird');
  let r = await rows(p);
  const a = r.find((x) => x.uri.startsWith('radiobrowser://'));
  check('H1 search returns the provider copy of a library favourite: heart on', !!a && a.fav === 'true' && r.every((x) => !x.uri.startsWith('library://')), J(r));
  let n = await nws(p);
  await tapHeart(p, a.uri); await sleep(250);
  let m = maOf(await ws(p, n));
  const libId = m[1]?.args?.library_item_id;
  check('H2 un-heart → item_by_uri {uri: provider uri} (no allow_update_metadata; the server forces False) → remove_item {media_type radio, library_item_id from the lookup}; heart off; "Removed …"',
    m.length === 2 && m[0].command === 'music/item_by_uri' && J(m[0].args) === J({ uri: a.uri }) && m[1].command === 'music/favorites/remove_item'
    && m[1].args.media_type === 'radio' && /^\d+$/.test(String(libId)) && (await pressed(p, a.uri)) === 'false' && /^Removed .+ from favorites$/.test(await toast(p)),
    J({ m, t: await toast(p) }));
  await query(p, 'lakeside'); await query(p, 'mockingbird');
  check('H3 the favourite is gone in MA: a fresh search shows the heart off', (await rows(p)).find((x) => x.uri === a.uri)?.fav === 'false', J(await rows(p)));
  n = await nws(p);
  await tapHeart(p, a.uri); await sleep(200);
  await tapHeart(p, a.uri); await sleep(200);
  m = maOf(await ws(p, n));
  check('H4 heart again (add_item) then un-heart: the library id is remembered, no second lookup',
    m.map((x) => x.command).join() === 'music/favorites/add_item,music/favorites/remove_item' && String(m[1].args.library_item_id) === String(libId) && (await pressed(p, a.uri)) === 'false', J(m));

  // a provider favourite that is not in the library: nothing to remove in MA → heart stays on, says so, no remove sent
  await query(p, 'lakeside');
  const b = (await rows(p)).find((x) => x.fav === 'true');
  n = await nws(p);
  await tapHeart(p, b?.uri); await sleep(250);
  m = maOf(await ws(p, n));
  check('H5 not in the library → only item_by_uri, no remove_item; heart stays on; "… isn\'t in your library"',
    !!b && m.length === 1 && m[0].command === 'music/item_by_uri' && (await pressed(p, b.uri)) === 'true' && /isn.t in your library$/.test(await toast(p)), J({ b, m, t: await toast(p) }));

  // lookup refused (e.g. the server is down): heart back on, "Couldn't remove", no remove sent
  await p.close();
  p = await open(KQ); // fresh mock: station 1 is a library favourite again
  await query(p, 'mockingbird');
  await ev(p, `(() => { const be = ${SV}.config._backend, s0 = be.send.bind(be); be.send = (c, d) => (c === 'music/item_by_uri' ? Promise.reject(new Error('unavailable')) : s0(c, d)); })()`);
  n = await nws(p);
  await tapHeart(p, a.uri); await sleep(250);
  check('H6 lookup fails → heart back on, "Couldn\'t remove … from favorites", nothing written',
    (await pressed(p, a.uri)) === 'true' && /^Couldn.t remove .+ from favorites$/.test(await toast(p)) && maOf(await ws(p, n), 'music/favorites/remove_item').length === 0, await toast(p));
  await p.close();
}
// ---------------- 9. 0.6.3 station sheet: a station tap never plays; details, heart and Play live in the sheet ----------------
{
  const SV = `__card.shadowRoot.querySelector('jb-search')`;
  const ST = `__card.shadowRoot.querySelector('jb-station').shadowRoot`;
  const plays = (p) => ev(p, `window.__calls.filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => c.data)`);
  const sheet = (p) => ev(p, `(() => { const r = ${ST}; const sh = r.querySelector('.sheet'); if (!sh) return null; return { name: r.querySelector('.nm')?.textContent.trim(),
    fields: [...r.querySelectorAll('[data-field]')].map((f) => f.dataset.field + '=' + (f.querySelector('dd') ?? f).textContent.trim()),
    acts: [...r.querySelectorAll('[data-action]')].map((b) => b.dataset.action), fav: r.querySelector('[data-action=fav]')?.getAttribute('aria-pressed') ?? null,
    toast: __card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelector('.st .ct')?.textContent?.trim() ?? '' }; })()`);
  const tileOf = (name) => `[...${BR}.shadowRoot.querySelectorAll('.tile')].find((t) => t.querySelector('b').textContent.trim() === ${J(name)})`;
  const tapTile = async (p, name) => { await ev(p, `${tileOf(name)}.scrollIntoView({ block: 'center' })`); await sleep(80); await tap(p, tileOf(name)); await sleep(250); };
  const radioTab = async (p) => { await wait(p, `${BR}.shadowRoot.querySelector('[data-cat=radio]')`); await sleep(200);
    await ev(p, `${BR}.shadowRoot.querySelector('[data-cat=radio]').click()`); await wait(p, `${BR}.shadowRoot.querySelector('.grid.radio .tile')`); await sleep(150); };
  const LIB = `&kcaps=${encodeURIComponent(J({ library_write: true }))}`;

  let p = await open(`&tab=browse&lhome=0&radio=lib&stations=fake&radiofav=1${LIB}`);
  await radioTab(p);
  let n = await nws(p);
  await tapTile(p, 'Mockingbird FM');
  await wait(p, `${ST}.querySelector('[data-field=description]')`);
  let s = await sheet(p);
  let m = maOf(await ws(p, n));
  check('S1 Browse › Radio › Favorites: tap a station → station sheet, nothing played, no menu; details from music/item_by_uri',
    (await plays(p)).length === 0 && !(await ev(p, `!!${BR}.shadowRoot.querySelector('.menu')`)) && s?.name === 'Mockingbird FM' && m.length === 1 && m[0].command === 'music/item_by_uri'
    && J(Object.keys(m[0].args)) === J(['uri']), J({ s, m }));
  check('S2 description, provider (TuneIn), genre and stream quality shown; heart on (a favourite); Play and Close',
    s.fields.join('|') === 'description=' + s.fields[0].slice(12) + '|provider=TuneIn|genre=Easy listening, Pop|quality=MP3 · 128 kbps' && /fake morning show/.test(s.fields[0])
    && s.fav === 'true' && ['close', 'play', 'fav'].every((a) => s.acts.includes(a)), J(s));
  await tap(p, `${ST}.querySelector('[data-action=close]')`); await sleep(150);
  check('S3 Close → sheet gone, still nothing played', !(await sheet(p)) && (await plays(p)).length === 0);

  // a station MA knows nothing more about: empty fields are hidden
  await tapTile(p, 'Night Owl Radio'); await sleep(300);
  s = await sheet(p);
  check('S4 empty fields hidden (no description / genre / stream); only the provider MA reports', s?.name === 'Night Owl Radio' && s.fields.join() === 'provider=Radio Browser'
    && !(await ev(p, `!!${ST}.querySelector('.desc, [data-field=genre], [data-field=quality]')`)), J(s));
  // heart add, then remove (a library tile: the id is in its uri, no lookup)
  const tileUri = await ev(p, `__card.shadowRoot.querySelector('jb-station').item.uri`);
  const nightUri = await ev(p, `(() => { const s = __card.shadowRoot.querySelector('jb-station'); return (s._detail ?? s.item).uri; })()`); // the details MA returned (else the tile)
  n = await nws(p);
  await tap(p, `${ST}.querySelector('[data-action=fav]')`); await sleep(250);
  m = maOf(await ws(p, n));
  s = await sheet(p);
  check('S5 heart (off) → music/favorites/add_item {item: uri}; heart on; "Added … to favorites"', m.length === 1 && m[0].command === 'music/favorites/add_item' && J(m[0].args) === J({ item: nightUri })
    && s.fav === 'true' && /^Added Night Owl Radio to favorites$/.test(s.toast), J({ m, s }));
  n = await nws(p);
  await tap(p, `${ST}.querySelector('[data-action=fav]')`); await sleep(250);
  m = maOf(await ws(p, n));
  s = await sheet(p);
  // the kiosk mock lists the provider copy here, so the library id is looked up first (music/item_by_uri), like the Search heart
  const rm = m[m.length - 1];
  check('S6 heart (on) → item_by_uri lookup → music/favorites/remove_item {media_type radio, library_item_id}; heart off; "Removed …"',
    m.map((x) => x.command).join() === (nightUri.startsWith('library://') ? '' : 'music/item_by_uri,') + 'music/favorites/remove_item'
    && rm.args.media_type === 'radio' && /^\d+$/.test(String(rm.args.library_item_id)) && s.fav === 'false' && /^Removed .+ from favorites$/.test(s.toast), J({ m, s }));
  const onTop = await ev(p, `(() => { const c = __card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelector('.st'); if (!c) return 'no chip'; const r = c.getBoundingClientRect();
    const hit = __card.shadowRoot.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit?.localName ?? 'none'; })()`);
  check('S6b station sheet heart: the status chip shows above the open sheet (top right)', onTop === 'jb-speakers', onTop);
  // Play replaces the queue, like the old tap's Play now
  await tap(p, `${ST}.querySelector('[data-action=play]')`); await sleep(300);
  const pl = await plays(p);
  check('S7 Play → one play_media {station uri, media_type radio, enqueue play}; the sheet closes', pl.length === 1 && pl[0].media_id === tileUri && pl[0].media_type === 'radio'
    && pl[0].enqueue === 'play' && !('radio_mode' in pl[0]) && !(await sheet(p)), J(pl));
  await p.close();

  // guest without the library class: no heart
  p = await open('&tab=browse&lhome=0&radio=lib&stations=fake');
  await radioTab(p);
  await tapTile(p, 'Mockingbird FM'); await sleep(300);
  s = await sheet(p);
  check('S8 guest without library_write → sheet without a heart (Play and Close only)', s?.name === 'Mockingbird FM' && !s.acts.includes('fav') && s.acts.includes('play') && (await plays(p)).length === 0, J(s));
  await p.close();

  // Search radio rows: a tap opens the sheet; the row icons still play at once
  p = await open(`&tab=search&radio=1&stations=fake${LIB}`);
  await ev(p, `${SV}.setQuery('mockingbird')`); await wait(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'radio')`); await sleep(150);
  const st = await ev(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].find((r) => r.dataset.group === 'radio').dataset.uri`);
  const row = `${SV}.shadowRoot.querySelector('.row[data-uri="${st}"]')`;
  // v0.7 library-first labels push the radio group lower: bring the row on screen first
  await ev(p, `${row}.scrollIntoView({ block: 'center' })`); await sleep(120);
  await tap(p, `${row}.querySelector('.rt') ?? ${row}`); await sleep(300);
  s = await sheet(p);
  check('S9 Search radio row tap → station sheet, nothing played', s?.name === 'Mockingbird FM' && (await plays(p)).length === 0 && s.fav === 'false', J(s));
  // heart in the sheet on a provider result: add, then remove looks the library id up (item_by_uri) like the Search heart
  await tap(p, `${ST}.querySelector('[data-action=fav]')`); await sleep(250);
  check('S10 sheet heart on → the Search row heart follows', (await ev(p, `${row}.querySelector('[data-act=fav]').getAttribute('aria-pressed')`)) === 'true');
  n = await nws(p);
  await tap(p, `${ST}.querySelector('[data-action=fav]')`); await sleep(300);
  m = maOf(await ws(p, n));
  check('S11 sheet heart off on a provider result → item_by_uri lookup, then remove_item with the library id; heart off',
    m.map((x) => x.command).join() === 'music/item_by_uri,music/favorites/remove_item' && /^\d+$/.test(String(m[1].args.library_item_id)) && (await sheet(p)).fav === 'false', J(m));
  await ev(p, `__card.shadowRoot.querySelector('jb-station').dispatchEvent(new CustomEvent('jukebox-station-close', { bubbles: true, composed: true }))`); await sleep(150);
  await tap(p, `${row}.querySelector('[data-act=add]')`); await sleep(300);
  const pa = await plays(p);
  check('S12 the row Add icon still works as before (play_media enqueue add), no sheet', pa.length === 1 && pa[0].enqueue === 'add' && pa[0].media_id === st && !(await sheet(p)), J(pa));
  await p.close();
}
// ---------------- 10. v0.7 hearts: every row, tile and page (library class), one shared store, no confirmation ----------------
{
  const SV = `__card.shadowRoot.querySelector('jb-search')`;
  const BRs = `${BR}.shadowRoot`;
  const SDs = `${SV}.shadowRoot.querySelector('jb-detail')?.shadowRoot`;
  const KC = `&kcaps=${encodeURIComponent(J({ library_write: true }))}`;
  const pressedOf = (p, expr) => ev(p, `(${expr})?.getAttribute('aria-pressed') ?? null`);
  const favCmds = (msgs) => maOf(msgs).filter((m) => /^music\/(favorites|item_by_uri)/.test(m.command)).map((m) => [m.command.replace('music/', ''), m.args]);
  const tapEl = async (p, expr) => { await ev(p, `(${expr}).scrollIntoView({ block: 'center' })`); await sleep(80); await tap(p, expr); };

  // Library home: Playlists tiles carry a corner heart
  let p = await open(`&tab=browse&lhome=0${KC}`);
  await wait(p, `${BRs}.querySelectorAll('.tile .tfav').length > 3`);
  const tiles = await ev(p, `[...${BRs}.querySelectorAll('.tile')].map((t) => ({ uri: t.dataset.uri, type: t.dataset.type, fav: t.querySelector('.tfav')?.getAttribute('aria-pressed') ?? null }))`);
  check('K1 Library › Playlists: a corner heart on every tile, pressed = MA favourite', tiles.length > 3 && tiles.every((t) => t.fav !== null) && tiles.some((t) => t.fav === 'false'), J(tiles.slice(0, 4)));
  const pl = tiles.find((t) => t.fav === 'false');
  const tfav = `${BRs}.querySelector('.tile[data-uri="${pl.uri}"] .tfav')`;
  let n = await nws(p);
  await tapEl(p, tfav); await sleep(250);
  let c = favCmds(await ws(p, n));
  check('K2 playlist tile heart → favorites/add_item {item: playlist uri}; heart on; no playback, no detail opened',
    J(c) === J([['favorites/add_item', { item: pl.uri }]]) && (await pressedOf(p, tfav)) === 'true' && !(await ev(p, `${BRs}.querySelector('jb-detail')`))
    && (await ev(p, `window.__calls.filter((x) => x.service === 'play_media').length`)) === 0, J(c));
  n = await nws(p);
  await tapEl(p, tfav); await sleep(300);
  c = favCmds(await ws(p, n));
  check('K3 tap again → remove_item {playlist, library id} straight away (no confirmation); heart off; "Removed …"',
    c.length >= 1 && c[c.length - 1][0] === 'favorites/remove_item' && c[c.length - 1][1].media_type === 'playlist' && `library://playlist/${c[c.length - 1][1].library_item_id}` === pl.uri
    && (await pressedOf(p, tfav)) === 'false' && !(await ev(p, `${BRs}.querySelector('.confirm')`)) && /^Removed .+ from favorites$/.test(await ev(p, `__card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelector('.st .ct')?.textContent?.trim() ?? ''`)), J(c));
  // Library › Tracks: a row heart; the same track then shows hearted in Search (shared store)
  await ev(p, `${BRs}.querySelector('[data-cat=track]').click()`);
  await wait(p, `${BRs}.querySelectorAll('.row [data-act=fav]').length > 3`);
  const tr = await ev(p, `[...${BRs}.querySelectorAll('.row')].map((r) => ({ uri: r.dataset.uri, name: r.querySelector('.rt b')?.textContent, fav: r.querySelector('[data-act=fav]')?.getAttribute('aria-pressed') ?? null })).find((x) => x.fav === 'false')`);
  const rfav = `${BRs}.querySelector('.row[data-uri="${tr.uri}"] [data-act=fav]')`;
  n = await nws(p);
  await tapEl(p, rfav); await sleep(250);
  c = favCmds(await ws(p, n));
  check('K4 Library track row heart → add_item {item: track uri}; heart on', J(c) === J([['favorites/add_item', { item: tr.uri }]]) && (await pressedOf(p, rfav)) === 'true', J({ c, tr }));
  await ev(p, `__card._tab = 'search'`); await sleep(200);
  await ev(p, `${SV}.setQuery(${J(tr.name)})`);
  await wait(p, `${SV}.shadowRoot.querySelector('.row[data-uri="${tr.uri}"]')`); await sleep(150);
  check('K5 Search shows the same track hearted (one store for the whole card)', (await pressedOf(p, `${SV}.shadowRoot.querySelector('.row[data-uri="${tr.uri}"] [data-act=fav]')`)) === 'true');
  // album page from Search: header heart next to Play / Shuffle, and a heart on each track row
  await ev(p, `${SV}.setQuery('mock')`);
  await wait(p, `${SV}.shadowRoot.querySelector('.row[data-group=albums]')`); await sleep(150);
  const al = await ev(p, `[...${SV}.shadowRoot.querySelectorAll('.row[data-group=albums]')].map((r) => r.dataset.uri)[0] ?? null`);
  if (al) {
    await tapEl(p, `${SV}.shadowRoot.querySelector('.row[data-uri="${al}"] .rt')`);
    await wait(p, `${SDs}?.querySelector('.detail:not([data-loading]) .list.tracks .row')`); await sleep(150);
    const hdr = `${SDs}.querySelector('.da [data-act=fav]')`;
    const rowsH = await ev(p, `[...${SDs}.querySelectorAll('.list.tracks .row')].every((r) => r.querySelector('[data-act=fav]'))`);
    const order = await ev(p, `[...${SDs}.querySelector('.da').children].map((b) => b.dataset.action ?? b.dataset.act)`);
    check('K6 album page: header heart after Play / Shuffle, a heart on every track row', !!(await ev(p, hdr)) && rowsH && order[0] === 'play' && order[1] === 'shuffle' && order.includes('fav'), J(order));
    const was = await pressedOf(p, hdr);
    n = await nws(p);
    await tap(p, hdr); await sleep(300);
    c = favCmds(await ws(p, n));
    check('K7 header heart → add_item {item: album uri} (or remove when already on); pressed flips',
      c.length >= 1 && (was === 'false' ? J(c[0]) === J(['favorites/add_item', { item: al }]) : c[c.length - 1][1].media_type === 'album') && (await pressedOf(p, hdr)) === (was === 'false' ? 'true' : 'false'), J({ c, was }));
  } else check('K6 album page (an album in the search results)', false, 'no album row');
  await p.close();

  // Now Playing follows the store and pushes its own taps into it
  p = await open(`&tab=now${KC}`);
  const npUri = await ev(p, `__card.hass.states['${EV}'].attributes.media_content_id`);
  const npHeart = `${NP}.querySelector('.tb.fv')`;
  const before = await pressedOf(p, npHeart);
  await ev(p, `__card.favs.set(${J(npUri)}, ${before !== 'true'})`); await sleep(150);
  const after = await pressedOf(p, npHeart);
  check('K8 a heart elsewhere on the playing track shows on the Now Playing heart (either way)', !!before && after === (before === 'true' ? 'false' : 'true'), J({ npUri, before, after }));
  await tap(p, npHeart); await sleep(200);
  check('K8b a Now Playing heart tap → the shared store follows (rows showing the track follow too)', String(await ev(p, `__card.favs.isFav({ uri: ${J(npUri)}, favorite: false })`)) === before
    && (await pressedOf(p, npHeart)) === before, J(before));
  await p.close();

  // hearts: false → no hearts on Library tiles (0.6 behaviour); no library class → none either
  p = await open(`&tab=browse&lhome=0${KC}&cfg=${encodeURIComponent(J({ hearts: false }))}`);
  await wait(p, `${BRs}.querySelectorAll('.tile').length > 3`);
  const off1 = await ev(p, `${BRs}.querySelectorAll('[data-act=fav]').length`);
  await p.close();
  p = await open(`&tab=browse&lhome=0`);
  await wait(p, `${BRs}.querySelectorAll('.tile').length > 3`);
  const off2 = await ev(p, `${BRs}.querySelectorAll('[data-act=fav]').length`);
  check('K9 hearts: false, or no library class → no hearts in Library', off1 === 0 && off2 === 0, J({ off1, off2 }));
  await p.close();

  // ---- finished hearts (0.7.0): playlists in Search + playlist page, the status chip, Now Playing gating + rollback ----
  const CHIP = `__card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelector('.st')`;
  const chip = (p) => ev(p, `(() => { const c = ${CHIP}; if (!c) return null; const r = c.getBoundingClientRect(), h = __card.getBoundingClientRect();
    return { text: c.querySelector('.ct')?.textContent.trim(), kind: c.dataset.kind, top: r.top - h.top, right: h.right - r.right, left: r.left - h.left, w: h.width }; })()`);
  const viewToasts = (p) => ev(p, `['jb-search', 'jb-browse', 'jb-now', 'jb-station'].map((t) => __card.shadowRoot.querySelector(t)?.shadowRoot?.querySelector('.toast')?.textContent ?? '').filter(Boolean)`);
  p = await open(`&tab=search${KC}`);
  await ev(p, `${SV}.setQuery('mock')`);
  await wait(p, `${SV}.shadowRoot.querySelector('.row[data-group=playlists] [data-act=fav]')`); await sleep(150);
  const plr = await ev(p, `(() => { const r = ${SV}.shadowRoot.querySelector('.row[data-group=playlists]'); return { uri: r.dataset.uri, fav: r.querySelector('[data-act=fav]').getAttribute('aria-pressed') }; })()`);
  const plh = `${SV}.shadowRoot.querySelector('.row[data-uri="${plr.uri}"] [data-act=fav]')`;
  n = await nws(p);
  await tapEl(p, plh); await sleep(300);
  c = favCmds(await ws(p, n));
  const ch1 = await chip(p), vt1 = await viewToasts(p);
  check('K10 Search playlist row heart → favorites add/remove for the playlist; pressed flips',
    c.length >= 1 && (plr.fav === 'false' ? J(c[0]) === J(['favorites/add_item', { item: plr.uri }]) : c[c.length - 1][1].media_type === 'playlist') && (await pressedOf(p, plh)) === (plr.fav === 'false' ? 'true' : 'false'), J({ plr, c }));
  check('K11 heart outcome shows in the top-right status chip (info), not a centre / bottom toast',
    !!ch1 && ch1.kind === 'info' && /(Added|Removed) .+ (to|from) favorites$/.test(ch1.text) && ch1.top < 140 && ch1.right < 80 && ch1.left > ch1.w / 3 && vt1.length === 0, J({ ch1, vt1 }));
  // playlist page: header heart, follows the row heart (shared store)
  await tapEl(p, `${SV}.shadowRoot.querySelector('.row[data-uri="${plr.uri}"] .rt')`);
  await wait(p, `${SDs}?.querySelector('.detail:not([data-loading]) .da [data-act=fav]')`); await sleep(150);
  const ph = await pressedOf(p, `${SDs}.querySelector('.da [data-act=fav]')`);
  check('K12 playlist page: header heart shows the same state as the row heart', ph === (plr.fav === 'false' ? 'true' : 'false'), J({ ph, plr }));
  // a refused heart: back where it was, error chip with a Dismiss
  await ev(p, `(${SV}.config._backend.send = () => Promise.reject(new Error('unauthorized')))`);
  const hb = await pressedOf(p, `${SDs}.querySelector('.da [data-act=fav]')`);
  await tap(p, `${SDs}.querySelector('.da [data-act=fav]')`); await sleep(250);
  const ch2 = await chip(p);
  check('K13 refused → header heart rolls back; error chip "Couldn\'t …" with Dismiss, no popup',
    (await pressedOf(p, `${SDs}.querySelector('.da [data-act=fav]')`)) === hb && ch2?.kind === 'error' && /^Couldn.t (add|remove) .+ favorites$/.test(ch2.text)
    && !!(await ev(p, `${CHIP}.querySelector('[data-action=cancel]')`)) && !(await ev(p, `${SDs}.querySelector('.confirm')`)), J({ hb, ch2 }));
  await p.close();

  // Now Playing: hidden without the library class (kiosk); with it, a failed un-heart rolls back
  p = await open(`&tab=now`);
  await wait(p, `${NP}.querySelector('.tb.sh')`); await sleep(200);
  check('K14 kiosk user without the library class → no Now Playing heart', !(await ev(p, `${NP}.querySelector('.tb.fv')`)));
  await p.close();
  p = await open(`&tab=now${KC}`);
  await wait(p, `${NP}.querySelector('.tb.fv')`); await sleep(200);
  const npb = `${NP}.querySelector('.tb.fv')`;
  // the server refuses after a moment (so the optimistic flip can be seen first)
  await ev(p, `(__card.shadowRoot.querySelector('jb-now').config._backend.unfavoriteCurrent = () => new Promise((_, no) => setTimeout(() => no(new Error('unauthorized')), 400)))`);
  const b0 = await pressedOf(p, npb);
  await tap(p, npb);
  const mid = await pressedOf(p, npb);
  await sleep(700);
  const b1 = await pressedOf(p, npb), ch3 = await chip(p);
  check('K15 Now Playing un-heart fails → flips at once, then back on; error chip "Couldn\'t remove …"',
    b0 === 'true' && mid === 'false' && b1 === 'true' && ch3?.kind === 'error' && /^Couldn.t remove .+ from favorites$/.test(ch3.text), J({ b0, mid, b1, ch3 }));
  await p.close();
  p = await open(`&tab=now${KC}`);
  await wait(p, `${NP}.querySelector('.tb.fv')`); await sleep(200);
  await tap(p, npb); await sleep(400);
  const ch4 = await chip(p);
  check('K16 Now Playing heart → info chip naming the track (top right), heart off', (await pressedOf(p, npb)) === 'false' && ch4?.kind === 'info' && /^Removed .+ from favorites$/.test(ch4.text) && ch4.top < 140, J(ch4));
  await p.close();
}
// ---------------- 0.6.5 repeat one → repeat queue, only with Playback ----------------
{
  const reps = (p) => ev(p, `window.__calls.filter((c) => c.service === 'repeat_set').map((c) => ({ r: c.data.repeat, e: [c.target?.entity_id].flat().join() }))`);
  const shown = (p) => ev(p, `(() => { const b = ${NP}.querySelector('.tb.rp'); return b.classList.contains('on') && b.getAttribute('aria-label') === 'Repeat queue'; })()`);
  let p = await open('&repeat=one'); // plain kiosk user, default guest classes include playback
  await sleep(2200);
  let r = await reps(p);
  check('RP1 kiosk user with Playback: player on one → shown as repeat queue, exactly one repeat_set all on the target', (await shown(p)) && r.length === 1 && r[0].r === 'all' && r[0].e === EV, J(r));
  await p.close();
  p = await open(`&repeat=one&kcaps=${encodeURIComponent(J({ queue_play: false }))}`); // no Playback class
  await sleep(2200);
  r = await reps(p);
  check('RP2 kiosk user without Playback: shown as repeat queue, nothing sent', (await shown(p)) && r.length === 0, J(r));
  await p.close();
  p = await open('&repeat=one&kfail=capabilities'); // the server never says what the user may do
  await sleep(2200);
  r = await reps(p);
  check('RP3 capabilities unknown (server error) → nothing sent', r.length === 0, J(r));
  await p.close();
}
check('no page errors', pageErrors.length === 0, J(pageErrors.slice(0, 3)));
await browser.close();
console.log(`\n${total - failures}/${total} kiosk checks passed`);
process.exit(failures ? 1 : 0);

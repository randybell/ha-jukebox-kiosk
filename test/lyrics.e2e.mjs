// v0.4.0/0.4.1 lyrics + Stage + screensaver status + editor checks against the mock hass (dev/index.html, dev/editor.html). Real pointer/touch input via CDP.
// Usage: (starts its own dev server on a free port; JB_PORT / JB_URL override) node test/lyrics.e2e.mjs        — all lyric text in the harness is invented.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hermetic } from './intercept.mjs';
import { devRoot } from './serve.mjs';

const ROOT = await devRoot();
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, ok, info = '') { results.push({ name, ok, info }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const pageErrors = [];
async function newPage(vp = { width: 1280, height: 800 }) {
  const pg = await browser.newPage();
  await hermetic(pg);
  pg.on('pageerror', (e) => pageErrors.push(e.message + (process.env.JB_STACK ? ' @ ' + pg.url() + ' ' + String(e.stack).split('\n').slice(0, 4).join(' / ') : '')));
  await pg.setViewport({ deviceScaleFactor: 1, ...vp });
  return pg;
}
async function open(pg, q, page = 'index.html') {
  await pg.goto(`${ROOT}${page}?fresh=1&latency=40&layout=separate${q}`);
  await pg.waitForFunction('window.__ready === true');
  await sleep(150);
}
const SEL = {
  tab: `__card.shadowRoot.querySelector('jb-lyrics[mode=tab]')`,
  ovl: `__card.shadowRoot.querySelector('jb-now')?.shadowRoot.querySelector('jb-lyrics')`,
  stage: `__card.shadowRoot.querySelector('jb-lyrics[mode=stage]')`,
  saver: `__card.shadowRoot.querySelector('jb-lyrics[mode=saver]')`,
  now: `__card.shadowRoot.querySelector('jb-now').shadowRoot`,
};
const status = (pg, sel) => pg.evaluate((s) => eval(s)?.dataset.status ?? null, sel);
const waitStatus = (pg, sel, st, timeout = 8000) => pg.waitForFunction((s, st) => eval(s)?.dataset.status === st, { timeout }, sel, st).then(() => true, () => false);
const text = (pg, sel) => pg.evaluate((s) => eval(s)?.shadowRoot.textContent.replace(/\s+/g, ' ').trim() ?? '', sel);
const seeks = (pg) => pg.evaluate(() => __calls.filter((c) => c.service === 'media_seek'));
const lyrCmds = (pg) => pg.evaluate(() => __lyricsCalls().map((c) => c.data.command));
/** centre of line i inside a jb-lyrics */
const lineBox = (pg, sel, i) => pg.evaluate((s, i) => {
  const el = eval(s).shadowRoot.querySelector(`.ln[data-i="${i}"]`); const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2 < r.x + 120 ? r.x + r.width / 2 : r.x + 60, y: r.y + r.height / 2, t: Number(el.dataset.t), text: el.textContent, h: r.height };
}, sel, i);
const cur = (pg, sel) => pg.evaluate((s) => Number(eval(s).dataset.cur), sel);
/** expected current line from the entity's interpolated position + default 0.5 s offset */
const expectedCur = (pg, sel) => pg.evaluate((s) => {
  const a = __card.hass.states['media_player.everywhere'].attributes;
  const pos = Math.min(a.media_duration || 1e9, a.media_position + (Date.now() - Date.parse(a.media_position_updated_at)) / 1000) + 0.5;
  const ts = [...eval(s).shadowRoot.querySelectorAll('.ln')].map((l) => Number(l.dataset.t));
  let k = -1; ts.forEach((t, i) => { if (t <= pos) k = i; }); return { k, pos };
}, sel);

// ---------------- 1. tabs, surfaces, shared lookup ----------------
{
  const pg = await newPage();
  await open(pg, '&tab=lyrics');
  const tabs = await pg.evaluate(() => [...__card.shadowRoot.querySelectorAll('.tab')].map((t) => t.dataset.tab));
  check('T1 5th tab "lyrics" after Queue by default', J(tabs) === J(['now', 'browse', 'search', 'queue', 'lyrics']), J(tabs));
  const ok = await waitStatus(pg, SEL.tab, 'synced');
  check('T2 Lyrics tab: So What → synced (item_by_uri → get_track_lyrics)', ok && J(await lyrCmds(pg)) === J(['music/item_by_uri', 'metadata/get_track_lyrics']), J(await lyrCmds(pg)));
  const sc = await pg.evaluate((s) => { const c = eval(s).shadowRoot; return { lines: c.querySelectorAll('.ln').length, curEl: c.querySelectorAll('.ln.cur').length, hdr: c.querySelector('.hd b')?.textContent, chip: !!c.querySelector('.chip') }; }, SEL.tab);
  check('T3 tab header shows title, one highlighted line, no Unsynced chip for synced', sc.lines > 40 && sc.curEl === 1 && sc.hdr === 'So What' && !sc.chip, J(sc));
  const call0 = await pg.evaluate(() => __lyricsCalls()[0]);
  check('T4 send_command uses mass_queue_entry_id + return_response', call0.domain === 'mass_queue' && call0.returnResponse === true && call0.data.config_entry_id === '01MASSQUEUE0000000000000000' && call0.data.data.uri.startsWith('library://track/'));
  // current line follows interpolated position
  let curOk = false, info = '';
  for (let k = 0; k < 4 && !curOk; k++) { const e = await expectedCur(pg, SEL.tab); const c = await cur(pg, SEL.tab); curOk = c === e.k; info = `cur=${c} expected=${e.k} pos=${e.pos.toFixed(2)}`; if (!curOk) await sleep(120); }
  check('T5 current line = last line with t <= interpolated position + 0.5 s', curOk, info);
  // centred
  const cen = await pg.evaluate((s) => { const r = eval(s).shadowRoot; const sc = r.querySelector('.sc').getBoundingClientRect(); const c = r.querySelector('.ln.cur').getBoundingClientRect(); return Math.abs((c.top + c.height / 2) - (sc.top + sc.height / 2)); }, SEL.tab);
  check('T6 current line is scrolled to the middle of the view', cen < 60, `off by ${cen.toFixed(0)} px`);
  // advances by itself: jump the mock to 2 s before a line and wait
  const nxt = await pg.evaluate((s) => { const ln = [...eval(s).shadowRoot.querySelectorAll('.ln')].find((l) => Number(l.dataset.t) > 200 && l.textContent.trim() !== '♪'); return { i: Number(ln.dataset.i), t: Number(ln.dataset.t) }; }, SEL.tab);
  await pg.evaluate((t) => __hass.callService('media_player', 'media_seek', { seek_position: t - 1.8 }, { entity_id: 'media_player.everywhere' }), nxt.t);
  await sleep(300);
  const before = await cur(pg, SEL.tab);
  await sleep(1900);
  const after = await cur(pg, SEL.tab);
  check('T7 highlight advances on time without hass updates (timer to the next line)', before === nxt.i - 1 && after === nxt.i, `before=${before} after=${after} want ${nxt.i - 1}→${nxt.i}`);
  // switch tabs: Now Playing overlay off by default, toggle on → same store, no new lookup
  await pg.evaluate(() => __card.shadowRoot.querySelector('.tab[data-tab=now]').click());
  await sleep(250);
  const btns = await pg.evaluate((s) => { const r = eval(s); const b = r.querySelector('.ab.lyr'); return { lyr: !!b, on: b?.classList.contains('on'), pressed: b?.getAttribute('aria-pressed'), stg: !!r.querySelector('.ab.stg'), ovl: !!r.querySelector('jb-lyrics') }; }, SEL.now);
  check('O1 Now Playing: lyrics + full-screen buttons on the art, overlay off by default', btns.lyr && btns.stg && !btns.on && btns.pressed === 'false' && !btns.ovl, J(btns));
  const bx = await pg.evaluate((s) => { const r = eval(s).querySelector('.ab.lyr').getBoundingClientRect(); const a = eval(s).querySelector('.art').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, topRight: r.right > a.right - 140 && r.top < a.top + 80 }; }, SEL.now);
  await pg.mouse.click(bx.x, bx.y);
  await sleep(300);
  const on = await pg.evaluate((s) => ({ on: eval(s).querySelector('.ab.lyr').classList.contains('on'), ls: localStorage.getItem('jukebox-card:lyrics-overlay:v1') }), SEL.now);
  check('O2 toggle (top right of the art) turns the overlay on, stored per device in localStorage', on.on && on.ls === '1' && bx.topRight && (await status(pg, SEL.ovl)) === 'synced', J(on));
  check('O3 overlay, tab and card share one lookup (still 2 calls)', (await lyrCmds(pg)).length === 2, J(await lyrCmds(pg)));
  const bg = await pg.evaluate((s) => getComputedStyle(eval(s).querySelector('.ab.lyr')).backgroundColor, SEL.now);
  check('O4 active toggle is white (Black Frame Mono)', /rgb\(255, 255, 255\)|rgba\(255, 255, 255, 1\)/.test(bg), bg);
  await pg.goto(`${ROOT}index.html?keeplyrics=1&latency=40&layout=separate&tab=now`); await pg.waitForFunction('window.__ready === true'); await sleep(300);
  check('O5 overlay choice survives a reload', await pg.evaluate((s) => !!eval(s).querySelector('jb-lyrics') && eval(s).querySelector('.ab.lyr').classList.contains('on'), SEL.now));
  await pg.waitForFunction((s) => { try { return eval(s)?.dataset?.status === 'synced'; } catch { return false; } }, { timeout: 8000 }, SEL.ovl).catch(() => {});
  const lsText = await pg.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
  check('O6 reload: lyrics are fetched through MA again (never stored), and localStorage holds no lyric text',
    (await lyrCmds(pg)).length >= 1 && (await status(pg, SEL.ovl)) === 'synced' && !/Placeholder line one|cardboard stars/.test(lsText), J({ c: await lyrCmds(pg), ls: lsText.slice(0, 120) }));
  await pg.close();
}

// ---------------- 2. long-press seek vs tap ----------------
{
  const pg = await newPage();
  await open(pg, '&tab=lyrics');
  await waitStatus(pg, SEL.tab, 'synced');
  await sleep(600);
  const c = await cur(pg, SEL.tab);
  const target = c + 2;
  let L = await lineBox(pg, SEL.tab, target);
  // 0.7.8 #49: a plain tap returns to Now Playing (and never seeks)
  const tabNow = () => pg.evaluate(() => __card._tab);
  const back = async () => { await pg.evaluate(() => __card.shadowRoot.querySelector('.tab[data-tab=lyrics]').click()); await waitStatus(pg, SEL.tab, 'synced'); await sleep(600); L = await lineBox(pg, SEL.tab, target); };
  await pg.mouse.click(L.x, L.y);
  await sleep(700);
  check('P1 tap on a synced line does not seek, and returns to Now Playing (#49)', (await seeks(pg)).length === 0 && (await tabNow()) === 'now', await tabNow());
  await back();
  // short hold (250 ms): a tap too
  await pg.mouse.move(L.x, L.y); await pg.mouse.down(); await sleep(250); await pg.mouse.up(); await sleep(600);
  check('P2 short press (250 ms) does not seek (it is a tap: back to Now Playing)', (await seeks(pg)).length === 0 && (await tabNow()) === 'now', await tabNow());
  await back();
  // press + drag (scrolling): nothing
  await pg.mouse.move(L.x, L.y); await pg.mouse.down(); await sleep(120); await pg.mouse.move(L.x, L.y + 40, { steps: 4 }); await sleep(700); await pg.mouse.up(); await sleep(200);
  check('P3 press then move > 10 px cancels the long-press, and a drag is not a tap (stays on Lyrics, #49)', (await seeks(pg)).length === 0 && (await tabNow()) === 'lyrics', await tabNow());
  // hold feedback during the press
  L = await lineBox(pg, SEL.tab, target);
  await pg.mouse.move(L.x, L.y); await pg.mouse.down(); await sleep(250);
  const pressing = await pg.evaluate((s, i) => eval(s).shadowRoot.querySelector(`.ln[data-i="${i}"]`).classList.contains('press'), SEL.tab, target);
  await sleep(500);
  const s1 = await seeks(pg);
  const fb = await pg.evaluate((s, i) => { const r = eval(s).shadowRoot; return { flash: r.querySelector(`.ln[data-i="${i}"]`).classList.contains('flash'), toast: r.querySelector('.toast')?.textContent ?? '' }; }, SEL.tab, target);
  await pg.mouse.up(); await sleep(400);
  check('P4 visual feedback: line shows a hold bar while pressed', pressing);
  const want = Math.floor(L.t);
  check('P5 long-press (550 ms) → exactly one media_player.media_seek {seek_position: floor(line time)} on the card entity',
    s1.length === 1 && s1[0].domain === 'media_player' && s1[0].data.seek_position === want && J(s1[0].target) === J({ entity_id: 'media_player.everywhere' }), J(s1) + ` want ${want}`);
  check('P6 seek feedback: line flashes and "Jumped to m:ss" toast', fb.flash && fb.toast === `Jumped to ${Math.floor(want / 60)}:${String(want % 60).padStart(2, '0')}`, J(fb));
  const after = await cur(pg, SEL.tab);
  check('P7 after the seek the pressed line becomes current', after === target, `cur=${after} target=${target}`);
  check('P8 releasing after a long-press does not trigger a second action (no seek, stays on Lyrics)', (await seeks(pg)).length === 1 && (await tabNow()) === 'lyrics', await tabNow());
  // touch long-press at phone size
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await pg.reload(); await pg.waitForFunction('window.__ready === true');
  await waitStatus(pg, SEL.tab, 'synced'); await sleep(700);
  const c2 = await cur(pg, SEL.tab);
  const L2 = await lineBox(pg, SEL.tab, c2 + 1);
  await pg.touchscreen.tap(L2.x, L2.y); await sleep(700);
  check('P9 touch tap does not seek, returns to Now Playing (390x844)', (await seeks(pg)).length === 0 && (await tabNow()) === 'now', await tabNow());
  await pg.evaluate(() => __card.shadowRoot.querySelector('.tab[data-tab=lyrics]').click()); await waitStatus(pg, SEL.tab, 'synced'); await sleep(700);
  await pg.touchscreen.touchStart(L2.x, L2.y); await sleep(800); await pg.touchscreen.touchEnd(); await sleep(300);
  const s2 = await seeks(pg);
  check('P10 touch long-press seeks to that line (390x844)', s2.length === 1 && s2[0].data.seek_position === Math.floor(L2.t), J(s2.map((x) => x.data)));
  // overlay long-press also works; Stage taps do not seek
  await pg.close();
}

// ---------------- 2b. #49 tap anywhere returns to the player ----------------
{
  const pg = await newPage();
  const tabNow = () => pg.evaluate(() => __card._tab);
  const center = (sel) => pg.evaluate((s) => { const r = eval(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
  const LY = `${SEL.tab}.shadowRoot.querySelector('.ly')`;
  await open(pg, '&tab=lyrics'); await waitStatus(pg, SEL.tab, 'synced'); await sleep(600);
  // the header (track title) area is part of the lyrics body
  let c = await center(`${SEL.tab}.shadowRoot.querySelector('.hd')`);
  await pg.mouse.click(c.x, c.y); await sleep(400);
  check('TP1 tap on the lyrics header/body → Now Playing', (await tabNow()) === 'now', await tabNow());
  await pg.evaluate(() => __card.shadowRoot.querySelector('.tab[data-tab=lyrics]').click()); await waitStatus(pg, SEL.tab, 'synced'); await sleep(600);
  // touch drag (scroll) is not a tap
  await pg.setViewport({ width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); await sleep(400);
  c = await center(LY);
  const cdp = await pg.target().createCDPSession();
  const tp = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: c.x, y }] });
  await tp('touchStart', c.y); for (let k = 1; k <= 8; k++) { await tp('touchMove', c.y - k * 12); await sleep(16); } await tp('touchEnd'); await sleep(500);
  check('TP2 touch drag over the lyrics (scroll) stays on Lyrics', (await tabNow()) === 'lyrics', await tabNow());
  // a tap that lands while the lyrics are still scrolling (ends a fling) does not count
  await pg.evaluate((s) => { const sc = eval(s).shadowRoot.querySelector('.sc'); sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true })); sc.scrollTop += 60; sc.dispatchEvent(new Event('scroll')); }, SEL.tab);
  await pg.touchscreen.tap(c.x, c.y); await sleep(400);
  check('TP3 a tap right after a scroll (stopping it) stays on Lyrics', (await tabNow()) === 'lyrics', await tabNow());
  await sleep(400);
  await pg.touchscreen.tap(c.x, c.y); await sleep(400);
  check('TP4 a later plain touch tap → Now Playing', (await tabNow()) === 'now', await tabNow());
  // the tab bar and the header keep their own behavior
  await pg.evaluate(() => __card.shadowRoot.querySelector('.tab[data-tab=lyrics]').click()); await sleep(400);
  c = await center(`__card.shadowRoot.querySelector('.tab[data-tab=queue]')`); await pg.touchscreen.tap(c.x, c.y); await sleep(400);
  check('TP5 tab bar on the Lyrics screen: Queue tab opens Queue (not Now Playing)', (await tabNow()) === 'queue', await tabNow());
  await pg.close();
  // empty / loading / error states
  const p2 = await newPage();
  const t2 = () => p2.evaluate(() => __card._tab);
  const mid = async () => { const r = await p2.evaluate((s) => { const b = eval(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, `${SEL.tab}.shadowRoot.querySelector('.ly')`); await p2.mouse.click(r.x, r.y); await sleep(400); };
  await open(p2, '&tab=lyrics&lyrics=none'); await waitStatus(p2, SEL.tab, 'none'); await mid();
  check('TP6 "No lyrics found": tap → Now Playing', (await t2()) === 'now', await t2());
  await open(p2, '&tab=lyrics&lyrlat=60000'); await sleep(300);
  const ld = await status(p2, SEL.tab); await mid();
  check('TP7 "Looking for lyrics…": tap → Now Playing', ld === 'loading' && (await t2()) === 'now', J({ ld, tab: await t2() }));
  await open(p2, '&tab=lyrics&lyrfail=perm'); await waitStatus(p2, SEL.tab, 'error');
  const n0 = (await lyrCmds(p2)).length;
  const rb = await p2.evaluate((s) => { const b = eval(s).shadowRoot.querySelector('.retry').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, SEL.tab);
  await p2.mouse.click(rb.x, rb.y); await sleep(400);
  check('TP8 Try again button only retries (stays on Lyrics)', (await lyrCmds(p2)).length > n0 && (await t2()) === 'lyrics', J({ tab: await t2() }));
  await mid();
  check('TP9 error state: tap elsewhere → Now Playing', (await t2()) === 'now', await t2());
  // Now Playing artwork overlay: a tap closes the overlay (stays on Now Playing); a drag does not
  await open(p2, '&tab=now&overlay=1'); await waitStatus(p2, SEL.ovl, 'synced'); await sleep(500);
  const ob = await p2.evaluate((s) => { const b = eval(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height * 0.7 }; }, SEL.ovl);
  await p2.mouse.move(ob.x, ob.y); await p2.mouse.down(); await p2.mouse.move(ob.x, ob.y - 40, { steps: 4 }); await p2.mouse.up(); await sleep(300);
  check('TP10 drag on the artwork lyrics overlay keeps it open', await p2.evaluate((s) => !!eval(s), SEL.ovl));
  const lyb = await p2.evaluate((s) => { const b = eval(s).querySelector('.ab.lyr').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, SEL.now);
  await p2.mouse.click(ob.x, ob.y); await sleep(400);
  const ov = await p2.evaluate((s) => ({ ovl: !!eval(s).querySelector('jb-lyrics'), on: eval(s).querySelector('.ab.lyr').classList.contains('on'), ls: localStorage.getItem('jukebox-card:lyrics-overlay:v1') }), SEL.now);
  check('TP11 tap on the artwork lyrics overlay closes it (back to the plain player), remembered', !ov.ovl && !ov.on && ov.ls !== '1' && (await t2()) === 'now', J(ov));
  await p2.mouse.click(lyb.x, lyb.y); await sleep(400);
  check('TP12 the corner Lyrics button still toggles the overlay on', await p2.evaluate((s) => !!eval(s).querySelector('jb-lyrics'), SEL.now));
  // Stage: unchanged (tap toggles its controls, does not close it)
  await p2.close();
}

// ---------------- 3. plain lyrics ----------------
{
  const pg = await newPage();
  await open(pg, '&tab=lyrics');
  await waitStatus(pg, SEL.tab, 'synced');
  await pg.evaluate(() => __playTrack('Dreams', 200));
  const ok = await waitStatus(pg, SEL.tab, 'plain');
  const info = await pg.evaluate((s) => { const r = eval(s).shadowRoot; const sc = r.querySelector('.sc'); return { chip: r.querySelector('.chip')?.textContent, cur: r.querySelectorAll('.ln.cur').length, top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight }; }, SEL.tab);
  check('U1 plain lyrics: "Unsynced" chip, no highlighted line', ok && info.chip === 'Unsynced' && info.cur === 0, J(info));
  await sleep(2300);
  const top = await pg.evaluate((s) => eval(s).shadowRoot.querySelector('.sc').scrollTop, SEL.tab);
  check('U2 plain lyrics scroll in proportion to progress (200 s of 257 s → past the middle)', info.max <= 0 || top > info.max * 0.5, `top=${top} max=${info.max}`);
  const L = await pg.evaluate((s) => { const sc = eval(s).shadowRoot.querySelector('.sc').getBoundingClientRect(); return { x: sc.x + 80, y: sc.y + sc.height / 2 }; }, SEL.tab);
  await pg.mouse.move(L.x, L.y); await pg.mouse.down(); await sleep(800); await pg.mouse.up(); await sleep(200);
  check('U3 long-press on plain lyrics never seeks', (await seeks(pg)).length === 0);
  // manual override: wheel scroll up, the auto scroll leaves it alone
  await pg.mouse.move(L.x, L.y); await pg.mouse.wheel({ deltaY: -2000 }); await sleep(2600);
  const top2 = await pg.evaluate((s) => eval(s).shadowRoot.querySelector('.sc').scrollTop, SEL.tab);
  check('U4 manual scroll wins over the auto scroll', top2 < top - 50, `auto=${top} after manual=${top2}`);
  // Teardrop: synced via item metadata (no get_track_lyrics)
  const n = (await lyrCmds(pg)).length;
  await pg.evaluate(() => __playTrack('Teardrop', 40));
  await waitStatus(pg, SEL.tab, 'synced');
  const cmds = (await lyrCmds(pg)).slice(n);
  check('U5 lyrics in item metadata are used directly (one call)', J(cmds) === J(['music/item_by_uri']), J(cmds));
  await pg.close();
}

// ---------------- 4. radio ----------------
{
  const pg = await newPage();
  await open(pg, '&tab=lyrics');
  await waitStatus(pg, SEL.tab, 'synced');
  const n = (await lyrCmds(pg)).length;
  await pg.evaluate(() => __setNowPlaying({ title: 'Massive Attack - Teardrop', radio: true }));
  const ok = await waitStatus(pg, SEL.tab, 'synced');
  await sleep(200);
  const calls = await pg.evaluate((n) => __lyricsCalls().slice(n).map((c) => ({ cmd: c.data.command, d: c.data.data })), n);
  check('R1 radio "Artist - Title" → music/search → best match → lyrics (synced)', ok && calls[0]?.cmd === 'music/search' && /Massive Attack - Teardrop/.test(calls[0].d.search_query) && J(calls[0].d.media_types) === J(['track']), J(calls.map((c) => c.cmd)));
  const L = await lineBox(pg, SEL.tab, Math.max(0, await cur(pg, SEL.tab)) + 1);
  await pg.mouse.move(L.x, L.y); await pg.mouse.down(); await sleep(800); await pg.mouse.up(); await sleep(200);
  check('R2 radio: long-press never seeks', (await seeks(pg)).length === 0);
  await pg.evaluate(() => __setNowPlaying({ artist: 'Nobody Known', title: 'Unknown Jingle', radio: true }));
  const none = await waitStatus(pg, SEL.tab, 'none');
  check('R3 radio with no library match → "No lyrics found"', none && (await text(pg, SEL.tab)).includes('No lyrics found'));
  await pg.close();
}

// ---------------- 5. loading / none / errors ----------------
{
  const pg = await newPage();
  await open(pg, '&tab=lyrics&lyrlat=1500');
  check('M1 slow lookup shows "Looking for lyrics…" (no spinner)', (await status(pg, SEL.tab)) === 'loading' && (await text(pg, SEL.tab)).includes('Looking for lyrics…') && !(await pg.evaluate((s) => !!eval(s).shadowRoot.querySelector('ha-circular-progress, .spinner'), SEL.tab)));
  const seen = await pg.evaluate((s) => new Promise((res) => { const el = eval(s); const st = []; const mo = new MutationObserver(() => { if (st[st.length - 1] !== el.dataset.status) st.push(el.dataset.status); if (el.dataset.status === 'synced') { mo.disconnect(); res(st); } }); mo.observe(el, { attributes: true }); setTimeout(() => res(st), 6000); }), SEL.tab);
  check('M2 loading → synced with no flicker in between', J(seen) === J(['synced']), J(seen));
  await open(pg, '&tab=lyrics&lyrics=none');
  check('M3 nothing found → "No lyrics found"', (await waitStatus(pg, SEL.tab, 'none')) && (await text(pg, SEL.tab)).includes('No lyrics found'));
  await open(pg, '&tab=lyrics&lyrfail=perm');
  const perm = await waitStatus(pg, SEL.tab, 'error');
  check('M4 permission error (non-admin / Unauthorized) → "Lyrics unavailable" + Try again', perm && (await text(pg, SEL.tab)).includes('Lyrics unavailable') && (await text(pg, SEL.tab)).includes('Try again'));
  const n = (await lyrCmds(pg)).length;
  await pg.evaluate((s) => eval(s).shadowRoot.querySelector('.retry').click(), SEL.tab);
  await sleep(300);
  check('M5 Try again looks up again', (await lyrCmds(pg)).length > n && (await status(pg, SEL.tab)) === 'error');
  await open(pg, '&tab=lyrics&lyrfail=err');
  check('M6 generic failure → "Lyrics unavailable"', (await waitStatus(pg, SEL.tab, 'error')) && (await text(pg, SEL.tab)).includes('Lyrics unavailable'));
  await open(pg, '&tab=now&overlay=1&lyrfail=err');
  await waitStatus(pg, SEL.ovl, 'error');
  check('M7 overlay error stays quiet (no Try again button on the art)', !(await pg.evaluate((s) => !!eval(s).shadowRoot.querySelector('.retry'), SEL.ovl)) && (await text(pg, SEL.ovl)).includes('Lyrics unavailable'));
  await open(pg, '&tab=lyrics&noqueue=1');
  const cfg = await waitStatus(pg, SEL.tab, 'error');
  check('M8 no mass_queue_entry_id → "Lyrics unavailable" + config hint, no calls', cfg && (await text(pg, SEL.tab)).includes('mass_queue_entry_id') && (await lyrCmds(pg)).length === 0);
  await open(pg, '&tab=lyrics&legacyq=1');
  check('M9 legacy queue_config_entry_id still works for lyrics', await waitStatus(pg, SEL.tab, 'synced'));
  await open(pg, '&tab=lyrics&idle=1');
  check('M10 idle player → "Nothing playing", no calls', (await text(pg, SEL.tab)).includes('Nothing playing') && (await lyrCmds(pg)).length === 0);
  await pg.close();
}

// ---------------- 6. options ----------------
{
  const pg = await newPage();
  const cfg = (o) => '&cfg=' + encodeURIComponent(J(o));
  await open(pg, '&tab=now' + cfg({ lyrics_tab: false }));
  const t1 = await pg.evaluate(() => [...__card.shadowRoot.querySelectorAll('.tab')].map((t) => t.dataset.tab).join());
  check('C1 lyrics_tab:false → 4 tabs, overlay button still there', t1 === 'now,browse,search,queue' && (await pg.evaluate((s) => !!eval(s).querySelector('.ab.lyr'), SEL.now)), t1);
  await open(pg, '&tab=now&overlay=1' + cfg({ show_lyrics: false }));
  await sleep(300);
  const off = await pg.evaluate((s) => ({ tabs: __card.shadowRoot.querySelectorAll('.tab').length, lyr: !!eval(s).querySelector('.ab.lyr'), ovl: !!eval(s).querySelector('jb-lyrics') }), SEL.now);
  check('C2 show_lyrics:false → no tab, no overlay, no lookups', off.tabs === 4 && !off.lyr && !off.ovl && (await lyrCmds(pg)).length === 0, J(off));
  await open(pg, '&tab=lyrics' + cfg({ lyrics_seek: false }));
  await waitStatus(pg, SEL.tab, 'synced'); await sleep(400);
  const L = await lineBox(pg, SEL.tab, (await cur(pg, SEL.tab)) + 1);
  await pg.mouse.move(L.x, L.y); await pg.mouse.down(); await sleep(800); await pg.mouse.up();
  check('C3 lyrics_seek:false → long-press does nothing', (await seeks(pg)).length === 0);
  const bad = await pg.evaluate(() => { const r = []; for (const c of [{ lyrics_offset_ms: 9000 }, { show_lyrics: 'yes' }, { lyrics_seek: 1 }]) { try { __card.setConfig({ ...__card._config, ...c }); r.push('ok'); } catch (e) { r.push('err'); } } return r; });
  check('C4 setConfig rejects lyrics_offset_ms out of ±5000, non-boolean flags', J(bad) === J(['err', 'err', 'err']), J(bad));
  const good = await pg.evaluate(() => { const r = []; for (const m of [0, 1, 10, 1440, 37]) { try { __card.setConfig({ ...__card._config, screensaver_minutes: m }); r.push('ok'); } catch (e) { r.push(e.message); } } return r; });
  const lenient = await pg.evaluate(() => { try { __card.setConfig({ ...__card._config, default_tab: 'lyrics', lyrics_tab: false }); return 'ok'; } catch (e) { return e.message; } });
  check('C4b default_tab: lyrics with the tab turned off is ignored like any unknown tab (as in 0.3.x), not an error', lenient === 'ok', lenient);
  check('C5 screensaver_minutes 0, 1, 10, 1440 and odd values like 37 still load', good.every((x) => x === 'ok'), J(good));
  await open(pg, '&tab=lyrics' + cfg({ lyrics_offset_ms: 3000 }));
  await waitStatus(pg, SEL.tab, 'synced'); await sleep(300);
  const e = await expectedCur(pg, SEL.tab);
  const withOff = await pg.evaluate((s, base) => { const ts = [...eval(s).shadowRoot.querySelectorAll('.ln')].map((l) => Number(l.dataset.t)); let k = -1; ts.forEach((t, i) => { if (t <= base + 2.5) k = i; }); return k; }, SEL.tab, e.pos);
  check('C6 lyrics_offset_ms shifts the highlight', (await cur(pg, SEL.tab)) === withOff, `cur=${await cur(pg, SEL.tab)} want=${withOff}`);
  await pg.close();
}

// ---------------- 7. Stage + screensaver ----------------
{
  const pg = await newPage({ width: 1920, height: 1080 });
  await open(pg, '&tab=now');
  const b = await pg.evaluate((s) => { const r = eval(s).querySelector('.ab.stg').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, SEL.now);
  await pg.mouse.click(b.x, b.y);
  await sleep(500);
  const st = await pg.evaluate(() => ({ mode: __card.dataset.stage, el: !!__card.shadowRoot.querySelector('.stage'), fs: !!(document.fullscreenElement || document.webkitFullscreenElement) }));
  check('G1 full-screen button opens the Stage (Fullscreen API or fixed overlay fallback)', st.el && (st.mode === 'fullscreen' || st.mode === 'overlay'), J(st));
  check('G2 Stage shows synced lyrics', await waitStatus(pg, SEL.stage, 'synced'));
  // 0.7.8: Stage has no on-screen controls; a plain tap anywhere closes it (back to Now Playing)
  const ctl = await pg.evaluate(() => { const st = __card.shadowRoot.querySelector('.stage'); return { buttons: st.querySelectorAll('button').length, x: !!st.querySelector('.st-x, .st-top'), ctl: !!st.querySelector('.st-ctl'), ui: st.classList.contains('ui') }; });
  check('G3 Stage has no controls: no Close button, no Previous/Play/Next bar', ctl.buttons === 0 && !ctl.x && !ctl.ctl && !ctl.ui, J(ctl));
  const pc0 = (await pg.evaluate(() => __calls.length));
  await pg.mouse.click(960, 540); await sleep(400);
  const after = await pg.evaluate((n) => ({ st: !!__card.shadowRoot.querySelector('.stage'), ds: __card.dataset.stage ?? '', fs: !!document.fullscreenElement, tab: __card._tab,
    calls: __calls.slice(n).filter((c) => /^media_/.test(c.service)).map((c) => c.service) }), pc0);
  check('G4 a plain tap closes the Stage, back on Now Playing; the tap does not also hit the player underneath', !after.st && !after.ds && !after.fs && after.tab === 'now' && after.calls.length === 0, J(after));
  const ppb = await pg.evaluate((s) => { const r = eval(s).querySelector('.tb.pp').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, SEL.now);
  await pg.mouse.click(b.x, b.y); await waitStatus(pg, SEL.stage, 'synced'); await sleep(500);
  const pc1 = await pg.evaluate(() => __calls.length);
  await pg.mouse.click(ppb.x, ppb.y); await sleep(500);
  const ghost = await pg.evaluate((n) => ({ st: !!__card.shadowRoot.querySelector('.stage'), calls: __calls.slice(n).filter((c) => /^media_/.test(c.service)).map((c) => c.service) }), pc1);
  check('G4b a tap on the Stage right where Play/Pause sits underneath closes the Stage only (no play/pause)', !ghost.st && ghost.calls.length === 0, J(ghost));
  await pg.mouse.click(b.x, b.y); await waitStatus(pg, SEL.stage, 'synced'); await sleep(500);
  await pg.mouse.move(600, 500); await pg.mouse.down(); await pg.mouse.move(600, 440, { steps: 5 }); await pg.mouse.up(); await sleep(300);
  check('G5 a drag on the Stage does not close it', await pg.evaluate(() => !!__card.shadowRoot.querySelector('.stage')));
  await pg.evaluate((s) => { const sc = eval(s).shadowRoot.querySelector('.sc'); sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true })); sc.scrollTop += 80; sc.dispatchEvent(new Event('scroll')); }, SEL.stage);
  await pg.mouse.click(1300, 500); await sleep(300);
  check('G5b a tap right after scrolling the Stage lyrics (stopping the scroll) does not close it', await pg.evaluate(() => !!__card.shadowRoot.querySelector('.stage')));
  await pg.mouse.move(1300, 500); await pg.mouse.down(); await sleep(650); await pg.mouse.up(); await sleep(300);
  check('G5c a slow press (> 500 ms) on the background does not close it', await pg.evaluate(() => !!__card.shadowRoot.querySelector('.stage')));
  await pg.keyboard.press('Escape'); await sleep(400);
  check('G6 Esc closes the Stage', await pg.evaluate(() => !__card.shadowRoot.querySelector('.stage')));
  // fullscreenchange: leaving native fullscreen from outside closes the Stage
  await pg.mouse.click(b.x, b.y); await sleep(400);
  const native = await pg.evaluate(() => __card.dataset.stage);
  if (native === 'fullscreen') {
    await pg.evaluate(() => document.exitFullscreen()); await sleep(500);
    check('G7 exiting fullscreen from outside (fullscreenchange) closes the Stage', await pg.evaluate(() => !__card.shadowRoot.querySelector('.stage')));
  } else {
    await pg.evaluate(() => __card.closeStage()); await sleep(200);
    check('G7 (fallback overlay mode in this browser) Stage closes via closeStage()', await pg.evaluate(() => !__card.shadowRoot.querySelector('.stage')), 'native fullscreen refused: ' + native);
  }
  // Stage: long-press on a line still seeks (and keeps the Stage open); a plain tap on a line closes it without seeking
  await pg.mouse.click(b.x, b.y); await waitStatus(pg, SEL.stage, 'synced'); await sleep(600);
  const n0 = (await seeks(pg)).length;
  const L = await lineBox(pg, SEL.stage, (await cur(pg, SEL.stage)) + 1);
  await pg.mouse.move(L.x, L.y); await pg.mouse.down(); await sleep(800); await pg.mouse.up(); await sleep(300);
  const sk = (await seeks(pg)).slice(n0);
  check('G8 long-press on a Stage line seeks, and the Stage stays open', sk.length === 1 && sk[0].data.seek_position === Math.floor(L.t) && await pg.evaluate(() => !!__card.shadowRoot.querySelector('.stage')), J(sk.map((s) => s.data)));
  const L2 = await lineBox(pg, SEL.stage, (await cur(pg, SEL.stage)) + 1);
  await pg.mouse.click(L2.x, L2.y); await sleep(500);
  check('G9 a plain tap on a Stage line closes the Stage and does not seek', (await seeks(pg)).length === n0 + 1 && await pg.evaluate(() => !__card.shadowRoot.querySelector('.stage') && __card._tab === 'now'));
  await pg.close();

  const sv = await newPage();
  await open(sv, '&tab=now&saver=0.02');
  await sv.waitForFunction((s) => !!eval(s), { timeout: 6000 }, SEL.saver).catch(() => {});
  await sleep(800);
  // 0.5.0: a clipped window over a column of every line; the column slides up so the current line sits in the middle slot
  const three = await sv.evaluate((s) => { const el = eval(s); if (!el) return null; const r = el.shadowRoot, w = r.querySelector('.win')?.getBoundingClientRect();
    const vis = [...r.querySelectorAll('.win > .col > .ln')].filter((l) => { const b = l.getBoundingClientRect(); return w && b.bottom > w.top + 4 && b.top < w.bottom - 4; });
    const c = r.querySelector('.win > .col > .ln.cur');
    return { n: vis.length, cur: c?.textContent, mid: !!c && vis.indexOf(c) === 1 }; }, SEL.saver);
  check('V1 screensaver shows previous / current / next line when synced (current in the middle slot)', three?.n === 3 && !!three.cur && three.mid, J(three));
  await sv.evaluate(() => __playTrack('Dreams', 120)); await sleep(800);
  const plain = await sv.evaluate((s) => !!eval(s)?.shadowRoot.querySelector('.m-saver.st-plain .win > .col'), SEL.saver);
  check('V2 screensaver shows a slow-moving plain block (window + column) for unsynced lyrics', plain);
  await open(sv, '&tab=now&saver=0.02&lyrics=none');
  await sleep(2200);
  check('V3 screensaver without lyrics looks like before (no lyrics element)', await sv.evaluate(() => !!__card.shadowRoot.querySelector('.sv, .saver, [class*=sv-]') && !__card.shadowRoot.querySelector('jb-lyrics[mode=saver]')));
  await open(sv, '&tab=now&saver=0.02' + '&cfg=' + encodeURIComponent(J({ screensaver_lyrics: false })));
  await sleep(2200);
  check('V4 screensaver_lyrics:false → no lyrics on the screensaver', await sv.evaluate(() => !__card.shadowRoot.querySelector('jb-lyrics[mode=saver]')));

  // 0.4.1: a quiet status line on the screensaver when there are no lyrics to show (none / unavailable / loading)
  const svLabel = (pg) => pg.evaluate(() => {
    const r = __card.shadowRoot, el = r.querySelector('.saver .sv-lys');
    if (!el) return { shown: false, status: __card.lyrics.state.status, lyricsEl: !!r.querySelector('jb-lyrics[mode=saver]') };
    const cs = getComputedStyle(el), drift = el.closest('.sv-drift');
    const box = (e) => { const b = e?.getBoundingClientRect(); return b ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
    const hit = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const me = box(el), alpha = Number((cs.color.match(/rgba?\(([^)]+)\)/)?.[1].split(',')[3] ?? '1').trim());
    return { shown: true, text: el.textContent.trim(), status: __card.lyrics.state.status, dataStatus: el.dataset.status,
      lyricsEl: !!r.querySelector('jb-lyrics[mode=saver]'), inDrift: !!drift, driftAnim: drift ? getComputedStyle(drift).animationName : '',
      fontPx: parseFloat(cs.fontSize), alpha, shadow: cs.textShadow !== 'none',
      overlaps: ['.sv-clock', '.sv-date', '.sv-np', '.sv-hint'].filter((s) => hit(me, box(r.querySelector('.saver ' + s)))),
      onScreen: me.l >= 0 && me.t >= 0 && me.r <= innerWidth && me.b <= innerHeight };
  });
  const quiet = (l) => l.shown && l.inDrift && l.driftAnim !== 'none' && !l.lyricsEl && l.fontPx <= 15 && l.alpha > 0 && l.alpha <= 0.5 && l.shadow && l.overlaps.length === 0;
  const states = [
    ['V5', 'none', '&lyrics=none', 'No lyrics'],
    ['V6', 'error', '&lyrfail=err', 'Lyrics unavailable'],
    ['V7', 'loading', '&lyrlat=60000', 'Looking for lyrics…'],
  ];
  for (const [id, st, q, label] of states) {
    await open(sv, '&tab=now&saver=0.02' + q);
    await sv.waitForFunction((st) => __card.lyrics.state.status === st && !!__card.shadowRoot.querySelector('.saver .sv-lys'), { timeout: 8000 }, st).catch(() => {});
    await sleep(300);
    const l = await svLabel(sv);
    check(`${id} screensaver, lyrics ${st} → small translucent "${label}" inside the drifting block, clear of clock/track/hint`, quiet(l) && l.text === label && l.dataStatus === st && l.onScreen, J(l));
  }
  // reduced motion: the label still rides the block's 60 s hop
  await sv.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await open(sv, '&tab=now&saver=0.02&lyrics=none');
  await sv.waitForSelector('pierce/.saver .sv-lys', { timeout: 8000 }).catch(() => {});
  const rm = await svLabel(sv);
  check('V8 reduced motion: the status line moves with the hop animation', rm.shown && rm.driftAnim === 'hop', J({ shown: rm.shown, driftAnim: rm.driftAnim }));
  await sv.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // hidden when lyrics are showing, or when lyrics are off for the screensaver
  await open(sv, '&tab=now&saver=0.02');
  await sv.waitForFunction((s) => !!eval(s), { timeout: 8000 }, SEL.saver).catch(() => {});
  await sleep(600);
  const syn = await svLabel(sv);
  check('V9 synced lyrics on the screensaver → no status line', !syn.shown && syn.lyricsEl, J(syn));
  await sv.evaluate(() => __playTrack('Dreams', 120)); await sleep(800);
  const pl = await svLabel(sv);
  check('V10 plain lyrics on the screensaver → no status line', !pl.shown && pl.lyricsEl, J(pl));
  for (const [id, cfg] of [['V11', { screensaver_lyrics: false }], ['V12', { show_lyrics: false }]]) {
    await open(sv, '&tab=now&saver=0.02&lyrics=none&cfg=' + encodeURIComponent(J(cfg)));
    await sleep(2200);
    const off = await svLabel(sv);
    check(`${id} ${Object.keys(cfg)[0]}: false + no lyrics → no status line`, !off.shown && !off.lyricsEl, J(off));
  }
  // the status line follows the store: loading → none without leaving the screensaver
  await open(sv, '&tab=now&saver=0.02&lyrics=none&lyrlat=1500');
  await sv.waitForFunction(() => __card.shadowRoot.querySelector('.saver .sv-lys')?.dataset.status === 'loading', { timeout: 8000 }).catch(() => {});
  const t1 = (await svLabel(sv)).text;
  await sv.waitForFunction(() => __card.shadowRoot.querySelector('.saver .sv-lys')?.dataset.status === 'none', { timeout: 8000 }).catch(() => {});
  const t2 = (await svLabel(sv)).text;
  check('V13 status line updates live: "Looking for lyrics…" then "No lyrics"', t1 === 'Looking for lyrics…' && t2 === 'No lyrics', J([t1, t2]));
  await sv.close();
}

// ---------------- 7b. direction: lyrics always move UP (0.5.0) ----------------
// Every surface, synced and plain: advance the mock across 3+ line changes (synced) or 3+ progress steps (plain), sample
// every frame with getBoundingClientRect and assert the lines only ever move upward on screen (the saver: relative to
// its slow burn-in drift block, which may drift down on its own), and that new lines come in from the bottom.
{
  const DSEL = { overlay: SEL.ovl, tab: SEL.tab, stage: SEL.stage, saver: SEL.saver };
  async function direction(surface, kind, { rm = false } = {}) {
    const pg = await newPage(surface === 'stage' ? { width: 1920, height: 1080 } : { width: 1280, height: 800 });
    if (rm) await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const q = surface === 'tab' ? '&tab=lyrics' : surface === 'overlay' ? '&tab=now&overlay=1' : surface === 'saver' ? '&tab=now&saver=0.02' : '&tab=now';
    await open(pg, q);
    await pg.evaluate((t) => __playTrack(t, 20), kind === 'plain' ? 'Dreams' : 'So What');
    if (surface === 'stage') { await sleep(300); await pg.evaluate(() => __card.openStage()); }
    const ok = await waitStatus(pg, DSEL[surface], kind, 12000);
    await sleep(1200);
    await pg.evaluate((s) => {
      window.__fr = []; let last = -1e9; window.__stopFr = false;
      const tick = () => {
        const now = performance.now();
        if (now - last >= 16) { last = now; const el = eval(s); if (el) {
          const r = el.shadowRoot, sc = r.querySelector('.sc'), col = r.querySelector('.win > .col'), drift = __card.shadowRoot.querySelector('.sv-drift');
          const dy = drift ? drift.getBoundingClientRect().top : 0;
          __fr.push({ cur: Number(el.dataset.cur), st: sc ? sc.scrollTop : null, cy: col ? Number(col.dataset.y ?? NaN) : null,
            lines: [...r.querySelectorAll('.ln[data-i]')].map((l) => { const b = l.getBoundingClientRect(); return [l.dataset.i, b.top, b.top - dy]; }) });
        } }
        if (!window.__stopFr) requestAnimationFrame(tick);
      }; requestAnimationFrame(tick);
    }, DSEL[surface]);
    const seek = (p) => pg.evaluate((p) => __hass.callService('media_player', 'media_seek', { seek_position: p }, { entity_id: 'media_player.everywhere' }), p);
    if (kind === 'synced') {
      const L = await pg.evaluate(() => __card.lyrics.state.lines.map((l) => l.t));
      let k = Math.max(1, await cur(pg, DSEL[surface]));
      for (let n = 0; n < 3; n++) { k += 1; if (k % 8 === 7) k += 1; await seek(L[k] - 1.4); await sleep(2000); }
    } else for (const p of [50, 90, 130, 170]) { await seek(p); await sleep(2300); }
    const fr = await pg.evaluate(() => { window.__stopFr = true; return __fr; });
    await pg.close();
    // per frame, per line (matched by data-i): on-screen dy and dy relative to the drift block
    let up = 0, down = 0, maxDownRel = 0, maxDownScr = 0, changes = 0, fromBelow = 0;
    for (let i = 1; i < fr.length; i++) {
      const a = new Map(fr[i - 1].lines.map((l) => [l[0], l]));
      const ds = [], dr = [];
      for (const l of fr[i].lines) { const p = a.get(l[0]); if (p) { ds.push(l[1] - p[1]); dr.push(l[2] - p[2]); } }
      if (dr.length) { const m = dr.sort((x, y) => x - y)[dr.length >> 1]; if (m < 0) up -= m; else down += m; maxDownRel = Math.max(maxDownRel, m); }
      if (ds.length) maxDownScr = Math.max(maxDownScr, ds.sort((x, y) => x - y)[ds.length >> 1]);
      if (fr[i].cur !== fr[i - 1].cur && fr[i].cur >= 0) {
        changes++;
        // the new current line is below where it settles (it comes in from the bottom and moves up)
        const key = String(fr[i].cur), y0 = fr[i - 1].lines.find((l) => l[0] === key)?.[2], end = fr[Math.min(fr.length - 1, i + 50)].lines.find((l) => l[0] === key)?.[2];
        if (y0 != null && end != null && y0 > end + 4) fromBelow++;
      }
    }
    const mono = (xs) => xs.filter((x) => x != null && !Number.isNaN(x)).every((x, i, arr) => !i || x >= arr[i - 1] - 0.5);
    return { ok, frames: fr.length, up: Math.round(up), down: +down.toFixed(1), maxDownRel: +maxDownRel.toFixed(2), maxDownScr: +maxDownScr.toFixed(2), changes, fromBelow,
      scrollMono: mono(fr.map((f) => f.st)), colMono: mono(fr.map((f) => f.cy)) };
  }
  for (const surface of ['overlay', 'stage', 'tab', 'saver']) for (const kind of ['synced', 'plain']) {
    const d = await direction(surface, kind);
    // the saver's drift block may move down by itself (< 1 px a frame); everything else never moves down at all
    const scrOk = surface === 'saver' ? d.maxDownScr < 1 : d.maxDownScr <= 0.5;
    const enough = kind === 'synced' ? d.changes >= 3 && d.fromBelow >= 3 && d.up > 100 : d.up > 100;
    check(`D ${surface} ${kind}: lines only move up (${kind === 'synced' ? '3+ line changes, new lines come in from the bottom' : '3+ progress steps'})`,
      d.ok && enough && d.maxDownRel <= 0.5 && scrOk && d.scrollMono && d.colMono, J(d));
  }
  // reduced motion: the saver column still steps upward (instantly, no transition)
  for (const kind of ['synced', 'plain']) {
    const d = await direction('saver', kind, { rm: true });
    check(`D saver ${kind}, prefers-reduced-motion: moves up in instant steps, never down`, d.ok && d.up > 100 && d.maxDownRel <= 0.5 && d.colMono, J(d));
  }
  // .rm (the card mirrors reduced motion onto ha-card) turns the column transition off
  {
    const pg = await newPage();
    await pg.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await open(pg, '&tab=now&saver=0.02');
    await waitStatus(pg, SEL.saver, 'synced', 8000);
    const tr = await pg.evaluate((s) => { const c = eval(s).shadowRoot.querySelector('.win > .col'); const cs = getComputedStyle(c); return { dur: cs.transitionDuration, rm: !!__card.shadowRoot.querySelector('.rm') }; }, SEL.saver);
    check('D saver: reduced motion → no slide transition on the column', tr.dur.split(',').every((x) => parseFloat(x) === 0), J(tr));
    await pg.close();
  }
}

// ---------------- 8. editor ----------------
{
  const pg = await newPage({ width: 900, height: 1200 });
  const ed = (q) => open(pg, q, 'editor.html');
  const opts = () => pg.evaluate(() => [...__editor.shadowRoot.querySelector('ha-form').querySelectorAll('[data-name=screensaver_minutes] select option')].map((o) => [o.value, o.textContent]));
  const changes = () => pg.evaluate(() => __changes);
  const base = { type: 'custom:jukebox-card', entity: 'media_player.everywhere', config_entry_id: '01MUSICASSISTANT0000000000', mass_queue_entry_id: '01MASSQUEUE0000000000000000' };
  await ed('&cfg=' + encodeURIComponent(J(base)));
  const secs = await pg.evaluate(() => [...__editor.shadowRoot.querySelector('ha-form').querySelectorAll('details[data-section]')].map((d) => d.dataset.section));
  check('E1 editor has Display and Lyrics sections', secs.includes('display') && secs.includes('lyrics'), J(secs));
  const o = await opts();
  check('E2 screensaver presets Off/1/5/10/15/30/60 + custom', J(o.map((x) => x[0]).filter((v) => v !== '__custom')) === J(['0', '1', '5', '10', '15', '30', '60']) && o[0][1] === 'Off' && o.some((x) => x[0] === '__custom'), J(o));
  const val = await pg.evaluate(() => __editor.shadowRoot.querySelector('ha-form').querySelector('[data-name=screensaver_minutes] select').value);
  check('E3 no screensaver_minutes in config → shows the default 10', val === '10', val);
  await pg.select('pierce/[data-name=screensaver_minutes] select', '30');
  await sleep(150);
  let ch = await changes();
  const last = ch[ch.length - 1];
  check('E4 picking 30 → config screensaver_minutes: 30 (a number), nothing else added', last?.screensaver_minutes === 30 && J(Object.keys(last).sort()) === J([...Object.keys(base), 'screensaver_minutes'].sort()), J(last));
  await pg.evaluate(() => { const c = __editor.shadowRoot.querySelector('ha-form').querySelector('[data-name=screensaver_minutes] .custom'); c.value = '45'; c.dispatchEvent(new Event('change')); });
  await sleep(150);
  ch = await changes();
  check('E5 custom 45 → screensaver_minutes: 45', ch[ch.length - 1]?.screensaver_minutes === 45);
  await pg.evaluate(() => { const c = __editor.shadowRoot.querySelector('ha-form').querySelector('[data-name=screensaver_minutes] .custom'); c.value = '99999'; c.dispatchEvent(new Event('change')); });
  await sleep(150);
  ch = await changes();
  check('E6 custom out of range clamps to 1440', ch[ch.length - 1]?.screensaver_minutes === 1440, J(ch[ch.length - 1]?.screensaver_minutes));
  for (const m of [7, 0, 1440, 2]) {
    await ed('&cfg=' + encodeURIComponent(J({ ...base, screensaver_minutes: m })));
    const v = await pg.evaluate(() => __editor.shadowRoot.querySelector('ha-form').querySelector('[data-name=screensaver_minutes] select').value);
    const label = (await opts()).find((x) => x[0] === String(m))?.[1] ?? '';
    const custom = ![0, 1, 5, 10, 15, 30, 60].includes(m);
    check(`E7 existing config screensaver_minutes: ${m} loads and is selected${custom ? ' as "(custom)"' : ''}`, v === String(m) && (!custom || /custom/.test(label)), `${v} ${label}`);
  }
  // backward compatibility: an old 0.3.x config + unrelated edit → no new lyrics keys appear
  const old = { ...base, screensaver_minutes: 15, rooms: [{ name: 'Kitchen', entity: 'media_player.kitchen' }], favorite_entity: 'button.x' };
  await ed('&cfg=' + encodeURIComponent(J(old)));
  await pg.evaluate(() => { const i = __editor.shadowRoot.querySelector('ha-form').querySelector('[data-name=entity] input'); i.value = 'media_player.other'; i.dispatchEvent(new Event('change')); });
  await sleep(150);
  ch = await changes();
  const out = ch[ch.length - 1] ?? {};
  check('E8 old config, unrelated edit → only that key changes; rooms kept; no lyrics keys added', out.entity === 'media_player.other' && J(out.rooms) === J(old.rooms) && out.screensaver_minutes === 15 && !Object.keys(out).some((k) => /lyric/.test(k)), J(out));
  const lyr = await pg.evaluate(() => [...__editor.shadowRoot.querySelector('ha-form').querySelectorAll('details[data-section=lyrics] [data-name]')].map((e) => e.dataset.name));
  check('E9 Lyrics section: show_lyrics, lyrics_tab, lyrics_seek, lyrics_offset_ms; screensaver_lyrics under Display', J(lyr) === J(['show_lyrics', 'lyrics_tab', 'lyrics_seek', 'lyrics_offset_ms']) && (await pg.evaluate(() => !!__editor.shadowRoot.querySelector('ha-form').querySelector('details[data-section=display] [data-name=screensaver_lyrics]'))), J(lyr));
  await pg.evaluate(() => { const i = __editor.shadowRoot.querySelector('ha-form').querySelector('[data-name=lyrics_tab] input'); i.checked = false; i.dispatchEvent(new Event('change')); });
  await sleep(150);
  ch = await changes();
  check('E10 unticking Lyrics tab → lyrics_tab: false', ch[ch.length - 1]?.lyrics_tab === false);
  await pg.close();
}

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
await browser.close();
console.log(`\n${results.length - failures}/${results.length} lyrics checks passed`);
writeFileSync(SHOTS + 'lyrics-results.json', J(results, null, 2));
process.exit(failures ? 1 : 0);

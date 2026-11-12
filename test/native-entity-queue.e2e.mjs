// 0.8.2 / #94: a card pointed at a native media_player of a speaker (e.g. the WiiM integration's own entity: platform wiim, no
// active_queue, Music Assistant has no queue by its id) must use the Music Assistant media_player of the same speaker (same friendly
// name) for every call: the Queue tab, Up next, playing a track. The target picker offers that speaker once, as its MA player, and
// no player that has no MA player at all. Mock: dev/mock-hass.js `wiim=1`. Viewport 1024x600 only: touch (tap, hold, swipe), mouse,
// physical keyboard. Usage: node test/native-entity-queue.e2e.mjs (starts its own dev server). SHOTS=<dir> writes screenshots.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const SHOTS = process.env.SHOTS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const NAT = 'media_player.master_bedroom_master_bedroom', MAE = 'media_player.wiim_sound_lite_aaf2', ORPH = 'media_player.hall_orphan', EVERY = 'media_player.everywhere';
const CARD = `__card.shadowRoot`;
const QV = `${CARD}.querySelector('jb-queue').shadowRoot`;
const NV = `${CARD}.querySelector('jb-now').shadowRoot`;
const SV = `${CARD}.querySelector('jb-browse').shadowRoot`;
const HS = `${CARD}.querySelector('jb-hold-sheet').shadowRoot`;
const SP = `${CARD}.querySelector('jb-speakers').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 6000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2, w: r.width }; }, expr);

async function open(query, cfg = {}) {
  const page = await browser.newPage();
  await hermetic(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&wiim=1&admin=1${query}&cfg=${encodeURIComponent(J(cfg))}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(300);
  return page;
}
/** one press by touch tap, mouse click, or keyboard (focus, Enter) */
async function press(p, kind, expr) {
  if (kind === 'keyclick') { await ev(p, `(${expr}).click()`); await sleep(250); return; } // keyboard-style activation (a hardware Enter in Search opens the top result instead)
  if (kind === 'key') { await ev(p, `(${expr}).scrollIntoView({ block: 'nearest' }); (${expr}).focus()`); await p.keyboard.press('Enter'); await sleep(250); return; }
  const c = await center(p, expr);
  if (!c || !c.w) throw new Error('no element to press: ' + expr);
  if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y);
  await sleep(250);
}
/** press and hold a row by touch or mouse */
async function hold(p, kind, expr, ms = 700) {
  const c = await center(p, expr);
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(ms); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(ms); await p.mouse.up(); }
  await sleep(300);
}
async function swipe(p, expr) {
  const c = await center(p, expr);
  await p.touchscreen.touchStart(c.x, c.y);
  for (let i = 1; i <= 6; i++) { await p.touchscreen.touchMove(c.x, c.y - i * 25); await sleep(30); }
  await p.touchscreen.touchEnd(); await sleep(300);
}
const mark = (p) => ev(p, `window.__mark = (window.__ws || []).length; window.__calls.length = 0; true`);
const qws = (p) => ev(p, `(window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /^player_queues\\//.test(m.command)).map((m) => ({ c: m.command.split('/')[1], a: m.args }))`);
const playCalls = (p) => ev(p, `window.__calls.filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => ({ e: c.target?.entity_id, enq: c.data.enqueue }))`);
const wsEntities = (p) => ev(p, `[...new Set((window.__ws || []).filter((m) => m.entity_id).map((m) => m.entity_id))]`);
const rowsText = (p) => ev(p, `[...${QV}.querySelectorAll('.qr')].map((r) => r.querySelector('.rt b, .rt .t, .rt')?.textContent.trim().split('\\n')[0])`);
const titles = (p) => ev(p, `[...${QV}.querySelectorAll('.qr')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`);
const unavailable = (p) => ev(p, `${QV}.textContent.includes('Queue unavailable')`);
const tab = async (p, id) => { await ev(p, `${CARD}.querySelector('.tab[data-tab="${id}"]').click()`); await sleep(500); };
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const sheetItems = (p) => ev(p, `[...${HS}.querySelectorAll('.it')].map((b) => b.dataset.action)`);

// ================= A. fixed mode, the card's player is the native entity =================
for (const kind of ['touch', 'mouse', 'key']) {
  const p = await open('&tab=queue', { entity: NAT });
  const ok = await wait(p, `${QV}.querySelectorAll('.qr').length > 3`);
  const T = await titles(p);
  check(`N1 [${kind}] Queue tab shows the Master Bedroom queue (Porcelain playing, Angel, Dreams next), not "Queue unavailable"`,
    ok && !(await unavailable(p)) && /Porcelain/.test(T[1] ?? '') && T.some((x) => /Angel/.test(x)) && T.some((x) => /Dreams/.test(x)), J(T));
  check(`N2 [${kind}] the card controls the MA player of the speaker (${MAE}); the header still reads Master Bedroom`,
    (await ev(p, `__card._config.entity`)) === MAE
    && (await ev(p, `__card.hass.states[__card._config.entity].attributes.friendly_name`)) === 'Master Bedroom', await ev(p, `__card._config.entity`));
  const ents = await wsEntities(p);
  check(`N3 [${kind}] the server is asked about the MA player only, never the native entity`, ents.includes(MAE) && !ents.includes(NAT), J(ents));
  await shot(p, `native-queue-${kind}`);

  // Up next on Now Playing
  await tab(p, 'now');
  const up = await ev(p, `${NV}.textContent.replace(/\\s+/g, ' ')`);
  check(`N4 [${kind}] Now Playing: the player is Porcelain and Up next is Angel`, /Porcelain/.test(up) && /Up next\s*Angel/.test(up), up.slice(0, 300));
  await tab(p, 'queue');
  await wait(p, `${QV}.querySelectorAll('.qr').length > 3`);

  await mark(p);
  if (kind === 'key') {
    // physical keyboard: Queue search typed on the keyboard filters the MA queue; Enter on a row's Play Now plays it
    await ev(p, `${QV}.querySelector('[data-action="queue-search"]').click()`); await sleep(300);
    await p.keyboard.type('DREAMS'); await sleep(500);
    const f = await titles(p);
    check('N5 [key] typing on the keyboard in Queue search finds Dreams in the Master Bedroom queue', f.length === 1 && /Dreams/.test(f[0]), J(f));
    await press(p, 'key', `${QV}.querySelector('.qr .ra-b[data-act="replace"]')`);
    if (await ev(p, `!!${QV}.querySelector('.confirm')`)) await press(p, 'key', `${QV}.querySelector('.confirm [data-action="confirm"]')`);
  } else {
    const row = (i) => `${QV}.querySelectorAll('.qr.next')[${i}].querySelector('.rt')`;
    await press(p, kind, row(1));
    check(`N5 [${kind}] ${kind === 'touch' ? 'a tap on' : 'a click on'} a Queue row opens the pop-up and sends nothing`, (await sheetOpen(p)) && (await sheetItems(p)).includes('play') && J(await qws(p)) === '[]', J(await sheetItems(p)));
    await press(p, kind, `${HS}.querySelector('.it[data-action="play"]')`);
    if (await ev(p, `!!${QV}.querySelector('.confirm')`)) await press(p, kind, `${QV}.querySelector('.confirm [data-action="confirm"]')`);
  }
  await sleep(600);
  const w = await qws(p);
  check(`N6 [${kind}] Play Now on a queue row → play_index on Master Bedroom's own queue (wiim_mock_master)`, w.some((m) => m.c === 'play_index' && m.a.queue_id === 'wiim_mock_master'), J(w));
  if (kind === 'key') { await ev(p, `${QV}.querySelector('[data-action="queue-search"]').click()`); await sleep(300); }
  check(`N7 [${kind}] after it, the Master Bedroom queue shows that song playing`, await wait(p, `/Dreams/.test(${QV}.querySelector('.qr.now')?.textContent ?? '')`), J(await titles(p)));
  await p.close();
}
// touch / mouse hold and a touch swipe on a Queue row
for (const kind of ['touch', 'mouse']) {
  const p = await open('&tab=queue', { entity: NAT });
  await wait(p, `${QV}.querySelectorAll('.qr.next').length > 2`); await sleep(300);
  const row = `${QV}.querySelectorAll('.qr.next')[1].querySelector('.rt')`;
  await mark(p);
  await hold(p, kind, row);
  check(`N8 [${kind}] press and hold on a Queue row opens the pop-up with the six choices + More Info`, (await sheetOpen(p)) && J(await sheetItems(p)) === J(['play', 'next', 'up', 'down', 'remove', 'more', 'cancel']), J(await sheetItems(p)));
  await press(p, kind, `${HS}.querySelector('[data-action="down"]')`); await sleep(700);
  const w = await qws(p);
  check(`N9 [${kind}] Move down → move_item on the Master Bedroom queue`, w.some((m) => m.c === 'move_item' && m.a.queue_id === 'wiim_mock_master' && m.a.pos_shift === 1), J(w));
  if (kind === 'touch') {
    await mark(p);
    await swipe(p, `${QV}.querySelectorAll('.qr.next')[2].querySelector('.rt')`);
    check('N10 [touch] a swipe on a Queue row scrolls and sends nothing, no pop-up', !(await sheetOpen(p)) && J(await qws(p)) === '[]', J(await qws(p)));
  }
  await p.close();
}

// ================= B. play a track from the Library search (separate Search tab) =================
for (const kind of ['touch', 'mouse', 'key']) {
  const p = await open('&layout=separate&tab=search', { entity: NAT });
  const SVS = `${CARD}.querySelector('jb-search').shadowRoot`;
  const kb = `${SVS}.querySelector('jb-keyboard')`;
  await sleep(900);
  if (kind === 'key') await p.keyboard.type('EAGLES');
  else { const qb = await center(p, `${SVS}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300); }
  if (kind !== 'key') for (const ch of 'EAGLES') { const c = await center(p, `[...${kb}.shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`); await p.touchscreen.tap(c.x, c.y); await sleep(100); }
  await sleep(500);
  await ev(p, `[...${SVS}.querySelectorAll('button')].find((x) => /^\\s*tracks\\s*$/i.test(x.textContent))?.click()`); await sleep(500);
  const have = await wait(p, `!!${SVS}.querySelector('.row[data-type="track"] .ra-b[data-act="next"]')`);
  await mark(p);
  await press(p, kind === 'key' ? 'keyclick' : kind, `${SVS}.querySelector('.row[data-type="track"] .ra-b[data-act="next"]')`);
  let c = await playCalls(p);
  check(`P1 [${kind}] Play Next on a found track → play_media next on ${MAE} (not the native entity)`, have && c.length === 1 && c[0].e === MAE && c[0].enq === 'next', J(c));
  await mark(p);
  await press(p, kind === 'key' ? 'keyclick' : kind, `${SVS}.querySelector('.row[data-type="track"] .ra-b[data-act="replace"]')`);
  await press(p, kind === 'key' ? 'keyclick' : kind, `${SVS}.querySelector('.confirm [data-action="confirm"]')`);
  c = await playCalls(p);
  check(`P2 [${kind}] Play Now (confirmed) → play_media replace on ${MAE}`, c.length === 1 && c[0].e === MAE && c[0].enq === 'replace', J(c));
  await tab(p, 'queue');
  const T = await titles(p);
  check(`P3 [${kind}] the Master Bedroom queue now holds the played track (no "Queue unavailable")`, !(await unavailable(p)) && T.length >= 1, J(T));
  check(`P4 [${kind}] no music_assistant service call was sent to the native entity`, (await ev(p, `window.__calls.filter((c) => c.domain === 'music_assistant' && [c.target?.entity_id].flat().includes('${NAT}')).length`)) === 0);
  await p.close();
}

// ================= C. dynamic mode: the "Playing on" picker =================
const TG = [{ entity: EVERY, name: 'Everywhere' }, { entity: NAT, name: 'Master Bedroom' }, { entity: ORPH, name: 'Hall' }, { entity: 'media_player.indoor', name: 'Indoor' }];
for (const kind of ['touch', 'mouse', 'key']) {
  const p = await open('&spk=dyn&tab=queue&idle=1', { speaker_mode: 'dynamic', entity: EVERY, targets: TG });
  await sleep(700); // Everywhere is idle here, so picking another group is a plain switch (no transfer question)
  await press(p, kind === 'key' ? 'mouse' : kind, `${CARD}.querySelector('.pill')`);
  await wait(p, `${SP}.querySelectorAll('.chip[data-target]').length > 1`);
  const chips = await ev(p, `[...${SP}.querySelectorAll('.chip[data-target]')].map((c) => c.dataset.target + '=' + c.textContent.trim())`);
  check(`D1 [${kind}] the picker lists Everywhere, Master Bedroom (as its MA player, once) and Indoor, not the player with no MA player`,
    J(chips) === J([`${EVERY}=Everywhere`, `${MAE}=Master Bedroom`, 'media_player.indoor=Indoor']), J(chips));
  await shot(p, `native-picker-${kind}`);
  await press(p, kind, `${SP}.querySelector('.chip[data-target="${MAE}"]')`);
  await wait(p, `__card._config.entity === '${MAE}'`);
  const sel = await ev(p, `__card._config.entity`);
  await sleep(700);
  check(`D2 [${kind}] picking Master Bedroom makes ${MAE} the target`, sel === MAE, sel);
  await ev(p, `${SP}.querySelector('[data-action="close"]')?.click()`); await sleep(400);
  const T = await titles(p);
  check(`D3 [${kind}] and the Queue tab shows its queue`, !(await unavailable(p)) && T.some((x) => /Porcelain/.test(x)), J(T));
  await p.close();
}
// a remembered target saved as the native entity (older card / hand-edited) still works
{
  const p = await open(`&spk=dyn&tab=queue&target=${NAT}`, { speaker_mode: 'dynamic', entity: EVERY, targets: TG });
  const ok = await wait(p, `${QV}.querySelectorAll('.qr').length > 3`);
  check('D4 a saved target that is the native entity resolves to its MA player and the queue shows', ok && (await ev(p, `__card._config.entity`)) === MAE && !(await unavailable(p)), await ev(p, `__card._config.entity`));
  await p.close();
}
// no `targets` list: the groups plus the card's own player, once, as its MA player
{
  const p = await open('&tab=queue', { speaker_mode: 'dynamic', entity: NAT });
  await wait(p, `${QV}.querySelectorAll('.qr').length > 3`);
  await ev(p, `${CARD}.querySelector('.pill').click()`);
  await wait(p, `${SP}.querySelectorAll('.chip[data-target]').length > 1`);
  const chips = await ev(p, `[...${SP}.querySelectorAll('.chip[data-target]')].map((c) => c.dataset.target)`);
  check('D5 no targets list: the card\'s own speaker is listed once, as its MA player', chips.filter((x) => x === MAE).length === 1 && !chips.includes(NAT) && !chips.includes(ORPH), J(chips));
  await p.close();
}
// a card whose player has no MA player at all keeps what it is set to (no crash); the picker is not offered the others
{
  const p = await open('&spk=dyn&tab=now', { speaker_mode: 'dynamic', entity: ORPH, targets: TG });
  await sleep(500);
  check('D6 a player with no MA player stays as set (nothing is invented) and the card still renders', (await ev(p, `__card._config.entity`)) === ORPH && (await ev(p, `!!${CARD}.querySelector('jb-now')`)));
  await p.close();
}
// the card is set up before Home Assistant's registry arrives, then it does
{
  const p = await open('&tab=queue', { entity: NAT });
  await wait(p, `${QV}.querySelectorAll('.qr').length > 3`);
  check('R1 fixed mode: the card follows the MA player once the registry is known', (await ev(p, `__card._config.entity`)) === MAE);
  await p.close();
}
check('no page errors', pageErrors.length === 0, J(pageErrors.slice(0, 3)));
await browser.close();
console.log(`\n${total - failures}/${total} native-entity queue checks passed`);
process.exit(failures ? 1 : 0);

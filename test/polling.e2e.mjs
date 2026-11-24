// 2.5 no players/all polling: over a whole session the card never asks Music Assistant for its player list; Add, Drop and
// Move wait for Music Assistant's own change message (same time limits, same questions); the Queue screen follows its
// speaker's queue from the live feed (no jukebox_kiosk/subscribe_queue, no reloads on Home Assistant state changes), in
// Fixed mode as in Dynamic mode. Mock Music Assistant (dev/mock-ma.js, dev/mock-kiosk.js); every id is a placeholder.
// Usage: (starts its own dev server on a free port; JB_PORT / JB_URL override) node test/polling.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
import { hooksBuild } from './hooks-build.mjs';

hooksBuild();

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const IN = 'media_player.indoor', EVERY = 'media_player.everywhere', GAR = 'media_player.garage';
const PID = 'syncgroup_everywhere';
const SPK = `__card.shadowRoot.querySelector('jb-speakers')`;
const SR = `${SPK}.shadowRoot`;
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const row = (e) => `${SR}.querySelector('[data-room="${e}"]')`;
const act = (e) => `${row(e)}?.querySelector('.act')`;
const ASK = `${SR}.querySelector('.sp-ask, .st.ask')`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const chip = (p) => ev(p, `${SR}.querySelector('.st .ct')?.textContent?.trim() ?? ''`);
const playersAll = (p) => ev(p, `window.__maLog.filter((c) => c.command === 'players/all').length`);
const queueSubs = (p) => ev(p, `window.__ws.filter((m) => m.type === 'subscribe_queue').length`);
const queueReads = (p) => ev(p, `window.__ws.filter((m) => m.type === 'queue_items').length`);
const NOQ = `${QV}.querySelector('.empty[data-empty="no-queue"]')?.textContent.includes('Nothing queued on this speaker')`;
async function open(query) {
  const p = await browser.newPage();
  await hermetic(p);
  await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.goto(`${BASE}?hooks=1&fresh=1&latency=30&gap=500${query.includes('tab=') ? '' : '&tab=now'}${query}`);
  await p.waitForFunction('window.__ready === true');
  await sleep(300);
  return p;
}
async function tap(p, expr) {
  const r = await ev(p, `(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })()`);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await p.mouse.click(r.x, r.y);
  await sleep(60);
}
async function confirmIfAsked(p) {
  if (await wait(p, `!!${ASK}`, 1200)) await tap(p, `${ASK}.querySelector('[data-action="confirm"]')`);
}

{
  // a whole Dynamic session with the default time limits: open the panel, Move, Add, Drop, close it, the Queue tab
  const p = await open('&spk=dyn&admin=1'); // Everywhere playing (the default mock), like speakers.e2e M4-M7
  await tap(p, `__card.shadowRoot.querySelector('.pill')`);
  const loaded = await wait(p, `${SPK}.store?.loaded && !!${row(GAR)}?.querySelector('.where')`);
  check('P1 the panel fills from the live feed alone', loaded && (await playersAll(p)) === 0);

  const t0 = Date.now();
  await tap(p, `${SR}.querySelector('[data-target="${IN}"]')`);
  await confirmIfAsked(p);
  const moved = await wait(p, `/Moved to Indoor/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 10000);
  check('P2 Move confirms on Music Assistant\'s change message, inside its 10 s limit', moved && Date.now() - t0 < 10000, J({ ms: Date.now() - t0, chip: await chip(p) }));

  await wait(p, `${SPK}.store.players.get('syncgroup_mock_indoor')?.playback_state === 'playing' && ${act(GAR)}?.dataset.act === 'join'`, 8000);
  const t1 = Date.now();
  await tap(p, act(GAR));
  await confirmIfAsked(p);
  const joined = await wait(p, `${row(GAR)}.classList.contains('in') && /Garage joined Indoor/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 8000);
  check('P3 Add confirms on the change message, inside its 8 s limit; "Garage joined Indoor" as before', joined && Date.now() - t1 < 8000, J({ ms: Date.now() - t1, chip: await chip(p) }));

  await wait(p, `${act(GAR)}?.dataset.act === 'drop'`, 4000);
  const t2 = Date.now();
  await tap(p, act(GAR));
  await confirmIfAsked(p);
  const left = await wait(p, `${row(GAR)}.classList.contains('out') && /Garage left/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 8000);
  check('P4 Drop confirms on the change message, inside its 8 s limit; "Garage left" as before', left && Date.now() - t2 < 8000, J({ ms: Date.now() - t2, chip: await chip(p) }));

  await tap(p, `${SR}.querySelector('.sheet .x')`);
  await ev(p, `__card._tab = 'queue'`);
  await sleep(3500);
  check('P5 no players/all request over the whole session (panel, Move, Add, Drop, Queue)', (await playersAll(p)) === 0, String(await playersAll(p)));
  check('P6 no jukebox_kiosk/subscribe_queue either; one live subscription', (await queueSubs(p)) === 0 && (await ev(p, `window.__live.subs()`)) === 1);
  await p.close();
}

{
  // the change never comes: the same time limit, the same message as before
  const p = await browser.newPage();
  await hermetic(p);
  await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.evaluateOnNewDocument(() => { window.__jbSpeakerTimeouts = { call: 900, join: 900, move: 900 }; });
  await p.goto(`${BASE}?hooks=1&fresh=1&latency=30&gap=500&tab=now&spk=dyn&admin=1&ma=split&target=${IN}&grp=timeout`);
  await p.waitForFunction('window.__ready === true');
  await tap(p, `__card.shadowRoot.querySelector('.pill')`);
  await wait(p, `${SPK}.store?.loaded && ${act(GAR)}?.dataset.act === 'join'`, 6000);
  await tap(p, act(GAR));
  await confirmIfAsked(p);
  const failed = await wait(p, `/Couldn't add Garage/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 4000);
  check('P7 Music Assistant never confirms: the existing "Couldn\'t add" message after the time limit; nothing re-read', failed && (await playersAll(p)) === 0, await chip(p));
  await p.close();
}

{
  // Fixed mode (the default): the Queue screen follows the speaker's queue from the feed
  const p = await open('&tab=queue');
  await wait(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0`);
  check('P8 fixed mode: the queue comes from the feed\'s active queue (no subscribe_queue)', (await queueSubs(p)) === 0 && (await ev(p, `window.__live.subs()`)) === 1
    && (await ev(p, `__card.speakers.live.activeQueue('${PID}')`)) === PID);
  await ev(p, `window.__setActiveSource('${PID}', 'spotify_connect')`);
  check('P9 fixed mode: an outside source takes over → "Nothing queued on this speaker" by itself', await wait(p, NOQ));
  await ev(p, `window.__setActiveSource('${PID}', undefined)`);
  check('P10 …and the queue comes back by itself', await wait(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0`));
  await sleep(600);
  const n0 = await queueReads(p);
  await ev(p, `(() => { const Q = window.__queues['${EVERY}']; Q.items.splice(Q.items.length - 1, 1); window.__hass && window.__liveTick(); })()`);
  check('P11 a queue song change in Music Assistant (queue_items_updated) reads the queue again', await wait(p, `window.__ws.filter((m) => m.type === 'queue_items').length > ${n0}`, 3000));
  await sleep(800);
  const n1 = await queueReads(p);
  await ev(p, `window.__setAttrs('${EVERY}', { media_title: 'A Home Assistant only change' })`);
  await sleep(1200);
  check('P12 a Home Assistant state change on its own no longer reloads the queue (the feed drives it)', (await queueReads(p)) === n1, String((await queueReads(p)) - n1));
  check('P13 still no players/all and no subscribe_queue', (await playersAll(p)) === 0 && (await queueSubs(p)) === 0);
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} polling checks passed`);
process.exit(failures ? 1 : 0);

// #100 one active-queue lookup (Music Assistant's app rule, on the server): the player's active_source when it names a queue,
// else its own queue only when that queue is active, else no queue. No queue is a normal answer: the Queue screen says
// "Nothing queued on this speaker", not "Queue unavailable". The mock answers like the server (dev/mock-kiosk.js
// activeQueueFor) and window.__setActiveSource(playerId, v) plays MA changing a player's active_source. Placeholder ids only.
// Usage: (starts its own dev server on a free port; JB_PORT / JB_URL override) node test/active-queue.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const PID = 'syncgroup_everywhere', EVERY = 'media_player.everywhere';
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 4000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const rows = (p) => ev(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length`);
const emptyText = (p) => ev(p, `${QV}.querySelector('.empty b')?.textContent.trim() ?? ''`);
const NOQ = `${QV}.querySelector('.empty[data-empty="no-queue"]')?.textContent.includes('Nothing queued on this speaker')`;
const KC = `&kcaps=${encodeURIComponent(J({ autoplay: true, autoplay_mode: true }))}`;
async function open(query = KC) {
  const p = await browser.newPage();
  await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=queue${query}`);
  await p.waitForFunction('window.__ready === true');
  await wait(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0`);
  return p;
}

{
  const p = await open();
  const qi = await ev(p, `window.__ws.filter((m) => m.type === 'queue_items').length`);
  check('AQ1 a speaker playing its queue: the Queue screen lists it', (await rows(p)) > 0 && qi >= 1, String(await rows(p)));
  check('AQ1b the Autoplay pill shows for the playing queue', await wait(p, `!!${QV}.querySelector('button.ap')`));
  check('AQ2 the card follows the server\'s queue (jukebox_kiosk/subscribe_queue is held)', await ev(p, `window.__kioskSubs().includes('${EVERY}')`));

  // an outside source takes over (Spotify Connect): MA's active_source names no queue
  await ev(p, `window.__setActiveSource('${PID}', 'spotify_connect')`);
  const shown = await wait(p, NOQ);
  check('AQ3 outside source: "Nothing queued on this speaker" shows on its own (queue_changed), not an error', shown && (await emptyText(p)) === 'Nothing queued on this speaker', await emptyText(p));
  const text = await ev(p, `${QV}.textContent`);
  check('AQ4 no "Queue unavailable" and no queue rows', !/Queue unavailable/.test(text) && (await rows(p)) === 0);
  const ap = await ev(p, `!!${QV}.querySelector('button.ap')`);
  check('AQ5 no Autoplay control while nothing is queued', !ap);

  // back to its own queue
  await ev(p, `window.__setActiveSource('${PID}', undefined)`);
  check('AQ6 the queue comes back by itself when the speaker plays its queue again', await wait(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0`));

  // no active_source: the own queue counts only while it is active
  await ev(p, `(window.__queues['${EVERY}'].active = false, window.__setActiveSource('${PID}', null))`);
  check('AQ7 no active_source and an inactive own queue: nothing queued', await wait(p, NOQ), await emptyText(p));
  await ev(p, `(window.__queues['${EVERY}'].active = true, window.__setActiveSource('${PID}', null))`);
  check('AQ8 no active_source and an active own queue: that queue', await wait(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0`));

  const qid = await ev(p, `__card.queue.snap.queueId`);
  check('AQ9 the queue id the card uses is the active queue the server named', qid === PID, String(qid));

  // players.active_queue_id needs the own queue to be active, not to have songs: an active, empty own queue is that queue
  await ev(p, `(window.__queues['${EVERY}'].items = [], window.__queues['${EVERY}'].index = -1, window.__queues['${EVERY}'].active = true, window.__setActiveSource('${PID}', null), window.__kioskPush('${EVERY}'))`);
  const emptyOwn = await wait(p, `${QV}.querySelector('.empty') && !${QV}.querySelector('.empty[data-empty="no-queue"]') && /The queue is empty/.test(${QV}.querySelector('.empty b').textContent)`);
  const aq = await p.evaluate(() => window.__hass.callWS({ type: 'jukebox_kiosk/active_queue', entity_id: 'media_player.everywhere' }));
  check('AQ9b no active_source and an active but empty own queue: that queue ("The queue is empty"), not "Nothing queued"', emptyOwn && aq?.queue_id === PID, `${await emptyText(p)} ${J(aq)}`);
  await p.close();
}

{
  // favorites and lyrics use the same lookup
  const p = await open();
  await ev(p, `window.__setActiveSource('${PID}', 'airplay_source')`);
  await wait(p, NOQ);
  const r = await p.evaluate(async () => {
    const hass = window.__hass;
    const call = (m) => hass.callWS(m).then((x) => ({ ok: true, x }), (e) => ({ ok: false, code: e.code, message: e.message }));
    return {
      aq: await call({ type: 'jukebox_kiosk/active_queue', entity_id: 'media_player.everywhere' }),
      ap: await call({ type: 'jukebox_kiosk/set_autoplay', entity_id: 'media_player.everywhere', enabled: true }),
    };
  });
  check('AQ10 active_queue answers null for an outside source', r.aq.ok && r.aq.x.queue_id === null, J(r.aq));
  check('AQ11 Autoplay is refused with no_queue "Nothing queued on this speaker"', !r.ap.ok && r.ap.code === 'no_queue' && r.ap.message === 'Nothing queued on this speaker', J(r.ap));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} active-queue checks passed`);
process.exit(failures ? 1 : 0);

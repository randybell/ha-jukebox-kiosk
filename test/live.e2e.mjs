// #103 live feed: the card follows Music Assistant's pushed player changes (jukebox_kiosk/subscribe_live: a snapshot, then
// numbered changes) instead of waiting for its next players/all read. Polling is slowed to 10 minutes in most checks, so
// anything that shows up came through the feed. Every id is a placeholder.
// Usage: (starts its own dev server on a free port; JB_PORT / JB_URL override) node test/live.e2e.mjs
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

const IN = 'media_player.indoor', L = 'media_player.living_room', K = 'media_player.kitchen', G = 'media_player.garage';
const SR = `__card.shadowRoot.querySelector('jb-speakers').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const SLOW = { poll: 600000, fast: 600000 };
async function open(query, timeouts = SLOW) {
  const p = await browser.newPage();
  await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
  if (timeouts) await p.evaluateOnNewDocument((t) => { window.__jbSpeakerTimeouts = t; }, timeouts);
  await p.goto(`${BASE}?fresh=1&latency=20&hooks=1${query.includes('tab=') ? '' : '&tab=now'}${query}`);
  await p.waitForFunction('window.__ready === true');
  await sleep(400);
  await ev(p, `J = JSON.stringify`);
  return p;
}
const subs = (p) => ev(p, `window.__ws.filter((m) => m.type === 'subscribe_live').length`);
const playersAll = (p) => ev(p, `window.__maLog.filter((c) => c.command === 'players/all').length`);
const roomsIn = (p) => ev(p, `[...${SR}.querySelectorAll('[data-room].in')].map((r) => r.dataset.room).sort()`);
const openPanel = async (p) => { await ev(p, `__card.shadowRoot.querySelector('.pill').click()`); return wait(p, `${SR}.querySelectorAll('[data-room][data-ma]:not([data-ma=""])').length === 3`); };

{
  // fixed mode (the default) makes no Music Assistant player calls today, and the feed doesn't change that
  const p = await open('');
  await ev(p, `__card.shadowRoot.querySelector('.pill').click()`);
  await sleep(800);
  check('LF1 fixed mode: no live subscription (and no players/all), as before', (await subs(p)) === 0 && (await playersAll(p)) === 0,
    J({ subs: await subs(p), all: await playersAll(p) }));
  await p.close();
}

{
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}`);
  check('LF2 dynamic mode: one live subscription for the card', (await subs(p)) === 1, String(await subs(p)));
  check('LF3 its snapshot came first (seq 1)', await ev(p, `window.__live.sent[0]?.kind === 'snapshot' && window.__live.sent[0]?.seq === 1`));
  check('LF4 the speakers store follows the feed (3 speakers, 3 groups)', await ev(p, `__card.speakers.live.ready === true && __card.speakers.players.size === 6 && __card.speakers.players === __card.speakers.live.players`),
    await ev(p, `J({ ready: __card.speakers.live.ready, n: __card.speakers.players.size })`));
  const ok = await openPanel(p);
  const before = await roomsIn(p);
  check('LF5 panel open: Indoor plays on the living room and kitchen', ok && J(before) === J([K, L]), J(before));
  const subsOpen = await subs(p);
  const all0 = await playersAll(p);
  // a change made outside the card (Music Assistant's own app): the garage joins Indoor
  const t0 = Date.now();
  await ev(p, `window.__ma.force('syncgroup_mock_indoor', 'playing', [window.__ma.SP.living, window.__ma.SP.kitchen, window.__ma.SP.garage])`);
  const moved = await wait(p, `J([...${SR}.querySelectorAll('[data-room].in')].map((r) => r.dataset.room).sort()) === J(['${G}', '${K}', '${L}'])`, 3000);
  const ms = Date.now() - t0;
  check('LF6 the panel shows the change right away (no players/all read in between)', moved && ms < 1500 && (await playersAll(p)) === all0,
    J({ ms, after: await roomsIn(p), all: (await playersAll(p)) - all0 }));
  check('LF7 opening the panel did not start a second subscription', subsOpen === 1, String(subsOpen));
  const seqs = await ev(p, `window.__live.sent.map((m) => m.seq)`);
  check('LF8 messages are numbered one after another', seqs.every((s, i) => s === i + 1), J(seqs));

  // a lost message: the card notices the missing number and takes a fresh snapshot, then shows the right state
  const snaps0 = await ev(p, `window.__live.snapshots`);
  await ev(p, `window.__live.skip()`);
  await ev(p, `window.__ma.force('syncgroup_mock_indoor', 'playing', [window.__ma.SP.living, window.__ma.SP.kitchen])`);
  const resub = await wait(p, `window.__live.snapshots === ${snaps0 + 1}`, 3000);
  check('LF9 a missing message number brings one fresh snapshot', resub && (await subs(p)) === 2,
    J({ snaps: (await ev(p, 'window.__live.snapshots')) - snaps0, subs: await subs(p) }));
  const players = await ev(p, `J([...__card.speakers.players.values()].filter((x) => x.type === 'player').map((x) => [x.player_id, x.active_group]).sort())`);
  const fresh = await ev(p, `J(window.__ma.players().filter((x) => x.type === 'player').map((x) => [x.player_id, x.active_group]).sort())`);
  check('LF10 after the fresh snapshot the card matches Music Assistant', players === fresh, players);
  check('LF11 the old subscription was closed', await ev(p, `window.__live.subs() === 1`), String(await ev(p, 'window.__live.subs()')));

  // an older message (number already seen) is dropped: it can never overwrite a newer one
  const cur = await ev(p, `__card.speakers.live.seq`);
  const vol0 = await ev(p, `__card.speakers.players.get('wiim_mock_garage').volume_level`);
  await ev(p, `__card.speakers.onLive({ seq: ${cur}, kind: 'event', event: 'player_updated', object_id: 'wiim_mock_garage', data: { player_id: 'wiim_mock_garage', volume_level: 0.01 } })`);
  check('LF12 an older message is ignored', (await ev(p, `__card.speakers.players.get('wiim_mock_garage').volume_level`)) === vol0);
  await p.close();
}

{
  // many changes at once redraw once per frame, not once per message
  const p = await open('&spk=dyn&admin=1');
  await openPanel(p);
  await ev(p, `window.__emits = 0; __card.speakers.onChange(() => window.__emits++)`);
  await ev(p, `for (let i = 0; i < 30; i++) window.__live.push('wiim_mock_garage', { volume_level: 0.3 + i / 100 })`);
  await wait(p, `__card.speakers.players.get('wiim_mock_garage').volume_level > 0.58`, 3000);
  await sleep(200);
  const emits = await ev(p, 'window.__emits');
  check('LF13 30 changes in a row: the screen redraws a few times, not 30', emits >= 1 && emits <= 5, String(emits));
  await p.close();
}

{
  // the panel closed and not kept on Now Playing: the subscription is closed with the store
  const p = await open('&spk=dyn&admin=1&tab=queue');
  await openPanel(p);
  const on = await ev(p, `window.__live.subs()`);
  await ev(p, `${SR}.querySelector('.sheet .x').click()`);
  await wait(p, `window.__live.subs() === 0`, 3000);
  check('LF14 closing the panel (Queue tab) closes the live subscription', on === 1 && (await ev(p, `window.__live.subs()`)) === 0,
    J({ on, after: await ev(p, 'window.__live.subs()') }));
  await p.close();
}

{
  // an integration without the live feed: nothing is asked for, and players/all works as before
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&kcaps=${encodeURIComponent(J({ live_feed: false }))}`, null);
  const ok = await openPanel(p);
  check('LF15 without live_feed: no subscription, the panel still fills from players/all', ok && (await subs(p)) === 0 && (await playersAll(p)) >= 1,
    J({ subs: await subs(p), all: await playersAll(p) }));
  await ev(p, `window.__ma.force('syncgroup_mock_indoor', 'playing', [window.__ma.SP.living, window.__ma.SP.kitchen, window.__ma.SP.garage])`);
  const moved = await wait(p, `J([...${SR}.querySelectorAll('[data-room].in')].map((r) => r.dataset.room).sort()) === J(['${G}', '${K}', '${L}'])`, 6000);
  check('LF16 …and still picks up changes by reading again', moved, J(await roomsIn(p)));
  await p.close();
}

{
  // the subscription fails (old server, permissions): the card keeps working on players/all
  const p = await open('&spk=dyn&admin=1&kfail=subscribe_live', null);
  const ok = await openPanel(p);
  check('LF17 a failed subscription leaves the panel working on players/all', ok && (await ev(p, '__card.speakers.live.ready')) === false && (await playersAll(p)) >= 1);
  await p.close();
}

{
  // the feed goes quiet (its Music Assistant connection is gone until piece 4 re-attaches it): reading players/all again
  // still keeps the panel right, as before
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}`, null);
  await openPanel(p);
  await ev(p, `window.__live.hold(true)`);
  await ev(p, `window.__ma.force('syncgroup_mock_indoor', 'playing', [window.__ma.SP.living, window.__ma.SP.kitchen, window.__ma.SP.garage])`);
  const moved = await wait(p, `J([...${SR}.querySelectorAll('[data-room].in')].map((r) => r.dataset.room).sort()) === J(['${G}', '${K}', '${L}'])`, 6000);
  check('LF18 with the feed quiet, the next players/all read still shows the change', moved, J(await roomsIn(p)));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} live feed checks passed`);
process.exit(failures ? 1 : 0);

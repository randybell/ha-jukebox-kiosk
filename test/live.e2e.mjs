// #103 live feed: the card follows Music Assistant's pushed player changes (jukebox_kiosk/subscribe_live: a snapshot, then
// numbered changes). 2.5: there is no players/all polling any more, so anything that shows up came through the feed; the
// feed runs for the whole card in every speaker_mode (2.6: one path). Every id is a placeholder.
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
  // 2.5 / 2.6: fixed mode (the default) follows the same feed as every card (its Queue screen does), and still reads no
  // Music Assistant player list or group config; its Speakers panel is the same volume mixer as before
  const p = await open('');
  await ev(p, `__card.shadowRoot.querySelector('.pill').click()`);
  await sleep(800);
  const cfg = await ev(p, `window.__maLog.filter((c) => c.command === 'config/players/get').length`);
  check('LF1 fixed mode: one live subscription for the card, no players/all and no group configs', (await subs(p)) === 1 && (await playersAll(p)) === 0 && cfg === 0,
    J({ subs: await subs(p), all: await playersAll(p), cfg }));
  check('LF1b …and its panel is the volume mixer as before (no grouping buttons)', await ev(p, `${SR}.querySelector('.sheet')?.dataset.mode === 'fixed' && !${SR}.querySelector('.act')`));
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
  // 2.5: the feed belongs to the card (its Queue screen follows it too): closing the panel keeps it; the card leaving the
  // page closes it
  const p = await open('&spk=dyn&admin=1&tab=queue');
  await openPanel(p);
  const on = await ev(p, `window.__live.subs()`);
  await ev(p, `${SR}.querySelector('.sheet .x').click()`);
  await sleep(600);
  const closed = await ev(p, `window.__live.subs()`);
  await ev(p, `(window.__cardParent = __card.parentNode, __card.remove())`);
  const gone = await wait(p, `window.__live.subs() === 0`, 3000);
  check('LF14 closing the panel keeps the one subscription; the card leaving the page closes it', on === 1 && closed === 1 && gone && (await subs(p)) === 1,
    J({ on, closed, after: await ev(p, 'window.__live.subs()'), asked: await subs(p) }));
  await p.close();
}

{
  // 2.5: an integration without the live feed: nothing is asked for and nothing is polled. The panel is Home Assistant's
  // own mixer (no grouping buttons, as the native backend), so no stale grouping is ever offered
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&kcaps=${encodeURIComponent(J({ live_feed: false }))}`, null);
  const ok = await openPanel(p);
  await sleep(1500);
  check('LF15 without live_feed: no subscription, no players/all, the panel opens with no grouping buttons', ok && (await subs(p)) === 0 && (await playersAll(p)) === 0
    && (await ev(p, `${SR}.querySelectorAll('.act').length`)) === 0, J({ subs: await subs(p), all: await playersAll(p), acts: await ev(p, `${SR}.querySelectorAll('.act').length`) }));
  const q0 = await ev(p, `window.__ws.filter((m) => m.type === 'queue_items').length`);
  await ev(p, `window.__setAttrs('${IN}', { media_title: 'Another Placeholder Song' })`);
  const read = await wait(p, `window.__ws.filter((m) => m.type === 'queue_items').length > ${q0}`, 3000);
  check('LF16 …and its Queue still follows Home Assistant\'s state changes, as the native backend always has', read);
  await p.close();
}

{
  // the subscription fails (permissions, an error in the integration): one plain note in the panel, nothing polled; the
  // next fresh reload (Home Assistant's connection back) tries the feed again
  const p = await open('&spk=dyn&admin=1&kfail=subscribe_live', null);
  await ev(p, `__card.shadowRoot.querySelector('.pill').click()`);
  const banner = await wait(p, `/Music Assistant did not answer \\(mock: subscribe_live failed\\)\\. Volume still works\\./.test(${SR}.querySelector('.banner')?.textContent ?? '')`, 3000);
  await sleep(1000);
  const asked = await subs(p);
  check('LF17 a failed subscription: the existing "did not answer" note, no players/all, not retried on its own', banner && (await ev(p, '__card.speakers.live.ready')) === false
    && (await playersAll(p)) === 0 && asked === 1, J({ banner: await ev(p, `${SR}.querySelector('.banner')?.textContent`), asked, all: await playersAll(p) }));
  await ev(p, `window.__haReconnect()`);
  const again = await wait(p, `window.__ws.filter((m) => m.type === 'subscribe_live').length === 2`, 3000);
  check('LF17b a fresh reload tries the feed again', again, String(await subs(p)));
  await p.close();
}

{
  // 2.5: nothing reads Music Assistant behind the feed's back: while its messages are held the panel stays as it was (no
  // players/all), and it shows the change the moment they arrive
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}`, null);
  await openPanel(p);
  await ev(p, `window.__live.hold(true)`);
  await ev(p, `window.__ma.force('syncgroup_mock_indoor', 'playing', [window.__ma.SP.living, window.__ma.SP.kitchen, window.__ma.SP.garage])`);
  await sleep(2000);
  const held = await roomsIn(p);
  await ev(p, `window.__live.hold(false)`);
  const moved = await wait(p, `J([...${SR}.querySelectorAll('[data-room].in')].map((r) => r.dataset.room).sort()) === J(['${G}', '${K}', '${L}'])`, 3000);
  check('LF18 the change shows only through the feed: not while it is held, at once when it arrives; no players/all', J(held) === J([K, L]) && moved && (await playersAll(p)) === 0,
    J({ held, after: await roomsIn(p), all: await playersAll(p) }));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} live feed checks passed`);
process.exit(failures ? 1 : 0);

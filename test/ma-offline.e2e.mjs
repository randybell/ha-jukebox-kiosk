// 2.4 "Music Assistant is offline" and the fresh reload. The mock plays the integration's link.py: window.__maOffline(true)
// is Home Assistant losing its Music Assistant connection (status {connected: false}, the live feed's 'offline', queue
// push 'offline', MA commands failing with ma_unavailable); __maOffline(false) is HA's new client (status back, a fresh
// snapshot on the same live subscription, queue_changed). __haReconnect() is the card's own HA websocket coming back.
// Every id is a placeholder. Usage: (starts its own dev server on a free port; JB_PORT / JB_URL override) node test/ma-offline.e2e.mjs
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

const IN = 'media_player.indoor';
const R = `__card.shadowRoot`, NOW = `${R}.querySelector('jb-now').shadowRoot`, QV = `${R}.querySelector('jb-queue').shadowRoot`;
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
  return p;
}
const NOTICE = `[...${R}.querySelectorAll('.top [role="status"]')].map((e) => e.textContent.trim())`;
const notice = (p) => ev(p, NOTICE);
const OFF_SHOWN = `${R}.querySelector('.top [data-status="ma-offline"]')?.textContent.trim() === 'Music Assistant is offline'`;
const count = (p, type) => ev(p, `window.__ws.filter((m) => m.type === '${type}').length`);
const greyed = (p) => ev(p, `JSON.stringify({
  pill: ${R}.querySelector('.pill').disabled && ${R}.querySelector('.pill').classList.contains('ma-off'),
  panel: ${R}.querySelector('jb-speakers').inert && ${R}.querySelector('jb-speakers').classList.contains('ma-off'),
  queue: ${R}.querySelector('.view[data-view=queue]').inert && ${R}.querySelector('.view[data-view=queue]').classList.contains('ma-off'),
  vol: !!${NOW}.querySelector('.vol.ma-off[inert]'),
  upn: !${NOW}.querySelector('.upn') || !!${NOW}.querySelector('.upn.ma-off[inert]'),
  now: !${R}.querySelector('.view[data-view=now]').inert,
})`).then(JSON.parse);

{
  // dynamic mode, Speakers panel open, live feed running
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}`);
  check('MO1 the card follows the Music Assistant status (one subscribe_ma_status); no notice while connected',
    (await count(p, 'subscribe_ma_status')) === 1 && (await ev(p, `window.__maStatusSubs()`)) === 1 && !(await ev(p, OFF_SHOWN)), J(await notice(p)));
  await ev(p, `${R}.querySelector('.pill').click()`);
  const panelOpen = await wait(p, `${R}.querySelector('jb-speakers').open === true`);
  await wait(p, `__card.speakers.live.ready === true`);
  const live0 = await count(p, 'subscribe_live'), snaps0 = await ev(p, `window.__live.snapshots`);

  await ev(p, `window.__maOffline(true)`);
  check('MO2 Music Assistant drops out: one plain notice "Music Assistant is offline" in the header', await wait(p, OFF_SHOWN) && J(await notice(p)) === J(['Music Assistant is offline']), J(await notice(p)));
  const g = await greyed(p);
  check('MO3 speaker and queue controls are greyed out and not tappable (pill, Speakers panel, Now Playing speaker rows and Up next, Queue screen); the rest of Now Playing is not',
    g.pill && g.panel && g.queue && g.vol && g.upn && g.now, J(g));
  check('MO4 the open Speakers panel closes (its controls are greyed out)', panelOpen && await wait(p, `${R}.querySelector('jb-speakers').open === false`));
  await ev(p, `${R}.querySelector('.pill').click()`);
  await sleep(200);
  check('MO5 tapping the greyed pill does nothing', await ev(p, `${R}.querySelector('jb-speakers').open === false`));
  check('MO6 the live feed said offline on the same subscription; the card keeps it and marks its list not current',
    await wait(p, `window.__live.sent.at(-1)?.kind === 'offline' && __card.speakers.live.ready === false`) && (await count(p, 'subscribe_live')) === live0);

  // while offline, MA moves the music elsewhere (an outside source takes the speaker): nothing is pushed until MA is back
  const cardPid = await ev(p, `window.__playerIdFor(__card._config.entity)`);
  await ev(p, `(window.__activeSource['${cardPid}'] = 'spotify_connect', 1)`);
  const qi0 = await count(p, 'queue_items'), ids0 = await count(p, 'player_ids');
  await ev(p, `window.__maOffline(false)`);
  check('MO7 Music Assistant is back: the notice goes and the controls work again', await wait(p, `!(${OFF_SHOWN})`) && await wait(p, `!${R}.querySelector('.pill').disabled && !${R}.querySelector('jb-speakers').inert && !${R}.querySelector('.view[data-view=queue]').inert && !${NOW}.querySelector('.ma-off')`),
    J(await greyed(p)));
  check('MO8 a fresh snapshot arrived on the same live subscription (seq counting on) and the speakers store follows it again',
    await wait(p, `__card.speakers.live.ready === true`) && (await ev(p, `window.__live.snapshots`)) === snaps0 + 1 && (await count(p, 'subscribe_live')) === live0
      && (await ev(p, `window.__live.sent.at(-1).kind === 'snapshot' && window.__live.sent.at(-1).seq === window.__live.sent.at(-2).seq + 1`)),
    J(await ev(p, `window.__live.sent.slice(-2).map((m) => [m.seq, m.kind])`)));
  check('MO9 fresh reload: the speaker is resolved again (player_ids) and the queue read again (queue_items)',
    await wait(p, `window.__ws.filter((m) => m.type === 'player_ids').length > ${ids0} && window.__ws.filter((m) => m.type === 'queue_items').length > ${qi0}`),
    J({ ids: await count(p, 'player_ids') - ids0, qi: await count(p, 'queue_items') - qi0 }));
  check('MO10 the queue is worked out again on the new connection: the outside source shows "Nothing queued on this speaker"',
    await wait(p, `__card.queue.snap.noQueue === true`), J(await ev(p, `({ no: __card.queue.snap.noQueue, err: __card.queue.snap.error })`)));
  check('MO11 still one status subscription', (await ev(p, `window.__maStatusSubs()`)) === 1 && (await count(p, 'subscribe_ma_status')) === 1);
  await ev(p, `(window.__setActiveSource('${cardPid}', undefined), 1)`);
  await wait(p, `__card.queue.snap.noQueue !== true`);

  // the card's own Home Assistant websocket comes back (Wi-Fi drop): HA resubscribes, the card reads everything fresh
  const qi1 = await count(p, 'queue_items'), ids1 = await count(p, 'player_ids'), snaps1 = await ev(p, `window.__live.snapshots`);
  await ev(p, `window.__haReconnect()`);
  check('MO12 Home Assistant reconnects: a fresh live snapshot (resubscribed, seq 1) and a fresh speaker and queue read',
    await wait(p, `window.__live.snapshots > ${snaps1} && __card.speakers.live.ready === true && window.__ws.filter((m) => m.type === 'queue_items').length > ${qi1} && window.__ws.filter((m) => m.type === 'player_ids').length > ${ids1}`)
      && (await ev(p, `__card.queue.snap.noQueue !== true`)),
    J({ snaps: (await ev(p, `window.__live.snapshots`)) - snaps1, qi: (await count(p, 'queue_items')) - qi1, ids: (await count(p, 'player_ids')) - ids1 }));
  check('MO13 no notice after the HA reconnect while Music Assistant is up', !(await ev(p, OFF_SHOWN)) && (await ev(p, `window.__maStatusSubs()`)) === 1);
  await p.close();
}

{
  // fixed mode: no live feed, the notice still shows (the status is the card's own subscription)
  const p = await open('&tab=queue');
  await wait(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0`);
  await ev(p, `window.__maOffline(true)`);
  check('MO14 fixed mode: the notice shows too, the Queue screen is greyed out, and no live feed is opened',
    await wait(p, OFF_SHOWN) && (await greyed(p)).queue && (await count(p, 'subscribe_live')) === 0);
  const qi = await count(p, 'queue_items');
  await ev(p, `window.__maOffline(false)`);
  check('MO15 fixed mode: back by itself, with a fresh queue read and the queue rows shown', await wait(p, `!(${OFF_SHOWN})`)
    && await wait(p, `window.__ws.filter((m) => m.type === 'queue_items').length > ${qi} && ${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0 && !__card.queue.snap.error`));
  await p.close();
}

{
  // the kiosk starts while Music Assistant is down
  const p = await open('&maoff=1&tab=queue');
  check('MO16 starting while Music Assistant is offline: the notice shows', await wait(p, OFF_SHOWN), J(await notice(p)));
  await ev(p, `window.__maOffline(false)`);
  check('MO17 it comes alive when Music Assistant returns: notice gone, queue listed', await wait(p, `!(${OFF_SHOWN})`)
    && await wait(p, `${QV}.querySelectorAll('.qr[data-id], .qg [data-id]').length > 0`));
  await p.close();
}

{
  // an integration older than the card (no ma_status): nothing is asked and no notice ever shows
  const p = await open(`&kcaps=${encodeURIComponent(J({ ma_status: false }))}`);
  await ev(p, `window.__maOffline(true)`);
  await sleep(500);
  check('MO18 older integration: no subscribe_ma_status and no notice', (await count(p, 'subscribe_ma_status')) === 0 && !(await ev(p, OFF_SHOWN)));
  await p.close();
}

{
  // Home Assistant's own drop wins the one notice spot: "Reconnecting to Home Assistant…" first
  const p = await open('');
  await ev(p, `window.__maOffline(true)`);
  await wait(p, OFF_SHOWN);
  await ev(p, `(window.__hass.connection.connected = false, __card.hass = { ...window.__hass }, 1)`);
  const both = await wait(p, `${R}.querySelector('.top [data-status="reconnecting"]') && !${R}.querySelector('.top [data-status="ma-offline"]')`);
  check('MO19 one notice at a time: Home Assistant reconnecting is shown before Music Assistant offline', both && (await notice(p)).length === 1, J(await notice(p)));
  await ev(p, `(window.__hass.connection.connected = true, __card.hass = { ...window.__hass }, 1)`);
  check('MO20 Home Assistant back, Music Assistant still offline: its notice returns', await wait(p, OFF_SHOWN), J(await notice(p)));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} ma-offline checks passed`);
process.exit(failures ? 1 : 0);

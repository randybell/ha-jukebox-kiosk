// #99 speakers by Music Assistant player id (HA's entity registry), never by name. nonma=1 adds media_player.kitchen_2, a cast
// speaker named "Kitchen Speaker" (the same name as the MA kitchen player) that claims an MA queue; it must never be listed,
// matched or offered, with no message. Every id is a placeholder.
// Usage: (starts its own dev server on a free port; JB_PORT / JB_URL override) node test/speaker-ids.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const EVERY = 'media_player.everywhere', IN = 'media_player.indoor', TV = 'media_player.kitchen_2';
const L = 'media_player.living_room', K = 'media_player.kitchen', G = 'media_player.garage';
const ROOMS = [{ name: 'Kitchen TV', entity: TV }, { name: 'Living Room', entity: L }, { name: 'Kitchen', entity: K }, { name: 'Garage', entity: G }];
const SR = `__card.shadowRoot.querySelector('jb-speakers').shadowRoot`;
const NOW = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
async function open(query) {
  const p = await browser.newPage();
  await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
  await p.goto(`${BASE}?fresh=1&latency=20&tab=now&nonma=1${query}`);
  await p.waitForFunction('window.__ready === true');
  await sleep(400);
  return p;
}
const touched = (p) => ev(p, `[...window.__calls.filter((c) => J(c).includes('${TV}')), ...window.__ws.filter((m) => J(m).includes('${TV}'))].length`);

{
  // fixed mode (the default): the cast speaker is in rooms
  const p = await open(`&cfg=${encodeURIComponent(J({ rooms: ROOMS }))}`);
  await ev(p, `J = JSON.stringify`);
  const now = await ev(p, `[...${NOW}.querySelectorAll('.vr[data-entity]')].map((r) => r.dataset.entity)`);
  check('I1 Now Playing lists only the Music Assistant rooms (the cast speaker named "Kitchen Speaker" is left out)',
    !now.includes(TV) && [L, K, G].every((e) => now.includes(e)), J(now));
  const pill = await ev(p, `__card.shadowRoot.querySelector('.pill b')?.textContent.trim()`);
  check('I2 the header counts Music Assistant rooms only', pill === '· 3 rooms synced', pill);
  await ev(p, `__card.shadowRoot.querySelector('.pill').click()`);
  await wait(p, `!!${SR}.querySelector('[data-room]')`);
  const rows = await ev(p, `[...${SR}.querySelectorAll('[data-room]')].map((r) => r.dataset.room)`);
  check('I3 the Speakers panel lists only the Music Assistant rooms', J(rows) === J([L, K, G]), J(rows));
  const text = await ev(p, `(__card.shadowRoot.textContent + ${SR}.textContent + ${NOW}.textContent)`);
  check('I4 no message about the left-out speaker', !/Kitchen TV|not a Music Assistant|kitchen_2/i.test(text));
  check('I5 nothing is ever sent for the cast speaker', (await touched(p)) === 0);
  await p.close();
}

{
  // dynamic mode: the cast speaker is a target, a target member and the remembered target
  const cfg = { rooms: ROOMS, targets: [EVERY, TV, { entity: IN, name: 'Indoor', members: [L, K, TV] }] };
  const p = await open(`&spk=dyn&admin=1&target=${TV}&cfg=${encodeURIComponent(J(cfg))}`);
  await ev(p, `J = JSON.stringify`);
  const ent = await ev(p, `__card._config.entity`);
  check('I6 a remembered target that is not a Music Assistant player is not used (the card stays on its entity)', ent === EVERY, ent);
  const lost = await ev(p, `__card.shadowRoot.querySelector('.lost')?.textContent ?? ''`);
  check('I7 and no message about it', lost === '', lost);
  await ev(p, `__card.shadowRoot.querySelector('.pill').click()`);
  await wait(p, `${SR}.querySelectorAll('[data-room][data-ma]:not([data-ma=""])').length === 3`);
  const targets = await ev(p, `[...${SR}.querySelectorAll('[data-target]')].map((b) => b.dataset.target)`);
  check('I8 the target list offers only Music Assistant players', J(targets) === J([EVERY, IN]), J(targets));
  const ma = await ev(p, `Object.fromEntries([...${SR}.querySelectorAll('[data-room]')].map((r) => [r.dataset.room, r.dataset.ma]))`);
  check('I9 rooms map to their MA ids from the registry, not by name (MA calls them "… Speaker")',
    J(ma) === J({ [L]: 'wiim_mock_living', [K]: 'wiim_mock_kitchen', [G]: 'wiim_mock_garage' }), J(ma));
  const ids = await ev(p, `window.__ws.filter((m) => m.type === 'player_ids').length`);
  check('I10 the ids come from jukebox_kiosk/player_ids', ids >= 1, String(ids));
  check('I11 nothing is ever sent for the cast speaker', (await touched(p)) === 0);
  await p.close();
}

{
  // renaming: the HA friendly name and the room name change; the id (and so the MA player) does not
  const p = await open(`&spk=dyn&admin=1&cfg=${encodeURIComponent(J({ rooms: [{ name: 'Cooking', entity: K }, { name: 'Lounge', entity: L }] }))}`);
  await ev(p, `(() => { const h = __card.hass; const s = h.states['${K}']; __card.hass = { ...h, states: { ...h.states, '${K}': { ...s, attributes: { ...s.attributes, friendly_name: 'Garage Speaker' } } } }; })()`);
  await ev(p, `__card.shadowRoot.querySelector('.pill').click()`);
  await wait(p, `${SR}.querySelectorAll('[data-room][data-ma]:not([data-ma=""])').length === 2`);
  const ma = await ev(p, `Object.fromEntries([...${SR}.querySelectorAll('[data-room]')].map((r) => [r.dataset.room, r.dataset.ma]))`);
  check('I12 renamed rooms (and an HA name that matches another MA player) keep their own MA ids',
    J(ma) === J({ [K]: 'wiim_mock_kitchen', [L]: 'wiim_mock_living' }), J(ma));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} speaker-ids checks passed`);
process.exit(failures ? 1 : 0);

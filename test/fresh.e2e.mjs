// 0.7.9 #58 fresh install: a brand-new card with nothing typed (Home Assistant's stub config, then just the player)
// must work for a non-admin: it finds Music Assistant through the Jukebox Kiosk integration, searches, lists the
// library and the queue, and plays. The editor starts from the same nothing. Every id is a placeholder.
// Usage: (starts its own dev server on a free port) node test/fresh.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const MA_ENTRY = '01MUSICASSISTANT0000000000';
const EV = 'media_player.everywhere';
const SV = `__card.shadowRoot.querySelector('jb-search')`;
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const NP = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const ev = (p, e) => p.evaluate((e) => eval(e), e);
const wait = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
async function open(q = '', page = 'index.html') {
  const p = await browser.newPage();
  await hermetic(p);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await p.goto(`${BASE.replace('index.html', page)}?fresh=1&latency=30${q}`);
  await p.waitForFunction(page === 'index.html' ? 'window.__ready === true' : '!!window.__editor?.shadowRoot?.querySelector("ha-form")');
  await sleep(300);
  return p;
}
async function tap(p, expr) {
  const r = await p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, hold: el.matches('.ra-b.hold') }; }, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  // 0.7.10: search / artist Albums row buttons fire on a 500 ms press-and-hold
  if (r.hold) { await p.mouse.move(r.x, r.y); await p.mouse.down(); await sleep(650); await p.mouse.up(); await sleep(80); return; }
  await p.mouse.click(r.x, r.y); await sleep(80);
}

// 1. adding the card: Home Assistant's stub config picks the first Music Assistant player, nothing else
{
  const p = await open('&stub=1');
  const cfg = await ev(p, `customElements.get('jukebox-card').getStubConfig(__card.hass)`);
  check('F1 stub config = {entity: the first Music Assistant player}, nothing else', J(cfg) === J({ entity: EV }), J(cfg));
  const stubNone = await ev(p, `J = JSON.stringify, J(customElements.get('jukebox-card').getStubConfig({ states: {}, entities: {} }))`);
  check('F1b no Music Assistant player yet → an empty stub (the editor asks for the player)', stubNone === '{}', stubNone);
  const who = await ev(p, `({ admin: __card.hass.user.is_admin, kiosk: __card.dataset.backend, entry: __card._config._backend?.maEntry })`);
  check('F2 non-admin, nothing set: the card uses the Jukebox Kiosk integration and learns the Music Assistant entry from it', who.admin === false && who.kiosk === 'kiosk' && who.entry === MA_ENTRY, J(who));
  const tabs = await ev(p, `[...__card.shadowRoot.querySelectorAll('.tab span')].map((t) => t.textContent.trim())`);
  check('F3 the bar is Now Playing, Library, Queue', J(tabs) === J(['Now Playing', 'Library', 'Queue']), J(tabs));
  const pill = await ev(p, `__card.shadowRoot.querySelector('.pill').textContent.replace(/\\s+/g, ' ').trim()`);
  check('F4 the header pill names the player', /Everywhere/.test(pill), pill);
  // search (combined Library tab) → results, through music_assistant.search with the learned entry
  await tap(p, `__card.shadowRoot.querySelector('.tab[data-tab="browse"]')`);
  const n0 = await ev(p, `window.__calls.length`);
  await ev(p, `${SV}.setQuery('CHICAGO')`);
  const got = await wait(p, `${SV}.shadowRoot.querySelectorAll('.grp .row').length > 0`);
  const sc = await ev(p, `window.__calls.slice(${n0}).filter((c) => c.service === 'search').map((c) => c.data.config_entry_id)`);
  check('F5 search works: results shown, music_assistant.search carries the entry found through the integration', got && sc.length > 0 && sc.every((e) => e === MA_ENTRY), J(sc));
  const lib = await ev(p, `window.__calls.filter((c) => c.service === 'get_library').map((c) => c.data.config_entry_id)`);
  check('F5b the Library lists: music_assistant.get_library carries the same entry', lib.length > 0 && lib.every((e) => e === MA_ENTRY), J(lib));
  // play a song (replace asks first when the queue has songs)
  const n1 = await ev(p, `window.__calls.length`);
  await tap(p, `${SV}.shadowRoot.querySelector('.grp .row .ra-b[data-act="replace"]')`);
  if (await ev(p, `!!${SV}.shadowRoot.querySelector('.confirm [data-action="confirm"]')`)) await tap(p, `${SV}.shadowRoot.querySelector('.confirm [data-action="confirm"]')`);
  await sleep(400);
  const pm = await ev(p, `window.__calls.slice(${n1}).filter((c) => c.service === 'play_media').map((c) => ({ e: c.target?.entity_id ?? c.data.entity_id, id: c.data.media_id, q: c.data.enqueue }))`);
  check('F6 it plays: Play on a search result → media_player.play_media on the chosen player', pm.length === 1 && pm[0].e === EV && pm[0].q === 'replace', J(pm));
  // the queue lists through the integration
  await tap(p, `__card.shadowRoot.querySelector('.tab[data-tab="queue"]')`);
  const q = await wait(p, `${QV}.querySelectorAll('.qr').length > 3`);
  check('F7 the Queue lists (jukebox_kiosk/queue_items)', q && (await ev(p, `window.__ws.some((m) => m.type === 'queue_items')`)));
  await tap(p, `__card.shadowRoot.querySelector('.tab[data-tab="now"]')`);
  check('F8 heart hidden when this user may not change the library (nothing to set)', !(await ev(p, `!!${NP}.querySelector('.tb.fv')`)));
  check('F9 no mass_queue or other removed calls', !(await ev(p, `window.__calls.some((c) => c.domain === 'mass_queue')`)));
  await p.close();
}
// 2. the same fresh card for a user who may change the library: the heart works with nothing set
{
  const p = await open(`&stub=1&kcaps=${encodeURIComponent(J({ library_write: true }))}`);
  await ev(p, `(() => { const Q = window.__queues['${EV}']; Q.items[Q.index]._t.favorite = false; window.__setAttrs('${EV}', {}); return __card.queue.refresh(); })()`);
  await sleep(500);
  const shown = await ev(p, `!!${NP}.querySelector('.tb.fv')`);
  const n = await ev(p, `window.__ws.length`);
  if (shown) await tap(p, `${NP}.querySelector('.tb.fv')`);
  await sleep(400);
  const fav = await ev(p, `window.__ws.slice(${n}).filter((m) => m.type === 'favorite_current').map((m) => m.entity_id)`);
  check('F10 fresh card + library permission: the heart shows and adds through jukebox_kiosk/favorite_current', shown && J(fav) === J([EV]), J({ shown, fav }));
  await p.close();
}
// 3. the editor from nothing: pick the player, that is the whole config
{
  const p = await open(`&cfg=${encodeURIComponent(J({ type: 'custom:jukebox-card' }))}`, 'editor.html');
  await ev(p, `(() => { const i = __editor.shadowRoot.querySelector('ha-form').querySelector('[data-name=entity] input'); i.value = '${EV}'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(200);
  const out = await ev(p, `window.__changes.at(-1)`);
  check('F11 editor from an empty card: picking the player writes {type, entity} only', J(out) === J({ type: 'custom:jukebox-card', entity: EV }), J(out));
  const names = await ev(p, `[...__editor.shadowRoot.querySelector('ha-form').querySelectorAll('[data-name]')].map((e) => e.dataset.name)`);
  check('F12 editor never asks for an entry id, a backend or a favorite button', !names.some((n) => /config_entry|backend|mass_queue|favorite_entity/.test(n)), J(names));
  await p.close();
}
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
await browser.close();
console.log(`\n${total - failures}/${total} fresh-install checks passed`);
process.exit(failures ? 1 : 0);

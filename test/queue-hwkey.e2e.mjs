// 0.7.13: physical-keyboard typing in Queue search (same rule as Library search). With Queue search open (and the Queue tab active) letters,
// digits, punctuation and Backspace go into the search and are stopped before Home Assistant's own shortcuts (e, c, d open its search bar, a opens
// Assist, m and ? also trigger). Search closed, Ctrl/Meta/Alt combos and real inputs: keys pass through. Esc still closes Queue search. A key
// types once, into the active search only. A window keydown listener imitates HA's shortcut check. 1024x600 only.
// Usage: node test/queue-hwkey.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes a screenshot.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); }
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const QE = `__card.shadowRoot.querySelector('jb-queue')`;
const SE = `__card.shadowRoot.querySelector('jb-search')`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const state = (p) => ev(p, `({ qSearch: ${QE}._search, q: ${QE}._q, lib: ${SE}._query })`);
// keys that reached the HA listeners: every key is recorded by the window listener and by the document listener ('doc:' prefix), so a key that
// gets through shows twice; return them sorted so the document-before-window order does not matter
const ha = (p) => ev(p, `window.__ha.slice().sort()`);
const got = (...keys) => J(keys.flatMap((k) => [k, 'doc:' + k]).sort());
const resetHa = (p) => ev(p, `window.__ha.length = 0`);
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

async function open(tab) {
  const p = await b.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=${tab}&qbuf=0&admin=1`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  if (tab === 'queue') await p.waitForFunction((e) => eval(e).shadowRoot.querySelectorAll('.qr').length > 2, {}, QE);
  // Home Assistant's keyboard shortcuts listen on window (bubble phase): record every key that reaches it
  await ev(p, `window.__ha = []; window.addEventListener('keydown', (e) => window.__ha.push(e.key)); document.addEventListener('keydown', (e) => window.__ha.push('doc:' + e.key));`);
  return p;
}
const openQueueSearch = async (p) => { await ev(p, `${QE}.shadowRoot.querySelector('[data-action="queue-search"]').click()`); await sleep(300); };
const switchTab = async (p, id) => { await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="${id}"]').click()`); await sleep(600); };

// ---- Queue tab, search closed: keys are not taken ----
{
  const p = await open('queue');
  await p.keyboard.type('ecdam?');
  const s = await state(p);
  check('Queue tab, search closed: e c d a m ? all reach Home Assistant (nothing swallowed)', J(await ha(p)) === got('e', 'c', 'd', 'a', 'm', '?'), J(await ha(p)));
  check('Queue tab, search closed: nothing is typed into any search', s.q === '' && s.lib === '' && !s.qSearch, J(s));

  // ---- Queue search open ----
  await openQueueSearch(p); await resetHa(p);
  await p.keyboard.type(ALPHA + '?');
  let s2 = await state(p);
  check('Queue search open: typing a-z and ? fills the query (uppercase)', s2.qSearch && s2.q === ALPHA.toUpperCase() + '?', J(s2));
  check('Queue search open: nothing reaches Home Assistant (no e, c, d, a, m or ? leak)', J(await ha(p)) === '[]', J(await ha(p)));
  check('Queue search open: the Library search is not typed into at the same time (no double typing)', s2.lib === '', J(s2));
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
  s2 = await state(p);
  check('Queue search open: Backspace removes characters and is not leaked', s2.q === ALPHA.toUpperCase().slice(0, -1) && J(await ha(p)) === '[]', J({ s2, ha: await ha(p) }));
  await p.keyboard.type('x'.repeat(70));
  s2 = await state(p);
  check('Queue search open: the query stops at 60 characters, as on the on-screen keyboard', s2.q.length === 60, String(s2.q.length));
  // Backspace and typing give the same result as the on-screen keys: clear, then type through the on-screen keyboard
  await ev(p, `${QE}._q = ''`); await sleep(100);
  await p.keyboard.type('eagles');
  await sleep(500);
  const rows = await ev(p, `${QE}.shadowRoot.querySelectorAll('.qr.sr').length`);
  check('Queue search open: physically typed text filters the queue results', rows > 0 && (await state(p)).q === 'EAGLES', J({ rows, s: await state(p) }));
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/queue-search-physical-typing.png` });
  // modifier combos pass through untouched
  await resetHa(p);
  for (const m of ['Control', 'Meta', 'Alt']) { await p.keyboard.down(m); await p.keyboard.press('e'); await p.keyboard.up(m); }
  const leaked = (await ha(p)).filter((k) => k === 'e').length;
  check('Queue search open: Ctrl+e, Meta+e and Alt+e are ignored (they reach the page, nothing typed)', leaked >= 3 && (await state(p)).q === 'EAGLES', J({ leaked, s: await state(p) }));
  // a real input element in the path: left alone
  await ev(p, `{ const i = document.createElement('input'); i.id = 'hwk'; document.body.appendChild(i); i.focus(); }`);
  await resetHa(p); await p.keyboard.press('e');
  check('Queue search open: a key typed into a real input element is not taken', (await state(p)).q === 'EAGLES' && (await ev(p, `document.getElementById('hwk').value`)) === 'e', J({ s: await state(p), v: await ev(p, `document.getElementById('hwk').value`) }));
  await ev(p, `{ const i = document.getElementById('hwk'); i.blur(); i.remove(); }`);
  // Escape still closes Queue search
  await p.keyboard.press('Escape'); await sleep(300);
  s2 = await state(p);
  check('Escape still closes Queue search and clears the query', !s2.qSearch && s2.q === '', J(s2));
  await resetHa(p); await p.keyboard.type('ec');
  check('After Escape the keys are released again (reach Home Assistant)', J(await ha(p)) === got('e', 'c') && (await state(p)).q === '', J(await ha(p)));
  await p.close();
}

// ---- Library search open (Library tab) ----
{
  const p = await open('browse');
  await resetHa(p);
  await p.keyboard.type(ALPHA + '?');
  const s = await state(p);
  check('Library search open: typing a-z and ? fills the query and leaks nothing to Home Assistant', s.lib === ALPHA.toUpperCase() + '?' && J(await ha(p)) === '[]', J({ s, ha: await ha(p) }));
  check('Library search open: Queue search is not typed into at the same time', s.q === '' && !s.qSearch, J(s));
  await p.keyboard.press('Backspace');
  check('Library search open: Backspace works and is not leaked', (await state(p)).lib === ALPHA.toUpperCase() && J(await ha(p)) === '[]');
  await p.close();
}

// ---- switching tabs: a key types once, into the active search only ----
{
  const p = await open('queue');
  await openQueueSearch(p);
  await p.keyboard.type('ab');
  let s = await state(p);
  check('Queue tab: typing ab goes into Queue search only', s.q === 'AB' && s.lib === '', J(s));
  await switchTab(p, 'browse'); await resetHa(p);
  await p.keyboard.type('cd');
  s = await state(p);
  check('Switched to Library: typing cd goes into Library search once, Queue search untouched, nothing leaks', s.lib === 'CD' && s.q === 'AB' && J(await ha(p)) === '[]', J({ s, ha: await ha(p) }));
  await switchTab(p, 'queue'); await resetHa(p);
  s = await state(p);
  if (!s.qSearch) await openQueueSearch(p);
  const before = await state(p);
  await p.keyboard.type('ef');
  s = await state(p);
  check('Switched back to Queue: typing ef goes into Queue search once, Library search untouched, nothing leaks', s.q === before.q + 'EF' && s.lib === before.lib && J(await ha(p)) === '[]', J({ before, s, ha: await ha(p) }));
  await switchTab(p, 'now'); await resetHa(p);
  await p.keyboard.type('ec');
  s = await state(p);
  check('On another tab (Now Playing): neither search takes keys (they reach Home Assistant)', s.q === before.q + 'EF' && s.lib === before.lib && J(await ha(p)) === got('e', 'c'), J({ s, ha: await ha(p) }));
  await p.close();
}

await b.close();
console.log(`\n${total - failures}/${total} queue hardware-keyboard checks passed`);
process.exit(failures ? 1 : 0);

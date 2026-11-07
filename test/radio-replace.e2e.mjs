// Radio stations replace the queue from every entry point; Play Next / add options hidden.
// Usage: node test/radio-replace.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const SV = `__card.shadowRoot.querySelector('jb-search')`;
const BR = `__card.shadowRoot.querySelector('jb-browse')`;
const ST = `__card.shadowRoot.querySelector('jb-station')`;
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
// 0.7.9 #37: the queue has songs, so a station asks first; Replace goes ahead
const SC = `__card.shadowRoot.querySelector('jb-station-confirm').shadowRoot`;
const replace = async (p) => { const asked = await wait(p, `!!${SC}.querySelector('.confirm[data-kind=station]')`, 2000); const none = (await plays(p)).length === 0; await tap(p, `${SC}.querySelector('[data-action=confirm]')`); await sleep(250); return asked && none; };

async function open(query = '', vp = { width: 1280, height: 800 }) {
  const page = await browser.newPage();
  await hermetic(page);
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.goto(`${BASE}?layout=separate&fresh=1&latency=30&kiosk=1${query.includes('tab=') ? '' : '&tab=search'}${query}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(150);
  return page;
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
async function tap(page, expr) {
  const r = await page.evaluate((expr) => { const el = eval(expr); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }, expr);
  if (!r || !r.w) throw new Error('no element: ' + expr);
  await page.mouse.click(r.x, r.y); await sleep(60);
}
const plays = (p) => ev(p, `window.__calls.filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => c.data)`);
const clearPlays = (p) => ev(p, `window.__calls = window.__calls.filter((c) => !(c.domain === 'music_assistant' && c.service === 'play_media'))`);

// ---- Search radio row ----
{
  const p = await open('&tab=search&radio=1&stations=fake');
  await ev(p, `${SV}.setQuery('mockingbird')`);
  await wait(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'radio')`);
  await sleep(150);
  const st = await ev(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].find((r) => r.dataset.group === 'radio').dataset.uri`);
  const row = `${SV}.shadowRoot.querySelector('.row[data-uri="${st}"]')`;
  await ev(p, `${row}.scrollIntoView({ block: 'center' })`); await sleep(80);
  const acts = await ev(p, `[...${row}.querySelectorAll('.ra-b:not(.fav)')].map((b) => b.dataset.act)`);
  check('RR1 search radio row: only replace (Play Now)', J(acts) === J(['replace']), J(acts));
  await clearPlays(p);
  await tap(p, `${row}.querySelector('[data-act=replace]')`); await sleep(250);
  const asked = await replace(p);
  const pl = await plays(p);
  check('RR2 search Play Now → asks (queue has songs), Replace → enqueue replace, media_type radio', asked && pl.length === 1 && pl[0].enqueue === 'replace' && pl[0].media_type === 'radio' && pl[0].media_id === st && !('radio_mode' in pl[0]), J(pl));
  // song row still has next
  const songActs = await ev(p, `(() => { const r = [...${SV}.shadowRoot.querySelectorAll('.row')].find((x) => x.dataset.group === 'tracks'); return r ? [...r.querySelectorAll('.ra-b:not(.ra-more)')].map((b) => b.dataset.act) : null; })()`);
  check('RR3 search song row still next+replace+remove(+radio)', songActs && songActs[0] === 'next' && songActs.includes('replace') && songActs.includes('remove'), J(songActs));
  await p.close();
}

// ---- Station sheet Play ----
{
  const p = await open('&tab=browse&lhome=0&radio=lib&stations=fake');
  await wait(p, `${BR}.shadowRoot.querySelector('[data-cat=radio], .cats .fc[data-cat="radio"]')`);
  await ev(p, `(${BR}.shadowRoot.querySelector('.cats .fc[data-cat="radio"], [data-cat=radio]')||{}).click?.()`);
  await wait(p, `${BR}.shadowRoot.querySelectorAll('.grid.radio .tile').length > 0`);
  await sleep(150);
  const tileUri = await ev(p, `${BR}.shadowRoot.querySelector('.grid.radio .tile').dataset.uri`);
  // open sheet via event (same path as tap)
  await ev(p, `(() => { const t = ${BR}.shadowRoot.querySelector('.grid.radio .tile'); const it = { uri: t.dataset.uri, name: t.querySelector('b')?.textContent || 'S', media_type: 'radio' }; ${BR}.dispatchEvent(new CustomEvent('jukebox-station', { detail: { item: it }, bubbles: true, composed: true })); })()`);
  await wait(p, `!!${ST}?.shadowRoot?.querySelector('[data-action=play]')`);
  await clearPlays(p);
  await tap(p, `${ST}.shadowRoot.querySelector('[data-action=play]')`); await sleep(250);
  const asked = await replace(p);
  const pl = await plays(p);
  check('RR4 station sheet Play → asks, Replace → enqueue replace', asked && pl.length === 1 && pl[0].enqueue === 'replace' && pl[0].media_type === 'radio' && pl[0].media_id === tileUri, J(pl));
  await p.close();
}

// ---- Browse long-press menu ----
{
  const p = await open('&tab=browse&lhome=0&radio=lib&stations=fake');
  await wait(p, `${BR}.shadowRoot.querySelector('[data-cat=radio], .cats .fc[data-cat="radio"]')`);
  await ev(p, `(${BR}.shadowRoot.querySelector('.cats .fc[data-cat="radio"], [data-cat=radio]')||{}).click?.()`);
  await wait(p, `${BR}.shadowRoot.querySelectorAll('.grid.radio .tile').length > 0`);
  await sleep(150);
  const box = await ev(p, `(() => { const t = ${BR}.shadowRoot.querySelector('.grid.radio .tile'); const r = t.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, uri: t.dataset.uri }; })()`);
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await sleep(650); await p.mouse.up(); await sleep(200);
  const menu = await ev(p, `[...${BR}.shadowRoot.querySelectorAll('.menu .mi')].map((m) => m.dataset.action)`);
  check('RR5 browse radio long-press menu: Play Now only (+cancel), no next/remove', menu.includes('play') && !menu.includes('next') && !menu.includes('remove') && menu.includes('cancel'), J(menu));
  await clearPlays(p);
  await tap(p, `${BR}.shadowRoot.querySelector('.menu .mi[data-action=play]')`); await sleep(250);
  const asked = await replace(p);
  const pl = await plays(p);
  check('RR6 browse menu Play Now → asks, Replace → enqueue replace', asked && pl.length === 1 && pl[0].enqueue === 'replace' && pl[0].media_type === 'radio' && pl[0].media_id === box.uri, J(pl));
  await p.close();
}

// ---- Album/playlist unchanged (confirm still for replace) ----
{
  const p = await open('&tab=search&radio=1&stations=fake');
  await ev(p, `${SV}.setQuery('chicago')`);
  await wait(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'playlists')`);
  await sleep(150);
  const prow = await ev(p, `(() => { const r = [...${SV}.shadowRoot.querySelectorAll('.row')].find((x) => x.dataset.group === 'playlists'); return r ? { uri: r.dataset.uri, acts: [...r.querySelectorAll('.ra-b:not(.ra-more)')].map((b) => b.dataset.act) } : null; })()`);
  check('RR7 playlist row still next+replace+remove', prow && J(prow.acts) === J(['next', 'replace', 'remove']), J(prow));
  await clearPlays(p);
  const rowSel = `${SV}.shadowRoot.querySelector('.row[data-uri="${prow.uri}"]')`;
  await ev(p, `${rowSel}.scrollIntoView({block:'center'})`); await sleep(80);
  await tap(p, `${rowSel}.querySelector('[data-act=next]')`); await sleep(250);
  const pl = await plays(p);
  check('RR8 playlist Play Next still enqueue next', pl.length === 1 && pl[0].enqueue === 'next' && pl[0].media_type === 'playlist', J(pl));
  await p.close();
}

// Station detail rows must contain their visible Play Now label at all screenshot sizes.
for (const [width, height] of [[1024, 600], [820, 1180], [1920, 1080]]) {
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width, height, deviceScaleFactor: 1 });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=browse`); await p.waitForFunction('window.__ready === true');
  await p.waitForFunction(() => __card.shadowRoot.querySelector('jb-search')?.browse);
  await p.evaluate(() => __card.shadowRoot.querySelector('jb-search').browse.openDetail({ uri: 'library://genre/1', name: 'Mock Jazz', media_type: 'genre', item_id: '1', provider: 'library' }, 'genre'));
  await p.waitForFunction(() => __card.shadowRoot.querySelector('jb-search').browse.detail?.entry?.data?.loading === false);
  await p.evaluate(() => { const d = __card.shadowRoot.querySelector('jb-search').browse.detail; d.entry = { ...d.entry, data: { ...d.entry.data, tracks: [], sections: [{ type: 'radio', name: 'Radio', items: [{ uri: 'library://radio/7', name: 'Mockingbird Jazz FM', media_type: 'radio', provider: 'library', item_id: '7' }] }] } }; });
  await p.waitForFunction(() => __card.shadowRoot.querySelector('jb-search').browse.detail.shadowRoot.querySelector('.row[data-type=radio]'));
  const g = await p.evaluate(() => {
    const row = __card.shadowRoot.querySelector('jb-search').browse.detail.shadowRoot.querySelector('.row[data-type=radio]'), b = row.querySelector('[data-act=replace]'), t = b.querySelector('span');
    const r = row.getBoundingClientRect(), br = b.getBoundingClientRect(), tr = t.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(t);
    return { lines: [...range.getClientRects()].filter(x => x.width > 0).length, touch: b.offsetWidth >= 44 && b.offsetHeight >= 44,
      contained: tr.left >= br.left - 1 && tr.right <= br.right + 1 && tr.top >= br.top - 1 && tr.bottom <= br.bottom + 1 && br.top >= r.top - 1 && br.bottom <= r.bottom + 1 };
  });
  check(`RR9 ${width}x${height} detail station action single-line, touch-sized and contained`, g.lines === 1 && g.touch && g.contained, J(g)); await p.close();
}

await browser.close();
console.log(`\nradio-replace.e2e: ${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

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

// 0.7.9 #37: a live station asks "This will replace your queue" (Replace / Cancel) when the queue has songs; empty queue plays.
const SC = `__card.shadowRoot.querySelector('jb-station-confirm').shadowRoot`;
const dlg = (p) => ev(p, `(() => { const d = ${SC}.querySelector('.confirm'); return d ? { kind: d.dataset.kind, q: d.querySelector('#cf-q').textContent.trim(),
  btns: [...d.querySelectorAll('.cbtn')].map((b) => b.textContent.trim()) } : null; })()`);
async function searchStation(q) {
  const p = await open('&tab=search&radio=1&stations=fake' + q);
  await ev(p, `${SV}.setQuery('mockingbird')`);
  await wait(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'radio')`); await sleep(150);
  const uri = await ev(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].find((r) => r.dataset.group === 'radio').dataset.uri`);
  const row = `${SV}.shadowRoot.querySelector('.row[data-uri="${uri}"]')`;
  await ev(p, `${row}.scrollIntoView({ block: 'center' })`); await sleep(80);
  await clearPlays(p);
  const play = () => tap(p, `${row}.querySelector('[data-act=replace]')`).then(() => sleep(300));
  return { p, uri, play };
}
{
  const { p, uri, play } = await searchStation('');
  await play();
  const d = await dlg(p);
  check('SC1 queue has songs: station Play shows "This will replace your queue" with Cancel + Replace, nothing played yet',
    d?.kind === 'station' && d.q === 'This will replace your queue' && J(d.btns) === J(['Cancel', 'Replace']) && (await plays(p)).length === 0, J(d));
  await tap(p, `${SC}.querySelector('[data-action=cancel]')`); await sleep(300);
  check('SC2 Cancel closes it and plays nothing', !(await dlg(p)) && (await plays(p)).length === 0, J(await plays(p)));
  await play(); await p.keyboard.press('Escape'); await sleep(300);
  check('SC3 Esc closes it and plays nothing', !(await dlg(p)) && (await plays(p)).length === 0);
  await play(); await p.mouse.click(20, 400); await sleep(300);
  check('SC4 a tap outside closes it and plays nothing', !(await dlg(p)) && (await plays(p)).length === 0);
  await play(); await tap(p, `${SC}.querySelector('[data-action=confirm]')`); await sleep(400);
  const pl = await plays(p);
  check('SC5 Replace plays the station (one play_media, enqueue replace)', !(await dlg(p)) && pl.length === 1 && pl[0].enqueue === 'replace' && pl[0].media_id === uri, J(pl));
  await p.close();
}
{
  const { p, uri, play } = await searchStation('&idle=1');
  await play();
  const pl = await plays(p);
  check('SC6 empty queue: the station plays right away, no popup', !(await dlg(p)) && pl.length === 1 && pl[0].media_id === uri, J({ d: await dlg(p), pl }));
  await p.close();
}
{
  // a queue holding only a station counts as empty (no songs to lose)
  const { p, play } = await searchStation('');
  await ev(p, `(() => { const q = __card.queue; q.snap = { ...q.snap, items: q.snap.items.slice(0, 1).map((x) => ({ ...x, media_content_id: 'library://radio/9' })), total: 1 }; })()`);
  await play();
  check('SC7 a queue with only a station (no songs) plays right away, no popup', !(await dlg(p)) && (await plays(p)).length === 1, J(await dlg(p)));
  await p.close();
}
{
  // station sheet Play
  const p = await open('&tab=browse&lhome=0&radio=lib&stations=fake');
  await ev(p, `${BR}.dispatchEvent(new CustomEvent('jukebox-station', { detail: { item: { uri: 'library://radio/1', name: 'Test FM', media_type: 'radio' } }, bubbles: true, composed: true }))`);
  await wait(p, `!!${ST}?.shadowRoot?.querySelector('[data-action=play]')`);
  await clearPlays(p);
  await tap(p, `${ST}.shadowRoot.querySelector('[data-action=play]')`); await sleep(300);
  const d = await dlg(p);
  check('SC8 station sheet Play asks first (above the sheet)', d?.kind === 'station' && (await plays(p)).length === 0, J(d));
  const top = await ev(p, `(() => { const d = ${SC}.querySelector('.confirm').getBoundingClientRect(); const el = __card.shadowRoot.elementFromPoint(d.left + d.width / 2, d.top + 10); return el?.tagName; })()`);
  check('SC8b the confirm is on top of the station sheet', top === 'JB-STATION-CONFIRM', top);
  await tap(p, `${SC}.querySelector('[data-action=confirm]')`); await sleep(400);
  check('SC9 Replace from the sheet plays it', (await plays(p)).length === 1);
  await p.close();
}
{
  // 0.7.9 #33: the Recently played strip is gone, so there is no station tile there to confirm
  const p = await open('&tab=browse&radio=lib&stations=fake');
  const RB = `${BR}.shadowRoot`;
  await sleep(1200);
  check('SC10 (0.7.9 #33) no Recently played strip in the Library (no station tile there)', !(await ev(p, `!!${RB}.querySelector('[data-recent-row]')`)));
  await p.close();
}
{
  // a song / album Play Now keeps its old confirm (not the station one)
  const p = await open('&tab=search&radio=1&stations=fake');
  await ev(p, `${SV}.setQuery('mockingbird')`);
  await wait(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'tracks')`); await sleep(150);
  await clearPlays(p);
  await tap(p, `[...${SV}.shadowRoot.querySelectorAll('.row')].find((r) => r.dataset.group === 'tracks').querySelector('[data-act=replace]')`); await sleep(300);
  check('SC11 songs are unchanged: no station confirm', !(await dlg(p)), J(await dlg(p)));
  await p.close();
}
console.log(`\nstation-confirm.e2e: ${total - failures}/${total} passed`);
await browser.close();
process.exit(failures ? 1 : 0);

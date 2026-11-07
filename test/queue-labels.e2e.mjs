// The same three queue labels, fully readable on every queueing surface and required viewport.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
let total = 0, failures = 0; const errors = [];
const check = (name, ok, detail = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = '__card.shadowRoot', SV = `${C}.querySelector('jb-search').shadowRoot`, BR = `${SV}.querySelector('jb-browse').shadowRoot`;
const QV = `${C}.querySelector('jb-queue').shadowRoot`;
async function open(vp) { const p = await browser.newPage(); await hermetic(p); p.on('pageerror', (e) => errors.push(e.message)); await p.setViewport({ deviceScaleFactor: 1, ...vp }); await p.goto(`${BASE}?fresh=1&latency=20&tab=browse&admin=1`); await p.waitForFunction('window.__ready === true'); await sleep(300); return p; }
async function tap(p, expr) { const r = await p.evaluate((e) => { const el = eval(e); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; }, expr); if (!r?.w) throw new Error(`not visible: ${expr}`); await p.mouse.click(r.x, r.y); await sleep(120); }

async function labelsFit(p, root, selector, queue = false, search = false) {
 return p.evaluate(({ root, selector, queue, search }) => {
  const rows = [...eval(root).querySelectorAll(selector)];
  // 0.7.9 #35: search results: Add to queue, Play Next, Play Now (no Remove)
  const acts = queue ? ['playnext', 'playnow', 'remove'] : search ? ['add', 'next', 'replace'] : ['next', 'replace', 'remove'];
  const want = search ? 'Add to queue,Play Next,Play Now' : 'Play Next,Play Now,Remove';
  const details = rows.map((row) => {
   const rr = row.getBoundingClientRect();
   return [...row.querySelectorAll('.ra-b')].filter((b) => acts.includes(queue ? b.dataset.action : b.dataset.act) && b.getBoundingClientRect().width).map((b) => {
    const r = b.getBoundingClientRect(), t = b.querySelector('span');
    return { label: t.textContent, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, rowTop: rr.top, rowBottom: rr.bottom, rowLeft: rr.left, rowRight: rr.right, sw: t.scrollWidth, cw: t.clientWidth };
   });
  });
  return { ok: rows.length > 0 && details.every((bs) => bs.length === 3 && bs.map((b) => b.label).join() === want && bs.every((b) => b.w >= 44 && b.h >= 44 && b.left >= b.rowLeft - 1 && b.right <= b.rowRight + 1 && b.top >= b.rowTop - 1 && b.bottom <= b.rowBottom + 1 && b.sw <= b.cw + 1)), sample: details[0], rows: rows.length };
 }, { root, selector, queue, search });
}
for (const vp of [{ width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 820, height: 1180 }]) {
 const tag = `${vp.width}x${vp.height}`; const p = await open(vp);
 await tap(p, `${SV}.querySelector('[data-lcat="track"]')`); await p.waitForFunction(`${BR}.querySelectorAll('.list .row[data-type="track"]').length > 0`);
 const lib = await labelsFit(p, BR, '.list .row[data-type="track"]'); check(`${tag} Library labels fit`, lib.ok, JSON.stringify(lib));
 await tap(p, `${SV}.querySelector('[data-lcat="playlist"]')`); await tap(p, `${BR}.querySelector('.grid.playlist .tile .open')`); await p.waitForFunction(`${BR}.querySelector('jb-detail')?.shadowRoot.querySelectorAll('.list.tracks .row').length > 0`);
 const pl = await labelsFit(p, `${BR}.querySelector('jb-detail').shadowRoot`, '.list.tracks .row'); check(`${tag} Playlist labels fit`, pl.ok, JSON.stringify(pl));
 await tap(p, `${C}.querySelector('[data-tab="browse"]')`); await tap(p, `${SV}.querySelector('[data-lcat="artist"]')`); await tap(p, `${BR}.querySelector('.grid.artist .tile .open')`); await p.waitForFunction(`${BR}.querySelector('jb-detail')?.shadowRoot.querySelectorAll('.list.tracks .row').length > 0`);
 const ar = await labelsFit(p, `${BR}.querySelector('jb-detail').shadowRoot`, '.list.tracks .row'); check(`${tag} Artist labels fit`, ar.ok, JSON.stringify(ar));
 await p.close(); const s = await open(vp); await s.evaluate(() => { const x = __card.shadowRoot.querySelector('jb-search'); x._lcat = 'all'; x.setQuery('MOCK'); }); await s.waitForFunction(`${SV}.querySelectorAll('.grp.tracks .row').length > 0`);
 const se = await labelsFit(s, SV, '.grp.tracks .row', false, true); check(`${tag} Search labels fit`, se.ok, JSON.stringify(se)); await s.close();
 const q = await open(vp); await tap(q, `${C}.querySelector('[data-tab="queue"]')`); await q.waitForFunction(`${QV}.querySelectorAll('.qr.next').length > 0`);
 const qu = await labelsFit(q, QV, '.qr.next', true); check(`${tag} Queue labels fit`, qu.ok, JSON.stringify(qu));
 // #41: Move up/down and More icons use the same color as the Play Now icon (enabled and disabled), wherever they are shown
 const mc = await q.evaluate((qv) => { const Q = eval(qv); const play = Q.querySelector('.qr.next .ra-b[data-action="playnow"]'); const pc = getComputedStyle(play).color;
   const mv = [...Q.querySelectorAll('.qr.next .qa[data-action="up"], .qr.next .qa[data-action="down"], .qr.next .qa.mo')].filter((b) => getComputedStyle(b).display !== 'none');
   return { pc, n: mv.length, dis: mv.filter((b) => b.disabled).length, bad: mv.filter((b) => getComputedStyle(b).color !== pc).map((b) => (b.dataset.action || 'more') + ':' + getComputedStyle(b).color) }; }, QV);
 check(`${tag} Queue Move up/down and More icons match the Play icon color`, mc.bad.length === 0, JSON.stringify(mc)); await q.close();
}
check('no page errors', errors.length === 0, errors.join('; ')); await browser.close(); console.log(`${total - failures}/${total} queue-label checks passed`); process.exit(failures ? 1 : 0);

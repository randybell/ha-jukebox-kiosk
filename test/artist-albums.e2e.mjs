// 0.7.10 #1: Library search "EAG" > Eagles > Albums rows: icon-only Add to queue / Play next / Play now / Start radio
// (48px, aria-label + title), no Remove and no More, named once by a sticky column header that sits exactly over the buttons.
// Usage: node test/artist-albums.e2e.mjs (starts its own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const DET = `${SV}.querySelector('jb-detail').shadowRoot`;
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);

for (const [name, vp, q] of [['1024x712 (HA toolbar + sidebar)', { width: 1080, height: 768 }, '&ha=toolbar&sidebar=narrow'], ['1024x600', { width: 1024, height: 600 }, '']]) {
  for (const lg of [false, true]) {
    const tag = `${name}${lg ? ' large_buttons' : ''}`;
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ ...vp, deviceScaleFactor: 1 });
    await p.goto(`${BASE}?fresh=1&latency=20&tab=browse${q}${lg ? '&cfg=' + encodeURIComponent(JSON.stringify({ large_buttons: true })) : ''}`);
    await p.waitForFunction('window.__ready === true'); await sleep(500);
    const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.mouse.click(qb.x, qb.y); await sleep(300);
    await p.keyboard.type('EAG', { delay: 50 });
    await p.waitForFunction((s) => [...eval(s).querySelectorAll('button')].some((x) => /^\s*artists\s*$/i.test(x.textContent)), {}, SV);
    const ac = await center(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*artists\\s*$/i.test(x.textContent))`); await p.mouse.click(ac.x, ac.y);
    await p.waitForFunction((s) => [...eval(s).querySelectorAll('.row[data-type="artist"]')].some((r) => /Eagles/.test(r.textContent)), {}, SV);
    const er = await center(p, `[...${SV}.querySelectorAll('.row[data-type="artist"]')].find((r) => /Eagles/.test(r.textContent)).querySelector('.rt')`);
    await p.mouse.click(er.x - 40, er.y, { delay: 40 });
    await p.waitForFunction((d) => { try { return eval(d).querySelectorAll('.list.albums .row').length > 0; } catch { return false; } }, {}, DET);
    // the mock has 2 Eagles albums: add 6 more to the page the Library holds, so the list scrolls
    await p.evaluate((s) => { const det = eval(s).querySelector('jb-detail'); const d = det.entry.data; const mk = (n, y) => ({ uri: `apple_music://album/x${y}`, name: n, media_type: 'album', provider: 'apple_music', item_id: 'x' + y, year: y, artists: [{ name: 'Eagles' }] });
      det.entry.data = { ...d, albums: [...d.albums, ...['Desperado', 'On the Border', 'One of These Nights', 'The Long Run', 'Hell Freezes Over', 'Long Road Out of Eden'].map((n, i) => mk(n, 1973 + i))] }; det.requestUpdate(); }, SV);
    await sleep(400);
    const geo = () => p.evaluate((D) => {
      const d = eval(D), h = d.querySelector('.ahd'), sc = d.querySelector('.scroll');
      const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
      const rows = [...d.querySelectorAll('.list.albums .row')].map((r) => {
        const bs = [...r.querySelectorAll('.ra-b[data-act]')].filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width);
        return { acts: bs.map((b) => b.dataset.act).join(), more: !!r.querySelector('.ra-b[data-act="more"]:not([style*="none"])') && getComputedStyle(r.querySelector('.ra-b[data-act="more"]') ?? document.body).display !== 'none',
          labelsShown: bs.some((b) => { const s = b.querySelector('span'); return s && getComputedStyle(s).display !== 'none'; }),
          aria: bs.every((b) => b.getAttribute('aria-label') && b.title), boxes: bs.map(R) };
      });
      return { head: h ? [...h.querySelectorAll('span')].map((s) => ({ text: s.textContent, ...R(s) })) : null, hb: h && R(h), sc: R(sc), st: sc.scrollTop, maxSt: sc.scrollHeight - sc.clientHeight, rows };
    }, DET);
    let g = await geo();
    const r0 = g.rows[0];
    check(`${tag}: every Albums row shows Add to queue, Play next, Play now, Start radio (no Remove, no More)`, g.rows.length >= 8 && g.rows.every((r) => r.acts === 'add,next,replace,radio' && !r.more), JSON.stringify(g.rows.map((r) => r.acts)));
    check(`${tag}: the row buttons are icon-only, each ≥ 48px with an aria-label and title`, g.rows.every((r) => !r.labelsShown && r.aria && r.boxes.every((b) => b.w >= 47.5 && b.h >= 47.5)), JSON.stringify(r0));
    check(`${tag}: one column header names the buttons with the existing wording`, !!g.head && g.head.map((x) => x.text).join() === 'Add to queue,Play Next,Play Now,Start radio', JSON.stringify(g.head));
    check(`${tag}: each header name sits exactly over its button column, in every row`, !!g.head && g.rows.every((r) => r.boxes.every((b, i) => Math.abs(b.l - g.head[i].l) <= 1 && Math.abs(b.r - g.head[i].r) <= 1)), JSON.stringify({ head: g.head, row0: r0.boxes }));
    // scroll the albums list well past its start: the header stays at the top of the panel
    await p.evaluate((D) => { const d = eval(D), sc = d.querySelector('.scroll'), l = d.querySelector('.list.albums'); sc.scrollTop += l.getBoundingClientRect().top - sc.getBoundingClientRect().top + 200; }, DET);
    await sleep(250); g = await geo();
    const covered = g.rows.some((r) => r.boxes[0].t < g.hb.t);
    check(`${tag}: after scrolling the list, the header is still showing at the top of the panel`, covered && g.hb.t >= g.sc.t - 1 && g.hb.t <= g.sc.t + 2 && g.hb.b <= g.sc.b, JSON.stringify({ hb: g.hb, sc: g.sc, st: g.st }));
    await p.close();
  }
}
await browser.close();
console.log(`\n${total - failures}/${total} artist-albums checks passed`);
process.exit(failures ? 1 : 0);

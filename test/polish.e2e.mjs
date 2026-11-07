// Only the four 0.7.7 polish requests: search labels, queue labels/width, and the mock note alignment.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
let total = 0, failures = 0;
const check = (name, ok, info) => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${JSON.stringify(info)}`); };
async function labelGeometry(page, tag, queue = false) {
  return page.evaluate(({ tag, queue }) => {
    const root = __card.shadowRoot.querySelector(tag).shadowRoot, rows = [...root.querySelectorAll(queue ? '.qr' : '.grp .row')];
    // 0.7.9 #35: search results: Add to queue, Play Next, Play Now (no Remove)
    const acts = queue ? ['playnext', 'playnow', 'remove'] : tag === 'jb-search' ? ['add', 'next', 'replace'] : ['next', 'replace', 'remove'];
    const details = rows.map(row => {
      const rr = row.getBoundingClientRect();
      return [...row.querySelectorAll('.ra-b')].filter(b => acts.includes(queue ? b.dataset.action : b.dataset.act)).map(b => {
        const r = b.getBoundingClientRect(), t = b.querySelector('span'), tr = t.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(t);
        const lines = [...range.getClientRects()].filter(r => r.width > 0).length;
        return { label: t.textContent, lines, font: parseFloat(getComputedStyle(b).fontSize), touch: b.offsetWidth >= 44 && b.offsetHeight >= 44,
          inside: tr.left >= r.left - 1 && tr.right <= r.right + 1 && tr.top >= r.top - 1 && tr.bottom <= r.bottom + 1 && r.top >= rr.top - 1 && r.bottom <= rr.bottom + 1 && r.left >= rr.left - 1 && r.right <= rr.right + 1,
          unclipped: t.scrollWidth <= t.clientWidth + 1 };
      });
    });
    return { rows: rows.length, details, ok: rows.length > 0 && details.every(bs => bs.length === 3 && bs.every(b => b.lines === 1 && b.touch && b.inside && b.unclipped && (!queue || b.font >= 14))) };
  }, { tag, queue });
}
try {
  // Required screenshot sizes plus phones to cover touch-label wrapping at the narrow breakpoint.
  for (const [width, height] of [[1024, 600], [820, 1180], [1920, 1080], [390, 844], [360, 640]]) {
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width, height, deviceScaleFactor: 1 }); const tag = `${width}x${height}`;
    await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=browse`); await p.waitForFunction('window.__ready === true');
    await p.evaluate(() => __card.shadowRoot.querySelector('jb-search').setQuery('MO'));
    await p.waitForFunction(() => __card.shadowRoot.querySelector('jb-search').shadowRoot.querySelectorAll('.grp .row').length > 0);
    const search = await labelGeometry(p, 'jb-search'); check(`${tag} Search labels single-line and contained in rows`, search.ok, search);
    await p.evaluate(() => __card.shadowRoot.querySelector('[data-tab=queue]').click());
    await p.waitForFunction(() => __card.shadowRoot.querySelector('jb-queue').shadowRoot.querySelectorAll('.qr.next').length > 3);
    const queue = await labelGeometry(p, 'jb-queue', true); check(`${tag} Queue labels >=14px, touch-sized, single-line and contained`, queue.ok, queue);
    const fill = await p.evaluate(() => { const host = __card.shadowRoot.querySelector('jb-queue'), root = host.shadowRoot.querySelector('.qx'); return { host: host.getBoundingClientRect().width, content: root.getBoundingClientRect().width }; });
    check(`${tag} Queue uses available width`, Math.abs(fill.host - fill.content) <= 1, fill);
    if (width >= 820) {
      await p.evaluate(() => __card.shadowRoot.querySelector('[data-tab=now]').click());
      await p.waitForFunction(() => { const i = __card.shadowRoot.querySelector('jb-now').shadowRoot.querySelector('.art img'); return i?.complete && i.naturalWidth > 0; });
      const art = await p.evaluate(async () => {
        const img = __card.shadowRoot.querySelector('jb-now').shadowRoot.querySelector('.art img');
        const svg = new DOMParser().parseFromString(await (await fetch(img.src)).text(), 'image/svg+xml'), circle = svg.querySelector('circle');
        const c = document.createElement('canvas'); c.width = 400; c.height = 400;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 400, 400); const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        let l = c.width, r = 0, t = c.height, b = 0, n = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); n++; } }
        return { n, x: (l + r) / 2, y: (t + b) / 2, cx: Number(circle.getAttribute('cx')), cy: Number(circle.getAttribute('cy')) };
      });
      check(`${tag} Now Playing note ink is centered inside its circle`, art.n > 0 && Math.abs(art.x - art.cx) <= 2 && Math.abs(art.y - art.cy) <= 2, art);
    }
    await p.close();
  }
} finally { await browser.close(); }
console.log(`${total - failures}/${total} polish checks passed`); process.exit(failures ? 1 : 0);

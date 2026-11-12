// Pixel and contrast helpers for the backdrop tests: read what is really painted (not just computed styles) and compare the text with it.
const rgbaOf = (s) => { const m = (s.match(/[\d.]+/g) ?? []).map(Number); if (/^color\(srgb/.test(s)) return [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1]; return [m[0], m[1], m[2], m[3] ?? 1]; };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export const contrast = (fg, bg) => { const [r, g, b, a] = rgbaOf(fg); const B = Array.isArray(bg) ? bg : rgbaOf(bg); const m = [0, 1, 2].map((i) => [r, g, b][i] * a + B[i] * (1 - a)); const l1 = lum(m) + 0.05, l2 = lum(B) + 0.05; return Math.max(l1, l2) / Math.min(l1, l2); };
/** the colour really painted at (x, y) of the page, as [r, g, b] */
export async function pixel(page, x, y) {
  const b64 = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, encoding: 'base64' });
  return page.evaluate(async (d) => { const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode(); const c = document.createElement('canvas'); c.width = 1; c.height = 1; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); }, b64);
}
/** Now Playing fill + text: the painted colour in the empty top-left corner of the Now Playing area, the title and subtitle colours, their contrast with it, and the ::before facts */
export async function nowFill(page, ev, C) {
  const info = await ev(page, `(() => { const np = ${C}.querySelector('main.np'); const r = np.getBoundingClientRect(); const b = getComputedStyle(np, '::before'); const now = ${C}.querySelector('jb-now').shadowRoot;
    return { x: r.left + 4, y: r.top + 4, content: b.content, position: b.position, w: b.width, h: b.height, npW: r.width, npH: r.height, title: getComputedStyle(now.querySelector('.ti')).color, sub: getComputedStyle(now.querySelector('.sub')).color }; })()`);
  const px = await pixel(page, info.x, info.y);
  return { ...info, px, cTitle: contrast(info.title, px), cSub: contrast(info.sub, px) };
}

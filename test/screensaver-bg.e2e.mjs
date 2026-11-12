// 0.8.3 (#96): album art is a background for the screensaver only. This proves the screensaver background did not change when the
// Now Playing backdrop option was removed: its computed background layers (the black canvas, the art layer with its blur/saturate and
// its shade/vignette, the no-art gradient) are compared with values recorded from 5bd77d0, in the light and dark theme, with album art
// playing and without, and with a saved `backdrop` of nothing, plain, full, light, auto (all valid in 5bd77d0) and of static, off and junk
// (any saved value is now ignored, so they must give the plain look). Usage: node test/screensaver-bg.e2e.mjs
// Re-record (only from 5bd77d0): JB_GOLDEN_WRITE=1 node test/screensaver-bg.e2e.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
import { launch, openPage, sleep } from './themes-lib.mjs';
const GOLDEN = new URL('./screensaver-bg.golden.json', import.meta.url);
const WRITE = process.env.JB_GOLDEN_WRITE === '1';
const BASE = await devIndex();
const browser = await launch();
let failures = 0, total = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const golden = WRITE ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));

const SNAP = () => {
  const root = window.__card.shadowRoot;
  const amb = root.querySelector('.amb');
  if (!amb) return null;
  const pick = (el, pseudo) => {
    if (!el) return null;
    const s = getComputedStyle(el, pseudo);
    const o = {};
    const norm = (v) => (typeof v === 'string' ? v.split(location.origin).join('ORIGIN') : v); // the dev server port changes per run
    for (const k of ['content', 'position', 'zIndex', 'top', 'right', 'bottom', 'left', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
      'backgroundRepeat', 'opacity', 'filter', 'backdropFilter', 'animationName', 'animationDuration', 'color', 'overflow']) o[k] = norm(s[k]);
    return o;
  };
  const bg = amb.querySelector('.sv-bg');
  return {
    ambClass: amb.className.replace(/\s+/g, ' ').trim(),
    amb: pick(amb), ambAfter: pick(amb, '::after'), ambBefore: pick(amb, '::before'),
    bgPresent: !!bg, bgClass: bg?.className ?? null, bgStyleAttr: (bg?.getAttribute('style') ?? '').split(location.origin).join('ORIGIN') || null,
    bg: pick(bg), bgAfter: pick(bg, '::after'), bgBefore: pick(bg, '::before'),
    children: [...amb.children].map((c) => c.className),
  };
};

const BACKDROPS = [['', 'none'], ['plain', 'plain'], ['full', 'full'], ['light', 'light'], ['auto', 'auto']];
const IGNORED = [['static', 'plain'], ['off', 'plain'], ['bogus-value', 'plain'], ['FULL', 'plain']]; // now ignored: the plain look
const snap = async (theme, bd, extra) => {
  const cfg = bd ? '&backdrop=' + encodeURIComponent(bd) : '';
  let p;
  try { p = await openPage(browser, hermetic, BASE, theme, `&tab=now&saver=0.02${cfg}${extra}`); } catch (e) { return { s: null, errs: ['the card did not load: ' + String(e.message).slice(0, 100)] }; }
  await p.waitForFunction(() => !!window.__card.shadowRoot.querySelector('.amb'), { timeout: 8000 }).catch(() => {});
  await sleep(1500); // past the 900 ms fade-in
  const s = await p.evaluate(SNAP);
  const errs = [...p._errs];
  await p.close();
  return { s, errs };
};
const J = (x) => JSON.stringify(x);
const diff = (a, b) => { const out = []; const walk = (x, y, path) => { if (x && typeof x === 'object' && y && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path + '.' + k); } else if (J(x) !== J(y)) out.push(`${path}: ${J(x)} vs ${J(y)}`); }; walk(a, b, ''); return out; };

for (const theme of ['light', 'dark']) for (const [art, extra] of [['art', ''], ['noart', '&noart=1'], ['idle', '&idle=1']]) {
  const key = (bd) => `${theme}|${art}|${bd}`;
  if (WRITE) {
    for (const [bd, id] of BACKDROPS) { const { s } = await snap(theme, bd, extra); golden[key(id)] ??= s; }
    check(`record ${theme}/${art}`, !!golden[key('plain')]);
    continue;
  }
  const base = golden[key('plain')];
  const shape = art === 'art' ? 'the album-art layer' : art === 'noart' ? 'the layer made from the queue image (the player has no picture)' : 'no art layer (nothing playing)';
  check(`SB0 ${theme}/${art}: a recorded 5bd77d0 screensaver exists, with ${shape}`,
    !!base && (art === 'idle' ? !base.bgPresent : art === 'art' ? base.bgPresent && !base.bgClass.includes('noart') && /url\(/.test(base.bg.backgroundImage) : base.bgPresent), J(base?.bgClass));
  for (const [bd, id] of [...BACKDROPS, ...IGNORED]) {
    const { s, errs } = await snap(theme, bd, extra);
    const want = golden[key(id)];
    const d = want && s ? diff(want, s) : ['missing snapshot'];
    check(`SB1 ${theme}/${art}/backdrop=${bd || '(unset)'}: screensaver background layers identical to 5bd77d0${id === 'plain' && bd !== 'plain' ? ' (plain look: the saved value is ignored)' : ''}`, d.length === 0, d.slice(0, 3).join(' | '));
    check(`SB2 ${theme}/${art}/backdrop=${bd || '(unset)'}: no page error`, errs.length === 0, errs[0] ?? '');
  }
}
if (WRITE) { writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n'); console.log('recorded', Object.keys(golden).length, 'snapshots'); }
await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

// 0.8.1 theme compliance. Real Home Assistant default light and dark themes, a translucent "glass" theme, a dashboard with a
// wallpaper, and a "sentinel" theme where every colour variable is a unique value, so a painted colour that is not one of them
// is a fixed colour. Usage: node test/themes.e2e.mjs
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
import { launch, openPage, SENT, sleep } from './themes-lib.mjs';
import { SCENES, probe, ev, C } from './themes-scenes.mjs';
const BASE = await devIndex();
const browser = await launch();
let failures = 0, total = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const NOW = (n) => /^now|^speakers-picker/.test(n); // Now Playing (art contrast white / the art shade) and the lyrics overlay may use white and black
const sentTuples = Object.values(SENT);
const known = (r, g, b) => sentTuples.some(([x, y, z]) => Math.abs(x - r) <= 1 && Math.abs(y - g) <= 1 && Math.abs(z - b) <= 1);
const isWB = (r, g, b) => (r >= 254 && g >= 254 && b >= 254) || (r <= 1 && g <= 1 && b <= 1);
const colours = (str) => {
  const out = [];
  for (const m of str.matchAll(/rgba?\(([^)]+)\)/g)) { const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); out.push(v.slice(0, 3)); }
  for (const m of str.matchAll(/color\(srgb ([^)]+)\)/g)) { const v = m[1].split(/[ /]+/).filter(Boolean).map(Number); out.push(v.slice(0, 3).map((x) => Math.round(x * 255))); }
  return out;
};
const SV = `${C}.querySelector('jb-search')?.shadowRoot`;
const QV = `${C}.querySelector('jb-queue')?.shadowRoot`;
const HS = `${C}.querySelector('jb-hold-sheet')?.shadowRoot`;
const newPage = async (theme, name) => { const sc = SCENES[name]; const p = await openPage(browser, hermetic, BASE, theme, sc.q); if (sc.act) await sc.act(p); await sleep(300); return p; };

// 1. every scene in the sentinel theme: no fixed colour, no fixed shadow, no page error
const unthemed = [];
for (const name of Object.keys(SCENES)) {
  let p;
  try {
    p = await newPage('sentinel', name);
    const rows = await probe(p);
    const bad = [];
    for (const [path, rec] of rows) for (const k of ['bg', 'color', 'icon', 'border', 'shadow', 'bgimg']) {
      if (!rec[k]) continue;
      for (const [r, g, b] of colours(rec[k])) {
        if (known(r, g, b)) continue;
        if (k !== 'shadow' && NOW(name) && isWB(r, g, b)) continue;
        bad.push(`${path} ${k}=rgb(${r},${g},${b})`);
      }
    }
    check(`T1 ${name}: every painted colour comes from the HA theme`, bad.length === 0, [...new Set(bad)].slice(0, 6).join(' | '));
    check(`T1 ${name}: no page errors`, p._errs.length === 0, p._errs[0] ?? '');
    unthemed.push(...bad);
  } catch (e) { check(`T1 ${name}: scene opens`, false, String(e.message).slice(0, 140)); }
  try { await p?.close(); } catch {}
}

// 2. the album-art backdrop, shade and fill belong to Now Playing only (all four looks)
const SCOPE = ['now', 'now-bd-full', 'now-bd-light', 'lib-playlists-tiles', 'lib-keyboard-123', 'queue', 'track-popup', 'speakers-picker', 'detail-playlist'];
for (const theme of ['light', 'dark', 'glass', 'wallpaper']) for (const name of SCOPE) {
  let p;
  try {
    p = await newPage(theme, name);
    const r = await ev(p, `(() => { const np = ${C}.querySelector('main.np'); const cs = (el, pe) => getComputedStyle(el, pe);
      return { onNow: np.classList.contains('on-now'), before: cs(np, '::before').content, after: cs(np, '::after').content, bgimg: cs(np).backgroundImage,
        bdl: [...${C}.querySelectorAll('.bdl')].map((e) => cs(e).display),
        views: [...${C}.querySelectorAll('.view')].filter((v) => v.dataset.view !== 'now').map((v) => cs(v).backgroundColor + '|' + cs(v).backgroundImage) }; })()`);
    const isNow = NOW(name);
    if (isNow && /^now-bd-/.test(name)) check(`T2 ${theme}/${name}: the chosen art mode draws its backdrop on Now Playing`, r.onNow && (r.before === '""' || r.bdl.some((d) => d !== 'none')), JSON.stringify({ b: r.before }));
    else if (isNow) check(`T2 ${theme}/${name}: plain (the default) draws no art, shade or fill on Now Playing`, r.onNow && (r.before === 'none' || r.before === 'normal') && (r.after === 'none' || r.after === 'normal') && r.bdl.every((d) => d === 'none') && r.bgimg === 'none', JSON.stringify(r).slice(0, 200));
    else {
      check(`T2 ${theme}/${name}: no album art, shade or fill behind this screen`, !r.onNow && (r.before === 'none' || r.before === 'normal') && (r.after === 'none' || r.after === 'normal') && r.bdl.every((d) => d === 'none') && r.bgimg === 'none', JSON.stringify(r).slice(0, 200));
      check(`T2 ${theme}/${name}: the screens paint no card colour of their own on top`, r.views.every((v) => v === 'rgba(0, 0, 0, 0)|none'), r.views.join(' ; ').slice(0, 160));
    }
    check(`T2 ${theme}/${name}: no page errors`, p._errs.length === 0, p._errs[0] ?? '');
  } catch (e) { check(`T2 ${theme}/${name}: scene opens`, false, String(e.message).slice(0, 140)); }
  try { await p?.close(); } catch {}
}

// 3. the exact roles, in the sentinel theme
{
  const rgbOf = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
  const same = (s, t) => { const v = rgbOf(s); return t.every((x, i) => Math.abs((v[i] ?? 0) - x) <= 1); };
  let p = await newPage('sentinel', 'lib-keyboard-123');
  const kb = await ev(p, `(() => { const k = ${SV}.querySelector('jb-keyboard').shadowRoot; const kb = k.querySelector('.kb'); const key = [...k.querySelectorAll('.k')].find((e) => e.getBoundingClientRect().width > 0);
    const a = getComputedStyle(kb), b = getComputedStyle(key); return { bg: a.backgroundColor, filter: a.backdropFilter, keybg: b.backgroundColor, keyborder: b.borderTopColor }; })()`);
  check('T3 keyboard panel is the HA input fill (no dialog dimmer)', same(kb.bg, [120, 130, 140]) && (kb.filter === 'none' || !kb.filter), JSON.stringify(kb));
  check('T3 keyboard keys: one chip look (transparent fill, HA outline)', rgbOf(kb.keybg)[3] === 0 || kb.keybg === 'rgba(0, 0, 0, 0)', JSON.stringify(kb));
  check('T3 keyboard keys: HA outline border', same(kb.keyborder, [201, 11, 21]), kb.keyborder);
  const sb = await ev(p, `(() => { const q = ${SV}.querySelector('.qbar'); const s = getComputedStyle(q); return { bg: s.backgroundColor, shadow: s.boxShadow, filter: s.backdropFilter }; })()`);
  check('T3 search box is the HA input fill, no shadow, no blur', same(sb.bg, [120, 130, 140]) && sb.shadow === 'none' && (sb.filter === 'none' || !sb.filter), JSON.stringify(sb));
  await p.close();
  p = await newPage('sentinel', 'queue');
  const q = await ev(p, `(() => { const e = ${QV}.querySelector('.qr.now .rt small'); if (!e) return null; const s = getComputedStyle(e); return { color: s.color, bg: getComputedStyle(${QV}.querySelector('.qr.now')).backgroundColor }; })()`);
  check('T3 Queue now-row: artist line is a tint of the on-primary text colour', q && same(q.color, [111, 122, 133]), JSON.stringify(q));
  await p.close();
  p = await newPage('sentinel', 'now');
  const n = await ev(p, `(() => { const pan = ${C}.querySelector('jb-now')?.shadowRoot?.querySelector('.panel'); const ab = ${C}.querySelector('jb-now')?.shadowRoot?.querySelector('.ab'); const f = (e) => { if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor + '|' + s.backgroundImage.slice(0, 120), shadow: s.boxShadow, filter: s.backdropFilter }; }; return { panel: f(pan), ab: f(ab) }; })()`);
  check('T3 Now Playing: speakers panel is an opaque theme surface (no blur, no dark fill)', !n.panel || (n.panel.shadow === 'none' || /8, 9, 10/.test(n.panel.shadow)) && (n.panel.filter === 'none' || !n.panel.filter), JSON.stringify(n.panel));
  check('T3 Now Playing: cover buttons have no shadow and no blur', !n.ab || (n.ab.shadow === 'none' && (n.ab.filter === 'none' || !n.ab.filter)), JSON.stringify(n.ab));
  await p.close();
  p = await newPage('light', 'track-popup');
  const bk = await ev(p, `(() => { const e = ${HS}.querySelector('.bk'); if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, filter: s.backdropFilter }; })()`);
  check('T3 dialog dimmer is HA\'s dialog scrim (no colour, brightness filter) and nothing else', bk && bk.bg === 'rgba(0, 0, 0, 0)' && /brightness/.test(bk.filter), JSON.stringify(bk));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} theme checks passed`);
process.exit(failures ? 1 : 0);

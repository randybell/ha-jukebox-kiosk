// 0.8.1 theme compliance. Real Home Assistant default light and dark themes, a translucent "glass" theme, a dashboard with a
// wallpaper, and a "sentinel" theme where every colour variable is a unique value, so a painted colour that is not one of them
// is a fixed colour. Usage: node test/themes.e2e.mjs
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
import { launch, openPage, SENT, sleep } from './themes-lib.mjs';
import { SCENES, probe, ev, C } from './themes-scenes.mjs';
import { nowFill } from './contrast-lib.mjs';
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

// 4. every backdrop mode really paints what it promises, and the text on it is readable, in all four looks (0.8.1 fix: "Dark" drew nothing)
{
  const primaryOf = (p) => ev(p, `(() => { const i = document.createElement('i'); i.style.color = 'var(--primary-color)'; document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; })()`);
  for (const theme of ['light', 'dark', 'glass', 'wallpaper']) {
    // [scene, label, min title contrast, min subtitle contrast, expected fill]
    for (const [name, label, minT, minS, fill] of [['now-bd-static', 'static (Dark)', 4.5, 3, 'primary'], ['now-bd-off', 'off', 3, 2.5, 'grey'], ['now-bd-full-noart', 'full with no art', 4.5, 3, 'primary'], ['now-bd-light-noart', 'light with no art', 4.5, 3, 'primary']]) {
      let p;
      try {
        p = await newPage(theme, name);
        const f = await nowFill(p, ev, C); const pr = await primaryOf(p);
        const want = (pr.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const painted = fill === 'primary' ? f.px.every((v, i) => Math.abs(v - want[i]) <= 2) : Math.max(...f.px) - Math.min(...f.px) <= 2;
        check(`T4 ${theme}/${label}: the flat fill really renders (painted pixel ${f.px}, ${fill})`, f.content === '""' && f.position === 'absolute' && painted, JSON.stringify({ content: f.content, position: f.position, px: f.px, primary: pr }));
        check(`T4 ${theme}/${label}: text is readable on it (title ${f.cTitle.toFixed(1)}:1, subtitle ${f.cSub.toFixed(1)}:1)`, f.cTitle >= minT && f.cSub >= minS, JSON.stringify({ title: f.title, sub: f.sub }));
      } catch (e) { check(`T4 ${theme}/${label}: scene opens`, false, String(e.message).slice(0, 140)); }
      try { await p?.close(); } catch {}
    }
  }
  // the three art modes still draw their art backdrop (::before of the Now Playing area has content)
  for (const name of ['now-bd-full', 'now-bd-light']) {
    const p = await newPage('light', name);
    const c = await ev(p, `getComputedStyle(${C}.querySelector('main.np'), '::before').content`);
    check(`T4 light/${name}: the art backdrop is drawn (::before has content)`, c === '""', c);
    await p.close();
  }
}

// 5. pop-up dimmer: HA's dialog scrim (colour none, backdrop filter), with HA's own default dimmer where the variable is not defined
{
  const dim = (p, sel) => ev(p, `(() => { const e = ${sel}; if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, filter: s.backdropFilter }; })()`);
  const SPK = `${C}.querySelector('jb-speakers')?.shadowRoot?.querySelector('.sp-scrim')`;
  for (const [theme, expectFilter, why] of [['light', /brightness\(0?\.68\)/, 'HA default theme defines brightness(68%)'], ['noscrim', /brightness\(0?\.68\)/, 'variable not defined: HA default dimmer'], ['scrimnone', /^(none)?$/, 'variable set to none: the theme wins']]) {
    let p = await newPage(theme, 'track-popup');
    const d = await dim(p, `${HS}.querySelector('.bk')`);
    check(`T5 ${theme}/pop-up dimmer (${why})`, d && d.bg === 'rgba(0, 0, 0, 0)' && expectFilter.test(d.filter === 'none' ? '' : d.filter), JSON.stringify(d));
    await p.close();
    p = await newPage(theme, 'speakers-picker');
    const s2 = await dim(p, SPK);
    check(`T5 ${theme}/speakers panel dimmer (${why})`, s2 && s2.bg === 'rgba(0, 0, 0, 0)' && expectFilter.test(s2.filter === 'none' ? '' : s2.filter), JSON.stringify(s2));
    await p.close();
  }
  // a theme that sets the legacy colour keeps it
  const p = await newPage('sentinel', 'track-popup');
  const d = await dim(p, `${HS}.querySelector('.bk')`);
  check('T5 sentinel/pop-up dimmer: --mdc-dialog-scrim-color is used as the colour when a theme sets it', d && /rgb\(5, 6, 7\)/.test(d.bg), JSON.stringify(d));
  await p.close();
}

// 6. the selected tab is HA's sidebar pattern: --sidebar-selected-icon-color text, the same colour at --dark-divider-opacity behind it
{
  const p = await newPage('sentinel', 'queue');
  const t = await ev(p, `(() => { const e = ${C}.querySelector('.tab.active'); const s = getComputedStyle(e); return { bg: s.backgroundColor, color: s.color }; })()`);
  const bgv = (t.bg.match(/[\d.]+/g) ?? []).map(Number).map((v, i) => (/^color\(srgb/.test(t.bg) && i < 3 ? Math.round(v * 255) : v));
  check('T6 selected tab: text is --sidebar-selected-icon-color', /77, 88, 99/.test(t.color), t.color);
  check('T6 selected tab: background is --sidebar-selected-icon-color at --dark-divider-opacity (0.12)', bgv[0] === 77 && bgv[1] === 88 && bgv[2] === 99 && Math.abs((bgv[3] ?? 1) - 0.12) < 0.01, t.bg);
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} theme checks passed`);
process.exit(failures ? 1 : 0);

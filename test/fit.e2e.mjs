// v0.4.2 fit-to-panel checks: the card fills the space really left below it (HA toolbar, sidebar, kiosk, full screen,
// a regular masonry card), the header and tab bar are always fully visible and the page never scrolls.
// The HA frontend is emulated by dev/index.html?ha=toolbar|kiosk|masonry&sidebar=open|narrow|closed|none
// (fixed app toolbar of HA's --header-height: 56px, sidebar drawer 256/56 px, window-scrolling view).
// The tab bar is the 0.7.2 default (library_layout: combined): Now Playing, Library (the old Browse and Search
// tabs in one: search box, source buttons, category buttons; the keyboard opens when the search box is tapped), Queue, Lyrics.
// Usage: (starts its own dev server on a free port; JB_PORT=n for a fixed one, JB_ROOT to use yours) node test/fit.e2e.mjs   Screenshots: test/shots/v042/ (git-ignored)
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hermetic } from './intercept.mjs';
import { devRoot } from './serve.mjs';

const ROOT = await devRoot();
const OUT = new URL('./shots/v042/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, ok, info = '') { results.push({ name, ok, info }); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info && !ok ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const pageErrors = [];

const SIZES = [[1024, 666], [1280, 720], [1366, 768], [1440, 900], [1280, 800], [1920, 1080], [390, 844, 1], [844, 390, 1], [820, 1180, 1], [1180, 820, 1], [1024, 600, 1]];
const KEY = new Set(['1024x666', '1280x720', '1366x768', '1920x1080', '1024x600', '390x844', '844x390', '820x1180']);
const TABS = ['now', 'browse', 'queue']; // 'browse' is the combined Library tab; there is no separate search tab and no Lyrics tab (0.7.9 #58)
const LIB = 'browse';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** geometry of everything that must be fully visible, plus page-scroll state */
const geom = (pg) => pg.evaluate(() => {
  const sr = __card.shadowRoot, vw = innerWidth, vh = innerHeight;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height, w: b.width }; };
  const tb = document.getElementById('ha-toolbar');
  const tbB = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().bottom : 0;
  const tabs = [...sr.querySelectorAll('.tab')].map((t) => {
    const b = r(t); const hit = sr.elementFromPoint(b.l + b.w / 2, b.t + b.h / 2);
    return { ...b, id: t.dataset.tab, hit: hit?.closest?.('.tab') === t };
  });
  const before = scrollY; scrollTo(0, 1e5); const could = scrollY; scrollTo(0, before);
  const kb = sr.querySelector('jb-search')?.shadowRoot.querySelector('jb-keyboard');
  const sv = sr.querySelector('jb-search')?.shadowRoot;
  const vis = (el) => { const b = r(el); return b && b.h > 0 && b.w > 0 ? b : null; };
  const lib = sv ? { combined: sr.querySelector('jb-search').hasAttribute('combined') || !!sr.querySelector('jb-search').combined, q: vis(sv.querySelector('.qbar')),
    srcs: [...sv.querySelectorAll('.srcs .src')].map(vis) } : null;
  const nw = sr.querySelector('jb-now')?.shadowRoot.querySelector('.nw');
  const pp = sr.querySelector('jb-now')?.shadowRoot.querySelector('.tb.pp');
  const npR = sr.querySelector('jb-now')?.shadowRoot, slp = npR?.querySelector('.ab.slp'), artEl = npR?.querySelector('.art');
  const moon = slp ? { ...r(slp), inArt: !!slp.closest('.art'), art: r(artEl), inRow: !!npR.querySelector('.tp .tb.sl') } : null;
  const tpb = [...(sr.querySelector('jb-now')?.shadowRoot.querySelectorAll('.tp .tb') ?? [])].map((e) => ({ k: e.className.split(' ')[1], ...r(e), iw: e.querySelector('.i')?.getBoundingClientRect().width ?? 0, gh: (() => { const sv = e.querySelector('svg'), pa = sv?.querySelector('path'); return pa ? pa.getBBox().height * sv.getBoundingClientRect().width / (sv.viewBox.baseVal?.width || 24) : 0; })() }));
  return { vw, vh, tbB, nav: r(sr.querySelector('.tabs')), top: r(sr.querySelector('.top')), tabs, could, docH: document.documentElement.scrollHeight,
    kb: kb && kb.getBoundingClientRect().height ? r(kb) : null, nw: nw ? { sh: nw.scrollHeight, ch: nw.clientHeight } : null, pp: r(pp), tpb, moon,
    lib, fit: __card.dataset.fitH, size: __card.dataset.fit ?? '' };
});
const within = (b, g, top = 0) => b && b.t >= top - 0.5 && b.b <= g.vh + 0.5 && b.l >= -0.5 && b.r <= g.vw + 0.5 && b.h > 0;
function verify(label, g, { fill = true, tab } = {}) {
  const tabsOk = g.tabs.length === TABS.length && g.tabs.every((t, i) => t.id === TABS[i]) && g.tabs.every((t) => within(t, g) && t.hit);
  check(`${label}: tab bar fully visible (bottom ${Math.round(g.nav.b)} ≤ ${g.vh}), every tab hit-testable`, within(g.nav, g) && tabsOk,
    JSON.stringify({ nav: g.nav, bad: g.tabs.filter((t) => !within(t, g) || !t.hit).map((t) => t.id) }));
  check(`${label}: header fully visible below the HA toolbar`, within(g.top, g, g.tbB), JSON.stringify({ top: g.top, tbB: g.tbB }));
  check(`${label}: no page scroll`, g.could === 0 && g.docH <= g.vh, `could=${g.could} docH=${g.docH} vh=${g.vh}`);
  if (fill) check(`${label}: card fills to the bottom (no gap)`, g.nav.b >= g.vh - 1.5, `nav.b=${g.nav.b} vh=${g.vh}`);
  if (tab === LIB) {
    check(`${label}: Library search box fully visible between the header and the tabs`, !!g.lib?.combined && within(g.lib.q, g, g.top.b) && g.lib.q.b <= g.nav.t + 0.5, JSON.stringify(g.lib?.q));
    check(`${label}: on-screen keyboard open and fully visible above the tabs`, !!g.kb && within(g.kb, g, g.top.b) && g.kb.b <= g.nav.t + 0.5, JSON.stringify(g.kb));
    // source buttons: between the header and the tabs, clear of the keyboard (below it in portrait, beside it in landscape);
    // on narrow screens the row scrolls sideways, so only the first one has to be on screen
    const clear = (b) => b && b.t >= g.top.b - 0.5 && b.b <= g.nav.t + 0.5 && !!g.kb && (b.b <= g.kb.t + 0.5 || b.t >= g.kb.b - 0.5 || b.r <= g.kb.l + 0.5 || b.l >= g.kb.r - 0.5);
    if (g.lib?.srcs.length) check(`${label}: ${g.lib.srcs.length} source buttons visible, clear of the keyboard`, g.lib.srcs.every(clear) && within(g.lib.srcs[0], g, g.top.b), JSON.stringify({ srcs: g.lib.srcs, kb: g.kb }));
  }
  if (tab === 'now') check(`${label}: Now Playing transport reachable (visible, or the middle scrolls)`, (g.pp && g.pp.t >= g.top.b && g.pp.b <= g.nav.t) || (g.nw && g.nw.sh > g.nw.ch), JSON.stringify({ pp: g.pp, nw: g.nw }));
  if (tab === 'now' && g.tpb?.length) {
    const k = Object.fromEntries(g.tpb.map((x) => [x.k, x])), ok = k.pr && k.nx && k.pp && k.sh;
    const minTap = Math.min(g.vw, g.vh) >= 520 ? 56 : 40;
    check(`${label}: #43 Next/Previous bigger than Shuffle/Repeat, smaller than Play/Pause (tap ≥ ${minTap}px), visible arrows 85–100% of the Play/Pause glyph`,
      ok && [k.pr, k.nx].every((x) => x.w > k.sh.w && x.w < k.pp.w && x.w >= minTap && x.gh <= k.pp.gh + 0.5 && x.gh >= 0.85 * k.pp.gh), JSON.stringify(g.tpb.map((x) => `${x.k}:${Math.round(x.w)}/g${x.gh.toFixed(1)}`)));
    const m = g.moon, pp = k.pp;
    check(`${label}: #42 sleep moon in the artwork top-right corner, ≥ 48px, not in the transport row, clear of Play/Pause`,
      !!m && m.inArt && !m.inRow && m.w >= 47.5 && m.t - m.art.t < 30 && m.art.r - m.r < 30 && (m.r <= pp.l || m.l >= pp.r || m.b <= pp.t || m.t >= pp.b), JSON.stringify(m));
    check(`${label}: transport buttons don't overlap each other`, g.tpb.every((x, i) => i === 0 || x.l >= g.tpb[i - 1].r - 0.5), JSON.stringify(g.tpb.map((x) => [x.k, Math.round(x.l), Math.round(x.r)])));
  }
}
async function newPage(vp, ua) {
  const pg = await browser.newPage();
  await hermetic(pg);
  if (ua) await pg.setUserAgent(ua);
  pg.on('pageerror', (e) => pageErrors.push(e.message));
  await pg.setViewport({ deviceScaleFactor: 1, ...vp });
  return pg;
}
async function open(pg, q) {
  await pg.goto(`${ROOT}index.html?fresh=1&latency=40&tab=now&overlay=1${q}`);
  await pg.waitForFunction('window.__ready === true');
  await sleep(350);
}
async function tapTab(pg, id, touch, kb = true) {
  const b = await pg.evaluate((id) => { const t = __card.shadowRoot.querySelector(`.tab[data-tab="${id}"]`).getBoundingClientRect(); return { x: t.left + t.width / 2, y: t.top + t.height / 2 }; }, id);
  if (touch) await pg.touchscreen.tap(b.x, b.y); else await pg.mouse.click(b.x, b.y);
  await sleep(id === LIB ? 350 : 250);
  const sel = await pg.evaluate(() => __card.shadowRoot.querySelector('.tab.active')?.dataset.tab);
  if (sel !== id) throw new Error(`tab ${id} did not open (active=${sel})`);
  if (id === LIB && kb) await openKb(pg, touch);
}
/** combined Library with the keyboard still hidden: every category button fully visible between the header and the tabs */
const libCats = (pg) => pg.evaluate(() => { const sr = __card.shadowRoot, sv = sr.querySelector('jb-search').shadowRoot;
  const top = sr.querySelector('.top').getBoundingClientRect().bottom, nav = sr.querySelector('.tabs').getBoundingClientRect().top;
  // the row scrolls sideways when the buttons do not fit (phones on their side): then a button only has to be inside it vertically
  const row = sv.querySelector('.lcats'), rr = row?.getBoundingClientRect(), scrolls = !!row && row.scrollWidth > row.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(row).overflowX);
  return [...sv.querySelectorAll('.lcats .lc')].map((b, i) => { const r = b.getBoundingClientRect(); return { id: b.dataset.lcat, ok: r.width > 0 && r.height > 0 && r.top >= top - 0.5 && r.bottom <= nav + 0.5
    && (i === 0 || !scrolls ? r.left >= -0.5 && r.right <= innerWidth + 0.5 : r.top >= rr.top - 0.5 && r.bottom <= rr.bottom + 0.5), ...(scrolls ? { scrolls } : {}) }; }); });
/** combined Library: the keyboard starts hidden; tapping the search box opens it */
async function openKb(pg, touch) {
  const b = await pg.evaluate(() => { const q = __card.shadowRoot.querySelector('jb-search').shadowRoot.querySelector('.qbar'); if (!q) return null; const r = q.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (!b) throw new Error('Library search box not found');
  if (touch) await pg.touchscreen.tap(b.x, b.y); else await pg.mouse.click(b.x, b.y);
  await sleep(300);
}
// HA: sidebar is a modal drawer (hidden) below 870 px wide, the narrow icon rail otherwise
const sidebarFor = (w) => (w < 870 ? 'none' : 'narrow');

// ---------- 1. every size × {HA toolbar, kiosk (toolbar hidden), full screen / Fully Kiosk (no HA chrome)} × every tab ----------
for (const [w, h, touch] of SIZES) {
  const vp = { width: w, height: h, ...(touch ? { isMobile: true, hasTouch: true } : {}) };
  for (const [mode, q] of [['toolbar', `&ha=toolbar&sidebar=${sidebarFor(w)}`], ['kiosk', `&ha=kiosk&sidebar=${sidebarFor(w)}`], ['fullscreen', '']]) {
    if (mode === 'fullscreen' && !touch && w !== 1920) continue; // the plain harness is already covered by the other suites
    const pg = await newPage(vp);
    await open(pg, q);
    for (const tab of TABS) {
      if (tab === LIB) {
        await tapTab(pg, tab, touch, false);
        const cats = await libCats(pg);
        check(`F1 ${w}x${h} ${mode} Library: ${cats.length} category buttons fully visible before the keyboard opens`, cats.length >= 4 && cats.every((c) => c.ok), JSON.stringify(cats));
        await openKb(pg, touch);
      } else await tapTab(pg, tab, touch);
      const g = await geom(pg);
      verify(`F1 ${w}x${h} ${mode} ${tab}`, g, { tab });
      if (mode === 'toolbar' && (tab === 'now' || (KEY.has(`${w}x${h}`) && (w === 1024 && h === 666 || tab === LIB))))
        await pg.screenshot({ path: `${OUT}${tab}-${w}x${h}-toolbar.png` });
    }
    await pg.close();
  }
}

// ---------- 2. sidebar open / closed and a regular masonry card ----------
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 666]]) {
  for (const sb of ['open', 'closed']) {
    const pg = await newPage({ width: w, height: h });
    await open(pg, `&ha=toolbar&sidebar=${sb}`);
    for (const tab of ['now', LIB]) { await tapTab(pg, tab); verify(`F2 ${w}x${h} toolbar sidebar=${sb} ${tab}`, await geom(pg), { tab }); }
    await pg.close();
  }
}
{
  const pg = await newPage({ width: 1280, height: 800 });
  await open(pg, '&ha=masonry&sidebar=narrow');
  for (const tab of ['now', 'queue']) {
    const g = await geom(pg);
    await tapTab(pg, tab); verify(`F2 1280x800 masonry card below another card ${tab}`, await geom(pg), { tab, fill: false });
    check(`F2 1280x800 masonry ${tab}: card fills down to the view's own bottom padding`, g.nav.b >= g.vh - 12 && g.nav.b <= g.vh, `nav.b=${g.nav.b}`);
  }
  await pg.screenshot({ path: `${OUT}masonry-1280x800.png` });
  await pg.close();
}

// ---------- 3. resize while open: window resize, toolbar hidden/shown, sidebar toggled, rotation ----------
{
  const pg = await newPage({ width: 1920, height: 1080 });
  await open(pg, '&ha=toolbar&sidebar=narrow');
  verify('F3 resize: start 1920x1080 toolbar', await geom(pg), { tab: 'now' });
  for (const [w, h] of [[1024, 666], [1366, 768], [1024, 600], [1440, 900]]) {
    await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await sleep(300);
    verify(`F3 resize → ${w}x${h}`, await geom(pg), { tab: 'now' });
  }
  await pg.setViewport({ width: 1024, height: 666, deviceScaleFactor: 1 }); await sleep(300);
  await tapTab(pg, LIB);
  await pg.evaluate(() => __haToolbar(false)); await sleep(400);
  verify('F3 toolbar hidden while open (kiosk-mode toggled) 1024x666 Library', await geom(pg), { tab: LIB });
  await pg.evaluate(() => __haToolbar(true)); await sleep(400);
  verify('F3 toolbar shown again 1024x666 Library', await geom(pg), { tab: LIB });
  await pg.evaluate(() => __haSidebar('256px')); await sleep(400);
  verify('F3 sidebar opened while open 1024x666', await geom(pg), { tab: LIB });
  await pg.close();
  const ph = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await open(ph, '&ha=toolbar&sidebar=none');
  await tapTab(ph, 'queue', true);
  await ph.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); await sleep(400);
  verify('F3 rotate 390x844 → 844x390 (queue)', await geom(ph), { tab: 'queue' });
  await ph.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); await sleep(400);
  verify('F3 rotate back → 390x844 (queue)', await geom(ph), { tab: 'queue' });
  await ph.close();
}

// ---------- 4. emulated Mac Chrome: 1024x666 window, Retina (DPR 2), browser zoom 100 / 80 / 67 % ----------
// Browser zoom = a larger CSS viewport at a lower device pixel ratio (what Chrome does for Cmd −); the card must still fit.
for (const z of [1, 0.8, 0.67]) {
  const vp = { width: Math.round(1024 / z), height: Math.round(666 / z), deviceScaleFactor: 2 * z };
  const pg = await newPage(vp, MAC_UA);
  await open(pg, '&ha=toolbar&sidebar=narrow');
  for (const tab of TABS) { await tapTab(pg, tab); verify(`F4 Mac Chrome (emulated) 1024x666 @2x zoom ${Math.round(z * 100)}% ${tab}`, await geom(pg), { tab }); }
  await tapTab(pg, 'now');
  await pg.screenshot({ path: `${OUT}mac-zoom${Math.round(z * 100)}-1024x666-toolbar.png` });
  await pg.close();
}

// ---------- 5. compact layout on short panels; untouched at 1920x1080 ----------
{
  const sizes = {};
  for (const [w, h, q] of [[1024, 600, '&ha=toolbar&sidebar=narrow'], [1024, 666, '&ha=toolbar&sidebar=narrow'], [1920, 1080, ''], [1280, 800, '']]) {
    const pg = await newPage({ width: w, height: h });
    await open(pg, q);
    sizes[`${w}x${h}${q ? '-tb' : ''}`] = await pg.evaluate(() => ({ fit: __card.dataset.fit ?? '', fitH: Number(__card.dataset.fitH), tab: __card.shadowRoot.querySelector('.tab').getBoundingClientRect().height, z: __card.dataset.scale }));
    await pg.close();
  }
  check('F5 short panels compact (data-fit tiny < 560, short < 700), tall ones untouched', sizes['1024x600-tb'].fit === 'tiny' && sizes['1024x666-tb'].fit === 'short' && sizes['1920x1080'].fit === '' && sizes['1280x800'].fit === '', JSON.stringify(sizes));
  check('F5 1920x1080 full screen keeps the large-screen scale and full height', sizes['1920x1080'].fitH === 1080 && Number(sizes['1920x1080'].z) > 1, JSON.stringify(sizes['1920x1080']));
}

// ---------- 6. 0.5.0 inside the fitted height: Speakers panel, large buttons, queue ⋯ sheet, Undo bar, Play-now confirm ----------
// The panel and every queue overlay must stay between the header and the tab bar; the tab bar stays fully visible and
// tappable (a tab tap closes the panel); the page never scrolls; overlays taller than the room scroll inside it.
const SR6 = `__card.shadowRoot.querySelector('jb-speakers').shadowRoot`, QV6 = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const ev6 = (pg, e) => pg.evaluate((e) => eval(e), e);
async function tap6(pg, expr, touch, block = 'nearest') {
  const b = await ev6(pg, `(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  if (!b || !b.w) throw new Error('nothing to tap: ' + expr);
  const settled = await ev6(pg, `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: '${block}' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  if (!settled || !settled.w) throw new Error('nothing to tap after scroll: ' + expr);
  Object.assign(b, settled);
  await sleep(200);
  if (touch) await pg.touchscreen.tap(b.x, b.y); else await pg.mouse.click(b.x, b.y);
  await sleep(300);
}
/** el's box against the middle (between header and tab bar); scroller = the element that scrolls when el is taller than the room */
const inMiddle = (pg, expr, scroller) => ev6(pg, `(() => { const el = ${expr}; if (!el) return null; const sr = __card.shadowRoot; const m = sr.querySelector('main.np').getBoundingClientRect();
  const b = el.getBoundingClientRect(); const sc = ${scroller ? scroller : 'null'};
  return { t: Math.round(b.top), b: Math.round(b.bottom), mt: Math.round(m.top), mb: Math.round(m.bottom), h: Math.round(b.height),
    inside: b.top >= m.top - 0.5 && b.bottom <= m.bottom + 0.5 && b.height > 0, sh: sc ? sc.scrollHeight : 0, ch: sc ? sc.clientHeight : 0, ov: sc ? getComputedStyle(sc).overflowY : '' }; })()`);
const fits6 = (r) => !!r && r.inside && (r.sh <= r.ch + 2 || /auto|scroll/.test(r.ov));
// Phone 390x844: large_buttons with the heart OFF (kiosk without library write) and ON (library write); the sleep chooser stays on one row (also without large_buttons)
for (const [lg, heart] of [[true, false], [true, true], [false, false]]) {
  const tag = `F7 390x844${lg ? ' large_buttons' : ''} heart ${heart ? 'on' : 'off'}`;
  const pg = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await open(pg, `&tab=now${heart ? '&kcaps=' + encodeURIComponent(JSON.stringify({ library_write: true })) : ''}${lg ? '&cfg=' + encodeURIComponent(JSON.stringify({ large_buttons: true })) : ''}`);
  await tapTab(pg, 'now', true);
  const NPf = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
  const row = await ev6(pg, `(() => { const R = ${NPf}; const tp = R.querySelector('.tp').getBoundingClientRect(); const bs = [...R.querySelectorAll('.tp .tb')].map((e) => { const b = e.getBoundingClientRect(); return { k: e.className.split(' ')[1], l: b.left, r: b.right, w: b.width }; });
    return { heart: !!R.querySelector('.tp .tb.fv'), tpL: tp.left, tpR: tp.right, vw: innerWidth, bs }; })()`);
  check(`${tag}: heart is ${heart ? 'shown' : 'hidden'}`, row.heart === heart);
  check(`${tag}: transport row fits, nothing clipped or overlapping, taps ≥ 44px`, row.bs.every((x, i) => x.l >= -0.5 && x.r <= row.vw + 0.5 && x.l >= row.tpL - 0.5 && x.r <= row.tpR + 0.5 && x.w >= (lg ? 43.5 : 39.5) && (i === 0 || x.l >= row.bs[i - 1].r - 0.5)),
    JSON.stringify(row));
  verify(`${tag} now`, await geom(pg), { tab: 'now' });
  await tap6(pg, `${NPf}.querySelector('.ab.slp')`, true);
  const ch = await ev6(pg, `(() => { const sp = [...${NPf}.querySelectorAll('.sleep-strip .sp')].map((e) => e.getBoundingClientRect()); const pp = ${NPf}.querySelector('.tb.pp').getBoundingClientRect();
    return { n: sp.length, tops: [...new Set(sp.map((b) => Math.round(b.top)))], minH: Math.min(...sp.map((b) => b.height)), clearPlay: sp.every((b) => b.bottom <= pp.top || b.top >= pp.bottom || b.right <= pp.left || b.left >= pp.right), inView: sp.every((b) => b.left >= 0 && b.right <= innerWidth) }; })()`);
  check(`${tag}: sleep chooser Off/15/30/60 on one row, ≥ 40px tall, clear of Play/Pause`, ch.n === 4 && ch.tops.length === 1 && ch.minH >= 39.5 && ch.clearPlay && ch.inView, JSON.stringify(ch));
  await pg.close();
}
const S6 = [[1024, 666, 0, 'short'], [1024, 600, 0, 'tiny'], [1280, 720, 0, 'short'], [1280, 800, 0, ''], [844, 390, 1, 'tiny'], [390, 844, 1, ''], [390, 600, 1, 'tiny']];
for (const [w, h, touch, size] of S6) {
  for (const lg of [false, true]) {
    const tag = `F6 ${w}x${h} toolbar${lg ? ' large_buttons' : ''}`;
    const vp = { width: w, height: h, ...(touch ? { isMobile: true, hasTouch: true } : {}) };
    const pg = await newPage(vp);
    await open(pg, `&ha=toolbar&sidebar=${sidebarFor(w)}&admin=1&spk=dyn${lg ? '&cfg=' + encodeURIComponent(JSON.stringify({ large_buttons: true })) : ''}`);
    const fit = await ev6(pg, `__card.dataset.fit ?? ''`);
    if (!lg) check(`${tag}: data-fit is "${size}"`, fit === size, fit);
    if (lg) for (const tab of TABS) { await tapTab(pg, tab, touch); verify(`${tag} ${tab}`, await geom(pg), { tab }); }
    if (lg) check(`${tag}: large-button mode is on`, await ev6(pg, `!!__card.shadowRoot.querySelector('.app.lg')`));
    await tapTab(pg, 'now', touch);
    // Speakers panel
    await tap6(pg, `__card.shadowRoot.querySelector('.pill')`, touch);
    await pg.waitForFunction(`!!${SR6}.querySelector('section.sheet') && __card.shadowRoot.querySelector('jb-speakers').open`, { timeout: 4000 }).catch(() => {});
    await sleep(500);
    const sp = await inMiddle(pg, `${SR6}.querySelector('section.sheet')`, `${SR6}.querySelector('.body')`);
    check(`${tag} Speakers panel: between the header and the tab bar, body scrolls if needed`, fits6(sp), JSON.stringify(sp));
    verify(`${tag} Speakers panel open`, await geom(pg), {});
    const x = await inMiddle(pg, `${SR6}.querySelector('.x')`);
    check(`${tag} Speakers panel: close button fully visible`, x && x.inside, JSON.stringify(x));
    if (w === 1024 && h === 666) await pg.screenshot({ path: `${OUT}speakers-${w}x${h}-toolbar${lg ? '-large' : ''}.png` });
    await tapTab(pg, 'queue', touch);
    check(`${tag}: a tab tap closes the Speakers panel`, await ev6(pg, `!__card.shadowRoot.querySelector('jb-speakers').open`));
    // queue overlays
    await pg.waitForFunction(`${QV6}.querySelectorAll('.qr.next .ra-b[data-action="remove"]').length > 2`, { timeout: 4000 }).catch(() => {});
    const narrow = await ev6(pg, `(() => { const b = ${QV6}.querySelector('.qr.next .qa.mo'); return !!b && b.getBoundingClientRect().width > 0; })()`);
    if (narrow) {
      await tap6(pg, `${QV6}.querySelectorAll('.qr.next .qa.mo')[1]`, touch);
      const ms = await inMiddle(pg, `${QV6}.querySelector('.menu')`, `${QV6}.querySelector('.menu')`);
      check(`${tag} queue ⋯ sheet inside the middle (scrolls if taller)`, fits6(ms), JSON.stringify(ms));
      await ev6(pg, `(() => { const m = ${QV6}.querySelector('.menu'); m.scrollTop = 1e4; })()`);
      const cancel = await inMiddle(pg, `${QV6}.querySelector('.menu .mi.cancel')`);
      check(`${tag} queue ⋯ sheet: Cancel reachable`, cancel && cancel.inside, JSON.stringify(cancel));
      verify(`${tag} queue ⋯ sheet open`, await geom(pg), {});
      if (w === 390) await pg.screenshot({ path: `${OUT}queue-sheet-${w}x${h}-toolbar${lg ? '-large' : ''}.png` });
      await tap6(pg, `${QV6}.querySelector('.menu .mi.cancel')`, touch);
    }
    await ev6(pg, `${QV6}.querySelector('.scroll').scrollTop = 0`); await sleep(150);
    await tap6(pg, `[...${QV6}.querySelectorAll('.qr.next .ra-b[data-action="playnow"]')].find((b) => !b.disabled)`, touch);
    await pg.waitForFunction(`!!${QV6}.querySelector('.confirm')`, { timeout: 4000 });
    const cf = await inMiddle(pg, `${QV6}.querySelector('.confirm')`, `${QV6}.querySelector('.confirm')`);
    check(`${tag} Play-now confirm inside the middle`, fits6(cf), JSON.stringify(cf));
    const ok = await inMiddle(pg, `${QV6}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
    check(`${tag} Play-now confirm: Play now button visible`, ok && ok.inside, JSON.stringify(ok));
    verify(`${tag} Play-now confirm open`, await geom(pg), {});
    await tap6(pg, `${QV6}.querySelector('.confirm .cbtn[data-action="cancel"]')`, touch);
    await tap6(pg, `${QV6}.querySelector('[data-action="queue-search"]')`, touch);
    for (const c of 'PORC') await tap6(pg, `[...${QV6}.querySelector('.qkbd').shadowRoot.querySelectorAll('[data-key="k-${c}"]')].find((b) => b.getBoundingClientRect().width > 0)`, touch);
    await pg.waitForFunction(`(() => { const q = ${QV6}; const b = q.querySelector('.qr.sr .ra-b[data-action="remove"]'); return q.querySelector('.qsq')?.textContent.trim() === 'PORC' && b && !b.disabled; })()`);
    await tap6(pg, `${QV6}.querySelector('.qr.sr .ra-b[data-action="remove"]')`, touch, 'center');
    const ub = await inMiddle(pg, `${QV6}.querySelector('.undo')`);
    check(`${tag} Undo bar inside the middle, above the tab bar`, ub && ub.inside, JSON.stringify(ub));
    verify(`${tag} Undo bar showing`, await geom(pg), {});
    if (w === 1024 && h === 666) await pg.screenshot({ path: `${OUT}queue-undo-${w}x${h}-toolbar${lg ? '-large' : ''}.png` });
    await pg.close();
  }
}

// ---------- 7. 0.7.2 Library with the integration backend (source buttons shown), every size ----------
for (const [w, h, touch] of SIZES) {
  const vp = { width: w, height: h, ...(touch ? { isMobile: true, hasTouch: true } : {}) };
  const pg = await newPage(vp);
  await open(pg, `&kiosk=1&ha=toolbar&sidebar=${sidebarFor(w)}`);
  await tapTab(pg, LIB, touch, false);
  await pg.waitForFunction(() => __card.shadowRoot.querySelector('jb-search').shadowRoot.querySelectorAll('.srcs .src').length > 0, { timeout: 4000 }).catch(() => {});
  const cats = await libCats(pg);
  check(`F7 ${w}x${h} toolbar kiosk backend Library: ${cats.length} category buttons fully visible before the keyboard opens`, cats.length >= 4 && cats.every((c) => c.ok), JSON.stringify(cats));
  await openKb(pg, touch);
  const g = await geom(pg);
  check(`F7 ${w}x${h} toolbar kiosk backend Library: source buttons shown`, (g.lib?.srcs.length ?? 0) > 0, JSON.stringify(g.lib));
  verify(`F7 ${w}x${h} toolbar kiosk backend Library`, g, { tab: LIB });
  if (KEY.has(`${w}x${h}`)) await pg.screenshot({ path: `${OUT}library-kiosk-${w}x${h}-toolbar.png` });
  await pg.close();
}

check('F9 no page errors', pageErrors.length === 0, pageErrors.join(' | '));
writeFileSync(OUT + 'results.json', JSON.stringify({ at: new Date().toString(), results }, null, 2));
// 0.7.9 #55: portrait Now Playing — the art's bottom edge is above the badge line and the title, and the badge line, title and
// artist never overlap each other, at every portrait size (the fit ones plus common phones/tablets), large buttons on/off, long titles
{
  const P55 = [[390, 844], [820, 1180], [390, 600], [360, 640], [375, 667], [414, 896], [600, 960], [600, 1024], [768, 1024], [1080, 1920]];
  for (const lg of [false, true]) for (const long of [false, true]) for (const [w, h] of P55) {
    const tag = `F55 ${w}x${h}${lg ? ' large_buttons' : ''}${long ? ' long title' : ''}`;
    const pg = await newPage({ width: w, height: h, isMobile: w < 500, hasTouch: true });
    await open(pg, `&tab=now${lg ? '&cfg=' + encodeURIComponent(JSON.stringify({ large_buttons: true })) : ''}`);
    if (long) await pg.evaluate(() => window.__setNowPlaying({ artist: 'The Sleep Eazys, Joe Bonamassa and A Very Long List Of Guest Musicians',
      title: 'Shine On You Crazy Diamond, Pts. 6-9 (2011 Remastered Version, Extended Live Edit)', radio: false, duration: 745, position: 30 }));
    await sleep(500);
    const m = await pg.evaluate(() => { const r = __card.shadowRoot.querySelector('jb-now').shadowRoot; const R = (s) => { const e = r.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { t: x.top, b: x.bottom, h: x.height }; };
      return { art: R('.art'), badges: R('.badges'), ti: R('.ti'), sub: R('.sub') }; });
    const ok = m.art && m.badges && m.ti && m.sub && m.art.h > 40 && m.art.b <= m.badges.t + 0.5 && m.art.b <= m.ti.t + 0.5
      && m.badges.b <= m.ti.t + 0.5 && m.ti.b <= m.sub.t + 0.5;
    check(`${tag}: art bottom above badges and title; badges, title, artist don't overlap`, !!ok, JSON.stringify(m));
    await pg.close();
  }
}
// 0.7.9 #55: the HA card editor preview — the card alone at ~400–500 px wide inside a wide landscape page (its own container
// size, not the screen's, decides the layout); large buttons on/off, long title
{
  const PV = [[400, 560], [460, 620], [500, 700], [460, 900], [520, 640]];
  for (const lg of [false, true]) for (const [cw, chh] of PV) {
    const tag = `F55p preview ${cw}x${chh} in 1280x800${lg ? ' large_buttons' : ''}`;
    const pg = await newPage({ width: 1280, height: 800 });
    await open(pg, `&tab=now${lg ? '&cfg=' + encodeURIComponent(JSON.stringify({ large_buttons: true })) : ''}`);
    await pg.evaluate((cw, chh) => { const c = window.__card; c.style.cssText = `display:block;width:${cw}px;height:${chh}px;margin:20px auto;`;
      window.__setNowPlaying({ artist: 'The Sleep Eazys, Joe Bonamassa and A Very Long List Of Guest Musicians', title: 'Shine On You Crazy Diamond, Pts. 6-9 (2011 Remastered Version, Extended Live Edit)', radio: false, duration: 745, position: 30 }); }, cw, chh);
    await sleep(700);
    const m = await pg.evaluate(() => { const r = __card.shadowRoot.querySelector('jb-now').shadowRoot; const R = (s) => { const e = r.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { t: x.top, b: x.bottom, h: x.height, w: x.width }; };
      return { card: R('.nw'), art: R('.art'), badges: R('.badges'), ti: R('.ti'), sub: R('.sub') }; });
    const ok = m.art && m.ti && m.sub && m.badges && m.card.w <= 0 + 600 && m.art.h > 40 && m.art.b <= m.badges.t + 0.5 && m.art.b <= m.ti.t + 0.5 && m.badges.b <= m.ti.t + 0.5 && m.ti.b <= m.sub.t + 0.5;
    check(`${tag}: art bottom above badges and title; badges, title, artist don't overlap`, !!ok, JSON.stringify(m));
    // 0.7.9 #58: the "Playing on" pill and the "Now Playing" tab label fit — nothing clipped, no ellipsis
    const pt = await pg.evaluate(() => { const r = __card.shadowRoot; const B = (e) => e.getBoundingClientRect();
      const shown = (e) => getComputedStyle(e).display !== 'none' && B(e).width > 0;
      const pill = r.querySelector('.pill'), top = r.querySelector('.top'), pb = B(pill), tb = B(top);
      const parts = [...pill.children].filter(shown).map((e) => ({ c: e.className?.baseVal ?? e.className, sw: e.scrollWidth, cw: e.clientWidth || B(e).width, l: B(e).left, r: B(e).right }));
      const tab = r.querySelector('.tab[data-tab="now"]'), lab = tab.querySelector('span'), lb = B(lab), tbb = B(tab);
      return { pill: { l: pb.left, r: pb.right, sw: pill.scrollWidth, cw: pill.clientWidth, top: [tb.left, tb.right], text: [...pill.querySelectorAll('span, b')].filter(shown).map((e) => e.textContent.trim()).join(' '), parts },
        tab: { text: lab.textContent.trim(), sw: lab.scrollWidth, cw: lab.clientWidth, l: lb.left, r: lb.right, tl: tbb.left, tr: tbb.right, lines: Math.round(lb.height / parseFloat(getComputedStyle(lab).lineHeight || '16')) } }; });
    const pillOk = pt.pill.sw <= pt.pill.cw + 1 && pt.pill.l >= pt.pill.top[0] - 0.5 && pt.pill.r <= pt.pill.top[1] + 0.5 && pt.pill.parts.every((x) => x.sw <= x.cw + 1 && x.l >= pt.pill.l - 0.5 && x.r <= pt.pill.r + 0.5);
    const tabOk = pt.tab.text === 'Now Playing' && pt.tab.sw <= pt.tab.cw + 0.5 && pt.tab.l >= pt.tab.tl - 0.5 && pt.tab.r <= pt.tab.tr + 0.5;
    check(`${tag}: "Playing on" pill and the "Now Playing" tab label fit (no clipping, no ellipsis)`, pillOk && tabOk, JSON.stringify(pt));
    if (process.env.PVSHOT && lg && cw === 460 && chh === 620) await pg.screenshot({ path: process.env.PVSHOT, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    await pg.close();
  }
}
// 0.7.9 #59: the Now Playing speaker list never runs under the tab bar; every row can be scrolled fully into view
{
  const R = ['media_player.living_room', 'media_player.kitchen', 'media_player.garage', 'media_player.indoor', 'media_player.outdoor'];
  const SIZES59 = [['1024x600', { width: 1024, height: 600 }, ''], ['1024x712 (iPad, HA toolbar + sidebar)', { width: 1080, height: 768 }, '&ha=toolbar&sidebar=narrow']];
  for (const [name, vp, q] of SIZES59) for (const n of [3, 4, 5]) for (const lg of [false, true]) {
    const tag = `F59 ${name} ${n} speakers${lg ? ' large_buttons' : ''}`;
    const pg = await newPage(vp);
    await open(pg, `&tab=now&overlay=0${q}&cfg=${encodeURIComponent(JSON.stringify({ rooms: R.slice(0, n), ...(lg ? { large_buttons: true } : {}) }))}`);
    await sleep(500);
    const m = await pg.evaluate(async () => {
      const c = __card.shadowRoot, r = c.querySelector('jb-now').shadowRoot, v = r.querySelector('.vol'), w = r.querySelector('.volw');
      const tabsTop = c.querySelector('nav.tabs').getBoundingClientRect().top, card = __card.getBoundingClientRect();
      const vb = () => v.getBoundingClientRect();
      const rows = [...v.querySelectorAll('.vr')], out = [];
      for (const row of rows) {
        row.scrollIntoView({ block: 'nearest' }); await new Promise((res) => setTimeout(res, 80));
        const b = row.getBoundingClientRect(), box = vb();
        out.push({ name: row.querySelector('.vn')?.textContent.trim().slice(0, 14), full: b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5 && b.bottom <= tabsTop + 0.5 && b.height > 20 });
      }
      v.scrollTop = 0; await new Promise((res) => setTimeout(res, 120));
      const over = v.scrollHeight - v.clientHeight > 1;
      return { card: [Math.round(card.width), Math.round(card.height)], tabsTop: Math.round(tabsTop), listBottom: Math.round(vb().bottom), over, hint: over ? getComputedStyle(r.querySelector('.vmore')).display !== 'none' : null, rows: out, n: rows.length };
    });
    check(`${tag}: the speaker list ends above the bottom bar`, m.listBottom <= m.tabsTop + 0.5, JSON.stringify(m));
    check(`${tag}: every speaker row (${m.n}) can be scrolled fully into view above the bar`, m.n === n + 1 && m.rows.every((x) => x.full), JSON.stringify(m.rows));
    check(`${tag}: when the list scrolls, a "More speakers" hint shows`, !m.over || m.hint === true, JSON.stringify({ over: m.over, hint: m.hint }));
    await pg.close();
  }
}
await browser.close();
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

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
const TABS = ['now', 'browse', 'queue', 'lyrics']; // 'browse' is the combined Library tab; there is no separate search tab
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
  const lib = sv ? { combined: sr.querySelector('jb-search').hasAttribute('combined') || !!sr.querySelector('jb-search').combined, q: vis([...sv.querySelectorAll('.qbar')].find((el) => el.getBoundingClientRect().height)),
    srcs: [...sv.querySelectorAll('.srcs .src')].map(vis).filter(Boolean) } : null;
  const nw = sr.querySelector('jb-now')?.shadowRoot.querySelector('.nw');
  const pp = sr.querySelector('jb-now')?.shadowRoot.querySelector('.tb.pp');
  return { vw, vh, tbB, nav: r(sr.querySelector('.tabs')), top: r(sr.querySelector('.top')), tabs, could, docH: document.documentElement.scrollHeight,
    kb: kb && kb.getBoundingClientRect().height ? r(kb) : null, nw: nw ? { sh: nw.scrollHeight, ch: nw.clientHeight } : null, pp: r(pp),
    lib, fit: __card.dataset.fitH, size: __card.dataset.fit ?? '' };
});
const kbdGeom = (pg) => pg.evaluate(() => {
  const sr = __card.shadowRoot, sv = sr.querySelector('jb-search')?.shadowRoot;
  const kb = sv?.querySelector('jb-keyboard'), res = sv?.querySelector('.res'), q = [...(sv?.querySelectorAll('.qbar') ?? [])].find((el) => el.getBoundingClientRect().height);
  if (!kb || !res || !q) return null;
  const R = (el) => { const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height, w: b.width }; };
  const keys = [...kb.shadowRoot.querySelectorAll('.k')].filter((k) => getComputedStyle(k).display !== 'none');
  const rs = keys.map(R), space = R(kb.shadowRoot.querySelector('[data-key="k-space"]'));
  const cols = [...new Set(rs.map((b) => Math.round(b.l)))], rows = [...new Set(rs.map((b) => Math.round(b.t)))];
  const titles = [...sv.querySelectorAll('.scroll .row .rt b')].map(R).filter((b) => b.w && b.h);
  const catRow = sv.querySelector('.lcats'), catButtons = [...sv.querySelectorAll('.lcats .lc')].map(R);
  const labelFit = ['k-space', 'k-clear'].every((id) => { const el = kb.shadowRoot.querySelector(`[data-key=${id}]`); return el && el.scrollWidth <= el.clientWidth + 1; });
  const source = [...sv.querySelectorAll('.srct')].find((el) => el.getBoundingClientRect().height);
  const lastY = Math.max(...rs.map((b) => Math.round(b.t))), lastRow = rs.filter((b) => Math.round(b.t) === lastY);
  const rowFull = lastRow.length === 6 && Math.abs(Math.min(...lastRow.map((b) => b.l)) - cols[0]) <= 1 && Math.abs(Math.max(...lastRow.map((b) => b.r)) - Math.max(...rs.map((b) => b.r))) <= 1;
  return { kb: R(kb), res: R(res), q: R(q), nav: R(sr.querySelector('.tabs')), cols: cols.length, rows: rows.length, lastCount: lastRow.length, rowFull,
    vw: innerWidth, vh: innerHeight, titleW: titles.length ? Math.min(...titles.map((b) => b.w)) : 0, titleCount: titles.length,
    catRows: new Set(catButtons.map((b) => Math.round(b.t))).size, catScroll: catRow ? catRow.scrollWidth >= catRow.clientWidth : false, labelFit,
    statusHidden: [...sv.querySelectorAll('.qmeta')].every((el) => getComputedStyle(el).display === 'none' || !el.getBoundingClientRect().height),
    sourceFit: !source || source.getBoundingClientRect().right <= innerWidth + 0.5,
    minW: Math.min(...rs.map((b) => b.w)), minH: Math.min(...rs.map((b) => b.h)), maxW: Math.max(...rs.map((b) => b.w)),
    maxH: Math.max(...rs.map((b) => b.h)), count: rs.length, space, side: kb.hasAttribute('side'), fill: kb.shadowRoot.querySelector(':host .keys') ? getComputedStyle(kb.shadowRoot.querySelector('.keys')).gridTemplateRows : '' };
});
function verifyKbd(label, g) {
  const phone = g && g.vw <= 520;
  const landscape = g && g.vw > g.vh && g.vh <= 520;
  const tablet = g && !phone && !landscape;
  const bottom = phone && !landscape;
  const gridOk = g?.cols === 6 && g?.rows === 5;
  check(`${label}: portrait keyboard below results; tablet/landscape keyboard beside results`, !!g && g.side && (bottom ? (g.kb.t >= g.res.b - 0.5 && g.kb.l >= g.res.l - 0.5 && g.kb.r <= g.res.r + 0.5 && g.q.b <= g.kb.t + 0.5 && g.res.b <= g.kb.t + 0.5) : (g.kb.r <= g.res.l + 0.5 && (tablet ? (g.q.l >= g.kb.l - 0.5 && g.q.r <= g.kb.r + 0.5 && g.q.b <= g.kb.t + 0.5) : g.q.l >= g.kb.r - 0.5))) && g.kb.b <= g.nav.t + 0.5 && g.res.b <= g.nav.t + 0.5, JSON.stringify(g));
  check(`${label}: full 30-key 6x5 grid; final row has no empty cells`, !!g && g.count === 30 && gridOk && g.lastCount === 6 && g.rowFull && g.space.w <= g.maxW + 1 && g.space.w <= g.minW * 1.35 && g.space.h <= g.maxH + 1, JSON.stringify(g));
  check(`${label}: usable touch keys; short landscape >= 40px tall`, !!g && g.minW >= (phone ? 34 : 40) && g.minH >= 40 && g.maxW <= g.minW * 1.35, JSON.stringify(g));
  check(`${label}: one category row, fitting source control, Space/Clear labels, no clipped status`, !!g && g.catRows === 1 && g.catScroll && g.sourceFit && g.labelFit && (phone || g.statusHidden), JSON.stringify(g));
  if (g?.titleCount) check(`${label}: visible result titles retain useful width`, g.titleW >= 90, JSON.stringify({ titleW: g.titleW, count: g.titleCount }));
}
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
  await sleep(id === 'lyrics' || id === LIB ? 350 : 250);
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
async function tap6(pg, expr, touch) {
  const b = await ev6(pg, `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  if (!b || !b.w) throw new Error('nothing to tap: ' + expr);
  if (touch) await pg.touchscreen.tap(b.x, b.y); else await pg.mouse.click(b.x, b.y);
  await sleep(300);
}
/** el's box against the middle (between header and tab bar); scroller = the element that scrolls when el is taller than the room */
const inMiddle = (pg, expr, scroller) => ev6(pg, `(() => { const el = ${expr}; if (!el) return null; const sr = __card.shadowRoot; const m = sr.querySelector('main.np').getBoundingClientRect();
  const b = el.getBoundingClientRect(); const sc = ${scroller ? scroller : 'null'};
  return { t: Math.round(b.top), b: Math.round(b.bottom), mt: Math.round(m.top), mb: Math.round(m.bottom), h: Math.round(b.height),
    inside: b.top >= m.top - 0.5 && b.bottom <= m.bottom + 0.5 && b.height > 0, sh: sc ? sc.scrollHeight : 0, ch: sc ? sc.clientHeight : 0, ov: sc ? getComputedStyle(sc).overflowY : '' }; })()`);
const fits6 = (r) => !!r && r.inside && (r.sh <= r.ch + 2 || /auto|scroll/.test(r.ov));
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
    await pg.waitForFunction(`${QV6}.querySelectorAll('.qr.next .qa[data-action="remove"]').length > 2`, { timeout: 4000 }).catch(() => {});
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
    await tap6(pg, `${QV6}.querySelectorAll('.qr.next')[1].querySelector('.qa[data-action="playnow"]') ?? null`, touch).catch(async () => {
      await tap6(pg, `${QV6}.querySelectorAll('.qr.next .qa.mo')[1]`, touch); await tap6(pg, `[...${QV6}.querySelectorAll('.menu .mi:not(.cancel)')][0]`, touch); });
    const cf = await inMiddle(pg, `${QV6}.querySelector('.confirm')`, `${QV6}.querySelector('.confirm')`);
    check(`${tag} Play-now confirm inside the middle`, fits6(cf), JSON.stringify(cf));
    const ok = await inMiddle(pg, `${QV6}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
    check(`${tag} Play-now confirm: Play now button visible`, ok && ok.inside, JSON.stringify(ok));
    verify(`${tag} Play-now confirm open`, await geom(pg), {});
    await tap6(pg, `${QV6}.querySelector('.confirm .cbtn[data-action="cancel"]')`, touch);
    await tap6(pg, `${QV6}.querySelectorAll('.qr.next .qa[data-action="remove"]')[2]`, touch);
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
  const kg = await kbdGeom(pg);
  verifyKbd(`F7 ${w}x${h}`, kg);
  await pg.close();
}

check('F9 no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
writeFileSync(OUT + 'results.json', JSON.stringify({ at: new Date().toString(), results }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

// #117 width sweep: the card at its own width from 320 to 1920 px (a full-screen card at that size, plus a 460 px editor
// preview and a half-width card inside a 1920x1080 window). On every screen and pop-up it checks that every touch target
// that can be tapped right now is at least 48x48 px, that no button label is cut off or spills out of its button, that no
// two touch targets overlap, and that nothing sticks out of the card sideways.
// Row buttons that Kiosk Dev is removing or reworking (#85: Library/search .ra-b; the queue's .qa row buttons) are reported on their
// own ("kd:" kinds) and do not fail the sweep; everything else does. Text that a target hides on purpose (a part that wrapped onto a
// clipped second line, e.g. the speaker pill dropping "· 3 rooms synced") is not visible and not counted as cut.
// Usage: node test/widths.e2e.mjs            env: WIDTHS=320,460  SCENES=now,queue  JOBS=3  OUT=<dir for a json report>
import fs from 'node:fs';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
import { launch, openPage, sleep } from './themes-lib.mjs';
import { SCENES } from './themes-scenes.mjs';

const MIN = 48;
const WIDTHS = (process.env.WIDTHS ?? '320,360,390,412,460,520,600,680,768,820,900,960,1024,1180,1280,1366,1440,1600,1920').split(',').map(Number);
const LIST = (process.env.SCENES ?? 'now,speakers-picker,library-home,lib-playlists-tiles,lib-playlists-rows,lib-tracks-rows,lib-radio,lib-keyboard-123,lib-search-results,detail-album,track-popup,track-popup-moreinfo,station-sheet,queue,queue-popup').split(',');
const heights = (w) => (w < 768 ? [640, 900] : w < 1024 ? [600, 1000] : [600, 800, 1080]);
const VIEWS = [];
for (const w of WIDTHS) for (const h of heights(w)) VIEWS.push({ name: `${w}x${h}`, vp: { width: w, height: h } });
// a card narrower than its window: the HA card editor preview (~460 px) and a half-width card on a 1920x1080 screen
if (!process.env.WIDTHS) for (const cw of [460, 960]) VIEWS.push({ name: `card${cw}-in-1920x1080`, vp: { width: 1920, height: 1080 }, card: cw });

/** runs in the page: every visible touch target, deep through shadow roots */
const AUDIT = (MIN) => {
  const SEL = 'button, [role=button], [role=tab], [role=slider], [role=switch], [role=checkbox], [role=option], [role=menuitem], [role=radio], a[href], input:not([type=hidden]), select, textarea, jb-slider';
  // item names (song, album, station titles, speaker names) are content: a long one ends in "…" by design
  const CONTENT = '.rt, .rt *, .tile b, .tile small, .tw, .nm, .dt, .dt *, .pn, .ttl, .art, .sub, .meta, .qr .rt *, .cf-h *, .hd, .hd *, .ti, .ti *, .station, .st-n, .desc';
  const out = [];
  const host = (n) => n.parentElement || n.getRootNode()?.host || null;
  const contains = (a, b) => { for (let n = b; n; n = host(n)) if (n === a) return true; return false; };
  const deepHit = (x, y) => { let e = document.elementFromPoint(x, y); for (let i = 0; e?.shadowRoot && i < 30; i++) { const d = e.shadowRoot.elementFromPoint(x, y); if (!d || d === e) break; e = d; } return e; };
  const name = (el) => { const c = [...el.classList].slice(0, 3).join('.'); const tx = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    let p = ''; for (let n = el, i = 0; n && i < 4; i++) { n = host(n); if (n?.tagName?.includes('-')) { p = n.tagName.toLowerCase(); break; } } return `${p} ${el.tagName.toLowerCase()}${c ? '.' + c : ''} "${tx}"`; };
  const cand = [];
  const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.matches(SEL)) cand.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  const vw = innerWidth, vh = innerHeight;
  const vis = [];
  for (const el of cand) {
    if (el.disabled && el.matches('button')) { /* still a target if it is shown */ }
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || +s.opacity === 0 || s.pointerEvents === 'none') continue;
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
    const hit = deepHit(cx, cy); if (!hit || !(contains(el, hit) || contains(hit, el))) continue; // covered, clipped or scrolled away: not tappable now
    // the part actually on screen: the box cut by every scrolling / clipping ancestor (a row half scrolled under the list edge is
    // only that visible part; overlaps are judged on it)
    let v = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let a = host(el); a && a !== document.documentElement; a = host(a)) {
      if (!(a instanceof Element)) continue;
      const as = getComputedStyle(a); if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      v = { left: Math.max(v.left, ar.left), top: Math.max(v.top, ar.top), right: Math.min(v.right, ar.right), bottom: Math.min(v.bottom, ar.bottom) };
    }
    // nested targets (a row that is a button with buttons in it): the inner ones are checked on their own
    vis.push({ el, r, v });
  }
  const KD = '.ra-b, .qa';
  for (const { el, r } of vis) {
    const n = name(el);
    const at = out.length;
    // a slider's touch area is its whole track row; it must be tall enough to hit
    if (Math.min(r.width, r.height) < MIN - 0.5) out.push({ k: 'small', n, w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
    if (r.left < -0.5 || r.right > vw + 0.5) out.push({ k: 'offcard', n, l: Math.round(r.left), r: Math.round(r.right) });
    // labels: every text inside the target must fit inside it and must not be clipped or ellipsized
    const texts = [el, ...el.querySelectorAll('*')].filter((t) => !t.matches(CONTENT) && [...t.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
    for (const t of texts) {
      const tr = t.getBoundingClientRect(); const ts = getComputedStyle(t);
      if (tr.width < 1 || ts.display === 'none' || ts.visibility === 'hidden') continue;
      // wholly outside a clipping box inside the target: hidden on purpose (not shown, so not cut)
      let gone = false;
      for (let a = t.parentElement; a && a !== el.parentElement; a = a.parentElement) {
        const as = getComputedStyle(a); if (as.overflow === 'visible' && as.overflowX === 'visible' && as.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (tr.right <= ar.left + 0.5 || tr.left >= ar.right - 0.5 || tr.bottom <= ar.top + 0.5 || tr.top >= ar.bottom - 0.5) { gone = true; break; }
        if (a === el) break;
      }
      if (gone) continue;
      const clip = t.scrollWidth > t.clientWidth + 1 && t.clientWidth > 0 && ts.overflow !== 'visible' || t.scrollHeight > t.clientHeight + 2 && t.clientHeight > 0 && ts.overflow !== 'visible' && ts.overflowY !== 'visible';
      const spill = tr.left < r.left - 1 || tr.right > r.right + 1 || tr.top < r.top - 1 || tr.bottom > r.bottom + 1;
      if (clip || spill) { out.push({ k: clip ? 'cut' : 'spill', n, t: t.textContent.trim().slice(0, 30) }); break; }
    }
    if (el.matches(KD)) for (let i = at; i < out.length; i++) out[i].k = 'kd:' + out[i].k;
  }
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i], b = vis[j]; if (contains(a.el, b.el) || contains(b.el, a.el)) continue;
    const x = Math.min(a.v.right, b.v.right) - Math.max(a.v.left, b.v.left), y = Math.min(a.v.bottom, b.v.bottom) - Math.max(a.v.top, b.v.top);
    if (x > 1 && y > 1) out.push({ k: (a.el.matches(KD) || b.el.matches(KD) ? 'kd:' : '') + 'overlap', n: name(a.el), m: name(b.el), x: Math.round(x), y: Math.round(y) });
  }
  const se = document.scrollingElement; if (se.scrollWidth > vw + 1) out.push({ k: 'hscroll', n: 'page', w: se.scrollWidth });
  return { n: vis.length, issues: out };
};

const BASE = await devIndex();
const browser = await launch();
const results = [];
const jobs = [];
for (const v of VIEWS) for (const s of LIST) jobs.push({ v, s });
let failures = 0, done = 0;
async function run({ v, s }) {
  const sc = SCENES[s]; if (!sc) { results.push({ view: v.name, scene: s, error: 'no scene' }); return; }
  let p;
  try {
    p = await openPage(browser, hermetic, BASE, 'light', sc.q, v.vp);
    if (v.card) { await p.evaluate((w) => { __card.style.width = w + 'px'; __card.style.display = 'block'; }, v.card); await sleep(600); }
    if (sc.act) await sc.act(p);
    await sleep(400);
    const a = await p.evaluate(`(${AUDIT.toString()})(${MIN})`);
    results.push({ view: v.name, scene: s, targets: a.n, issues: a.issues });
    if (a.issues.some((i) => !i.k.startsWith('kd:'))) failures++;
  } catch (e) { results.push({ view: v.name, scene: s, error: String(e.message).slice(0, 160) }); failures++; }
  try { await p?.close(); } catch {}
  done++;
}
const JOBS = Number(process.env.JOBS ?? 3);
await Promise.all(Array.from({ length: JOBS }, async () => { while (jobs.length) await run(jobs.shift()); }));
await browser.close();
results.sort((a, b) => (a.view + a.scene).localeCompare(b.view + b.scene));
const kinds = {};
for (const r of results) {
  const ok = !r.error && !r.issues.some((i) => !i.k.startsWith('kd:'));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.view} ${r.scene}: ${r.error ? 'ERROR ' + r.error : `${r.targets} targets` + (r.issues.length ? ' — ' + r.issues.map((i) => `${i.k} ${i.n}${i.m ? ' × ' + i.m : ''}${i.w != null ? ` ${i.w}x${i.h}` : ''}${i.t ? ` [${i.t}]` : ''}`).join(' | ') : '')}`);
  for (const i of r.issues ?? []) kinds[i.k] = (kinds[i.k] ?? 0) + 1;
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
console.log(`${results.length - failures}/${results.length} width-sweep checks passed; issues by kind ${JSON.stringify(kinds)}`);
process.exit(failures ? 1 : 0);

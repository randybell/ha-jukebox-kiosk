// 0.7.13 (issue #78): on the Library page's Songs list (search off, also Favorites), a tap or click on a song row opens the SAME
// pop-up (jb-hold-sheet) that holding the row opens, with the same contents. The old small menu (.menu) never shows. Holding still opens
// the pop-up. A swipe that starts on a song row opens nothing. Run at 1024x600 for touch and mouse, in the combined Library tab (default
// layout) and the separate Library tab, for the normal Songs list and the Favorites Songs list.
// Usage: node test/library-song-tap.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes the screenshots.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); };
const J = JSON.stringify;
const SHOTS = process.env.SHOTS;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const plays = (p) => ev(p, `(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => c.data.enqueue)`);
const clear = (p) => ev(p, `window.__calls = []`);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
// what the pop-up shows: the item, the heading texts and every choice (id, label, grayed) and the Cancel
const sheetOf = (p) => ev(p, `(() => { const r = ${HS}, sh = r.querySelector('.sh'); if (!sh) return null;
  return { uri: r.host.state?.item?.uri, head: sh.querySelector('.hd')?.innerText.trim(), items: [...sh.querySelectorAll('.it')].map((b) => b.dataset.action + ':' + b.textContent.trim() + (b.classList.contains('off') ? ':off' : '')) }; })()`);
const closeSheet = async (p) => { const c = await center(p, `${HS}.querySelector('.it.cancel')`); if (c) await p.mouse.click(c.x, c.y); await sleep(250); };

// where the Songs list lives: the combined Library tab (jb-search embeds jb-browse) or the separate Library tab (jb-browse at card level)
const LAYOUTS = {
  combined: { q: '&kiosk=1&tab=browse', BR: `${SV}.querySelector('jb-browse').shadowRoot` },
  separate: { q: '&layout=separate&kiosk=1&tab=browse&lhome=0', BR: `__card.shadowRoot.querySelector('jb-browse').shadowRoot` },
};
async function openSongs(layout, fav, touch) {
  const { q, BR } = LAYOUTS[layout];
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: touch });
  await p.goto(`${BASE}?fresh=1&latency=20${q}`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  if (layout === 'combined') {
    await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Songs').click()`);
    await sleep(500);
    if (fav) { await ev(p, `${SV}.querySelector('[data-act="lib-fav"]').click()`); await sleep(500); }
  } else {
    await p.waitForFunction((b) => !!eval(b).querySelector('[data-cat="track"]'), {}, BR);
    await ev(p, `${BR}.querySelector('[data-cat="track"]').click()`); await sleep(500);
    if (fav) { await ev(p, `${BR}.querySelector('[data-cat="favorites"]').click()`); await sleep(500); }
  }
  await p.waitForFunction((b) => eval(b).querySelectorAll('.list .row[data-type="track"]').length > 0, { timeout: 8000 }, BR);
  await clear(p);
  return { p, BR };
}
async function tapAt(p, kind, c) { if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); }
async function holdAt(p, kind, c, ms = 700) {
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(ms); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(ms); await p.mouse.up(); }
  await sleep(300);
}
const oldMenu = (p, BR) => ev(p, `!!${BR}.querySelector('.menu') || !!${SV}?.querySelector?.('.menu') || !!${HS}.querySelector('.menu')`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

for (const layout of Object.keys(LAYOUTS)) for (const fav of [false, true]) for (const kind of ['touch', 'mouse']) {
  const tag = `1024x600 ${layout} Library Songs${fav ? ' (Favorites)' : ''}, ${kind === 'touch' ? 'tap' : 'click'}`;
  const { p, BR } = await openSongs(layout, fav, kind === 'touch');
  const n = await ev(p, `${BR}.querySelectorAll('.list .row[data-type="track"]').length`);
  check(`${tag}: the song list is showing (${n} rows) and no pop-up is open`, n > 0 && !(await sheetOpen(p)));
  const rowExpr = `${BR}.querySelectorAll('.list .row[data-type="track"]')[1]`;
  const uri = await ev(p, `${rowExpr}.dataset.uri`);
  await ev(p, `${rowExpr}.scrollIntoView({ block: 'center' })`); await sleep(150);
  const c = await center(p, `${rowExpr}.querySelector('.rt')`);

  // ---- tap on the row opens the pop-up; the old menu never shows ----
  await tapAt(p, kind, c); await sleep(150);
  const sTap = await sheetOf(p);
  const menuNow = await oldMenu(p, BR);
  await sleep(450);
  check(`${tag}: a tap on the row opens the pop-up (jb-hold-sheet) for that song`, !!sTap && sTap.uri === uri, J(sTap));
  check(`${tag}: the old small menu never shows (not on the tap, not after)`, !menuNow && !(await oldMenu(p, BR)), String(menuNow));
  check(`${tag}: the pop-up is still open half a second later (the finger-lift click does not close it)`, !!(await sheetOpen(p)));
  check(`${tag}: the tap plays nothing by itself`, J(await plays(p)) === '[]', J(await plays(p)));
  check(`${tag}: the pop-up lists Add to queue, Play next, Play now, Start radio, More Info and Cancel — no Remove`,
    !!sTap && sTap.items.length === 6 && J(sTap.items.map((x) => x.split(':')[0])) === '["add","next","replace","radio","more","cancel"]', J(sTap?.items));
  if (layout === 'combined') await shot(p, fav ? (kind === 'touch' ? 'library-fav-song-tap' : 'library-fav-song-tap-mouse') : `library-song-tap-${kind}`);
  await closeSheet(p);
  check(`${tag}: Cancel closes the pop-up and plays nothing`, !(await sheetOpen(p)) && J(await plays(p)) === '[]');

  // ---- a hold on the same row opens the same pop-up with the same contents ----
  await holdAt(p, kind, c);
  const sHold = await sheetOf(p);
  check(`${tag}: holding the row still opens the pop-up (and the finger-lift leaves it open, nothing plays)`, !!sHold && sHold.uri === uri && J(await plays(p)) === '[]', J(sHold));
  check(`${tag}: the tap pop-up has exactly the same contents as the hold pop-up`, !!sTap && !!sHold && J(sTap) === J(sHold), J({ sTap, sHold }));
  check(`${tag}: a hold never shows the old menu`, !(await oldMenu(p, BR)));
  await closeSheet(p);

  // ---- a choice in the tap pop-up works: Play next enqueues next and closes it ----
  await tapAt(p, kind, c); await sleep(450);
  const nx = await center(p, `${HS}.querySelector('.it[data-action="next"]')`);
  if (nx) await p.mouse.click(nx.x, nx.y);
  await sleep(350);
  check(`${tag}: Play next in the pop-up enqueues next and closes the pop-up`, J(await plays(p)) === '["next"]' && !(await sheetOpen(p)), J(await plays(p)));

  // ---- the row's own buttons are untouched: Play Next still fires right away, with no pop-up ----
  await clear(p);
  const b = await center(p, `${rowExpr}.querySelector('.ra-b[data-act="next"]')`);
  await tapAt(p, kind, b); await sleep(350);
  check(`${tag}: the row's own Play Next button still fires directly and opens no pop-up`, J(await plays(p)) === '["next"]' && !(await sheetOpen(p)), J(await plays(p)));

  // ---- a swipe / drag starting on a song row opens nothing ----
  await clear(p);
  const sc = `(() => { for (let a = ${rowExpr}; a; a = a.parentElement || a.getRootNode().host) if (a.scrollHeight > a.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(a).overflowY)) return a; })()`;
  await ev(p, `{ const s = ${sc}; if (s) s.scrollTop = 0; }`); await sleep(200);
  const r0 = await center(p, `${rowExpr}.querySelector('.rt')`);
  const t0 = await ev(p, `${sc}?.scrollTop ?? 0`);
  if (kind === 'touch') {
    await p.touchscreen.touchStart(r0.x, r0.y);
    for (let i = 1; i <= 12; i++) { await p.touchscreen.touchMove(r0.x, r0.y - i * 12); await sleep(20); }
    await sleep(700); await p.touchscreen.touchEnd();
  } else {
    await p.mouse.move(r0.x, r0.y); await p.mouse.down();
    for (let i = 1; i <= 12; i++) { await p.mouse.move(r0.x, r0.y - i * 6); await sleep(20); }
    await sleep(700); await p.mouse.up();
  }
  await sleep(400);
  const t1 = await ev(p, `${sc}?.scrollTop ?? 0`);
  const scrolls = await ev(p, `(() => { const s = ${sc}; return s ? s.scrollHeight - s.clientHeight : 0; })()`);
  check(`${tag}: a ${kind === 'touch' ? 'swipe' : 'drag'} starting on a song row opens no pop-up, no menu, plays nothing`, !(await sheetOpen(p)) && !(await oldMenu(p, BR)) && J(await plays(p)) === '[]', J({ sheet: await sheetOpen(p), calls: await plays(p) }));
  if (kind === 'touch' && scrolls > 40) check(`${tag}: the swipe scrolled the list instead (${t0} to ${t1})`, t1 > t0 + 20, J({ t0, t1, scrolls }));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} library-song-tap checks passed`);
process.exit(failures ? 1 : 0);

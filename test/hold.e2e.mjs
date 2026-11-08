// 0.7.10 hold-to-fire: search result rows and artist page Albums rows. A row button fires only after HOLD_MS (500 ms) of holding; a quick tap
// does nothing; moving > 10 px cancels; the whole row highlights (with a progress fill) while held. Holding the row itself opens the menu 5
// pop-up (Open, Add to queue, Play next, Play now, Start radio, Cancel). Menu 5 on Library tiles: same list; stations Open + Play now.
// Usage: node test/hold.e2e.mjs (starts its own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); };
const J = JSON.stringify;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const DET = `${SV}.querySelector('jb-detail').shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const plays = (p) => ev(p, `(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => c.data.enqueue)`);
const clear = (p) => ev(p, `window.__calls = []`);
const menuIds = (p, root) => ev(p, `[...${root}.querySelectorAll('.menu .mi')].map((b) => b.dataset.action + ':' + b.textContent.trim())`);
async function press(p, expr, ms, dx = 0) {
  const c = await center(p, expr); if (!c) throw new Error('no element ' + expr);
  await p.mouse.move(c.x, c.y); await p.mouse.down();
  if (dx) { await sleep(150); await p.mouse.move(c.x + dx, c.y, { steps: 4 }); }
  await sleep(ms); await p.mouse.up(); await sleep(150);
}
// a held button: whole row highlighted and the button's progress fill running
async function midHold(p, rowExpr, btnExpr) {
  const c = await center(p, btnExpr); await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(250);
  const s = await ev(p, `(() => { const r = ${rowExpr}, b = ${btnExpr}; return { row: r.classList.contains('held') && r.classList.contains('hp') && getComputedStyle(r).backgroundColor !== 'rgba(0, 0, 0, 0)', btn: b.classList.contains('hp') && getComputedStyle(b).animationName === 'jb-hold-b' }; })()`);
  await p.mouse.move(c.x + 30, c.y, { steps: 3 }); await p.mouse.up(); await sleep(150);
  return s;
}

async function suite(p, tag, root, rowExpr, acts) {
  const btn = (a) => `${rowExpr}.querySelector('.ra-b[data-act="${a}"]')`;
  const sz = await ev(p, `(() => { const b = ${btn('add')}.getBoundingClientRect(); return [b.width, b.height]; })()`);
  check(`${tag}: row buttons are still ≥ 48px`, sz[0] >= 47.5 && sz[1] >= 47.5, J(sz));
  await clear(p); await press(p, btn('add'), 60);
  check(`${tag}: a quick tap on Add to queue does nothing`, J(await plays(p)) === '[]', J(await plays(p)));
  await press(p, btn('add'), 300);
  check(`${tag}: a 300 ms hold does nothing`, J(await plays(p)) === '[]');
  await press(p, btn('add'), 650, 25);
  check(`${tag}: moving the finger more than 10 px cancels the hold`, J(await plays(p)) === '[]');
  await press(p, btn('add'), 650);
  check(`${tag}: holding Add to queue for 500 ms fires it (enqueue add)`, J(await plays(p)) === '["add"]', J(await plays(p)));
  await clear(p); await press(p, btn('next'), 650);
  check(`${tag}: holding Play next fires it (enqueue next)`, J(await plays(p)) === '["next"]', J(await plays(p)));
  await clear(p); await press(p, btn('replace'), 650);
  const asked = await ev(p, `!!${root}.querySelector('.confirm')`);
  check(`${tag}: holding Play now still asks first (nothing played yet)`, asked && J(await plays(p)) === '[]');
  if (asked) { const c = await center(p, `${root}.querySelector('.confirm [data-action="confirm"]')`); await p.mouse.click(c.x, c.y); await sleep(250); }
  check(`${tag}: confirming Play now replaces the queue`, J(await plays(p)) === '["replace"]', J(await plays(p)));
  const s = await midHold(p, rowExpr, btn('next'));
  check(`${tag}: while a button is held, the whole row highlights and the button shows its progress fill`, s.row && s.btn, J(s));
  check(`${tag}: after letting go, the row highlight clears`, !(await ev(p, `${rowExpr}.classList.contains('hp')`)));
  // row hold → menu 5 pop-up
  await clear(p);
  const before = await ev(p, `location.href`);
  await press(p, `${rowExpr}.querySelector('.rt')`, 650);
  const ids = await menuIds(p, root);
  check(`${tag}: holding the row opens the pop-up: ${acts}`, J(ids) === J(acts), J(ids));
  check(`${tag}: the row hold itself plays nothing`, J(await plays(p)) === '[]');
  if (ids.length) { const c = await center(p, `${root}.querySelector('.menu .mi[data-action="next"]')`); await p.mouse.click(c.x, c.y); await sleep(250); }
  check(`${tag}: a normal tap on the pop-up's Play next plays next and closes it`, J(await plays(p)) === '["next"]' && !(await ev(p, `!!${root}.querySelector('.menu')`)), J(await plays(p)));
  await clear(p); await press(p, `${rowExpr}.querySelector('.rt')`, 300, 30);
  check(`${tag}: moving off a row hold cancels it (no pop-up)`, !(await ev(p, `!!${root}.querySelector('.menu')`)) && before === (await ev(p, 'location.href')));
}

for (const [name, vp, q] of [['1024x712', { width: 1080, height: 768 }, '&ha=toolbar&sidebar=narrow'], ['1024x600', { width: 1024, height: 600 }, '']]) {
  // ---- search rows (tracks group) + artist Albums rows ----
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ ...vp, deviceScaleFactor: 1 });
  await p.goto(`${BASE}?fresh=1&latency=20&tab=browse${q}`); await p.waitForFunction('window.__ready === true'); await sleep(500);
  const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.mouse.click(qb.x, qb.y); await sleep(300);
  await p.keyboard.type('EAG', { delay: 50 });
  // the Library search opens on Playlists
  await p.waitForFunction((s) => !!eval(s).querySelector('.row[data-type="playlist"] .ra-b[data-act="add"]'), {}, SV);
  const trow = `${SV}.querySelector('.row[data-type="playlist"]')`;
  const tradio = await ev(p, `!!${trow}.querySelector('.ra-b[data-act="radio"]')`);
  await suite(p, `${name} search playlist row`, SV, trow, ['open:Open', 'add:Add to queue', 'next:Play next', 'replace:Play now', ...(tradio ? ['radio:Start radio'] : []), 'cancel:Cancel']);
  let c = await center(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*artists\\s*$/i.test(x.textContent))`); await p.mouse.click(c.x, c.y);
  await p.waitForFunction((s) => [...eval(s).querySelectorAll('.row[data-type="artist"]')].some((r) => /Eagles/.test(r.textContent)), {}, SV);
  const arow = `[...${SV}.querySelectorAll('.row[data-type="artist"]')].find((r) => /Eagles/.test(r.textContent))`;
  await clear(p); await press(p, `${arow}.querySelector('.rt')`, 650);
  check(`${name} search artist row: hold opens the pop-up with Open first`, J(await menuIds(p, SV)) === J(['open:Open', 'add:Add to queue', 'next:Play next', 'replace:Play now', 'radio:Start radio', 'cancel:Cancel']), J(await menuIds(p, SV)));
  c = await center(p, `${SV}.querySelector('.menu .mi[data-action="cancel"]')`); await p.mouse.click(c.x, c.y); await sleep(200);
  c = await center(p, `${arow}.querySelector('.rt')`); await p.mouse.click(c.x - 40, c.y, { delay: 40 });
  check(`${name} search artist row: a quick tap still opens the artist`, await p.waitForFunction((d) => { try { return eval(d).querySelectorAll('.list.albums .row').length > 0; } catch { return false; } }, {}, DET).then(() => true, () => false));
  const alrow = `${DET}.querySelector('.list.albums .row')`;
  await suite(p, `${name} artist Albums row`, DET, alrow, ['open:Open', 'add:Add to queue', 'next:Play next', 'replace:Play now', 'radio:Start radio', 'cancel:Cancel']);
  await p.close();

  // ---- menu 5: Library tiles (album, station) ----
  const b = await browser.newPage(); await hermetic(b); await b.setViewport({ ...vp, deviceScaleFactor: 1 });
  await b.goto(`${BASE}?layout=separate&fresh=1&latency=20&tab=browse&radio=lib${q}&cfg=${encodeURIComponent(J({ library_home: true }))}`); await b.waitForFunction('window.__ready === true'); await sleep(500);
  c = await center(b, `${BR}.querySelector('.lt[data-tile="album"]')`); await b.mouse.click(c.x, c.y);
  await b.waitForFunction((s) => eval(s).querySelectorAll('.tile').length > 0, {}, BR);
  await press(b, `${BR}.querySelector('.tile')`, 650);
  check(`${name} menu 5 album tile: Open, Add to queue, Play next, Play now, Start radio, Cancel`, J(await menuIds(b, BR)) === J(['open:Open', 'add:Add to queue', 'next:Play next', 'replace:Play now', 'radio:Start radio', 'cancel:Cancel']), J(await menuIds(b, BR)));
  await clear(b); c = await center(b, `${BR}.querySelector('.menu .mi[data-action="replace"]')`); await b.mouse.click(c.x, c.y); await sleep(250);
  check(`${name} menu 5: Play now asks first, then replaces`, (await ev(b, `!!${BR}.querySelector('.confirm')`)) && J(await plays(b)) === '[]');
  c = await center(b, `${BR}.querySelector('.confirm [data-action="confirm"]')`); await b.mouse.click(c.x, c.y); await sleep(250);
  check(`${name} menu 5: confirmed Play now → enqueue replace`, J(await plays(b)) === '["replace"]', J(await plays(b)));
  // stations
  c = await center(b, `${BR}.querySelector('[data-act="home"]')`); await b.mouse.click(c.x, c.y); await sleep(300);
  c = await center(b, `${BR}.querySelector('.lt[data-tile="radio"]')`); await b.mouse.click(c.x, c.y);
  const st = await b.waitForFunction((s) => !!eval(s).querySelector('.tile[data-type="radio"]'), { timeout: 5000 }, BR).then(() => true, () => false);
  if (st) {
    await press(b, `${BR}.querySelector('.tile[data-type="radio"]')`, 650);
    check(`${name} menu 5 station tile: Open and Play now only`, J(await menuIds(b, BR)) === J(['open:Open', 'replace:Play now', 'cancel:Cancel']), J(await menuIds(b, BR)));
  } else check(`${name} menu 5 station tile available`, false, 'no station tile');
  await b.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} hold checks passed`);
process.exit(failures ? 1 : 0);

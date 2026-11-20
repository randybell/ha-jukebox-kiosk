// (#85) Song rows carry no inline play / queue buttons any more. On the Library list, on Library and Search results and on the artist / album /
// playlist pages a tap or a hold on a row opens that item's pop-up (jb-hold-sheet), which keeps its play actions; nothing plays by itself.
// The old card option show_action_icons (true or false) is ignored: the card loads with it, the rows look the same and still carry no buttons.
// 1024x600; touch tap and hold, mouse click and press-and-hold, on-screen and physical keyboard (typing a search, Enter, Esc).
// Usage: node test/row-actions-removed.e2e.mjs (starts its own dev server).
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); };
const J = JSON.stringify;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
const BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const effects = (p) => ev(p, `[...(window.__calls || []).filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => 'play:' + c.data.enqueue),
  ...(window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'ma' && /^player_queues\\//.test(m.command)).map((m) => m.command)]`);
const clear = (p) => ev(p, `window.__calls = []; window.__mark = (window.__ws || []).length`);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const sheetItems = (p) => ev(p, `[...(${HS}.querySelectorAll('.sh .it') || [])].map((b) => b.dataset.action)`);
async function tapAt(p, kind, c) { if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); await sleep(500); }
async function holdAt(p, kind, c, ms = 700) {
  if (kind === 'touch') { await p.touchscreen.touchStart(c.x, c.y); await sleep(ms); await p.touchscreen.touchEnd(); }
  else { await p.mouse.move(c.x, c.y); await p.mouse.down(); await sleep(ms); await p.mouse.up(); }
  await sleep(450);
}
const wait = (p, expr, timeout = 8000) => p.waitForFunction((e) => !!eval(e), { timeout }, expr).then(() => true, () => false);
const clickAt = async (p, expr) => { await ev(p, `${expr}.scrollIntoView({ block: 'center' })`); await sleep(250); const c = await center(p, expr); if (!c) throw new Error('nothing at ' + expr); await p.mouse.click(c.x, c.y); await sleep(700); };
const newPage = async (url, cfg) => {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
  p.on('console', (m) => { if (['warning', 'error'].includes(m.type()) && !/favicon|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
  p.__errs = errs;
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1${url}&cfg=${encodeURIComponent(J(cfg))}`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  return p;
};
const typeOnScreen = async (p, kbExpr, text) => {
  for (const ch of text) { const c = await center(p, `[...${kbExpr}.shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === '${ch}')`); await p.touchscreen.tap(c.x, c.y); await sleep(120); }
  await sleep(500);
};
// any visible inline play / queue button inside a root (the genre / folder arrow, .ra.go, is navigation and is not counted)
const BTNS = (root) => `[...${root}.querySelectorAll('.row .ra-b, .row .ra:not(.go), .row [data-act="add"], .row [data-act="next"], .row [data-act="replace"], .row [data-act="radio"], .row [data-act="more"]')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && x.height > 0 && getComputedStyle(b).display !== 'none'; }).length`;
const openSearch = async (p, text) => {
  const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
  await typeOnScreen(p, `${SV}.querySelector('jb-keyboard')`, text);
};

// each setup: { p, root (where the rows live), row (a track row expr), at (spot to tap) }
const SETUPS = {
  'LIBRARY Tracks': async (cfg) => {
    const p = await newPage('&layout=separate&tab=browse&lhome=0', { library_view: 'rows', ...cfg }); // the dev page defaults to tiles
    await wait(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
    await clickAt(p, `${BR}.querySelector('.cats .fc[data-cat="track"]')`);
    await wait(p, `${BR}.querySelectorAll('.row[data-type="track"]').length > 1`);
    const row = `${BR}.querySelectorAll('.row[data-type="track"]')[1]`;
    return { p, root: BR, row, at: `${row}.querySelector('.rt')` };
  },
  'SEARCH results': async (cfg) => {
    const p = await newPage('&tab=browse', cfg);
    await openSearch(p, 'EAGLES');
    await wait(p, `${SV}.querySelector('.row')`); // the Library search opens on Playlists
    await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*tracks\\s*$/i.test(x.textContent))?.click()`); await sleep(600);
    await wait(p, `${SV}.querySelector('.row[data-type="track"]')`);
    const row = `${SV}.querySelector('.row[data-type="track"]')`;
    return { p, root: SV, row, at: `${row}.querySelector('.rt')` };
  },
};
for (const [name, sel] of [['ARTIST page', 'artist'], ['ALBUM page', 'album'], ['PLAYLIST page', 'playlist']]) {
  SETUPS[name] = async (cfg) => {
    const p = await newPage('&tab=browse', { library_categories: ['playlist', 'artist', 'album', 'track'], ...cfg });
    await openSearch(p, 'EAGLES');
    await wait(p, `${SV}.querySelector('.row')`);
    if (sel !== 'playlist') { await ev(p, `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*${sel}s\\s*$/i.test(x.textContent))?.click()`); await sleep(600); }
    await wait(p, `${SV}.querySelector('.row[data-type="${sel}"]')`);
    await clickAt(p, `${SV}.querySelector('.row[data-type="${sel}"] .rt')`);
    await wait(p, `${SD}?.querySelectorAll('.row[data-type="track"]').length > 0`);
    const row = `${SD}.querySelectorAll('.row[data-type="track"]')[0]`;
    return { p, root: SD, row, at: `${row}.querySelector('.rt')` };
  };
}

const CONFIGS = [['no show_action_icons', {}], ['old show_action_icons: true', { show_action_icons: true }], ['old show_action_icons: false', { show_action_icons: false }]];
for (const name of Object.keys(SETUPS)) {
  // 1. no inline buttons, whatever an old config says; the card loads without a warning
  for (const [ctag, cfg] of CONFIGS) {
    let s; try { s = await SETUPS[name](cfg); } catch (e) { check(`1024x600 ${name} (${ctag}): screen set up`, false, e.message); continue; }
    const n = await ev(s.p, BTNS(s.root));
    const rows = await ev(s.p, `${s.root}.querySelectorAll('.row').length`);
    check(`1024x600 ${name} (${ctag}): rows (${rows}) carry no play or queue buttons (${n})`, rows > 0 && n === 0, `${rows} rows, ${n} buttons`);
    check(`1024x600 ${name} (${ctag}): no warning or error about the old option`, s.p.__errs.length === 0, J(s.p.__errs));
    await s.p.close();
  }
  // 2. tap / click / hold / press-and-hold on a row opens the pop-up with the play actions; Esc closes it; nothing plays
  for (const kind of ['touch', 'mouse']) for (const how of ['tap', 'hold']) {
    const tag = `1024x600 ${name}, ${how === 'tap' ? (kind === 'touch' ? 'tap' : 'click') : (kind === 'touch' ? 'hold' : 'press-and-hold')}`;
    let s; try { s = await SETUPS[name]({}); } catch (e) { check(`${tag}: screen set up`, false, e.message); continue; }
    await ev(s.p, `(${s.row}).scrollIntoView({ block: 'center' })`); await sleep(250);
    await clear(s.p);
    const c = await center(s.p, s.at);
    if (how === 'tap') await tapAt(s.p, kind, c); else await holdAt(s.p, kind, c);
    const items = await sheetItems(s.p);
    check(`${tag}: the item's pop-up opens with its play actions (${items.join(',')})`, (await sheetOpen(s.p)) && items.includes('replace') && items.includes('add'), J(items));
    check(`${tag}: nothing played or queued by itself`, J(await effects(s.p)) === '[]', J(await effects(s.p)));
    await s.p.keyboard.press('Escape'); await sleep(400);
    check(`${tag} + physical Esc: the pop-up closes, nothing played`, !(await sheetOpen(s.p)) && J(await effects(s.p)) === '[]', J(await effects(s.p)));
    await s.p.close();
  }
}
for (const kind of ['touch', 'mouse']) {
  // Albums on an artist page: no buttons or column header; a hold opens the album's pop-up, a tap opens the album
  const tag = `1024x600 artist page Albums row, ${kind}`;
  let s; try { s = await SETUPS['ARTIST page']({}); } catch (e) { check(`${tag}: screen set up`, false, e.message); continue; }
  const row = `${SD}.querySelector('.list.albums .row')`;
  await wait(s.p, row);
  check(`${tag}: no inline buttons and no button column header`, (await ev(s.p, `${row}.querySelectorAll('.ra-b').length`)) === 0 && (await ev(s.p, `${SD}.querySelectorAll('.ahd').length`)) === 0);
  await clear(s.p);
  await holdAt(s.p, kind, await center(s.p, `${row}.querySelector('.rt')`));
  const items = await sheetItems(s.p);
  check(`${tag}: a hold opens the album's pop-up (${items.join(',')}), nothing played`, J(items) === J(['open', 'add', 'next', 'replace', 'radio', 'cancel']) && J(await effects(s.p)) === '[]', J(items));
  await s.p.keyboard.press('Escape'); await sleep(400);
  await tapAt(s.p, kind, await center(s.p, `${row}.querySelector('.rt')`)); await sleep(500);
  check(`${tag}: a tap opens the album page, no pop-up`, (await ev(s.p, `${SV}.querySelector('jb-detail')?.entry?.type`)) === 'album' && !(await sheetOpen(s.p)), J(await ev(s.p, `${SV}.querySelector('jb-detail')?.entry?.type`)));
  await s.p.close();
}
{
  // keyboard: typing a search on a hardware keyboard and Enter still opens the top result (no row buttons involved)
  const p = await newPage('&tab=browse', {});
  const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.touchscreen.tap(qb.x, qb.y); await sleep(300);
  await p.keyboard.type('eagles', { delay: 40 }); await sleep(900);
  check('hardware keyboard: typing a search lists rows with no play or queue buttons', (await ev(p, `${SV}.querySelectorAll('.row').length`)) > 0 && (await ev(p, BTNS(SV))) === 0);
  await p.keyboard.press('Enter'); await sleep(900);
  const topType = await ev(p, `${SD}?.querySelector('.detail')?.dataset.type ?? null`);
  check(`hardware keyboard: Enter opens the top result (${topType}) and plays nothing`, !!topType && (await ev(p, `(window.__calls || []).filter((c) => c.service === 'play_media').length`)) === 0 && !(await sheetOpen(p)), J({ topType, fx: await effects(p), sheet: await sheetOpen(p) }));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} row-actions-removed checks passed`);
process.exit(failures ? 1 : 0);

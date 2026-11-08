// 0.7.11: a quick tap never plays a station. At 1024x600, with the queue empty and with songs, quick-tap every station spot and
// check that no play_media goes out and the hold pop-up never opens from a tap. The genre page station row's Play button is now
// hold-to-fire (progress fill, row lit, scroll cancels) and holding the row opens the same large sheet as a station tile (Open, Play now).
// Usage: node test/station-tap.e2e.mjs (starts its own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const VP = { width: 1024, height: 600, deviceScaleFactor: 1 };
const HS = `__card.shadowRoot.querySelector('jb-hold-sheet').shadowRoot`;
const STN = `__card.shadowRoot.querySelector('jb-station')`;
const SC = `__card.shadowRoot.querySelector('jb-station-confirm').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const plays = (p) => ev(p, `window.__calls.filter((c) => c.domain === 'music_assistant' && c.service === 'play_media').map((c) => c.data.media_type + ':' + c.data.enqueue)`);
const clear = (p) => ev(p, `window.__calls = []`);
const sheetOpen = (p) => ev(p, `!!${HS}.querySelector('.sh')`);
const panelOpen = (p) => ev(p, `(() => { const s = ${STN}; return !!s && !!s.shadowRoot?.querySelector('[data-action="play"]') && s.getBoundingClientRect().width > 0 && getComputedStyle(s).display !== 'none'; })()`);
const confirmOpen = (p) => ev(p, `!!${SC}.querySelector('.confirm')`);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
async function tap(p, expr) { const c = await center(p, expr); if (!c) throw new Error('no element: ' + expr); await sleep(80); await p.mouse.click(c.x, c.y); await sleep(450); }
async function press(p, expr, ms, opts = {}) {
  const c = await center(p, expr); await sleep(80); await p.mouse.move(c.x, c.y); await p.mouse.down();
  if (opts.scroll) { await sleep(150); await ev(p, `${opts.scroll}.scrollTop += 60`); }
  if (opts.mid) { await sleep(250); opts.midState = await ev(p, opts.mid); await sleep(ms - 250); } else await sleep(ms);
  await p.mouse.up(); await sleep(300); return opts.midState;
}
async function open(q) {
  const p = await browser.newPage(); await hermetic(p); await p.setViewport(VP);
  await p.goto(`${BASE}?fresh=1&latency=20${q}`); await p.waitForFunction('window.__ready === true'); await sleep(500); await clear(p); return p;
}
async function closePanel(p) { if (await panelOpen(p)) { await tap(p, `${STN}.shadowRoot.querySelector('[data-action="close"]')`); } }
// a quick tap: nothing plays, no hold pop-up; `panel` = whether the station panel should open
async function quick(p, tag, what, expr, panel) {
  await clear(p); await tap(p, expr);
  const r = { plays: await plays(p), sheet: await sheetOpen(p), panel: await panelOpen(p), confirm: await confirmOpen(p) };
  check(`${tag} ${what}: a quick tap plays nothing and opens no hold pop-up${panel === true ? ' (opens the station panel)' : panel === false ? ' (no station panel)' : ''}`,
    J(r.plays) === '[]' && !r.sheet && !r.confirm && (panel === undefined || r.panel === panel), J(r));
  await closePanel(p);
  return r;
}

for (const [tag, idle] of [['[queue has songs]', ''], ['[queue empty]', '&idle=1']]) {
  // ---- Library > Radio tiles (My stations), separate layout ----
  {
    const p = await open(`&layout=separate&kiosk=1&tab=browse&lhome=0&radio=lib${idle}`);
    const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
    await p.evaluate((b) => [...eval(b).querySelectorAll('[data-cat="radio"]')][0]?.click(), BR);
    await p.waitForFunction((b) => !!eval(b).querySelector('.tile[data-type="radio"]'), { timeout: 5000 }, BR);
    await quick(p, tag, 'Library > Radio station tile', `${BR}.querySelector('.tile[data-type="radio"]')`, true);
    if (!idle) { // the panel's Play still asks first when the queue has songs
      await tap(p, `${BR}.querySelector('.tile[data-type="radio"]')`); await clear(p);
      await tap(p, `${STN}.shadowRoot.querySelector('[data-action="play"]')`);
      check(`${tag} station panel Play: asks "This will replace your queue" first, nothing played`, (await confirmOpen(p)) && J(await plays(p)) === '[]', J(await plays(p)));
    }
    await p.close();
  }
  // ---- Library Discover strips: Recently played, Favorite radio, Stations for you (the Recently played row at the Library top was removed in 0.7.9) ----
  {
    const p = await open(`&layout=separate&kiosk=1&tab=browse&lhome=0&pods=1&radio=1${idle}&cfg=${encodeURIComponent(J({ discover: ['recently_played', 'favorite_radio', 'mock_stream--XXXXXXXX:stations_for_you'] }))}`);
    const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
    const ok = await p.waitForFunction((b) => [...eval(b).querySelectorAll('.hs .tile')].some((t) => /:\/\/radio\//.test(t.dataset.uri) || t.dataset.type === 'radio'), { timeout: 8000 }, BR).then(() => true, () => false);
    const strips = await ev(p, `[...${BR}.querySelectorAll('.hs')].map((h, i) => [i, [...h.querySelectorAll('.tile')].filter((t) => /:\\/\\/radio\\//.test(t.dataset.uri) || t.dataset.type === 'radio').length]).filter((x) => x[1])`);
    check(`${tag} Discover shows station tiles in its strips`, ok && strips.length > 0, J(strips));
    for (const [i] of strips) {
      const name = await ev(p, `(${BR}.querySelectorAll('.hs')[${i}].closest('[data-key]')?.dataset.key) || 'strip ${i}'`);
      await quick(p, tag, `Discover "${name}" station tile`, `[...${BR}.querySelectorAll('.hs')[${i}].querySelectorAll('.tile')].find((t) => /:\\/\\/radio\\//.test(t.dataset.uri) || t.dataset.type === 'radio')`);
    }
    await p.close();
  }
  // ---- Search: station row and its Play button ----
  {
    const p = await open(`&layout=separate&kiosk=1&tab=search&radio=1&stations=fake${idle}`);
    const SV = `__card.shadowRoot.querySelector('jb-search')`;
    await ev(p, `${SV}.setQuery('mockingbird')`);
    await p.waitForFunction((s) => [...eval(s).shadowRoot.querySelectorAll('.row')].some((r) => r.dataset.group === 'radio'), {}, SV); await sleep(200);
    const row = `[...${SV}.shadowRoot.querySelectorAll('.row')].find((r) => r.dataset.group === 'radio')`;
    await quick(p, tag, 'Search station row', `${row}.querySelector('.rt')`, true);
    await quick(p, tag, 'Search station row Play button', `${row}.querySelector('[data-act="replace"]')`, false);
    await p.close();
  }
  // ---- Genre page: a Stations section (injected) ----
  {
    const p = await open(`&kiosk=1&tab=browse&radio=1${idle}`);
    const SV = `__card.shadowRoot.querySelector('jb-search')`;
    await p.evaluate(() => __card.shadowRoot.querySelector('jb-search').browse.openDetail({ uri: 'library://genre/1', name: 'Mock Jazz', media_type: 'genre', item_id: '1', provider: 'library' }, 'genre'));
    const DE = `${SV}.browse.shadowRoot.querySelector('jb-detail')`, DD = `${DE}.shadowRoot`;
    await p.waitForFunction((d) => { try { return !eval(d).entry.data.loading; } catch { return false; } }, { timeout: 6000 }, DE);
    // the mock genre has no stations: add a Stations section with the mock's stations
    const st = ['Lakeside Jazz 101', 'Mock FM', 'Night Owl Radio'].map((name, i) => ({ media_type: 'radio', uri: `radiobrowser://radio/mock-${i}`, name, provider: 'radiobrowser', item_id: `mock-${i}` }));
    await p.evaluate((st, d) => { const det = eval(d); const data = det.entry.data; det.entry.data = { ...data, sections: [...data.sections, { type: 'radio', title: 'Stations', items: st.slice(0, 3) }] }; det.requestUpdate(); }, st, DE);
    await sleep(400);
    const has = await ev(p, `!!${DD}.querySelector('.list.sec[data-sec="radio"] .row')`);
    check(`${tag} genre page shows a Stations section`, has);
    if (has) {
      await clear(p);
      const row = `${DD}.querySelector('.list.sec[data-sec="radio"] .row')`, btn = `${row}.querySelector('.ra-b[data-act="replace"]')`;
      const sz = await ev(p, `(() => { const b = ${btn}; const r = b.getBoundingClientRect(); return { hold: b.classList.contains('hold'), w: r.width, h: r.height, label: b.textContent.trim() }; })()`);
      check(`${tag} genre station Play button is a hold button, same size as before (≥ 72x56, "Play")`, sz.hold && sz.w >= 72 && sz.h >= 56 && sz.label === 'Play', J(sz));
      const r = await quick(p, tag, 'genre station row', `${row}.querySelector('.rt')`, false);
      check(`${tag} genre station row tap only highlights it`, await ev(p, `${row}.classList.contains('sel')`));
      await quick(p, tag, 'genre station row Play button', btn, false);
      await clear(p); await press(p, btn, 300);
      check(`${tag} genre station Play: a 300 ms hold does nothing`, J(await plays(p)) === '[]' && !(await confirmOpen(p)));
      await press(p, btn, 650, { scroll: `${DD}.querySelector('.scroll')` });
      check(`${tag} genre station Play: scrolling during the hold cancels it`, J(await plays(p)) === '[]' && !(await confirmOpen(p)), J(await plays(p)));
      const mid = await press(p, btn, 650, { mid: `(() => { const r = ${row}, b = ${btn}; return r.classList.contains('held') && r.classList.contains('hp') && b.classList.contains('hp') && getComputedStyle(b).animationName === 'jb-hold-b'; })()` });
      const asked = await confirmOpen(p), pl = await plays(p);
      check(`${tag} genre station Play: while held the row lights and the button fills; 500 ms fires it (${idle ? 'plays: queue empty' : 'asks first: queue has songs'})`,
        mid && (idle ? !asked && J(pl) === '["radio:replace"]' : asked && J(pl) === '[]'), J({ mid, asked, pl }));
      if (asked) { await tap(p, `${SC}.querySelector('[data-action="confirm"]')`); check(`${tag} genre station Play: Replace plays it`, J(await plays(p)) === '["radio:replace"]', J(await plays(p))); }
      await clear(p); await press(p, `${row}.querySelector('.rt')`, 650);
      const ids = await ev(p, `[...${HS}.querySelectorAll('.it')].map((b) => b.dataset.action)`);
      check(`${tag} holding the genre station row opens the large sheet: Open, Play now, Cancel; the finger-lift plays nothing`, (await sheetOpen(p)) && J(ids) === J(['open', 'replace', 'cancel']) && J(await plays(p)) === '[]', J(ids));
      if (ids.length) { await tap(p, `${HS}.querySelector('.it[data-action="open"]')`); check(`${tag} the sheet's Open shows the station panel, nothing plays`, (await panelOpen(p)) && J(await plays(p)) === '[]'); await closePanel(p); }
    }
    await p.close();
  }
}
await browser.close();
console.log(`\n${total - failures}/${total} station-tap checks passed`);
process.exit(failures ? 1 : 0);

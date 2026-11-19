// #46 search filters (Randy: "If you click on the genre 'Country' then it adds filter genre = 'country'"). Tapping a genre applies a genre
// filter; it opens no page. MA filters library items by genre itself (music/<type>/library_items with genre = the genre's item id, the call
// and parameter MA's own Library views use), so the card asks MA the same way. Checks, at 1024x600 and 460x800 (editor-preview width), touch and mouse:
//  - genre rows show a "Filter" label (no open arrow), aria-label "Filter by genre <name>", every genre row >= 48px tall
//  - tapping a genre in the Library's Genres list, in typed genre results, and in the separate Library tab applies a "Genre: <name>" chip
//    and a labeled "Clear filters" button, both >= 48px; no detail page opens; the words typed to find the genre are cleared
//  - the results come from music/{artists,albums,tracks}/library_items with genre = the genre's item id (and search = the words once typed)
//  - typing searches inside the genre (search arg sent); the chip and Clear filters remove the filter and the Library list comes back
// Usage: node test/genre-filter.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes screenshots.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); };
const J = JSON.stringify;
const SHOTS = process.env.SHOTS;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const BRC = `${SV}.querySelector('jb-browse').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const rect = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, expr);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function tapAt(p, kind, c) { if (kind === 'touch') await p.touchscreen.tap(c.x, c.y); else await p.mouse.click(c.x, c.y); }
const newPage = async (url, vp) => {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ ...vp, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1${url}`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  return p;
};
const calls = (p) => ev(p, `JSON.stringify(window.__genreCalls ?? [])`).then(JSON.parse);
const chipState = (p, root) => ev(p, `(() => { const r = ${root}; const c = r.querySelector('.scope .sc[data-scope="genre"]'); const x = r.querySelector('.scope [data-action="clear-filters"]');
  const b = (e) => e ? { t: e.innerText.replace(/\\s+/g, ' ').trim(), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width } : null; return JSON.stringify({ chip: b(c), clear: b(x) }); })()`).then(JSON.parse);
const KB = `${SV}.querySelector('jb-keyboard').shadowRoot`;

for (const vp of [{ width: 1024, height: 600 }, { width: 460, height: 800 }]) for (const kind of ['touch', 'mouse']) {
  const tag = `${vp.width}x${vp.height} ${kind === 'touch' ? 'tap' : 'click'}`;
  // ---- combined Library tab: Genres list ----
  const p = await newPage('&tab=browse', vp);
  await tapAt(p, kind, await rect(p, `${SV}.querySelector('.lcats .lc[data-lcat="genre"]')`)); await sleep(900);
  await p.waitForFunction((b) => !!eval(b)?.querySelector('[data-type="genre"]'), { timeout: 8000 }, BRC);
  const rows = await ev(p, `JSON.stringify([...${BRC}.querySelectorAll('[data-type="genre"]')].map((r) => ({ a: r.getAttribute('aria-label'), f: r.querySelector('.gf')?.textContent.trim() ?? '', open: !!r.querySelector('.mo, .open, .go'), h: r.getBoundingClientRect().height })))`).then(JSON.parse);
  check(`${tag} Library > Genres: every genre reads "Filter" with aria-label "Filter by genre …", no open arrow`, rows.length > 0 && rows.every((r) => r.f === 'Filter' && /^Filter by genre /.test(r.a) && !r.open), J(rows.slice(0, 3)));
  check(`${tag} Library > Genres: every genre target is at least 48px`, rows.every((r) => r.h >= 48), J(rows.map((r) => r.h)));
  const G = `${BRC}.querySelector('[data-type="genre"]')`;
  const gname = await ev(p, `${G}.querySelector('b').textContent.trim()`);
  const before = (await calls(p)).length;
  await ev(p, `${G}.scrollIntoView({ block: 'center' })`); await sleep(200);
  await tapAt(p, kind, await rect(p, G)); await sleep(1200);
  const cs = await chipState(p, SV);
  check(`${tag} tap a genre: "Genre: ${gname}" chip and a "Clear filters" button show, both at least 48px`, cs.chip?.t === `Genre: ${gname}` && cs.clear?.t === 'Clear filters' && cs.chip.h >= 48 && cs.clear.h >= 48, J(cs));
  check(`${tag} tap a genre: no detail page opens`, !(await ev(p, `!!${SV}.querySelector('jb-detail') || !!${BRC}.querySelector('jb-detail')`)));
  const c1 = (await calls(p)).slice(before);
  const gid = await ev(p, `(() => { const s = ${SV}.querySelector('.scope .sc[data-scope="genre"]'); return s ? 1 : 0; })()`);
  const types = [...new Set(c1.map((c) => c.command))].sort();
  check(`${tag} tap a genre: results come from MA music/{artists,albums,tracks}/library_items with genre = the genre's item id (no search words)`,
    gid && J(types) === J(['music/albums/library_items', 'music/artists/library_items', 'music/tracks/library_items']) && c1.every((c) => Number.isFinite(c.args.genre) && !('search' in c.args)), J(c1));
  const status = await ev(p, `${SV}.querySelector('.qmeta')?.textContent.replace(/\\s+/g, ' ').trim()`);
  check(`${tag} tap a genre: status says what is shown ("… in ${gname} · type to search inside it")`, status.includes(`in ${gname} · type to search inside it`), status);
  const res = await ev(p, `${SV}.querySelectorAll('.res .row').length`);
  check(`${tag} tap a genre: the genre's items are listed`, res > 0, res);
  await shot(p, `genre-applied-${vp.width}-${kind}`);
  // typing searches inside the genre (MA search + genre)
  const b2 = (await calls(p)).length;
  await p.keyboard.type('mo'); await sleep(1500);
  const c2 = (await calls(p)).slice(b2);
  check(`${tag} typing with a genre filter: MA library_items gets genre and search = the words`, c2.length > 0 && c2.every((c) => Number.isFinite(c.args.genre) && typeof c.args.search === 'string') && c2.at(-1).args.search.toLowerCase() === 'mo', J(c2));
  const cs2 = await chipState(p, SV);
  check(`${tag} typing with a genre filter: the genre chip stays`, cs2.chip?.t === `Genre: ${gname}`, J(cs2));
  // the chip removes the filter
  await tapAt(p, kind, await rect(p, `${SV}.querySelector('.scope .sc[data-scope="genre"]')`)); await sleep(700);
  check(`${tag} the genre chip removes the filter`, !(await chipState(p, SV)).chip, J(await chipState(p, SV)));
  await p.close();
}

// ---- typed genre search results, then Clear filters ----
for (const kind of ['touch', 'mouse']) {
  const p = await newPage('&tab=browse', { width: 1024, height: 600 });
  await tapAt(p, kind, await rect(p, `${SV}.querySelector('.lcats .lc[data-lcat="genre"]')`)); await sleep(700);
  await p.keyboard.type('mock'); await sleep(1500);
  const R = `${SV}.querySelector('.res .row[data-group="genres"]')`;
  await p.waitForFunction((r) => !!eval(r), { timeout: 8000 }, R);
  const row = await ev(p, `JSON.stringify({ f: ${R}.querySelector('.gf')?.textContent.trim(), open: !!${R}.querySelector('.go'), a: ${R}.getAttribute('aria-label'), h: ${R}.getBoundingClientRect().height })`).then(JSON.parse);
  check(`1024x600 ${kind} typed Genres results: rows read "Filter", no open arrow, >= 48px`, row.f === 'Filter' && !row.open && /^Filter by genre /.test(row.a) && row.h >= 48, J(row));
  const name = await ev(p, `${R}.querySelector('b').textContent.trim()`);
  await tapAt(p, kind, await rect(p, R)); await sleep(1200);
  const cs = await chipState(p, SV);
  check(`1024x600 ${kind} tap a typed genre result: "Genre: ${name}" chip, the search words are cleared`, cs.chip?.t === `Genre: ${name}` && (await ev(p, `${SV}.querySelector('.q').dataset.query`)) === '', J(cs));
  await tapAt(p, kind, await rect(p, `${SV}.querySelector('.scope [data-action="clear-filters"]')`)); await sleep(800);
  check(`1024x600 ${kind} Clear filters removes the genre filter and the Library list is back`, !(await chipState(p, SV)).chip && (await ev(p, `!${SV}.querySelector('.lib')?.hidden`)), J(await chipState(p, SV)));
  await shot(p, `genre-cleared-${kind}`);
  await p.close();
}

// ---- separate Library tab: a genre tap filters the Search tab ----
{
  const cfg = encodeURIComponent(J({ library_categories: ['playlist', 'artist', 'track', 'genre', 'radio'] }));
  const p = await newPage(`&layout=separate&tab=browse&lhome=0&cfg=${cfg}`, { width: 1024, height: 600 });
  const BR = `__card.shadowRoot.querySelector('jb-browse').shadowRoot`;
  const has = await ev(p, `!!${BR}.querySelector('.cats .fc[data-cat="genre"]')`);
  if (has) {
    await ev(p, `${BR}.querySelector('.cats .fc[data-cat="genre"]').click()`); await sleep(900);
    await p.waitForFunction((b) => !!eval(b).querySelector('[data-type="genre"]'), { timeout: 8000 }, BR);
    const G = `${BR}.querySelector('[data-type="genre"]')`;
    const name = await ev(p, `${G}.querySelector('b').textContent.trim()`);
    await tapAt(p, 'touch', await rect(p, G)); await sleep(1300);
    const tab = await ev(p, `__card._tab`);
    const cs = await chipState(p, SV);
    check(`separate layout: a genre tapped in Library opens Search filtered by it ("Genre: ${name}")`, tab === 'search' && cs.chip?.t === `Genre: ${name}`, J({ tab, cs }));
  } else check('separate layout: Library shows a Genres button (library_categories default)', false, 'no Genres button');
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} genre-filter checks passed`);
process.exit(failures ? 1 : 0);

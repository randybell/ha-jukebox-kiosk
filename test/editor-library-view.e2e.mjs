// #146: per-section Tiles / Rows settings (no master library_view), Tiles across 1–8 always shown.
// Usage: node test/editor-library-view.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes the screenshot.
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devRoot } from './serve.mjs';

const ROOT = await devRoot();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); };
const J = JSON.stringify;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const base = { type: 'custom:jukebox-card', entity: 'media_player.everywhere' };
const VIEWS = ['view_playlist', 'view_artist', 'view_track', 'view_genre', 'view_radio', 'view_album', 'view_podcast', 'view_audiobook', 'view_queue', 'view_discover', 'view_artist_page', 'view_album_page', 'view_playlist_page', 'view_search'];
const NAMES = { view_playlist: 'Playlists', view_artist: 'Artists', view_track: 'Tracks', view_genre: 'Genres', view_radio: 'Radio', view_album: 'Albums', view_podcast: 'Podcasts', view_audiobook: 'Audiobooks', view_queue: 'Queue', view_discover: 'Discover', view_artist_page: 'Artist page', view_album_page: 'Album page', view_playlist_page: 'Playlist page', view_search: 'Search results' };
const LABELS = Object.fromEntries(Object.entries(NAMES).map(([k, v]) => [k, `Show ${v} as`]));
const open = async (cfg) => {
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 900, height: 1500, deviceScaleFactor: 1 });
  await p.goto(`${ROOT}editor.html?fresh=1&cfg=${encodeURIComponent(J(cfg))}`);
  await p.waitForFunction('window.__editor && __editor.shadowRoot && __editor.shadowRoot.querySelector("ha-form")', { timeout: 8000 }); await sleep(600);
  return p;
};
const F = `__editor.shadowRoot.querySelector('ha-form')`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const lib = (p) => ev(p, `[...${F}.querySelectorAll('details[data-section=library] [data-name]')].map((e) => e.dataset.name)`);
const lastChange = async (p) => (await ev(p, `__changes`)).at(-1) ?? {};
const pick = async (p, name, value) => { await ev(p, `(() => { const s = ${F}.querySelector('[data-name=${name}] select'); s.value = ${J(value)}; s.dispatchEvent(new Event('change')); })()`); await sleep(300); };
const setNum = async (p, name, value) => { await ev(p, `(() => { const i = ${F}.querySelector('[data-name=${name}] input'); i.value = ${J(String(value))}; i.dispatchEvent(new Event('change')); })()`); await sleep(300); };

{
  const p = await open(base);
  const l = await lib(p);
  check('no master library_view field', !l.includes('library_view') && !l.includes('library_views'), J(l));
  check('the 14 section fields sit right after the category buttons, before Tiles across',
    VIEWS.every((n, i) => l.indexOf(n) === l.indexOf('library_categories') + 1 + i) && l.indexOf('library_columns') === l.indexOf(VIEWS.at(-1)) + 1, J(l));
  check('Tiles across is always shown (rows by default)', l.includes('library_columns'), J(l));
  const fields = await ev(p, `(() => { const out = {};
    for (const n of ${J(VIEWS)}) {
      const r = ${F}.querySelector('[data-name=' + n + ']');
      const s = r.querySelector('select');
      out[n] = { label: r.querySelector('span').textContent.trim(), value: s.value, opts: [...s.options].map((o) => o.value + '=' + o.textContent.trim()) };
    }
    const c = ${F}.querySelector('[data-name=library_columns]');
    const i = c.querySelector('input');
    out.cols = { label: c.querySelector('span').textContent.trim(), type: i.type, value: i.value, min: i.min, max: i.max, desc: [...c.querySelectorAll('span, p, small, .ha-form-help, .helper')].map((x) => x.textContent.trim()) };
    return out;
  })()`);
  const wantVal = (n) => (['view_playlist', 'view_album', 'view_radio'].includes(n) ? 'tiles' : 'rows');
  const mismatches = VIEWS.filter((n) => !(fields[n].value === wantVal(n) && fields[n].opts.join() === 'rows=Rows,tiles=Tiles' && fields[n].label === LABELS[n])).map((n) => ({ n, got: fields[n], want: { label: LABELS[n], value: wantVal(n) } }));
  check('each section is a dropdown labelled in plain words (Show <section> as), options exactly Rows and Tiles; Playlists, Albums and Radio start as Tiles, the rest as Rows', mismatches.length === 0, J(mismatches.length ? mismatches : { sample: fields.view_playlist, album: fields.view_album, queue: fields.view_queue, labels: Object.fromEntries(VIEWS.map((n) => [n, fields[n].label + '=' + fields[n].value])) }));
  check('Tiles across: a number box, shown as 3, labelled only "Tiles across"',
    fields.cols.type === 'number' && fields.cols.value === '3' && fields.cols.label === 'Tiles across', J(fields.cols));
  if (process.env.SHOTS) { await ev(p, `${F}.querySelector('details[data-section=library]').scrollIntoView()`); await p.screenshot({ path: `${process.env.SHOTS}/146-editor-library-views.png` }); }
  await ev(p, `__changes.length = 0`);
  await pick(p, 'view_playlist', 'rows');
  const c1 = await lastChange(p);
  check('choosing Rows on Playlists writes library_views.playlist: rows (differs from the Tiles default) and does not write library_view',
    c1.library_views?.playlist === 'rows' && !('library_view' in c1) && !VIEWS.some((n) => n in c1), J(c1));
  await ev(p, `__changes.length = 0`);
  await setNum(p, 'library_columns', 5);
  const c2 = await lastChange(p);
  check('typing 5 writes library_columns: 5, Playlists stay rows', c2.library_columns === 5 && c2.library_views?.playlist === 'rows', J(c2));
  await setNum(p, 'library_columns', 9);
  check('typing 9 is clamped to 8', (await lastChange(p)).library_columns === 8, J(await lastChange(p)));
  await setNum(p, 'library_columns', 0);
  check('typing 0 is clamped to 1', (await lastChange(p)).library_columns === 1, J(await lastChange(p)));
  await setNum(p, 'library_columns', 8);
  check('typing 8 stays 8', (await lastChange(p)).library_columns === 8, J(await lastChange(p)));
  await setNum(p, 'library_columns', 3.4);
  check('typing 3.4 becomes 3', (await lastChange(p)).library_columns === 3, J(await lastChange(p)));
  await p.close();
}
{
  const p = await open({ ...base, library_view: 'tiles', library_columns: 4 });
  const v = await ev(p, `({ playlist: ${F}.querySelector('[data-name=view_playlist] select').value, album: ${F}.querySelector('[data-name=view_album] select').value, artist: ${F}.querySelector('[data-name=view_artist] select').value, queue: ${F}.querySelector('[data-name=view_queue] select').value, discover: ${F}.querySelector('[data-name=view_discover] select').value, cols: ${F}.querySelector('[data-name=library_columns] input').value })`);
  check('YAML library_view: tiles + library_columns: 4: Library tops show Tiles (leftover), Queue and Discover stay Rows (their defaults), columns 4',
    v.playlist === 'tiles' && v.album === 'tiles' && v.artist === 'tiles' && v.queue === 'rows' && v.discover === 'rows' && v.cols === '4', J(v));
  await ev(p, `__changes.length = 0`);
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=screensaver_lyrics] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const c = await lastChange(p);
  check('an unrelated edit leaves leftover library_view alone and does not copy it into library_views, keeps columns',
    c.library_view === 'tiles' && !('library_views' in c) && c.library_columns === 4 && c.screensaver_lyrics === false, J(c));
  await p.close();
}
{
  const p = await open(base);
  await ev(p, `__changes.length = 0`);
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=screensaver_lyrics] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const c = await lastChange(p);
  check('an unrelated edit on a fresh config writes neither library_view nor library_views nor library_columns',
    !('library_view' in c) && !('library_views' in c) && !('library_columns' in c), J(c));
  await p.close();
}
{
  // 0.8.3 #97: the "Large buttons" option is gone. A saved config that still has large_buttons loads without errors or console warnings,
  // the editor shows no field for it, and an edit in the editor does not choke on it.
  const msgs = [];
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 900, height: 1500, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => msgs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (['warning', 'warn', 'error'].includes(m.type())) msgs.push(m.type() + ': ' + m.text()); });
  await p.goto(`${ROOT}editor.html?fresh=1&cfg=${encodeURIComponent(J({ ...base, large_buttons: true }))}`);
  await p.waitForFunction('window.__editor && __editor.shadowRoot && __editor.shadowRoot.querySelector("ha-form")', { timeout: 8000 }); await sleep(600);
  const names = await ev(p, `[...${F}.querySelectorAll('[data-name]')].map((e) => e.dataset.name)`);
  const text = await ev(p, `__editor.shadowRoot.textContent`);
  check('large_buttons in a saved config: the editor loads with no field and no "Large buttons" text', !names.includes('large_buttons') && !/large buttons/i.test(text), J(names));
  await ev(p, `__changes.length = 0`);
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=screensaver_lyrics] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const c = await lastChange(p);
  check('large_buttons in a saved config: an editor edit still works', c.screensaver_lyrics === false && c.entity === 'media_player.everywhere', J(c));
  check('large_buttons in a saved config: no errors or console warnings', msgs.length === 0, J(msgs));
  await p.close();
}
{
  // #139: the "Turn repeat one back into repeat all" option is gone. A saved config that still has
  // coerce_repeat_one loads without errors or console warnings, the editor shows no field for it, and an edit does not write it back.
  const msgs = [];
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 900, height: 1500, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => msgs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (['warning', 'warn', 'error'].includes(m.type())) msgs.push(m.type() + ': ' + m.text()); });
  await p.goto(`${ROOT}editor.html?fresh=1&cfg=${encodeURIComponent(J({ ...base, coerce_repeat_one: false }))}`);
  await p.waitForFunction('window.__editor && __editor.shadowRoot && __editor.shadowRoot.querySelector("ha-form")', { timeout: 8000 }); await sleep(600);
  const names = await ev(p, `[...${F}.querySelectorAll('[data-name]')].map((e) => e.dataset.name)`);
  const text = await ev(p, `__editor.shadowRoot.textContent`);
  check('coerce_repeat_one in a saved config: the editor loads with no field and no "repeat one" text', !names.includes('coerce_repeat_one') && !/repeat one/i.test(text), J(names));
  await ev(p, `__changes.length = 0`);
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=screensaver_lyrics] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const c = await lastChange(p);
  check('coerce_repeat_one in a saved config: an editor edit does not write it back', !('coerce_repeat_one' in c) && c.screensaver_lyrics === false && c.entity === 'media_player.everywhere', J(c));
  check('coerce_repeat_one in a saved config: no errors or console warnings', msgs.length === 0, J(msgs));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} editor-library-view checks passed`);
process.exit(failures ? 1 : 0);

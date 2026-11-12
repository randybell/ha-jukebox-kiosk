// 0.7.20: the card editor's two new Library options, library_view (rows | tiles) and library_columns (2 to 6, shown only while tiles is chosen).
// Same controls and place as the other Library settings (select dropdown like Library layout; number box like Items per Library page), plain wording.
// Shown values: rows / 3 when unset; untouched shown defaults are not written back; YAML values load; edits write only what changed; columns clamp to 2..6.
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
  check('Library section: library_view sits right after the category buttons, before the Library home options', l.indexOf('library_view') === l.indexOf('library_categories') + 1 && l.indexOf('library_view') < l.indexOf('library_home'), J(l));
  check('unset: library_columns is not shown (rows)', !l.includes('library_columns'), J(l));
  const f = await ev(p, `(() => { const r = ${F}.querySelector('[data-name=library_view]'); const s = r.querySelector('select'); const ly = ${F}.querySelector('[data-name=library_layout]');
    return { label: r.querySelector('span').textContent, value: s.value, opts: [...s.options].map((o) => o.value + '=' + o.textContent), sameKind: !!ly.querySelector('select') }; })()`);
  check('library_view: a dropdown (like Library layout), shown as Rows, with plain Rows / Tiles choices', f.sameKind && f.value === 'rows' && f.opts.length === 2 && /^rows=Rows/.test(f.opts[0]) && /^tiles=Tiles/.test(f.opts[1]) && /rows or tiles/i.test(f.label), J(f));
  if (process.env.SHOTS) { await ev(p, `${F}.querySelector('details[data-section=library]').scrollIntoView()`); await p.screenshot({ path: `${process.env.SHOTS}/0720-editor-library-rows.png` }); }
  await ev(p, `__changes.length = 0`);
  await pick(p, 'library_view', 'tiles');
  const c1 = await lastChange(p);
  check('choosing Tiles writes library_view: tiles and nothing else', c1.library_view === 'tiles' && !('library_columns' in c1) && Object.keys(c1).filter((k) => !(k in base)).join() === 'library_view', J(c1));
  const l2 = await lib(p);
  check('with tiles chosen, library_columns appears right after library_view', l2.indexOf('library_columns') === l2.indexOf('library_view') + 1, J(l2));
  const g = await ev(p, `(() => { const r = ${F}.querySelector('[data-name=library_columns]'); const i = r.querySelector('input'); return { label: r.querySelector('span').textContent, type: i.type, value: i.value }; })()`);
  check('library_columns: a number box (like Items per Library page), shown as 3 when unset, labelled in plain words', g.type === 'number' && g.value === '3' && /columns/i.test(g.label), J(g));
  if (process.env.SHOTS) { await ev(p, `${F}.querySelector('details[data-section=library]').scrollIntoView()`); await p.screenshot({ path: `${process.env.SHOTS}/0720-editor-library-tiles.png` }); }
  await setNum(p, 'library_columns', 5);
  const c2 = await lastChange(p);
  check('typing 5 writes library_columns: 5, library_view stays tiles', c2.library_columns === 5 && c2.library_view === 'tiles', J(c2));
  await setNum(p, 'library_columns', 9);
  check('typing 9 is clamped to 6', (await lastChange(p)).library_columns === 6, J(await lastChange(p)));
  await setNum(p, 'library_columns', 0);
  check('typing 0 is clamped to 2', (await lastChange(p)).library_columns === 2, J(await lastChange(p)));
  await setNum(p, 'library_columns', 3.4);
  check('typing 3.4 becomes 3', (await lastChange(p)).library_columns === 3, J(await lastChange(p)));
  await pick(p, 'library_view', 'rows');
  const l3 = await lib(p);
  check('switching back to Rows hides library_columns again', !l3.includes('library_columns') && (await lastChange(p)).library_view === 'rows', J({ l3, c: await lastChange(p) }));
  await p.close();
}
{
  const p = await open({ ...base, library_view: 'tiles', library_columns: 4 });
  const v = await ev(p, `({ view: ${F}.querySelector('[data-name=library_view] select').value, cols: ${F}.querySelector('[data-name=library_columns] input').value })`);
  check('YAML library_view: tiles + library_columns: 4 load as Tiles / 4', v.view === 'tiles' && v.cols === '4', J(v));
  await ev(p, `__changes.length = 0`);
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=coerce_repeat_one] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const c = await lastChange(p);
  check('an unrelated edit keeps both YAML values', c.library_view === 'tiles' && c.library_columns === 4 && c.coerce_repeat_one === false, J(c));
  await p.close();
}
{
  // an unrelated edit on a fresh config does not write the shown defaults (rows, 3)
  const p = await open(base);
  await ev(p, `__changes.length = 0`);
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=coerce_repeat_one] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const c = await lastChange(p);
  check('an unrelated edit does not write library_view / library_columns', !('library_view' in c) && !('library_columns' in c), J(c));
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
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=coerce_repeat_one] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const c = await lastChange(p);
  check('large_buttons in a saved config: an editor edit still works', c.coerce_repeat_one === false && c.entity === 'media_player.everywhere', J(c));
  check('large_buttons in a saved config: no errors or console warnings', msgs.length === 0, J(msgs));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} editor-library-view checks passed`);
process.exit(failures ? 1 : 0);

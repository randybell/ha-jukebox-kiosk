// 0.7.14 (#80) added the card editor's "Show Action Icons" switch. 0.7.20 (Randy: "disable action buttons ... hide the option in the config"):
// the option stays in YAML (show_action_icons, default OFF, true shows the row buttons) but the SWITCH IS GONE from the card setup screen.
// Checks: no field/label for it anywhere in the editor; the other Display toggles are untouched and still in order; a YAML show_action_icons: true
// (or false) survives any edit made in the editor; the card still refuses a non-boolean value.
// Usage: node test/editor-action-icons.e2e.mjs (starts its own dev server). SHOTS=<dir> also writes a screenshot.
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
  const p = await browser.newPage(); await hermetic(p); await p.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 });
  await p.goto(`${ROOT}editor.html?fresh=1&cfg=${encodeURIComponent(J(cfg))}`);
  await p.waitForFunction('window.__editor && __editor.shadowRoot && __editor.shadowRoot.querySelector("ha-form")', { timeout: 8000 }); await sleep(600);
  return p;
};
const F = `__editor.shadowRoot.querySelector('ha-form')`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);

for (const [tag, cfg] of [['missing', base], ['true in YAML', { ...base, show_action_icons: true }], ['false in YAML', { ...base, show_action_icons: false }]]) {
  const p = await open(cfg);
  const all = await ev(p, `[...${F}.querySelectorAll('[data-name]')].map((e) => e.dataset.name)`);
  const labels = await ev(p, `[...${F}.querySelectorAll('[data-name]')].map((e) => e.textContent)`);
  check(`show_action_icons ${tag}: the editor has no field for it`, !all.includes('show_action_icons'), J(all));
  check(`show_action_icons ${tag}: no "Show Action Icons" (or "action icon") text anywhere in the editor`, !labels.some((t) => /action icon/i.test(t)), J(labels.filter((t) => /action/i.test(t))));
  const disp = await ev(p, `[...${F}.querySelectorAll('details[data-section=display] [data-name]')].map((e) => e.dataset.name)`);
  check(`show_action_icons ${tag}: Display section is just its other settings, in order`, J(disp) === J(['default_tab', 'screensaver_minutes', 'screensaver_lyrics', 'backdrop', 'large_buttons', 'coerce_repeat_one']), J(disp));
  // an edit made in the editor keeps whatever YAML had
  await ev(p, `__changes.length = 0`);
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=large_buttons] input'); i.checked = true; i.dispatchEvent(new Event('change')); })()`); await sleep(250);
  const last = (await ev(p, `__changes`)).at(-1) ?? {};
  const had = 'show_action_icons' in cfg;
  check(`show_action_icons ${tag}: an editor edit keeps it as YAML had it (${had ? cfg.show_action_icons : 'absent'}) and adds nothing else`,
    (had ? last.show_action_icons === cfg.show_action_icons : !('show_action_icons' in last)) && last.large_buttons === true, J(last));
  if (tag === 'missing' && process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/0720-editor-display.png` });
  await p.close();
}
{
  // the card itself: a non-boolean value is still refused like the other on/off options
  const p = await browser.newPage(); await hermetic(p); await p.goto(`${ROOT}index.html?fresh=1`); await p.waitForFunction('window.__ready === true'); await sleep(500);
  const r = await ev(p, `(() => { const out = {}; for (const v of [false, true, undefined, 'no', 0]) { try { const el = document.createElement('jukebox-card'); el.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.everywhere', ...(v === undefined ? {} : { show_action_icons: v }) }); out[String(v)] = 'ok'; } catch (e) { out[String(v)] = e.message; } } return out; })()`);
  check('card accepts true, false and missing; refuses "no" and 0', r.true === 'ok' && r.false === 'ok' && r.undefined === 'ok' && /show_action_icons must be true or false/.test(r.no) && /show_action_icons must be true or false/.test(r['0']), J(r));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} editor-action-icons checks passed`);
process.exit(failures ? 1 : 0);

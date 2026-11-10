// 0.7.14 (#80): the card editor's "Show Action Icons" toggle. Same control (an on/off switch) and the same place as the other Display toggles
// (right after "Large buttons"), no help text (no other toggle has any). Shown ON when the option is missing (the default), unchecked when the
// config says false; switching it writes only that key; the card itself rejects a non-boolean value.
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

{
  const p = await open(base);
  const disp = await ev(p, `[...${F}.querySelectorAll('details[data-section=display] [data-name]')].map((e) => e.dataset.name)`);
  const i = disp.indexOf('show_action_icons');
  check('Display section lists show_action_icons right after large_buttons', i > 0 && disp[i - 1] === 'large_buttons', J(disp));
  const f = await ev(p, `(() => { const r = ${F}.querySelector('[data-name=show_action_icons]'); const c = r?.querySelector('input'); return r ? { label: r.querySelector('span')?.textContent, type: c?.type, checked: c?.checked, text: r.textContent.trim(), same: r.className === ${F}.querySelector('[data-name=large_buttons]').className } : null; })()`);
  check('label is "Show Action Icons", a checkbox/switch like the other toggles, no extra help text', f?.label === 'Show Action Icons' && f.type === 'checkbox' && f.text === 'Show Action Icons' && f.same, J(f));
  check('option missing → shown ON (the default)', f?.checked === true, J(f));
  const others = await ev(p, `[...${F}.querySelectorAll('[data-name].bool')].every((r) => r.textContent.trim() === r.querySelector('span').textContent.trim())`);
  check('no other toggle has help text either (same style)', others === true);
  await ev(p, `__changes.length = 0`);
  const c1 = await ev(p, `(() => { const i = ${F}.querySelector('[data-name=show_action_icons] input'); i.checked = false; i.dispatchEvent(new Event('change')); })()`); await sleep(200);
  const ch = await ev(p, `__changes`);
  const last = ch[ch.length - 1] ?? {};
  check('switching it off writes show_action_icons: false and changes nothing else', last.show_action_icons === false && last.entity === base.entity && Object.keys(last).filter((k) => !(k in base)).join() === 'show_action_icons', J(last));
  await sleep(300);
  check('after switching off it shows OFF', (await ev(p, `${F}.querySelector('[data-name=show_action_icons] input').checked`)) === false);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/0714-editor-show-action-icons.png` });
  await ev(p, `(() => { const i = ${F}.querySelector('[data-name=show_action_icons] input'); i.checked = true; i.dispatchEvent(new Event('change')); })()`); await sleep(200);
  const ch2 = await ev(p, `__changes`); const l2 = ch2[ch2.length - 1] ?? {};
  check('switching it back on writes true (or drops the key): the card treats both as on', l2.show_action_icons === true || !('show_action_icons' in l2), J(l2));
  await p.close();
}
{
  const p = await open({ ...base, show_action_icons: false });
  check('config show_action_icons: false → loads OFF', (await ev(p, `${F}.querySelector('[data-name=show_action_icons] input').checked`)) === false);
  await p.close();
}
{
  // the card itself: a non-boolean value is refused like the other on/off options
  const p = await browser.newPage(); await hermetic(p); await p.goto(`${ROOT}index.html?fresh=1`); await p.waitForFunction('window.__ready === true'); await sleep(500);
  const r = await ev(p, `(() => { const out = {}; for (const v of [false, true, undefined, 'no', 0]) { try { const el = document.createElement('jukebox-card'); el.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.everywhere', ...(v === undefined ? {} : { show_action_icons: v }) }); out[String(v)] = 'ok'; } catch (e) { out[String(v)] = e.message; } } return out; })()`);
  check('card accepts true, false and missing; refuses "no" and 0', r.true === 'ok' && r.false === 'ok' && r.undefined === 'ok' && /show_action_icons must be true or false/.test(r.no) && /show_action_icons must be true or false/.test(r['0']), J(r));
  await p.close();
}
await browser.close();
console.log(`\n${total - failures}/${total} editor-action-icons checks passed`);
process.exit(failures ? 1 : 0);

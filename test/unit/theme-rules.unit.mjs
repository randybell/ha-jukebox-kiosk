// 0.8.1: the card's styles may only paint with Home Assistant theme variables. Reads the source (no browser) and fails on a
// fixed colour, a fixed shadow, or the dialog dimmer used as a fill. The screensaver and the lyrics shade on Now Playing
// are the documented exceptions. Usage: node test/unit/theme-rules.unit.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const SRC = new URL('../../src/', import.meta.url);
const files = ['styles.ts', 'jukebox-card.ts', 'now-view.ts', 'queue-view.ts', 'search-view.ts', 'browse-view.ts', 'detail-view.ts', 'keyboard.ts', 'hold-sheet.ts',
  'speakers-view.ts', 'station-sheet.ts', 'shared.ts', 'slider.ts', 'lyrics/lyrics-view.ts'];
let failures = 0, total = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
// allowed fixed looks: screensaver / stage (exempt), the lyrics shade over the art
const EXEMPT = /\.amb|\.sv-|sv-bg|@keyframes|\.rm |\.m-saver|:host\(\[mode=saver\]\)|\.m-overlay|--_art-|mask-image|\.sv-lys/;
const stripVars = (t) => { // remove every var( ... ) with balanced parentheses
  for (let i = t.indexOf('var('); i >= 0; i = t.indexOf('var(')) {
    let d = 0, j = i + 3;
    for (; j < t.length; j++) { if (t[j] === '(') d++; else if (t[j] === ')' && --d === 0) break; }
    t = t.slice(0, i) + 'V' + t.slice(j + 1);
  }
  return t;
};
const bad = [];
for (const f of files) {
  const lines = readFileSync(new URL(f, SRC), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n'); // comments blanked, line numbers kept
  let inSaver = false;
  lines.forEach((raw, i) => {
    if (f === 'jukebox-card.ts') { if (/^\s*\.amb \{/.test(raw)) inSaver = true; if (/:host\(:fullscreen\)/.test(raw)) inSaver = false; }
    if (inSaver || EXEMPT.test(raw)) return;
    if (!/[a-z-]+\s*:/.test(raw)) return;
    let t = raw.replace(/\/\/.*$/, '').replace(/text-shadow:[^;]*;?/g, ''); // text-shadow: legibility over the art, as the lyrics shade
    t = stripVars(t); // a fallback inside var() is fine
    const hit = (re, why) => { if (re.test(t)) bad.push(`${f}:${i + 1} ${why}`); };
    if (!/^\s*(export |const |import |return |\*|\/\/)/.test(raw)) {
      hit(/#[0-9a-fA-F]{3,8}\b/, 'fixed hex colour');
      hit(/rgba?\(\s*\d/, 'fixed rgb colour');
      hit(/\b(black|white)\b\s*[;)]/, 'black/white');
      hit(/box-shadow:[^;]*\b\d+(px)?\s+\d+px\s+\d+px[^;]*(rgba?|#)/, 'fixed shadow');
    }
    if (/background:\s*var\(--_scrim\)/.test(raw) && !/scrim|\.bk\b/.test(raw)) bad.push(`${f}:${i + 1} the dialog dimmer used as a fill`);
  });
}
check('TR1 no fixed colours, fixed shadows or dimmer fills outside the exempt looks', bad.length === 0, bad.slice(0, 12).join(' | '));
const styles = readFileSync(new URL('styles.ts', SRC), 'utf8');
check('TR2 the dialog scrim is only --mdc-dialog-scrim-color (none by default) plus the HA backdrop filter, like ha-dialog', /--_scrim: var\(--mdc-dialog-scrim-color, transparent\)/.test(styles) && /--_scrim-filter: var\(--ha-dialog-scrim-backdrop-filter/.test(styles));
check('TR3 chips use HA chip tokens (assist chip idle, filter chip selected)', /--ha-assist-chip-container-color/.test(styles) && /--ha-filter-chip-selected-container-color/.test(styles));
check('TR4 inputs use HA input tokens', /--input-fill-color/.test(styles) && /--input-ink-color/.test(styles) && /--input-label-ink-color/.test(styles));
const card = readFileSync(new URL('jukebox-card.ts', SRC), 'utf8');
check('TR5 no album-art backdrop outside the screensaver: no backdrop option, module, shade tokens or Now Playing art layer; the list views paint no surface of their own',
  !/\.has-art|\.on-now|\.bd-|\.bdl|--_shade|--_vignette|--_backdrop|data-backdrop|dataset\.backdrop|resolveBackdrop|drawPreblurred/.test(card + styles) && !/backdrop\b(?!-filter)/.test(card.replace(/Backdrop/g, '')) && !existsSync(new URL('backdrop.ts', SRC)) && !/\.view:not\(\[data-view=now\]\)/.test(card));
console.log(`\n${total - failures}/${total} theme-rule checks passed`);
process.exit(failures ? 1 : 0);

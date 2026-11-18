// #127: the dead accent and font_base options, the never-set --_art-fg / --_art-chip-bg variables and the comments that
// still named the removed backdrop are gone from the source and the built card. Old configs that still have accent or
// font_base keep loading (test/dead-options.e2e.mjs). Usage: node test/unit/dead-options.unit.mjs
import { readFileSync, existsSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const types = read('src/types.ts'), card = read('src/jukebox-card.ts'), lyr = read('src/lyrics/lyrics-view.ts'), shared = read('src/shared.ts');
const built = read('custom_components/jukebox_kiosk/www/jukebox-card.js');
check('D1 types.ts: no accent option', !/\baccent\?:/.test(types));
check('D2 types.ts: no font_base option', !/font_base/.test(types));
check('D3 jukebox-card.ts: no accent default and no font call', !/accent:\s*'mono'/.test(card) && !/ensureFonts|font_base/.test(card));
check('D4 fonts.ts no-op removed', !existsSync(new URL('../../src/fonts.ts', import.meta.url)));
check('D5 lyrics-view.ts: no --_art-fg / --_art-chip-bg', !/--_art-(fg|chip-bg)/.test(lyr));
check('D6 shared.ts comments no longer name the backdrop', !/backdrop/i.test(shared.replace(/backdrop-filter/g, '')), (shared.match(/.*backdrop.*/gi) ?? []).filter((l) => !/backdrop-filter/.test(l)).join(' | '));
check('D7 built card: no accent default, no --_art-fg / --_art-chip-bg', !/accent:"mono"/.test(built) && !/--_art-(fg|chip-bg)/.test(built));
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

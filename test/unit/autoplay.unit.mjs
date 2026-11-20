// Unit checks for src/autoplay.ts (Now Playing and Queue header Autoplay, MA frontend 2.17.370).
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-autoplay/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/autoplay.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
const A = await import(OUT + 'autoplay.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const mode = A.autoplayControlMode ?? A.npAutoplayMode;
const base = { autoplay: false, dynamic: false, active: true, currentMediaType: 'track' };
check('A1 feature off → hide', mode(false, base) === 'hide');
check('A2 no snap → hide', mode(true, undefined) === 'hide');
check('A3 regular active track, autoplay known → toggle', mode(true, base) === 'toggle');
check('A4 autoplay on is still toggle', mode(true, { ...base, autoplay: true }) === 'toggle');
check('A5 inactive queue → hide', mode(true, { ...base, active: false }) === 'hide');
check('A6 active missing → hide (same as not true)', mode(true, { autoplay: true, dynamic: false }) === 'hide');
check('A7 radio media_type → hide', mode(true, { ...base, currentMediaType: 'radio' }) === 'hide');
check('A8 AUDIO_SOURCE media_type → hide', mode(true, { ...base, currentMediaType: 'audio_source' }) === 'hide');
check('A9 missing media_type does not hide, even if a URI looks like radio', mode(true, { ...base, currentMediaType: undefined }) === 'toggle');
check('A10 a speaker media link that looks like radio does not hide', mode(true, { ...base, currentMediaType: 'track' }) === 'toggle' && mode(true, { ...base, currentMediaType: undefined }) === 'toggle');
check('A11 missing duration does not hide', mode(true, base) === 'toggle');
check('A12 autoplay field missing → hide', mode(true, { dynamic: false, active: true, currentMediaType: 'track' }) === 'hide');
check('A13 dynamic → locked (non-tappable), even if autoplay is off', mode(true, { ...base, autoplay: false, dynamic: true }) === 'locked');
check('A14 dynamic + radio still locked (MA shows the dynamic indicator first)', mode(true, { ...base, dynamic: true, currentMediaType: 'radio' }) === 'locked');
check('A15 dynamic + inactive still locked', mode(true, { ...base, dynamic: true, active: false }) === 'locked');
check('A16 isInfiniteStream is only radio or audio_source media_type, not a URI',
  A.isInfiniteStream('radio') && A.isInfiniteStream('audio_source') && A.isInfiniteStream('RADIO')
  && !A.isInfiniteStream('track') && !A.isInfiniteStream(undefined) && !A.isInfiniteStream('')
  && !A.isInfiniteStream(undefined, 'tunein://radio/x') && !A.isInfiniteStream(undefined, 'radiobrowser://radio/aa-bb')
  && !A.isInfiniteStream(undefined, 'builtin://audio_source/foo'));
check('A17 repeat one → repeat-locked (visible, not toggle), even when autoplay_enabled is still true',
  mode(true, { ...base, autoplay: true }, 'one') === 'repeat-locked');
check('A18 repeat all → repeat-locked', mode(true, base, 'all') === 'repeat-locked');
check('A19 repeat off stays toggle', mode(true, base, 'off') === 'toggle');
check('A20 repeat lock does not apply when the control is hidden (inactive / radio)',
  mode(true, { ...base, active: false }, 'one') === 'hide' && mode(true, { ...base, currentMediaType: 'radio' }, 'all') === 'hide');
check('A21 dynamic wins over repeat (MA shows the dynamic indicator first)',
  mode(true, { ...base, dynamic: true }, 'one') === 'locked');
check('A22 canEnableAutoplay is false when repeat is one or all, true when off',
  typeof A.canEnableAutoplay === 'function' && A.canEnableAutoplay('one') === false && A.canEnableAutoplay('all') === false && A.canEnableAutoplay('off') === true && A.canEnableAutoplay(undefined) === true);

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

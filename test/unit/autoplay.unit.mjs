// Unit checks for src/autoplay.ts (Now Playing Autoplay show/hide, MA 2.17.297.post3).
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

const base = { autoplay: false, dynamic: false, active: true, currentMediaType: 'track' };
check('A1 feature off → hide', A.npAutoplayMode(false, base) === 'hide');
check('A2 no snap → hide', A.npAutoplayMode(true, undefined) === 'hide');
check('A3 regular active track, autoplay known → toggle', A.npAutoplayMode(true, base, 'library://track/1') === 'toggle');
check('A4 autoplay on is still toggle', A.npAutoplayMode(true, { ...base, autoplay: true }) === 'toggle');
check('A5 inactive queue → hide', A.npAutoplayMode(true, { ...base, active: false }) === 'hide');
check('A6 active missing → hide (same as not true)', A.npAutoplayMode(true, { autoplay: true, dynamic: false }) === 'hide');
check('A7 radio media_type → hide', A.npAutoplayMode(true, { ...base, currentMediaType: 'radio' }) === 'hide');
check('A8 AUDIO_SOURCE media_type → hide', A.npAutoplayMode(true, { ...base, currentMediaType: 'audio_source' }) === 'hide');
check('A9 radio URI without type → hide', A.npAutoplayMode(true, { ...base, currentMediaType: undefined }, 'radiobrowser://radio/aa-bb') === 'hide');
check('A10 audio_source URI without type → hide', A.npAutoplayMode(true, { ...base, currentMediaType: undefined }, 'builtin://audio_source/linein') === 'hide');
check('A11 missing duration does not hide', A.npAutoplayMode(true, base, 'library://track/1') === 'toggle');
check('A12 autoplay field missing → hide', A.npAutoplayMode(true, { dynamic: false, active: true, currentMediaType: 'track' }) === 'hide');
check('A13 dynamic → locked (non-tappable), even if autoplay is off', A.npAutoplayMode(true, { ...base, autoplay: false, dynamic: true }) === 'locked');
check('A14 dynamic + radio still locked (MA shows the dynamic indicator first)', A.npAutoplayMode(true, { ...base, dynamic: true, currentMediaType: 'radio' }) === 'locked');
check('A15 dynamic + inactive still locked', A.npAutoplayMode(true, { ...base, dynamic: true, active: false }) === 'locked');
check('A16 isInfiniteStream is type or URI, not duration',
  A.isInfiniteStream('radio') && A.isInfiniteStream('audio_source') && !A.isInfiniteStream('track') && !A.isInfiniteStream(undefined, 'library://track/1')
  && A.isInfiniteStream(undefined, 'tunein://radio/x') && A.isInfiniteStream(undefined, 'builtin://audio_source/foo'));

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

// #139: the card's repeat button cycles off → all → off (no repeat-one step). A player already on 'one'
// (set elsewhere) is still shown as 'one', and a tap goes to off. There is no setting for this.
// Usage: node test/unit/repeat.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-repeat/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/repeat.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
const R = await import(OUT + 'repeat.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const seq = []; let m = 'off';
for (let i = 0; i < 6; i++) { m = R.nextRepeat(m); seq.push(m); }
check('R1 toggle cycle is off → all → off → all → off → all (no repeat-one step)', seq.join(',') === 'all,off,all,off,all,off', seq.join(','));
check('R2 nextRepeat from a player on one goes to off', R.nextRepeat('one') === 'off');
check('R3 shownRepeat keeps one, all and off; unknown/undefined → off',
  R.shownRepeat('one') === 'one' && R.shownRepeat('all') === 'all' && R.shownRepeat('off') === 'off'
  && R.shownRepeat(undefined) === 'off' && R.shownRepeat('x') === 'off');
check('R4 nextRepeat returns only off or all (a player on one goes to off, never to one)', !new Set(['off', 'all', 'one', undefined, 'x'].map(R.nextRepeat)).has('one')
  && [...new Set(['off', 'all', 'one'].map(R.nextRepeat))].sort().join() === 'all,off');
check('R5 labels match Music Assistant: Repeat off / Repeat entire queue / Repeat single track',
  R.REPEAT_LABEL.off === 'Repeat off' && R.REPEAT_LABEL.all === 'Repeat entire queue' && R.REPEAT_LABEL.one === 'Repeat single track');
check('R6 there is no RepeatOneGuard and no coerce timing constants',
  R.RepeatOneGuard === undefined && R.COERCE_DEBOUNCE_MS === undefined && R.COERCE_COOLDOWN_MS === undefined);

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

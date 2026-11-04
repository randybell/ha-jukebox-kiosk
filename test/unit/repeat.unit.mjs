// Unit checks for src/repeat.ts (0.6.5): repeat is off <-> all only ("Repeat queue"); a player on 'one' is shown as
// all and gets exactly one repeat_set all per detection, never a loop, and nothing for a user without Playback.
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
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const P = 'media_player.placeholder_group';

// toggle cycle
const seq = []; let m = 'off';
for (let i = 0; i < 6; i++) { m = R.nextRepeat(m); seq.push(m); }
check('R1 toggle cycle is off → all → off → all … (never one)', seq.join(',') === 'all,off,all,off,all,off', seq.join(','));
check('R2 nextRepeat from a player on one goes to off (one is shown as all)', R.nextRepeat('one') === 'off');
check('R3 shownRepeat: one → all, all → all, off/undefined/junk → off',
  R.shownRepeat('one') === 'all' && R.shownRepeat('all') === 'all' && R.shownRepeat('off') === 'off' && R.shownRepeat(undefined) === 'off' && R.shownRepeat('x') === 'off');
check('R4 the set of values nextRepeat can return is {off, all}', new Set(['off', 'all', 'one', undefined, 'x'].map(R.nextRepeat)).size === 2 && !['off', 'all', 'one', undefined].map(R.nextRepeat).includes('one'));

function mk({ allowed = true, debounceMs = 30, cooldownMs = 400 } = {}) {
  const sends = [];
  let t = 0;
  const g = new R.RepeatOneGuard({ send: (e) => { sends.push(e); }, allowed: async () => allowed, debounceMs, cooldownMs, now: () => t });
  return { g, sends, adv: (ms) => { t += ms; } };
}

{ // exactly one send per detection, even with many state updates
  const { g, sends } = mk();
  for (let i = 0; i < 10; i++) { g.observe(P, 'one'); await tick(2); }
  await tick(60);
  for (let i = 0; i < 10; i++) g.observe(P, 'one');
  await tick(60);
  check('R5 repeat one (10 updates during debounce + 10 after) → exactly one send', sends.length === 1 && sends[0] === P, JSON.stringify(sends));
}
{ // no loop: player keeps going back to one right after the send
  const { g, sends, adv } = mk();
  g.observe(P, 'one'); await tick(50);
  for (let i = 0; i < 5; i++) { g.observe(P, 'all'); g.observe(P, 'one'); await tick(50); adv(10); }
  check('R6 player re-reports one 5× within the cooldown → still one send (no loop)', sends.length === 1, String(sends.length));
  adv(1000); g.observe(P, 'all'); g.observe(P, 'one'); await tick(50);
  check('R7 a new detection after the cooldown sends once more', sends.length === 2, String(sends.length));
}
{ const { g, sends } = mk({ allowed: false });
  g.observe(P, 'one'); await tick(60);
  check('R8 user without Playback → nothing sent', sends.length === 0 && g.sent === 0); }
{ const { g, sends } = mk();
  g.observe(P, 'one', false); await tick(60);
  check('R9 coerce_repeat_one false → nothing sent', sends.length === 0); }
{ const { g, sends } = mk();
  g.observe(P, 'one'); await tick(5); g.observe(P, 'all'); await tick(60);
  check('R10 player leaves one during the debounce → nothing sent', sends.length === 0); }
{ const { g, sends } = mk();
  g.observe(P, 'one'); await tick(5); g.dispose(); await tick(60);
  check('R11 dispose (card disconnected) cancels a pending send', sends.length === 0); }
{ const { g, sends } = mk();
  g.observe(P, 'off'); g.observe(P, 'all'); g.observe(P, undefined); await tick(60);
  check('R12 off / all / unknown never send', sends.length === 0); }
{ const sends = [];
  const g = new R.RepeatOneGuard({ send: async (e) => { sends.push(e); throw new Error('boom'); }, allowed: () => true, debounceMs: 10 });
  const w = console.warn; console.warn = () => {};
  g.observe(P, 'one'); await tick(40); g.observe(P, 'one'); await tick(40);
  console.warn = w;
  check('R13 a failing send is not retried in the same detection', sends.length === 1); }
check('R14 defaults: debounce 1.5 s, cooldown 60 s', R.COERCE_DEBOUNCE_MS === 1500 && R.COERCE_COOLDOWN_MS === 60000);

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

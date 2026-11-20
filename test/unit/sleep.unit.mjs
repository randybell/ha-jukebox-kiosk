// Unit checks for src/sleep.ts (Now Playing sleep timer helpers).
// Usage: node test/unit/sleep.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-sleep/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/sleep.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
const S = await import(OUT + 'sleep.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

check('S1 SLEEP_MINUTES is 15, 30, 45, 60, 120', S.SLEEP_MINUTES.join(',') === '15,30,45,60,120', String(S.SLEEP_MINUTES));
check('S2 fmtSleepRemain 0 → 0:00', S.fmtSleepRemain(0) === '0:00');
check('S3 fmtSleepRemain 1781 → 29:41', S.fmtSleepRemain(1781) === '29:41', S.fmtSleepRemain(1781));
check('S4 fmtSleepRemain floors and clamps negative', S.fmtSleepRemain(-3) === '0:00' && S.fmtSleepRemain(59.9) === '0:59');
check('S5 sleepLabel wraps fmt', S.sleepLabel(1781) === 'Sleep 29:41');
check('S6 remainFromExpires null/0/past → 0', S.remainFromExpires(null) === 0 && S.remainFromExpires(0) === 0 && S.remainFromExpires(100, 200) === 0);
check('S7 remainFromExpires future', Math.abs(S.remainFromExpires(1100, 1000) - 100) < 0.001);
check('S8 canMaSleep true only when sleepTimerSet is a function',
  S.canMaSleep({ sleepTimerSet: async () => {} }) && !S.canMaSleep({ caps: { send: true } }) && !S.canMaSleep({ sleepTimerSet: true }) && !S.canMaSleep(undefined));
check('S9 parseExpires number', S.parseExpires(1700000000) === 1700000000);
check('S10 parseExpires null/junk', S.parseExpires(null) === null && S.parseExpires('x') === null && S.parseExpires(0) === null);
check('S11 parseExpires object shape (sleep_timer_expires_at)', S.parseExpires({ sleep_timer_expires_at: 42 }) === 42 && S.parseExpires({ sleep_timer_expires_at: 0 }) === null);
check('S12 parseExpires kiosk {expires_at} shape', S.parseExpires({ expires_at: 99, player_id: 'p' }) === 99 && S.parseExpires({ expires_at: null }) === null);

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

// #107 / #108: times and dates follow HA's profile like HA's own frontend (format_time.ts, use_am_pm.ts, resolve-time-zone.ts):
// time_format 'language' | 'system' | '12' | '24', time_zone 'local' | 'server' (server = hass.config.time_zone), the profile
// language for dates. Usage: node test/unit/clock-format.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync, existsSync } from 'node:fs';

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
if (!existsSync(new URL('../../src/datetime.ts', import.meta.url))) { check('src/datetime.ts (HA time and date formatting) exists', false); console.log(`\n0/1 checks passed`); process.exit(1); }
const OUT = new URL('../tmp/unit-clock-format/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/datetime.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();
const D = await import(OUT + 'datetime.mjs');
const J = JSON.stringify;
const local = Intl.DateTimeFormat().resolvedOptions().timeZone; // the test machine's zone
const SERVER = local === 'Asia/Tokyo' ? 'America/Chicago' : 'Asia/Tokyo';
const at = new Date(Date.UTC(2026, 10, 18, 21, 5)); // 21:05 UTC
const ref = (lang, opts) => new Intl.DateTimeFormat(lang, opts).format(at);
const hass = (locale, tz = SERVER) => ({ states: {}, locale, language: locale.language, config: { time_zone: tz } });

const t = (loc) => D.formatTime(at, hass(loc));
check('T1 24-hour setting in English: 24-hour clock', t({ language: 'en-US', time_format: '24', time_zone: 'local' }) === ref('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: local }), t({ language: 'en-US', time_format: '24', time_zone: 'local' }));
check('T2 12-hour setting in German: 12-hour clock', t({ language: 'de', time_format: '12', time_zone: 'local' }) === ref('de', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZone: local }), t({ language: 'de', time_format: '12', time_zone: 'local' }));
check('T3 "language": English uses 12-hour', /PM|AM/.test(t({ language: 'en-US', time_format: 'language', time_zone: 'local' })), t({ language: 'en-US', time_format: 'language', time_zone: 'local' }));
check('T4 "language": German uses 24-hour', !/PM|AM/i.test(t({ language: 'de', time_format: 'language', time_zone: 'local' })), t({ language: 'de', time_format: 'language', time_zone: 'local' }));
check('T5 "server" time zone: HA\'s config.time_zone', t({ language: 'en-US', time_format: '24', time_zone: 'server' }) === ref('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: SERVER }), t({ language: 'en-US', time_format: '24', time_zone: 'server' }));
check('T6 "local" time zone: this browser\'s zone', t({ language: 'en-US', time_format: '24', time_zone: 'local' }) === ref('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: local }));
check('T7 same look as before when nothing is set (en-US, h:mm AM/PM)', D.formatTime(at, { states: {}, locale: { language: 'en-US' } }) === ref('en-US', { hour: 'numeric', minute: '2-digit' }));
check('T8 a bad server zone does not break the clock', typeof D.formatTime(at, hass({ language: 'en-US', time_format: '24', time_zone: 'server' }, 'Not/AZone')) === 'string');
check('T9 screensaver date in the server zone', D.formatDateWeekdayDay(at, hass({ language: 'en-US', time_zone: 'server' })) === ref('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: SERVER }));

// #107: the clock ticks on the minute boundary (fake timers and a mocked clock), not on a 15 s interval
{
  if (typeof D.startMinuteClock !== 'function') check('M0 startMinuteClock (minute-boundary clock) exists', false);
  else {
    let now = Date.UTC(2026, 10, 18, 16, 0, 47, 250); // 47.25 s into a minute
    const timers = new Map(); let seq = 0;
    const ft = { now: () => now, setTimeout: (fn, ms) => { timers.set(++seq, { fn, at: now + ms }); return seq; }, clearTimeout: (id) => timers.delete(id) };
    const run = (until) => { for (;;) { const due = [...timers.entries()].filter(([, x]) => x.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].fn(); } now = until; };
    const ticks = [];
    const stop = D.startMinuteClock((d) => ticks.push(+d), ft);
    const first = [...timers.values()][0];
    check('M1 the first tick is scheduled for the next minute boundary (12.75 s away), not 15 s', timers.size === 1 && first.at === Date.UTC(2026, 10, 18, 16, 1, 0, 0), String(first && (first.at - Date.UTC(2026, 10, 18, 16, 0, 47, 250))));
    run(Date.UTC(2026, 10, 18, 16, 1, 0, 0) - 1);
    check('M2 nothing ticks before the boundary', ticks.length === 0);
    run(Date.UTC(2026, 10, 18, 16, 1, 0, 0));
    check('M3 it ticks exactly at hh:01:00.000', ticks.length === 1 && ticks[0] === Date.UTC(2026, 10, 18, 16, 1, 0, 0), JSON.stringify(ticks.map((x) => new Date(x).toISOString())));
    run(Date.UTC(2026, 10, 18, 16, 4, 0, 0));
    check('M4 then once per minute, each exactly on the minute', JSON.stringify(ticks) === JSON.stringify([1, 2, 3, 4].map((m) => Date.UTC(2026, 10, 18, 16, m, 0, 0))), JSON.stringify(ticks.map((x) => new Date(x).toISOString())));
    check('M5 only one timer is pending at a time', timers.size === 1, String(timers.size));
    // a timer that fires 1 ms early does not show the old minute again: it waits out the rest and ticks at the boundary
    const k = [...timers.keys()][0]; timers.get(k).at -= 1; run(Date.UTC(2026, 10, 18, 16, 5, 0, 0));
    check('M6 a timer firing 1 ms early still ticks once, at the boundary', ticks.length === 5 && ticks[4] === Date.UTC(2026, 10, 18, 16, 5, 0, 0), JSON.stringify(ticks.slice(4).map((x) => new Date(x).toISOString())));
    stop();
    check('M7 stop() clears the pending timer (no leak)', timers.size === 0, String(timers.size));
    run(Date.UTC(2026, 10, 18, 16, 10, 0, 0));
    check('M8 no tick after stop()', ticks.length === 5);
  }
}
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

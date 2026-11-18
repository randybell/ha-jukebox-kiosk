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
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

// #156 sleep timer off (Randy: kept for a standalone player):
// // Unit checks for src/sleep.ts (Now Playing sleep timer helpers).
// // Usage: node test/unit/sleep.unit.mjs
// import { rollup } from 'rollup';
// import typescript from '@rollup/plugin-typescript';
// import { mkdirSync } from 'node:fs';

// const OUT = new URL('../tmp/unit-sleep/', import.meta.url).pathname;
// mkdirSync(OUT, { recursive: true });
// const bundle = await rollup({ input: ['src/sleep.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
// await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
// await bundle.close();
// const S = await import(OUT + 'sleep.mjs');

// let failures = 0, total = 0;
// function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

// check('S1 SLEEP_MINUTES is 15, 30, 45, 60, 120', S.SLEEP_MINUTES.join(',') === '15,30,45,60,120', String(S.SLEEP_MINUTES));
// check('S2 fmtSleepRemain 0 → 00:00 (MA formatDuration)', S.fmtSleepRemain(0) === '00:00');
// check('S3 fmtSleepRemain 1781 → 29:41', S.fmtSleepRemain(1781) === '29:41', S.fmtSleepRemain(1781));
// check('S4 fmtSleepRemain floors and clamps negative', S.fmtSleepRemain(-3) === '00:00' && S.fmtSleepRemain(59.9) === '00:59');
// check('S4b fmtSleepRemain MA format: 45:00, 05:03, 01:00:00, 01:59:59', S.fmtSleepRemain(2700) === '45:00' && S.fmtSleepRemain(303) === '05:03' && S.fmtSleepRemain(3600) === '01:00:00' && S.fmtSleepRemain(7199) === '01:59:59');
// check('S4c SLEEP_LABEL is MA\'s preset words', [15, 30, 45, 60, 120].map((m) => S.SLEEP_LABEL[m]).join('|') === '15 minutes|30 minutes|45 minutes|1 hour|2 hours');
// check('S5 sleepLabel wraps fmt', S.sleepLabel(1781) === '29:41');
// check('S6 remainFromExpires null/0/past → 0', S.remainFromExpires(null) === 0 && S.remainFromExpires(0) === 0 && S.remainFromExpires(100, 200) === 0);
// check('S7 remainFromExpires future', Math.abs(S.remainFromExpires(1100, 1000) - 100) < 0.001);
// check('S8 canMaSleep true only when sleepTimerSet is a function',
  // S.canMaSleep({ sleepTimerSet: async () => {} }) && !S.canMaSleep({ caps: { send: true } }) && !S.canMaSleep({ sleepTimerSet: true }) && !S.canMaSleep(undefined));
// check('S9 parseExpires number', S.parseExpires(1700000000) === 1700000000);
// check('S10 parseExpires null/junk', S.parseExpires(null) === null && S.parseExpires('x') === null && S.parseExpires(0) === null);
// check('S11 parseExpires object shape (sleep_timer_expires_at)', S.parseExpires({ sleep_timer_expires_at: 42 }) === 42 && S.parseExpires({ sleep_timer_expires_at: 0 }) === null);
// check('S12 parseExpires kiosk {expires_at} shape', S.parseExpires({ expires_at: 99, player_id: 'p' }) === 99 && S.parseExpires({ expires_at: null }) === null);
// check('S13 chooser labels are MA\'s exact strings (en.json sleep_timer_preset)',
  // S.SLEEP_LABEL?.[15] === '15 minutes' && S.SLEEP_LABEL?.[30] === '30 minutes' && S.SLEEP_LABEL?.[45] === '45 minutes'
  // && S.SLEEP_LABEL?.[60] === '1 hour' && S.SLEEP_LABEL?.[120] === '2 hours', JSON.stringify(S.SLEEP_LABEL));
// check('S14 end of item with no expiry is active, duration-only with no expiry is not',
  // S.sleepIsActive(null, 'end_of_item') === true && S.sleepIsActive(null, 'end_of_chapter') === true
  // && S.sleepIsActive(null, 'duration') === false && S.sleepIsActive(null) === false
  // && S.sleepIsActive(2000, 'duration', 1000) === true && S.sleepIsActive(500, undefined, 1000) === false);
// check('S15 mode labels match MA en.json sleep_timer_end_of_item / end_of_chapter',
  // S.sleepModeLabel('end_of_item', 'track') === 'End of track'
  // && S.sleepModeLabel('end_of_item', 'podcast_episode') === 'End of episode'
  // && S.sleepModeLabel('end_of_item', 'audiobook') === 'End of audiobook'
  // && S.sleepModeLabel('end_of_item', 'radio') === 'End of current item'
  // && S.sleepModeLabel('end_of_item') === 'End of current item'
  // && S.sleepModeLabel('end_of_chapter', 'audiobook') === 'End of chapter'
  // && S.sleepModeLabel('duration', 'track') === undefined
  // && S.sleepModeLabel(undefined) === undefined);
// check('S16 parseSleepMode reads mode from the kiosk payload',
  // S.parseSleepMode({ expires_at: null, mode: 'end_of_item' }) === 'end_of_item'
  // && S.parseSleepMode({ expires_at: 99, mode: 'end_of_chapter' }) === 'end_of_chapter'
  // && S.parseSleepMode({ expires_at: 99 }) === undefined
  // && S.parseSleepMode({ mode: 'nope' }) === undefined);
// check('S17 MA 2.10.12: no sleep_timer_mode and no expiry is Off, no invented label',
  // S.sleepIsActive(null) === false && S.sleepIsActive(null, undefined) === false
  // && S.sleepIsActive(null, null) === false && S.sleepModeLabel(undefined) === undefined
  // && S.sleepModeLabel(null) === undefined && S.parseSleepMode({ expires_at: null }) === undefined);

// console.log(`\n${total - failures}/${total} passed`);
// process.exit(failures ? 1 : 0);

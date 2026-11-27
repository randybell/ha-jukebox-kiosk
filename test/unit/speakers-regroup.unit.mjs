// Unit checks for the regroup-in-progress signal (src/speakers/regroup.ts).
// No browser, no network. Usage: node test/unit/speakers-regroup.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-regroup/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  input: ['src/speakers/regroup.ts'],
  plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

const R = await import(OUT + 'regroup.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const micro = () => new Promise((r) => queueMicrotask(r));

check('U1 REGROUP_MS is 24 s (the safety net 18 s plus its 6 s grace)', R.REGROUP_MS === 24_000, String(R.REGROUP_MS));

const rec = { group: 'syncgroup_everywhere', speakerId: 'wiim_office', reason: 'leader-drop', startedAt: 1_000, until: 25_000, seenOut: false, joinSettled: false };
check('U2 snapshot shape: active, reason, groupId, entityId, speakerId, startedAt, until, maPlaybackState',
  J(R.regroupSnapshot(rec, 'media_player.everywhere', 'paused')) === J({
    active: true, reason: 'leader-drop', groupId: 'syncgroup_everywhere', entityId: 'media_player.everywhere',
    speakerId: 'wiim_office', startedAt: 1_000, until: 25_000, maPlaybackState: 'paused',
  }));

check('U3 leader-drop has not landed while the speaker is still in the group',
  R.regroupLanded({ ...rec, reason: 'leader-drop' }, ['wiim_office', 'wiim_kitchen']) === false
  && R.regroupLanded({ ...rec, reason: 'leader-drop' }, ['wiim_kitchen']) === true);

check('U4 join-back has not landed until the speaker is in and has been seen out (or the join call has finished)',
  R.regroupLanded({ ...rec, reason: 'join-back', seenOut: false, joinSettled: false }, ['wiim_kitchen', 'wiim_office']) === false
  && R.regroupLanded({ ...rec, reason: 'join-back', seenOut: false, joinSettled: false }, ['wiim_kitchen']) === false
  && R.regroupLanded({ ...rec, reason: 'join-back', seenOut: true, joinSettled: false }, ['wiim_kitchen', 'wiim_office']) === true
  && R.regroupLanded({ ...rec, reason: 'join-back', seenOut: false, joinSettled: true }, ['wiim_kitchen', 'wiim_office']) === true);

const drop = { ...rec, reason: 'leader-drop', until: 25_000 };
check('U5 leader-drop is not done until the speaker is out and the new leader is playing',
  R.regroupDone(drop, ['wiim_kitchen'], false, 2_000) === false
  && R.regroupDone(drop, ['wiim_office', 'wiim_kitchen'], true, 2_000) === false
  && R.regroupDone(drop, ['wiim_kitchen'], true, 2_000) === true);

const join = { ...rec, reason: 'join-back', until: 25_000, seenOut: true, joinSettled: false };
check('U6 join-back is not done until the speaker is in (after being out) and the leader is playing',
  R.regroupDone(join, ['wiim_kitchen'], true, 2_000) === false
  && R.regroupDone(join, ['wiim_kitchen', 'wiim_office'], false, 2_000) === false
  && R.regroupDone(join, ['wiim_kitchen', 'wiim_office'], true, 2_000) === true
  && R.regroupDone({ ...join, seenOut: false, joinSettled: false }, ['wiim_kitchen', 'wiim_office'], true, 2_000) === false);

check('U7 timeout clears the regroup even if membership has not landed and nothing is playing',
  R.regroupDone(drop, ['wiim_office', 'wiim_kitchen'], false, 25_001) === true
  && R.regroupDone(drop, ['wiim_kitchen'], false, 25_000) === false);

{
  let n = 0;
  const sig = new R.RegroupSignal(() => 50, () => n++);
  check('U8 starts off: record and snapshot are null', sig.record === null
    && sig.snapshot('media_player.everywhere', 'playing', ['wiim_kitchen'], true) === null);

  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  const on = sig.snapshot('media_player.everywhere', 'paused', ['wiim_office', 'wiim_kitchen'], false);
  check('U9 start a leader-drop: signal is on with that reason, group, speaker, and the live-feed play state',
    n >= 1 && sig.record?.reason === 'leader-drop' && on?.active === true && on.reason === 'leader-drop'
    && on.groupId === 'syncgroup_everywhere' && on.entityId === 'media_player.everywhere'
    && on.speakerId === 'wiim_office' && on.maPlaybackState === 'paused'
    && typeof on.startedAt === 'number' && on.until === on.startedAt + 50, J(on));

  const startedAt = sig.record.startedAt, until = sig.record.until;
  await tick(10);
  const flipped = sig.joinBack('wiim_office');
  const jb = sig.snapshot('media_player.everywhere', 'idle', ['wiim_office', 'wiim_kitchen'], false);
  check('U10 join-back during a leader-drop keeps the signal on, flips the reason, and refreshes the deadline',
    flipped === true && jb?.reason === 'join-back' && jb.speakerId === 'wiim_office' && jb.active === true
    && sig.record.startedAt >= startedAt && sig.record.until > until, J({ flipped, jb, prev: { startedAt, until }, now: sig.record }));

  const ignored = sig.joinBack('wiim_other');
  check('U11 joinBack of a different speaker leaves the current regroup alone',
    ignored === false && sig.record?.reason === 'join-back' && sig.record?.speakerId === 'wiim_office');

  check('U12a join-back while the speaker is still listed and the group is still playing does not clear (the drop may not have landed yet)',
    sig.snapshot('media_player.everywhere', 'playing', ['wiim_office', 'wiim_kitchen'], true)?.reason === 'join-back');

  // speaker leaves, then comes back playing: seenOut latches, then it clears
  sig.snapshot('media_player.everywhere', 'idle', ['wiim_kitchen'], false);
  const cleared = sig.snapshot('media_player.everywhere', 'playing', ['wiim_kitchen', 'wiim_office'], true);
  await micro();
  check('U13 MA playing after a join-back (speaker was seen out, then in) clears the snapshot at once',
    cleared === null && sig.record === null);
}

{
  const sig = new R.RegroupSignal(() => 5_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  sig.joinBack('wiim_office', false);
  check('U13b a join-back that is still in and playing stays on until the join call settles',
    sig.snapshot('media_player.everywhere', 'playing', ['wiim_office', 'wiim_kitchen'], true)?.reason === 'join-back');
  sig.markJoinSettled();
  const cleared = sig.snapshot('media_player.everywhere', 'playing', ['wiim_office', 'wiim_kitchen'], true);
  await micro();
  check('U13c markJoinSettled plus a playing group with the speaker in clears the join-back',
    cleared === null && sig.record === null);
}

{
  const sig = new R.RegroupSignal(() => 40);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  await tick(80);
  check('U14 the timeout itself ends the signal when play never comes back', sig.record === null
    && sig.snapshot('media_player.everywhere', 'idle', ['wiim_kitchen'], false) === null);
}

{
  const sig = new R.RegroupSignal(() => 5_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  sig.end();
  check('U15 end() (a failed drop or join, or disconnect) clears at once', sig.record === null);
  sig.end();
  check('U16 end() is safe to call again', sig.record === null);
}

{
  const sig = new R.RegroupSignal(() => 5_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  // new leader playing, dropped speaker still listed: not cleared (membership has not landed)
  const still = sig.snapshot('media_player.everywhere', 'playing', ['wiim_office', 'wiim_kitchen'], true);
  check('U17 ordinary / incomplete membership does not clear a leader-drop, even if something is playing',
    still?.reason === 'leader-drop');
  sig.end();
}

console.log(`\n${total - failures}/${total} regroup unit checks passed`);
process.exit(failures ? 1 : 0);

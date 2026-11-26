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

/** MA live-feed slice. playing/reformed helpers take only these fields (never HA entities). */
const feed = (o = {}) => ({
  members: o.members ?? ['wiim_kitchen'],
  leaderId: o.leaderId ?? (o.members ? o.members[0] : 'wiim_kitchen'),
  leaderMembers: o.leaderMembers ?? o.members ?? ['wiim_kitchen'],
  groupPlaying: !!o.groupPlaying,
  leaderPlaying: !!o.leaderPlaying,
  leaderElapsed: o.leaderElapsed,
  groupElapsed: o.groupElapsed,
});
const quiet = (members, lead) => feed({ members, leaderId: lead ?? members[0], leaderMembers: members, groupPlaying: false, leaderPlaying: false });
const playing = (members, lead, elapsed) => feed({
  members, leaderId: lead ?? members[0], leaderMembers: members, groupPlaying: true, leaderPlaying: true,
  ...(elapsed !== undefined ? { leaderElapsed: elapsed, groupElapsed: elapsed } : {}),
});

check('U1 REGROUP_MS is 24 s (the expected window: safety net 18 s plus its 6 s grace; not a cutoff)', R.REGROUP_MS === 24_000, String(R.REGROUP_MS));
check('U1b REGROUP_CEILING_MS is 90 s (hard ceiling; __jbRegroupMs still overrides it)', R.REGROUP_CEILING_MS === 90_000, String(R.REGROUP_CEILING_MS));
check('U1c REGROUP_PLAYING_HOLD_MS is 4 s (fallback if a re-form is never seen idle)', R.REGROUP_PLAYING_HOLD_MS === 4_000, String(R.REGROUP_PLAYING_HOLD_MS));
check('U1d REGROUP_ELAPSED_ADVANCE is 1 s of raw MA elapsed from the first post-latch playing sample', R.REGROUP_ELAPSED_ADVANCE === 1, String(R.REGROUP_ELAPSED_ADVANCE));
check('U1e REGROUP_NO_ELAPSED_HOLD_MS is 12 s when the feed has no usable position at all', R.REGROUP_NO_ELAPSED_HOLD_MS === 12_000, String(R.REGROUP_NO_ELAPSED_HOLD_MS));

const rec = { group: 'syncgroup_everywhere', speakerId: 'wiim_office', reason: 'leader-drop', startedAt: 1_000, until: 25_000, seenOut: false, joinSettled: false, seenQuietAfterReform: false };
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
const reformedKitchen = playing(['wiim_kitchen'], 'wiim_kitchen');
check('U5 leader-drop is not done until the group has re-formed on a new leader, that re-form was seen not playing, and the new leader is playing',
  R.regroupDone(drop, feed({ members: ['wiim_kitchen'], leaderId: 'wiim_kitchen', groupPlaying: false, leaderPlaying: false }), 2_000) === false
  && R.regroupDone(drop, playing(['wiim_office', 'wiim_kitchen'], 'wiim_office'), 2_000) === false
  && R.regroupDone(drop, playing(['wiim_kitchen'], 'wiim_kitchen'), 2_000) === false
  && R.regroupReformed(drop, playing(['wiim_kitchen'], 'wiim_kitchen')) === true);
{
  const r = { ...drop, seenQuietAfterReform: false };
  R.regroupObserve(r, quiet(['wiim_kitchen'], 'wiim_kitchen'));
  R.regroupObserve(r, playing(['wiim_kitchen'], 'wiim_kitchen', 0), 2_000);
  const frozen = R.regroupDone(r, playing(['wiim_kitchen'], 'wiim_kitchen', 0), 2_000);
  R.regroupObserve(r, playing(['wiim_kitchen'], 'wiim_kitchen', 1), 2_000);
  check('U5b after a post-re-form idle, the signal stays on through the first playing sample (position frozen) and clears once elapsed has advanced',
    r.seenQuietAfterReform === true
    && R.regroupDone(r, quiet(['wiim_kitchen'], 'wiim_kitchen'), 2_000) === false
    && frozen === false
    && r.playElapsed === 0
    && R.regroupDone(r, playing(['wiim_kitchen'], 'wiim_kitchen', 1), 2_000) === true);
}

const join = { ...rec, reason: 'join-back', until: 25_000, seenOut: true, joinSettled: false };
{
  const j = { ...join };
  R.regroupObserve(j, playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 0), 2_000);
  const frozenJoin = R.regroupDone(j, playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 0), 2_000);
  R.regroupObserve(j, playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 1), 2_000);
  const notLanded = { ...join, seenOut: false, joinSettled: false };
  R.regroupObserve(notLanded, playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 1), 2_000);
  check('U6 join-back is not done until the speaker is in (after being out), the leader is playing, and the position has advanced',
    R.regroupDone(join, playing(['wiim_kitchen'], 'wiim_kitchen', 1), 2_000) === false
    && R.regroupDone(join, quiet(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen'), 2_000) === false
    && frozenJoin === false
    && R.regroupDone(j, playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 1), 2_000) === true
    && R.regroupDone(notLanded, playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 1), 2_000) === false);
}

check('U7 the hard ceiling (until) clears the regroup even if the group has not re-formed and nothing is playing',
  R.regroupDone(drop, quiet(['wiim_office', 'wiim_kitchen'], 'wiim_office'), 25_001) === true
  && R.regroupDone(drop, quiet(['wiim_kitchen'], 'wiim_kitchen'), 25_000) === false);

{
  const r = { ...rec, reason: 'leader-drop', startedAt: 1_000, until: 1_000 + R.REGROUP_CEILING_MS, seenOut: true };
  check('U18 past 24 s still quiet: the signal is not done (until is the 90 s ceiling, not 24 s)',
    R.regroupDone(r, quiet(['wiim_kitchen'], 'wiim_kitchen'), 1_000 + R.REGROUP_MS) === false
    && R.regroupDone(r, quiet(['wiim_kitchen'], 'wiim_kitchen'), 1_000 + 24_000) === false
    && R.regroupDone(r, quiet(['wiim_kitchen'], 'wiim_kitchen'), 1_000 + 89_999) === false);
  check('U19 the 90 s hard ceiling ends the signal while still quiet',
    R.regroupDone(r, quiet(['wiim_kitchen'], 'wiim_kitchen'), 1_000 + R.REGROUP_CEILING_MS) === false
    && R.regroupDone(r, quiet(['wiim_kitchen'], 'wiim_kitchen'), 1_000 + 90_000) === false
    && R.regroupDone(r, quiet(['wiim_kitchen'], 'wiim_kitchen'), 1_000 + 90_001) === true
    && (1_000 + R.REGROUP_CEILING_MS + 1) === 91_001);
}

{
  let n = 0;
  const sig = new R.RegroupSignal(() => 50, () => n++);
  check('U8 starts off: record and snapshot are null', sig.record === null
    && sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen'], 'wiim_kitchen')) === null);

  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  const on = sig.snapshot('media_player.everywhere', 'paused', quiet(['wiim_office', 'wiim_kitchen'], 'wiim_office'));
  check('U9 start a leader-drop: signal is on with that reason, group, speaker, and the live-feed play state',
    n >= 1 && sig.record?.reason === 'leader-drop' && on?.active === true && on.reason === 'leader-drop'
    && on.groupId === 'syncgroup_everywhere' && on.entityId === 'media_player.everywhere'
    && on.speakerId === 'wiim_office' && on.maPlaybackState === 'paused'
    && typeof on.startedAt === 'number' && on.until === on.startedAt + 50, J(on));

  const startedAt = sig.record.startedAt, until = sig.record.until;
  await tick(10);
  const flipped = sig.joinBack('wiim_office');
  const jb = sig.snapshot('media_player.everywhere', 'idle', quiet(['wiim_office', 'wiim_kitchen'], 'wiim_office'));
  check('U10 join-back during a leader-drop keeps the signal on, flips the reason, and refreshes the deadline',
    flipped === true && jb?.reason === 'join-back' && jb.speakerId === 'wiim_office' && jb.active === true
    && sig.record.startedAt >= startedAt && sig.record.until > until, J({ flipped, jb, prev: { startedAt, until }, now: sig.record }));

  const ignored = sig.joinBack('wiim_other');
  check('U11 joinBack of a different speaker leaves the current regroup alone',
    ignored === false && sig.record?.reason === 'join-back' && sig.record?.speakerId === 'wiim_office');

  check('U12a join-back while the speaker is still listed and the group is still playing does not clear (the drop may not have landed yet)',
    sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_office', 'wiim_kitchen'], 'wiim_office'))?.reason === 'join-back');

  // speaker leaves, then comes back playing: seenOut latches, then it clears
  sig.snapshot('media_player.everywhere', 'idle', quiet(['wiim_kitchen'], 'wiim_kitchen'));
  const frozen = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 0));
  const cleared = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 1));
  await micro();
  check('U13 MA playing after a join-back (speaker was seen out, then in) stays on while position is frozen and clears once elapsed has advanced',
    frozen?.reason === 'join-back' && cleared === null && sig.record === null, J({ frozen, cleared }));
}

{
  const sig = new R.RegroupSignal(() => 5_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  sig.joinBack('wiim_office', false);
  check('U13b a join-back that is still in and playing stays on until the join call settles',
    sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_office', 'wiim_kitchen'], 'wiim_office'))?.reason === 'join-back');
  sig.markJoinSettled();
  const frozen = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_office', 'wiim_kitchen'], 'wiim_kitchen', 0));
  const cleared = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_office', 'wiim_kitchen'], 'wiim_kitchen', 1));
  await micro();
  check('U13c markJoinSettled plus a playing group with the speaker in stays on while frozen and clears once elapsed has advanced',
    frozen?.reason === 'join-back' && cleared === null && sig.record === null, J({ frozen, cleared }));
}

{
  const sig = new R.RegroupSignal(() => 40);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  await tick(80);
  check('U14 the timeout itself ends the signal when play never comes back', sig.record === null
    && sig.snapshot('media_player.everywhere', 'idle', quiet(['wiim_kitchen'], 'wiim_kitchen')) === null);
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
  // group playing but the dropped speaker is still the listed leader: not a re-form
  const still = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_office', 'wiim_kitchen'], 'wiim_office'));
  check('U17 ordinary / incomplete membership does not clear a leader-drop, even if something is playing',
    still?.reason === 'leader-drop');
  sig.end();
}

{
  const sig = new R.RegroupSignal(() => 5_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  const startedAt = sig.record.startedAt;
  check('U20 startedAt is a Date.now() timestamp Themes can use for an elapsed-seconds counter',
    typeof startedAt === 'number' && startedAt > 0 && (Date.now() - startedAt) >= 0 && (Date.now() - startedAt) < 2_000);
  sig.end();
  check('U21 joinBack after the cap has ended returns false and does not start a new record (join() starts one when still quiet)',
    sig.joinBack('wiim_office') === false && sig.record === null);
  sig.start('syncgroup_everywhere', 'wiim_office', 'join-back', { seenOut: true });
  sig.markJoinSettled();
  const on = sig.snapshot('media_player.everywhere', 'idle', quiet(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen'));
  check('U22 a fresh join-back started after the cap stays on while the group is not playing, and startedAt is set',
    on?.reason === 'join-back' && on.active === true && typeof on.startedAt === 'number'
    && on.until === on.startedAt + 5_000 && sig.record != null, J(on));
  const frozenPlay = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 0));
  const afterPlay = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 1));
  await micro();
  check('U23 that fresh join-back stays on while position is frozen and clears once elapsed has advanced',
    frozenPlay?.reason === 'join-back' && afterPlay === null && sig.record === null, J({ frozenPlay, afterPlay }));
}

{
  // Randy live drop 1: 11 s of false PLAYING starting 0.6 s after the drop, before set_members on the new leader.
  const sig = new R.RegroupSignal(() => 90_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  const blipEmpty = sig.snapshot('media_player.everywhere', 'playing', feed({
    members: [], leaderId: undefined, leaderMembers: [], groupPlaying: true, leaderPlaying: false,
  }));
  const blipOldLead = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_office'], 'wiim_office'));
  const reformedQuiet = sig.snapshot('media_player.everywhere', 'idle', quiet(['wiim_kitchen', 'wiim_garage'], 'wiim_garage'));
  const missingOnLeader = sig.snapshot('media_player.everywhere', 'playing', feed({
    members: ['wiim_kitchen', 'wiim_garage'], leaderId: 'wiim_garage',
    leaderMembers: ['wiim_garage'], // new leader does not yet list the members
    groupPlaying: true, leaderPlaying: true,
  }));
  const frozen = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0));
  const steady = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 1));
  await micro();
  check('U24 a false group PLAYING before the re-form (empty members, or the dropped speaker still leading) does not clear the signal',
    blipEmpty?.reason === 'leader-drop' && blipOldLead?.reason === 'leader-drop', J({ blipEmpty, blipOldLead }));
  check('U25 re-form on a new leader that does not yet list the members, or is not playing, does not clear',
    reformedQuiet?.reason === 'leader-drop' && missingOnLeader?.reason === 'leader-drop', J({ reformedQuiet, missingOnLeader }));
  check('U26 the signal stays on through the first playing sample (position frozen) and clears once the new leader is playing and elapsed has advanced',
    frozen?.reason === 'leader-drop' && steady === null && sig.record === null, J({ frozen, steady }));
}

{
  // group-only PLAYING after re-form is not enough (live 2.10.9: group stays playing, new leader silent)
  const r = { ...drop, seenQuietAfterReform: true };
  const leadOnly = feed({ members: ['wiim_kitchen'], leaderId: 'wiim_kitchen', leaderMembers: ['wiim_kitchen'], groupPlaying: false, leaderPlaying: true, leaderElapsed: 0 });
  R.regroupObserve(r, leadOnly, 2_000);
  const frozenLead = R.regroupDone(r, leadOnly, 2_000);
  const advanced = feed({ members: ['wiim_kitchen'], leaderId: 'wiim_kitchen', leaderMembers: ['wiim_kitchen'], groupPlaying: false, leaderPlaying: true, leaderElapsed: 1 });
  R.regroupObserve(r, advanced, 2_000);
  check('U27 after re-form, the new leader must be playing on the MA feed and the position must have advanced; group-only PLAYING does not clear (no HA member entity is consulted)',
    R.regroupDone(r, feed({ members: ['wiim_kitchen'], leaderId: 'wiim_kitchen', leaderMembers: ['wiim_kitchen'], groupPlaying: true, leaderPlaying: false }), 2_000) === false
    && frozenLead === false
    && R.regroupDone(r, advanced, 2_000) === true
    && R.regroupFeedPlaying({ groupPlaying: true, leaderPlaying: false }) === false
    && R.regroupFeedPlaying({ groupPlaying: false, leaderPlaying: true }) === true);
}

{
  // Live drop 1: group went idle at set_members (01:59:28.213 CT) and only played later (01:59:34.100).
  // A leftover / at-reform 'playing' on the new leader must not clear the signal.
  const sig = new R.RegroupSignal(() => 90_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  const already = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage'));
  check('U28 a new leader already marked playing at the re-form (no post-re-form idle yet) does not clear the signal',
    already?.reason === 'leader-drop' && sig.record != null, J(already));
  const quieted = sig.snapshot('media_player.everywhere', 'idle', quiet(['wiim_kitchen', 'wiim_garage'], 'wiim_garage'));
  const thenPlay = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0));
  const thenAdv = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 1));
  await micro();
  check('U28b after that re-form is seen idle, the first playing sample (frozen position) stays on and the signal clears once elapsed has advanced',
    quieted?.reason === 'leader-drop' && thenPlay?.reason === 'leader-drop' && thenAdv === null && sig.record === null, J({ quieted, thenPlay, thenAdv }));
  // a failed re-form that dissolves forgets the quiet latch; a later already-playing re-form must not clear
  const sig2 = new R.RegroupSignal(() => 90_000);
  sig2.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  sig2.snapshot('media_player.everywhere', 'idle', quiet(['wiim_kitchen'], 'wiim_kitchen'));
  sig2.snapshot('media_player.everywhere', 'idle', feed({ members: [], leaderId: undefined, leaderMembers: [], groupPlaying: false, leaderPlaying: false }));
  const secondAlready = sig2.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen'], 'wiim_kitchen'));
  check('U28c dissolving a quiet re-form forgets the latch; a later already-playing re-form stays on',
    secondAlready?.reason === 'leader-drop' && sig2.record != null, J(secondAlready));
}

{
  // Fast re-form with no idle sample: first observation is already playing. Do not clear at once;
  // clear after 4 s of continuous new-leader playing, not at the 90 s ceiling.
  const r = { ...drop, until: 1_000 + R.REGROUP_CEILING_MS, seenQuietAfterReform: false };
  const formedPlay = playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0);
  const formedAdv = playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 1);
  R.regroupObserve(r, formedPlay, 11_600);
  check('U29 a fast re-form already playing does not clear at the first observation (the 4 s hold has not elapsed)',
    r.seenQuietAfterReform === false && r.reformSeenAt === 11_600 && r.postReformPlayingSince === 11_600
    && r.playElapsed === 0
    && R.regroupDone(r, formedPlay, 11_600) === false
    && R.regroupDone(r, formedPlay, 11_600 + 3_999) === false);
  check('U29b that fast re-form does not clear at 4 s while the position is still frozen at 0:00',
    R.regroupDone(r, formedPlay, 11_600 + 4_000) === false);
  R.regroupObserve(r, formedAdv, 11_600 + 4_000);
  check('U29b2 that fast re-form clears 4 s after the re-form was first observed once elapsed has also advanced, not at 90 s',
    R.regroupDone(r, formedAdv, 11_600 + 4_000) === true
    && (11_600 + R.REGROUP_PLAYING_HOLD_MS) === 15_600
    && (11_600 + 4_000) < (1_000 + R.REGROUP_CEILING_MS));
}

{
  // 11 s of false PLAYING before the re-form must not start the 4 s clock.
  const r = { ...drop, until: 1_000 + R.REGROUP_CEILING_MS, seenQuietAfterReform: false };
  R.regroupObserve(r, feed({
    members: [], leaderId: undefined, leaderMembers: [], groupPlaying: true, leaderPlaying: false,
  }), 600);
  R.regroupObserve(r, playing(['wiim_office'], 'wiim_office'), 2_000);
  const formedPlay = playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0);
  const formedAdv = playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 1);
  R.regroupObserve(r, formedPlay, 11_600);
  check('U29c an 11 s pre-re-form PLAYING blip does not start the 4 s hold; the clock starts when the re-form is first seen, and 4 s plus a frozen position is not done',
    r.reformSeenAt === 11_600 && r.postReformPlayingSince === 11_600 && r.playElapsed === 0
    && R.regroupDone(r, formedPlay, 11_600) === false
    && R.regroupDone(r, formedPlay, 4_000) === false
    && R.regroupDone(r, formedPlay, 11_600 + 3_999) === false
    && R.regroupDone(r, formedPlay, 11_600 + 4_000) === false);
  R.regroupObserve(r, formedAdv, 11_600 + 4_000);
  check('U29c2 that hold plus an advanced position clears, still well before the 90 s ceiling',
    R.regroupDone(r, formedAdv, 11_600 + 4_000) === true);
}

{
  const sig = new R.RegroupSignal(() => 90_000);
  sig.start('syncgroup_everywhere', 'wiim_office', 'leader-drop');
  const first = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0));
  await tick(2_000);
  const mid = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0));
  await tick(2_200);
  const held = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0));
  const late = sig.snapshot('media_player.everywhere', 'playing', playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 1));
  await micro();
  check('U29d the signal itself stays on through 4 s of playing with position frozen, and clears once a later feed update shows elapsed has advanced',
    first?.reason === 'leader-drop' && mid?.reason === 'leader-drop' && held?.reason === 'leader-drop'
    && late === null && sig.record === null,
    J({ first: first?.reason, mid: mid?.reason, held: held?.reason, late }));
}

{
  // No usable elapsed on the feed at all: do not clear on 'playing' alone; use the 12 s fallback.
  const r = { ...drop, until: 1_000 + R.REGROUP_CEILING_MS, seenQuietAfterReform: false };
  const formedPlay = playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage'); // no elapsed fields
  R.regroupObserve(r, formedPlay, 11_600);
  check('U29e with no usable position, 4 s of playing is not enough; the no-elapsed fallback clears at 12 s',
    r.playElapsed == null && r.noElapsedPlayingSince === 11_600
    && R.regroupDone(r, formedPlay, 11_600 + 4_000) === false
    && R.regroupDone(r, formedPlay, 11_600 + 11_999) === false
    && R.regroupDone(r, formedPlay, 11_600 + 12_000) === true);
}

{
  // Fresh Eyes v2: blip at 0.8 s, idle re-form at 10 s, 'playing' frozen at 0:00 from 25.6 s, position advancing from 33.6 s.
  const r = { ...drop, until: 0 + R.REGROUP_CEILING_MS, seenQuietAfterReform: false, startedAt: 0 };
  R.regroupObserve(r, feed({
    members: [], leaderId: undefined, leaderMembers: [], groupPlaying: true, leaderPlaying: false,
  }), 800);
  check('U30 a 0.8 s false PLAYING blip does not clear the signal',
    R.regroupDone(r, feed({ members: [], leaderId: undefined, leaderMembers: [], groupPlaying: true, leaderPlaying: false }), 800) === false
    && r.seenQuietAfterReform === false && r.reformSeenAt == null);
  R.regroupObserve(r, quiet(['wiim_kitchen', 'wiim_garage'], 'wiim_garage'), 10_000);
  check('U30b the idle re-form at 10 s latches quiet and keeps the signal on',
    r.seenQuietAfterReform === true && r.reformSeenAt === 10_000
    && R.regroupDone(r, quiet(['wiim_kitchen', 'wiim_garage'], 'wiim_garage'), 10_000) === false);
  const frozen = playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 0);
  R.regroupObserve(r, frozen, 25_600);
  check('U30c playing with position frozen at 0:00 from 25.6 s does not clear (still frozen at 33.5 s)',
    r.playElapsed === 0
    && R.regroupDone(r, frozen, 25_600) === false
    && R.regroupDone(r, frozen, 33_500) === false);
  const moved = playing(['wiim_kitchen', 'wiim_garage'], 'wiim_garage', 1);
  R.regroupObserve(r, moved, 33_600);
  check('U30d the signal clears once a fresh feed update shows elapsed has advanced from 33.6 s',
    R.regroupDone(r, moved, 33_600) === true);
}

{
  // Join-back with the same frozen-position pattern.
  const j = { ...join, until: 0 + R.REGROUP_CEILING_MS, startedAt: 0 };
  R.regroupObserve(j, quiet(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen'), 1_000);
  const frozen = playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 0);
  R.regroupObserve(j, frozen, 2_000);
  check('U31 a join-back that is playing with position frozen at 0:00 stays on',
    R.regroupDone(j, frozen, 2_000) === false
    && R.regroupDone(j, frozen, 10_000) === false
    && j.playElapsed === 0);
  const moved = playing(['wiim_kitchen', 'wiim_office'], 'wiim_kitchen', 1);
  R.regroupObserve(j, moved, 10_000);
  check('U31b that join-back clears once a later feed update shows elapsed has advanced',
    R.regroupDone(j, moved, 10_000) === true);
}

console.log(`\n${total - failures}/${total} regroup unit checks passed`);
process.exit(failures ? 1 : 0);

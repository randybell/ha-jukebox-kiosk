/**
 * "Regroup in progress" for Now Playing: a leader drop or join-back this card started.
 * Ordinary Music Assistant buffering is not this signal (the Speakers panel may still say
 * "Regrouping…" for that). Play state in the snapshot is from the live feed, not Home Assistant.
 *
 * Clear (leader-drop) only after Music Assistant's live feed shows the group re-formed on a
 * leader that is not the dropped speaker, and that new leader or the group is playing.
 * A 'playing' sample before the re-form (Randy's live drop: 11 s of false PLAYING 0.6 s after
 * the drop, before set_members on the new leader) is ignored. Never use HA member entities.
 */

export type RegroupReason = 'leader-drop' | 'join-back';

export interface RegroupState {
  active: true;
  reason: RegroupReason;
  /** Music Assistant group id, for example syncgroup_xupneynw */
  groupId: string;
  /** Home Assistant entity of the card's target, for example media_player.everywhere */
  entityId: string;
  /** Leader drop: the speaker that left. Join-back: the speaker joining. */
  speakerId: string;
  /** Date.now() when this signal turned on (a join-back refresh updates this) */
  startedAt: number;
  /** Date.now() deadline; the signal ends at this time if it has not already */
  until: number;
  /** The group's playback_state from Music Assistant's live feed, not HA */
  maPlaybackState: string | undefined;
}

export interface RegroupRecord {
  group: string;
  speakerId: string;
  reason: RegroupReason;
  startedAt: number;
  until: number;
  /** Live feed has shown this speaker out of the group since the regroup started (needed to close a join-back). */
  seenOut: boolean;
  /** The join call has finished: set_members add returned and the speaker is confirmed in. */
  joinSettled: boolean;
}

/** A slice of Music Assistant's live player feed used to decide if a regroup has settled.
 *  All fields come from MA players (the group and its leader), never from HA member entities. */
export interface RegroupFeed {
  /** group.group_members (speaker ids) from the live feed */
  members: readonly string[];
  /** The current sync leader's MA player_id (leaderOf), not an HA entity_id */
  leaderId?: string;
  /** The leader player's own group_members from the live feed (the native leader lists itself plus members) */
  leaderMembers?: readonly string[];
  /** group.playback_state === 'playing' on the live feed */
  groupPlaying: boolean;
  /** leader.playback_state === 'playing' on the live feed */
  leaderPlaying: boolean;
}

/** Expected regroup window (18 s safety net + 6 s buffering grace). Not a cutoff:
 *  the signal stays on while the group has not re-formed and started playing, up to REGROUP_CEILING_MS. */
export const REGROUP_MS = 24_000;
/** Hard ceiling so the signal can never stay on forever. Live: a failed re-form plus idle-grace
 *  plus a second re-form reached steady playing at +42.2 s. Play after a real re-form, a failed
 *  drop/join, or disconnect still clear earlier. Tests may shorten it through window.__jbRegroupMs. */
export const REGROUP_CEILING_MS = 90_000;

/**
 * The membership change this regroup is waiting for has landed.
 * A join-back after a leader drop is not landed just because the speaker is still
 * listed (Music Assistant may not have applied the drop yet); it needs to have
 * been seen out, or the join call itself to have finished.
 * A leader-drop has not landed until the group has re-formed on a new leader.
 */
export function regroupLanded(r: Pick<RegroupRecord, 'reason' | 'speakerId' | 'seenOut' | 'joinSettled'>, members: readonly string[]): boolean {
  if (r.reason === 'leader-drop') return !members.includes(r.speakerId);
  return members.includes(r.speakerId) && (r.seenOut || r.joinSettled);
}

/**
 * Leader-drop: the live feed shows the group re-formed on a leader that is not the dropped
 * speaker — that leader's id differs, it is in the group, and it lists the group's members.
 * Join-back: the joining speaker is in, and has been seen out or the join call has finished.
 */
export function regroupReformed(r: Pick<RegroupRecord, 'reason' | 'speakerId' | 'seenOut' | 'joinSettled'>, feed: RegroupFeed): boolean {
  if (r.reason === 'join-back') return regroupLanded(r, feed.members);
  const lead = feed.leaderId;
  if (!lead || lead === r.speakerId) return false;
  if (!feed.members.includes(lead)) return false;
  const lm = feed.leaderMembers;
  if (lm) {
    if (!lm.includes(lead)) return false;
    if (!feed.members.every((m) => lm.includes(m))) return false;
  }
  return true;
}

/** The group Now Playing is showing, or that group's current leader, is 'playing' on the MA live feed. */
export function regroupFeedPlaying(feed: Pick<RegroupFeed, 'groupPlaying' | 'leaderPlaying'>): boolean {
  return !!feed.groupPlaying || !!feed.leaderPlaying;
}

/** Hard ceiling has passed, or the group has re-formed and the new leader or the group is playing.
 *  Still-quiet at 24 s is not enough to clear; a 'playing' sample before the re-form is ignored.
 *  `until` is the 90 s ceiling (or a test override). */
export function regroupDone(r: RegroupRecord, feed: RegroupFeed, now = Date.now()): boolean {
  return now > r.until || (regroupReformed(r, feed) && regroupFeedPlaying(feed));
}

export function regroupSnapshot(r: RegroupRecord, entityId: string, maPlaybackState: string | undefined): RegroupState {
  return {
    active: true,
    reason: r.reason,
    groupId: r.group,
    entityId,
    speakerId: r.speakerId,
    startedAt: r.startedAt,
    until: r.until,
    maPlaybackState,
  };
}

/** Holds one in-flight regroup and its timeout. end() is safe to call more than once. */
export class RegroupSignal {
  private r: RegroupRecord | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private durationMs: () => number, private changed: () => void = () => {}) {}

  get record(): RegroupRecord | null { return this.r; }

  start(group: string, speakerId: string, reason: RegroupReason, keep?: { seenOut?: boolean }) {
    this.clearTimer();
    const windowMs = this.durationMs();
    const startedAt = Date.now();
    this.r = { group, speakerId, reason, startedAt, until: startedAt + windowMs, seenOut: !!keep?.seenOut, joinSettled: false };
    this.timer = setTimeout(() => this.end(), windowMs);
    this.changed();
  }

  /**
   * A join-back of the speaker this regroup is about: keep the signal on, switch the reason,
   * and restart the timeout. False (and no change) when there is no in-flight regroup, or it
   * is not that speaker. The caller starts a fresh join-back in that case only when the group
   * is still not playing (see join() in speakers-view). A join while the group is still playing
   * must not start a signal.
   * alreadyOut: the live feed already has the speaker out (keep that so a later in+playing can close it).
   */
  joinBack(speakerId: string, alreadyOut = false): boolean {
    if (!this.r || this.r.speakerId !== speakerId) return false;
    this.start(this.r.group, speakerId, 'join-back', { seenOut: this.r.seenOut || alreadyOut });
    return true;
  }

  /** The join call finished successfully. A join-back may now clear once the group is playing. */
  markJoinSettled() {
    if (!this.r) return;
    this.r = { ...this.r, joinSettled: true };
    this.changed();
  }

  end() {
    const had = this.r !== null || this.timer !== undefined;
    this.clearTimer();
    this.r = null;
    if (had) this.changed();
  }

  /**
   * Snapshot for Now Playing, or null when nothing is in progress or it has just settled.
   * Settled / expired records are cleared on a microtask so a render can finish first.
   * `now` is for tests.
   */
  snapshot(entityId: string | undefined, maPlaybackState: string | undefined, feed: RegroupFeed, now = Date.now()): RegroupState | null {
    const r = this.r;
    if (!r) return null;
    if (!feed.members.includes(r.speakerId)) r.seenOut = true;
    if (regroupDone(r, feed, now)) {
      queueMicrotask(() => this.end());
      return null;
    }
    return regroupSnapshot(r, entityId ?? '', maPlaybackState);
  }

  private clearTimer() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
  }
}

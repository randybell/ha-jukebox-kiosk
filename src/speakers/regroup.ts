/**
 * "Regroup in progress" for Now Playing: a leader drop or join-back this card started.
 * Ordinary Music Assistant buffering is not this signal (the Speakers panel may still say
 * "Regrouping…" for that). Play state in the snapshot is from the live feed, not Home Assistant.
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

/** 18 s safety net + 6 s buffering grace. A cap, not a delay; play clears earlier. */
export const REGROUP_MS = 24_000;

/**
 * The membership change this regroup is waiting for has landed.
 * A join-back after a leader drop is not landed just because the speaker is still
 * listed (Music Assistant may not have applied the drop yet); it needs to have
 * been seen out, or the join call itself to have finished.
 */
export function regroupLanded(r: Pick<RegroupRecord, 'reason' | 'speakerId' | 'seenOut' | 'joinSettled'>, members: readonly string[]): boolean {
  if (r.reason === 'leader-drop') return !members.includes(r.speakerId);
  return members.includes(r.speakerId) && (r.seenOut || r.joinSettled);
}

/** Time is up, or the membership change has landed and the current leader is playing. */
export function regroupDone(r: RegroupRecord, members: readonly string[], leadPlaying: boolean, now = Date.now()): boolean {
  return now > r.until || (regroupLanded(r, members) && leadPlaying);
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
   * and restart the timeout. False (and no change) when this is not that speaker.
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
   */
  snapshot(entityId: string | undefined, maPlaybackState: string | undefined, members: readonly string[], leadPlaying: boolean): RegroupState | null {
    const r = this.r;
    if (!r) return null;
    if (!members.includes(r.speakerId)) r.seenOut = true;
    if (regroupDone(r, members, leadPlaying)) {
      queueMicrotask(() => this.end());
      return null;
    }
    return regroupSnapshot(r, entityId ?? '', maPlaybackState);
  }

  private clearTimer() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
  }
}

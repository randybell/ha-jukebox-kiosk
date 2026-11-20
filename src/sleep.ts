/**
 * Now Playing sleep timer helpers.
 * MA players/sleep_timer/{get,set,clear} through jukebox_kiosk, with the entity's
 * MA player id (the same id MA's app sends). Updates come from player_sleep_timer_updated.
 */
import type { MaBackend } from './backend/types';

/** Chooser durations in minutes (Off is 0). MA's five presets. */
export const SLEEP_MINUTES = [15, 30, 45, 60, 120] as const;
export type SleepMinutes = 0 | (typeof SLEEP_MINUTES)[number];
/** MA frontend en.json `sleep_timer_preset` (2.17.297.post3 and 2.17.370). */
export const SLEEP_LABEL: Record<(typeof SLEEP_MINUTES)[number], string> = {
  15: '15 minutes',
  30: '30 minutes',
  45: '45 minutes',
  60: '1 hour',
  120: '2 hours',
};

/** MA `SleepTimerMode` (server 2.11 / frontend 2.17.370). */
export type SleepTimerMode = 'duration' | 'end_of_item' | 'end_of_chapter';

export const isEndOfContentMode = (mode?: string | null): mode is 'end_of_item' | 'end_of_chapter' =>
  mode === 'end_of_item' || mode === 'end_of_chapter';

/** MA `sleepTimerActive` (`sleep_timer.ts:64-68`): end-of-item/chapter is on even with no expiry. */
export function sleepIsActive(expiresAt: number | null | undefined, mode?: string | null, nowSec = Date.now() / 1000): boolean {
  if (isEndOfContentMode(mode)) return true;
  return remainFromExpires(expiresAt, nowSec) > 0;
}

/** MA `endOfContentLabel` + en.json `sleep_timer_end_of_item.*` / `sleep_timer_end_of_chapter`. */
export function sleepModeLabel(mode?: string | null, mediaType?: string): string | undefined {
  if (mode === 'end_of_chapter') return 'End of chapter';
  if (mode !== 'end_of_item') return undefined;
  const t = String(mediaType ?? '').toLowerCase();
  if (t === 'track') return 'End of track';
  if (t === 'podcast_episode') return 'End of episode';
  if (t === 'audiobook') return 'End of audiobook';
  return 'End of current item';
}

export function parseSleepMode(raw: unknown): SleepTimerMode | undefined {
  if (raw && typeof raw === 'object' && 'mode' in (raw as object)) {
    const m = (raw as { mode: unknown }).mode;
    if (m === 'duration' || m === 'end_of_item' || m === 'end_of_chapter') return m;
  }
  return undefined;
}

/** Remaining seconds → Music Assistant's formatDuration: "MM:SS" under an hour, "HH:MM:SS" from an hour, every part zero-padded (45:00, 01:59:59). */
export function fmtSleepRemain(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h ? `${p2(h)}:${p2(m)}:${p2(ss)}` : `${p2(m)}:${p2(ss)}`;
}

/** Countdown chip text, e.g. "Sleep 29:41". */
export function sleepLabel(secs: number): string {
  return `Sleep ${fmtSleepRemain(secs)}`;
}

/** Seconds left until a unix (UTC) expiry timestamp; 0 when unset or past. */
export function remainFromExpires(expiresAt: number | null | undefined, nowSec = Date.now() / 1000): number {
  if (expiresAt == null || !(expiresAt > 0)) return 0;
  return Math.max(0, expiresAt - nowSec);
}

/** True when the backend exposes the kiosk sleep-timer commands. */
export function canMaSleep(be: Pick<MaBackend, 'sleepTimerSet'> | { sleepTimerSet?: unknown } | undefined | null): boolean {
  return typeof be?.sleepTimerSet === 'function';
}

/** Parse MA get/set response into a unix expiry, or null when cleared / unknown. */
export function parseExpires(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (raw && typeof raw === 'object' && 'expires_at' in (raw as object)) {
    const v = (raw as { expires_at: unknown }).expires_at;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    return null;
  }
  if (raw && typeof raw === 'object' && typeof (raw as any).sleep_timer_expires_at === 'number') {
    const v = (raw as any).sleep_timer_expires_at;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

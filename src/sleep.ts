/**
 * Now Playing sleep timer helpers.
 * MA players/sleep_timer/{get,set,clear} through jukebox_kiosk, with the entity's
 * MA player id (the same id MA's app sends). Updates come from player_sleep_timer_updated.
 */
import type { MaBackend } from './backend/types';

/** Chooser durations in minutes (Off is 0). MA's five presets. */
export const SLEEP_MINUTES = [15, 30, 45, 60, 120] as const;
export type SleepMinutes = 0 | (typeof SLEEP_MINUTES)[number];

/** Remaining seconds → "M:SS" (tabular). */
export function fmtSleepRemain(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
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

/**
 * Now Playing sleep timer helpers.
 * Prefer Music Assistant's server-side players/sleep_timer/{get,set,clear} through be.send
 * (survives the kiosk screen sleeping). Fall back to a card-side timer that pauses via media_player.
 */
import type { HomeAssistant } from './types';

/** Chooser durations in minutes (Off is 0). */
export const SLEEP_MINUTES = [15, 30, 60] as const;
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

/**
 * HA media_player entity → MA player_id for sleep_timer commands.
 * Prefer active_queue (the live group/queue id), else mass_player_id.
 */
export function sleepPlayerId(entity: string, hass: HomeAssistant | undefined): string | undefined {
  const a = hass?.states[entity]?.attributes ?? {};
  if (typeof a.active_queue === 'string' && a.active_queue) return a.active_queue;
  if (typeof a.mass_player_id === 'string' && a.mass_player_id) return a.mass_player_id;
  return undefined;
}

/** True when the backend can forward MA sleep_timer commands. */
export function canMaSleep(be: { caps?: { send?: boolean } } | undefined | null): boolean {
  return !!be?.caps?.send;
}

/** Parse MA get/set response into a unix expiry, or null when cleared / unknown. */
export function parseExpires(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as any).sleep_timer_expires_at === 'number') {
    const v = (raw as any).sleep_timer_expires_at;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

import type { HomeAssistant } from './types';

/**
 * 0.7.10: volume_set while Home Assistant is disconnected (iPad waking after a long idle: every slider step used to wait in
 * HA's queue and fail at once, one grey "connection lost" toast each). Sliders and presets go through sendVolume:
 *  - connected: one media_player.volume_set with notifyOnError=false (the card reports failures itself);
 *  - disconnected (or a call fails with "connection lost"): nothing is sent; only the LAST value per speaker is kept;
 *  - back online (volFlush, called by the card on reconnect): each kept value is sent once; values older than STALE_MS are dropped.
 * The card shows one "Reconnecting to Home Assistant…" status while volDown() is true.
 */
export const STALE_MS = 30_000;
const pending = new Map<string, { v: number; t: number }>();
let down = false;
const subs = new Set<() => void>();
export const volDown = () => down;
export function onVolState(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
export function setVolDown(d: boolean) { if (down !== d) { down = d; subs.forEach((f) => f()); } }
export const connected = (hass?: HomeAssistant) => (hass?.connection as any)?.connected !== false;
export const isConnLost = (err: any) => err?.error?.code === 3 || err?.code === 3 || /connection lost/i.test(String(err?.message ?? err?.error?.message ?? ''));
/** Test hook / introspection: the values waiting for the connection. */
export const pendingVolumes = () => new Map(pending);

export async function sendVolume(hass: HomeAssistant | undefined, id: string, v: number): Promise<void> {
  if (!hass) return;
  if (down || !connected(hass)) { pending.set(id, { v, t: Date.now() }); setVolDown(true); return; }
  try {
    await hass.callService('media_player', 'volume_set', { volume_level: v }, { entity_id: id }, false);
  } catch (err) {
    if (!isConnLost(err)) throw err;
    if (!pending.has(id)) pending.set(id, { v, t: Date.now() });
    setVolDown(true);
  }
}
/** Connection is back: hide the status and send each kept value once (stale ones are dropped). */
export function volFlush(hass: HomeAssistant | undefined) {
  if (!hass || !connected(hass)) return;
  setVolDown(false);
  const now = Date.now();
  for (const [id, p] of [...pending]) {
    pending.delete(id);
    if (now - p.t > STALE_MS) continue;
    void sendVolume(hass, id, p.v).catch((e) => console.warn('[jukebox-card] volume_set failed', e));
  }
}

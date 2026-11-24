/**
 * 2.4 "Music Assistant is offline": whether Home Assistant holds a working Music Assistant connection, from the
 * integration's jukebox_kiosk/subscribe_ma_status ({connected} at once, then on every change).
 *  - The integration follows Home Assistant's music_assistant config entry: `false` as soon as HA starts restarting its
 *    MA connection (MA dropped out) or is waiting to retry, `true` once HA has a new client with MA's players and queues.
 *  - Unknown counts as online: an older integration, the native backend or a failed subscription never shows the notice.
 *  - Listeners hear every change; `back` is true when Music Assistant just came back (the card then reloads fresh).
 * One subscription per backend; no DOM. Unit-tested in test/unit/ma-status.unit.mjs.
 */
import type { MaBackend } from './backend/types';
import type { HomeAssistant } from './types';

export class MaStatus {
  /** false only while the integration says Home Assistant has no Music Assistant connection */
  online = true;
  private sub?: { be: MaBackend; off?: () => void; closed: boolean };
  private fns = new Set<(back: boolean) => void>();

  onChange(fn: (back: boolean) => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }

  /** subscribe for this backend once it can say (caps.maStatus) and hass has a websocket; anything else stops */
  sync(be: MaBackend | undefined, hass: HomeAssistant | undefined) {
    if (!be?.subscribeMaStatus || !be.caps.maStatus || !hass?.connection) { this.stop(); return; }
    if (this.sub?.be === be) return;
    this.stop();
    const sub: { be: MaBackend; off?: () => void; closed: boolean } = { be, closed: false };
    this.sub = sub;
    be.subscribeMaStatus((ev) => { if (!sub.closed) this.set(ev?.connected !== false); })
      .then((off) => { if (sub.closed) off(); else sub.off = off; })
      .catch((e) => {
        console.warn('[jukebox-card] Music Assistant status unavailable', e);
        if (this.sub === sub) { sub.closed = true; this.sub = undefined; this.set(true, false); }
      });
  }

  /** drop the subscription (card removed, backend changed); the notice goes with it, without a reload */
  stop() {
    const sub = this.sub;
    this.sub = undefined;
    if (sub) { sub.closed = true; sub.off?.(); }
    this.set(true, false);
  }

  private set(online: boolean, reload = true) {
    if (online === this.online) return;
    this.online = online;
    const back = online && reload;
    for (const f of this.fns) f(back);
  }
}

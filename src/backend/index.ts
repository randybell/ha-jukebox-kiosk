import type { HomeAssistant, JukeboxCardConfig } from '../types';
import { KioskBackend, KIOSK_DOMAIN, capsFromServer } from './kiosk';
import { MassQueueBackend } from './mass-queue';
import { NativeBackend } from './native';
import { MaDirectBackend } from './ma-direct';
import type { BackendKind, MaBackend } from './types';

export * from './types';
export { KioskBackend, MassQueueBackend, NativeBackend, MaDirectBackend, KIOSK_DOMAIN, capsFromServer };
export * as maDirect from './ma-direct';

export const massQueueEntryId = (c: Partial<JukeboxCardConfig>) => c.mass_queue_entry_id || c.queue_config_entry_id || '';
/**
 * backend: auto (default) -> kiosk when the jukebox_kiosk integration is loaded; else mass_queue when
 * mass_queue_entry_id is set or the mass_queue integration is loaded (0.5.x: its queue services work without an
 * entry id); else native. When hass.config.components is unknown, auto keeps the 0.5.x mass_queue path.
 * backend: ma_direct (Music Assistant's own WebSocket, ma_url + ma_token) is never picked by auto; it is opt-in.
 * An explicit kiosk/mass_queue/native/ma_direct always wins.
 */
export function pickBackend(c: Partial<JukeboxCardConfig>, hass?: HomeAssistant): BackendKind {
  const want = c.backend ?? 'auto';
  if (want !== 'auto') return want;
  const comps = hass?.config?.components;
  if (comps?.includes(KIOSK_DOMAIN)) return 'kiosk';
  if (massQueueEntryId(c) || !Array.isArray(comps) || comps.includes('mass_queue')) return 'mass_queue';
  return 'native';
}
export function createBackend(kind: BackendKind, c: Partial<JukeboxCardConfig>, hassRef: () => HomeAssistant | undefined): MaBackend {
  if (kind === 'kiosk') return new KioskBackend(hassRef);
  if (kind === 'mass_queue') return new MassQueueBackend(hassRef, massQueueEntryId(c));
  if (kind === 'ma_direct') return new MaDirectBackend(hassRef, c.ma_url, c.ma_token);
  return new NativeBackend(hassRef);
}
/** backend identity: a new instance only when this changes */
export const backendKey = (kind: BackendKind, c: Partial<JukeboxCardConfig>) =>
  `${kind}|${kind === 'mass_queue' ? massQueueEntryId(c) : kind === 'ma_direct' ? `${c.ma_url ?? ''}|${c.ma_token ?? ''}` : ''}`;

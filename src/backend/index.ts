import type { HomeAssistant, JukeboxCardConfig } from '../types';
import { KioskBackend, KIOSK_DOMAIN, capsFromServer, extFromServer } from './kiosk';
import { MassQueueBackend } from './mass-queue';
import { NativeBackend } from './native';
import type { BackendKind, MaBackend } from './types';

export * from './types';
export { KioskBackend, MassQueueBackend, NativeBackend, KIOSK_DOMAIN, capsFromServer, extFromServer };

export const massQueueEntryId = (c: Partial<JukeboxCardConfig>) => c.mass_queue_entry_id || c.queue_config_entry_id || '';
/**
 * backend: auto (default) -> kiosk when the jukebox_kiosk integration is loaded; else mass_queue when
 * mass_queue_entry_id is set or the mass_queue integration is loaded (0.5.x: its queue services work without an
 * entry id); else native. When hass.config.components is unknown, auto keeps the 0.5.x mass_queue path.
 * An explicit kiosk/mass_queue/native always wins.
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
  return new NativeBackend(hassRef);
}
/** backend identity: a new instance only when this changes */
export const backendKey = (kind: BackendKind, c: Partial<JukeboxCardConfig>) => `${kind}|${kind === 'mass_queue' ? massQueueEntryId(c) : ''}`;

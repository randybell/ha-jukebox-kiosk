import type { HomeAssistant, JukeboxCardConfig } from '../types';
import { KioskBackend, KIOSK_DOMAIN, capsFromServer, extFromServer } from './kiosk';
import { NativeBackend } from './native';
import type { BackendKind, MaBackend } from './types';

export * from './types';
export { KioskBackend, NativeBackend, KIOSK_DOMAIN, capsFromServer, extFromServer };

/**
 * backend: auto (default) -> kiosk when the jukebox_kiosk integration is loaded, else native (core Music Assistant
 * services only). An explicit kiosk / native (YAML only) always wins.
 */
export function pickBackend(c: Partial<JukeboxCardConfig>, hass?: HomeAssistant): BackendKind {
  const want = c.backend ?? 'auto';
  if (want !== 'auto') return want;
  return hass?.config?.components?.includes(KIOSK_DOMAIN) ? 'kiosk' : 'native';
}
export function createBackend(kind: BackendKind, hassRef: () => HomeAssistant | undefined): MaBackend {
  return kind === 'kiosk' ? new KioskBackend(hassRef) : new NativeBackend(hassRef);
}

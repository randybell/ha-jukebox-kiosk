import type { HomeAssistant } from '../types';
import { KioskBackend, KIOSK_DOMAIN, capsFromServer, extFromServer } from './kiosk';
import { NativeBackend } from './native';
import type { BackendKind, MaBackend } from './types';

export * from './types';
export { KioskBackend, NativeBackend, KIOSK_DOMAIN, capsFromServer, extFromServer };

/** Always automatic: kiosk when the jukebox_kiosk integration is loaded, else native (core Music Assistant services only). */
export function pickBackend(hass?: HomeAssistant): BackendKind {
  return hass?.config?.components?.includes(KIOSK_DOMAIN) ? 'kiosk' : 'native';
}
export function createBackend(kind: BackendKind, hassRef: () => HomeAssistant | undefined): MaBackend {
  return kind === 'kiosk' ? new KioskBackend(hassRef) : new NativeBackend(hassRef);
}

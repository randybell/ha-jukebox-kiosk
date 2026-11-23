/** Which Home Assistant entities are Music Assistant players (#99). */
import type { HomeAssistant } from './types';

/**
 * True once Home Assistant has sent its entity registry (`hass.entities`). Until then nothing can be called a
 * Music Assistant player or not one, so the card neither lists rooms nor shows the "not a player" warning.
 */
export function registryReady(hass?: HomeAssistant): boolean {
  const reg = hass?.entities;
  if (!reg) return false;
  for (const _ in reg) return true;
  return false;
}

/**
 * A `media_player` made by Home Assistant's Music Assistant integration: entity registry platform
 * `music_assistant`. The same rule as the editor's pickers (`integration: music_assistant`) and the Jukebox Kiosk
 * integration (players.py), whose registry unique_id is the Music Assistant player id. Never a name or a state attribute.
 */
export function isMaPlayer(hass: HomeAssistant | undefined, entity: string | undefined): boolean {
  return !!entity && entity.startsWith('media_player.') && hass?.entities?.[entity]?.platform === 'music_assistant';
}

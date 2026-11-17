/** First Music Assistant media_player Home Assistant already knows. */
import type { HomeAssistant } from './types';

/**
 * The first `media_player` in `hass.entities` (object-key order) whose platform is
 * music_assistant and that also has a state. Used when Home Assistant asks the card
 * for a stub config for a newly added card. Returns undefined when there is none.
 */
export function firstMusicAssistantPlayer(hass?: HomeAssistant): string | undefined {
  const reg = hass?.entities ?? {};
  return Object.keys(reg).find((id) => id.startsWith('media_player.') && reg[id]?.platform === 'music_assistant' && !!hass?.states[id]);
}

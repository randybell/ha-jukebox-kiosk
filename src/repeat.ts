/**
 * #139: the card's repeat button cycles off → all → off. Repeat-one is not offered
 * (too easy to hit by accident). A player that already reports 'one' (set elsewhere)
 * is still shown as 'one', and a tap goes to off. There is no setting for this.
 */
export type RepeatMode = 'off' | 'all' | 'one';

/** what the card shows: only off, all, or one; anything unknown is off */
export const shownRepeat = (r: unknown): RepeatMode => (r === 'all' || r === 'one' ? r : 'off');
/** the button cycle: off → all → off; a player already on one goes to off */
export const nextRepeat = (r: unknown): RepeatMode => (shownRepeat(r) === 'off' ? 'all' : 'off');

/** Music Assistant's English labels for the three modes (en.json repeat_mode.*) */
export const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: 'Repeat off',
  all: 'Repeat entire queue',
  one: 'Repeat single track',
};

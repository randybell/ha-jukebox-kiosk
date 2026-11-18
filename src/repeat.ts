/**
 * #139: repeat follows Music Assistant 2.10.12. The button cycles off → all → one → off
 * (Repeat off / Repeat entire queue / Repeat single track). A player that reports 'one' is
 * shown as 'one'. There is no coerce-to-all and no setting to bring the old behaviour back.
 */
export type RepeatMode = 'off' | 'all' | 'one';

/** what the card shows: only off, all, or one; anything unknown is off */
export const shownRepeat = (r: unknown): RepeatMode => (r === 'all' || r === 'one' ? r : 'off');
/** Music Assistant's cycle: off → all → one → off */
export const nextRepeat = (r: unknown): RepeatMode => {
  const cur = shownRepeat(r);
  return cur === 'off' ? 'all' : cur === 'all' ? 'one' : 'off';
};

/** Music Assistant's English labels for the three modes (en.json repeat_mode.*) */
export const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: 'Repeat off',
  all: 'Repeat entire queue',
  one: 'Repeat single track',
};

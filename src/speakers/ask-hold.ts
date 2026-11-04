/**
 * 0.6.5 (Q62): the status chip's pending question. Only another question replaces it; any other message that lands while
 * it waits (a late "X joined · Undo" from an earlier change, a refresh error, …) is held and shown once the question is
 * answered or times out. In 0.6.4 such a message replaced the chip and answered the question with "no".
 */
export interface Held<T> { v: T; at: number }
export class AskHold<T> {
  private res?: (ok: boolean) => void;
  private held?: Held<T>;
  get pending() { return !!this.res; }
  get waiting(): T | undefined { return this.held?.v; }
  /** start a question (an older one answers no) */
  ask(resolve: (ok: boolean) => void) { this.answer(false); this.res = resolve; }
  /** a new chip message: true = show it now; false = held behind the pending question (latest wins) */
  admit(v: T, isAsk: boolean, now = Date.now()): boolean {
    if (this.res && !isAsk) { this.held = { v, at: now }; return false; }
    this.answer(false); this.held = undefined;
    return true;
  }
  /** answer the pending question (no-op when none) */
  answer(ok: boolean) { const r = this.res; this.res = undefined; r?.(ok); }
  /** the held message with the display time it has left, or undefined (none, still asking, or it went stale) */
  release(full: (v: T) => number, now = Date.now()): { v: T; ms: number } | undefined {
    const h = this.held;
    if (!h || this.res) return undefined;
    this.held = undefined;
    const ms = full(h.v) - (now - h.at);
    return ms > 500 ? { v: h.v, ms } : undefined;
  }
}

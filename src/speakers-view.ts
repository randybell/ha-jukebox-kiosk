import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from './styles';
import { icon } from './icons';
import { mediaStyles, noFocus, roomsOf, fire } from './shared';
import { throttle } from './slider';
import { sendVolume } from './vol-send';
import './slider';
import type { HomeAssistant, JukeboxCardConfig, PresetConfig } from './types';
import { SpeakerError, timeouts, type SpeakerStore } from './speakers/ma';
import {
  mapRooms, targetMa, targetsOf, canGroup, canVolume, kindOf, isActive, membersOf, leaderOf, holderOf,
  takeovers, takeoverText, dropBlock, planMembers, presetSpeakers, maPresets, type MaPlayer, type Players, type Room, type Takeover, type Target,
} from './speakers/model';
import { defineElement } from './define';
import { AskHold } from './speakers/ask-hold';

/**
 * Speakers panel (0.5.0). Opened from the header status.
 * fixed mode (default): a volume / mute mixer for the configured rooms, nothing else (no Music Assistant calls).
 * dynamic mode: pick the group the card plays on (Move = player_queues/transfer), join / drop / take speakers
 * (players/cmd/set_members), room presets. Grouping is a UI lock for allowed users only; guests get the mixer.
 * Changes are optimistic, time out, show a toast on failure and offer Undo for a few seconds.
 * 0.6.4: every grouping message (progress, done + Undo, errors, takeover questions) is ONE small status chip in the top-right
 * corner, under the header clock. No centred dialog unless `confirm_drop: true` (the 0.6.3 behaviour).
 */
interface Ask { title: string; sub?: string; lines: string[]; ok: string; danger?: boolean; resolve: (ok: boolean) => void }
export type { InlineRoomState as InlineRoom } from './speakers/model';
import type { InlineRoomState as InlineRoom } from './speakers/model';
interface Undo { label: string; run: () => Promise<void> }
/** the top-right status chip: info (auto-hides ~4 s), busy (until replaced), error, ask (an action button + dismiss) */
type ChipKind = 'info' | 'busy' | 'error' | 'ask';
interface Chip { text: string; kind: ChipKind; act?: { label: string; run: () => void }; n: number }
interface Pending<T> { v: T; t: number }
interface StatusOpts { kind?: ChipKind; undo?: Undo; act?: Chip['act']; ms?: number }
const UNDO_MS = 4000;
const CHIP_MS = 4000;
const ERROR_MS = 6000;
const ASK_MS = 6000;
const BUSY_MS = 15000;
const ms = (k: string, d: number) => Number((window as any)[k] ?? d);
const chipMs = (kind: ChipKind, undo: boolean) => kind === 'busy' ? BUSY_MS : kind === 'error' ? ms('__jbErrorMs', ERROR_MS) : kind === 'ask' ? ms('__jbAskMs', ASK_MS)
  : undo ? ms('__jbUndoMs', UNDO_MS) : ms('__jbChipMs', CHIP_MS);
const HOLD_MS = 4000;
const REGROUP_MS = 15000;
const VOL_THROTTLE_MS = 200;

export class JbSpeakers extends LitElement {
  static properties = {
    hass: { attribute: false }, config: { attribute: false }, store: { attribute: false }, open: { type: Boolean, reflect: true }, keep: { type: Boolean },
    _ask: { state: true }, _chip: { state: true }, _busy: { state: true }, _tick: { state: true }, _regroup: { state: true },
  };
  hass?: HomeAssistant;
  config!: JukeboxCardConfig;
  store?: SpeakerStore;
  open = false;
  /** 0.6.3: Now Playing shows Drop/Add per room: keep the MA player list fresh (slower poll) while the panel is closed */
  keep = false;
  private _ask: Ask | null = null;
  private _chip: Chip | null = null;
  private _chipN = 0;
  /** the pending chip question (false when it times out, is dismissed or replaced by another question) and any message
   * that arrived while it waits (Q62) */
  private _hold = new AskHold<{ text: string; o: StatusOpts }>();
  /** optimistic grouping: speaker (MA id) → 'in' | 'out', target entity → 'move' */
  private _busy = new Map<string, string>();
  private _tick = 0;
  /** after the leader is dropped MA re-forms the group on the next member after ~5.9 s of silence (live 2.10.9): 'Regrouping…' */
  private _regroup: { group: string; old: string; until: number } | null = null;
  private _regroupTimer?: number;
  private _unsub?: () => void;
  private _chipTimer?: number;
  private vol = new Map<string, Pending<number>>();
  private mute = new Map<string, Pending<boolean>>();
  private senders = new Map<string, ReturnType<typeof throttle<[number]>>>();
  private stateFns = new Set<() => void>();
  private _lastHassRefresh = 0;

  private get dynamic() { return this.config?.speaker_mode === 'dynamic'; }
  private get mayGroup() { return canGroup(this.config, this.hass?.user); }
  /** 0.6.4: confirm_drop: true brings back the 0.6.3 centred confirms (drop the leader, last room → Pause, takeovers) */
  private get modal() { return this.config?.confirm_drop === true; }

  protected willUpdate(ch: PropertyValues) {
    if (ch.has('open') || ch.has('store') || ch.has('keep') || ch.has('config')) {
      const want = this.dynamic && !!this.store && (this.open || (this.keep && this.mayGroup));
      if (want) {
        if (!this._unsub) this._unsub = this.store!.onChange(() => this._tick++) as any;
        this.store!.start(!this.open);
      } else { this.store?.stopPolling(); this._unsub?.(); this._unsub = undefined; }
    }
    // inline (panel closed): HA saw the target or a room change → read MA again soon (at most once a second)
    if (ch.has('hass') && !this.open && this.keep && this._unsub && this.store?.loaded) {
      const old = ch.get('hass') as HomeAssistant | undefined;
      const ids = [this.config?.entity!, ...roomsOf(this.config, this.hass).map((r) => r.entity)];
      if (old && ids.some((id) => old.states[id]?.state !== this.hass?.states[id]?.state) && Date.now() - this._lastHassRefresh > 1000) {
        this._lastHassRefresh = Date.now(); void this.store.refresh();
      }
    }
  }
  protected updated() { for (const f of this.stateFns) f(); }
  /** 0.6.3: Now Playing re-renders its room buttons when the panel state (MA players, busy, regrouping) changes */
  onState(fn: () => void) { this.stateFns.add(fn); return () => this.stateFns.delete(fn); }
  /** 0.6.3: a room's group state and action for Now Playing (same logic as the panel row); undefined = no buttons */
  inline(entity: string): InlineRoom | undefined {
    if (!this.dynamic || !this.mayGroup || !this.store?.loaded) return undefined;
    const x = this.ctx();
    const r = x.rooms.find((y) => y.entity === entity);
    if (!r || !r.ma || x.kind !== 'dynamic') return undefined;
    const rs = this.roomState(r, x, true);
    return { inT: rs.inT, where: rs.where, busy: rs.busy, leader: x.active && x.leader === r.ma && x.members.length > 1,
      act: rs.act ? { label: rs.act.label, kind: rs.act.kind, dis: !!rs.act.dis || rs.act.kind === 'blocked' } : undefined };
  }
  /** 0.6.3: run a room's action from Now Playing (confirmations, toasts and Undo come from this element) */
  inlineAct(entity: string) {
    const x = this.ctx();
    const r = x.rooms.find((y) => y.entity === entity);
    if (r) this.roomState(r, x, this.dynamic && this.mayGroup && x.kind === 'dynamic' && !!this.store?.loaded).act?.fn();
  }
  /** 0.6.3: 'Regrouping…' for Now Playing */
  inlineRegrouping() { return this.dynamic && !!this.store?.loaded && this.regrouping(this.ctx()); }
  disconnectedCallback() { super.disconnectedCallback(); window.clearTimeout(this._regroupTimer); window.clearTimeout(this._chipTimer); this.store?.stopPolling(); this._unsub?.(); this._unsub = undefined; }
  connectedCallback() { super.connectedCallback(); if (this.hasUpdated) this.requestUpdate('keep'); }

  /* ---------------- public: start confirmation (used by the card's start guard, panel open or not) ---------------- */
  ask(a: Omit<Ask, 'resolve'>): Promise<boolean> {
    this._ask?.resolve(false);
    return new Promise((resolve) => { this._ask = { ...a, resolve }; });
  }
  private answer(ok: boolean) { const a = this._ask; this._ask = null; a?.resolve(ok); }

  /** Lines for starting `target` (idle) with its starting speakers; [] when nothing is taken. */
  startTakeovers(entity: string, players: Players): { lines: string[]; list: Takeover[] } {
    const c = this.config, hass = this.hass;
    const t = targetsOf(c, hass).find((x) => x.entity === entity);
    const ma = targetMa(entity, hass, players);
    const g = ma ? players.get(ma) : undefined;
    if (!g || isActive(g)) return { lines: [], list: [] };
    const rooms = mapRooms(roomsOf(c, hass), hass, players);
    // starting speakers: the card's target members, else what players/all lists for the idle group (live 2.10.9: its current
    // members), else MA's configured defaults (config/players/get); static groups: their fixed list
    const cfg = this.store?.configs.get(ma!);
    const would = t?.members?.length ? t.members.map((e) => rooms.find((r) => r.entity === e)?.ma).filter((x): x is string => !!x)
      : kindOf(g, cfg) === 'static' ? (g.static_group_members.length ? g.static_group_members : cfg?.members ?? g.group_members)
      : (() => { const now = g.group_members.filter((id) => players.get(id) && players.get(id)!.type !== 'group'); return now.length ? now : cfg?.members ?? []; })();
    const list = takeovers(ma, would, players, true);
    return { list, lines: list.map((x) => takeoverText(x, (id) => this.nameOf(id, players, rooms))) };
  }

  /* ---------------- helpers ---------------- */
  private nameOf(id: string, players: Players, rooms: Room[]) {
    const r = rooms.find((x) => x.ma === id);
    if (r) return r.name;
    const t = targetsOf(this.config, this.hass).find((x) => targetMa(x.entity, this.hass, players) === id);
    return t?.name ?? players.get(id)?.name ?? id;
  }
  /** 0.6.4: show one status message in the top-right chip; it replaces whatever was there.
   * 0.6.5 (Q62): a pending question is only replaced by another question. Any other message that lands meanwhile (a late
   * "X joined · Undo" from an earlier change, a refresh error, …) waits and shows once the question is answered or times out;
   * before, it answered the question with "no". */
  private status(text: string, o: StatusOpts = {}) {
    const kind = o.kind ?? 'info';
    if (!this._hold.admit({ text, o }, kind === 'ask')) return;
    window.clearTimeout(this._chipTimer);
    const act = o.undo ? { label: 'Undo', run: () => void this.doUndo(o.undo!) } : o.act;
    const n = ++this._chipN;
    this._chip = { text, kind, act, n };
    const t = o.ms ?? chipMs(kind, !!o.undo);
    this._chipTimer = window.setTimeout(() => this.clearChip(n), t);
  }
  /** hide the chip (only if it still shows message n, when given) */
  private clearChip(n?: number) {
    if (n !== undefined && this._chip?.n !== n) return;
    window.clearTimeout(this._chipTimer); this._chip = null;
    this._hold.answer(false);
    const l = this._hold.release((v) => v.o.ms ?? chipMs(v.o.kind ?? 'info', !!v.o.undo));
    if (l) this.status(l.v.text, { ...l.v.o, ms: l.ms });
  }
  /** v0.7: a message from elsewhere in the card (hearts) in this one chip; it never replaces a pending question */
  notify(text: string, kind: 'info' | 'error' = 'info') { if (text) this.status(text, { kind }); }
  /** Q62 (tests): a question is waiting in the chip */
  get asking() { return this._hold.pending; }
  private toast(t: string) { this.status(t); }
  private fail(t: string) { this.status(t, { kind: 'error' }); }
  /** a non-modal question in the chip: true when its action is tapped before it hides */
  private chipAsk(text: string, ok: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.status(text, { kind: 'ask', act: { label: ok, run: () => { this._hold.answer(true); this.clearChip(); } } });
      this._hold.ask(resolve);
    });
  }
  private async doUndo(u: Undo) {
    this.status('Undoing…', { kind: 'busy' });
    try { await u.run(); this.toast('Undone'); } catch (e) { this.fail(`Undo did not work: ${errText(e)}`); }
  }
  private setBusy(k: string, v?: string) { const m = new Map(this._busy); if (v) m.set(k, v); else m.delete(k); this._busy = m; }
  private close = () => fire(this, 'jukebox-speakers', { open: false });
  /** #51 Esc (from the card): the question first, then the open panel, then an asking / error chip */
  escape() {
    if (this._ask) this.answer(false);
    else if (this.open) this.close();
    else if (this._chip && (this._chip.kind === 'ask' || this._chip.kind === 'error')) this.clearChip();
    else return false;
    return true;
  }

  /* ---------------- volume (same optimistic pattern as Now playing) ---------------- */
  private held<T>(m: Map<string, Pending<T>>, k: string, a: T, eq: (x: T, y: T) => boolean): T {
    const p = m.get(k);
    if (!p) return a;
    if (Date.now() - p.t > HOLD_MS || eq(a, p.v)) { m.delete(k); return a; }
    return p.v;
  }
  private volOf(id: string) { return this.held(this.vol, id, Number(this.hass?.states[id]?.attributes?.volume_level ?? 0), (x, y) => Math.abs(x - y) < 0.011); }
  private mutedOf(id: string) { return this.held(this.mute, id, !!this.hass?.states[id]?.attributes?.is_volume_muted, (x, y) => x === y); }
  private callVol(id: string, service: string, data: Record<string, any>) {
    return this.hass!.callService('media_player', service, data, { entity_id: id }).catch(() => this.fail('That did not work. Check the speaker.'));
  }
  private sendVol(id: string, v: number) { return sendVolume(this.hass, id, v).catch(() => this.fail('That did not work. Check the speaker.')); }
  private sender(id: string) {
    let s = this.senders.get(id);
    // 0.7.10: through sendVolume (kept while HA is disconnected, sent once on reconnect; notifyOnError=false)
    if (!s) { s = throttle((v: number) => { void this.sendVol(id, v); }, VOL_THROTTLE_MS); this.senders.set(id, s); }
    return s;
  }
  private onVol(id: string, e: CustomEvent, final: boolean) {
    const v = e.detail.value;
    this.vol.set(id, { v, t: Date.now() });
    if (final) { this.sender(id).flush(v); this.requestUpdate(); } else { this.sender(id)(v); const el = this.renderRoot.querySelector(`[data-room="${id}"] .vv, [data-main="${id}"] .vv`) as HTMLElement | null; if (el) el.dataset.v = String(Math.round(v * 100)); }
  }
  private toggleMute(id: string) {
    const v = !this.mutedOf(id);
    this.mute.set(id, { v, t: Date.now() }); this.requestUpdate();
    void this.callVol(id, 'volume_mute', { is_volume_muted: v });
  }

  /* ---------------- grouping ---------------- */
  private ctx() {
    const c = this.config, hass = this.hass, players = this.store?.players ?? new Map();
    const rooms = mapRooms(roomsOf(c, hass), hass, players);
    const tMa = this.dynamic ? targetMa(c.entity!, hass, players) : undefined;
    const tP = tMa ? players.get(tMa) : undefined;
    const active = isActive(tP);
    const members = active ? membersOf(tP, players) : [];
    return { c, hass, players, rooms, tMa, tP, kind: kindOf(tP, tMa ? this.store?.configs.get(tMa) : undefined), active, members, leader: active ? leaderOf(tP, players) : undefined };
  }
  private async confirmTakeovers(title: string, list: Takeover[], players: Players, rooms: Room[], ok: string) {
    if (!list.length) return true;
    const danger = list.some((t) => t.kind === 'static' || t.kind === 'hijack' || t.last);
    const lines = list.map((t) => takeoverText(t, (id) => this.nameOf(id, players, rooms)));
    // 0.6.4: the question sits in the top-right chip (tap its button to go ahead); confirm_drop: true keeps the dialog
    if (!this.modal) return this.chipAsk(lines.join(' '), ok);
    return this.ask({ title, lines, ok, danger });
  }
  /** Join (or take) a speaker into the current target. */
  async join(room: Room) {
    const x = this.ctx();
    if (!room.ma || !x.tMa || x.kind !== 'dynamic' || !x.active) return;
    const holder = holderOf(room.ma, x.players, x.tMa);
    const list = takeovers(x.tMa, [room.ma], x.players);
    const tName = this.nameOf(x.tMa, x.players, x.rooms);
    if (!(await this.confirmTakeovers(holder ? `Take ${room.name} from ${this.nameOf(holder.player_id, x.players, x.rooms)}?` : `Add ${room.name} to ${tName}?`,
      list, x.players, x.rooms, holder ? 'Take' : 'Add'))) return;
    const staticStop = !!holder && kindOf(holder) === 'static';
    const back = holder && kindOf(holder) === 'dynamic' && !list[0]?.last ? holder.player_id : undefined;
    this.setBusy(room.ma, 'in');
    try {
      // a speaker that leads a playing static group is refused by set_members: stop that group first (it stops anyway)
      if (staticStop && leaderOf(holder, x.players) === room.ma) await this.store!.stop(holder!.player_id);
      await this.store!.setMembers(x.tMa, [room.ma], []);
      const ok = await this.store!.waitFor((p) => membersOf(p.get(x.tMa!), p).includes(room.ma!), timeouts().join);
      if (!ok) throw new SpeakerError('timeout', `${room.name} did not join`);
      const s = room.ma, t = x.tMa;
      this.status(`${room.name} joined ${tName}`, staticStop ? {} : { undo: { label: `${room.name} joined`, run: async () => { if (back) await this.store!.setMembers(back, [s], []); else await this.store!.setMembers(t, [], [s]); } } });
    } catch (e) {
      this.fail(`Couldn't add ${room.name}: ${errText(e)}`);
      void this.store!.refresh();
    } finally { this.setBusy(room.ma); }
  }
  async drop(room: Room) {
    const x = this.ctx();
    if (!room.ma || !x.tMa || x.kind !== 'dynamic' || !x.active) return;
    const allow = x.c.leader_drop !== 'block';
    const why = dropBlock(x.tP, room.ma, x.players, allow);
    const tName = this.nameOf(x.tMa, x.players, x.rooms);
    if (why === 'last') {
      // MA would stop and dissolve the group: offer Pause instead (the queue and the speaker stay on the group)
      const playing = this.hass?.states[x.c.entity!]?.state === 'playing';
      if (!playing) { this.toast(`${room.name} is the last speaker in ${tName}. Add another speaker first.`); return; }
      // 0.6.4: no dialog. Dropping it would make MA stop and dissolve the group (the queue is not known to survive that and
      // Undo could not bring it back), so the chip offers Pause instead: the room and the queue stay; Undo plays again.
      const go = this.modal
        ? await this.ask({ title: `${room.name} is the last speaker`, lines: [`${tName} needs at least one speaker. Pause ${tName} instead? Its queue stays; tap Play to go on.`], ok: 'Pause' })
        : await this.chipAsk(`${room.name} is the last speaker in ${tName}`, 'Pause');
      if (go) {
        const e = x.c.entity!;
        void this.hass!.callService('media_player', 'media_pause', {}, { entity_id: e }).then(
          () => this.status(`${tName} paused`, { undo: { label: `${tName} paused`, run: async () => { await this.hass!.callService('media_player', 'media_play', {}, { entity_id: e }); } } }),
          () => this.fail('That did not work. Check the speaker.'));
      }
      return;
    }
    if (why === 'leader') { this.toast(`${room.name} leads ${tName}. Use Move to hand off, or drop the other speakers.`); return; }
    const isLeader = x.leader === room.ma;
    if (isLeader && this.modal && !(await this.ask({ title: `Drop ${room.name}?`, lines: [`${room.name} leads ${tName} now. Music Assistant hands ${tName} to the other speakers: they go quiet for a few seconds, then the queue plays on.`], ok: 'Drop' }))) return;
    this.setBusy(room.ma, 'out');
    if (isLeader) { this.startRegroup(x.tMa, room.ma); this.status('Regrouping…', { kind: 'busy' }); }
    try {
      await this.store!.setMembers(x.tMa, [], [room.ma]);
      const ok = await this.store!.waitFor((p) => !membersOf(p.get(x.tMa!), p).includes(room.ma!), timeouts().join);
      if (!ok) throw new SpeakerError('timeout', `${room.name} did not leave`);
      const s = room.ma, t = x.tMa;
      this.status(isLeader && this._regroup ? `${room.name} left · regrouping…` : `${room.name} left`, { undo: { label: `${room.name} left`, run: async () => { await this.store!.setMembers(t, [s], []); } } });
    } catch (e) {
      if (isLeader) this.endRegroup();
      this.fail(`Couldn't drop ${room.name}: ${errText(e)}`);
      void this.store!.refresh();
    } finally { this.setBusy(room.ma); }
  }
  /** 'Regrouping…' until the group plays again on a new leader (or 15 s) */
  private startRegroup(group: string, old: string) {
    window.clearTimeout(this._regroupTimer);
    this._regroup = { group, old, until: Date.now() + REGROUP_MS };
    this._regroupTimer = window.setTimeout(() => this.endRegroup(), REGROUP_MS);
  }
  private endRegroup() { window.clearTimeout(this._regroupTimer); this._regroup = null; }
  /** true while the target is re-forming: our own leader drop not yet answered by a playing new leader, or MA says buffering */
  regrouping(x: { tMa?: string; tP?: MaPlayer; players: Players }): boolean {
    const r = this._regroup;
    if (r && r.group === x.tMa) {
      const ms = membersOf(x.tP, x.players), lead = leaderOf(x.tP, x.players);
      const back = !ms.includes(r.old) && !!lead && x.players.get(lead)?.playback_state === 'playing';
      if (back || Date.now() > r.until) { queueMicrotask(() => this.endRegroup()); return false; }
      return true;
    }
    return x.tP?.playback_state === 'buffering';
  }
  /** Move what plays to another group (or just point the card there when nothing plays). */
  async move(to: Target, opts: { quiet?: boolean; undoable?: boolean } = {}): Promise<boolean> {
    const x = this.ctx();
    const from = x.c.entity!;
    if (to.entity === from) return true;
    if (!this.store?.loaded) await this.store?.refresh();
    const y = this.ctx();
    const dMa = targetMa(to.entity, this.hass, y.players);
    if (!y.active || !y.tMa) { fire(this, 'jukebox-target', { entity: to.entity }); if (!opts.quiet) this.toast(`Now on ${to.name}`); return true; }
    if (!dMa) { this.fail(`${to.name} is not in Music Assistant`); return false; }
    const st = this.startTakeovers(to.entity, y.players);
    const fromName = this.nameOf(y.tMa, y.players, y.rooms);
    if (!(await this.confirmTakeovers(`Move to ${to.name}?`, st.list, y.players, y.rooms, 'Move'))) return false;
    this.setBusy(to.entity, 'move');
    fire(this, 'jukebox-target', { entity: to.entity }); // optimistic
    try {
      await this.store!.transfer(y.tMa, dMa, true);
      const ok = await this.store!.waitFor((p) => isActive(p.get(dMa)), timeouts().move);
      if (!ok) throw new SpeakerError('timeout', `${to.name} did not start`);
      const src = y.tMa;
      const lossy = st.list.some((t) => t.kind === 'static' || t.kind === 'hijack');
      const undo = opts.undoable !== false && !lossy ? { label: `Moved to ${to.name}`, run: async () => {
        await this.store!.transfer(dMa, src, true); fire(this, 'jukebox-target', { entity: from });
      } } : undefined;
      if (!opts.quiet) this.status(`Moved to ${to.name}`, { undo });
      return true;
    } catch (e) {
      fire(this, 'jukebox-target', { entity: from }); // revert
      this.fail(`Couldn't move to ${to.name}: ${errText(e)}. Still on ${fromName}.`);
      void this.store!.refresh();
      return false;
    } finally { this.setBusy(to.entity); }
  }
  async applyPreset(p: PresetConfig) {
    const targets = targetsOf(this.config, this.hass);
    if (!this.store?.loaded) await this.store?.refresh();
    const dest = targets.find((t) => t.entity === (p.target ?? this.config.entity)) ?? targets[0];
    const x0 = this.ctx();
    const want = presetSpeakers(p, x0.rooms);
    const dMa = targetMa(dest.entity, this.hass, x0.players);
    // one confirmation for everything this preset takes
    const list = dMa ? takeovers(dMa, want, x0.players, !isActive(x0.players.get(dMa))) : [];
    if (!(await this.confirmTakeovers(`Use ${p.name}?`, list, x0.players, x0.rooms, 'Use'))) return;
    this.setBusy('preset:' + p.name, 'run');
    try {
      if (dest.entity !== this.config.entity && !(await this.move(dest, { quiet: true, undoable: false }))) return;
      await this.updateComplete;
      const x = this.ctx();
      if (x.tMa && x.kind === 'dynamic' && x.active) {
        const plan = planMembers(x.members, want, x.leader, x.c.leader_drop !== 'block');
        if (plan.add.length || plan.remove.length) {
          for (const s of plan.add) { const h = holderOf(s, x.players, x.tMa); if (h && kindOf(h) === 'static' && leaderOf(h, x.players) === s) await this.store!.stop(h.player_id); }
          await this.store!.setMembers(x.tMa, plan.add, plan.remove);
          const ok = await this.store!.waitFor((pl) => { const m = membersOf(pl.get(x.tMa!), pl); return plan.add.every((s) => m.includes(s)) && plan.remove.every((s) => !m.includes(s)); }, timeouts().join);
          if (!ok) throw new SpeakerError('timeout', 'speakers did not follow');
        }
        if (plan.kept.length) this.toast(`${p.name}: kept ${plan.kept.map((s) => this.nameOf(s, x.players, x.rooms)).join(', ')} (leads the group)`);
        else this.toast(`${p.name} ready`);
      } else this.toast(`${p.name}: play something on ${dest.name} to start it`);
      for (const [e, pct] of Object.entries(p.volumes ?? {})) {
        const v = Math.max(0, Math.min(100, pct)) / 100;
        this.vol.set(e, { v, t: Date.now() });
        void this.sendVol(e, v);
      }
    } catch (e) {
      this.fail(`Couldn't apply ${p.name}: ${errText(e)}`);
      void this.store?.refresh();
    } finally { this.setBusy('preset:' + p.name); }
  }

  /* ---------------- render ---------------- */
  protected render() {
    if (!this.config) return nothing;
    const ask = html`${this.askTpl()}${this.chipTpl()}`;
    if (!this.open) return ask;
    const x = this.ctx();
    const user = this.hass?.user;
    const may = this.dynamic && this.mayGroup;
    const vol = canVolume(x.c, user);
    const targets = this.dynamic ? targetsOf(x.c, this.hass) : [];
    const tName = (this.hass?.states[x.c.entity!]?.attributes?.friendly_name as string) ?? targets.find((t) => t.entity === x.c.entity)?.name ?? 'Speakers';
    const grouping = may && x.kind === 'dynamic' && !!this.store?.loaded;
    let banner = '';
    if (!this.dynamic) banner = `${tName} always plays on these speakers. Set the volume per room here.`;
    else if (!may) banner = vol ? 'Volume only. Ask an admin to change speakers.' : 'Ask an admin to change speakers or volume.';
    else if (this.store?.error && !this.store.loaded) banner = `Music Assistant did not answer (${this.store.error}). Volume still works.`;
    else if (x.kind === 'static') banner = `${tName} is a fixed group in Music Assistant: no join or drop. Move to another group to change speakers.`;
    else if (x.kind === 'dynamic' && !x.active && this.store?.loaded) banner = `${tName} is not playing. Start playback to join or drop speakers (the buttons wake up), or pick a preset.`;
    // each dynamic group's MA default (config/players/get); unreadable MA config: no presets
    const presets = may ? maPresets(this.store?.configs ?? new Map(), x.players, x.rooms, targets, this.hass) : [];
    return html`<div class="scrim dim sp-scrim" @pointerdown=${(e: PointerEvent) => { e.preventDefault(); this.close(); }}></div>
      <section class="sheet" role="dialog" aria-label="Speakers" data-mode=${this.dynamic ? 'dynamic' : 'fixed'} data-guest=${may ? 'no' : 'yes'}>
        <header class="sh">
          <span class="ht"><span class="eyebrow">Speakers</span><b class="tn">${tName}</b>
            <small class="stl">${this.statusLine(x)}</small></span>
          <button class="x" data-action="close" aria-label="Close speakers" tabindex="-1" @pointerdown=${noFocus} @click=${this.close}>Close</button>
        </header>
        <div class="body">
          ${banner ? html`<p class="banner" data-kind=${!this.dynamic ? 'fixed' : !may ? 'guest' : x.kind}>${banner}</p>` : nothing}
          ${may && targets.length > 1 ? html`<div class="blk"><span class="eyebrow sm">Play on</span><div class="chips" role="radiogroup">
            ${targets.map((t) => { const on = t.entity === x.c.entity; const b = this._busy.get(t.entity);
              const st = this.hass?.states[t.entity]?.state;
              return html`<button class="chip ${on ? 'on' : ''} ${b ? 'busy' : ''}" role="radio" aria-checked=${on ? 'true' : 'false'} data-target=${t.entity} tabindex="-1"
                @pointerdown=${noFocus} @click=${() => this.move(t)}>${icon('group', 'i xs')}<span>${t.name}</span>${st === 'playing' && !on ? html`<i class="live" title="playing"></i>` : nothing}</button>`; })}
          </div></div>` : nothing}
          ${presets.length ? html`<div class="blk"><span class="eyebrow sm">Presets</span><div class="chips">
            ${presets.map((p) => html`<button class="chip pre ${this._busy.has('preset:' + p.name) ? 'busy' : ''}" data-preset=${p.name} tabindex="-1" @pointerdown=${noFocus}
              @click=${() => this.applyPreset(p)}>${icon('star', 'i xs')}<span>${p.name}</span></button>`)}
          </div></div>` : nothing}
          <div class="mix">
            ${this.mainRow(x.c.entity!, tName, vol)}
            <div class="rooms">${x.rooms.map((r) => this.roomRow(r, x, grouping, vol))}</div>
          </div>
        </div>
      </section>${ask}`;
  }
  private statusLine(x: ReturnType<JbSpeakers['ctx']>) {
    const e = this.hass?.states[x.c.entity!];
    const st = e?.state ?? 'unknown';
    // Home Assistant 2026.10 reports group_members: [] for an ungrouped Music Assistant player; that is the configured rooms, not 0.
    const n = this.dynamic && x.active ? x.members.length : (e?.attributes?.group_members as string[] | undefined)?.length || x.rooms.length;
    const word = this.dynamic && this.regrouping(x) ? 'Regrouping…' : st === 'playing' ? 'Playing' : st === 'paused' ? 'Paused' : st === 'buffering' ? 'Regrouping…' : 'Idle';
    return `${word} · ${n} speaker${n === 1 ? '' : 's'}`;
  }
  private mainRow(id: string, name: string, vol: boolean) {
    const muted = this.mutedOf(id), v = this.volOf(id);
    return html`<div class="vr main" data-main=${id}>
      <button class="vm" tabindex="-1" aria-label="${muted ? 'Unmute' : 'Mute'} ${name}" ?disabled=${!vol} @pointerdown=${noFocus} @click=${() => this.toggleMute(id)}>${icon(muted ? 'volmute' : 'vol')}</button>
      <span class="vn">All of ${name}</span>
      <jb-slider class="vs" slop="8" .value=${muted ? 0 : v} ?disabled=${!vol} .label=${`${name} volume`}
        @jb-input=${(e: CustomEvent) => this.onVol(id, e, false)} @jb-change=${(e: CustomEvent) => this.onVol(id, e, true)}></jb-slider>
      <span class="vv" data-v=${muted ? '–' : String(Math.round(v * 100))}></span>
    </div>`;
  }
  private roomState(r: Room, x: ReturnType<JbSpeakers['ctx']>, grouping: boolean) {
    const st = this.hass?.states[r.entity];
    const off = !st || st.state === 'unavailable' || st.state === 'off';
    const busy = r.ma ? this._busy.get(r.ma) : undefined;
    let inT: boolean, where = '', act: { label: string; kind: string; fn: () => void; dis?: boolean } | undefined;
    const p = r.ma ? x.players.get(r.ma) : undefined;
    if (this.dynamic && this.store?.loaded && r.ma) {
      inT = x.members.includes(r.ma);
      const h = inT ? undefined : holderOf(r.ma, x.players, x.tMa);
      const title = h ? (this.hass?.states[targetsOf(x.c, this.hass).find((t) => targetMa(t.entity, this.hass, x.players) === h.player_id)?.entity ?? '']?.attributes?.media_title as string | undefined) ?? h.current_media?.title
        : p?.current_media?.title ?? undefined;
      if (inT) where = x.leader === r.ma && x.members.length > 1 ? 'Leads the group' : 'In this group';
      else if (h) where = `In ${this.nameOf(h.player_id, x.players, x.rooms)}${kindOf(h) === 'static' ? ' (fixed)' : ''}${title ? ` · ${title}` : ''}`;
      else if (p && ['playing', 'paused'].includes(p.playback_state)) where = `${p.playback_state === 'paused' ? 'Paused' : 'Playing alone'}${title ? ` · ${title}` : ''}`;
      else where = 'Not playing';
      if (grouping) {
        if (inT) {
          const why = dropBlock(x.tP, r.ma, x.players, x.c.leader_drop !== 'block');
          act = { label: why === 'leader' ? 'Leader' : why === 'last' ? 'Last' : 'Drop', kind: why ? 'blocked' : 'drop', fn: () => this.drop(r) };
        } else if (h) act = { label: `Take from ${this.nameOf(h.player_id, x.players, x.rooms)}`, kind: 'take', fn: () => this.join(r) };
        else if (x.kind === 'dynamic' && !x.active) act = { label: 'Join', kind: 'idle', dis: true, fn: () => this.toast(`Start playback on ${this.nameOf(x.tMa!, x.players, x.rooms)} first, then join speakers.`) };
        else act = { label: 'Join', kind: 'join', fn: () => this.join(r) };
      }
      if (busy) inT = busy === 'in';
    } else {
      // fixed mode / not loaded: HA only. In the group = the target lists it; otherwise show what the room plays alone
      const t = this.hass?.states[x.c.entity!];
      inT = !!t && ['playing', 'paused', 'buffering'].includes(t.state) && Array.isArray(t.attributes?.group_members) && t.attributes.group_members.includes(r.entity);
      const title = st?.attributes?.media_title as string | undefined;
      where = inT ? 'In this group' : st && ['playing', 'paused'].includes(st.state) && title ? `${st.state === 'paused' ? 'Paused' : 'Playing'} · ${title}` : off ? 'Offline' : 'Not playing';
    }
    return { inT, where, act, busy, off };
  }
  private roomRow(r: Room, x: ReturnType<JbSpeakers['ctx']>, grouping: boolean, vol: boolean) {
    const { inT, where, act, busy, off } = this.roomState(r, x, grouping);
    const muted = this.mutedOf(r.entity), v = this.volOf(r.entity);
    return html`<div class="vr room ${inT ? 'in' : 'out'} ${muted ? 'muted' : ''} ${off ? 'off' : ''} ${busy ? 'pending' : ''}" data-room=${r.entity} data-ma=${r.ma ?? ''}>
      <button class="vm" tabindex="-1" aria-label="${muted ? 'Unmute' : 'Mute'} ${r.name}" ?disabled=${off || !vol} @pointerdown=${noFocus} @click=${() => this.toggleMute(r.entity)}>${icon(muted ? 'volmute' : 'speaker')}</button>
      <span class="vn"><b>${r.name}</b><small class="where">${busy === 'in' ? 'Joining…' : busy === 'out' ? 'Leaving…' : where}</small></span>
      ${act ? html`<button class="act ${act.kind}" data-act=${act.kind} tabindex="-1" aria-disabled=${act.dis || act.kind === 'blocked' ? 'true' : 'false'} ?disabled=${!!busy} @pointerdown=${noFocus} @click=${act.fn}>${act.label}</button>` : html`<span></span>`}
      <jb-slider class="vs" slop="8" .value=${muted ? 0 : v} ?disabled=${off || !vol} .label=${`${r.name} volume`}
        @jb-input=${(e: CustomEvent) => this.onVol(r.entity, e, false)} @jb-change=${(e: CustomEvent) => this.onVol(r.entity, e, true)}></jb-slider>
      <span class="vv" data-v=${muted ? '–' : String(Math.round(v * 100))}></span>
    </div>`;
  }
  /** 0.6.4: the one status chip, top-right under the header clock; only the chip itself takes taps */
  private chipTpl() {
    const c = this._chip;
    if (!c) return nothing;
    const act = c.act;
    return html`<div class="st ${c.kind} ${c.text.length > 44 ? 'wrap' : ''}" data-kind=${c.kind} role=${c.kind === 'error' ? 'alert' : 'status'} aria-live=${c.kind === 'error' ? 'assertive' : 'polite'}>
      ${c.kind === 'error' ? icon('alert', 'i xs si') : c.kind === 'busy' ? html`<i class="dot" aria-hidden="true"></i>` : nothing}
      <span class="ct">${c.text}</span>
      ${act ? html`<i class="sep" aria-hidden="true">·</i><button class="ca" data-action=${act.label === 'Undo' ? 'undo' : 'confirm'} tabindex="-1" @pointerdown=${noFocus} @click=${act.run}>${act.label}</button>` : nothing}
      ${c.kind === 'ask' || c.kind === 'error' ? html`<button class="cx" data-action="cancel" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.clearChip()}>Close</button>` : nothing}
    </div>`;
  }
  private askTpl() {
    const a = this._ask;
    if (!a) return nothing;
    return html`<div class="scrim dim ask-scrim" @pointerdown=${(e: PointerEvent) => { e.preventDefault(); this.answer(false); }}></div>
      <div class="confirm sp-ask ${a.danger ? 'danger' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="sa-q">
        <div class="cf-h"><span><b id="sa-q">${a.title}</b>${a.sub ? html`<small>${a.sub}</small>` : nothing}</span></div>
        ${a.lines.length ? html`<ul class="tk">${a.lines.map((l) => html`<li>${l}</li>`)}</ul>` : nothing}
        <div class="cf-a">
          <button class="cbtn" data-action="cancel" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.answer(false)}>Cancel</button>
          <button class="cbtn ok" data-action="confirm" tabindex="-1" @pointerdown=${noFocus} @click=${() => this.answer(true)}>${a.ok}</button>
        </div>
      </div>`;
  }

  static styles = [tokens, base, mediaStyles, css`
    :host { position: absolute; inset: 0; z-index: 30; pointer-events: none; container: spk / size; font-family: var(--_font-body); color: var(--_fg); }
    :host([open]) { pointer-events: auto; }
    /* v0.7: the station sheet (z-index 32) is open: the chip shows above it (the closed panel is only the chip) */
    :host([lift]:not([open])) { z-index: 33; }
    :host(:not([open])) .scrim, :host(:not([open])) .confirm, :host(:not([open])) .st { pointer-events: auto; }
    .scrim { position: absolute; inset: 0; }
    .sp-scrim { z-index: 1; background: var(--_scrim); -webkit-backdrop-filter: var(--_scrim-filter); backdrop-filter: var(--_scrim-filter); }
    .sheet { position: absolute; z-index: 2; display: flex; flex-direction: column; background: var(--_dialog-bg); border: var(--_card-border-width, 1px) solid var(--_card-border-color, var(--_surface-border)); box-shadow: var(--_dialog-shadow);
      left: 0; right: 0; bottom: 0; max-height: min(100%, var(--_popup-max-h)); border-radius: var(--_dialog-radius) var(--_dialog-radius) 0 0; padding-bottom: env(safe-area-inset-bottom); overflow: hidden; }
    .sh { display: flex; align-items: center; gap: 12px; padding: 16px 16px 12px 20px; border-bottom: 1px solid var(--_divider); }
    .ht { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .ht .eyebrow { font-size: var(--ha-font-size-s, 12px); color: var(--_inactive); }
    .tn { font-family: var(--_font-display); font-size: var(--ha-font-size-xl, 20px); font-weight: var(--ha-font-weight-bold, 700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ht small { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); }
    /* 0.7.8 #50: a labeled Close button (was a small X), high contrast, sized like the card's other buttons */
    .x { height: 48px; min-width: 88px; padding: 0 20px; display: grid; place-items: center; border-radius: 999px; flex: none;
      background: var(--_active); color: var(--_on-accent); font: inherit; font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-bold, 700); white-space: nowrap; }
    .x:active { transform: scale(.96); background: var(--_chip-sel); }
    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px 20px 20px; display: flex; flex-direction: column; gap: 14px; scrollbar-width: none; }
    .banner { font-size: var(--ha-font-size-m, 14px); color: var(--_muted); padding: 10px 14px; border-radius: 12px; border: 1px solid var(--_divider); background: var(--_chip-bg); }
    .blk { display: flex; flex-direction: column; gap: 8px; }
    .eyebrow.sm { font-size: var(--ha-font-size-s, 12px); color: var(--_inactive); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { position: relative; display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--_surface-border);
      font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); color: var(--_fg); }
    .chip .i { width: 18px; height: 18px; }
    .chip.on { background: var(--_chip-sel); color: var(--_fg); border-color: transparent; }
    .chip.busy { opacity: .6; }
    .chip:active { transform: scale(.97); }
    .chip .live { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .mix { display: flex; flex-direction: column; }
    .rooms { display: flex; flex-direction: column; border-top: 1px solid var(--_divider); }
    .vr { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; grid-template-areas: "m n a" "s s v"; align-items: center; column-gap: 8px; padding: 8px 0; }
    .vr + .vr { border-top: 1px solid var(--_divider); }
    .vr.main { grid-template-areas: "m n n" "s s v"; }
    .vm { grid-area: m; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; color: var(--_active); margin-left: -8px; }
    .vm .i { width: 22px; height: 22px; }
    .vn { grid-area: n; display: flex; flex-direction: column; min-width: 0; font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); }
    .vn b, .vn small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .vn small { font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-medium, 500); color: var(--_muted); }
    .vr.out .vn b { color: var(--_muted); }
    .vr.out .vm { color: var(--_inactive); }
    .vr.pending { opacity: .7; }
    .vs { grid-area: s; --_slider-h: 7px; --_slider-knob: 22px; --_slider-hit: 40px; }
    .vv { grid-area: v; width: 34px; text-align: right; font-size: var(--ha-font-size-s, 12px); color: var(--_muted); font-variant-numeric: tabular-nums; }
    .vv::after { content: attr(data-v); }
    .vr.off { opacity: .5; }
    .act { grid-area: a; height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--_surface-border); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); color: var(--_fg); white-space: nowrap;
      max-width: 52cqw; overflow: hidden; text-overflow: ellipsis; }
    .act.join { background: var(--_active); color: var(--_on-accent); border-color: var(--_active); }
    .act.take { border-style: dashed; }
    .act.blocked, .act.idle { color: var(--_inactive); border-color: var(--_divider); }
    .act:disabled { opacity: .4; }
    /* 0.6.4 status chip: top-right of the middle area, right under the header clock (never over it); it replaces the
       0.6.3 centred toast and the bottom Undo bar. With the panel open it moves left of the panel's close button. */
    .st { position: absolute; z-index: 12; top: 10px; right: var(--_pad); max-width: min(400px, calc(100% - 2 * var(--_pad))); min-height: 40px;
      display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 14px; border-radius: var(--ha-border-radius-sm, 4px); pointer-events: auto;
      /* ha-toast styling: neutral loud fill, on-neutral text */
      --_fg: var(--ha-color-on-neutral-loud); --_muted: var(--ha-color-on-neutral-loud);
      background: var(--ha-color-neutral-10); color: var(--ha-color-on-neutral-loud); border: 0; box-shadow: var(--ha-box-shadow-l, none); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); line-height: var(--ha-line-height-condensed, 1.2);
      animation: stin 160ms ease both; }
    .st.info, .st.busy { padding-right: 14px; } .st.info:has(.ca), .st.busy:has(.ca) { padding-right: 4px; }
    .st .ct { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 6px 0; }
    .st.wrap .ct { white-space: normal; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .st .sep { font-style: normal; color: var(--_muted); margin: 0 -2px; }
    .st .ca { position: relative; flex: none; height: 34px; padding: 0 14px; border-radius: 999px; background: var(--_active); color: var(--_on-accent); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); }
    .st .ca::before, .st .cx::before { content: ""; position: absolute; inset: -6px -4px; }
    .st .cx { position: relative; flex: none; height: 34px; padding: 0 14px; display: grid; place-items: center; border-radius: 999px; background: var(--_active); color: var(--_on-accent); font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-bold, 700); } /* #51: labeled Close (was an X) */
    .st .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--_active); animation: stpulse 1s ease-in-out infinite alternate; }
    .st.error { background: var(--_active); color: var(--_on-accent); border-color: var(--_active); }
    .st.error .si { color: var(--text-primary-color, #fff); flex: none; } .st.error .ca { background: var(--text-primary-color, #fff); color: var(--error-color); } .st.error .cx { background: var(--text-primary-color, #fff); color: var(--error-color); }
    @keyframes stin { from { opacity: 0; transform: translateY(-6px); } }
    @keyframes stpulse { from { opacity: .35; } }
    :host([open]) .st { right: 116px; top: 14px; max-width: min(360px, calc(100% - 116px - var(--_pad))); } /* #50: left of the labeled Close button */
    @container spk (max-width: 640px) { :host([open]) .st { right: var(--_pad); top: 10px; } }
    @container spk (max-width: 640px) and (max-height: 560px) { :host([open]) .st { right: 116px; top: 6px; max-width: calc(100% - 116px - var(--_pad)); } }
    .confirm { z-index: 10; max-height: min(100cqh, var(--_popup-max-h)); overflow-y: auto; }
    /* the panel only knows the card's own height (not the viewport): short cards get tighter rows; max height stays the shared dialog ceiling */
    .sh { flex: none; }
    @container spk (max-height: 560px) {
      .sh { padding-top: 8px; padding-bottom: 6px; } .tn { font-size: var(--ha-font-size-l, 16px); }
      .body { padding-top: 8px; gap: 10px; } .vr { padding: 4px 0; } .chip { height: 40px; }
    }
    .ask-scrim { z-index: 9; }
    .tk { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: var(--ha-font-size-m, 14px); color: var(--_fg); }
    .sp-ask.danger .cbtn.ok { background: var(--_active); color: var(--_on-accent); }
    /* tablet: right drawer */
    @container spk (min-width: 641px) {
      .sheet { left: auto; top: 0; bottom: 0; right: 0; width: min(440px, 92cqw); max-height: min(100%, var(--_popup-max-h)); border-radius: var(--_dialog-radius) 0 0 var(--_dialog-radius); border-width: 0 0 0 var(--_card-border-width, 1px); box-shadow: var(--_dialog-shadow); }
    }
    /* wide (1280+, incl. 1080p after the card's zoom): wider drawer, two-column rooms */
    @container spk (min-width: 1200px) {
      .sheet { width: min(760px, 58cqw); }
      .rooms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }
      .vr + .vr { border-top: 0; } .rooms .vr { border-bottom: 1px solid var(--_divider); }
    }
    /* large_buttons */
    :host([large]) .chip { height: 56px; font-size: var(--ha-font-size-l, 16px); padding: 0 20px; }
    :host([large]) .act { height: 52px; font-size: var(--ha-font-size-l, 16px); padding: 0 18px; }
    :host([large]) .vm { width: 52px; height: 52px; } :host([large]) .vm .i { width: 28px; height: 28px; }
    :host([large]) .vr { grid-template-columns: 52px minmax(0, 1fr) auto; }
    :host([large]) .vn { font-size: var(--ha-font-size-l, 16px); } :host([large]) .vn small { font-size: var(--ha-font-size-m, 14px); }
    :host([large]) .vs { --_slider-h: 10px; --_slider-knob: 30px; --_slider-hit: 52px; }
    :host([large]) .x { height: 60px; min-width: 104px; padding: 0 24px; font-size: var(--ha-font-size-l, 16px); }
    :host([large]) .st { font-size: var(--ha-font-size-l, 16px); min-height: 48px; } :host([large]) .st .ca { height: 42px; font-size: var(--ha-font-size-l, 16px); padding: 0 18px; } :host([large]) .st .cx { height: 42px; font-size: var(--ha-font-size-l, 16px); padding: 0 18px; }
    :host([large][open]) .st { right: 132px; max-width: min(360px, calc(100% - 132px - var(--_pad))); }
    @media (prefers-reduced-motion: reduce) { .chip:active { transform: none; } .st, .st .dot { animation: none; } }
  `];
}
function errText(e: unknown) {
  if (e instanceof SpeakerError) return e.code === 'timeout' ? 'no answer in time' : e.code === 'config' ? 'speaker grouping needs the Jukebox Kiosk integration' : e.message.replace(/^.*?:\s*/, '') || 'failed';
  return String((e as any)?.message ?? e);
}
defineElement('jb-speakers', JbSpeakers);

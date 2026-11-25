// #105 (1.0.1): long queues and the queue id a row action uses (src/queue-actions.ts, src/queue-model.ts).
//  - Remove from Search / Library finds a song past the first 1000 rows (pages player_queues/items, no cap).
//  - Undo Remove finds the re-added song at the end of a long queue.
//  - Row actions resolve the queue when they run (live feed, else the backend's lookup, else the last read).
// Usage: node test/unit/queue-long.unit.mjs     (no browser, no network). Every id below is a placeholder.
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-queue-long/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/queue-model.ts', 'src/queue-actions.ts', 'src/backend/kiosk.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

globalThis.window = globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
globalThis.document ??= { createElement: () => ({}), createComment: () => ({}), createTreeWalker: () => ({}), importNode: () => ({}) };
const origWarn = console.warn; console.warn = () => {};

const Q = await import(OUT + 'queue-model.mjs');
const A = await import(OUT + 'queue-actions.mjs');
const K = await import(OUT + 'kiosk.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const ENT = 'media_player.everywhere';

/** fake Jukebox Kiosk server with one MA queue of n songs (song i = queue item `qi<i>`, uri lib://track/<i>), playing index cur */
function server({ n = 1500, cur = 0, qid = 'q_group', active = qid, activeFails = false } = {}) {
  const calls = [];
  const rows = Array.from({ length: n }, (_, i) => ({ queue_item_id: `qi${i}`, name: `Song ${i}`, media_item: { uri: `lib://track/${i}`, name: `Song ${i}` } }));
  const fmt = (x) => ({ queue_item_id: x.queue_item_id, media_title: x.name, media_content_id: x.media_item.uri });
  const hass = {
    states: { [ENT]: { entity_id: ENT, state: 'playing', attributes: {} } },
    user: { is_admin: true },
    callService: async () => { throw new Error('no HA services here'); },
    callWS: async (msg) => {
      const t = String(msg.type).replace('jukebox_kiosk/', '');
      if (t === 'capabilities') return { features: { queue: true, queue_play: true, queue_edit: true, undo: true, ma_commands: true } };
      if (t === 'active_queue') { calls.push({ t }); if (activeFails) throw new Error('unknown command'); return { queue_id: active }; }
      if (t === 'queue_items') {
        // the integration's window: 1 before the playing row, limit_after after it (max 1000)
        calls.push({ t, limit_after: msg.limit_after });
        const off = Math.max(0, cur - 1);
        return { queue_id: qid, current_index: cur, current_item_id: rows[cur]?.queue_item_id, total: rows.length, offset: off, items: rows.slice(off, cur + 1 + msg.limit_after).map(fmt) };
      }
      if (t !== 'ma') throw new Error('unexpected ' + t);
      calls.push({ t: msg.command, args: msg.args });
      if (msg.command === 'player_queues/items') return rows.slice(msg.args.offset, msg.args.offset + msg.args.limit);
      if (msg.command === 'player_queues/delete_item') { const j = rows.findIndex((x) => x.queue_item_id === msg.args.item_id_or_index); if (j >= 0) rows.splice(j, 1); return null; }
      if (msg.command === 'player_queues/play_media') { rows.push({ queue_item_id: 'qi_new', name: 'Again', media_item: { uri: msg.args.media } }); return null; }
      return null;
    },
  };
  return { hass, calls, rows };
}
async function model(hass) {
  const qm = new Q.QueueModel(); qm.hass = hass; qm.entity = ENT; qm.configForRemove = { entity: ENT };
  qm.backend = new K.KioskBackend(() => hass); await qm.backend.ready;
  return qm;
}

// ---- Remove from Search / Library past the first 1000 rows ----
{
  const { hass, calls, rows } = server({ n: 1500, cur: 0 });
  const be = new K.KioskBackend(() => hass); await be.ready;
  await A.removeQueuedItem(hass, { entity: ENT }, be, ENT, { uri: 'lib://track/1200', name: 'Song 1200' });
  const del = calls.find((c) => c.t === 'player_queues/delete_item');
  const pages = calls.filter((c) => c.t === 'player_queues/items').map((c) => [c.args.offset, c.args.limit]);
  check('L1 song 1200 of 1500 is found by paging after the first window and removed from the window\'s queue',
    J(del?.args) === J({ queue_id: 'q_group', item_id_or_index: 'qi1200' }) && !rows.some((x) => x.queue_item_id === 'qi1200') && J(pages) === J([[1001, 500]]), J({ del, pages }));
}
{
  const { hass, calls } = server({ n: 1500, cur: 0 });
  const be = new K.KioskBackend(() => hass); await be.ready;
  let msg = ''; try { await A.removeQueuedItem(hass, { entity: ENT }, be, ENT, { uri: 'lib://track/none', name: 'Nope' }); } catch (e) { msg = e.message; }
  const pages = calls.filter((c) => c.t === 'player_queues/items').map((c) => c.args.offset);
  check('L2 a song in no row: every page read once, nothing deleted, "not in the queue"', msg === 'Nope is not in the queue' && J(pages) === J([1001]) && !calls.some((c) => c.t === 'player_queues/delete_item'), J({ msg, pages }));
}
{
  const { hass, calls } = server({ n: 40, cur: 5 });
  const be = new K.KioskBackend(() => hass); await be.ready;
  await A.removeQueuedItem(hass, { entity: ENT }, be, ENT, { uri: 'lib://track/20', name: 'Song 20' });
  check('L3 a short queue: the first window is enough (no extra reads)', !calls.some((c) => c.t === 'player_queues/items') && calls.some((c) => c.t === 'player_queues/delete_item' && c.args.item_id_or_index === 'qi20'));
  let msg = ''; try { await A.removeQueuedItem(hass, { entity: ENT }, be, ENT, { uri: 'lib://track/5', name: 'Song 5' }); } catch (e) { msg = e.message; }
  check('L4 the playing song is never removed', msg === 'Song 5 is not in the queue', msg);
}
{
  const send = async (_c, d) => Array.from({ length: 500 }, (_, i) => ({ queue_item_id: `x${d.offset + i}` }));
  const rows = await A.queueRows(send, 'q', 0);
  check('L5 queueRows stops at a hard limit when a server ignores the offset (no endless read)', rows.length === 200 * 500, String(rows.length));
}

// ---- Undo Remove on a long queue ----
{
  const { hass, calls } = server({ n: 1500, cur: 0 });
  const qm = await model(hass); await qm.refresh();
  const r = await qm.removeRow('qi3');
  calls.length = 0;
  const where = await qm.undoRemove(r);
  const move = calls.find((c) => c.t === 'player_queues/move_item');
  const pages = calls.filter((c) => c.t === 'player_queues/items').map((c) => c.args.offset);
  // after the remove and the re-add the queue has 1500 rows again (pages 0-1500, the last one empty); the re-added one is row 1499; it goes back right after qi2 (row 2)
  check('L6 Undo finds the re-added song at the end of a 1500-song queue (paged) and moves it back after the row it followed',
    where === 'ok' && J(pages) === J([0, 500, 1000, 1500]) && move?.args.queue_item_id === 'qi_new' && move?.args.pos_shift === 3 - 1499, J({ where, pages, move }));
}

// ---- the queue id a row action uses ----
{
  const { hass, calls } = server({ n: 40, cur: 5, qid: 'q_old' });
  const qm = await model(hass); await qm.refresh();
  check('L7 setup: the last read named q_old', qm.snap.queueId === 'q_old');
  qm.liveQueueId = () => 'q_new';
  calls.length = 0;
  await qm.playNow('qi9');
  await qm.playNext('qi20');
  await qm.removeRow('qi30').catch(() => {});
  const ids = calls.filter((c) => c.t.startsWith('player_queues/') && c.t !== 'player_queues/items').map((c) => c.args.queue_id);
  check('L8 row actions (play now, play next, remove) go to the live feed\'s queue now, not the last read\'s', ids.length === 3 && ids.every((q) => q === 'q_new'), J(ids));
  qm.liveQueueId = () => null;
  let msg = ''; try { await qm.playNow('qi9'); } catch (e) { msg = e.message; }
  check('L9 the feed says the speaker plays no queue now → refused with the no-queue message, nothing sent', /Nothing queued/.test(msg) && !calls.slice(3).some((c) => c.t === 'player_queues/play_index'), msg);
}
{
  const { hass, calls } = server({ n: 40, cur: 5, qid: 'q_old', active: 'q_now' });
  const qm = await model(hass); await qm.refresh();
  calls.length = 0;
  await qm.playNow('qi9');
  const pi = calls.find((c) => c.t === 'player_queues/play_index');
  check('L10 without the live feed the backend\'s active-queue lookup runs when the action runs', calls[0]?.t === 'active_queue' && pi?.args.queue_id === 'q_now', J(calls));
}
{
  const { hass, calls } = server({ n: 40, cur: 5, qid: 'q_old', activeFails: true });
  const qm = await model(hass); await qm.refresh();
  calls.length = 0;
  await qm.playNow('qi9');
  const pi = calls.find((c) => c.t === 'player_queues/play_index');
  check('L11 an integration without active_queue: the last read\'s queue, as before', pi?.args.queue_id === 'q_old', J(calls));
}

console.warn = origWarn;
console.log(`\n${total - failures}/${total} queue-long unit checks passed`);
process.exit(failures ? 1 : 0);

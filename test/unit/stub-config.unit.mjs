// #106: a new card never hard-codes media_player.everywhere. #99: getStubConfig picks no player at all (Randy, Nov 19);
// ma-player.ts only tells Music Assistant players apart; playMedia and friends never target everywhere when entity is missing. Usage: node test/unit/stub-config.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-stub-config/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/ma-player.ts', 'src/shared.ts', 'src/speakers/model.ts', 'src/queue-model.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

globalThis.window = globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
globalThis.document ??= { createElement: () => ({}), createComment: () => ({}), createTreeWalker: () => ({}), importNode: () => ({}) };

const origWarn = console.warn; console.warn = () => {};
const P = await import(OUT + 'ma-player.mjs');
const S = await import(OUT + 'shared.mjs');
const M = await import(OUT + 'model.mjs');
const Q = await import(OUT + 'queue-model.mjs');
console.warn = origWarn;

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;

const garage = 'media_player.garage';
const ev = 'media_player.everywhere';
const living = 'media_player.living_room';
const ma = (id) => ({ entity_id: id, platform: 'music_assistant' });
const st = (id, name) => ({ entity_id: id, state: 'idle', attributes: { friendly_name: name } });

function hassOf(ids, platforms = {}) {
  const entities = {}, states = {};
  for (const id of ids) {
    entities[id] = platforms[id] ?? (id.startsWith('media_player.') ? ma(id) : { entity_id: id, platform: 'other' });
    states[id] = st(id, id.replace(/^media_player\./, '').replace(/_/g, ' '));
  }
  return { states, entities };
}

// #99 (Randy, Nov 19): no speaker is ever picked for a new card. ma-player.ts only says what is a Music Assistant player.
check('S1 the old first-player pick is gone', !('firstMusicAssistantPlayer' in P), J(Object.keys(P)));
check('S2 isMaPlayer: no hass / no registry → false', !P.isMaPlayer(undefined, garage) && !P.isMaPlayer({ states: {}, entities: {} }, garage));
check('S3 isMaPlayer: registry platform music_assistant only (a cast speaker is not one, whatever its name)',
  P.isMaPlayer(hassOf([garage]), garage) && !P.isMaPlayer(hassOf([living], { [living]: { entity_id: living, platform: 'cast' } }), living));
check('S4 isMaPlayer: only media_player entities (an MA button is not a player)',
  !P.isMaPlayer(hassOf(['button.x'], { 'button.x': { entity_id: 'button.x', platform: 'music_assistant' } }), 'button.x'));
check('S5 registryReady: false until Home Assistant sends hass.entities',
  !P.registryReady(undefined) && !P.registryReady({ states: {} }) && !P.registryReady({ states: {}, entities: {} }) && P.registryReady(hassOf([garage])));

const calls = [];
const hass = {
  states: { [garage]: st(garage, 'Garage') },
  callService: async (domain, service, data, target) => { calls.push({ domain, service, data, target }); return {}; },
};
const track = { media_type: 'track', uri: 'library://track/1', name: 'Song' };

await S.playMedia(hass, { type: 'custom:jukebox-card' }, track, 'track', 'play');
await S.shufflePlay(hass, { type: 'custom:jukebox-card' }, track, 'track');
await S.playInOrder(hass, { type: 'custom:jukebox-card' }, track, 'track');
check('S8 playMedia / shufflePlay / playInOrder with no entity never call a service (and never target everywhere)',
  calls.length === 0, J(calls));

calls.length = 0;
const r = await S.playMedia(hass, { type: 'custom:jukebox-card', entity: garage }, track, 'track', 'play');
check('S9 with a configured player, play_media goes only there (not everywhere)',
  r?.entity_id === garage && calls.length === 1 && calls[0].target?.entity_id === garage && calls[0].target.entity_id !== ev, J({ r, calls }));

const msgNone = S.playMessage(hass, { type: 'custom:jukebox-card' }, track, 'play', false, false);
const msgGarage = S.playMessage(hass, { type: 'custom:jukebox-card', entity: garage }, track, 'play', false, false);
check('S10 playMessage with no entity does not say Everywhere',
  !/everywhere/i.test(msgNone) && msgNone === 'Playing Song', msgNone);
check('S11 playMessage uses the configured player name, not Everywhere',
  msgGarage === 'Playing Song on Garage' && !/everywhere/i.test(msgGarage), msgGarage);

const targets = M.targetsOf({ type: 'custom:jukebox-card' }, hass);
check('S12 targetsOf with no entity does not invent media_player.everywhere',
  !targets.some((t) => t.entity === ev), J(targets));

const q = new Q.QueueModel();
check('S13 QueueModel starts with no player', q.entity === '' && !q.configForRemove.entity, J({ entity: q.entity, cfg: q.configForRemove }));

// #106 review: with no player, a queue action leaves the list alone (no optimistic change that never gets sent)
{
  const qn = new Q.QueueModel(); qn.hass = { states: {}, callService: async () => { throw new Error('no call expected'); } };
  qn.snap = { items: [{ queue_item_id: 'a' }, { queue_item_id: 'b' }, { queue_item_id: 'c' }], current: 0, loading: false, error: '', at: 0 };
  const before = JSON.stringify(qn.snap.items);
  let seen = 0; qn.subscribe(() => seen++); seen = 0;
  await qn.down('b');
  check('S14 no player: a queue move changes nothing on screen', JSON.stringify(qn.snap.items) === before && seen === 0, J({ items: qn.snap.items, seen }));
}

console.log(`\nstub-config.unit: ${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

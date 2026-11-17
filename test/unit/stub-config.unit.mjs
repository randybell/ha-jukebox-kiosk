// #106: a new card never hard-codes media_player.everywhere. getStubConfig / firstMusicAssistantPlayer
// pick the first Music Assistant player (object-key order) or nothing; playMedia and friends never
// target everywhere when entity is missing. Usage: node test/unit/stub-config.unit.mjs
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

check('S1 no hass → no player', P.firstMusicAssistantPlayer() === undefined);
check('S2 empty entities/states → no player', P.firstMusicAssistantPlayer({ states: {}, entities: {} }) === undefined);
check('S3 first Music Assistant player in key order (garage before everywhere)',
  P.firstMusicAssistantPlayer(hassOf([garage, ev, living])) === garage, P.firstMusicAssistantPlayer(hassOf([garage, ev, living])));
check('S4 when everywhere is first in the registry, the stub may pick it (it is a real MA player, not a hard-coded default)',
  P.firstMusicAssistantPlayer(hassOf([ev, garage])) === ev);
check('S5 non-MA media players are skipped',
  P.firstMusicAssistantPlayer(hassOf([living, garage], { [living]: { entity_id: living, platform: 'cast' }, [garage]: ma(garage) })) === garage);
check('S6 an MA player with no state is skipped', (() => {
  const h = hassOf([garage, ev]);
  delete h.states[garage];
  return P.firstMusicAssistantPlayer(h) === ev;
})());
check('S7 only a light, no media_player → no player',
  P.firstMusicAssistantPlayer(hassOf(['light.kitchen'], { 'light.kitchen': { entity_id: 'light.kitchen', platform: 'music_assistant' } })) === undefined);

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

console.log(`\nstub-config.unit: ${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

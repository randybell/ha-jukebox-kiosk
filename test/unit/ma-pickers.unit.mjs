// #132 unit checks: the editor's Player, Room volume sliders and Groups to play on pickers list only Music Assistant
// players. HA's entity selector `filter.integration` keeps an entity whose entity registry `platform` matches (frontend
// src/data/selector.ts filterSelectorEntities), the same rule ma-player.ts uses. Usage: node test/unit/ma-pickers.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-ma-pickers/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/editor.ts', 'src/ma-player.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();
globalThis.window ??= globalThis;
const Ed = await import(OUT + 'editor.mjs');
const M = await import(OUT + 'ma-player.mjs');

const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const flat = (c) => Ed.editorSchema(c).flatMap((x) => x.schema ?? [x]);
const field = (c, n) => flat(c).find((x) => x.name === n);
const WANT = { domain: 'media_player', integration: 'music_assistant' };
// HA's own filter (selector.ts filterSelectorEntities, domain + integration parts) on the picker's filter
const haKeeps = (f, id, reg) => (!f.domain || id.split('.')[0] === f.domain) && (!f.integration || reg[id]?.platform === f.integration);
const reg = { 'media_player.kitchen_ma': { platform: 'music_assistant' }, 'media_player.kitchen_cast': { platform: 'cast' }, 'media_player.tv': { platform: 'webostv' }, 'button.kitchen_ma_favorite_current_song': { platform: 'music_assistant' } };
const states = Object.fromEntries(Object.keys(reg).map((id) => [id, { entity_id: id, state: 'idle', attributes: {} }]));

for (const [n, multi, label] of [['entity', false, 'Player'], ['rooms', true, 'Room volume sliders'], ['targets', true, 'Groups to play on']]) {
  const f = field(n === 'targets' ? { speaker_mode: 'dynamic' } : {}, n);
  const e = f?.selector?.entity;
  check(`P ${label}: HA entity picker filtered to Music Assistant media players`, !!e && J(e.filter) === J(WANT) && !('domain' in e) && !!e.multiple === multi, J(f?.selector));
  const kept = Object.keys(reg).filter((id) => haKeeps(e.filter, id, reg));
  check(`P ${label}: only the Music Assistant player passes HA's filter`, J(kept) === J(['media_player.kitchen_ma']), J(kept));
}
// #99: the card's own rule (rooms, targets, the card's player) keeps exactly what the pickers offer
const cardKeeps = Object.keys(reg).filter((id) => M.isMaPlayer({ entities: reg, states }, id));
check('P same rule as the card: isMaPlayer keeps exactly the pickers\' Music Assistant player', J(cardKeeps) === J(['media_player.kitchen_ma']), J(cardKeeps));
check('P no picker anywhere still lists every media_player', !flat({ speaker_mode: 'dynamic' }).some((x) => x.selector?.entity && !x.selector.entity.filter?.integration));

console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

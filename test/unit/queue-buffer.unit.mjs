// #85: a guest who may not group still reads the queue buffer, so the 'already loading' greying matches admins.
// Bundled on the fly. Usage: node test/unit/queue-buffer.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync, readFileSync } from 'node:fs';

const OUT = new URL('../tmp/unit-queue-buffer/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/queue-model.ts', 'src/speakers/model.ts'], plugins: [resolve(), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

globalThis.window = globalThis;
globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
globalThis.document ??= { createElement: () => ({}), createComment: () => ({}), createTreeWalker: () => ({}), importNode: () => ({}) };
const origWarn = console.warn; console.warn = () => {};

const Q = await import(OUT + 'queue-model.mjs');
const M = await import(OUT + 'model.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = JSON.stringify;

const guest = { id: 'u-guest', name: 'Kitchen Tablet', is_admin: false };
const cfg = { type: 'custom:jukebox-card', entity: 'media_player.everywhere' }; // grouping default: admins
const cardSrc = readFileSync(new URL('../../src/jukebox-card.ts', import.meta.url), 'utf8');
const assign = cardSrc.match(/this\.queue\.readsBuffer = (\(\) => [^;]+);/);
check('#85 card sets readsBuffer from a simple assignment', !!assign, assign ? assign[1] : 'not found');
const body = assign ? assign[1].replace(/^\(\)\s*=>\s*/, '') : 'false';
let jumpCalls = 0;
const canJumpQueue = () => { jumpCalls++; return false; }; // guest may not group
const readsBuffer = new Function('canJumpQueue', `return function() { return (${body}); }`)(canJumpQueue);
const got = readsBuffer.call({ _config: cfg, hass: { user: guest } });
check('#85 a guest who may not group still reads the queue buffer', got === true && jumpCalls === 0, `got=${got} jumpCalls=${jumpCalls}`);
check('#85 canJumpQueue is gone (grouping no longer gates the buffer read)', M.canJumpQueue === undefined);

{
  const items = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'].map((id, i) => ({ queue_item_id: id, media_title: `Song ${i}`, media_content_id: `apple_music://track/${i}` }));
  const calls = [];
  const be = {
    async queueWindow(_entity, _limitAfter, wantBuffer) {
      calls.push({ wantBuffer });
      return { items, queueId: 'q', currentIndex: 7, currentItemId: 'q1', total: 40, ...(wantBuffer ? { bufferIndex: 8 } : {}) };
    },
  };
  const qm = new Q.QueueModel();
  qm.hass = { states: { 'media_player.everywhere': { attributes: {} } } };
  qm.entity = 'media_player.everywhere';
  qm.backend = be;
  qm.readsBuffer = () => readsBuffer.call({ _config: cfg, hass: { user: guest } });
  await qm.refresh();
  check('#85 guest buffer read greys the already-loading row (q2 locked, q3 free)',
    calls[0]?.wantBuffer === true && qm.snap.bufferIndex === 8 && qm.locked === 2 && qm.isLocked('q2') && !qm.isLocked('q3'),
    J({ calls, b: qm.snap.bufferIndex, l: qm.locked }));
}

console.warn = origWarn;
console.log(`\n${total - failures}/${total} queue-buffer unit checks passed`);
process.exit(failures ? 1 : 0);

// Unit checks for src/define.ts: elements survive Home Assistant 2026.10 replacing window.customElements with its
// scoped-registry polyfill after this bundle has already defined them. Fake registries; no browser.
// Usage: node test/unit/define.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-define/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/define.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();

class FakeRegistry {
  constructor(label) { this.label = label; this.m = new Map(); }
  get(n) { return this.m.get(n); }
  define(n, c) { if (this.m.has(n)) throw new Error(`"${n}" already defined in ${this.label}`); this.m.set(n, c); }
}
globalThis.window = globalThis;
window.customElements = new FakeRegistry('native');
const warns = [];
console.warn = (...a) => warns.push(a.join(' '));
const D = await import(OUT + 'define.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
class Card {} class Now {} class Other {}

const native = window.customElements;
D.defineElement('jukebox-card', Card);
D.defineElement('jb-now', Now);
check('D1 elements are defined in the registry present at load', native.get('jukebox-card') === Card && native.get('jb-now') === Now);

// the HA app bundle installs its polyfill registry (empty) after our module ran
const poly = new FakeRegistry('polyfill');
window.customElements = poly;
check('D2 before the watcher runs the new registry misses the card (the "Configuration error" case)', !poly.get('jukebox-card'));
await tick(D.WATCH_EVERY_MS * 3);
check('D3 the watcher re-defines every element in the swapped-in registry', poly.get('jukebox-card') === Card && poly.get('jb-now') === Now);

// a second copy of the bundle (other URL) finds the name taken: no throw, no overwrite, no warning
const before = warns.length;
D.defineElement('jukebox-card', Other);
check('D4 a second copy (double-load) leaves the first definition and logs nothing', poly.get('jukebox-card') === Card && warns.length === before, JSON.stringify(warns.slice(before)));

// once the HA app has registered its own elements the watcher stops
poly.define('home-assistant-main', class {});
D.syncRegistry();
const later = new FakeRegistry('later');
window.customElements = later;
await tick(D.WATCH_EVERY_MS * 3);
check('D5 the watcher stops once the app is ready (no further polling)', !later.get('jukebox-card'));
D.syncRegistry();
check('D6 an explicit syncRegistry() still defines into a new registry', later.get('jukebox-card') === Card && later.get('jb-now') === Now);

console.log(`\n${total - failures}/${total} define checks passed`);
process.exit(failures ? 1 : 0);

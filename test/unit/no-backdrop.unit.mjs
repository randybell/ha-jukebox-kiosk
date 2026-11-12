// 0.8.3 (#96): album art is a background on the screensaver only. The `backdrop` option is gone: no editor field, label, shown default,
// type, validation, module or Now Playing art layer is left, so a saved `backdrop` (full, junk, anything) is never read by the card.
// (The card itself loading it with no error and the plain look is checked in the browser: test/run.mjs 15a-15c, test/screensaver-bg.e2e.mjs.)
// Bundled on the fly; no browser, no network. Usage: node test/unit/no-backdrop.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';

const OUT = new URL('../tmp/unit-no-backdrop/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/editor.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();
globalThis.window ??= globalThis;
const Ed = await import(OUT + 'editor.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const names = (schema) => schema.flatMap((f) => (f.schema ? names(f.schema) : [f.name]));

// the editor, for any config a dashboard might have saved, never offers or labels the option
for (const [tag, cfg] of [['no config', {}], ['backdrop: full', { backdrop: 'full' }], ['backdrop: plain', { backdrop: 'plain' }], ['backdrop: junk', { backdrop: 'not-a-mode' }], ['backdrop: 7', { backdrop: 7 }]]) {
  let fields = [], err = '';
  try { fields = names(Ed.editorSchema(cfg)); } catch (e) { err = e.message; }
  check(`B1 the editor builds with ${tag}, with no error and no Background field`, !err && fields.length > 0 && !fields.includes('backdrop'), err || fields.join(','));
}
check('B2 no Background label and no shown default for it', !('backdrop' in Ed.LABELS) && !('backdrop' in Ed.SHOWN_DEFAULTS));
check('B3 the other Display fields are all still there, in order', JSON.stringify(names(Ed.editorSchema({})).filter((n) => ['default_tab', 'screensaver_minutes', 'screensaver_lyrics', 'coerce_repeat_one'].includes(n))) === JSON.stringify(['default_tab', 'screensaver_minutes', 'screensaver_lyrics', 'coerce_repeat_one']));

// the card: nothing reads, validates or draws a backdrop any more
const SRC = new URL('../../src/', import.meta.url);
const card = readFileSync(new URL('jukebox-card.ts', SRC), 'utf8'), types = readFileSync(new URL('types.ts', SRC), 'utf8'), styles = readFileSync(new URL('styles.ts', SRC), 'utf8');
check('B4 the card never reads config.backdrop (so no validation can throw on it)', !/config\.backdrop|_config\.backdrop|c\.backdrop|BACKDROPS/.test(card) && !/backdrop\?:/.test(types));
check('B5 no backdrop module, host attribute, art layer, shade or blur token is left', !existsSync(new URL('backdrop.ts', SRC)) && !/data-?backdrop|dataset\.backdrop|resolveBackdrop|drawPreblurred|has-art|on-now|\.bdl|--_art\b/.test(card) && !/--_shade|--_vignette|--_backdrop/.test(styles));
check('B6 the screensaver still has its own album-art layer (.sv-bg) and the black canvas (.amb)', /\.sv-bg \{[^}]*background-size: cover/.test(card) && /\.amb \{[^}]*background: #000/.test(card) && /class="sv-bg"/.test(card));

console.log(`\n${total - failures}/${total} no-backdrop checks passed`);
process.exit(failures ? 1 : 0);

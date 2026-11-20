// #143: the window.__jb* test hooks (queue undo, speaker chips, speaker timeouts) are not in the shipped card, and the
// e2e build (JB_TEST_HOOKS=1) still has them for the browser tests. Usage: node test/unit/test-hooks.unit.mjs
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const HOOKS = ['__jbQueueUndoMs', '__jbSpeakerTimeouts', '__jbErrorMs', '__jbAskMs', '__jbUndoMs', '__jbChipMs'];
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const card = readFileSync(new URL('../../custom_components/jukebox_kiosk/www/jukebox-card.js', import.meta.url), 'utf8');
const shipped = HOOKS.filter((h) => card.includes(h));
check('H1 the shipped card has none of the six window.__jb* test hooks', shipped.length === 0, shipped.join(', '));
check('H2 the shipped card has no __jb / __JB_TEST_HOOKS__ names at all', !/__jb|__JB_TEST_HOOKS__/.test(card), (card.match(/__jb\w*|__JB\w*/g) ?? []).join(', '));
const ok = existsSync(new URL('../hooks-build.mjs', import.meta.url));
if (ok) {
  const { hooksBuild } = await import('../hooks-build.mjs');
  let err = ''; try { hooksBuild(); } catch (e) { err = e.message; }
  const hb = new URL('../tmp/jukebox-card.hooks.js', import.meta.url);
  const t = !err && existsSync(hb) ? readFileSync(hb, 'utf8') : '';
  check('H3 the e2e build still has all six hooks', HOOKS.every((h) => t.includes(h)), err || HOOKS.filter((h) => !t.includes(h)).join(', '));
} else check('H3 the e2e build (test/hooks-build.mjs) exists', false);
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

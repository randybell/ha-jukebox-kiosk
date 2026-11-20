// #143: the window.__jb* test hooks (undo, chip and speaker timeouts) are not in the shipped card. Tests that set them
// build a hooks card once per run (JB_TEST_HOOKS=1 -> test/tmp/jukebox-card.hooks.js, from the current src) and open the
// dev harness with &hooks=1, which loads that build instead of custom_components/jukebox_kiosk/www/jukebox-card.js.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let built = false;
export function hooksBuild() {
  if (built || process.env.JB_URL) return;
  const r = spawnSync(process.execPath, ['node_modules/rollup/dist/bin/rollup', '-c', '--silent'], { cwd: ROOT, env: { ...process.env, JB_TEST_HOOKS: '1' }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('hooks build failed');
  built = true;
}

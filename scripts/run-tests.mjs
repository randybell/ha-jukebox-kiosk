// Runs every test file of a group, one after another, and fails if any of them fails.
// New files are picked up automatically by name:
//   unit -> test/unit/*.unit.mjs                      (no server or browser)
//   e2e  -> test/run.mjs + test/*.e2e.mjs except fit   (browser tests; each starts its own dev server)
//   fit  -> test/fit.e2e.mjs                           (fit-to-height on all 11 screen sizes)
// Usage: node scripts/run-tests.mjs unit|e2e|fit [--list]
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ls = (dir, re) => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`);
const GROUPS = {
  unit: () => ls('test/unit', /\.unit\.mjs$/),
  e2e: () => ['test/run.mjs', ...ls('test', /\.e2e\.mjs$/).filter((f) => f !== 'test/fit.e2e.mjs')],
  fit: () => ['test/fit.e2e.mjs'],
};
const [group, flag] = process.argv.slice(2);
if (!GROUPS[group]) { console.error(`usage: node scripts/run-tests.mjs ${Object.keys(GROUPS).join('|')} [--list]`); process.exit(2); }
const files = GROUPS[group]();
if (!files.length) { console.error(`no ${group} test files found`); process.exit(1); }
if (flag === '--list') { console.log(files.join('\n')); process.exit(0); }

const failed = [];
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [f], { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed.push(`${f} (${r.signal ?? `exit ${r.status}`})`);
}
console.log(`\n${group}: ${files.length - failed.length}/${files.length} files passed${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);

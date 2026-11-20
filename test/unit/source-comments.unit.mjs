// #141: no approvals, dates or Randy- / brand-specific notes in the source comments of these files (queue-view.ts is
// another developer's file and is left alone). Usage: node test/unit/source-comments.unit.mjs
import { readFileSync } from 'node:fs';
const FILES = ['src/shared.ts', 'src/hold-sheet.ts', 'src/song-info.ts', 'src/detail-view.ts', 'src/types.ts'];
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
for (const f of FILES) {
  const hits = readFileSync(new URL('../../' + f, import.meta.url), 'utf8').split('\n')
    .map((l, i) => [i + 1, l]).filter(([, l]) => /Approved by|\bRandy\b|WiiM/.test(l)).map(([n, l]) => `${n}: ${l.trim().slice(0, 80)}`);
  check(`${f}: no approval, Randy or brand notes`, hits.length === 0, hits.join(' | '));
}
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

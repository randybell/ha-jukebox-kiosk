// 0.9.0 #117: every declaration inside the card's css`` blocks must have a property name. A value left on its own
// (for example `var(--ha-border-width-sm, 1px) solid var(--_surface-border);` after `border:` was lost) is dropped by
// the browser without any error. Reads the source (no browser). Usage: node test/unit/css-declarations.unit.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
const SRC = new URL('../../src/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(d + f).isDirectory() ? walk(d + f + '/') : /\.ts$/.test(f) ? [d + f] : []));
const bad = [];
let blocks = 0, decls = 0;
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/css`([\s\S]*?)`/g)) {
    blocks++;
    // comments and ${} interpolations blanked, line numbers kept
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' ')).replace(/\$\{[^}]*\}/g, (s) => s.replace(/[^\n]/g, 'x'));
    const base = m.index + 4;
    let start = 0;
    const decl = (s, e) => {
      const t = body.slice(s, e).trim();
      if (!t) return;
      decls++;
      if (/^[-\w]+\s*:/.test(t) || t.startsWith('@')) return;
      const lead = body.slice(s, e).match(/^\s*/)[0];
      const line = src.slice(0, base + s + lead.length).split('\n').length;
      bad.push(`${file.slice(SRC.length)}:${line}: ${t.replace(/\s+/g, ' ').slice(0, 120)}`);
    };
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '{') start = i + 1;
      else if (c === ';' || c === '}') { decl(start, i); start = i + 1; }
    }
  }
}
const ok = bad.length === 0 && blocks > 10;
console.log(`${ok ? 'PASS' : 'FAIL'}  every css declaration has a property name (${blocks} blocks, ${decls} declarations)`);
for (const b of bad) console.log(`  value with no property name: ${b}`);
console.log(`\n${ok ? 1 : 0}/1 passed`);
process.exit(ok ? 0 : 1);

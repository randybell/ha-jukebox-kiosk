// Usage: node test/speaker-count.e2e.mjs
// 0.7.12: the top-bar pill and the Speakers panel give the same speaker count, also when Everywhere playing; HA reports group_members with ONE entry, MA's group has 4 members
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--hide-scrollbars', '--font-render-hinting=none'] });
const p = await b.newPage(); await hermetic(p); await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&spk=dyn&admin=1`); await p.waitForFunction('window.__ready === true'); await sleep(1500);
await p.evaluate(() => { const c = __card, e = c._config.entity, h = c.hass; const st = h.states[e];
  const one = [(st.attributes.group_members || [])[0] || 'media_player.living_room'];
  c.hass = { ...h, states: { ...h.states, [e]: { ...st, attributes: { ...st.attributes, group_members: one } } } };
  });
await sleep(400);
await p.evaluate(() => __card.shadowRoot.querySelector('.pill').click()); await sleep(1200);
const txt = await p.evaluate(() => ({ pill: __card.shadowRoot.querySelector('.pill b')?.textContent.trim(), panel: [...__card.shadowRoot.querySelector('jb-speakers').shadowRoot.querySelectorAll('*')].find((x) => /· \d+ speaker/.test(x.textContent) && x.children.length === 0)?.textContent.trim() }));
const n = (t) => +(/(\d+) speaker/.exec(t || '')?.[1] ?? -1);
const ok = n(txt.pill) === n(txt.panel) && n(txt.pill) === 3;
console.log(`${ok ? 'PASS' : 'FAIL'}  pill and Speakers panel agree (MA's 3 members) while HA lists only the leader  — ${JSON.stringify(txt)}`);
console.log(`\n${ok ? 1 : 0}/1 speaker-count checks passed`);
await b.close(); process.exit(ok ? 0 : 1);

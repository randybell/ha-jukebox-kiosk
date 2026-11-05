// v0.7 design-branch screenshots (mock data only) → test/shots/v070-design/<item>-<name>-<w>x<h>.png (git-ignored).
// Items: q62 (speakers chip question survives updates), q60 (idle reset clears filters), hearts, station-add, join-resume, dedupe.
// Usage: (starts its own dev server; JB_PORT / JB_URL / JB_ROOT override) node tools/screenshots/shots-design.mjs [item ...]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { hermetic } from '../../test/intercept.mjs';
import { devIndex } from '../../test/serve.mjs';

const BASE = await devIndex();
const OUT = new URL('../../test/shots/v070-design/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = `__card.shadowRoot`;
const SPK = `${C}.querySelector('jb-speakers')`, SR = `${SPK}.shadowRoot`;
const SV = `${C}.querySelector('jb-search').shadowRoot`, SD = `${SV}.querySelector('jb-detail')?.shadowRoot`;
const BR = `${C}.querySelector('jb-browse').shadowRoot`, BD = `${BR}.querySelector('jb-detail')?.shadowRoot`;
const KB = `${BR}.querySelector('jb-keyboard')?.shadowRoot`;
const NOW = `${C}.querySelector('jb-now').shadowRoot`;
const IN = 'media_player.indoor', LIV = 'media_player.living_room', KIT = 'media_player.kitchen', GAR = 'media_player.garage';
const act = (e) => `${SR}.querySelector('[data-room="${e}"]')?.querySelector('.act')`;
const want = new Set(process.argv.slice(2));
const on = (k) => !want.size || want.has(k);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const done = [];

for (const vp of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const open = async (q, cfg) => {
    const p = await browser.newPage(); await hermetic(p); await p.setViewport({ deviceScaleFactor: 1, ...vp });
    await p.evaluateOnNewDocument(() => { window.__jbAskMs = 60000; window.__jbUndoMs = 60000; window.__jbChipMs = 60000; window.__jbSpeakerTimeouts = { call: 2500, join: 2500, move: 3000, poll: 250, fast: 120 }; });
    await p.goto(`${BASE}?fresh=1&latency=30&gap=500${q}${cfg ? `&cfg=${encodeURIComponent(JSON.stringify(cfg))}` : ''}`); await p.waitForFunction('window.__ready === true'); await sleep(400); return p;
  };
  const ev = (p, e) => p.evaluate((x) => eval(x), e);
  const wait = (p, f, timeout = 6000) => p.waitForFunction(f, { timeout, polling: 40 }).then(() => true, () => { console.log('timeout', f); return false; });
  const tap = async (p, e) => { const r = await ev(p, `(() => { const el = ${e}; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await p.mouse.click(r.x, r.y); await sleep(150); };
  const shot = async (p, item, n) => { await sleep(450); const f = `${OUT}${item}-${n}-${tag}.png`; await p.screenshot({ path: f }); done.push(f); };
  const ctx = { open, ev, wait, tap, shot, vp, tag };

  if (on('q62')) {
    const p = await open(`&tab=now&spk=dyn&admin=1&ma=split&target=${IN}`);
    await tap(p, `${C}.querySelector('.pill')`);
    await wait(p, `${SPK}.store?.loaded && !!${SR}.querySelector('[data-room] .where')`);
    await wait(p, `!!${act(GAR)}`);
    await tap(p, act(GAR));
    await wait(p, `!!${SR}.querySelector('.st.ask')`);
    for (let i = 0; i < 4; i++) {
      await ev(p, `(() => { const h = __card.hass, s = { ...h.states }; for (const id of ['${LIV}', '${KIT}', '${GAR}']) if (s[id]) s[id] = { ...s[id], attributes: { ...s[id].attributes, volume_level: ${0.3 + i * 0.05} } }; __card.hass = { ...h, states: s }; })()`);
      await sleep(100);
    }
    await ev(p, `${SPK}.status('Kitchen joined Indoor', { undo: { label: 'Kitchen joined', run: async () => {} } })`);
    await shot(p, 'q62', 'ask-survives-updates');
    await tap(p, `${SR}.querySelector('.st.ask [data-action="confirm"]')`);
    await wait(p, `!${SR}.querySelector('.st.ask') && /Kitchen joined/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`);
    await shot(p, 'q62', 'held-message-after-answer');
    await p.close();
  }
  if (on('q60')) {
    const p = await open('&tab=search&jjgrey=1&saver=0.05');
    await p.keyboard.type('JJ GREY', { delay: 20 });
    await wait(p, `${SV}.querySelector('.row[data-group="artists"][data-uri^="library://"]')`);
    await tap(p, `${SV}.querySelector('.row[data-group="artists"][data-uri^="library://"] .rt')`);
    await wait(p, `${SD}?.querySelector('[data-action="scope"]')`);
    await tap(p, `${SD}.querySelector('[data-action="scope"]')`);
    await wait(p, `${SV}.querySelector('.sc[data-scope="artist"]')`);
    await shot(p, 'q60', 'a-scoped-before-idle');
    await wait(p, `${C}.querySelector('.saver.on')`, 12000);
    await tap(p, `${C}.querySelector('.saver')`); await wait(p, `!${C}.querySelector('.saver')`);
    await shot(p, 'q60', 'b-after-idle-reset');
    await p.close();
  }
  for (const [k, fn] of Object.entries(globalThis.__extraShots ?? {})) if (on(k)) await fn(ctx);
}
await browser.close();
console.log(done.join('\n'));

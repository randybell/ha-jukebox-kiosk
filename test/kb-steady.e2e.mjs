// 0.7.9 #57: no Recent searches, and the Library keyboard stays put when typing starts. Usage: node test/kb-steady.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
const SIZES = [[1024, 600], [1024, 666], [1280, 720], [1366, 768], [1440, 900], [1280, 800], [1920, 1080], [390, 844], [844, 390], [820, 1180], [1180, 820]];
for (const kiosk of [true, false]) for (const [w, h] of SIZES) {
  const p = await b.newPage(); await hermetic(p); await p.setViewport({ width: w, height: h });
  // an old 0.7.8 search history on the device
  await p.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('kbseed')) { localStorage.setItem('jukebox-card:recents:v1', JSON.stringify(['MOCK', 'CHICAGO'])); sessionStorage.setItem('kbseed', '1'); } } catch {} });
  await p.goto(`${BASE}?fresh=1&latency=30&tab=browse${kiosk ? '&kiosk=1' : ''}`); await p.waitForFunction('window.__ready === true'); await sleep(700);
  const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
  const top = () => p.evaluate((sv) => Math.round(eval(sv).querySelector('jb-keyboard').getBoundingClientRect().top * 10) / 10, SV);
  const key = (c) => p.evaluate((sv, c) => [...eval(sv).querySelector('jb-keyboard').shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === c).click(), SV, c);
  const t = [await top()];
  await key('M'); await sleep(50); t.push(await top()); await sleep(900); t.push(await top());
  for (const c of 'OCK') { await key(c); await sleep(120); } await sleep(1200); t.push(await top());
  const row = await p.evaluate((sv) => !!eval(sv).querySelector('.recents:not(:empty), .recents .chip'), SV);
  const stored = await p.evaluate(() => localStorage.getItem('jukebox-card:recents:v1'));
  check(`KS [${kiosk ? 'kiosk ' : ''}${w}x${h}] keyboard top unchanged before / 1 char / settled / 4 chars; no Recent searches row; old history cleared`,
    t.every((x) => x === t[0]) && !row && stored === null, J({ top: t, row, stored }));
  await p.close();
}
await b.close();
console.log(`\n${total - failures}/${total} keyboard-steady checks passed`);
process.exit(failures ? 1 : 0);

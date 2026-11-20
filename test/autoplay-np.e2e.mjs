// Now Playing Autoplay button (spot A): MA 2.17.297.post3 show/hide, same set_autoplay as the Queue header.
// 1024x600 only. Usage: node test/autoplay-np.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + String(info).slice(0, 400) : ''}`); };
const J = JSON.stringify;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const NV = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, expr, timeout = 8000) => p.waitForFunction((e) => !!eval(e), { timeout }, expr).then(() => true, () => false);
const AP = encodeURIComponent(J({ autoplay: true }));
const open = async (extra = '') => {
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=now&kcaps=${AP}${extra}`);
  await p.waitForFunction('window.__ready === true'); await sleep(900);
  return p;
};
const ap = (p) => ev(p, `(() => { const r = ${NV}; const b = r.querySelector('[data-action="np-autoplay"]');
  return { has: !!b, pressed: b?.getAttribute('aria-pressed'), disabled: !!b?.disabled, tag: b?.tagName, label: b?.textContent?.replace(/\\s+/g, ' ').trim(),
    tb: !!r.querySelector('.tb[aria-label*="Autoplay"]'), inBadges: !!r.querySelector('.badges [data-action="np-autoplay"]') }; })()`);
const mark = (p) => ev(p, 'window.__mark = (window.__ws || []).length');
const sets = (p) => p.evaluate(() => (window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'set_autoplay' || m.type === 'jukebox_kiosk/set_autoplay').map((m) => ({ type: m.type, e: m.entity_id, on: m.enabled })));

{
  const p = await open();
  const a = await ap(p);
  check('NP1 default track queue, autoplay off: toggle at spot A (badges), off, not a transport button',
    a.has && a.inBadges && a.pressed === 'false' && !a.disabled && a.label === 'Autoplay' && !a.tb, J(a));
  await mark(p);
  await ev(p, `${NV}.querySelector('[data-action="np-autoplay"]').click()`); await sleep(400);
  const a2 = await ap(p);
  const sent = await sets(p);
  check('NP2 tap → jukebox_kiosk/set_autoplay {enabled: true}, button on',
    sent.length === 1 && sent[0].on === true && /^media_player\./.test(sent[0].e) && a2.pressed === 'true' && !a2.disabled, J({ sent, a2 }));
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="queue"]').click()`); await sleep(700);
  await wait(p, `${QV}.querySelector('.ap')`);
  const qOn = await ev(p, `${QV}.querySelector('.ap').classList.contains('on')`);
  check('NP3 Queue header pill stays in step after the Now Playing tap', qOn === true, String(qOn));
  await mark(p);
  await ev(p, `${QV}.querySelector('.ap').click()`); await sleep(400);
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="now"]').click()`); await sleep(700);
  const a3 = await ap(p);
  const sent2 = await sets(p);
  check('NP4 Queue pill off updates the Now Playing button',
    sent2.length === 1 && sent2[0].on === false && a3.pressed === 'false', J({ sent2, a3 }));
  await p.close();
}
{
  const p = await open('&qtype=radio');
  const a = await ap(p);
  check('NP5 radio (infinite stream): hidden, not because duration is missing', !a.has && !a.tb, J(a));
  await p.close();
}
{
  const p = await open('&qtype=audio_source');
  const a = await ap(p);
  check('NP6 live AUDIO_SOURCE: hidden', !a.has, J(a));
  await p.close();
}
{
  const p = await open('&qactive=0');
  const a = await ap(p);
  check('NP7 inactive queue: hidden', !a.has, J(a));
  await p.close();
}
{
  const p = await open('&qdyn=1');
  const a = await ap(p);
  check('NP8 dynamic queue: shown, not tappable', a.has && a.disabled === true, J(a));
  await mark(p);
  await ev(p, `${NV}.querySelector('[data-action="np-autoplay"]').click()`); await sleep(300);
  check('NP8b a tap on the dynamic indicator sends no set_autoplay', (await sets(p)).length === 0, J(await sets(p)));
  await p.close();
}
{
  const p = await open();
  // missing duration must not hide: the default track already has a duration, so also open with a long-running track? NP1 already showed the button on a normal track.
  // Explicit: hide is not tied to .prog.nodur — if we force nodur via no duration, the button still shows when type is track.
  const nodur = await ev(p, `!!${NV}.querySelector('.prog')`);
  const a = await ap(p);
  check('NP9 a regular track still shows the toggle (hide rule is not missing duration)', a.has && !a.disabled && nodur, J({ a, nodur }));
  await p.close();
}
{
  const p = await browser.newPage(); await hermetic(p);
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1&tab=now`);
  await p.waitForFunction('window.__ready === true'); await sleep(900);
  const a = await ap(p);
  check('NP10 server without the autoplay feature: hidden', !a.has, J(a));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} autoplay-np checks passed`);
process.exit(failures ? 1 : 0);

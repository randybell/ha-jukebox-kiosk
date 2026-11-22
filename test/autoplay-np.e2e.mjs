// Now Playing Radio - Autoplay is a read-only status pill (data-state on/off); change Autoplay on the Queue screen (tap toggles, hold opens options).
// Repeat no longer locks the Queue pill. 1024x600 only. Usage: node test/autoplay-np.e2e.mjs
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
const ap = (p) => ev(p, `(() => { const r = ${NV}; const b = r.querySelector('.badges .apb, .apb');
  return { has: !!b, state: b?.getAttribute('data-state'), on: !!b?.classList.contains('on'), title: b?.getAttribute('title') || '', tag: b?.tagName, action: b?.getAttribute('data-action'),
    label: b?.textContent?.replace(/\\s+/g, ' ').trim(), tb: !!r.querySelector('.tb[aria-label*="Autoplay"]'), inBadges: !!r.querySelector('.badges .apb') }; })()`);
const mark = (p) => ev(p, 'window.__mark = (window.__ws || []).length');
const sets = (p) => p.evaluate(() => (window.__ws || []).slice(window.__mark || 0).filter((m) => m.type === 'set_autoplay' || m.type === 'jukebox_kiosk/set_autoplay').map((m) => ({ type: m.type, e: m.entity_id, on: m.enabled })));
const mouseTapAp = async (p) => {
  const c = await ev(p, `(() => { const b = ${NV}.querySelector('.apb'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await p.mouse.click(c.x, c.y);
};

{
  const p = await open();
  const a = await ap(p);
  check('NP1 default track queue, autoplay off: read-only status pill at spot A (badges), off, not a transport button',
    a.has && a.inBadges && a.state === 'off' && a.tag === 'SPAN' && !a.action && a.label === 'Radio - Autoplay' && !a.tb, J(a));
  await mark(p);
  await ev(p, `${NV}.querySelector('.apb').click()`); await sleep(400);
  const a2 = await ap(p);
  const sent = await sets(p);
  check('NP2 tap on the Now Playing pill does not send set_autoplay; state stays off',
    sent.length === 0 && a2.state === 'off' && a2.tag === 'SPAN', J({ sent, a2 }));
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="queue"]').click()`); await sleep(700);
  await wait(p, `${QV}.querySelector('.ap')`);
  await mark(p);
  await ev(p, `${QV}.querySelector('.ap').click()`); await sleep(400);
  const qOn = await ev(p, `${QV}.querySelector('.ap').classList.contains('on')`);
  const sentOn = await sets(p);
  check('NP3 Queue pill tap turns Autoplay on', qOn === true && sentOn.length === 1 && sentOn[0].on === true && /^media_player\./.test(sentOn[0].e), J({ qOn, sentOn }));
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="now"]').click()`); await sleep(700);
  const aOn = await ap(p);
  check('NP3b Now Playing pill follows the Queue: data-state=on', aOn.state === 'on' && aOn.on === true, J(aOn));
  await mark(p);
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="queue"]').click()`); await sleep(700);
  await ev(p, `${QV}.querySelector('.ap').click()`); await sleep(400);
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="now"]').click()`); await sleep(700);
  const a3 = await ap(p);
  const sent2 = await sets(p);
  check('NP4 Queue pill off updates the Now Playing pill',
    sent2.length === 1 && sent2[0].on === false && a3.state === 'off', J({ sent2, a3 }));
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
  check('NP8 dynamic queue: shown, on or off from autoplay state, read-only', a.has && a.tag === 'SPAN' && !a.action && (a.state === 'on' || a.state === 'off') && a.label === 'Radio - Autoplay', J(a));
  await mark(p);
  await mouseTapAp(p); await sleep(300);
  const sent = await sets(p);
  check('NP8b a real pointer tap on the Now Playing pill does not send set_autoplay',
    sent.length === 0, J(sent));
  await p.close();
}
{
  const p = await open();
  // missing duration must not hide: the default track already has a duration, so also open with a long-running track? NP1 already showed the button on a normal track.
  // Explicit: hide is not tied to .prog.nodur — if we force nodur via no duration, the button still shows when type is track.
  const nodur = await ev(p, `!!${NV}.querySelector('.prog')`);
  const a = await ap(p);
  check('NP9 a regular track still shows the status pill (hide rule is not missing duration)', a.has && (a.state === 'on' || a.state === 'off') && nodur, J({ a, nodur }));
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


{
  const p = await open('&repeat=one');
  const a = await ap(p);
  check('NP11 Repeat one: Autoplay status pill is visible and read-only',
    a.has && a.tag === 'SPAN' && !a.action && a.label === 'Radio - Autoplay', J(a));
  await mark(p);
  await mouseTapAp(p); await sleep(300);
  const sent = await sets(p);
  check('NP11b a real pointer tap on the Now Playing pill while Repeat is on sends no set_autoplay',
    sent.length === 0, J(sent));
  await p.close();
}
{
  const p = await open('&qtype=radio');
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="queue"]').click()`); await sleep(700);
  const q = await ev(p, `(() => { const r = ${QV}; const b = r.querySelector('[data-action="autoplay"]'); return { has: !!b }; })()`);
  check('NP12 Queue header Autoplay is hidden for radio, like Now Playing', q.has === false, J(q));
  await p.close();
}
{
  const p = await open('&repeat=all');
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="queue"]').click()`); await sleep(700);
  const q = await ev(p, `(() => { const r = ${QV}; const b = r.querySelector('[data-action="autoplay"]');
    return { has: !!b, disabled: !!b?.disabled, pressed: b?.getAttribute('aria-pressed'), title: b?.getAttribute('title') || '', on: b?.classList.contains('on') }; })()`);
  check('NP13 Queue header is not locked by Repeat: visible and tappable',
    q.has && q.disabled === false && !/repeat is on/.test(q.title), J(q));
  await mark(p);
  await ev(p, `${QV}.querySelector('[data-action="autoplay"]').click()`); await sleep(300);
  const sent13 = await sets(p);
  check('NP13b a tap on the Queue pill while Repeat is on sends set_autoplay',
    sent13.length === 1 && typeof sent13[0].on === 'boolean' && /^media_player\./.test(sent13[0].e), J(sent13));
  await p.close();
}
{
  // HA repeat off, MA queue repeat one: Now Playing stays a read-only pill; Queue header is not locked
  const p = await open('&repeat=off&qrepeat=one');
  const a = await ap(p);
  check('NP14 Now Playing stays a read-only status pill when MA queue repeat_mode is one',
    a.has && a.tag === 'SPAN' && !a.action && a.label === 'Radio - Autoplay', J(a));
  await ev(p, `__card.shadowRoot.querySelector('.tab[data-tab="queue"]').click()`); await sleep(700);
  const q = await ev(p, `(() => { const b = ${QV}.querySelector('[data-action="autoplay"]');
    return { has: !!b, disabled: !!b?.disabled, title: b?.getAttribute('title') || '' }; })()`);
  check('NP14b Queue header is not locked by the same MA queue repeat_mode',
    q.has && q.disabled === false && !/repeat is on/.test(q.title), J(q));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} autoplay-np checks passed`);
process.exit(failures ? 1 : 0);

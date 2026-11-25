// Now Playing, the header speaker pill, the progress bar and the screensaver take play and pause
// from Music Assistant's live feed for the selected player or group. After the lead speaker is
// dropped and re-added, Home Assistant can stay paused while Music Assistant is playing again;
// those surfaces must show playing. Play and pause are exercised by touch, mouse and keyboard.
// 1024x600 only. Mock only: nothing touches a real Home Assistant.
// Usage: node test/now-play-state.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const J = (x) => JSON.stringify(x);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});

// Selected group is the mock's Indoor dynamic group (not the default static group), lead = kitchen.
const ENT = 'media_player.indoor';
const LEAD = 'media_player.kitchen';
const GID = 'syncgroup_mock_indoor';
const LEAD_MA = 'wiim_mock_kitchen';
const NOW = `__card.shadowRoot.querySelector('jb-now')`;
const NP = `${NOW}.shadowRoot`;
const SPK = `__card.shadowRoot.querySelector('jb-speakers')`;
const SR = `${SPK}.shadowRoot`;
const act = (e) => `${SR}.querySelector('[data-room="${e}"] .act')`;
const PILL = `__card.shadowRoot.querySelector('.pill')`;

async function open() {
  const page = await browser.newPage();
  await hermetic(page);
  await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1&legacy=0&tab=now&spk=dyn&admin=1&ma=split&target=${ENT}&gap=400`);
  await page.waitForFunction('window.__ready === true');
  await sleep(400);
  return page;
}
const ev = (p, expr) => p.evaluate((e) => eval(e), expr);
const wait = (p, fn, timeout = 8000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
async function rectOf(page, expr) {
  return page.evaluate((expr) => {
    const el = eval(expr);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }, expr);
}
/** Bring a Speakers-panel room action into the 1024x600 view, then tap it. */
async function tapAct(page, entity) {
  await ev(page, `(() => { const row = ${SR}.querySelector('[data-room="${entity}"]'); const body = ${SR}.querySelector('.body'); row?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); if (body && row) { const er = row.getBoundingClientRect(), pr = body.getBoundingClientRect(); if (er.bottom > pr.bottom || er.top < pr.top) body.scrollTop += (er.top - pr.top); } })()`);
  await sleep(150);
  const r = await rectOf(page, act(entity));
  if (!r || !r.w) throw new Error(`no Drop/Add for ${entity}`);
  await page.mouse.click(r.x, r.y);
  await sleep(250);
}
async function pointer(page, expr, how) {
  const r = await rectOf(page, expr);
  if (!r || !r.w) throw new Error(`no element to ${how}: ${expr}`);
  if (how === 'touch') await page.touchscreen.tap(r.x, r.y);
  else await page.mouse.click(r.x, r.y);
  await sleep(250);
}
const ui = (p) => ev(p, `(() => {
  const r = ${NP};
  const where = r.querySelector('.where')?.textContent?.trim() ?? '';
  const pp = r.querySelector('.pp');
  const pill = ${PILL};
  const pre = pill?.querySelector('.pl')?.textContent?.trim() ?? '';
  const sl = r.querySelector('jb-slider.ps');
  const dur = Number(window.__hass?.states['${ENT}']?.attributes?.media_duration) || 0;
  const frac = Number(sl?.value) || 0;
  return {
    where,
    playing: /Playing on/.test(where),
    paused: /Paused on/.test(where),
    label: pp?.getAttribute('aria-label') ?? '',
    pre,
    pillPlaying: pre === 'Playing on:',
    pillPaused: pre === 'Paused on:',
    pos: dur ? frac * dur : 0,
    ha: window.__hass?.states['${ENT}']?.state ?? '',
    ma: window.__ma?.players?.().find((x) => x.player_id === '${GID}')?.playback_state ?? '',
    members: (window.__ma?.G['${GID}']?.members ?? []).slice(),
  };
})()`);

{
  const p = await open();
  const ready = await wait(p, `${NP}.querySelector('.where') && /Playing on/.test(${NP}.querySelector('.where').textContent) && __card.speakers?.loaded && ${PILL}?.querySelector('.pl')?.textContent?.trim() === 'Playing on:'`);
  const start = await ui(p);
  check('NP1 a playing group shows Playing on and Pause, and the header pill says Playing on:',
    ready && start.playing && start.label === 'Pause' && start.pillPlaying && start.ha === 'playing' && start.ma === 'playing', J(start));

  // Drop the lead speaker and add it back from the Speakers panel (the Now Playing room list is clipped at 1024x600).
  await pointer(p, PILL, 'mouse');
  const opened = await wait(p, `${SPK}.open && ${act(LEAD)}?.dataset.act === 'drop'`);
  if (!opened) check('NP2 (precondition) Speakers panel opened with Drop on the lead speaker', false, J(await ev(p, `{ open: ${SPK}.open, act: ${act(LEAD)}?.dataset.act ?? '' }`)));
  else {
    await tapAct(p, LEAD);
    const dropped = await wait(p, `!(window.__ma?.G['${GID}']?.members ?? []).includes('${LEAD_MA}') && ${act(LEAD)}?.dataset.act === 'join'`);
    const afterDrop = await ev(p, `({ members: (window.__ma?.G['${GID}']?.members ?? []).slice(), act: ${act(LEAD)}?.dataset.act ?? '', ma: window.__ma?.players?.().find((x) => x.player_id === '${GID}')?.playback_state ?? '' })`);
    check('NP2 dropping the lead speaker leaves the group playing on the next member', dropped && afterDrop.act === 'join' && !afterDrop.members.includes(LEAD_MA), J(afterDrop));

    await wait(p, `${act(LEAD)}?.dataset.act === 'join' && !${SPK}.inlineRegrouping()`);
    await tapAct(p, LEAD);
    const added = await wait(p, `(window.__ma?.G['${GID}']?.members ?? []).includes('${LEAD_MA}') && ${act(LEAD)}?.dataset.act === 'drop'`);
    const afterAdd = await ev(p, `({ members: (window.__ma?.G['${GID}']?.members ?? []).slice(), act: ${act(LEAD)}?.dataset.act ?? '' })`);
    check('NP3 re-adding the lead speaker puts it back in the group', added && afterAdd.act === 'drop' && afterAdd.members.includes(LEAD_MA), J(afterAdd));
  }

  const close = await rectOf(p, `${SR}.querySelector('[data-action="close"]')`);
  if (close && close.w) { await p.mouse.click(close.x, close.y); await sleep(200); }
  await wait(p, `!${SPK}.open`);

  const desync = await ev(p, `window.__desyncHa('${ENT}', 'paused', 'playing')`);
  const shown = await wait(p, `window.__hass.states['${ENT}'].state === 'paused' && window.__ma.players().find((x) => x.player_id === '${GID}').playback_state === 'playing'`);
  await sleep(200);
  const stuck = await ui(p);
  check('NP4 after the group is back, Home Assistant stays paused while Music Assistant is playing',
    desync && shown && stuck.ha === 'paused' && stuck.ma === 'playing', J({ desync, shown, stuck }));
  check('NP5 Now Playing shows Playing on and the Pause button (Music Assistant\'s state, not Home Assistant\'s)',
    stuck.playing && stuck.label === 'Pause' && !stuck.paused, J(stuck));
  check('NP5b the header speaker pill says Playing on: (not Paused on:)',
    stuck.pillPlaying && !stuck.pillPaused, J({ pre: stuck.pre }));

  // Progress bar: position/duration numbers still come from Home Assistant (the live feed does not send them);
  // whether the bar advances follows Music Assistant's play state.
  const pos1 = stuck.pos;
  await sleep(1200);
  const mid = await ui(p);
  const advanced = mid.pos - pos1;
  check('NP5c the progress bar keeps moving while Music Assistant is playing and Home Assistant is paused',
    mid.ha === 'paused' && mid.ma === 'playing' && advanced >= 0.8 && advanced <= 2.5, J({ pos1, pos2: mid.pos, advanced, ha: mid.ha, ma: mid.ma }));

  // Screensaver: open it from the card (no idle wait) and check the Paused label is off while MA is playing.
  await ev(p, `(() => { __card._saver = 'on'; __card.requestUpdate(); })()`);
  const saverOn = await wait(p, `!!__card.shadowRoot.querySelector('.amb.saver')`);
  const saver = await ev(p, `(() => {
    const amb = __card.shadowRoot.querySelector('.amb.saver');
    const np = amb?.querySelector('.sv-np');
    const text = np?.textContent ?? '';
    return { on: !!amb, text: text.trim(), paused: /Paused/.test(text), hasTitle: !!np?.querySelector('b')?.textContent?.trim() };
  })()`);
  check('NP5d the screensaver is on and does not show Paused while Music Assistant is playing',
    saverOn && saver.on && saver.hasTitle && !saver.paused, J(saver));
  await p.keyboard.press('Escape');
  await wait(p, `!__card.shadowRoot.querySelector('.amb.saver.on')`);
  await sleep(400);

  // play and pause by touch, then mouse, then keyboard (Enter on the play/pause button)
  await pointer(p, `${NP}.querySelector('.pp')`, 'touch');
  const tPause = await wait(p, `/Paused on/.test(${NP}.querySelector('.where')?.textContent ?? '') && ${NP}.querySelector('.pp')?.getAttribute('aria-label') === 'Play'`);
  const tPaused = await ui(p);
  check('NP6 touch tap Pause: Now Playing shows Paused on and Play', tPause && tPaused.paused && tPaused.label === 'Play', J(tPaused));
  await pointer(p, `${NP}.querySelector('.pp')`, 'touch');
  const tPlay = await wait(p, `/Playing on/.test(${NP}.querySelector('.where')?.textContent ?? '') && ${NP}.querySelector('.pp')?.getAttribute('aria-label') === 'Pause'`);
  const tPlayed = await ui(p);
  check('NP7 touch tap Play: Now Playing shows Playing on and Pause', tPlay && tPlayed.playing && tPlayed.label === 'Pause', J(tPlayed));

  await pointer(p, `${NP}.querySelector('.pp')`, 'mouse');
  const mPause = await wait(p, `/Paused on/.test(${NP}.querySelector('.where')?.textContent ?? '') && ${NP}.querySelector('.pp')?.getAttribute('aria-label') === 'Play'`);
  const mPaused = await ui(p);
  check('NP8 mouse click Pause: Now Playing shows Paused on and Play', mPause && mPaused.paused && mPaused.label === 'Play', J(mPaused));
  await pointer(p, `${NP}.querySelector('.pp')`, 'mouse');
  const mPlay = await wait(p, `/Playing on/.test(${NP}.querySelector('.where')?.textContent ?? '') && ${NP}.querySelector('.pp')?.getAttribute('aria-label') === 'Pause'`);
  const mPlayed = await ui(p);
  check('NP9 mouse click Play: Now Playing shows Playing on and Pause', mPlay && mPlayed.playing && mPlayed.label === 'Pause', J(mPlayed));

  await ev(p, `${NP}.querySelector('.pp').focus()`);
  await p.keyboard.press('Enter');
  const kPause = await wait(p, `/Paused on/.test(${NP}.querySelector('.where')?.textContent ?? '') && ${NP}.querySelector('.pp')?.getAttribute('aria-label') === 'Play'`);
  const kPaused = await ui(p);
  check('NP10 keyboard Enter Pause: Now Playing shows Paused on and Play', kPause && kPaused.paused && kPaused.label === 'Play', J(kPaused));
  await ev(p, `${NP}.querySelector('.pp').focus()`);
  await p.keyboard.press('Enter');
  const kPlay = await wait(p, `/Playing on/.test(${NP}.querySelector('.where')?.textContent ?? '') && ${NP}.querySelector('.pp')?.getAttribute('aria-label') === 'Pause'`);
  const kPlayed = await ui(p);
  check('NP11 keyboard Enter Play: Now Playing shows Playing on and Pause', kPlay && kPlayed.playing && kPlayed.label === 'Pause', J(kPlayed));

  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

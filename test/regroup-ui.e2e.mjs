// Now Playing "Reconfiguring speakers…" UI (Themes). Signal comes from Audio Dev.
// Usage: node test/regroup-ui.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex } from './serve.mjs';
import { hooksBuild } from './hooks-build.mjs';
hooksBuild();

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') {
  total++; if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
});

const IN = 'media_player.indoor', LIV = 'media_player.living_room', KIT = 'media_player.kitchen';
const SPK = `__card.shadowRoot.querySelector('jb-speakers')`;
const SR = `${SPK}.shadowRoot`;
const NOW = `__card.shadowRoot.querySelector('jb-now')`;
const NP = `${NOW}.shadowRoot`;
const row = (e) => `${SR}.querySelector('[data-room="${e}"]')`;
const act = (e) => `${row(e)}?.querySelector('.act')`;
const FAST = { call: 2500, join: 2500, move: 3000, poll: 250, fast: 120 };
const ASKSEL = '.sp-ask, .st.ask';
const ASKQ = `!!${SR}.querySelector('${ASKSEL}')`;

async function open(query = '', vp = { width: 1280, height: 800 }, timeouts = FAST) {
  const page = await browser.newPage();
  await hermetic(page);
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.evaluateOnNewDocument((t) => { window.__jbSpeakerTimeouts = t; }, timeouts);
  await page.goto(`${BASE}?hooks=1&fresh=1&latency=30${/[?&]gap=/.test(query) ? '' : '&gap=500'}${query.includes('tab=') ? '' : '&tab=now'}${query}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(150);
  return page;
}
async function rectOf(page, expr) {
  return page.evaluate((expr) => {
    const el = eval(expr);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top };
  }, expr);
}
async function tap(page, expr) {
  await page.evaluate((expr) => {
    const el = eval(expr);
    if (!el) return;
    const row = el.closest?.('[data-room], .qr') ?? el;
    const body = el.getRootNode?.()?.querySelector?.('.body');
    row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    if (body && row) {
      const er = row.getBoundingClientRect(), pr = body.getBoundingClientRect();
      if (er.bottom > pr.bottom || er.top < pr.top) body.scrollTop += (er.top - pr.top);
    }
  }, expr);
  await sleep(80);
  const r = await rectOf(page, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(60);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
async function openPanel(page) {
  await tap(page, `__card.shadowRoot.querySelector('.pill')`);
  await wait(page, `${SPK}.open && !!${SR}.querySelector('section.sheet')`);
  await sleep(250);
}
async function waitLoaded(page) { return wait(page, `${SPK}.store?.loaded && !!${SR}.querySelector('[data-room] .where')`); }
async function confirm(page, yes = true) {
  await wait(page, ASKQ);
  await tap(page, `${SR}.querySelector('${ASKSEL}').querySelector('[data-action="${yes ? 'confirm' : 'cancel'}"]')`);
}
async function closePanel(page) {
  if (!(await ev(page, `${SPK}.open`))) return;
  const close = `${SR}.querySelector('.sheet .x, [data-action="close"]')`;
  if (await ev(page, `!!${close}`)) await tap(page, close);
  await wait(page, `!${SPK}.open`, 3000);
}
async function indoorLead(page) {
  const leadMa = await ev(page, `window.__ma.G.syncgroup_mock_indoor.members[0]`);
  return leadMa === 'wiim_mock_kitchen' ? KIT : LIV;
}
const ui = (page) => ev(page, `(() => {
  const r = ${NP};
  const where = r.querySelector('.where');
  const text = where?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
  const pp = r.querySelector('.pp');
  const pr = pp?.getBoundingClientRect();
  return {
    text,
    reconfig: /reconfiguring speakers/i.test(text),
    paused: /Paused on/.test(text),
    playing: /Playing on/.test(text),
    spin: !!r.querySelector('.rc-spin'),
    role: where?.getAttribute('role') ?? '',
    live: where?.getAttribute('aria-live') ?? '',
    label: pp?.getAttribute('aria-label') ?? '',
    disabled: !!pp?.disabled,
    ariaDisabled: pp?.getAttribute('aria-disabled') ?? '',
    ppW: pr?.width ?? 0,
    ppH: pr?.height ?? 0,
    ha: window.__hass?.states['${IN}']?.state ?? '',
    ma: window.__ma?.players?.().find((x) => x.player_id === 'syncgroup_mock_indoor')?.playback_state ?? '',
    reason: ${SPK}.inlineRegroup?.()?.reason ?? null,
    on: !!${SPK}.inlineRegrouping(),
  };
})()`);
const playCallsSince = (page, n) => ev(page, `window.__calls.slice(${n}).filter((c) => c.domain === 'media_player' && /^(media_play|media_pause|media_play_pause)$/.test(c.service)).map((c) => c.service)`);
const cfg = encodeURIComponent(J({ leader_drop: 'allow' }));

{
  // Leader drop of a playing group: the label and spinner replace "Paused on"; play taps do nothing;
  // the label stays through a join-back; it clears when MA is playing even if HA is still paused.
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&grp=slowlead&leaddelay=2500&gap=4000&cfg=${cfg}`, undefined, { ...FAST, call: 3000, join: 3000 });
  await p.evaluate(() => { window.__jbRegroupMs = 8000; window.__jbLeaderDropMs = 8000; });
  const before = await ui(p);
  await openPanel(p); await waitLoaded(p);
  const lead = await indoorLead(p);
  await wait(p, `${act(lead)}?.dataset.act === 'drop'`, 4000);
  const ppBefore = await ev(p, `(() => { const b = ${NP}.querySelector('.pp')?.getBoundingClientRect(); return { w: b?.width ?? 0, h: b?.height ?? 0 }; })()`);
  await tap(p, act(lead));
  const onDrop = await wait(p, `${SPK}.inlineRegroup()?.reason === 'leader-drop'`, 2000);
  const mid = await wait(p, `/reconfiguring speakers/i.test(${NP}.querySelector('.where')?.textContent ?? '') && !!${NP}.querySelector('.rc-spin')`, 2000);
  const during = await ui(p);
  check('U1 leader drop shows "Reconfiguring speakers…" with a spinner instead of "Paused on"',
    onDrop && mid && during.reconfig && during.spin && !during.paused && during.role === 'status' && during.live === 'polite',
    J({ before: before.text, during }));

  await closePanel(p);
  const n0 = await ev(p, 'window.__calls.length');
  const pp = await ui(p);
  check('U2 play/pause keeps its look and size (not disabled; at least 48px); aria-disabled is set',
    pp.ppW >= 48 && pp.ppH >= 48 && Math.abs(pp.ppW - ppBefore.w) < 1 && Math.abs(pp.ppH - ppBefore.h) < 1
    && pp.disabled === false && pp.ariaDisabled === 'true',
    J({ pp, ppBefore }));
  const ppRect = await rectOf(p, `${NP}.querySelector('.pp')`);
  if (ppRect && ppRect.w) { await p.mouse.click(ppRect.x, ppRect.y); await sleep(200); }
  const afterTap = await ui(p);
  const sent = await playCallsSince(p, n0);
  check('U3 a tap on play/pause while regrouping does not send media_play or media_pause',
    afterTap.reconfig && sent.length === 0, J({ sent, afterTap }));

  await openPanel(p);
  await wait(p, `${act(lead)}?.dataset.act === 'join'`, 2000);
  await tap(p, act(lead));
  await wait(p, ASKQ, 800) && (await confirm(p));
  const flipped = await wait(p, `${SPK}.inlineRegroup()?.reason === 'join-back'`, 2000);
  const through = await ui(p);
  check('U4 the label and spinner stay through a join-back',
    flipped && through.reconfig && through.spin && through.reason === 'join-back' && !through.paused,
    J(through));

  await ev(p, `window.__desyncHa('${IN}', 'paused', 'playing')`);
  const off = await wait(p, `!${SPK}.inlineRegrouping() && /Playing on/.test(${NP}.querySelector('.where')?.textContent ?? '')`, 5000);
  // the join-back can still be writing Home Assistant; pin it paused again and read MA's play state
  await ev(p, `window.__desyncHa('${IN}', 'paused', 'playing')`);
  await sleep(200);
  const end = await ui(p);
  check('U5 when Music Assistant is playing again the label clears, and Now Playing shows Playing on (not a lagging HA Paused on)',
    off && end.playing && !end.reconfig && !end.spin && !end.paused && end.ha === 'paused' && end.ma === 'playing' && end.ariaDisabled !== 'true',
    J(end));
  await p.close();
}

{
  // MA never comes back: the message clears at __jbRegroupMs.
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&reform=fail&gap=5000&cfg=${cfg}`);
  await p.evaluate(() => { window.__jbRegroupMs = 800; window.__jbResumeMs = 50; window.__jbResumeGraceMs = 50; });
  await openPanel(p); await waitLoaded(p);
  const lead = await indoorLead(p);
  await wait(p, `${act(lead)}?.dataset.act === 'drop'`, 4000);
  await tap(p, act(lead));
  const on = await wait(p, `${SPK}.inlineRegrouping() && /reconfiguring speakers/i.test(${NP}.querySelector('.where')?.textContent ?? '')`, 2000);
  const mid = await ui(p);
  const off = await wait(p, `!${SPK}.inlineRegrouping() && !/reconfiguring speakers/i.test(${NP}.querySelector('.where')?.textContent ?? '')`, 2500);
  const end = await ui(p);
  check('U6 if Music Assistant never comes back, the label clears at the __jbRegroupMs timeout',
    on && mid.reconfig && mid.spin && off && !end.reconfig && !end.spin && end.on === false, J({ mid, end }));
  await p.close();
}

{
  // Failed drop: the label clears when the error chip appears.
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&grp=timeout&cfg=${cfg}`, undefined, { ...FAST, call: 900, join: 900 });
  await p.evaluate(() => { window.__jbLeaderDropMs = 2000; window.__jbRegroupMs = 8000; });
  await openPanel(p); await waitLoaded(p);
  const lead = await indoorLead(p);
  await wait(p, `${act(lead)}?.dataset.act === 'drop'`, 4000);
  await tap(p, act(lead));
  const on = await wait(p, `${SPK}.inlineRegrouping() && /reconfiguring speakers/i.test(${NP}.querySelector('.where')?.textContent ?? '')`, 2000);
  const failed = await wait(p, `/Couldn't drop/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 4000);
  const end = await ui(p);
  check('U7 a failed leader drop clears the label when the error chip appears',
    on && failed && !end.reconfig && !end.spin && end.on === false, J(end));
  await p.close();
}

{
  // Failed join-back: drop succeeds, then the join call fails and the label clears.
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&grp=slowlead&leaddelay=2500&gap=4000&cfg=${cfg}`, undefined, { ...FAST, call: 3000, join: 900 });
  await p.evaluate(() => { window.__jbRegroupMs = 8000; window.__jbLeaderDropMs = 8000; });
  await openPanel(p); await waitLoaded(p);
  const lead = await indoorLead(p);
  await wait(p, `${act(lead)}?.dataset.act === 'drop'`, 4000);
  await tap(p, act(lead));
  const on = await wait(p, `${SPK}.inlineRegrouping() && /reconfiguring speakers/i.test(${NP}.querySelector('.where')?.textContent ?? '')`, 2000);
  await wait(p, `${act(lead)}?.dataset.act === 'join'`, 2000);
  await ev(p, `(() => { const s = ${SPK}.store; s.setMembers = async () => { throw new Error('player unavailable'); }; })()`);
  await tap(p, act(lead));
  await wait(p, ASKQ, 800) && (await confirm(p));
  const failed = await wait(p, `/Couldn't add/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 4000);
  const end = await ui(p);
  check('U8 a failed join-back clears the label when the error chip appears',
    on && failed && !end.reconfig && !end.spin && end.on === false, J({ on, failed, end }));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} regroup-ui checks passed`);
process.exit(failures ? 1 : 0);

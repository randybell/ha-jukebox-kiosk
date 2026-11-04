// 0.5.0 Speakers panel e2e (mock Music Assistant in dev/mock-ma.js; every id is a placeholder).
// Usage: (serve the project root on :8765) node test/speakers.e2e.mjs
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';

const BASE = process.env.JB_URL ?? 'http://127.0.0.1:8765/dev/index.html';
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

const IN = 'media_player.indoor', OUT = 'media_player.outdoor', EVERY = 'media_player.everywhere';
const LIV = 'media_player.living_room', KIT = 'media_player.kitchen', GAR = 'media_player.garage';
const SPK = `__card.shadowRoot.querySelector('jb-speakers')`;
const SR = `${SPK}.shadowRoot`;
const NOW = `__card.shadowRoot.querySelector('jb-now')`;
const row = (e) => `${SR}.querySelector('[data-room="${e}"]')`;
const act = (e) => `${row(e)}?.querySelector('.act')`;
const FAST = { call: 2500, join: 2500, move: 3000, poll: 250, fast: 120 };

async function open(query = '', vp = { width: 1280, height: 800 }, timeouts = FAST) {
  const page = await browser.newPage();
  await hermetic(page);
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.evaluateOnNewDocument((t) => { window.__jbSpeakerTimeouts = t; window.__jbUndoMs = 8000; }, timeouts);
  await page.goto(`${BASE}?fresh=1&latency=30${/[?&]gap=/.test(query) ? '' : '&gap=500'}${query.includes('tab=') ? '' : '&tab=now'}${query}`);
  await page.waitForFunction('window.__ready === true');
  await sleep(150);
  return page;
}
async function rectOf(page, expr) {
  return page.evaluate((expr) => {
    const el = eval(expr);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom };
  }, expr);
}
async function tap(page, expr) {
  const r = await rectOf(page, expr);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await page.mouse.click(r.x, r.y);
  await sleep(60);
}
const wait = (page, fn, timeout = 5000) => page.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const ev = (page, expr) => page.evaluate((e) => eval(e), expr);
const calls = (page) => page.evaluate(() => window.__calls.map(({ t, ...c }) => c));
const ma = (page, cmd) => page.evaluate((cmd) => window.__maLog.filter((x) => !cmd || x.command === cmd), cmd);
// reads (players/all, config/players/get, player_queues/get) are left out: only commands that change something
const maCmds = (page) => page.evaluate(() => window.__maLog.map((x) => x.command).filter((c) => !['players/all', 'config/players/get', 'player_queues/get'].includes(c)));
const events = (page) => page.evaluate(() => window.__maEvents.map((e) => e.type ?? e[0] ?? e));
// 0.6.4: every grouping message is the one top-right status chip (.st); a question is a chip with an action (.st.ask),
// or the 0.6.3 dialog (.sp-ask) with confirm_drop: true or for the card's Start guard
const ASKSEL = '.sp-ask, .st.ask';
const ASKQ = `!!${SR}.querySelector('${ASKSEL}')`;
const MODALQ = `!!${SR}.querySelector('.sp-ask')`;
const toast = (page) => ev(page, `${SR}.querySelector('.st .ct')?.textContent?.trim() ?? ''`);
const chip = (page) => ev(page, `(() => { const c = ${SR}.querySelector('.st'); if (!c) return null; const r = c.getBoundingClientRect();
  return { text: c.querySelector('.ct')?.textContent.trim(), kind: c.dataset.kind, act: c.querySelector('.ca')?.textContent.trim() ?? '', l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
const askLines = (page) => ev(page, `${SR}.querySelector('.sp-ask') ? [...${SR}.querySelectorAll('.sp-ask .tk')].map((x) => x.textContent.trim()) : [...${SR}.querySelectorAll('.st.ask .ct')].map((x) => x.textContent.trim())`);
const askTitle = (page) => ev(page, `${SR}.querySelector('.sp-ask h3, .sp-ask .t, .sp-ask b, .st.ask .ct')?.textContent?.trim() ?? ''`);
const hasAsk = (page) => ev(page, ASKQ);
const target = (page) => ev(page, `${NOW}.config.entity`);
const maMembers = (page, g) => page.evaluate((g) => window.__ma.G[g].members.slice(), g);
const st = (page, e) => page.evaluate((e) => window.__hass.states[e]?.state, e);
const joins = (page) => page.evaluate(() => window.__calls.filter((c) => c.domain === 'media_player' && /^(join|unjoin)$/.test(c.service)));
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
async function sliderTo(page, sliderExpr, frac) {
  const r = await rectOf(page, sliderExpr);
  const x = r.l + r.w * frac;
  await page.mouse.move(x, r.y); await page.mouse.down(); await sleep(30); await page.mouse.up(); await sleep(150);
}
const allJoins = [];

// ───────────── 0.4 regression (fixed is the default) ─────────────
{
  const seq = async (cfg) => {
    const p = await open(cfg ? `&cfg=${encodeURIComponent(J(cfg))}` : '');
    await tap(p, `${NOW}.shadowRoot.querySelector('.pp')`); await sleep(300);
    await tap(p, `${NOW}.shadowRoot.querySelector('.pp')`); await sleep(300);
    await sliderTo(p, `${NOW}.shadowRoot.querySelector('[data-room="${KIT}"] jb-slider, .vr [data-room="${KIT}"] jb-slider') ?? ${NOW}.shadowRoot.querySelectorAll('jb-slider')[1]`, 0.25);
    const c = await calls(p);
    const m = await page_ma(p);
    allJoins.push(...(await joins(p)));
    return { p, c, m };
  };
  // the queue tab's buffer read (player_queues/get, admins only: it gates the row actions) and the dynamic panel's
  // group-config read (config/players/get) are not counted here
  const page_ma = (p) => p.evaluate(() => window.__maLog.map((x) => x.command).filter((c) => c !== 'player_queues/get' && c !== 'config/players/get'));
  const a = await seq(null);
  const b = await seq({ speaker_mode: 'fixed', grouping: 'admins', guest_access: 'volume', leader_drop: 'allow', large_buttons: false });
  check('R1 default config = fixed mode: no Music Assistant players/* calls at all (not even players/all)', a.m.length === 0, J(a.m));
  const writes = (c) => c.filter((x) => !/^get_/.test(x.service));
  check('R2 default config makes the same (write) calls as an explicit fixed config', J(writes(a.c)) === J(writes(b.c)) && writes(a.c).length >= 3, J(writes(a.c).map((x) => x.service)) + ' vs ' + J(writes(b.c).map((x) => x.service)));
  check('R3 fixed mode plays on the configured entity (media_player.everywhere)', a.c.filter((x) => x.domain === 'media_player' && x.service !== 'volume_set').every((x) => x.target?.entity_id === EVERY), J(a.c.map((x) => x.target)));
  const p = a.p;
  const pill = await ev(p, `__card.shadowRoot.querySelector('.pill')?.textContent.replace(/\\s+/g,' ').trim()`);
  check('R4 header status keeps "N rooms synced" in fixed mode', /rooms synced/.test(pill), pill);
  await openPanel(p);
  const fx = await ev(p, `(() => { const r = ${SR}; return { mode: r.querySelector('.sheet').dataset.mode, banner: r.querySelector('.banner')?.dataset.kind, chips: r.querySelectorAll('[data-target]').length, presets: r.querySelectorAll('[data-preset]').length, acts: r.querySelectorAll('.act').length, sliders: r.querySelectorAll('jb-slider').length }; })()`);
  check('R5 tapping the header status opens the Speakers panel; fixed = mixer only (no chips, presets or join/drop)', fx.mode === 'fixed' && fx.banner === 'fixed' && fx.chips === 0 && fx.presets === 0 && fx.acts === 0 && fx.sliders === 4, J(fx));
  const n0 = (await calls(p)).length;
  await sliderTo(p, `${row(GAR)}.querySelector('jb-slider')`, 0.5);
  const vs = (await calls(p)).slice(n0).filter((x) => x.service === 'volume_set');
  check('R6 fixed panel room slider → media_player.volume_set on that room (HA only)', vs.length >= 1 && vs.at(-1).target.entity_id === GAR && Math.abs(vs.at(-1).data.volume_level - 0.5) < 0.08, J(vs.at(-1)));
  check('R7 fixed panel makes no Music Assistant players/* calls', (await page_ma(p)).length === 0, J(await page_ma(p)));
  await tap(p, `${SR}.querySelector('.x')`); await sleep(300);
  check('R8 close button closes the panel', !(await ev(p, `${SPK}.open`)));
  await a.p.close(); await b.p.close();
}

// ───────────── guest lock ─────────────
{
  const p = await open('&spk=dyn&target=' + IN);
  await openPanel(p); await waitLoaded(p);
  const g = await ev(p, `(() => { const r = ${SR}; return { guest: r.querySelector('.sheet').dataset.guest, banner: r.querySelector('.banner')?.textContent, chips: r.querySelectorAll('[data-target]').length, presets: r.querySelectorAll('[data-preset]').length, acts: r.querySelectorAll('.act').length, dis: [...r.querySelectorAll('jb-slider')].some((s) => s.disabled) }; })()`);
  check('G1 guest (non-admin, not listed): volume only — no Play-on chips, presets or join/drop buttons', g.guest === 'yes' && g.chips === 0 && g.presets === 0 && g.acts === 0 && !g.dis && /Volume only/.test(g.banner), J(g));
  await ev(p, `${SPK}.dispatchEvent(new CustomEvent('jukebox-target', { detail: { entity: '${OUT}' }, bubbles: true, composed: true }))`); await sleep(200);
  check('G2 a guest cannot retarget the card (jukebox-target ignored)', (await target(p)) === IN);
  const w = (await maCmds(p)).filter((c) => c !== 'players/all');
  check('G3 guest panel makes no MA write calls', w.length === 0, J(w));
  await p.close();
  const p2 = await open(`&spk=dyn&ma=split&target=${IN}&user=Kitchen%20Tablet&cfg=${encodeURIComponent(J({ grouping_users: ['Kitchen Tablet'] }))}`);
  await openPanel(p2); await waitLoaded(p2);
  const g2 = await ev(p2, `({ chips: ${SR}.querySelectorAll('[data-target]').length, acts: ${SR}.querySelectorAll('.act').length })`);
  check('G4 grouping_users lists this (non-admin) user → grouping allowed', g2.chips === 3 && g2.acts === 3, J(g2));
  await p2.close();
  const p3 = await open(`&spk=dyn&target=${IN}&cfg=${encodeURIComponent(J({ guest_access: 'none' }))}`);
  await openPanel(p3); await waitLoaded(p3);
  const g3 = await ev(p3, `({ panel: [...${SR}.querySelectorAll('jb-slider')].every((s) => s.disabled), now: [...${NOW}.shadowRoot.querySelectorAll('jb-slider')].filter((s) => !s.classList.contains('seek') && s.closest?.('.vr, .vol, .vrow') ).every((s) => s.disabled), banner: ${SR}.querySelector('.banner')?.textContent })`);
  check('G5 guest_access: none → panel volume sliders disabled', g3.panel && /Ask an admin/.test(g3.banner), J(g3));
  const n0 = (await calls(p3)).length;
  await sliderTo(p3, `${row(KIT)}.querySelector('jb-slider')`, 0.9);
  check('G6 guest_access: none → no volume_set from a locked slider', (await calls(p3)).slice(n0).filter((x) => x.service === 'volume_set').length === 0);
  await p3.close();
  const p4 = await open(`&spk=dyn&ma=split&target=${IN}&admin=1&cfg=${encodeURIComponent(J({ guest_access: 'none' }))}`);
  await openPanel(p4); await waitLoaded(p4);
  check('G7 admins keep everything with guest_access: none', await ev(p4, `${SR}.querySelectorAll('.act').length === 3 && ![...${SR}.querySelectorAll('jb-slider')].some((s) => s.disabled)`));
  await p4.close();
}

// ───────────── quiet hours ─────────────
{
  const q = { quiet_hours: { start: '00:00', end: '00:00', max_volume: 30 } }; // start === end = all day
  const p = await open(`&spk=dyn&target=${IN}&cfg=${encodeURIComponent(J(q))}`);
  await openPanel(p); await waitLoaded(p);
  const note = await ev(p, `${SR}.querySelector('.quiet')?.textContent.trim()`);
  check('Q1 quiet hours (start === end = all day) shows the cap note to guests', /up to 30%/.test(note ?? ''), note);
  const mx = await ev(p, `${row(KIT)}.querySelector('jb-slider').max`);
  check('Q2 panel sliders carry max = cap (with a cap tick)', Math.abs(mx - 0.3) < 1e-9 && (await ev(p, `!!${row(KIT)}.querySelector('jb-slider').shadowRoot.querySelector('.cap')`)), String(mx));
  const n0 = (await calls(p)).length;
  await sliderTo(p, `${row(KIT)}.querySelector('jb-slider')`, 0.95);
  const vs = (await calls(p)).slice(n0).filter((x) => x.service === 'volume_set');
  check('Q3 guest dragging to 95% sends at most the cap (0.30)', vs.length >= 1 && vs.every((x) => x.data.volume_level <= 0.3 + 1e-9), J(vs.map((x) => x.data.volume_level)));
  await tap(p, `${SR}.querySelector('.x')`); await sleep(300);
  const ns = await ev(p, `[...${NOW}.shadowRoot.querySelectorAll('jb-slider')].filter((s) => s.max !== undefined && s.max < 1).length`);
  check('Q4 Now Playing volume sliders are capped too', ns >= 1, String(ns));
  await p.close();
  const p2 = await open(`&spk=dyn&target=${IN}&admin=1&cfg=${encodeURIComponent(J(q))}`);
  await openPanel(p2); await waitLoaded(p2);
  const n1 = (await calls(p2)).length;
  await sliderTo(p2, `${row(KIT)}.querySelector('jb-slider')`, 0.9);
  const v2 = (await calls(p2)).slice(n1).filter((x) => x.service === 'volume_set');
  check('Q5 quiet hours apply to guests only by default (admin reaches 90%)', !(await ev(p2, `!!${SR}.querySelector('.quiet')`)) && v2.at(-1)?.data.volume_level > 0.8, J(v2.map((x) => x.data.volume_level)));
  await p2.close();
  const h = new Date().getHours();
  const off = { quiet_hours: { start: `${String((h + 2) % 24).padStart(2, '0')}:00`, end: `${String((h + 3) % 24).padStart(2, '0')}:00`, max_volume: 30 } };
  const p3 = await open(`&spk=dyn&target=${IN}&cfg=${encodeURIComponent(J(off))}`);
  await openPanel(p3); await waitLoaded(p3);
  check('Q6 outside the quiet window there is no cap', !(await ev(p3, `!!${SR}.querySelector('.quiet')`)) && (await ev(p3, `${row(KIT)}.querySelector('jb-slider').max`)) === undefined);
  await p3.close();
}

// ───────────── dynamic: move / start warning / presets (Everywhere playing = default mock) ─────────────
{
  const p = await open('&spk=dyn&admin=1');
  const pill = await ev(p, `__card.shadowRoot.querySelector('.pill')?.textContent.replace(/\\s+/g,' ').trim()`);
  check('M0 dynamic header status counts speakers', /3 speakers/.test(pill), pill);
  await openPanel(p); await waitLoaded(p);
  const d = await ev(p, `(() => { const r = ${SR}; return { mode: r.querySelector('.sheet').dataset.mode, chips: [...r.querySelectorAll('[data-target]')].map((c) => c.dataset.target + ':' + c.getAttribute('aria-checked')), presets: [...r.querySelectorAll('[data-preset]')].map((c) => c.dataset.preset), banner: r.querySelector('.banner')?.dataset.kind, acts: r.querySelectorAll('.act').length }; })()`);
  check('M1 dynamic panel: Play-on chips (Everywhere on), card presets + the MA default "Outdoor default" (config/players/get; the Indoor default equals Dinner, so no duplicate), static Everywhere shown as fixed (no join/drop)',
    d.mode === 'dynamic' && d.chips.length === 3 && d.chips[0] === `${EVERY}:true` && J(d.presets) === J(['Dinner', 'Whole house', 'Outdoor default']) && d.banner === 'static' && d.acts === 0, J(d));
  await tap(p, `${SR}.querySelector('[data-target="${OUT}"]')`);
  await wait(p, ASKQ);
  // Outdoor idle → just retarget (no transfer needed for an idle target? no: Everywhere active → transfer offers takeovers)
  const lines = await askLines(p);
  check('M2 move to Outdoor warns first: its would-be leader Garage leads Everywhere (static) → takeover line', lines.some((l) => /Everywhere/.test(l)), J(lines));
  await confirm(p, false); await sleep(200);
  check('M3 Cancel → no transfer, still on Everywhere', (await ma(p, 'player_queues/transfer')).length === 0 && (await target(p)) === EVERY);
  await tap(p, `${SR}.querySelector('[data-target="${IN}"]')`);
  const l2 = await askLines(p);
  check('M4 move to Indoor warns that the fixed group Everywhere stops', l2.some((l) => /Everywhere stops: it is a fixed group/.test(l)), J(l2));
  await confirm(p);
  check('M5 optimistic: the chip / card target switch at once', (await target(p)) === IN);
  await wait(p, `window.__hass.states['${IN}'].state === 'playing'`);
  const tr = await ma(p, 'player_queues/transfer');
  check('M6 transfer = mass_queue.send_command player_queues/transfer Everywhere → Indoor (auto_play)',
    tr.length === 1 && tr[0].data.source_queue_id === 'syncgroup_everywhere' && tr[0].data.target_queue_id === 'syncgroup_mock_indoor', J(tr));
  await wait(p, `/Moved to Indoor/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`);
  check('M7 toast "Moved to Indoor"; no Undo (Everywhere was stopped)', /Moved to Indoor/.test(await toast(p)) && !(await ev(p, `!!${SR}.querySelector('.st [data-action="undo"]')`)), await toast(p));
  check('M8 Everywhere stopped, Indoor plays living+kitchen', (await st(p, EVERY)) !== 'playing' && J(await maMembers(p, 'syncgroup_mock_indoor')) === J(['wiim_mock_living', 'wiim_mock_kitchen']));
  check('M9 target persisted per device', (await p.evaluate(() => localStorage.getItem('jukebox-card:target:v1'))) === IN);
  await wait(p, `${SPK}.store.players.get('syncgroup_mock_indoor')?.playback_state === 'playing' && ${row(GAR)}?.querySelector('.act')?.dataset.act === 'join'`);
  // join + undo
  await tap(p, act(GAR));
  await wait(p, ASKQ, 1500) && (await confirm(p));
  await wait(p, `${row(GAR)}.classList.contains('in')`);
  const sm = await ma(p, 'players/cmd/set_members');
  check('M10 Join Garage → players/cmd/set_members(Indoor, add Garage)', sm.length === 1 && sm[0].data.target_player === 'syncgroup_mock_indoor' && J(sm[0].data.player_ids_to_add) === J(['wiim_mock_garage']), J(sm));
  await wait(p, `!!${SR}.querySelector('.st [data-action="undo"]')`);
  check('M11 toast "Garage joined Indoor" with Undo', /joined Indoor/.test(await toast(p)) && (await ev(p, `!!${SR}.querySelector('.st [data-action="undo"]')`)), await toast(p));
  await tap(p, `${SR}.querySelector('.st [data-action="undo"]')`);
  await wait(p, `${row(GAR)}.classList.contains('out') && !window.__ma.G.syncgroup_mock_indoor.members.includes('wiim_mock_garage')`);
  const sm2 = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('M12 Undo → set_members(Indoor, remove Garage)', J(sm2?.data.player_ids_to_remove) === J(['wiim_mock_garage']), J(sm2));
  // 0.6.3: the leader can be dropped by default (MA re-forms the group on the next room) and re-added
  await wait(p, `${act(LIV)}?.dataset.act === 'drop'`);
  check('M13 leader (Living Room) shows "Drop" by default (0.6.3)', (await ev(p, `${act(LIV)}.textContent.trim()`)) === 'Drop' && (await ev(p, `${row(LIV)}.querySelector('.where').textContent`)) === 'Leads the group');
  await tap(p, act(LIV));
  const modal14 = await ev(p, MODALQ);
  const c14 = await chip(p);
  await wait(p, `${row(LIV)}.classList.contains('out') && !window.__ma.G.syncgroup_mock_indoor.members.includes('wiim_mock_living')`);
  const smL = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('M14 Drop leader → no dialog (0.6.4), the top-right chip says so at once → set_members(Indoor, remove Living), no stop',
    !modal14 && /Regrouping…|Living Room left/.test(c14?.text ?? '') && smL?.data.target_player === 'syncgroup_mock_indoor' && J(smL?.data.player_ids_to_remove) === J(['wiim_mock_living'])
    && !(await maCmds(p)).includes('players/cmd/stop'), J({ modal14, c14, smL }));
  await wait(p, `${SPK}.store.players.get('syncgroup_mock_indoor')?.playback_state === 'playing' && ${act(LIV)}?.dataset.act === 'join'`);
  await tap(p, act(LIV));
  await wait(p, ASKQ, 800) && (await confirm(p));
  await wait(p, `${row(LIV)}.classList.contains('in')`);
  const smR = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('M15 re-add the dropped leader → set_members(Indoor, add Living)', J(smR?.data.player_ids_to_add) === J(['wiim_mock_living']) && J(await maMembers(p, 'syncgroup_mock_indoor')) === J(['wiim_mock_kitchen', 'wiim_mock_living']), J(smR));
  // drop the new leader (Kitchen): Living is the last speaker
  await wait(p, `${act(KIT)}?.dataset.act === 'drop'`);
  await tap(p, act(KIT));
  await wait(p, ASKQ, 800) && (await confirm(p));
  await wait(p, `${row(KIT)}.classList.contains('out') && ${act(LIV)}?.textContent.trim() === 'Last'`, 6000);
  const nSm = (await ma(p, 'players/cmd/set_members')).length;
  await wait(p, `${SPK}.store.players.get('syncgroup_mock_indoor')?.playback_state === 'playing'`);
  await tap(p, act(LIV));
  await wait(p, ASKQ, 1500);
  const lastT = await askTitle(p);
  const lastC = await chip(p), modal16 = await ev(p, MODALQ);
  await confirm(p, false);
  check('M16 the last speaker cannot be dropped: the chip offers Pause instead (no dialog), sends nothing',
    /last speaker/.test(lastT) && lastC?.act === 'Pause' && !modal16 && (await ma(p, 'players/cmd/set_members')).length === nSm && (await ev(p, `${act(LIV)}.getAttribute('aria-disabled')`)) === 'true', J({ lastT, lastC, modal16, dis: await ev(p, `${act(LIV)}.getAttribute('aria-disabled')`) }));
  // preset: Dinner (same target) → re-adds Kitchen and sets capped volumes
  const v0 = (await calls(p)).length;
  await tap(p, `${SR}.querySelector('[data-preset="Dinner"]')`);
  await wait(p, ASKQ, 800) && (await confirm(p));
  await wait(p, `window.__ma.G.syncgroup_mock_indoor.members.includes('wiim_mock_kitchen')`);
  await wait(p, `/Dinner/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`);
  const vols = (await calls(p)).slice(v0).filter((x) => x.service === 'volume_set').map((x) => `${x.target.entity_id}=${x.data.volume_level}`);
  check('M17 preset Dinner → set_members adds Kitchen back, sets 35 % / 30 %', vols.includes(`${LIV}=0.35`) && vols.includes(`${KIT}=0.3`), J(vols));
  check('M18 preset toast names it', /Dinner/.test(await toast(p)), await toast(p));
  allJoins.push(...(await joins(p)));
  await p.close();
}

// ───────────── leader drop allowed (re-form gap) ─────────────
{
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&cfg=${encodeURIComponent(J({ leader_drop: 'allow' }))}`);
  await openPanel(p); await waitLoaded(p);
  const lead = await p.evaluate(() => window.__ma.G.syncgroup_mock_indoor.members[0]);
  const leadRoom = lead === 'wiim_mock_kitchen' ? KIT : LIV;
  await wait(p, `${act(leadRoom)}?.dataset.act === 'drop'`);
  check('L1 leader_drop: allow → the leader row offers Drop', (await ev(p, `${act(leadRoom)}.dataset.act`)) === 'drop');
  await tap(p, act(leadRoom));
  const modalL = await ev(p, MODALQ), cL = await chip(p);
  check('L2 dropping the leader: no dialog; the chip says "Regrouping…" (0.6.4)', !modalL && cL?.text === 'Regrouping…' && cL?.kind === 'busy', J({ modalL, cL }));
  const sawBuf = await wait(p, `window.__hass.states['${IN}'].state === 'buffering'`, 2000);
  const rg = await wait(p, `${SR}.querySelector('.stl')?.textContent.includes('Regrouping…')`, 1500);
  await wait(p, `window.__hass.states['${IN}'].state === 'playing' && !window.__ma.G.syncgroup_mock_indoor.members.includes('${lead}')`, 4000);
  const evs = await events(p);
  check('L3 MA re-forms the group after a gap (buffering → playing, reform event)', sawBuf && evs.some((e) => /reform/.test(J(e))), J(evs));
  const rg2 = await wait(p, `!${SR}.querySelector('.stl')?.textContent.includes('Regrouping…')`, 2000);
  check('L3b the status says "Regrouping…" during the re-form and stops once the new leader plays', rg && rg2, J({ rg, rg2, now: await ev(p, `${SR}.querySelector('.stl')?.textContent`) }));
  await wait(p, `!!${SR}.querySelector('.st [data-action="undo"]')`, 3000);
  check('L4 toast + Undo after dropping the leader', !!(await ev(p, `${SR}.querySelector('.st [data-action="undo"]')`)), await toast(p));
  await p.close();
}

// ───────────── take between dynamic groups / start warning / hijack / dissolve ─────────────
{
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${OUT}`);
  await openPanel(p); await waitLoaded(p);
  const w = await ev(p, `${row(GAR)}.querySelector('.where').textContent`);
  check('S1 per-room status: Garage "Playing alone · <station>"', /Playing alone · Mock Radio/.test(w), w);
  const wk = await ev(p, `${row(KIT)}.querySelector('.where').textContent`);
  check('S2 per-room status: Kitchen "In Indoor · <title>"', /^In Indoor · \S/.test(wk), wk);
  await tap(p, `${SR}.querySelector('.x')`); await sleep(250);
  const els = await ev(p, `[...${NOW}.shadowRoot.querySelectorAll('.vn .else')].map((x) => x.textContent.trim())`);
  check('S3 Now Playing per-room rows show what an ungrouped room plays', els.some((x) => /Mock Radio/.test(x)), J(els));
  // start warning via the play guard
  const n0 = (await calls(p)).length;
  await tap(p, `${NOW}.shadowRoot.querySelector('.pp')`);
  await wait(p, ASKQ);
  const sl = await askLines(p);
  check('S4 pressing Play on idle Outdoor warns first: Garage stops what it is playing', sl.some((l) => /Garage stops what it is playing/.test(l)), J(sl));
  await confirm(p, false); await sleep(200);
  check('S5 Cancel → nothing played', (await calls(p)).slice(n0).filter((x) => /media_play|play_media|media_play_pause/.test(x.service)).length === 0, J((await calls(p)).slice(n0)));
  await tap(p, `${NOW}.shadowRoot.querySelector('.pp')`);
  await confirm(p);
  await wait(p, `window.__hass.states['${OUT}'].state === 'playing'`);
  check('S6 Start → Outdoor powers on and takes the solo Garage (solo-stop)', (await events(p)).some((e) => /solo/.test(J(e))) && J(await maMembers(p, 'syncgroup_mock_outdoor')) === J(['wiim_mock_garage']), J(await events(p)));
  await openPanel(p);
  await wait(p, `${act(KIT)}?.dataset.act === 'take'`);
  const lbl = await ev(p, `${act(KIT)}.textContent.trim()`);
  check('S7 a speaker held by another group shows "Take from Indoor"', lbl === 'Take from Indoor', lbl);
  const qBefore = await p.evaluate(() => J(window.__queues['media_player.indoor']?.items?.map((i) => i.media_title ?? i.title ?? i.name)), null).catch(() => null);
  await tap(p, act(KIT));
  await wait(p, ASKQ);
  const kl = await askLines(p);
  const kitLeads = (await maMembers(p, 'syncgroup_mock_indoor'))[0] === 'wiim_mock_kitchen';
  check('S8 confirm explains the cost (leader → Indoor restarts; member → keeps playing)', kl.some((l) => (kitLeads ? /Indoor pauses briefly and restarts/ : /Kitchen leaves Indoor; Indoor keeps playing/).test(l)), J(kl));
  await confirm(p);
  await wait(p, `${row(KIT)}.classList.contains('in') && window.__ma.G.syncgroup_mock_outdoor.members.includes('wiim_mock_kitchen')`);
  await wait(p, `window.__hass.states['${IN}'].state === 'playing'`, 4000);
  const sm = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('S9 take = set_members(Outdoor, add Kitchen) — a move between playing dynamic groups', sm?.data.target_player === 'syncgroup_mock_outdoor' && J(sm.data.player_ids_to_add) === J(['wiim_mock_kitchen']), J(sm));
  const qAfter = await p.evaluate(() => JSON.stringify(window.__queues['media_player.indoor']?.items?.map((i) => i.media_title ?? i.title ?? i.name))).catch(() => null);
  check('S10 Indoor keeps playing its own queue (Living Room only)', (await st(p, IN)) === 'playing' && J(await maMembers(p, 'syncgroup_mock_indoor')) === J(['wiim_mock_living']) && (qBefore == null || qAfter === JSON.parse(J(qBefore))), J(await maMembers(p, 'syncgroup_mock_indoor')));
  await wait(p, `!!${SR}.querySelector('.st [data-action="undo"]')`);
  await tap(p, `${SR}.querySelector('.st [data-action="undo"]')`);
  await wait(p, `window.__ma.G.syncgroup_mock_indoor.members.includes('wiim_mock_kitchen')`);
  const u = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('S11 Undo gives Kitchen back to Indoor (set_members(Indoor, add Kitchen))', u?.data.target_player === 'syncgroup_mock_indoor' && J(u.data.player_ids_to_add) === J(['wiim_mock_kitchen']), J(u));
  // dissolve: take Indoor's speakers one by one; the last one stops Indoor
  await wait(p, `${act(KIT)}?.dataset.act === 'take'`);
  await tap(p, act(KIT)); await confirm(p);
  await wait(p, `window.__ma.G.syncgroup_mock_outdoor.members.includes('wiim_mock_kitchen') && ${act(LIV)}?.dataset.act === 'take'`, 5000);
  await wait(p, `window.__hass.states['${IN}'].state === 'playing'`, 4000);
  await wait(p, `${SPK}.store.players.get('syncgroup_mock_indoor')?.group_members?.length === 1`, 3000);
  // wait for Kitchen's take to finish (0.6.4: its late "Kitchen joined Outdoor · Undo" answered a question asked meanwhile
  // with "no"; fixed in 0.6.5 / Q62, the race itself is covered by Q62-E5/E6 below)
  await wait(p, `!${row(KIT)}?.classList.contains('pending') && ${SR}.querySelector('.st .ct')?.textContent.includes('Kitchen joined')`, 5000);
  await tap(p, act(LIV));
  await wait(p, ASKQ);
  const ll = await askLines(p);
  check('S12 taking Indoor\'s last speaker warns "Indoor stops: Living Room is its last speaker."', ll.some((l) => /Indoor stops: Living Room is its last speaker/.test(l)), J({ ll, c: await chip(p), a: await ev(p, `${act(LIV)}?.dataset.act + ' ' + ${act(LIV)}?.textContent.trim()`) }));
  await confirm(p);
  await wait(p, `window.__hass.states['${IN}'].state !== 'playing' && window.__ma.G.syncgroup_mock_outdoor.members.length === 3`, 4000);
  check('S13 moving the last speaker dissolves Indoor (dissolve event)', (await events(p)).some((e) => /dissolve/.test(J(e))) && (await st(p, IN)) !== 'playing', J(await events(p)));
  allJoins.push(...(await joins(p)));
  await p.close();
}
{
  // hijack: start Outdoor while Everywhere plays (Garage leads Everywhere)
  const p = await open(`&spk=dyn&admin=1&target=${OUT}`);
  await tap(p, `${NOW}.shadowRoot.querySelector('.pp')`);
  await wait(p, ASKQ);
  const t = await ev(p, `${SR}.querySelector('.sp-ask, .st.ask').textContent.replace(/\\s+/g,' ')`);
  check('H1 "Start Outdoor?" warns that Everywhere is taken over (Garage leads it)', /Start Outdoor/.test(t) && /Everywhere is taken over: Garage leads it/.test(t), t.slice(0, 200));
  await confirm(p);
  await wait(p, `window.__hass.states['${OUT}'].state === 'playing'`);
  check('H2 hijack: all of Everywhere switches to Outdoor', (await events(p)).some((e) => /hijack/.test(J(e))) && (await maMembers(p, 'syncgroup_mock_outdoor')).length === 3 && (await st(p, EVERY)) !== 'playing', J(await maMembers(p, 'syncgroup_mock_outdoor')));
  await p.close();
}

// ───────────── MA rules: nesting, static target, native-leader refusal, take from a static group ─────────────
{
  const p = await open(`&spk=dyn&admin=1&target=${IN}`);
  const err = (f) => p.evaluate(f).then(() => 'ok', (e) => String(e?.message ?? e));
  const nest = await err(() => window.__card.speakers.setMembers('syncgroup_mock_indoor', ['syncgroup_mock_outdoor'], []));
  check('N1 groups cannot nest (set_members with a group id is refused)', nest !== 'ok', nest);
  const stat = await err(() => window.__card.speakers.setMembers('syncgroup_everywhere', [], ['wiim_mock_kitchen']));
  check('N2 a static group cannot be changed with set_members (live: 500 "Player X does not support group commands")', /does not support group commands/.test(stat), stat);
  // overlap MA can reach: Everywhere playing and Indoor playing with Living only (forced)
  await p.evaluate(() => window.__ma.force('syncgroup_mock_indoor', 'playing', ['wiim_mock_living']));
  const lead = await err(() => window.__card.speakers.setMembers('syncgroup_mock_indoor', ['wiim_mock_garage'], []));
  check('N3 a speaker leading a playing native group is refused by set_members', lead !== 'ok' && /lead/i.test(lead), lead);
  const nMa = (await maCmds(p)).length;
  await openPanel(p); await waitLoaded(p);
  await wait(p, `${act(GAR)}?.dataset.act === 'take'`);
  check('N4 Garage (in the fixed group Everywhere) shows "Take from Everywhere"', (await ev(p, `${act(GAR)}.textContent.trim()`)) === 'Take from Everywhere');
  await tap(p, act(GAR));
  await wait(p, ASKQ);
  const tl = await askLines(p);
  check('N5 the confirm warns that taking it stops all of Everywhere', tl.some((l) => /Everywhere stops: it is a fixed group/.test(l)), J(tl));
  await confirm(p);
  await wait(p, `window.__ma.G.syncgroup_mock_indoor.members.includes('wiim_mock_garage')`, 5000);
  const cmds = (await maCmds(p)).slice(nMa);
  check('N6 the card stops Everywhere first (players/cmd/stop), then set_members — no refusal', cmds.indexOf('players/cmd/stop') > -1 && cmds.indexOf('players/cmd/stop') < cmds.lastIndexOf('players/cmd/set_members') && (await st(p, EVERY)) !== 'playing', J(cmds));
  await wait(p, `/joined Indoor/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 3000);
  check('N7 no Undo after stopping a fixed group', !(await ev(p, `!!${SR}.querySelector('.st [data-action="undo"]')`)), await toast(p));
  allJoins.push(...(await joins(p)));
  await p.close();
}

// ───────────── failures: optimistic UI reverts with a toast ─────────────
{
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&grp=fail`);
  await openPanel(p); await waitLoaded(p);
  await wait(p, `${act(GAR)}?.dataset.act === 'take'`);
  await tap(p, act(GAR)); await confirm(p);
  await wait(p, `/Couldn't add Garage/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`);
  check('F1 set_members fails → toast "Couldn\'t add Garage …" and the row reverts', /Couldn't add Garage/.test(await toast(p)) && (await ev(p, `${row(GAR)}.classList.contains('out')`)), await toast(p));
  const fc = await chip(p);
  check('F1b the failure is the chip in its error style (role alert), not a dialog', fc?.kind === 'error' && (await ev(p, `${SR}.querySelector('.st').getAttribute('role')`)) === 'alert' && !(await ev(p, MODALQ)), J(fc));
  await p.close();
  const p2 = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&grp=timeout`, undefined, { ...FAST, join: 900, call: 900 });
  await openPanel(p2); await waitLoaded(p2);
  await wait(p2, `${act(GAR)}?.dataset.act === 'take'`);
  await tap(p2, act(GAR)); await confirm(p2);
  const pending = await wait(p2, `${row(GAR)}.classList.contains('pending')`, 600);
  await wait(p2, `/Couldn't add/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 4000);
  check('F2 set_members never answers → pending row, then timeout toast "no answer in time" and revert', pending && /no answer in time/.test(await toast(p2)) && (await ev(p2, `${row(GAR)}.classList.contains('out')`)), await toast(p2));
  await p2.close();
  const p3 = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&xfer=timeout`, undefined, { ...FAST, move: 900, call: 900 });
  await openPanel(p3); await waitLoaded(p3);
  await tap(p3, `${SR}.querySelector('[data-target="${OUT}"]')`);
  if (await wait(p3, ASKQ, 800)) await confirm(p3);
  const opt = (await target(p3)) === OUT;
  await wait(p3, `/Couldn't move to Outdoor/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 4000);
  check('F3 transfer times out → optimistic switch reverts to Indoor with "Couldn\'t move to Outdoor … Still on Indoor."', opt && (await target(p3)) === IN && /Still on Indoor/.test(await toast(p3)), await toast(p3));
  await p3.close();
  const p4 = await open(`&spk=dyn&admin=1&ma=split&target=${IN}&xfer=fail`);
  await openPanel(p4); await waitLoaded(p4);
  await tap(p4, `${SR}.querySelector('[data-target="${OUT}"]')`);
  if (await wait(p4, ASKQ, 800)) await confirm(p4);
  await wait(p4, `/Couldn't move/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 4000);
  check('F4 transfer fails → revert + toast', (await target(p4)) === IN && /Couldn't move to Outdoor/.test(await toast(p4)), await toast(p4));
  await p4.close();
}

// ───────────── large buttons, phone, short card ─────────────
{
  const sizes = async (p) => ev(p, `(() => { const n = ${NOW}.shadowRoot; const pp = n.querySelector('.pp').getBoundingClientRect(); const tab = __card.shadowRoot.querySelector('.tab')?.getBoundingClientRect(); return { pp: Math.round(pp.height), tab: Math.round(tab?.height ?? 0), lg: __card.shadowRoot.querySelector('ha-card').classList.contains('lg'), large: n.host.hasAttribute('large') }; })()`);
  const a = await open('&spk=dyn&admin=1');
  const b = await open(`&spk=dyn&admin=1&cfg=${encodeURIComponent(J({ large_buttons: true }))}`);
  const sa = await sizes(a), sb = await sizes(b);
  check('B1 large_buttons: card gets .lg and children [large]', sb.lg && sb.large && !sa.lg && !sa.large, J({ sa, sb }));
  check('B2 large_buttons: bigger play button and tabs', sb.pp > sa.pp && sb.tab >= sa.tab, J({ sa, sb }));
  await openPanel(a); await waitLoaded(a); await openPanel(b); await waitLoaded(b);
  const ha = await rectOf(a, `${SR}.querySelector('[data-target]')`), hb = await rectOf(b, `${SR}.querySelector('[data-target]')`);
  check('B3 large_buttons: bigger panel chips', hb.h > ha.h && hb.h >= 52, `${ha.h} → ${hb.h}`);
  await a.close(); await b.close();
  const c = await open('&spk=dyn&admin=1', { width: 390, height: 844, isMobile: true, hasTouch: true });
  const pr = await rectOf(c, `__card.shadowRoot.querySelector('.pill')`);
  check('B4 phone: header status is an icon button ≥ 44 px', pr && pr.w >= 44 && pr.h >= 44, J(pr));
  await c.close();
  for (const vp of [{ width: 1280, height: 600 }, { width: 390, height: 600 }, { width: 1280, height: 420 }]) {
    const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}`, vp);
    await openPanel(p); await waitLoaded(p); await sleep(300);
    const r = await ev(p, `(() => { const host = ${SPK}.getBoundingClientRect(); const sh = ${SR}.querySelector('.sheet').getBoundingClientRect(); const b = ${SR}.querySelector('.body'); return { host: [host.top, host.bottom].map(Math.round), sheet: [sh.top, sh.bottom].map(Math.round), sh: b.scrollHeight, ch: b.clientHeight, ov: getComputedStyle(b).overflowY }; })()`);
    const inside = r.sheet[0] >= r.host[0] - 1 && r.sheet[1] <= r.host[1] + 1;
    let scrolls = true;
    if (r.sh > r.ch + 2) { await ev(p, `${SR}.querySelector('.body').scrollTop = 9999`); scrolls = (await ev(p, `${SR}.querySelector('.body').scrollTop`)) > 0; }
    check(`B5 ${vp.width}x${vp.height}: the panel stays inside the card height and its body scrolls`, inside && r.ov === 'auto' && scrolls, J(r));
    await p.close();
  }
}

// ---------- J. Queue rows: Play now (confirm → play_index) / Play next (move_item, no confirm) ----------
{
  const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
  const qrow = (id) => `${QV}.querySelector('.qr[data-id="${id}"]')`;
  const qbtn = (id, a) => `${qrow(id)}?.querySelector('.qa[data-action="${a}"]')`;
  const rows = (p) => ev(p, `[...${QV}.querySelectorAll('.qr')].map((r) => ({ id: r.dataset.id, k: ['now', 'next', 'past'].find((k) => r.classList.contains(k)),
    pn: !!r.querySelector('.qa[data-action="playnow"]'), nx: r.querySelector('.qa[data-action="playnext"]') ? (r.querySelector('.qa[data-action="playnext"]').disabled ? 'dis' : 'on') : '',
    up: !!r.querySelector('.qa[data-action="up"]'), rm: !!r.querySelector('.qa[data-action="remove"]') }))`);
  const sends = (p) => ev(p, `window.__calls.filter((c) => c.service === 'send_command' && ['player_queues/play_index', 'player_queues/move_item'].includes(c.data?.command)).map(({ t, ...c }) => c)`);
  const mass = (p, svc) => ev(p, `window.__calls.filter((c) => c.domain === 'mass_queue' && c.service === '${svc}').length`);
  const openQ = async (q, vp) => { const p = await open(`&tab=queue${q}`, vp); await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`); await sleep(150); return p; };
  const dlg = (p) => ev(p, `(() => { const c = ${QV}.querySelector('.confirm'); return c ? { q: c.querySelector('#cf-q')?.textContent.trim(), b: c.querySelector('#cf-b')?.textContent.trim(), btn: [...c.querySelectorAll('.cbtn')].map((x) => x.textContent.trim()), kind: c.dataset.kind } : null; })()`);

  const p = await openQ('&admin=1');
  let r = await rows(p);
  const nx = r.filter((x) => x.k === 'next'), nowR = r.find((x) => x.k === 'now');
  check('J1 admin: Play now + Play next + Remove on Up next rows; Play now and Remove hidden on the playing row; Play next disabled on the row already next',
    nx.every((x) => x.pn && x.rm) && nx[0].nx === 'dis' && nx.slice(1).every((x) => x.nx === 'on') && nowR && !nowR.pn && !nowR.rm && nowR.nx === '' && nx.every((x) => x.up), J(r.slice(0, 5)));
  // Play now → confirm (nothing sent yet)
  const target = nx[2].id;
  await tap(p, qbtn(target, 'playnow'));
  const d = await dlg(p);
  check('J2 Play now asks first: "Play this now? The current song will stop." with Cancel / Play now; nothing sent yet',
    d && d.kind === 'jump' && d.q === 'Play this now?' && d.b === 'The current song will stop.' && d.btn[0] === 'Cancel' && d.btn[1] === 'Play now' && (await sends(p)).length === 0, J(d));
  await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="cancel"]')`); await sleep(300);
  check('J3 Cancel closes the dialog and sends nothing', !(await dlg(p)) && (await sends(p)).length === 0 && (await mass(p, 'play_queue_item')) === 0);
  await tap(p, qbtn(target, 'playnow'));
  await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  await wait(p, `${QV}.querySelector('.qr.now')?.dataset.id === '${target}'`, 4000);
  let sc = await sends(p);
  const nowId = await ev(p, `${QV}.querySelector('.qr.now')?.dataset.id`);
  check('J4 confirm → one mass_queue.send_command player_queues/play_index {queue_id, index: queue_item_id}; the row becomes Now playing (the mock rejects a wrong config_entry_id)',
    sc.length === 1 && sc[0].data.command === 'player_queues/play_index' && J(sc[0].data.data) === J({ queue_id: 'syncgroup_everywhere', index: target })
      && (await mass(p, 'play_queue_item')) === 0 && nowId === target, J(sc) + ' now=' + nowId);
  await sleep(900);
  // Play next on the 4th Up next row: pos_shift = (current + 1) - index = -3, no dialog
  r = await rows(p);
  let up = r.filter((x) => x.k === 'next');
  const mv = up[3].id;
  await tap(p, qbtn(mv, 'playnext')); await sleep(80);
  const d2 = await dlg(p);
  await wait(p, `${QV}.querySelector('.qr.next')?.dataset.id === '${mv}'`, 3000); await sleep(900);
  sc = (await sends(p)).slice(1);
  const first = await ev(p, `${QV}.querySelector('.qr.next')?.dataset.id`);
  const maQ = await ev(p, `(() => { const Q = window.__queues['media_player.everywhere']; return Q.items[Q.index + 1].queue_item_id; })()`);
  check('J5 Play next: no dialog; player_queues/move_item {queue_id, queue_item_id, pos_shift: -3}; it is next in the card and in MA',
    !d2 && sc.length === 1 && sc[0].data.command === 'player_queues/move_item' && J(sc[0].data.data) === J({ queue_id: 'syncgroup_everywhere', queue_item_id: mv, pos_shift: -3 })
      && first === mv && maQ === mv, J(sc) + ` first=${first} ma=${maQ}`);
  r = await rows(p);
  check('J6 after the move the new next row has Play next disabled and the old one is enabled', r.find((x) => x.id === mv).nx === 'dis' && r.filter((x) => x.k === 'next')[1].nx === 'on', J(r.slice(0, 4)));
  const pastR = r.filter((x) => x.k === 'past');
  check('J7 played rows: Play now only (MA refuses to move or delete played items)', pastR.length > 0 && pastR.every((x) => x.pn && x.nx === '' && !x.rm), J(pastR));
  const u0 = await mass(p, 'move_queue_item_up');
  await tap(p, qbtn(r.filter((x) => x.k === 'next')[2].id, 'up')); await sleep(300);
  check('J8 Move up still acts at once (no dialog, mass_queue.move_queue_item_up)', !(await dlg(p)) && (await mass(p, 'move_queue_item_up')) === u0 + 1);
  await p.close();
}
{
  const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
  const openQ = async (q, vp) => { const p = await open(`&tab=queue${q}`, vp); await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`); await sleep(150); return p; };
  const icons = (p) => ev(p, `({ pn: ${QV}.querySelectorAll('.qa[data-action="playnow"]').length, nx: ${QV}.querySelectorAll('.qa[data-action="playnext"]').length, rm: ${QV}.querySelectorAll('.qa[data-action="remove"]').length, up: ${QV}.querySelectorAll('.qr.next .qa[data-action="up"]').length })`);
  let p = await openQ('');
  let c = await icons(p);
  check('J9 guest (volume only, not admin): no Play now / Play next / Remove icons; Move up / down unchanged from 0.4', c.pn === 0 && c.nx === 0 && c.rm === 0 && c.up > 3, J(c));
  await p.close();
  p = await openQ(`&user=Kitchen%20Tablet&cfg=${encodeURIComponent(J({ grouping_users: ['Kitchen Tablet'] }))}`);
  c = await icons(p);
  check('J10 grouping_users lists this non-admin user → icons shown', c.pn > 3 && c.nx > 3 && c.rm > 3, J(c));
  await p.close();
  p = await openQ(`&admin=1&cfg=${encodeURIComponent(J({ grouping: 'nobody' }))}`);
  c = await icons(p);
  check('J11 grouping: nobody → icons hidden even for admins (same lock as grouping)', c.pn === 0 && c.nx === 0 && c.rm === 0, J(c));
  await p.close();
  // wide: all five icons inline; phone: Play next + Remove inline, the rest behind ⋯ (an action sheet)
  for (const vp of [{ width: 390, height: 844, isMobile: true, hasTouch: true }, { width: 1920, height: 1080 }, { width: 1280, height: 800 }]) {
    p = await openQ('&admin=1', vp);
    const m = await ev(p, `(() => { const r = [...${QV}.querySelectorAll('.qr.next')][2]; const rr = r.getBoundingClientRect(); const t = r.querySelector('.rt b').getBoundingClientRect();
      const bs = [...r.querySelectorAll('.qa')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => { const x = b.getBoundingClientRect(); return { a: b.dataset.action || 'more', w: Math.round(x.width), h: Math.round(x.height), l: x.left, r: x.right, t: x.top, b: x.bottom }; });
      return { row: [rr.left, rr.right].map(Math.round), title: { w: Math.round(t.width), r: Math.round(t.right), t: Math.round(t.top), b: Math.round(t.bottom) }, bs }; })()`);
    const narrow = vp.width <= 520;
    const want = narrow ? ['playnext', 'remove', 'more'] : ['playnow', 'playnext', 'up', 'down', 'remove'];
    const set = J(m.bs.map((b) => b.a).sort()) === J([...want].sort());
    const big = m.bs.every((b) => b.w >= 44 && b.h >= 44);
    const inside = m.bs.every((b) => b.l >= m.row[0] - 1 && b.r <= m.row[1] + 1);
    const oneLine = m.bs.every((b) => b.l >= m.title.r - 1 && b.t < m.title.b && b.b > m.title.t);
    const right = Math.abs(Math.max(...m.bs.map((b) => b.r)) - m.row[1]) < 24;
    const titleW = narrow ? m.title.w >= 120 : m.title.w >= 300;
    check(`J12 ${vp.width}x${vp.height}: ${narrow ? 'Play next + Remove inline, ⋯ for the rest' : 'Play now, Play next, Move up, Move down, Remove inline'}; ≥ 44 px, right-aligned, one line beside the title (title ${m.title.w}px)`,
      set && big && inside && oneLine && right && titleW, J(m));
    await p.close();
  }
  // live MA 2.10.9: the buffered track is index_in_buffer (player_queues/get), not current + 1; Play next lands after it
  p = await openQ('&admin=1&qbuf=1');
  await wait(p, `${QV}.querySelector('.qr.next.buf')`, 3000);
  const ids = await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids[3]}"] .qa[data-action="playnext"]')`);
  await sleep(1600);
  const after = await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
  const mv = await ev(p, `window.__calls.filter((c) => c.data?.command === 'player_queues/move_item').map((c) => c.data.data.pos_shift)`);
  check('J13 next track already buffered (index_in_buffer = current + 1): Play next lands right after the buffered track, MA agrees after the refresh',
    J(after.slice(0, 2)) === J([ids[0], ids[3]]) && J(mv) === J([-2]) && J(await ev(p, `window.__queues['media_player.everywhere'].items.map((x) => x.queue_item_id)`)).includes(J([ids[0], ids[3]]).slice(1, -1)), J({ ids: ids.slice(0, 4), after: after.slice(0, 4), mv }));
  await p.close();
  // no mass_queue entry: the 0.4 services stand in
  p = await openQ(`&admin=1&cfg=${encodeURIComponent(J({ mass_queue_entry_id: '' }))}`);
  const ids2 = await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
  await tap(p, `${QV}.querySelector('.qr[data-id="${ids2[2]}"] .qa[data-action="playnext"]')`); await sleep(400);
  const fb = await ev(p, `window.__calls.filter((c) => c.domain === 'mass_queue' && c.service !== 'get_queue_items').map((c) => c.service + ':' + J(c.data))`.replace('J(', 'JSON.stringify('));
  check('J14 without mass_queue_entry_id Play next falls back to mass_queue.move_queue_item_next', fb.length === 1 && fb[0].startsWith('move_queue_item_next:'), J(fb));
  await p.close();
}

// ---------- P. Play now only jumps: never resorts, replaces or clears the queue (every Play now path) ----------
// User requirement: "play now not resort or clear the queue". Icon, ⋯ sheet entry, the 0.4 long-press menu entry and a
// row tap (0.4: no confirm) must only move playback to that item in place (play_index / play_queue_item). After each one
// MA's queue and the card's rows keep the same items in the same order, and no replace / clear / move / delete is sent.
{
  const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
  const openQ = async (q, vp) => { const p = await open(`&tab=queue${q}`, vp); await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`); await sleep(150); return p; };
  const maIds = (p) => ev(p, `window.__queues['media_player.everywhere'].items.map((x) => x.queue_item_id)`);
  const rowIds = (p) => ev(p, `[...${QV}.querySelectorAll('.qr')].map((r) => r.dataset.id)`);
  const nowId = (p) => ev(p, `${QV}.querySelector('.qr.now')?.dataset.id`);
  const mark = (p) => ev(p, `[window.__calls.length, (window.__maLog ?? []).length]`);
  const BAD = /play_media|replace|clear|shuffle|move|delete|remove|reorder|transfer/i;
  const sent = (p, m) => ev(p, `[...window.__calls.slice(${m[0]}).filter((c) => c.service !== 'get_queue_items').map((c) => c.domain + '.' + c.service + (c.data?.command ? ':' + c.data.command : '') + ' ' + JSON.stringify(c.data?.data ?? c.data ?? {})),
    ...(window.__maLog ?? []).slice(${m[1]}).map((x) => 'ma:' + x.command + ' ' + JSON.stringify(x.args ?? x.data ?? {}))]`);
  const jumpOnly = (list) => list.filter((x) => !/^ma:players\/all/.test(x)).every((x) => !BAD.test(x)) && list.some((x) => /play_index|play_queue_item/.test(x));
  async function playNowPath(name, p, fire, target) {
    const ma0 = await maIds(p), rows0 = await rowIds(p), m = await mark(p);
    await fire();
    const ok = await wait(p, `${QV}.querySelector('.qr.now')?.dataset.id === '${target}'`, 4000); await sleep(900);
    const ma1 = await maIds(p), rows1 = await rowIds(p), s = await sent(p, m);
    const maIdx = await ev(p, `(() => { const Q = window.__queues['media_player.everywhere']; return Q.items[Q.index]?.queue_item_id; })()`);
    check(`P ${name}: playback jumps to the item in place (now playing = it, in the card and in MA)`, ok && (await nowId(p)) === target && maIdx === target, J({ now: await nowId(p), maIdx, target }));
    check(`P ${name}: MA queue unchanged: same ${ma0.length} items in the same order`, J(ma1) === J(ma0), J({ ma0: ma0.length, ma1: ma1.length, firstDiff: ma0.findIndex((x, i) => x !== ma1[i]) }));
    // the card reads a window (get_queue_items limit_before: 1, as in 0.4): one played row, the playing row, then everything after it.
    // Its rows must be exactly MA's order from one before the playing item: nothing moved, dropped or duplicated.
    const i1 = ma1.indexOf(target), win1 = ma1.slice(Math.max(0, i1 - 1));
    check(`P ${name}: the card's rows are MA's unchanged order (window from one played row: ${rows1.length} rows, was ${rows0.length})`,
      J(rows1) === J(win1) && J(rows0) === J(ma0.slice(ma0.indexOf(rows0[0]))), J({ rows1, win1 }));
    check(`P ${name}: only a jump was sent (play_index / play_queue_item), no play_media / replace / clear / move / delete`, jumpOnly(s), J(s));
  }
  // 1. row icon (wide, admin) → confirm → play_index
  let p = await openQ('&admin=1');
  let t = (await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`))[3];
  await playNowPath('icon (admin, 1280x800)', p, async () => {
    await tap(p, `${QV}.querySelector('.qr[data-id="${t}"] .qa[data-action="playnow"]')`);
    await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  }, t);
  // 1b. a played row's Play now icon (jump back) is also in place
  t = (await ev(p, `[...${QV}.querySelectorAll('.qr.past')].map((r) => r.dataset.id)`))[0];
  await playNowPath('icon on a played row (jump back)', p, async () => {
    await tap(p, `${QV}.querySelector('.qr[data-id="${t}"] .qa[data-action="playnow"]')`);
    await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  }, t);
  await p.close();
  // 2. narrow ⋯ action sheet → Play now… → confirm → play_index
  p = await openQ('&admin=1', { width: 390, height: 844, isMobile: true, hasTouch: true });
  t = (await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`))[4];
  await playNowPath('⋯ sheet entry (admin, 390x844)', p, async () => {
    await ev(p, `${QV}.querySelector('.qr[data-id="${t}"]').scrollIntoView({ block: 'center' })`); await sleep(100);
    await tap(p, `${QV}.querySelector('.qr[data-id="${t}"] .qa.mo')`); await sleep(150);
    await tap(p, `${QV}.querySelector('.menu .mi[data-action="play"]')`); await sleep(100);
    await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  }, t);
  await p.close();
  // 3. guest 0.4 long-press menu → Play now (no confirm, 0.4) → mass_queue.play_queue_item
  p = await openQ('');
  t = (await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`))[3];
  await playNowPath('0.4 long-press menu entry (guest)', p, async () => {
    const r = await rectOf(p, `${QV}.querySelector('.qr[data-id="${t}"] .rt')`);
    await p.mouse.move(r.x, r.y); await p.mouse.down(); await sleep(700); await p.mouse.up(); await sleep(150);
    await tap(p, `${QV}.querySelector('.menu .mi[data-action="play"]')`);
  }, t);
  // 4. row tap (0.4: plays at once, no confirm) → mass_queue.play_queue_item
  t = (await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`))[2];
  await playNowPath('row tap (guest, 0.4 no confirm)', p, () => tap(p, `${QV}.querySelector('.qr[data-id="${t}"] .rt')`), t);
  await p.close();
  // 4b. row tap as admin, and the icon without a mass_queue entry id (0.4 service fallback)
  p = await openQ('&admin=1');
  t = (await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`))[5];
  await playNowPath('row tap (admin)', p, () => tap(p, `${QV}.querySelector('.qr[data-id="${t}"] .rt')`), t);
  await p.close();
  p = await openQ(`&admin=1&cfg=${encodeURIComponent(J({ mass_queue_entry_id: '' }))}`);
  t = (await ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`))[3];
  await playNowPath('icon without mass_queue_entry_id (play_queue_item fallback)', p, async () => {
    await tap(p, `${QV}.querySelector('.qr[data-id="${t}"] .qa[data-action="playnow"]')`);
    await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  }, t);
  await p.close();
}

// ---------- D. Queue rows: Remove (delete_item, no dialog) + 'Removed <title>. Undo' ----------
{
  const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
  const openQ = async (q, vp) => { const p = await open(`&tab=queue${q}`, vp); await wait(p, `${QV}.querySelectorAll('.qr.next').length > 3`); await sleep(150); return p; };
  const ids = (p) => ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
  const maIds = (p) => ev(p, `window.__queues['media_player.everywhere'].items.map((x) => x.queue_item_id)`);
  const maUris = (p) => ev(p, `window.__queues['media_player.everywhere'].items.map((x) => x._t.uri)`);
  const qcmds = (p) => ev(p, `window.__calls.filter((c) => c.service === 'send_command' && String(c.data?.command).startsWith('player_queues/')).map((c) => ({ command: c.data.command, data: c.data.data }))`);
  const bar = (p) => ev(p, `(() => { const u = ${QV}.querySelector('.undo'); return u ? { text: u.querySelector('span').textContent.trim(), btn: u.querySelector('.ub')?.textContent.trim() } : null; })()`);
  const toastT = (p) => ev(p, `${QV}.querySelector('.toast')?.textContent.trim() ?? ''`);
  const titleOf = (p, id) => ev(p, `${QV}.querySelector('.qr[data-id="${id}"] .rt b')?.textContent.trim()`);

  let p = await openQ('&admin=1');
  const before = await maUris(p), ids0 = await ids(p), victim = ids0[2], vTitle = await titleOf(p, victim);
  const vUri = before[(await maIds(p)).indexOf(victim)];
  await tap(p, `${QV}.querySelector('.qr[data-id="${victim}"] .qa[data-action="remove"]')`);
  await sleep(120);
  const dlg0 = await ev(p, `!!${QV}.querySelector('.confirm')`);
  let u = await bar(p);
  await sleep(700);
  let sc = await qcmds(p);
  check('D1 Remove: no dialog; player_queues/delete_item {queue_id, item_id_or_index: queue_item_id}; gone from the card and from MA; "Removed <title>. Undo" shows',
    !dlg0 && sc.length === 1 && J(sc[0]) === J({ command: 'player_queues/delete_item', data: { queue_id: 'syncgroup_everywhere', item_id_or_index: victim } })
      && !(await ids(p)).includes(victim) && !(await maIds(p)).includes(victim) && u && u.text === `Removed ${vTitle}.` && u.btn === 'Undo', J({ sc, u }));
  const nowId = await ev(p, `${QV}.querySelector('.qr.now')?.dataset.id`);
  check('D2 the playing row has no Remove icon (and played rows neither)', nowId && !(await ev(p, `!!${QV}.querySelector('.qr.now .qa[data-action="remove"], .qr.past .qa[data-action="remove"]')`)));
  await tap(p, `${QV}.querySelector('.undo .ub')`);
  await wait(p, `${QV}.querySelector('.toast')?.textContent.includes('is back')`, 4000); await sleep(900);
  sc = (await qcmds(p)).slice(1);
  const after = await maUris(p);
  const moved = sc.find((c) => c.command === 'player_queues/move_item');
  check('D3 Undo: play_media {queue_id, media: uri, option: add} → player_queues/items → move_item back; MA order is the original again (new queue_item_id)',
    sc[0]?.command === 'player_queues/play_media' && J(sc[0].data) === J({ queue_id: 'syncgroup_everywhere', media: vUri, option: 'add' })
      && sc[1]?.command === 'player_queues/items' && moved && moved.data.pos_shift < 0 && J(after) === J(before)
      && !(await maIds(p)).includes(victim) && (await toastT(p)) === `${vTitle} is back` && !(await bar(p)), J({ sc, before, after }));
  await p.close();

  // the bar leaves after about 5 s
  p = await openQ('&admin=1');
  const v2 = (await ids(p))[3];
  await tap(p, `${QV}.querySelector('.qr[data-id="${v2}"] .qa[data-action="remove"]')`);
  await sleep(4000); const at4 = !!(await bar(p));
  await sleep(1600); const at56 = !!(await bar(p));
  check('D4 the Undo bar stays about 5 s (there at 4 s, gone by 5.6 s)', at4 && !at56, J({ at4, at56 }));
  await p.close();

  // re-add fails → the toast says so
  p = await openQ('&admin=1&qadd=fail');
  const v3 = (await ids(p))[2], t3 = await titleOf(p, v3);
  await tap(p, `${QV}.querySelector('.qr[data-id="${v3}"] .qa[data-action="remove"]')`); await sleep(500);
  await tap(p, `${QV}.querySelector('.undo .ub')`);
  await wait(p, `${QV}.querySelector('.toast')?.textContent.includes('Couldn')`, 3000);
  check('D5 Undo when MA refuses the re-add: "Couldn\'t undo: <title> wasn\'t added back"', (await toastT(p)) === `Couldn't undo: ${t3} wasn't added back`, await toastT(p));
  await p.close();

  // re-added but the lookup fails → at the end, and the toast says it couldn't restore the place
  p = await openQ('&admin=1&qitems=fail');
  const b4 = await maUris(p), v4 = (await ids(p))[2], t4 = await titleOf(p, v4);
  const u4 = b4[(await maIds(p)).indexOf(v4)];
  await tap(p, `${QV}.querySelector('.qr[data-id="${v4}"] .qa[data-action="remove"]')`); await sleep(500);
  await tap(p, `${QV}.querySelector('.undo .ub')`);
  await wait(p, `${QV}.querySelector('.toast')?.textContent.includes('back')`, 3000); await sleep(500);
  const a4 = await maUris(p);
  check('D6 Undo that can\'t restore the place: the track is added at the end and the toast says so', a4[a4.length - 1] === u4 && (await toastT(p)) === `${t4} is back, at the end of the queue (couldn't restore its place)`, J({ t: await toastT(p), last: a4[a4.length - 1], u4 }));
  await p.close();

  // live MA 2.10.9: rows up to index_in_buffer can't move (500 "<n> is already played/buffered") or go (delete: 200, ignored)
  p = await openQ('&admin=1&qbuf=1');
  await wait(p, `${QV}.querySelector('.qr.next.buf')`, 3000);
  const v5 = (await ids(p))[0];
  const g5 = await ev(p, `(() => { const r = ${QV}.querySelector('.qr[data-id="${v5}"]'), n = r.nextElementSibling; const a = (el, k) => el.querySelector('.qa[data-action="' + k + '"]');
    return { buf: r.classList.contains('buf'), remove: !!a(r, 'remove'), next: !!a(r, 'playnext'), up: a(r, 'up')?.disabled, down: a(r, 'down')?.disabled,
      nUp: a(n, 'up')?.disabled, nNext: a(n, 'playnext')?.disabled, nRemove: !!a(n, 'remove'), bufs: ${QV}.querySelectorAll('.qr.buf').length }; })()`);
  check('D7 buffered row (index_in_buffer): no Remove / Play next, Move up + down disabled; the row after it is the first movable one',
    g5.buf && !g5.remove && !g5.next && g5.up && g5.down && g5.nUp && g5.nNext && g5.nRemove && g5.bufs === 1, J(g5));
  await p.close();
  // MA moved its buffer on after our read: a delete it ignores → toast + the row is back; a move it refuses → toast + reload
  p = await openQ('&admin=1');
  const v7 = (await ids(p))[0], v8 = (await ids(p))[3];
  await ev(p, `(() => { const Q = window.__queues['media_player.everywhere']; Q.buf = Q.index + 1; })()`);
  await tap(p, `${QV}.querySelector('.qr[data-id="${v7}"] .qa[data-action="remove"]')`);
  await wait(p, `${QV}.querySelector('.toast')?.textContent === 'That track is already loading'`, 3000);
  check('D7b delete ignored by MA (200, row still there): toast "That track is already loading", the row is back, no Undo bar',
    (await toastT(p)) === 'That track is already loading' && (await ids(p))[0] === v7 && !(await bar(p)), J({ t: await toastT(p), ids: (await ids(p)).slice(0, 2) }));
  await sleep(2300); // let the toast clear
  // MA buffers further on between the card's read and the tap (set right before it, so the card still offers Up)
  await ev(p, `(() => { const Q = window.__queues['media_player.everywhere']; Q.buf = Q.index + 4; })()`);
  await tap(p, `${QV}.querySelector('.qr[data-id="${v8}"] .qa[data-action="up"]')`);
  await wait(p, `${QV}.querySelector('.toast')?.textContent === 'That track is already loading'`, 3000);
  await wait(p, `${QV}.querySelectorAll('.qr.buf').length === 4`, 3000);
  check('D7c move refused by MA (500 "<n> is already played/buffered"): toast "That track is already loading" and the queue reloads (4 rows now locked)',
    (await toastT(p)) === 'That track is already loading' && (await ev(p, `${QV}.querySelectorAll('.qr.buf').length`)) === 4, J({ t: await toastT(p) }));
  await p.close();

  // phone: ⋯ opens an action sheet with the rest; Play now there still asks first; Remove there offers Undo
  p = await openQ('&admin=1', { width: 390, height: 844, isMobile: true, hasTouch: true });
  const v6 = (await ids(p))[3];
  await tap(p, `${QV}.querySelector('.qr[data-id="${v6}"] .qa.mo')`); await sleep(250);
  const sheet = await ev(p, `(() => { const m = ${QV}.querySelector('.menu'); return m ? { sheet: m.classList.contains('sheet'), items: [...m.querySelectorAll('[role=menuitem]')].map((b) => b.textContent.trim()) } : null; })()`);
  check('D8 phone ⋯ → action sheet: Play now…, Play next, Move up, Move down, Remove (+ Cancel)', sheet && sheet.sheet && J(sheet.items) === J(['Play now…', 'Play next', 'Move up', 'Move down', 'Remove', 'Cancel']), J(sheet));
  await tap(p, `[...${QV}.querySelectorAll('.menu .mi:not(.cancel)')][0]`); await sleep(200);
  const cf = await ev(p, `${QV}.querySelector('.confirm')?.dataset.kind ?? ''`);
  check('D9 Play now… from the sheet still asks first (nothing sent)', cf === 'jump' && (await qcmds(p)).length === 0, cf);
  await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="cancel"]')`); await sleep(200);
  await tap(p, `${QV}.querySelector('.qr[data-id="${v6}"] .qa.mo')`); await sleep(250);
  await tap(p, `[...${QV}.querySelectorAll('.menu .mi:not(.cancel)')].find((b) => b.textContent.trim() === 'Remove')`); await sleep(500);
  const sc6 = await qcmds(p);
  check('D10 Remove from the sheet: delete_item + the Undo bar', sc6.length === 1 && sc6[0].command === 'player_queues/delete_item' && !!(await bar(p)), J(sc6));
  await p.close();

  // guest: no Remove icon; the 0.4 menu is unchanged
  p = await openQ('', { width: 390, height: 844, isMobile: true, hasTouch: true });
  const g = (await ids(p))[3];
  const rmIcons = await ev(p, `${QV}.querySelectorAll('.qa[data-action="remove"]').length`);
  await tap(p, `${QV}.querySelector('.qr[data-id="${g}"] .qa.mo')`); await sleep(250);
  const gm = await ev(p, `[...${QV}.querySelectorAll('.menu .mi:not(.cancel)')].map((b) => b.textContent.trim())`);
  check('D11 guest: no Remove / Play now / Play next icons; ⋯ keeps the 0.4 menu', rmIcons === 0 && !gm.includes('Play now…') && gm.length > 0, J({ rmIcons, gm }));
  await p.close();
}

// ---------- E. editor: Speakers section + large_buttons ----------
{
  const pg = await browser.newPage();
  await hermetic(pg);
  const base = { type: 'custom:jukebox-card', entity: 'media_player.everywhere', config_entry_id: '01MUSICASSISTANT0000000000', mass_queue_entry_id: '01MASSQUEUE0000000000000000' };
  await pg.goto(`${BASE.replace('index.html', 'editor.html')}?fresh=1&cfg=${encodeURIComponent(J(base))}`);
  await pg.waitForFunction(() => window.__editor?.shadowRoot?.querySelector('ha-form'));
  await sleep(300);
  const F = `__editor.shadowRoot.querySelector('ha-form')`;
  const names = await ev(pg, `[...${F}.querySelectorAll('details[data-section=speakers] [data-name]')].map((e) => e.dataset.name)`);
  check('E1 editor: Speakers section with mode, targets, grouping, grouping_users, guest_access, leader_drop, presets, quiet hours',
    ['speaker_mode', 'targets', 'grouping', 'grouping_users', 'guest_access', 'leader_drop', 'presets', 'quiet_start', 'quiet_end', 'quiet_max', 'quiet_applies'].every((n) => names.includes(n)), J(names));
  check('E2 editor: large_buttons under Display', await ev(pg, `!!${F}.querySelector('details[data-section=display] [data-name=large_buttons]')`));
  const ch0 = await ev(pg, `window.__changes.length`);
  check('E3 a 0.4 config opens without the editor writing speaker keys', ch0 === 0 || !(await ev(pg, `JSON.stringify(window.__changes.at(-1))`)).includes('speaker_mode'), String(ch0));
  await ev(pg, `(() => { const s = ${F}.querySelector('[data-name=speaker_mode] select'); s.value = 'dynamic'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
  const last = await ev(pg, `window.__changes.at(-1)`);
  check('E4 choosing Dynamic writes speaker_mode: dynamic and keeps the rest', last?.speaker_mode === 'dynamic' && last?.entity === base.entity && last?.mass_queue_entry_id === base.mass_queue_entry_id, J(last));
  await pg.close();
}

// ───────────── live MA 2.10.9 shapes and timings (plan §17) ─────────────
{
  // mass_player_id null on every HA entity + idle groups pointing active_queue at Everywhere's queue (live=1)
  const p = await open(`&spk=dyn&admin=1&live=1&gap=1500&xgap=1200&target=${IN}&cfg=${encodeURIComponent(J({ leader_drop: 'allow' }))}`);
  const ent = await ev(p, `[window.__hass.states['${IN}'].attributes.mass_player_id, window.__hass.states['${IN}'].attributes.active_queue, window.__hass.states['${EVERY}'].attributes.mass_player_id]`);
  await openPanel(p); await waitLoaded(p);
  const b = await ev(p, `(() => { const r = ${SR}; return { banner: r.querySelector('.banner')?.dataset.kind ?? '', chip: r.querySelector('[data-target="${IN}"]')?.getAttribute('aria-checked'), presets: [...r.querySelectorAll('[data-preset]')].map((c) => c.dataset.preset) }; })()`);
  check('LV1 live entities (mass_player_id null, idle Indoor reports Everywhere\'s active_queue): Indoor still maps to its own MA group (not shown as static)',
    ent[0] === null && ent[1] === 'syncgroup_everywhere' && ent[2] === null && b.chip === 'true' && b.banner !== 'static' && b.presets.includes('Outdoor default'), J({ ent, b }));
  const err = (f) => p.evaluate(f).then(() => 'ok', (e) => String(e?.message ?? e));
  const idle = await err(() => window.__card.speakers.setMembers('syncgroup_mock_outdoor', ['wiim_mock_kitchen'], []));
  const after = await ev(p, `[window.__hass.states['${OUT}'].state, window.__ma.players().find((x) => x.player_id === 'syncgroup_mock_outdoor').group_members]`);
  check('LV2 set_members on an idle dynamic group: 200, the group stays idle, players/all lists the new members', idle === 'ok' && after[0] === 'idle' && J(after[1]) === J(['wiim_mock_garage', 'wiim_mock_kitchen']), J({ idle, after }));
  await p.close();
}
{
  const p = await open(`&spk=dyn&admin=1&live=1&gap=1500&xgap=1200&target=${IN}&cfg=${encodeURIComponent(J({ leader_drop: 'allow' }))}`);
  // start Indoor (from Now Playing, before the panel covers it), then drop its leader: live keeps the group 'playing' while the next member is silent ~5.9 s (1.5 s here)
  await tap(p, `${NOW}.shadowRoot.querySelector('.pp')`);
  await wait(p, ASKQ, 1500) && (await confirm(p));
  await wait(p, `window.__hass.states['${IN}'].state === 'playing'`, 4000);
  const aqPlaying = await ev(p, `window.__hass.states['${IN}'].attributes.active_queue`);
  await openPanel(p); await waitLoaded(p);
  check('LV2b once Indoor plays, its entity reports its own queue again (active_queue)', aqPlaying === 'syncgroup_mock_indoor', aqPlaying);
  const lead = await p.evaluate(() => window.__ma.G.syncgroup_mock_indoor.members[0]);
  const leadRoom = lead === 'wiim_mock_kitchen' ? KIT : LIV;
  await wait(p, `${act(leadRoom)}?.dataset.act === 'drop'`, 4000);
  await tap(p, act(leadRoom));
  const rg = await wait(p, `${SR}.querySelector('.stl')?.textContent.includes('Regrouping…')`, 1200);
  const stDuring = await st(p, IN);
  const back = await wait(p, `!${SR}.querySelector('.stl')?.textContent.includes('Regrouping…') && ${SR}.querySelector('.stl')?.textContent.includes('Playing')`, 5000);
  check('LV3 leader dropped (live: the group stays "playing", the new leader is silent): "Regrouping…" until the new leader plays, then "Playing"',
    rg && stDuring === 'playing' && back && (await events(p)).some((e) => e.ev === 'reformed'), J({ rg, stDuring, back }));
  await p.close();
}
{
  // live transfer: the source stops at once, the target is silent ~4.7 s (1.2 s here) and then plays
  const p = await open(`&spk=dyn&admin=1&ma=split&xgap=1200&target=${IN}`);
  await openPanel(p); await waitLoaded(p);
  // Deterministic: record every (source, target) state pair inside the page (no CDP round trip can miss the 1.2 s
  // buffering window under load), and always wait for the question instead of skipping confirm after 1.5 s.
  await p.evaluate((a, b) => {
    const seen = window.__lv4 = []; let last = '';
    const rec = () => { const k = `${window.__hass.states[a]?.state}|${window.__hass.states[b]?.state}`; if (k !== last) { last = k; seen.push(k); } };
    rec(); window.__lv4t = setInterval(rec, 5);
  }, IN, OUT);
  await tap(p, `${SR}.querySelector('[data-target="${OUT}"]')`);
  await confirm(p);
  const play = await wait(p, `window.__hass.states['${OUT}'].state === 'playing'`, 8000);
  const seq = await p.evaluate(() => { clearInterval(window.__lv4t); return window.__lv4; });
  const srcStop = seq.includes('idle|buffering') && seq.indexOf('idle|buffering') < seq.lastIndexOf('idle|playing');
  const gap = (await p.evaluate(() => (window.__maEvents ?? []).some((e) => e.ev === 'transferred')));
  check('LV4 transfer: the source stops on its own (no stop call), the target is silent for the gap and then plays', srcStop && play && gap && (await ma(p, 'players/cmd/stop')).length === 0 && (await target(p)) === OUT, J({ seq, srcStop, play, gap, t: await target(p) }));
  await p.close();
}
{
  // config/players/get refused (a token without the config read scope / older MA): card presets only
  const p = await open('&spk=dyn&admin=1&macfg=deny');
  await openPanel(p); await waitLoaded(p);
  const pr = await ev(p, `[...${SR}.querySelectorAll('[data-preset]')].map((c) => c.dataset.preset)`);
  check('LV5 MA group config unreadable → the card presets only (no "<Group> default" chips), panel otherwise works', J(pr) === J(['Dinner', 'Whole house']), J(pr));
  await p.close();
}

// ---------------- 0.6.3: live shape — Everywhere is a DYNAMIC MA sync group, Garage leads, HA lists no group_members ----------------
{
  const GSM = 'syncgroup_everywhere', GW = 'wiim_mock_garage';
  const pillTxt = (p) => ev(p, `__card.shadowRoot.querySelector('.pill')?.textContent.replace(/\\s+/g,' ').trim()`);
  const p = await open('&spk=dyn&admin=1&every=dyn');
  const gm0 = await ev(p, `window.__hass.states['${EVERY}'].attributes.group_members`);
  await wait(p, `/3 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`, 3000);
  const pl0 = await pillTxt(p);
  check('V1 pill: "3 speakers" while Everywhere plays although HA reports group_members: [] (was "idle")', J(gm0) === '[]' && /· 3 speakers/.test(pl0) && !/idle/.test(pl0), J({ gm0, pl0 }));
  await openPanel(p); await waitLoaded(p);
  await wait(p, `${act(GAR)}?.dataset.act === 'drop'`, 3000);
  const gw = await ev(p, `${row(GAR)}.querySelector('.where').textContent`);
  check('V2 the leader (Garage) offers Drop by default, not a greyed "Leader"', gw === 'Leads the group' && (await ev(p, `${act(GAR)}.textContent.trim()`)) === 'Drop'
    && (await ev(p, `${act(GAR)}.getAttribute('aria-disabled')`)) === 'false', gw);
  const n0 = (await ma(p, 'players/cmd/set_members')).length;
  await tap(p, act(GAR));
  const rg = await wait(p, `${SR}.querySelector('.stl')?.textContent.includes('Regrouping…')`, 1500);
  await wait(p, `${row(GAR)}.classList.contains('out') && !window.__ma.G.${GSM}.members.includes('${GW}')`, 4000);
  const sm = (await ma(p, 'players/cmd/set_members')).slice(n0);
  check('V3 Drop Garage (leader) → one players/cmd/set_members on the sync group (remove Garage); no stop, no HA unjoin',
    sm.length === 1 && sm[0].data.target_player === GSM && J(sm[0].data.player_ids_to_remove) === J([GW]) && J(sm[0].data.player_ids_to_add) === '[]'
    && !(await maCmds(p)).includes('players/cmd/stop') && (await joins(p)).length === 0, J(sm));
  await wait(p, `window.__hass.states['${EVERY}'].state === 'playing' && ${act(GAR)}?.dataset.act === 'join'`, 4000);
  const evs = await events(p);
  check('V4 MA re-forms Everywhere on Living Room + Kitchen ("Regrouping…"), Garage is offered Join',
    rg && evs.some((e) => /reform/.test(J(e))) && J(await maMembers(p, GSM)) === J(['wiim_mock_living', 'wiim_mock_kitchen']) && (await ev(p, `${act(GAR)}.dataset.act`)) === 'join', J({ rg, evs }));
  await wait(p, `/2 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`, 3000);
  check('V4b pill counts 2 speakers after the drop', /· 2 speakers/.test(await pillTxt(p)), await pillTxt(p));
  await tap(p, act(GAR));
  await wait(p, ASKQ, 800) && (await confirm(p));
  await wait(p, `${row(GAR)}.classList.contains('in')`, 4000);
  const sm2 = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('V5 re-add Garage → set_members(sync group, add Garage), Garage back in', sm2?.data.target_player === GSM && J(sm2?.data.player_ids_to_add) === J([GW])
    && (await maMembers(p, GSM)).includes(GW), J(sm2));
  await wait(p, `/3 speakers/.test(__card.shadowRoot.querySelector('.pill')?.textContent ?? '')`, 3000);
  check('V6 pill back to 3 speakers; Garage row "In this group" with Drop', /· 3 speakers/.test(await pillTxt(p)) && (await ev(p, `${act(GAR)}.dataset.act`)) === 'drop', await pillTxt(p));
  allJoins.push(...(await joins(p)));
  await p.close();
}
{
  // leader_drop: block is still available (opt-in)
  const p = await open(`&spk=dyn&admin=1&every=dyn&cfg=${encodeURIComponent(J({ leader_drop: 'block' }))}`);
  await openPanel(p); await waitLoaded(p);
  await wait(p, `${act(GAR)}?.dataset.act === 'blocked'`, 3000);
  const n = (await ma(p, 'players/cmd/set_members')).length;
  const lbl = await ev(p, `${act(GAR)}.textContent.trim()`);
  await tap(p, act(GAR));
  check('V7 leader_drop: block (opt-in) keeps "Leader" greyed; tapping explains and sends nothing', lbl === 'Leader' && /leads Everywhere/.test(await toast(p)) && (await ma(p, 'players/cmd/set_members')).length === n, J({ lbl, t: await toast(p) }));
  await p.close();
}
{
  // idle dynamic group: Join is shown greyed with a hint instead of hidden
  const p = await open('&spk=dyn&admin=1&every=dyn&idle=1');
  await openPanel(p); await waitLoaded(p);
  await wait(p, `${act(GAR)}?.dataset.act === 'idle'`, 3000);
  const a = await ev(p, `[...${SR}.querySelectorAll('.rooms .act')].map((b) => b.dataset.act + ':' + b.getAttribute('aria-disabled'))`);
  await tap(p, act(GAR));
  check('V8 idle Everywhere: every room shows a greyed Join; tapping says start playback first, sends nothing',
    a.length === 3 && a.every((x) => x === 'idle:true') && /Start playback/.test(await toast(p)) && (await ma(p, 'players/cmd/set_members')).length === 0, J({ a, t: await toast(p) }));
  await p.close();
}
{
  // a remembered target HA no longer has: forgotten once with a notice (was a silent fallback)
  const p = await open(`&spk=dyn&admin=1&target=media_player.old_group&cfg=${encodeURIComponent(J({ targets: [] }))}`);
  await wait(p, `!!__card.shadowRoot.querySelector('.lost')`, 3000);
  const lost = await ev(p, `__card.shadowRoot.querySelector('.lost')?.textContent ?? ''`);
  const ls = await p.evaluate(() => localStorage.getItem('jukebox-card:target:v1'));
  const ent = await target(p);
  const pl = await ev(p, `__card.shadowRoot.querySelector('.pill .pn')?.textContent`);
  check('V9 stale saved target: cleared, back on Everywhere, one notice names it', ls === null && ent === EVERY && pl === 'Everywhere' && /old group.*not found/i.test(lost), J({ ls, ent, pl, lost }));
  await p.close();
}

// ---------------- 0.6.3: Now Playing speaker controls (Drop / Add per room, Speakers button, "Playing on:" pill) ----------------
{
  const GSM = 'syncgroup_everywhere', GW = 'wiim_mock_garage';
  const nrow = (e) => `${NOW}.shadowRoot.querySelector('.vr[data-entity="${e}"]')`;
  const ra = (e) => `${nrow(e)}?.querySelector('.ra')`;
  const p = await open('&spk=dyn&admin=1&every=dyn', { width: 1920, height: 1080 });
  await wait(p, `${ra(GAR)}?.dataset.act === 'drop'`, 4000);
  const btns = await ev(p, `[${[LIV, KIT, GAR].map((e) => `${ra(e)}?.getAttribute('aria-label')`).join(',')}]`);
  const pill = await ev(p, `__card.shadowRoot.querySelector('.pill')?.textContent.replace(/\\s+/g,' ').trim()`);
  check('N1 admin + dynamic: each Now Playing room row has a Drop button (aria "Drop <room>"), the pill reads "Playing on: Everywhere · 3 speakers"',
    J(btns) === J(['Drop Living Room', 'Drop Kitchen', 'Drop Garage']) && /^Playing on:\s*Everywhere\s*· 3 speakers$/.test(pill)
    && /^Playing on: Everywhere/.test(await ev(p, `__card.shadowRoot.querySelector('.pill').getAttribute('aria-label')`)) && !(await ev(p, `${SPK}.open`)), J({ btns, pill }));
  const sb = await ev(p, `!!${NOW}.shadowRoot.querySelector('.vr.main [data-action="speakers"]')`);
  const gw = await ev(p, `${nrow(GAR)}.querySelector('.else')?.textContent ?? ''`);
  const lw = await ev(p, `${nrow(LIV)}.querySelector('.else')?.textContent ?? ''`);
  check('N2 the group row has a Speakers button; Garage says "Leads the group", members show no "elsewhere" title', sb && gw === 'Leads the group' && lw === '', J({ sb, gw, lw }));
  const n0 = (await ma(p, 'players/cmd/set_members')).length;
  await tap(p, ra(GAR));
  const modalN3 = await ev(p, MODALQ);
  await wait(p, `${nrow(GAR)}?.classList.contains('out') && ${ra(GAR)}?.dataset.act === 'join'`, 5000);
  const sm = (await ma(p, 'players/cmd/set_members')).slice(n0);
  const lbl = await ev(p, `${ra(GAR)}.getAttribute('aria-label')`);
  check('N3 Drop Garage from Now Playing → no dialog → one set_members(remove Garage); Garage greyed with "Add Garage", panel stays closed',
    !modalN3 && sm.length === 1 && sm[0].data.target_player === GSM && J(sm[0].data.player_ids_to_remove) === J([GW]) && lbl === 'Add Garage' && !(await ev(p, `${SPK}.open`)), J({ sm, lbl }));
  const undo = await ev(p, `!!${SR}.querySelector('.st [data-action="undo"]')`);
  check('N4 the chip offers Undo with the panel closed', undo);
  await tap(p, ra(GAR));
  await wait(p, ASKQ, 800) && (await confirm(p));
  await wait(p, `${nrow(GAR)} && !${nrow(GAR)}.classList.contains('out') && ${ra(GAR)}?.dataset.act === 'drop'`, 5000);
  const sm2 = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('N5 Add Garage from Now Playing → set_members(add Garage); back in with Drop', sm2?.data.target_player === GSM && J(sm2?.data.player_ids_to_add) === J([GW]) && (await maMembers(p, GSM)).includes(GW), J(sm2));
  // drop Kitchen and Living Room: Garage becomes the last speaker → Pause offered, nothing sent
  for (const e of [KIT, LIV]) {
    await wait(p, `${ra(e)}?.dataset.act === 'drop' && !${nrow(e)}.classList.contains('pending')`, 5000);
    await tap(p, ra(e)); if (await wait(p, ASKQ, 600)) await confirm(p);
    await wait(p, `${ra(e)}?.dataset.act === 'join'`, 5000);
  }
  await wait(p, `${ra(GAR)}?.dataset.act === 'blocked' && window.__hass.states['${EVERY}'].state === 'playing' && !${SPK}.inlineRegrouping()`, 6000);
  await sleep(300);
  const n1 = (await ma(p, 'players/cmd/set_members')).length;
  const dis = await ev(p, `${ra(GAR)}?.getAttribute('aria-disabled')`);
  await tap(p, ra(GAR));
  await wait(p, ASKQ, 1500);
  const at = await ev(p, `${SR}.querySelector('.sp-ask, .st.ask')?.textContent ?? ''`);
  const modalN6 = await ev(p, MODALQ);
  check('N6 the last room: its Drop is greyed, tapping offers Pause in the chip (same as the panel, no dialog), sends nothing',
    dis === 'true' && !modalN6 && /last speaker/.test(at) && /Pause/.test(at) && (await ma(p, 'players/cmd/set_members')).length === n1, J({ dis, at, t: await toast(p), s: await st(p, EVERY) }));
  if (at) await confirm(p, false);
  await tap(p, `${NOW}.shadowRoot.querySelector('[data-action="speakers"]')`);
  check('N7 the Speakers button opens the speakers panel', await wait(p, `${SPK}.open && !!${SR}.querySelector('section.sheet')`, 2000));
  allJoins.push(...(await joins(p)));
  await p.close();
}
{
  // idle: the buttons stay but are greyed, with the panel's hint
  const nrow = (e) => `${NOW}.shadowRoot.querySelector('.vr[data-entity="${e}"]')`;
  const p = await open('&spk=dyn&admin=1&every=dyn&idle=1');
  await wait(p, `${nrow(GAR)}?.querySelector('.ra')?.dataset.act === 'idle'`, 4000);
  const a = await ev(p, `[...${NOW}.shadowRoot.querySelectorAll('.rooms .ra')].map((b) => b.dataset.act + ':' + b.getAttribute('aria-disabled') + ':' + b.getAttribute('aria-label'))`);
  await tap(p, `${nrow(GAR)}.querySelector('.ra')`);
  const pill = await ev(p, `__card.shadowRoot.querySelector('.pill')?.textContent.replace(/\\s+/g,' ').trim()`);
  check('N8 idle Everywhere: every room shows a greyed Add; tapping says start playback first, sends nothing; pill "Speakers: Everywhere · idle"',
    a.length === 3 && a.every((x) => /^idle:true:Add /.test(x)) && /Start playback/.test(await toast(p)) && (await ma(p, 'players/cmd/set_members')).length === 0 && /^Speakers:\s*Everywhere\s*· idle$/.test(pill), J({ a, t: await toast(p), pill }));
  await p.close();
}
for (const [name, q] of [['guest (not admin)', '&spk=dyn&every=dyn'], ['grouping: nobody', `&spk=dyn&admin=1&every=dyn&cfg=${encodeURIComponent(J({ grouping: 'nobody' }))}`], ['fixed mode', '&admin=1']]) {
  const p = await open(q, { width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(1200);
  const n = await ev(p, `${NOW}.shadowRoot.querySelectorAll('.ra, .spkb').length`);
  const sl = await ev(p, `${NOW}.shadowRoot.querySelectorAll('.vr jb-slider').length`);
  const polling = await ev(p, `!!${SPK}.store?.timer`);
  check(`N9 ${name}: Now Playing is volume only (no Drop/Add, no Speakers button), sliders stay, no background MA poll`, n === 0 && sl >= 1 && !polling, J({ n, sl, polling }));
  await p.close();
}
{
  // compact at 390x844: one-line room rows, buttons inside the card
  const p = await open('&spk=dyn&admin=1&every=dyn', { width: 390, height: 844, isMobile: true, hasTouch: true });
  await wait(p, `${NOW}.shadowRoot.querySelector('.vr[data-entity="${GAR}"] .ra')?.dataset.act === 'drop'`, 4000);
  const r = await ev(p, `(() => { const s = ${NOW}.shadowRoot, v = s.querySelector('.vol').getBoundingClientRect();
    return { rows: [...s.querySelectorAll('.rooms .vr')].map((x) => Math.round(x.getBoundingClientRect().height)), inside: [...s.querySelectorAll('.ra, .spkb')].every((b) => { const q = b.getBoundingClientRect(); return q.width >= 30 && q.left >= v.left && q.right <= v.right + 0.5; }) }; })()`);
  check('N10 390x844: room rows stay one line (≤ 56px) and every button fits inside the volume card', r.rows.length === 3 && r.rows.every((h) => h <= 56) && r.inside, J(r));
  await p.close();
}

// ---------------- 0.6.4: quiet status — one small chip top-right, no centred popups for grouping ----------------
{
  const GSM = 'syncgroup_everywhere', GW = 'wiim_mock_garage';
  const nrow = (e) => `${NOW}.shadowRoot.querySelector('.vr[data-entity="${e}"]')`;
  const ra = (e) => `${nrow(e)}?.querySelector('.ra')`;
  const CLOCK = `__card.shadowRoot.querySelector('.clock')`;
  const geo = (p) => ev(p, `(() => { const c = ${CLOCK}.getBoundingClientRect(), k = __card.getBoundingClientRect(); return { cl: c.left, ct: c.top, cr: c.right, cb: c.bottom, kr: k.right, kw: k.width }; })()`);
  const nChips = (p) => ev(p, `${SR}.querySelectorAll('.st').length`);
  const popups = (p) => ev(p, `(() => { const r = ${SR}; return !!(r.querySelector('.sp-ask') || r.querySelector('.ask-scrim') || r.querySelector('.toast') || r.querySelector('.undo')); })()`);
  for (const vp of [{ width: 1920, height: 1080 }, { width: 390, height: 844, isMobile: true, hasTouch: true }]) {
    const tag = `${vp.width}x${vp.height}`;
    const p = await open('&spk=dyn&admin=1&every=dyn&grp=slow', vp);
    await wait(p, `${ra(GAR)}?.dataset.act === 'drop'`, 8000);
    const n0 = (await ma(p, 'players/cmd/set_members')).length;
    await tap(p, ra(GAR));
    // wait for the chip to render (reading it straight after the tap raced Lit's update under load); grp=slow keeps
    // "Regrouping…" up for longer than this wait
    await wait(p, `!!${SR}.querySelector('.st .ct')?.textContent.trim()`, 3000);
    const pop = await popups(p), c1 = await chip(p), g = await geo(p);
    check(`C1 ${tag} drop the leader (Garage) from Now Playing: no dialog, no toast or Undo bar; one chip says "Regrouping…"`, !pop && c1?.text === 'Regrouping…' && (await nChips(p)) === 1, J({ pop, c1 }));
    check(`C2 ${tag} the chip sits top-right, under the header clock (does not cover it), right edge lined up with the card`,
      !!c1 && c1.t >= g.cb - 0.5 && c1.t - g.cb < 40 && c1.r <= g.kr + 0.5 && g.kr - c1.r <= 64 && c1.l > g.kr - Math.max(g.kw * 0.75, 300) && c1.h <= 64, J({ c1, g }));
    const pe = await ev(p, `[getComputedStyle(${SPK}).pointerEvents, getComputedStyle(${SR}.querySelector('.st')).pointerEvents]`);
    check(`C3 ${tag} only the chip takes taps (the panel layer stays pointer-events: none)`, pe[0] === 'none' && pe[1] === 'auto', J(pe));
    await wait(p, `/Garage left/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 4000);
    const c2 = await chip(p);
    check(`C4 ${tag} after MA confirms: "Garage left · …" with Undo, replacing "Regrouping…" (still one chip)`, /^Garage left/.test(c2?.text ?? '') && c2?.act === 'Undo' && (await nChips(p)) === 1 && !(await popups(p)), J(c2));
    await tap(p, `${SR}.querySelector('.st [data-action="undo"]')`);
    await wait(p, `window.__ma.G.${GSM}.members.includes('${GW}')`, 5000);
    const u = (await ma(p, 'players/cmd/set_members')).slice(n0).at(-1);
    await wait(p, `${SR}.querySelector('.st .ct')?.textContent === 'Undone'`, 3000);
    check(`C5 ${tag} Undo in the chip → set_members(add Garage); chip says "Undone"`, J(u?.data.player_ids_to_add) === J([GW]) && (await toast(p)) === 'Undone', J({ u, t: await toast(p) }));
    const tUndone = Date.now();
    await sleep(Math.max(0, 2500 - (Date.now() - tUndone)));
    const at25 = !!(await chip(p));
    await sleep(2200);
    const at47 = !!(await chip(p));
    check(`C6 ${tag} the chip hides by itself after about 4 s (there at 2.5 s, gone by 4.7 s)`, at25 && !at47, J({ at25, at47 }));
    await p.close();
  }
  {
    // default Undo window (no test override): about 4 s
    const p = await open('&spk=dyn&admin=1&every=dyn');
    await p.evaluate(() => { delete window.__jbUndoMs; });
    await wait(p, `${ra(KIT)}?.dataset.act === 'drop'`, 4000);
    await tap(p, ra(KIT));
    await wait(p, `!!${SR}.querySelector('.st [data-action="undo"]')`, 3000);
    const t0 = Date.now();
    await sleep(3300);
    const there = !!(await ev(p, `${SR}.querySelector('.st [data-action="undo"]')`));
    await sleep(Math.max(0, 4700 - (Date.now() - t0)));
    const gone = !(await chip(p));
    check('C7 "Kitchen left · Undo" stays tappable about 4 s by default (there at 3.3 s, gone by 4.7 s)', there && gone, J({ there, gone }));
    await p.close();
  }
  {
    // last room → the chip offers Pause; Pause pauses the group (queue kept), Undo plays again
    const p = await open('&spk=dyn&admin=1&every=dyn', { width: 1920, height: 1080 });
    for (const e of [KIT, LIV]) {
      await wait(p, `${ra(e)}?.dataset.act === 'drop' && !${nrow(e)}.classList.contains('pending') && !${SPK}.inlineRegrouping()`, 6000);
      await tap(p, ra(e));
      await wait(p, `${ra(e)}?.dataset.act === 'join'`, 5000);
    }
    await wait(p, `${ra(GAR)}?.dataset.act === 'blocked' && window.__hass.states['${EVERY}'].state === 'playing' && !${SPK}.inlineRegrouping()`, 6000);
    await sleep(300);
    const n1 = (await ma(p, 'players/cmd/set_members')).length;
    await tap(p, ra(GAR));
    const c = await chip(p);
    check('C8 last room: chip "Garage is the last speaker in Everywhere · Pause" (no dialog)', /Garage is the last speaker in Everywhere/.test(c?.text ?? '') && c?.act === 'Pause' && !(await popups(p)), J(c));
    await tap(p, `${SR}.querySelector('.st.ask [data-action="confirm"]')`);
    await wait(p, `window.__hass.states['${EVERY}'].state === 'paused'`, 3000);
    await wait(p, `/Everywhere paused/.test(${SR}.querySelector('.st .ct')?.textContent ?? '')`, 3000);
    const c2 = await chip(p);
    check('C9 Pause → media_pause on Everywhere, nothing regrouped; chip "Everywhere paused · Undo"', (await st(p, EVERY)) === 'paused' && c2?.act === 'Undo'
      && (await ma(p, 'players/cmd/set_members')).length === n1 && (await calls(p)).some((x) => x.service === 'media_pause' && x.target?.entity_id === EVERY), J(c2));
    await tap(p, `${SR}.querySelector('.st [data-action="undo"]')`);
    check('C10 Undo → media_play: Everywhere plays again', await wait(p, `window.__hass.states['${EVERY}'].state === 'playing'`, 3000));
    await p.close();
  }
  {
    // confirm_drop: true brings back the 0.6.3 dialog
    const p = await open(`&spk=dyn&admin=1&every=dyn&cfg=${encodeURIComponent(J({ confirm_drop: true }))}`);
    await wait(p, `${ra(GAR)}?.dataset.act === 'drop'`, 4000);
    const n0 = (await ma(p, 'players/cmd/set_members')).length;
    await tap(p, ra(GAR));
    const m = await wait(p, MODALQ, 1500);
    const title = await askTitle(p);
    await confirm(p, false); await sleep(200);
    const none = (await ma(p, 'players/cmd/set_members')).length === n0;
    check('C11 confirm_drop: true → dropping the leader asks in the centred dialog again ("Drop Garage?"); Cancel sends nothing', m && /Drop Garage\?/.test(title) && none, J({ m, title, none }));
    await tap(p, ra(GAR)); await wait(p, MODALQ, 1500); await confirm(p);
    await wait(p, `!window.__ma.G.${GSM}.members.includes('${GW}')`, 5000);
    check('C12 confirm_drop: true → Drop in the dialog → set_members(remove Garage)', J((await ma(p, 'players/cmd/set_members')).at(-1)?.data.player_ids_to_remove) === J([GW]));
    await p.close();
  }
  {
    // a failed MA call: the chip in its error style, never a dialog
    const p = await open('&spk=dyn&admin=1&every=dyn&grp=fail', { width: 1920, height: 1080 });
    await wait(p, `${ra(GAR)}?.dataset.act === 'drop'`, 4000);
    await tap(p, ra(GAR));
    await wait(p, `${SR}.querySelector('.st')?.dataset.kind === 'error'`, 4000);
    const c = await chip(p), g = await geo(p);
    const look = await ev(p, `(() => { const s = getComputedStyle(${SR}.querySelector('.st')); return [s.backgroundColor, s.color, s.fontSize]; })()`);
    check('C13 set_members fails → error chip "Couldn\'t drop Garage: …" top-right (white on black inverted, ≥ 14px), no dialog; Garage stays in',
      /^Couldn't drop Garage/.test(c?.text ?? '') && !(await popups(p)) && c.t >= g.cb - 0.5 && look[0] === 'rgb(255, 255, 255)' && look[1] === 'rgb(0, 0, 0)' && parseFloat(look[2]) >= 14
      && (await maMembers(p, GSM)).includes(GW), J({ c, look }));
    await tap(p, `${SR}.querySelector('.st [data-action="cancel"]')`);
    check('C14 the error chip can be dismissed', !(await chip(p)));
    await p.close();
  }
  {
    // panel open (tablet drawer): the chip stays clear of the panel's close button; takeover questions are chip questions too
    const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}`, { width: 1280, height: 800 });
    await openPanel(p); await waitLoaded(p);
    await wait(p, `${act(GAR)}?.dataset.act === 'take'`, 4000);
    await tap(p, act(GAR));
    await wait(p, `!!${SR}.querySelector('.st.ask')`, 1500);
    const c = await chip(p), x = await rectOf(p, `${SR}.querySelector('.sheet .x')`);
    check('C15 a takeover asks in the chip (action button, no dialog), clear of the panel\'s close button', !(await ev(p, MODALQ)) && !!c?.act && !!x && (c.r <= x.l || c.t >= x.b), J({ c, x }));
    await confirm(p, false);
    check('C16 dismissing the chip question sends nothing', (await ma(p, 'players/cmd/set_members')).length === 0 && !(await chip(p)));
    await p.close();
  }
}

// ---------------- 0.6.5 (Q62): a pending chip question survives state updates and late status messages ----------------
{
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${IN}`, { width: 1280, height: 800 });
  await p.evaluate(() => { window.__jbAskMs = 20000; });
  await openPanel(p); await waitLoaded(p);
  await wait(p, `${act(GAR)}?.dataset.act === 'take'`, 4000);
  const n0 = (await ma(p, 'players/cmd/set_members')).length;
  await tap(p, act(GAR));
  await wait(p, `!!${SR}.querySelector('.st.ask')`, 1500);
  const q0 = (await chip(p))?.text;
  // hass state pushes while the question waits (volume, position and a room's state), as Home Assistant sends them
  for (let i = 0; i < 6; i++) {
    await ev(p, `(() => { const h = __card.hass, s = { ...h.states };
      for (const id of ['${LIV}', '${KIT}', '${GAR}', '${IN}']) if (s[id]) s[id] = { ...s[id], attributes: { ...s[id].attributes, volume_level: ${0.2 + i * 0.05}, media_position: ${10 + i} }, last_updated: new Date().toISOString() };
      __card.hass = { ...h, states: s }; })()`);
    await sleep(120);
  }
  const c1 = await chip(p);
  check('Q62-E1 hass state updates while the chip asks: the question stays (same text, still asking), nothing sent',
    c1?.kind === 'ask' && c1.text === q0 && (await ev(p, `${SPK}.asking`)) && (await ma(p, 'players/cmd/set_members')).length === n0, J({ q0, c1 }));
  // a late status from an earlier change lands meanwhile (0.6.4: it replaced the chip and answered "no")
  await ev(p, `${SPK}.status('Kitchen joined Indoor', { undo: { label: 'Kitchen joined', run: async () => {} } })`);
  await sleep(150);
  const c2 = await chip(p);
  check('Q62-E2 a late "joined · Undo" message waits behind the question instead of answering it', c2?.kind === 'ask' && c2.text === q0 && (await ev(p, `${SPK}.asking`)), J(c2));
  await confirm(p);
  await wait(p, `window.__ma.G.syncgroup_mock_indoor.members.includes('wiim_mock_garage')`, 5000);
  const sm = (await ma(p, 'players/cmd/set_members')).at(-1);
  check('Q62-E3 answering yes after the updates still takes the speaker (set_members add Garage)', (await ma(p, 'players/cmd/set_members')).length > n0 && J(sm?.data.player_ids_to_add) === J(['wiim_mock_garage']), J(sm));
  const seen = await wait(p, `[...${SR}.querySelectorAll('.st .ct')].some((x) => /Kitchen joined Indoor|Garage joined/.test(x.textContent))`, 3000);
  check('Q62-E4 the held message (or the new result) shows after the answer', seen, J(await chip(p)));
  await p.close();
}
{
  // the real race (S12 before the test waited): take Kitchen, then ask about Living Room while Kitchen is still joining
  const p = await open(`&spk=dyn&admin=1&ma=split&target=${OUT}`);
  await p.evaluate(() => { window.__jbAskMs = 20000; });
  await tap(p, `${NOW}.shadowRoot.querySelector('.pp')`);
  await wait(p, ASKQ); await confirm(p);
  await wait(p, `window.__hass.states['${OUT}'].state === 'playing'`);
  await openPanel(p); await waitLoaded(p);
  await wait(p, `${act(KIT)}?.dataset.act === 'take' && ${act(LIV)}?.dataset.act === 'take'`, 4000);
  await tap(p, act(KIT)); await confirm(p);
  // straight away, while Kitchen's join is in flight
  await tap(p, act(LIV));
  const asked = await wait(p, `!!${SR}.querySelector('.st.ask')`, 2000);
  // Kitchen's "joined" lands now
  await wait(p, `!${row(KIT)}?.classList.contains('pending') && window.__ma.G.syncgroup_mock_outdoor.members.includes('wiim_mock_kitchen')`, 5000);
  await sleep(400);
  const c = await chip(p);
  check('Q62-E5 the Living Room question survives Kitchen\'s late "joined" result (0.6.4 answered it "no")', asked && c?.kind === 'ask' && /Living Room/.test(c.text), J(c));
  await confirm(p);
  const ok = await wait(p, `window.__ma.G.syncgroup_mock_outdoor.members.includes('wiim_mock_living')`, 5000);
  check('Q62-E6 confirming it then takes Living Room as well', ok, J(await maMembers(p, 'syncgroup_mock_outdoor')));
  await p.close();
}

// ---------------- HA 2026.10: an ungrouped MA player reports group_members: [] ----------------
{
  const p = await open('');
  await tap(p, `__card.shadowRoot.querySelector('.pill')`);
  await wait(p, `${SPK}.hasAttribute('open')`, 3000);
  const ent = await ev(p, `__card.config?.entity ?? __card._config.entity`);
  const rooms = await ev(p, `${SR}.querySelectorAll('.rooms [data-room]').length`);
  await ev(p, `(() => { const h = __card.hass, s = { ...h.states }; s['${ent}'] = { ...s['${ent}'], attributes: { ...s['${ent}'].attributes, group_members: [] } }; __card.hass = { ...h, states: s }; })()`);
  await sleep(200);
  const line = await ev(p, `${SR}.querySelector('.stl')?.textContent.trim()`);
  check('Z1 group_members: [] on a configured-rooms target counts the rooms, not "0 speakers"', rooms > 0 && new RegExp(`· ${rooms} speakers?$`).test(line) && !/· 0 speakers/.test(line), J({ line, rooms }));
  await p.close();
}

check('X1 Home Assistant media_player.join / unjoin never called (MA set_members only)', allJoins.length === 0, J(allJoins));

await browser.close();
console.log(`\n${total - failures}/${total} speakers checks passed`);
process.exit(failures ? 1 : 0);

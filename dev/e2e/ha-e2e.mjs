// Real Home Assistant + Music Assistant e2e for the jukebox_kiosk integration and the card it serves.
// Needs the box env from dev/e2e/up.sh (HA on :8123, MA on :8095, tokens in $JB_E2E_DIR, default /tmp/jbe2e).
// Usage: node dev/e2e/ha-e2e.mjs [--shots DIR]
// Drives the real HA frontend as the admin user and as the non-admin "kiosk" user. Prints PASS/FAIL lines.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { execFileSync } from 'child_process';

const DIR = process.env.JB_E2E_DIR ?? process.env.E2E_DIR ?? '/tmp/jbe2e';
const HA = process.env.HA_URL ?? 'http://127.0.0.1:8123';
const PAGE = `${HA}/jukebox-e2e/jukebox`;
const ENT = 'media_player.kitchen_test';
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const here = new URL('.', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + String(info).slice(0, 300) : ''}`); }
const token = (who) => fs.readFileSync(`${DIR}/ha_${who}.token`, 'utf8').trim();
/** MA command straight to the box MA (an "outside" client) */
const ma = (cmd, args = {}) => JSON.parse(execFileSync('python3', [`${here}ma_ws.py`, cmd, J(args)], { encoding: 'utf8', env: { ...process.env, E2E_DIR: DIR } }) || 'null');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });

const FIND = `(() => { const q = [document]; while (q.length) { const n = q.shift(); const f = n.querySelector?.('jukebox-card'); if (f) return f;
  for (const el of n.querySelectorAll?.('*') ?? []) if (el.shadowRoot) q.push(el.shadowRoot); } return null; })()`;
const C = `window.__card.shadowRoot`;
const sub = (tag) => `${C}.querySelector('${tag}').shadowRoot`;
const QV = sub('jb-queue'), SV = sub('jb-search'), BR = `${C}.querySelector('jb-browse')`;
const LY = `${C}.querySelector('jb-lyrics[mode=tab]')`;

async function open(who = 'admin', vp = { width: 1920, height: 1080 }, url = PAGE) {
  const page = await browser.newPage();
  page.__logs = [];
  page.on('console', (m) => { if (['error', 'warning', 'warn'].includes(m.type())) page.__logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => page.__logs.push('PAGEERROR ' + e.message));
  await page.setViewport({ deviceScaleFactor: 1, ...vp });
  await page.emulateTimezone(process.env.E2E_TZ ?? 'America/Chicago');
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('hassTokens', JSON.stringify({ access_token: t, token_type: 'Bearer', expires_in: 1e9, hassUrl: location.origin, clientId: location.origin + '/', expires: Date.now() + 1e12, refresh_token: '' }));
    window.__ws = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); (Array.isArray(m) ? m : [m]).forEach((x) => window.__ws.push(x)); } catch {} return send.call(this, d); };
  }, token(who));
  await page.goto(url);
  if (url === PAGE) {
    await page.waitForFunction(`!!(window.__card = ${FIND}) && !!window.__card.shadowRoot?.querySelector('.tab')`, { timeout: 30000, polling: 200 }).catch(() => {});
    await sleep(1500);
  }
  return page;
}
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const wait = (p, fn, timeout = 8000) => p.waitForFunction(fn, { timeout, polling: 100 }).then(() => true, () => false);
const sent = (p, since = 0) => p.evaluate((n) => window.__ws.slice(n), since);
const nsent = (p) => p.evaluate(() => window.__ws.length);
const wsCall = (p, msg) => p.evaluate((m) => window.__card.hass.connection.sendMessagePromise(m).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: e?.code ?? String(e) })), msg);
async function tap(p, expr) {
  const r = await ev(p, `(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView?.({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })()`);
  if (!r || !r.w) throw new Error('no element to tap: ' + expr);
  await p.mouse.click(r.x, r.y);
  await sleep(120);
}
const tab = (p, id) => tap(p, `${C}.querySelector('.tab[data-tab="${id}"]')`);
const queueIds = (p) => wsCall(p, { type: 'jukebox_kiosk/queue_items', entity_id: ENT, limit_before: 0, limit_after: 100 });
const shot = async (p, name) => { if (shotsAt) { await sleep(600); await p.screenshot({ path: `${shotsAt}/${name}.png` }); } };
const state = (p) => ev(p, `window.__card.hass.states['${ENT}']?.state`);

// ---------------- 1. load, auto backend, capabilities ----------------
const p = await open('admin');
{
  const info = await ev(p, `({ card: !!window.__card, defined: !!customElements.get('jukebox-card'), backend: window.__card?.dataset.backend,
    errCard: !!(${FIND.replace("'jukebox-card'", "'hui-error-card'")}), kiosk: window.__card?.hass.config.components.includes('jukebox_kiosk'),
    res: [...document.querySelectorAll('script[type=module], link[rel=modulepreload]')].length })`);
  check('E1 card element registered in the real HA frontend (no "Configuration error")', info.card && info.defined && !info.errCard, J(info));
  check('E2 backend auto → kiosk (jukebox_kiosk loaded)', info.backend === 'kiosk' && info.kiosk, info.backend);
  const res = await wsCall(p, { type: 'lovelace/resources' });
  check('E3 no manual Lovelace resource needed (resources list empty)', res.ok && res.r.length === 0, J(res));
  // Migration: ha_setup.py --legacy-resource pre-creates the old HACS resource and a stand-in plugin folder; the
  // integration removes the resource at startup and keeps a Repairs issue while the plugin folder is still there.
  const legacyDir = fs.existsSync(`${DIR}/ha-config/www/community/ha-jukebox-kiosk-card`);
  const iss = await wsCall(p, { type: 'repairs/list_issues' });
  const mine = (iss.r?.issues ?? []).filter((i) => i.domain === 'jukebox_kiosk' && i.issue_id === 'legacy_card_plugin_installed');
  check('R1 Repairs: the old-plugin issue is raised while the HACS plugin files remain (and survives restarts)',
    iss.ok && (legacyDir ? mine.length === 1 && /^legacy_card_plugin_(installed|files)$/.test(mine[0].translation_key) : mine.length === 0),
    J({ legacyDir, keys: mine.map((i) => i.translation_key) }));
  const caps = await wsCall(p, { type: 'jukebox_kiosk/capabilities' });
  check('E4 capabilities for the admin: every class, MA schema reported', caps.ok && ['read', 'playback', 'queue', 'library', 'speakers', 'admin'].every((c) => caps.r.classes?.includes(c)) && caps.r.ma_schema > 0, J({ classes: caps.r?.classes, ma_schema: caps.r?.ma_schema, guest: caps.r?.guest }));
  check('E4b card asked for capabilities over the WS', (await sent(p)).some((m) => m.type === 'jukebox_kiosk/capabilities'));
}
// ---------------- 2. search + play ----------------
{
  await tab(p, 'search');
  await p.keyboard.type('album one', { delay: 40 });
  const ok = await wait(p, `${SV}.querySelectorAll('.row').length > 0`, 15000);
  const groups = await ev(p, `[...${SV}.querySelectorAll('.grp')].map((g) => g.classList[1] + ':' + g.querySelectorAll('.row').length)`);
  check('S1 typing on the hardware keyboard searches MA (core music_assistant.search) and lists results', ok && (await sent(p)).some((m) => (m.type === 'call_service' && m.domain === 'music_assistant' && m.service === 'search') || (m.type === 'jukebox_kiosk/ma' && m.command === 'music/search')), J({ groups, sent: [...new Set((await sent(p)).map((m) => m.type + (m.command ? ' ' + m.command : '') + (m.service ? ' ' + m.domain + '.' + m.service : '')).filter((t) => /jukebox|mass|music|call_service|execute/.test(t)))] }));
  await shot(p, 'search-1920');
  // Replace queue with the album "Album One" (Test Tones): confirm sheet first
  const albumRow = `[...${SV}.querySelectorAll('.row[data-group="albums"]')].find((r) => /Album One/.test(r.textContent) && /Test Tones/.test(r.textContent))`;
  await tap(p, `${albumRow}?.querySelector('.ra-b[data-act="replace"]')`);
  const conf = await wait(p, `!!${C}.querySelector('.confirm .cbtn[data-action="confirm"]') || !!${SV}.querySelector('.confirm .cbtn[data-action="confirm"]')`, 3000);
  await tap(p, `${SV}.querySelector('.confirm .cbtn[data-action="confirm"]') ?? ${C}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  const playing = await wait(p, `window.__card.hass.states['${ENT}']?.state === 'playing'`, 20000);
  check('P1 Replace queue (after the confirm) → MA plays the album on the target', conf && playing, await state(p));
  // add the second album to the end so the queue has 8 items
  await tap(p, `${SV}.querySelector('.qx')`);
  await p.keyboard.type('album two', { delay: 40 });
  await wait(p, `[...${SV}.querySelectorAll('.row[data-group="albums"]')].some((r) => /Album Two/.test(r.textContent) && /Test Tones/.test(r.textContent))`, 15000);
  await tap(p, `[...${SV}.querySelectorAll('.row[data-group="albums"]')].find((r) => /Album Two/.test(r.textContent) && /Test Tones/.test(r.textContent))?.querySelector('.ra-b[data-act="add"]')`);
  await sleep(2500);
  const q = await queueIds(p);
  check('P2 Add to queue → 8 items in the MA queue', q.ok && (q.r.items?.length ?? 0) + (q.r.current ? 1 : 0) >= 8, J({ n: q.r?.items?.length, keys: Object.keys(q.r ?? {}) }));
}
// ---------------- 3. queue: play_index, move, remove/undo, push ----------------
{
  await tab(p, 'queue');
  await wait(p, `${QV}.querySelectorAll('.qr.next').length >= 5`, 10000);
  const ids = () => ev(p, `[...${QV}.querySelectorAll('.qr.next')].map((r) => r.dataset.id)`);
  let before = await ids();
  check('Q0 Up next rows from jukebox_kiosk/queue_items', before.length >= 5 && (await sent(p)).some((m) => m.type === 'jukebox_kiosk/queue_items'), String(before.length));
  check('Q0b queue push subscribed (jukebox_kiosk/subscribe_queue)', (await sent(p)).some((m) => m.type === 'jukebox_kiosk/subscribe_queue' && m.entity_id === ENT));
  await shot(p, 'queue-1920');
  // Play next (move)
  let n = await nsent(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${before[3]}"] .qa[data-action="playnext"]')`);
  const moved = await wait(p, `[...${QV}.querySelectorAll('.qr.next')][0]?.dataset.id === '${before[3]}'`, 6000);
  const mv = (await sent(p, n)).filter((m) => m.type === 'jukebox_kiosk/ma' && m.command === 'player_queues/move_item');
  check('Q1 Play next → player_queues/move_item; the row moves to the top of Up next', moved && mv.length === 1, J(mv.map((m) => m.args)));
  // Remove + Undo
  before = await ids();
  const victim = before[2];
  n = await nsent(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${victim}"] .qa[data-action="remove"]')`);
  const gone = await wait(p, `![...${QV}.querySelectorAll('.qr.next')].some((r) => r.dataset.id === '${victim}')`, 6000);
  const del = (await sent(p, n)).filter((m) => m.type === 'jukebox_kiosk/ma' && m.command === 'player_queues/delete_item');
  check('Q2 Remove → player_queues/delete_item; row gone; Undo offered', gone && del.length === 1 && (await ev(p, `!!${QV}.querySelector('.undo .ub')`)), J(del.map((m) => m.args)));
  const lenAfterDel = (await ids()).length;
  await tap(p, `${QV}.querySelector('.undo .ub')`);
  const back = await wait(p, `${QV}.querySelectorAll('.qr.next').length === ${lenAfterDel + 1}`, 8000);
  check('Q3 Undo puts the track back in the queue', back, String((await ids()).length));
  // play_index (Play now, confirmed)
  before = await ids();
  n = await nsent(p);
  await tap(p, `${QV}.querySelector('.qr[data-id="${before[1]}"] .qa[data-action="playnow"]')`);
  await wait(p, `!!${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`, 3000);
  await tap(p, `${QV}.querySelector('.confirm .cbtn[data-action="confirm"]')`);
  await sleep(2500);
  const pi = (await sent(p, n)).filter((m) => m.type === 'jukebox_kiosk/ma' && m.command === 'player_queues/play_index');
  const cur = await queueIds(p);
  const curId = cur.r?.current_item_id;
  check('Q4 Play now → player_queues/play_index; MA now plays that item', pi.length === 1 && pi[0].args.index === before[1] && curId === before[1], J({ args: pi.map((m) => m.args), curId: curId === before[1] }));
  // push: an outside MA client removes the last item; the card follows with no action of its own
  const cnt = (await ids()).length;
  const last = (await ids()).at(-1);
  const queueId = (await ev(p, `window.__card.hass.states['${ENT}']?.attributes?.active_queue`)) ?? null;
  n = await nsent(p);
  let pushOk = false, err = '';
  try {
    const qs = ma('player_queues/all');
    const qid = queueId ?? (qs.find?.((x) => x.items >= cnt) ?? qs[0])?.queue_id;
    ma('player_queues/delete_item', { queue_id: qid, item_id_or_index: last });
    pushOk = await wait(p, `${QV}.querySelectorAll('.qr.next').length === ${cnt - 1}`, 8000);
  } catch (e) { err = String(e).slice(0, 200); }
  const reads = (await sent(p, n)).filter((m) => m.type === 'jukebox_kiosk/queue_items').length;
  check('Q5 queue push: an outside MA edit reaches the card (fresh queue_items read, row gone)', pushOk && reads >= 1, err || `reads ${reads}`);
}
// ---------------- 4. now playing, speakers, lyrics ----------------
{
  await tab(p, 'now');
  await sleep(800);
  const title = await ev(p, `${sub('jb-now')}.textContent`);
  check('N1 Now Playing shows the sine-tone track', /Tone \d+ Hz/.test(title), '');
  await shot(p, 'now-1920');
  await tap(p, `${C}.querySelector('.pill')`);
  const spk = await wait(p, `${C}.querySelector('jb-speakers')?.hasAttribute('open')`, 4000);
  const rooms = await ev(p, `${sub('jb-speakers')}.textContent`);
  check('K1 Speakers sheet opens and lists both test players', spk && /Kitchen Test/.test(rooms) && /Patio Test/.test(rooms));
  await shot(p, 'speakers-1920');
  await tap(p, `${C}.querySelector('.pill')`);
  await tab(p, 'lyrics');
  const ly = await wait(p, `${LY}?.dataset.status === 'none'`, 15000);
  const lyMsgs = (await sent(p)).filter((m) => m.type === 'jukebox_kiosk/ma' && m.command === 'metadata/get_track_lyrics');
  check('L1 Lyrics tab: sine tones have none → "No lyrics found"', ly && /No lyrics found/.test(await ev(p, `${LY}.shadowRoot.textContent`)), await ev(p, `${LY}?.dataset.status`));
  check('L2 lyrics: the library copy never reaches get_track_lyrics (local files: provider copy is the library copy → none, nothing written)', (await sent(p)).some((m) => m.command === 'player_queues/get') && lyMsgs.every((m) => !String(m.args?.track?.uri).startsWith('library://')), J({ uris: lyMsgs.map((m) => m.args?.track?.uri), sent: [...new Set((await sent(p)).map((m) => m.type + (m.command ? ' ' + m.command : '') + (m.service ? ' ' + m.domain + '.' + m.service : '')).filter((t) => /jukebox|mass|music|call_service|execute/.test(t)))] }));
  await shot(p, 'lyrics-1920');
}
// ---------------- 5. track lists (server paging) ----------------
{
  const lib = await wsCall(p, { type: 'jukebox_kiosk/ma', command: 'music/albums/library_items', args: { limit: 10 } });
  const album = (lib.r ?? []).find((a) => a.name === 'Album One');
  const t = album ? await wsCall(p, { type: 'jukebox_kiosk/item_tracks', uri: album.uri, page: 1, page_size: 3 }) : { ok: false };
  check('T1 jukebox_kiosk/item_tracks pages an album (page_size 3 of 4 → more)', t.ok && t.r.tracks?.length === 3 && t.r.more === true, J({ n: t.r?.tracks?.length, more: t.r?.more, keys: Object.keys(t.r ?? {}) }));
  const t2 = album ? await wsCall(p, { type: 'jukebox_kiosk/item_tracks', uri: album.uri, page: 2, page_size: 3 }) : { ok: false };
  check('T2 page 2 has the last track, more=false', t2.ok && t2.r.tracks?.length === 1 && !t2.r.more, J({ n: t2.r?.tracks?.length, more: t2.r?.more }));
  await tab(p, 'browse');
  await sleep(800);
  await p.evaluate((b) => eval(b).openDetail(arguments[1]), BR).catch(() => {});
  if (album) await p.evaluate((b, a) => eval(b).openDetail(a, 'album'), BR, album);
  const rows = await wait(p, `(${BR}.shadowRoot.querySelector('jb-detail')?.shadowRoot?.querySelectorAll('.list.tracks .row').length ?? 0) === 4`, 8000);
  check('T3 album detail in Browse lists its 4 tracks', rows);
}
const adminLogs = p.__logs.slice();
// ---------------- 6. phone size shots ----------------
if (shotsAt) {
  const m = await open('admin', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  for (const [id, name] of [['now', 'now'], ['queue', 'queue'], ['search', 'search'], ['lyrics', 'lyrics']]) {
    await ev(m, `window.__card._tab = '${id}'`); await sleep(900);
    if (id === 'search') { await m.keyboard.type('tone', { delay: 30 }); await sleep(1500); }
    await shot(m, `${name}-390`);
  }
  await ev(m, `window.__card._tab = 'now'`); await ev(m, `window.__card._spk = true`); await sleep(900); await shot(m, 'speakers-390');
  await m.close();
  for (const vp of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    const r = await open('admin', vp, `${HA}/config/repairs`);
    await sleep(5000);
    await r.screenshot({ path: `${shotsAt}/repairs-${vp.width}.png` });
    await r.close();
  }
}
// ---------------- 7. the non-admin kiosk user ----------------
{
  const k = await open('kiosk');
  const backend = await ev(k, `window.__card?.dataset.backend`);
  const caps = await wsCall(k, { type: 'jukebox_kiosk/capabilities' });
  check('U1 kiosk user: the card loads on the kiosk backend', backend === 'kiosk', backend);
  check('U2 kiosk user is a guest with the default classes (read, playback, queue, library; no speakers, no admin)',
    caps.ok && caps.r.guest === true && J(caps.r.classes) === J(['library', 'playback', 'queue', 'read']) && !caps.r.features.speakers && caps.r.features.unfavorite, J({ classes: caps.r?.classes, guest: caps.r?.guest }));
  const search = await wsCall(k, { type: 'jukebox_kiosk/ma', command: 'music/search', args: { search_query: 'tone', limit: 2 } });
  check('U3 kiosk user may search (read)', search.ok, J(search.e ?? ''));
  const lib = await wsCall(k, { type: 'jukebox_kiosk/ma', command: 'music/tracks/library_items', args: { limit: 1 } });
  const uri = lib.r?.[0]?.uri;
  const wasFav = !!lib.r?.[0]?.favorite;
  const fav = await wsCall(k, { type: 'jukebox_kiosk/ma', command: 'music/favorites/add_item', args: { item: uri } });
  check('U4 kiosk user may favourite (library class, favorites/add_item)', fav.ok, J(fav));
  if (!wasFav) {
    const rm = await wsCall(k, { type: 'jukebox_kiosk/ma', command: 'music/favorites/remove_item', args: { media_type: 'track', library_item_id: lib.r[0].item_id } });
    check('U5 kiosk user may unfavourite (favorites/remove_item); favourite state restored', rm.ok, J(rm));
  } else check('U5 kiosk user may unfavourite (skipped: the track was already a favourite, left as is)', true);
  const raw = await wsCall(k, { type: 'jukebox_kiosk/raw', command: 'players/all', args: {} });
  check('U6 kiosk user denied the admin raw command', !raw.ok && raw.e === 'unauthorized', J(raw));
  const unfav = await wsCall(k, { type: 'jukebox_kiosk/unfavorite_current', entity_id: ENT });
  check('U7 kiosk user passes the class check on unfavorite_current (library); any refusal is not "unauthorized"', unfav.ok || unfav.e !== 'unauthorized', J(unfav));
  const players = ma('players/all');
  const pid = (players ?? []).find((x) => /kitchen/i.test(x.display_name ?? x.name ?? ''))?.player_id ?? 'kitchen-test';
  for (const [cmd, args] of [['players/cmd/set_members', { target_player: pid, player_ids_to_add: [] }], ['player_queues/transfer', { source_queue_id: pid, target_queue_id: pid }], ['players/cmd/stop', { player_id: pid }]]) {
    const r = await wsCall(k, { type: 'jukebox_kiosk/ma', command: cmd, args });
    check(`U11 kiosk user refused ${cmd} (no speakers class)`, !r.ok && r.e === 'unauthorized', J(r));
  }
  const vol0 = await ev(k, `window.__card.hass.states['${ENT}']?.attributes?.volume_level`);
  const target = vol0 > 0.5 ? 0.31 : 0.62;
  const vs = await ev(k, `window.__card.hass.callService('media_player', 'volume_set', { volume_level: ${target} }, { entity_id: '${ENT}' }).then(() => true, (e) => String(e?.code ?? e))`);
  const volOk = await wait(k, `Math.abs((window.__card.hass.states['${ENT}']?.attributes?.volume_level ?? -1) - ${target}) < 0.02`, 10000);
  check('U12 kiosk user: media_player.volume_set works without the speakers class', vs === true && volOk, J({ vs, vol0, now: await ev(k, `window.__card.hass.states['${ENT}']?.attributes?.volume_level`) }));
  const mu = await ev(k, `window.__card.hass.callService('media_player', 'volume_mute', { is_volume_muted: true }, { entity_id: '${ENT}' }).then(() => true, (e) => String(e?.code ?? e))`);
  const muted = await wait(k, `window.__card.hass.states['${ENT}']?.attributes?.is_volume_muted === true`, 10000);
  const un = await ev(k, `window.__card.hass.callService('media_player', 'volume_mute', { is_volume_muted: false }, { entity_id: '${ENT}' }).then(() => true, (e) => String(e?.code ?? e))`);
  check('U13 kiosk user: media_player.volume_mute on/off works', mu === true && muted && un === true, J({ mu, muted, un }));
  if (vol0 !== undefined) await ev(k, `window.__card.hass.callService('media_player', 'volume_set', { volume_level: ${vol0} }, { entity_id: '${ENT}' })`);
  await ev(k, `window.__card._spk = true`); await sleep(900);
  const mix = await ev(k, `(() => { const r = ${C}.querySelector('jb-speakers')?.shadowRoot; return { mode: r?.querySelector('.sheet')?.dataset.mode, sliders: [...(r?.querySelectorAll('jb-slider') ?? [])].filter((s) => !s.disabled).length, acts: r?.querySelectorAll('.act').length ?? -1, chips: r?.querySelectorAll('[data-target]').length ?? -1 }; })()`);
  check('U14 kiosk user: Speakers panel shows an enabled volume mixer and no grouping controls', mix.sliders >= 1 && mix.acts === 0 && mix.chips === 0, J(mix));
  const notListed = await wsCall(k, { type: 'jukebox_kiosk/ma', command: 'config/providers/remove', args: { instance_id: 'x' } });
  check('U8 a non-allowlisted MA command is refused', !notListed.ok && notListed.e === 'not_allowed', J(notListed));
  const q = await wsCall(k, { type: 'jukebox_kiosk/queue_items', entity_id: ENT, limit_before: 0, limit_after: 3 });
  check('U9 kiosk user may read the queue', q.ok, J(q.e ?? ''));
  check('U10 no page errors for the kiosk user', k.__logs.filter((l) => /PAGEERROR|jukebox/i.test(l)).length === 0, J(k.__logs.slice(0, 3)));
  await k.close();
}
// ---------------- 8. double-load: the integration's URL plus a manual resource with a second copy ----------------
{
  const copy = `${DIR}/ha-config/www/jukebox-card.js`;
  fs.mkdirSync(`${DIR}/ha-config/www`, { recursive: true });
  fs.copyFileSync(new URL('../../custom_components/jukebox_kiosk/www/jukebox-card.js', import.meta.url), copy);
  const made = await wsCall(p, { type: 'lovelace/resources/create', res_type: 'module', url: '/local/jukebox-card.js' });
  try {
    const d = await open('admin');
    const info = await ev(d, `({ card: !!window.__card?.shadowRoot?.querySelector('.tab'), backend: window.__card?.dataset.backend,
      errCard: !!(${FIND.replace("'jukebox-card'", "'hui-error-card'")}),
      scripts: [...document.querySelectorAll('script[src*="jukebox-card.js"]')].map((x) => new URL(x.src).pathname) })`);
    await tab(d, 'queue'); await sleep(1200); await tab(d, 'now'); await sleep(600);
    const bad = d.__logs.filter((l) => /PAGEERROR|jukebox|jb-|already been (used|defined)/i.test(l));
    check('D1 double-load (integration URL + /local copy): the card still renders on the kiosk backend', made.ok && info.card && !info.errCard && info.backend === 'kiosk', J({ made: made.ok, ...info }));
    check('D2 double-load: no console errors, warnings or page errors from the card', bad.length === 0, J(bad.slice(0, 4)));
    await d.close();
  } finally {
    if (made.ok) await wsCall(p, { type: 'lovelace/resources/delete', resource_id: made.r.id });
    fs.rmSync(copy, { force: true });
  }
}
check('Z1 no jukebox console errors / page errors (admin run)', adminLogs.filter((l) => /PAGEERROR|jukebox|jb-/i.test(l)).length === 0, J(adminLogs.slice(0, 4)));
await p.close();
await browser.close();
console.log(`\n${total - failures}/${total} real-HA checks passed`);
process.exit(failures ? 1 : 0);

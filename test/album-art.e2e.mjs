// #147: album art at 1024x600 (touch, mouse, physical keyboard). A picture that fails to load hides only that picture: the
// next song (or a row's new picture) shows again. Now Playing, full screen and the screensaver fall back from HA's proxy copy
// to the queue item's picture, then to the placeholder they show today with no art; each source is loaded at most once per song
// (counted here per URL), with no retry on hass updates, tab switches or re-renders. Queue and search rows: a failed picture
// does not hide the next picture shown in that row. Usage: node test/album-art.e2e.mjs (starts its own dev server)
import puppeteer from 'puppeteer-core';
import { hermetic, svgFor } from './intercept.mjs';
import { devIndex } from './serve.mjs';

const BASE = await devIndex();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failures = 0;
const check = (name, ok, info = '') => { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const J = JSON.stringify;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const EV = 'media_player.everywhere';
const NP = `__card.shadowRoot.querySelector('jb-now').shadowRoot`;
const QV = `__card.shadowRoot.querySelector('jb-queue').shadowRoot`;
const SV = `__card.shadowRoot.querySelector('jb-search').shadowRoot`;
const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
const BAD = (tag) => `/api/media_player_proxy/${EV}?token=mock&cache=bad-${tag}`;
const GOOD = (tag) => `/api/media_player_proxy/${EV}?token=mock&cache=good-${tag}`;
const QIMG = (tag) => `https://art147.example/${tag}.svg`;

/** Pictures whose URL has "bad" answer 404; every request is counted per URL. */
async function open(query) {
  const p = await browser.newPage();
  p.__count = {};
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (req.isInterceptResolutionHandled?.()) return;
    const u = new URL(req.url());
    const mine = u.hostname === 'art147.example' || /cache=(bad|good)-/.test(u.search) || u.pathname.startsWith('/art147/');
    if (!mine) return;
    p.__count[u.pathname + u.search] = (p.__count[u.pathname + u.search] ?? 0) + 1;
    if (/bad/.test(u.href)) return req.respond({ status: 404, body: 'gone' });
    return req.respond({ status: 200, contentType: 'image/svg+xml', body: svgFor(u.href, '') });
  });
  await hermetic(p);
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true });
  await p.goto(`${BASE}?fresh=1&latency=20&kiosk=1${query}`);
  await p.waitForFunction('window.__ready === true');
  await sleep(800);
  return p;
}
const n = (p, url) => p.__count[new URL(url, 'https://art147.example').pathname + new URL(url, 'https://art147.example').search] ?? 0;
/** A new song on the player (not the queue's current item unless `uri` is), with this proxy picture. */
const song = (p, title, uri, pic) => ev(p, `__setNowPlaying({ title: ${J(title)}, artist: 'Test', radio: false, uri: ${J(uri)}, duration: 200 }); __setAttrs(${J(EV)}, { entity_picture_local: ${J(pic)} })`);
/** The queue's current item gets this picture, and is what the player plays now (new title = new song). */
const curSong = (p, title, img, pic) => ev(p, `(async () => { const it = __queue.items[__queue.index]; it._t.image = ${J(img)}; __kioskPush(); await new Promise((r) => setTimeout(r, 500));
  __setNowPlaying({ title: ${J(title)}, artist: 'Test', radio: false, uri: it._t.uri, duration: 200 }); __setAttrs(${J(EV)}, { entity_picture_local: ${J(pic)} }); })()`);
const npArt = (p) => ev(p, `(() => { const a = ${NP}.querySelector('.art'); const im = a.querySelector('img'); return { img: im ? { src: im.getAttribute('src'), shown: getComputedStyle(im).display !== 'none', w: im.naturalWidth } : null, ph: !!a.querySelector('.ph') }; })()`);
const ambBg = (p) => ev(p, `(() => { const b = __card.shadowRoot.querySelector('.amb .sv-bg'); return b ? { cls: b.className, style: b.getAttribute('style') || '' } : null; })()`);
const hassUpdates = async (p) => { for (let i = 0; i < 6; i++) { await ev(p, `__setAttrs(${J(EV)}, { volume_level: ${0.3 + i / 20} })`); await sleep(120); } };
async function tapTab(p, name) {
  const c = await center(p, `[...__card.shadowRoot.querySelectorAll('nav button, .tabs button, [role="tab"]')].find((b) => (b.dataset.tab ?? b.textContent).trim().toLowerCase().startsWith(${J(name)}))`);
  if (!c) throw new Error('no tab ' + name);
  await p.touchscreen.tap(c.x, c.y); await sleep(500);
}

// ---------------- Now Playing (touch) ----------------
{
  const p = await open('&tab=now');
  await song(p, 'Bad One', 'library://track/x1', BAD('1')); await sleep(900);
  let a = await npArt(p);
  check('NP1 proxy picture fails, no queue picture for this song: the disc placeholder, no hidden <img> left', !a.img && a.ph, J(a));
  await hassUpdates(p); await tapTab(p, 'queue'); await tapTab(p, 'now'); await sleep(500);
  check('NP2 the failed picture was loaded once (hass updates and a tab switch do not retry it)', n(p, BAD('1')) === 1, String(n(p, BAD('1'))));
  await song(p, 'Good Two', 'library://track/x2', GOOD('2')); await sleep(900);
  a = await npArt(p);
  check('NP3 next song with a good picture: it shows again', !!a.img && a.img.shown && a.img.w > 0 && a.img.src === GOOD('2'), J(a));
  await curSong(p, 'Three', QIMG('q3'), BAD('3')); await sleep(1200);
  a = await npArt(p);
  check('NP4 proxy picture fails: falls back to the queue item\'s picture', !!a.img && a.img.shown && a.img.w > 0 && a.img.src === QIMG('q3'), J(a));
  await curSong(p, 'Four', QIMG('bad-q4'), BAD('4')); await sleep(1500);
  a = await npArt(p);
  check('NP5 proxy and queue pictures both fail: the disc placeholder', !a.img && a.ph, J(a));
  await hassUpdates(p); await sleep(800);
  // the queue list's own row for this item shows the same picture (its own, separate place): count that row's load apart
  const rows = await ev(p, `(() => { const all = []; const walk = (r) => { for (const el of r.querySelectorAll('*')) { if (el.tagName === 'IMG' && el.getAttribute('src') === ${J(QIMG('bad-q4'))} && !el.closest('.art')) all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(__card.shadowRoot); return all.length; })()`);
  check('NP6 each failed source was loaded exactly once for the song by Now Playing (plus once per list row showing it)', n(p, BAD('4')) === 1 && n(p, QIMG('bad-q4')) === 1 + rows, J({ proxy: n(p, BAD('4')), queue: n(p, QIMG('bad-q4')), rows }));
  // ---- full screen (mouse click on the Full screen button, physical Esc to close) ----
  await song(p, 'Bad Five', 'library://track/x5', BAD('5')); await sleep(900);
  const st = await center(p, `${NP}.querySelector('.ab.stg')`);
  await p.mouse.click(st.x, st.y); await sleep(1200);
  let b = await ambBg(p);
  check('FS1 full screen, the song\'s only picture failed: the no-art background it shows today', !!b && /noart/.test(b.cls), J(b));
  check('FS2 full screen did not load the failed picture again', n(p, BAD('5')) === 1, String(n(p, BAD('5'))));
  await song(p, 'Good Six', 'library://track/x6', GOOD('6')); await sleep(1200);
  b = await ambBg(p);
  check('FS3 full screen, next song with a good picture: it shows', !!b && !/noart/.test(b.cls) && b.style.includes(GOOD('6')), J(b));
  await p.keyboard.press('Escape'); await sleep(700);
  check('FS4 Esc closes full screen', !(await ev(p, `!!__card.shadowRoot.querySelector('.amb')`)));
  check('NP7 no page errors', p.errs.length === 0, J(p.errs));
  await p.close();
}

// ---------------- screensaver ----------------
{
  const p = await open('&tab=now&saver=0.02');
  await song(p, 'Bad One', 'library://track/s1', BAD('s1'));
  await p.waitForFunction(() => !!window.__card.shadowRoot.querySelector('.amb'), { timeout: 8000 }).catch(() => {});
  await sleep(1500);
  let b = await ambBg(p);
  check('SS1 screensaver, the song\'s only picture failed: the no-art background', !!b && /noart/.test(b.cls), J(b));
  await hassUpdates(p); await sleep(500);
  check('SS2 the failed picture was loaded once (screensaver and Now Playing together)', n(p, BAD('s1')) === 1, String(n(p, BAD('s1'))));
  await song(p, 'Good Two', 'library://track/s2', GOOD('s2')); await sleep(1200);
  b = await ambBg(p);
  check('SS3 screensaver, next song with a good picture: it shows', !!b && !/noart/.test(b.cls) && b.style.includes(GOOD('s2')), J(b));
  await curSong(p, 'Three', QIMG('sq3'), BAD('s3')); await sleep(1500);
  b = await ambBg(p);
  check('SS4 screensaver, proxy picture fails: the queue item\'s picture', !!b && b.style.includes(QIMG('sq3')), J(b));
  check('SS5 each source loaded at most once for the song', n(p, BAD('s3')) === 1 && n(p, QIMG('sq3')) <= 1, J({ proxy: n(p, BAD('s3')), queue: n(p, QIMG('sq3')) }));
  check('SS6 no page errors', p.errs.length === 0, J(p.errs));
  await p.close();
}

// ---------------- queue rows ----------------
{
  const p = await open('&tab=queue');
  const idx = 4;
  const rowImg = `${QV}.querySelectorAll('.qr')[${idx}]?.querySelector('.ar img')`;
  await ev(p, `__queue.items[${idx}]._t.image = '/art147/bad-row.svg'; __kioskPush()`); await sleep(1200);
  const before = await ev(p, `(() => { const i = ${rowImg}; return i ? { src: i.getAttribute('src'), shown: getComputedStyle(i).display !== 'none' } : null; })()`);
  check('Q1 a queue row whose picture fails hides only that picture', !!before && before.src === '/art147/bad-row.svg' && !before.shown, J(before));
  await ev(p, `__queue.items[${idx}]._t.image = '/art147/good-row.svg'; __kioskPush()`); await sleep(1200);
  const after = await ev(p, `(() => { const i = ${rowImg}; return i ? { src: i.getAttribute('src'), shown: getComputedStyle(i).display !== 'none', w: i.naturalWidth } : null; })()`);
  check('Q2 the same row then gets a good picture: it shows', !!after && after.src === '/art147/good-row.svg' && after.shown && after.w > 0, J(after));
  // a touch swipe over the list re-renders nothing that retries the failed picture
  const c = await center(p, `${QV}.querySelector('.scroll')`);
  await p.touchscreen.touchStart(c.x, c.y + 100); await p.touchscreen.touchMove(c.x, c.y - 60); await p.touchscreen.touchEnd(); await sleep(400);
  check('Q3 the failed row picture was loaded once', n(p, '/art147/bad-row.svg') === 1, String(n(p, '/art147/bad-row.svg')));
  check('Q4 no page errors', p.errs.length === 0, J(p.errs));
  await p.close();
}

// ---------------- search rows (physical keyboard) ----------------
{
  const p = await open('&tab=browse');
  await ev(p, `(() => { const t = __queue.items.find((x) => x._t.name === 'Teardrop')._t; window.__t147 = t; t.image = '/art147/bad-search.svg'; })()`);
  const qb = await center(p, `${SV}.querySelector('.qbar')`); await p.mouse.click(qb.x, qb.y); await sleep(300);
  await p.keyboard.type('TEARDROP', { delay: 40 }); await sleep(800);
  const tracksBtn = `[...${SV}.querySelectorAll('button')].find((x) => /^\\s*tracks\\s*$/i.test(x.textContent))`;
  const tb = await center(p, tracksBtn); if (tb) await p.touchscreen.tap(tb.x, tb.y);
  const row = `[...${SV}.querySelectorAll('.row[data-type="track"]')].find((r) => /Teardrop/.test(r.textContent))`;
  await p.waitForFunction((r) => !!eval(r), { timeout: 8000 }, row).catch(() => {}); await sleep(800);
  const s1 = await ev(p, `(() => { const r = ${row}; const i = r?.querySelector('.ar img'); return i ? { src: i.getAttribute('src'), shown: getComputedStyle(i).display !== 'none' } : { row: !!r }; })()`);
  check('SR1 a search row whose picture fails hides only that picture', s1.src === '/art147/bad-search.svg' && s1.shown === false, J(s1));
  await ev(p, `window.__t147.image = '/art147/good-search.svg'`);
  await p.keyboard.press('Backspace'); await sleep(1500);
  await p.waitForFunction((r) => !!eval(r), { timeout: 8000 }, row).catch(() => {}); await sleep(800);
  const s2 = await ev(p, `(() => { const r = ${row}; const i = r?.querySelector('.ar img'); return i ? { src: i.getAttribute('src'), shown: getComputedStyle(i).display !== 'none', w: i.naturalWidth } : { row: !!r }; })()`);
  check('SR2 the row then shows a good picture', s2.src === '/art147/good-search.svg' && s2.shown && s2.w > 0, J(s2));
  check('SR3 no page errors', p.errs.length === 0, J(p.errs));
  await p.close();
}

await browser.close();
console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures ? 1 : 0);

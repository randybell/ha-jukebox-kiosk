// #106: adding the Jukebox card to a new dashboard never hard-codes media_player.everywhere.
// A new card uses Home Assistant's stub config (the first Music Assistant player, or nothing).
// With no entity, setConfig throws the same error as HA's media-control card, and no service
// is sent to everywhere. Usage: node test/new-dashboard.e2e.mjs (starts its own dev server).
import puppeteer from 'puppeteer-core';
import { hermetic } from './intercept.mjs';
import { devIndex, devRoot } from './serve.mjs';

const BASE = await devIndex();
const ROOT = await devRoot();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
let failures = 0, total = 0;
const pageErrors = [];
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const EV = 'media_player.everywhere';
const GARAGE = 'media_player.garage';
const ev = (p, e) => p.evaluate((e) => eval(e), e);
const wait = (p, fn, timeout = 5000) => p.waitForFunction(fn, { timeout, polling: 40 }).then(() => true, () => false);
const VP = { width: 1024, height: 600, deviceScaleFactor: 1, hasTouch: true };

async function open(q = '', page = 'index.html') {
  const p = await browser.newPage();
  await hermetic(p);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.setViewport(VP);
  const url = page === 'index.html' ? `${BASE}?fresh=1&latency=30${q}` : `${ROOT}${page}?fresh=1&latency=30${q}`;
  await p.goto(url);
  await p.waitForFunction(page === 'index.html' ? 'window.__ready === true' : '!!window.__editor?.shadowRoot?.querySelector("ha-form")');
  await sleep(200);
  return p;
}

{
  const p = await open('&stub=1');
  const stub = await ev(p, `customElements.get('jukebox-card').getStubConfig(__card.hass)`);
  check('N1 default mock stub is the first Music Assistant player (Everywhere is first in this mock registry)',
    J(stub) === J({ entity: EV }), J(stub));
  const garageFirst = await ev(p, `(() => {
    const h = __card.hass;
    const entities = {};
    for (const id of ['${GARAGE}', '${EV}', 'media_player.living_room', 'media_player.kitchen']) {
      if (h.entities[id]) entities[id] = h.entities[id];
    }
    for (const [id, ent] of Object.entries(h.entities)) if (!(id in entities)) entities[id] = ent;
    return customElements.get('jukebox-card').getStubConfig({ states: h.states, entities });
  })()`);
  check('N2 stub follows registry order: when garage is first, the new card starts on garage, not everywhere',
    J(garageFirst) === J({ entity: GARAGE }), J(garageFirst));
  const none = await ev(p, `J = JSON.stringify, J(customElements.get('jukebox-card').getStubConfig({ states: {}, entities: {} }))`);
  check('N3 no Music Assistant player → empty stub {}', none === '{}', none);
  const nonMa = await ev(p, `customElements.get('jukebox-card').getStubConfig({
    states: { 'media_player.tv': { entity_id: 'media_player.tv', state: 'idle', attributes: {} } },
    entities: { 'media_player.tv': { entity_id: 'media_player.tv', platform: 'cast' } },
  })`);
  check('N4 a non-Music Assistant media_player is not used as the stub', J(nonMa) === '{}', J(nonMa));

  const thrown = await ev(p, `(() => {
    const el = document.createElement('jukebox-card');
    const out = { errors: [], entity: el._config?.entity ?? null };
    for (const cfg of [{ type: 'custom:jukebox-card' }, { type: 'custom:jukebox-card', entity: '' }, { type: 'custom:jukebox-card', entity: 'light.kitchen' }]) {
      try { el.setConfig(cfg); out.errors.push('ok'); }
      catch (e) { out.errors.push(e.message); }
    }
    out.entityAfter = el._config?.entity ?? null;
    return out;
  })()`);
  const expectMsg = 'Specify an entity from within the media_player domain';
  check('N5 setConfig without a media_player entity throws the Home Assistant media-control error, and never stores everywhere',
    thrown.errors.every((e) => e === expectMsg) && thrown.entityAfter == null, J(thrown));

  const noTarget = await ev(p, `(() => {
    const n0 = window.__calls.length;
    const el = document.createElement('jukebox-card');
    let threw = false;
    try { el.setConfig({ type: 'custom:jukebox-card' }); } catch (e) { threw = true; }
    el.hass = __card.hass;
    const after = window.__calls.slice(n0).filter((c) => (c.target?.entity_id ?? c.data?.entity_id) === '${EV}');
    return { threw, after: after.length, entity: el._config?.entity ?? null, extra: window.__calls.length - n0 };
  })()`);
  check('N6 an unconfigured card never sends a service to media_player.everywhere',
    noTarget.threw && noTarget.after === 0 && noTarget.entity == null && noTarget.extra === 0, J(noTarget));

  const missing = await ev(p, `(() => {
    const el = document.createElement('jukebox-card');
    el.setConfig({ type: 'custom:jukebox-card', entity: 'media_player.does_not_exist' });
    el.hass = { ...__card.hass, states: { ...__card.hass.states }, localize: (k, a, b) => k === 'ui.panel.lovelace.warning.entity_not_found' ? 'Entity not available: ' + ((a && a.entity) || b) : k };
    delete el.hass.states['media_player.does_not_exist'];
    document.body.append(el);
    return el.updateComplete.then(() => {
      const w = el.shadowRoot.querySelector('hui-warning');
      const text = (w?.textContent ?? el.shadowRoot.textContent ?? '').replace(/\\s+/g, ' ').trim();
      const pill = !!el.shadowRoot.querySelector('.pill');
      el.remove();
      return { text, pill, hasWarning: !!w };
    });
  })()`);
  check('N7 a configured entity that is not found shows the Home Assistant standard warning, not the kiosk and not Everywhere',
    missing.hasWarning && /Entity not available: media_player.does_not_exist/.test(missing.text) && !missing.pill && !/Everywhere/.test(missing.text), J(missing));

  // New dashboard (stub=1): the card is already configured from getStubConfig. Interact with mouse and tap at 1024x600.
  const ent = await ev(p, `__card._config.entity`);
  check('N8 new dashboard (stub=1) used the first Music Assistant player from the mock (a real player, not a silent default)',
    ent === EV, ent);
  const pill = await ev(p, `__card.shadowRoot.querySelector('.pill .pn')?.textContent.trim()`);
  check('N9 the header pill uses the player friendly name', pill === 'Everywhere', pill);

  const tab = async (how) => {
    const r = await ev(p, `(() => { const el = __card.shadowRoot.querySelector('.tab[data-tab="browse"]'); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (how === 'mouse') await p.mouse.click(r.x, r.y);
    else await p.touchscreen.tap(r.x, r.y);
    await sleep(200);
    return ev(p, `__card._tab`);
  };
  const byMouse = await tab('mouse');
  await ev(p, `__card._tab = 'now'; __card.requestUpdate()`); await sleep(150);
  const byTap = await tab('tap');
  check('N10 at 1024x600 a new card accepts a mouse click and a tap on Library',
    byMouse === 'browse' && byTap === 'browse', J({ byMouse, byTap }));
  await p.close();
}

{
  // Editor: stub=1 with no hass → empty entity, never filled with everywhere.
  const p = await open('&stub=1', 'editor.html');
  const cfg = await ev(p, `__editor._config`);
  const field = await ev(p, `__editor.shadowRoot.querySelector('ha-form [data-name=entity] input')?.value`);
  check('N11 editor from an empty stub does not default the player to media_player.everywhere',
    cfg && cfg.entity == null && (field === '' || field == null) && J(cfg) === J({ type: 'custom:jukebox-card' }), J({ cfg, field }));
  await p.close();
}

{
  const p = await open(`&cfg=${encodeURIComponent(J({ type: 'custom:jukebox-card', entity: GARAGE }))}`, 'editor.html');
  const cfg = await ev(p, `__editor._config`);
  const field = await ev(p, `__editor.shadowRoot.querySelector('ha-form [data-name=entity] input')?.value`);
  check('N12 editor keeps a stub that picked a non-everywhere player',
    cfg.entity === GARAGE && field === GARAGE, J({ cfg, field }));
  await p.close();
}

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
await browser.close();
console.log(`\n${total - failures}/${total} new-dashboard checks passed`);
process.exit(failures ? 1 : 0);

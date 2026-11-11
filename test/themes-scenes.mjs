// The screens and pop-ups the theme tests and screenshot runs visit (one scene = one URL query plus the taps that open it).
import { sleep } from './themes-lib.mjs';
export const C = `__card.shadowRoot`;
const SV = `${C}.querySelector('jb-search')?.shadowRoot`;
const BRC = `${SV}?.querySelector('jb-browse')?.shadowRoot`;
const QV = `${C}.querySelector('jb-queue')?.shadowRoot`;
const HS = `${C}.querySelector('jb-hold-sheet')?.shadowRoot`;
export const ev = (p, e) => p.evaluate((x) => eval(x), e);
const center = (p, expr) => p.evaluate((e) => { const el = eval(e); if (!el) return null; el.scrollIntoView?.({ block: 'nearest' }); const r = el.getBoundingClientRect(); if (r.width < 1) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, expr);
async function tap(p, expr, wait = 450) { const c = await center(p, expr); if (!c) throw new Error('no target: ' + expr.slice(0, 90)); await p.touchscreen.tap(c.x, c.y); await sleep(wait); }
async function hold(p, expr, ms = 800) { const c = await center(p, expr); if (!c) throw new Error('no hold target'); await p.touchscreen.touchStart(c.x, c.y); await sleep(ms); await p.touchscreen.touchEnd(); await sleep(500); }
const key = (id) => `[...${SV}.querySelector('jb-keyboard').shadowRoot.querySelectorAll('[data-key="k-${id}"]')].find((k) => k.getBoundingClientRect().width > 0)`;
const togg = `[...${SV}.querySelector('jb-keyboard').shadowRoot.querySelectorAll('[data-key="k-toggle-n"],[data-key="k-toggle-w"]')].find((k) => k.getBoundingClientRect().width > 0)`;
const LIBQ = '&lhome=0&tab=browse&layout=combined&radio=1';
const CATS = encodeURIComponent(JSON.stringify({ library_categories: ['playlist', 'artist', 'album', 'track', 'radio'] }));
const cat = (c) => `${SV}.querySelectorAll('.lcats .fc.lc')[${c}]`;
const WALK = () => {
  const out = new Map();
  const lab = (el) => { const cls = [...el.classList].slice(0, 3).join('.'); return el.tagName.toLowerCase() + (cls ? '.' + cls : ''); };
  const path = (el) => { const parts = []; let n = el; for (let i = 0; n && i < 5; i++) { parts.unshift(lab(n)); const p = n.parentElement; n = p || (n.getRootNode()?.host ? n.getRootNode().host : null); if (n && n.tagName === 'BODY') break; } return parts.join(' > '); };
  const walk = (root) => { for (const el of root.querySelectorAll('*')) { visit(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  const visit = (el) => {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return;
    const rec = {}; const add = (k, v) => { if (v) rec[k] = v; };
    const col = (v) => v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent' ? v : '';
    add('bg', col(s.backgroundColor)); add('color', el.childNodes && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ? s.color : '');
    if (el.tagName === 'svg' || el.closest?.('svg')) add('icon', s.color);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] !== 'none') { add('border', col(s['border' + side + 'Color'])); break; }
    if (s.boxShadow && s.boxShadow !== 'none') add('shadow', s.boxShadow);
    if (s.backgroundImage && s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url')) add('bgimg', s.backgroundImage.slice(0, 140));
    if (s.backdropFilter && s.backdropFilter !== 'none') add('backdrop', s.backdropFilter);
    if (!Object.keys(rec).length) return;
    const k = path(el); out.set(k, { ...(out.get(k) || {}), ...rec, w: Math.round(r.width), h: Math.round(r.height) });
  };
  walk(document); return [...out.entries()];
};
export async function probe(p) { return p.evaluate(`(${WALK.toString()})()`); }
export const SCENES = {
  'now': { q: '&tab=now' },
  'now-idle-noart': { q: '&tab=now&idle=1' },
  'now-bd-light': { q: '&tab=now&backdrop=light' },
  'now-bd-static': { q: '&tab=now&backdrop=static' },
  'now-bd-off': { q: '&tab=now&backdrop=off' },
  'now-lyrics-overlay': { q: '&tab=now&overlay=1' },
  'speakers-picker': { q: '&tab=now', act: async (p) => { await tap(p, `${C}.querySelector('.pill')`); } },
  'library-home': { q: '&tab=browse&layout=combined&radio=1&cfg=' + CATS },
  'lib-playlists-tiles': { q: LIBQ },
  'lib-playlists-rows': { q: LIBQ + '&legacy=0' },
  'lib-artists': { q: LIBQ + '&cfg=' + CATS, act: async (p) => { await tap(p, cat(1)); } },
  'lib-albums': { q: LIBQ + '&cfg=' + CATS, act: async (p) => { await tap(p, cat(2)); } },
  'lib-tracks-rows': { q: LIBQ + '&cfg=' + CATS, act: async (p) => { await tap(p, cat(3)); await ev(p, `__card._config.library_view`); } },
  'lib-radio': { q: LIBQ + '&cfg=' + CATS, act: async (p) => { await tap(p, cat(4)); } },
  'lib-favorites': { q: LIBQ, act: async (p) => { await tap(p, `${SV}.querySelector('.cn[data-action="lib-fav"], button.cn')`); } },
  'lib-all-sources': { q: LIBQ, act: async (p) => { await tap(p, `${SV}.querySelector('.srct')`); } },
  'lib-keyboard-123': { q: LIBQ, act: async (p) => { await tap(p, togg); } },
  'lib-search-results': { q: LIBQ, act: async (p) => { for (const k of ['M', 'I']) await tap(p, key(k), 150); await sleep(900); } },
  'lib-search-empty': { q: LIBQ, act: async (p) => { for (const k of ['Z', 'Q', 'X']) await tap(p, key(k), 150); await sleep(900); } },
  'detail-playlist': { q: LIBQ, act: async (p) => { await tap(p, `${BRC}.querySelector('.tile .mo.open, .tile')`); await sleep(500); } },
  'detail-artist': { q: LIBQ + '&cfg=' + CATS, act: async (p) => { await tap(p, cat(1)); await tap(p, `${BRC}.querySelector('.tile .mo.open, .tile')`); await sleep(600); } },
  'detail-album': { q: LIBQ + '&cfg=' + CATS, act: async (p) => { await tap(p, cat(2)); await tap(p, `${BRC}.querySelector('.tile .mo.open, .tile')`); await sleep(600); } },
  'track-popup': { q: LIBQ + '&legacy=0&cfg=' + CATS, act: async (p) => { await tap(p, cat(3)); await sleep(500); await tap(p, `${BRC}.querySelector('.row')`); await sleep(500); } },
  'track-popup-moreinfo': { q: LIBQ + '&legacy=0&cfg=' + CATS, act: async (p) => { await tap(p, cat(3)); await sleep(500); await tap(p, `${BRC}.querySelector('.row')`); await tap(p, `${HS}.querySelector('.it[data-action="more"]')`); } },
  'station-sheet': { q: '&tab=browse&lhome=0&radio=1', act: async (p) => { await ev(p, `(() => { const it = { uri: 'library://radio/1', name: 'Neon FM', media_type: 'radio', image: '', metadata: { description: 'A late-night station.' } }; ${C}.querySelector('jb-browse, jb-search').dispatchEvent(new CustomEvent('jukebox-station', { detail: { item: it }, bubbles: true, composed: true })); })()`); await sleep(500); } },
  'queue': { q: '&tab=queue&kcaps=' + encodeURIComponent(JSON.stringify({ autoplay: true, autoplay_mode: true })) },
  'queue-popup': { q: '&tab=queue', act: async (p) => { await tap(p, `${QV}.querySelector('.qr.next .rt, .qr .rt')`); await sleep(500); } },
  'queue-more-menu': { q: '&tab=queue', act: async (p) => { await tap(p, `${QV}.querySelector('.qr .qa.mo')`); } },
  'queue-autoplay': { q: '&tab=queue&kcaps=' + encodeURIComponent(JSON.stringify({ autoplay: true, autoplay_mode: true })), act: async (p) => { await tap(p, `${QV}.querySelector('[data-action="autoplay-mode"]')`); } },
  'queue-search': { q: '&tab=queue', act: async (p) => { await tap(p, `${QV}.querySelector('.qsearch')`); await sleep(600); const kb = `[...${QV}.querySelector('.qkbd').shadowRoot.querySelectorAll('[data-key="k-M"]')].find((k) => k.getBoundingClientRect().width > 0)`; await tap(p, kb, 200); await sleep(700); } },
};

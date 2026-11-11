// Shared by test/themes.e2e.mjs and tools/screenshots/theme-shots.mjs: opens the dev harness inside a real Home Assistant
// theme (default light, default dark) or one of two translucent dashboards (glass, wallpaper), with the real ha-card.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const D = new URL('../dev/themes/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, D), 'utf8');
export const LIGHT = read('ha-default-light.css');
export const DARK = read('ha-default-dark.css');
const HACARD = read('ha-card.css');
// HA defines --wa-shadow-l as the box-shadow token; the extracted values leave it out
const EXTRA = 'html { --wa-shadow-l: var(--ha-box-shadow-l); }';
/** translucent "glass" theme: translucent card, indigo primary, gradient page */
export const GLASS = `html {
  --primary-color: #6c73cc; --rgb-primary-color: 108,115,204;
  --card-background-color: rgba(255,255,255,0.45); --ha-card-background: rgba(255,255,255,0.45);
  --secondary-background-color: rgba(255,255,255,0.35); --primary-background-color: #dfe9ff;
  --primary-text-color: #171938; --rgb-primary-text-color: 23,25,56; --secondary-text-color: #4a4d7a;
  --ha-card-backdrop-filter: blur(12px); --ha-card-border-color: rgba(255,255,255,0.6);
  --input-fill-color: rgba(255,255,255,0.35); }
html, body { background-image: linear-gradient(135deg,#fdeef3,#dfe9ff 60%,#6c73cc) !important; }`;
/** dashboard with a wallpaper behind default-light cards that are 60% opaque (the usual "transparent cards" setup) */
export const WALLPAPER = `html {
  --ha-card-background: rgba(255,255,255,0.6); --card-background-color: rgba(255,255,255,0.6);
  --ha-card-backdrop-filter: blur(8px); --secondary-background-color: rgba(255,255,255,0.5); --input-fill-color: rgba(255,255,255,0.5); }
html, body { background-image: radial-gradient(circle at 20% 30%, #3a7d44 0, transparent 40%), radial-gradient(circle at 80% 20%, #c9432f 0, transparent 45%), radial-gradient(circle at 60% 85%, #1b3f73 0, transparent 50%), linear-gradient(160deg,#5b4636,#243b2a) !important; }`;
// every colour variable replaced with a unique value, so any painted colour that is NOT one of these is a fixed colour
export const SENT = {
  '--primary-text-color': [11, 22, 33], '--secondary-text-color': [44, 55, 66], '--primary-color': [77, 88, 99], '--accent-color': [60, 70, 80],
  '--text-primary-color': [111, 122, 133], '--card-background-color': [144, 155, 166], '--secondary-background-color': [177, 188, 199],
  '--primary-background-color': [160, 170, 180], '--divider-color': [200, 10, 20], '--outline-color': [201, 11, 21], '--disabled-text-color': [30, 40, 50],
  '--disabled-color': [31, 41, 51], '--error-color': [90, 100, 110], '--state-inactive-color': [50, 60, 70], '--mdc-dialog-scrim-color': [5, 6, 7],
  '--input-fill-color': [120, 130, 140], '--input-ink-color': [121, 131, 141], '--input-label-ink-color': [123, 133, 143], '--chip-background-color': [122, 132, 142],
  '--shadow-color': [8, 9, 10], '--dark-primary-color': [70, 80, 90], '--light-primary-color': [71, 81, 91],
  '--ha-color-neutral-10': [12, 13, 14], '--ha-color-on-neutral-loud': [15, 16, 17], '--sidebar-selected-icon-color': [77, 88, 99],
};
export const SENT_CSS = 'html {' + Object.entries(SENT).map(([k, v]) => `${k}: rgb(${v}); --rgb-${k.slice(2)}: ${v};`).join('')
  + '--ha-box-shadow-l: 0 2px 4px rgb(8, 9, 10); --ha-card-background: var(--card-background-color); --ha-dialog-surface-background: var(--card-background-color); --mdc-theme-surface: var(--card-background-color); }';
// noscrim: a theme that never defines HA's dialog dimmer variable; scrimnone: a theme that sets it to none on purpose
export const THEMES = { light: LIGHT, dark: LIGHT + DARK, glass: LIGHT + GLASS, wallpaper: LIGHT + WALLPAPER, sentinel: LIGHT + SENT_CSS,
  noscrim: LIGHT.replace('--ha-dialog-scrim-backdrop-filter: brightness(68%);', ''), scrimnone: LIGHT + 'html { --ha-dialog-scrim-backdrop-filter: none; }' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const launch = () => puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'] });
const DERIVE = ['primary-color', 'accent-color', 'primary-text-color', 'secondary-text-color', 'text-primary-color', 'card-background-color', 'secondary-background-color', 'primary-background-color'];
export async function openPage(browser, hermetic, BASE, theme, query, vp = { width: 1024, height: 712 }) {
  const page = await browser.newPage();
  await hermetic(page);
  await page.setViewport({ ...vp, deviceScaleFactor: 1, hasTouch: true });
  // the real ha-card (HA's own styles); the dev harness defines none
  await page.evaluateOnNewDocument((css) => {
    class HaCard extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = `<style>${css}</style><slot></slot>`; } }
    if (!customElements.get('ha-card')) customElements.define('ha-card', HaCard);
  }, HACARD);
  // every scene starts with the lyrics overlay off (the browser is shared, so an earlier scene's choice would leak into the next); a scene asks for it with &overlay=1
  await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('jukebox-card:lyrics-overlay:v1'); } catch {} });
  page._errs = []; page.on('pageerror', (e) => page._errs.push(e.message));
  await page.goto(`${BASE}?fresh=1&latency=20&kiosk=1${query}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready===true', { timeout: 30000 });
  await page.addStyleTag({ content: THEMES[theme] + '\n' + EXTRA + `\nbody { margin:0; background-color: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--ha-font-family-body); }\nhtml { background-color: var(--primary-background-color); color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }` });
  await page.evaluate((names, sent) => {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('i'); document.body.appendChild(probe);
    for (const n of names) {
      if (sent && cs.getPropertyValue('--rgb-' + n).trim()) continue;
      probe.style.color = `var(--${n})`; const m = getComputedStyle(probe).color.match(/[\d.]+/g);
      if (m) document.documentElement.style.setProperty('--rgb-' + n, m.slice(0, 3).join(','));
    }
    probe.remove();
  }, DERIVE, theme === 'sentinel');
  await page.evaluate(async () => { const c = window.__card; c?.requestUpdate?.(); if (c?.updateComplete) await c.updateComplete; });
  await sleep(700);
  return page;
}

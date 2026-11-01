/**
 * Custom element registration that survives Home Assistant swapping `window.customElements`.
 *
 * Home Assistant 2026.10 imports integration modules (`add_extra_js_url`) in parallel with its own app bundle. On
 * browsers without native scoped custom element registries the app bundle installs a registry polyfill and replaces
 * `window.customElements` with it. Elements this bundle defined before that swap live only in the native registry, so
 * Lovelace's `customElements.get('jukebox-card')` misses them and shows "Configuration error". Every element is
 * defined here, and when the registry object changes the same classes are defined again in the new one. A second copy
 * of the bundle (loaded from another URL) finds the names taken and does nothing.
 */
const defs: Array<[string, CustomElementConstructor]> = [];
let seen: CustomElementRegistry | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

/** How long to watch for a registry swap (ms) and how often (ms). Exported for tests. */
export const WATCH_MS = 60_000;
export const WATCH_EVERY_MS = 100;

function defineIn(reg: CustomElementRegistry) {
  for (const [name, cls] of defs) {
    if (reg.get(name)) continue;
    try {
      reg.define(name, cls);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`jukebox-card: could not define <${name}>`, e);
    }
  }
}

/** The Home Assistant app has booted: its own elements are in the current registry. */
const appReady = (reg: CustomElementRegistry) => !!reg.get('home-assistant-main') || !!reg.get('hui-view');

/** Re-check the registry now (also called by the watcher). Exported for tests. */
export function syncRegistry() {
  const reg = window.customElements;
  if (reg !== seen) {
    seen = reg;
    defineIn(reg);
  }
  if (timer !== undefined && appReady(reg)) {
    clearInterval(timer);
    timer = undefined;
  }
}

export function defineElement(name: string, cls: CustomElementConstructor) {
  defs.push([name, cls]);
  if (!window.customElements.get(name)) {
    try {
      window.customElements.define(name, cls);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`jukebox-card: could not define <${name}>`, e);
    }
  }
  if (seen === undefined) {
    seen = window.customElements;
    if (!appReady(seen)) {
      const until = Date.now() + WATCH_MS;
      timer = setInterval(() => {
        syncRegistry();
        if (timer !== undefined && Date.now() > until) {
          clearInterval(timer);
          timer = undefined;
        }
      }, WATCH_EVERY_MS);
    }
  }
}

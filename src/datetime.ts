import type { HomeAssistant } from './types';

/**
 * #107 / #108: times and dates the way Home Assistant's own frontend formats them (src/common/datetime: format_time.ts,
 * use_am_pm.ts, resolve-time-zone.ts, format_date.ts): the profile's language, its 12/24-hour setting (time_format
 * 'language' | 'system' | '12' | '24') and its time zone (time_zone 'local' = this browser's zone, 'server' = HA's
 * config.time_zone; HA uses the server zone when the browser's zone can't be read).
 */
type Locale = NonNullable<HomeAssistant['locale']>;

/** HA's useAmPm: 'language' and 'system' test how 22:00 is written (in the profile language, or the browser's own). */
export function useAmPm(locale: Locale | undefined): boolean {
  const tf = locale?.time_format;
  if (!tf || tf === 'language' || tf === 'system') {
    const lang = tf === 'system' ? undefined : locale?.language;
    let test = '';
    try { test = new Date('January 1, 2023 22:00:00').toLocaleString(lang); } catch { test = new Date('January 1, 2023 22:00:00').toLocaleString(); }
    return test.includes('10');
  }
  return tf === '12';
}

/** The browser's IANA zone, or undefined when it can't be read (HA then uses the server's zone). */
function browserZone(): string | undefined {
  try {
    const z = Intl.DateTimeFormat?.().resolvedOptions?.().timeZone;
    return z && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)*$/.test(z) ? z : undefined;
  } catch { return undefined; }
}

/** HA's resolveTimeZone: 'local' (and no setting) = the browser's zone when known; otherwise HA's config.time_zone. */
export function resolveTimeZone(hass: HomeAssistant | undefined): string | undefined {
  const local = browserZone();
  const opt = hass?.locale?.time_zone ?? 'local';
  return opt === 'local' && local ? local : hass?.config?.time_zone || undefined;
}

export const haLanguage = (hass: HomeAssistant | undefined) => hass?.locale?.language || hass?.language || undefined;

/** A formatter with HA's language and time zone; an unknown language or zone falls back to the browser's. */
function fmt(hass: HomeAssistant | undefined, opts: Intl.DateTimeFormatOptions, lang = haLanguage(hass), zone?: string): Intl.DateTimeFormat {
  const timeZone = zone ?? resolveTimeZone(hass);
  for (const [l, tz] of [[lang, timeZone], [lang, undefined], [undefined, timeZone], [undefined, undefined]] as const) {
    try { return new Intl.DateTimeFormat(l, { ...opts, ...(tz ? { timeZone: tz } : {}) }); } catch { /* try the next */ }
  }
  return new Intl.DateTimeFormat();
}

/** HA's formatTime: "9:15 PM" or "21:15". */
export function formatTime(d: Date, hass: HomeAssistant | undefined): string {
  return fmt(hass, { hour: 'numeric', minute: '2-digit', hourCycle: useAmPm(hass?.locale) ? 'h12' : 'h23' }).format(d);
}
/** HA's formatDateWeekdayDay: "Tuesday, August 10". */
export function formatDateWeekdayDay(d: Date, hass: HomeAssistant | undefined): string {
  return fmt(hass, { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}
/** HA's formatDateShort: "Aug 10, 2021". `fallbackLang` is used only when hass has no language.
 *  #108: a date-only value (`d` is UTC midnight of that calendar date) is shown as written, with no time-zone shift. */
export function formatDateShort(d: Date, hass: HomeAssistant | undefined, fallbackLang?: string, dateOnly = false): string {
  return fmt(hass, { year: 'numeric', month: 'short', day: 'numeric' }, haLanguage(hass) ?? fallbackLang, dateOnly ? 'UTC' : undefined).format(d);
}

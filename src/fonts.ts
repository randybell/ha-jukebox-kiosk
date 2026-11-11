/**
 * Built-in Home Assistant cards do not ship or inject Inter / Plus Jakarta Sans.
 * The card now uses the theme font families (--ha-font-family-body / --ha-font-family-heading).
 * This function stays as a no-op so existing font_base config still type-checks.
 */
export function ensureFonts(_base: string | false | undefined) {
  return;
}

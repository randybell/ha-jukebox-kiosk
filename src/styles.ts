import { css } from 'lit';

/**
 * Private `--_*` aliases point at Home Assistant theme variables (no public `--jb-*` color knobs).
 * Roles follow HA's built-in components (see the comments on each token). The only fixed look left is the screensaver.
 */
export const tokens = css`
  :host {
    /* selected / on: HA primary + label on primary (built-in media-control / sidebar pattern). */
    --_active: var(--primary-color, #03a9f4);
    --_inactive: var(--secondary-text-color, var(--state-inactive-color, var(--disabled-text-color)));
    --_track: var(--disabled-color, var(--divider-color)); /* ha-control-slider: track = --disabled-color, fill = --primary-color */
    --_accent: var(--accent-color, var(--_active));
    --_on-accent: var(--text-primary-color, #fff); /* label on --_active */
    --_fg: var(--primary-text-color, #212121);
    --_muted: var(--secondary-text-color, #727272);
    --_bg: var(--ha-card-background, var(--card-background-color, #fff));
    --_hairline: var(--divider-color, rgba(0, 0, 0, 0.12));
    /* a panel on Now Playing: HA card surface made opaque by compositing it over the page background, like a card on a dashboard */
    --_surface-solid: linear-gradient(var(--_bg), var(--_bg)), var(--primary-background-color, #fafafa);
    /* control outline: HA chips and buttons use --outline-color */
    --_surface-border: var(--outline-color, var(--divider-color, rgba(0, 0, 0, 0.12)));
    --_divider: var(--divider-color, rgba(0, 0, 0, 0.12));
    --_prov-fg: var(--primary-text-color, #212121);
    --_prov-bg: var(--ha-assist-chip-container-color, transparent);
    --_prov-border: var(--outline-color, var(--divider-color, rgba(0, 0, 0, 0.12)));
    --_thumb-ring: 0 0 0 4px rgba(var(--rgb-primary-color, 3, 169, 244), var(--dark-divider-opacity, 0.12));
    /* chips, keys, pills (ha-assist-chip / ha-filter-chip): idle = no fill with an outline; selected or pressed = text colour at 15% */
    --_chip-bg: var(--ha-assist-chip-container-color, transparent);
    --_chip-sel: var(--ha-filter-chip-selected-container-color, rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.15));
    /* text inputs (ha-textfield): HA input fill and ink */
    --_input-bg: var(--input-fill-color, rgb(245, 245, 245));
    --_input-ink: var(--input-ink-color, var(--primary-text-color, #212121));
    --_input-label: var(--input-label-ink-color, var(--secondary-text-color, #727272));
    --_input-line: var(--input-idle-line-color, var(--divider-color));
    /* icon buttons (ha-icon-button): no fill; hover/selected = the icon colour at 10% */
    --_icon-sel: color-mix(in srgb, currentColor 10%, transparent);
    /* dialog scrim, as ha-dialog paints it: --mdc-dialog-scrim-color (none) plus the backdrop filter. HA's own default dimmer is the html-level
       --ha-dialog-scrim-backdrop-filter: brightness(68%) (resources/theme/main.globals.ts), so use that as the last fallback too: pop-ups still dim where
       the variable is not defined. A theme that sets the variable (even to none) wins. */
    --_scrim: var(--mdc-dialog-scrim-color, transparent);
    --_scrim-filter: var(--ha-dialog-scrim-backdrop-filter, var(--dialog-backdrop-filter, brightness(68%)));
    --_dialog-bg: var(--ha-dialog-surface-background, var(--mdc-theme-surface, var(--_bg)));
    /* same ceiling as ha-dialog (no phone-size fullscreen override) */
    --_popup-max-h: var(--ha-dialog-max-height, calc(var(--safe-height, 100dvh) - var(--ha-space-20, 80px)));
    --_dialog-radius: var(--ha-dialog-border-radius, var(--ha-border-radius-3xl, 24px));
    --_dialog-shadow: var(--dialog-box-shadow, var(--wa-shadow-l, var(--ha-box-shadow-l, none)));
    --_card-shadow: var(--ha-card-box-shadow, none);
    --_card-border-width: var(--ha-card-border-width, 1px);
    --_card-border-color: var(--ha-card-border-color, var(--divider-color, var(--_surface-border)));
    --_font-body: var(--ha-font-family-body, Roboto, Noto, sans-serif);
    --_font-display: var(--ha-font-family-heading, var(--ha-card-header-font-family, var(--ha-font-family-body, Roboto, Noto, sans-serif)));
    --_pad: clamp(14px, 3vw, 36px);
    --_radius: var(--ha-card-border-radius, var(--ha-border-radius-lg, 12px));
    --_radius-s: var(--ha-border-radius-md, 8px);
  }
`;

export const base = css`
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  button {
    font: inherit; color: inherit; border: 0; background: none; cursor: pointer;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  button:focus { outline: none; }
  button:focus-visible { outline: 2px solid var(--_active); outline-offset: 2px; }
  .i { width: 24px; height: 24px; fill: currentColor; flex: none; display: block; }
  .i.xs { width: 16px; height: 16px; }
`;

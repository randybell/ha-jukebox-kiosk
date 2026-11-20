import { css } from 'lit';

/**
 * Private `--_*` aliases point at Home Assistant theme variables (no public `--jb-*` color knobs).
 * Roles follow HA's built-in components (see the comments on each token). The only fixed look left is the screensaver.
 */
/*
 * #117 fluid layout. Sizes, paddings, gaps and type follow the card's own width continuously (clamp() with container units, flex wrap,
 * auto-fill grids); every touch target is at least --_touch-min (48px) at every width. Container queries on the card's own box (never the
 * window) remain only where the structure changes, each commented where it is:
 *   keyboard   digit row, ten letters a row, once ten 48px keys fit (kb)   search   keyboard beside the results, query row (np >= 700, landscape)
 *   Library    split filter view (np >= 1000)                    station  bottom sheet vs centred dialog (st >= 700)
 *   Speakers   bottom sheet vs right drawer (spk >= 641)         Now Playing  art beside info (np landscape >= 700), 3-column mini mixer (vol >= 600),
 *              two-row main speaker line (vol <= 460)
 *   narrow content choices (np <= 520 / 600): rows move the duration into the subtitle and drop the provider badge, the album page's
 *   actions take their own line, the text chip goes while typing, Now Playing leaves out Up next; the narrow queue row and its search and style sheets.
 *   Heights (landscape <= 400 / 520 / 560 px, short cards) only make room for the keyboard and Now Playing on short panels.
 * JavaScript reads the CSS result (for example --_narrow on Now Playing) instead of repeating a width.
 */
/** the narrow card width from the table above, for the one JavaScript layout choice that has no element to read a CSS flag from (menuPos) */
export const NARROW_W = 520;
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
    --_thumb-ring: 0 0 0 calc(2 * var(--ha-border-width-md, 2px)) color-mix(in srgb, var(--primary-color, #03a9f4) calc(var(--dark-divider-opacity, 0.12) * 100%), transparent);
    /* chips, keys, pills (ha-assist-chip / ha-filter-chip): idle = no fill with an outline; selected or pressed = text colour at 15% */
    --_chip-bg: var(--ha-assist-chip-container-color, transparent);
    --_chip-sel: var(--ha-filter-chip-selected-container-color, color-mix(in srgb, var(--primary-text-color, #212121) 15%, transparent));
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
    /* #115 motion: HA's duration tokens (HA itself sets them to 1 ms when the device asks for reduced motion; the media rule below does the same
       where a theme or an older HA leaves them out) */
    --_t-instant: var(--ha-animation-duration-instant, 75ms);
    --_t-fast: var(--ha-animation-duration-fast, 150ms);
    --_t-normal: var(--ha-animation-duration-normal, 250ms);
    /* #114 icons follow HA's icon size (--mdc-icon-size, 24 px by default); other icon sizes are multiples of it */
    --_icon: var(--mdc-icon-size, 24px);
    /* #113 one look for things you can't tap (HA ha-control-button / ha-icon-button: --disabled-text-color on text and icons, --disabled-color on fills)
       and one for things that are quiet but still tappable (HA's secondary opacity) */
    --_disabled: var(--disabled-text-color, #bdbdbd);
    --_disabled-fill: var(--disabled-color, #bdbdbd);
    --_dim: var(--dark-secondary-opacity, 0.54);
    /* #109 half steps of HA's 4 px spacing scale, for the few gaps that sit between two --ha-space-N tokens; they follow --ha-space-1 */
    --_space-1-5: calc(1.5 * var(--ha-space-1, 4px)); /* 6px */
    --_space-2-5: calc(2.5 * var(--ha-space-1, 4px)); /* 10px */
    --_space-3-5: calc(3.5 * var(--ha-space-1, 4px)); /* 14px */
    /* smallest tap target for any button (Material / HA touch target): buttons may shrink to fit, never below this */
    --_touch-min: 48px;
    /* 0.9.1 (#146): the narrowest a cover tile may get: two touch targets side by side on the picture plus a gap */
    --_tile-min: calc(2 * var(--_touch-min) + var(--ha-space-5, 20px));
    /* side padding follows the card's own width (container units), not the window: a half-width card gets half-width padding */
    --_pad: clamp(var(--ha-space-3, 12px), 3cqw, var(--ha-space-9, 36px));
    --_radius: var(--ha-card-border-radius, var(--ha-border-radius-lg, 12px));
    --_radius-s: var(--ha-border-radius-md, 8px);
  }
  @media (prefers-reduced-motion: reduce) {
    :host { --_t-instant: 1ms; --_t-fast: 1ms; --_t-normal: 1ms; }
  }
`;

export const base = css`
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  button {
    font: inherit; color: inherit; border: 0; background: none; cursor: pointer;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  button:focus { outline: none; }
  button:focus-visible { outline: var(--ha-border-width-md, 2px) solid var(--_active); outline-offset: 2px; }
  /* #119 the one toast look (HA's ha-toast: neutral loud fill, on-neutral text, small radius, the dialog shadow token), centred above the bottom
     edge by --_toast-bottom (a view that has something at the bottom, such as Undo or a sheet, raises it) */
  .toast { position: absolute; left: 50%; bottom: var(--_toast-bottom, var(--ha-space-4, 16px)); transform: translateX(-50%); z-index: 8;
    max-width: calc(100% - 2 * var(--ha-space-4, 16px)); padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px); border-radius: var(--ha-border-radius-sm, 4px);
    background: var(--ha-color-neutral-10); color: var(--ha-color-on-neutral-loud); box-shadow: var(--wa-shadow-l, var(--ha-box-shadow-l, none));
    font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
  .i { width: var(--_icon); height: var(--_icon); fill: currentColor; flex: none; display: block; }
  .i.xs { width: calc(var(--_icon) * 16 / 24); height: calc(var(--_icon) * 16 / 24); }
`;

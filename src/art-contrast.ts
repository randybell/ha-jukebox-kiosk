/**
 * Foreground over album art — mirrors Home Assistant media-control
 * (homeassistant/frontend src/common/image/extract_color.ts + hui-media-control-card.ts).
 *
 * HA extractColors picks a background swatch from the art and a contrasting foreground;
 * when no swatch passes contrast, it falls back to YIQ on the background:
 *   getYiq() < 200 → #ffffff, else → #000000.
 *
 * This card keeps the existing blurred-art look and always lays a dark --_shade/--_vignette
 * over it, so the effective surface is dark. That matches HA's yiq < 200 case → light controls.
 * `artForeground` samples raw art when a caller needs the HA fallback without our shade;
 * Now Playing uses ART_FG_OVER_DARK_SHADE so light covers stay readable over the shade.
 */
export const ART_FG_OVER_DARK_SHADE = '#ffffff' as const;

export async function artForeground(src: string): Promise<'#ffffff' | '#000000' | undefined> {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    const w = 16, h = 16;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return undefined;
    r /= n; g /= n; b /= n;
    // Vibrant Swatch.getYiq() equivalent
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq < 200 ? '#ffffff' : '#000000';
  } catch {
    return undefined;
  }
}

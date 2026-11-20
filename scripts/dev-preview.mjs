// Dev-preview rewrite used only by the JB_DEV_PREVIEW rollup build.
// The release build does not import this, so jukebox-card.js stays unchanged.
// Element names are longest-first so jukebox-card-editor does not become jukebox-card-dev-editor.

export const DEV_ELEMENT_NAMES = [
  'jukebox-card-editor',
  'jukebox-card',
  'jb-station-confirm',
  'jb-hold-sheet',
  'jb-speakers',
  'jb-keyboard',
  'jb-station',
  'jb-browse',
  'jb-detail',
  'jb-lyrics',
  'jb-queue',
  'jb-search',
  'jb-slider',
  'jb-now',
];

const PICKER = "name: 'Jukebox Kiosk', description:";
const PICKER_DEV = "name: 'Jukebox Card (DEV)', description:";

export function applyDevPreview(code) {
  let out = code.replaceAll(PICKER, PICKER_DEV);
  for (const name of DEV_ELEMENT_NAMES) {
    const re = new RegExp(`(^|[^A-Za-z0-9_-])${name}(?![A-Za-z0-9_:-])`, 'g');
    out = out.replace(re, `$1${name}-dev`);
  }
  return out;
}

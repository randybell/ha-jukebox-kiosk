// The dev preview suffixes every custom element and renames the card picker.
// The release build does not run this rewrite. No browser.
// Usage: node test/unit/dev-preview.unit.mjs
import { applyDevPreview } from '../../scripts/dev-preview.mjs';

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const src = `
defineElement('jukebox-card-editor', Editor);
defineElement('jukebox-card', JukeboxCard);
defineElement('jb-now', JbNow);
html\`<jb-now></jb-now><jb-lyrics class="ovl"></jb-lyrics>\`;
this.renderRoot.querySelector('jb-lyrics.ovl');
this.renderRoot.querySelector('jb-browse');
const OVERLAY_KEY = 'jukebox-card:lyrics-overlay:v1';
(window as any).customCards.push({ type: 'jukebox-card', name: 'Jukebox', description: 'Kiosk' });
console.warn('[jukebox-card] queue refresh failed');
.lib jb-browse { flex: 1; }
`;

const out = applyDevPreview(src);
check('editor is jukebox-card-editor-dev', out.includes("defineElement('jukebox-card-editor-dev', Editor)"));
check('card is jukebox-card-dev, not jukebox-card-dev-editor', out.includes("defineElement('jukebox-card-dev', JukeboxCard)") && !out.includes('jukebox-card-dev-editor'));
check('jb-now tags gain the suffix', out.includes('<jb-now-dev></jb-now-dev>'));
check('querySelector tag with a class gains the suffix', out.includes("querySelector('jb-lyrics-dev.ovl')"));
check('storage keys that start with the card name stay put', out.includes("'jukebox-card:lyrics-overlay:v1'"));
check('picker name is Jukebox Card (DEV)', out.includes("name: 'Jukebox Card (DEV)', description:"));
check('picker type is the dev element', out.includes("type: 'jukebox-card-dev'"));
check('css tag selector gains the suffix', out.includes('.lib jb-browse-dev {'));

console.log(`\n${total - failures}/${total} dev-preview checks passed`);
process.exit(failures ? 1 : 0);

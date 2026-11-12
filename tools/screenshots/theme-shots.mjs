// Screenshots of every screen and pop-up in a real HA theme. Usage:
//   OUT=/some/dir THEMES=light,dark,glass,wallpaper [ONLY=queue,now] node tools/screenshots/theme-shots.mjs
import fs from 'node:fs';
import { hermetic } from '../../test/intercept.mjs';
import { devIndex } from '../../test/serve.mjs';
import { launch, openPage, sleep } from '../../test/themes-lib.mjs';
import { SCENES } from '../../test/themes-scenes.mjs';
const OUT = process.env.OUT ?? 'screens';
const THEMES = (process.env.THEMES ?? 'light,dark,glass,wallpaper').split(',');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const BASE = await devIndex();
const browser = await launch();
let bad = 0;
for (const theme of THEMES) {
  fs.mkdirSync(`${OUT}/${theme}`, { recursive: true });
  for (const [name, sc] of Object.entries(SCENES)) {
    if (ONLY && !ONLY.includes(name)) continue;
    let p;
    try {
      p = await openPage(browser, hermetic, BASE, theme, sc.q);
      if (sc.act) await sc.act(p);
      await sleep(400);
      await p.screenshot({ path: `${OUT}/${theme}/${name}.png`, clip: { x: 0, y: 0, width: 1024, height: 712 } });
      console.log('ok', theme, name);
    } catch (e) { bad++; console.log('FAIL', theme, name, String(e.message).slice(0, 120)); }
    try { await p?.close(); } catch {}
  }
}
await browser.close();
process.exit(bad ? 1 : 0);

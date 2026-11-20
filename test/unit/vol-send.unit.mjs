// #64: mute waits while Home Assistant is disconnected, same as volume (src/vol-send.ts): nothing is sent while
// offline; only the last mute per speaker is kept; on reconnect each is sent once (values older than 30 s are
// dropped); every volume_mute passes notifyOnError=false. Volume behaviour is unchanged.
// Usage: node test/unit/vol-send.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-vol-send/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({ input: ['src/vol-send.ts'], plugins: [typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })] });
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs' });
await bundle.close();
const V = await import(OUT + 'vol-send.mjs');

let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }

const A = 'media_player.kitchen', B = 'media_player.living_room';
const calls = [];
function hass({ online = true, fail = null } = {}) {
  return {
    connection: { connected: online },
    callService: async (domain, service, data, target, notify) => {
      if (fail) { const err = fail; fail = null; throw err; }
      calls.push({ domain, service, data: { ...data }, id: target?.entity_id, notify });
    },
  };
}
function reset() {
  calls.length = 0;
  if (typeof V.volReset === 'function') V.volReset();
  else { V.setVolDown(false); if (V.connected({ connection: { connected: true } })) { /* leftover pending may leak without volReset */ } }
}

check('M0 sendMute and pendingMutes are exported', typeof V.sendMute === 'function' && typeof V.pendingMutes === 'function');

reset();
{
  const h = hass();
  await V.sendMute(h, A, true);
  check('M1 connected: sendMute sends one volume_mute with is_volume_muted and notifyOnError=false',
    calls.length === 1 && calls[0].service === 'volume_mute' && calls[0].domain === 'media_player'
    && calls[0].id === A && calls[0].data.is_volume_muted === true && calls[0].notify === false, JSON.stringify(calls));
  check('M2 connected: nothing is pending and volDown is false', V.pendingMutes().size === 0 && V.volDown() === false);
}

reset();
{
  const h = hass({ online: false });
  await V.sendMute(h, A, true);
  await V.sendMute(h, A, false);
  await V.sendMute(h, B, true);
  check('M3 offline: sendMute sends nothing', calls.length === 0, JSON.stringify(calls));
  check('M4 offline: only the last mute per speaker is kept, and volDown is true',
    V.volDown() === true && V.pendingMutes().get(A)?.v === false && V.pendingMutes().get(B)?.v === true
    && V.pendingMutes().size === 2, JSON.stringify([...V.pendingMutes()]));
  const h2 = hass({ online: true });
  V.volFlush(h2);
  await new Promise((r) => setTimeout(r, 20));
  check('M5 reconnect: exactly one volume_mute per touched speaker, last values, notifyOnError=false',
    calls.length === 2
    && calls.every((c) => c.service === 'volume_mute' && c.notify === false)
    && calls.find((c) => c.id === A)?.data.is_volume_muted === false
    && calls.find((c) => c.id === B)?.data.is_volume_muted === true, JSON.stringify(calls));
  check('M6 reconnect: pending is cleared and the status flag goes down', V.pendingMutes().size === 0 && V.volDown() === false);
  V.volFlush(h2);
  await new Promise((r) => setTimeout(r, 20));
  check('M7 reconnect: nothing is sent twice on a second flush', calls.length === 2, String(calls.length));
}

reset();
{
  const h = hass({ online: false });
  const t0 = Date.now();
  const real = Date.now;
  await V.sendMute(h, A, true);
  Date.now = () => t0 + V.STALE_MS + 1;
  V.volFlush(hass({ online: true }));
  await new Promise((r) => setTimeout(r, 20));
  Date.now = real;
  check('M8 a mute held for more than 30 s is dropped on reconnect', calls.length === 0 && V.pendingMutes().size === 0 && V.volDown() === false, JSON.stringify(calls));
}

reset();
{
  const err = new Error('connection lost'); err.code = 3;
  const h = hass({ online: true, fail: err });
  let threw = false;
  try { await V.sendMute(h, A, true); } catch { threw = true; }
  check('M9 a volume_mute that fails with connection lost is kept, not thrown, and volDown is true',
    !threw && calls.length === 0 && V.volDown() === true && V.pendingMutes().get(A)?.v === true);
  V.volFlush(hass({ online: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('M10 …and is sent once on the next flush',
    calls.length === 1 && calls[0].id === A && calls[0].data.is_volume_muted === true && calls[0].notify === false && V.volDown() === false,
    JSON.stringify(calls));
}

reset();
{
  const err = new Error('speaker failed');
  const h = hass({ online: true, fail: err });
  let threw = false;
  try { await V.sendMute(h, A, true); } catch (e) { threw = e === err; }
  check('M11 a non-connection error is still thrown and nothing is pending',
    threw && V.pendingMutes().size === 0 && V.volDown() === false);
}

reset();
{
  const h = hass({ online: false });
  await V.sendMute(h, A, true);
  await V.sendVolume(h, A, 0.4);
  await V.sendMute(h, B, false);
  const h2 = hass({ online: true });
  V.volFlush(h2);
  await new Promise((r) => setTimeout(r, 20));
  const mutes = calls.filter((c) => c.service === 'volume_mute');
  const vols = calls.filter((c) => c.service === 'volume_set');
  check('M12 volume and mute waiting together: both are sent once on reconnect',
    vols.length === 1 && vols[0].id === A && vols[0].data.volume_level === 0.4 && vols[0].notify === false
    && mutes.length === 2
    && mutes.find((c) => c.id === A)?.data.is_volume_muted === true
    && mutes.find((c) => c.id === B)?.data.is_volume_muted === false, JSON.stringify(calls));
}

reset();
{
  const h = hass();
  await V.sendVolume(h, A, 0.25);
  check('V1 volume_set is unchanged: still one call with notifyOnError=false',
    calls.length === 1 && calls[0].service === 'volume_set' && calls[0].data.volume_level === 0.25 && calls[0].notify === false);
}

if (typeof V.volReset === 'function') V.volReset();
console.log(`\n${total - failures}/${total} passed`);
process.exit(failures ? 1 : 0);

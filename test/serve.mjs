// Static dev server for the browser tests: serves the project root (dev/index.html, the card sources and fixtures).
// It listens on 127.0.0.1 port 0 (a free port picked by the OS) unless JB_PORT asks for a fixed one; if that port is
// taken the tests stop with a clear message instead of silently talking to whatever else is listening there.
// JB_URL / JB_ROOT (handled by each test) skip this server and point the tests at one you run yourself.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.lrc': 'text/plain; charset=utf-8',
};

let started;

/** Start (once per process) and return the origin, e.g. "http://127.0.0.1:41234". */
export function devServer() {
  started ??= (async () => {
    const raw = process.env.JB_PORT ?? '0';
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`JB_PORT=${raw} is not a valid port`);
    const server = createServer(async (req, res) => {
      try {
        let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        let file = normalize(join(ROOT, path));
        if (file !== ROOT.replace(/[\\/]$/, '') && !file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
        let st = await stat(file).catch(() => null);
        if (st?.isDirectory()) { file = join(file, 'index.html'); st = await stat(file).catch(() => null); }
        if (!st?.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e?.message ?? e));
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', (e) => reject(e.code === 'EADDRINUSE'
        ? new Error(`dev server: 127.0.0.1:${port} (JB_PORT) is already in use. Free it, unset JB_PORT to pick a free port, or point the test at your own server with JB_URL / JB_ROOT.`)
        : e));
      server.listen(port, '127.0.0.1', resolve);
    });
    server.unref(); // never keeps the test process alive; open browser connections end when the browser closes
    return `http://127.0.0.1:${server.address().port}`;
  })();
  return started;
}

/** dev/index.html URL (JB_URL wins). */
export const devIndex = async () => process.env.JB_URL ?? `${await devServer()}/dev/index.html`;
/** dev/ folder URL with a trailing slash (JB_ROOT wins). */
export const devRoot = async () => process.env.JB_ROOT ?? `${await devServer()}/dev/`;

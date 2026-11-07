import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconImages } from './images';

/** Fixture pages are served from 4801; 4802 is a second origin (the source of remote.css). */
export const PORTS = [4801, 4802] as const;
export const ORIGIN = `http://127.0.0.1:${PORTS[0]}`;

const FIXTURES = resolve(fileURLToPath(import.meta.url), '../fixtures');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/** Extra response headers per fixture path. */
const HEADERS: Record<string, Record<string, string>> = {
  // Only images are restricted (data: blocked); inline styles and scripts stay allowed.
  '/icons-csp.html': { 'content-security-policy': "img-src 'self'" },
};

/** Images generated in code, served next to the fixture pages. */
const GENERATED = iconImages();

function serve(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    // `?delay=<ms>` (default 500) holds the response back: a slow server or CDN.
    const delay = url.searchParams.has('delay') ? Number(url.searchParams.get('delay')) || 500 : 0;
    const generated = GENERATED[path];
    if (generated) {
      res.writeHead(200, { 'content-type': generated[0], 'cache-control': 'no-store' });
      res.end(generated[1]);
      return;
    }
    const file = resolve(FIXTURES, '.' + path);
    if (!file.startsWith(FIXTURES + sep)) {
      res.writeHead(403).end();
      return;
    }
    Promise.all([readFile(file), new Promise((r) => setTimeout(r, delay))]).then(
      ([body]) => {
        // No CORS headers: the second origin's sheet stays unreadable from the page (cross-origin).
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', ...HEADERS[path] });
        res.end(body);
      },
      () => { res.writeHead(404).end(); },
    );
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

/** Playwright globalSetup: starts both servers; the returned function is the global teardown. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const servers = await Promise.all(PORTS.map(serve));
  return async () => {
    await Promise.all(servers.map((s) => new Promise<void>((ok) => {
      s.close(() => ok());
      s.closeAllConnections();
    })));
  };
}

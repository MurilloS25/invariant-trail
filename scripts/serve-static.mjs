// Minimal static file server for the exported site. No dependencies; serves only files under `out`.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../apps/web/out', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (path === '' || path.endsWith(sep)) path = join(path, 'index.html');
    let file = resolve(root, path);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(file).catch(() => null))?.isFile()) file = resolve(root, '404.html');
    const body = await readFile(file);
    response.writeHead(file.endsWith('404.html') && path !== '404.html' ? 404 : 200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(500).end('Server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));

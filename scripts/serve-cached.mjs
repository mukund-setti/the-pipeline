// Static server for dist/ that mimics Netlify: immutable caching on /_astro/*.
// Used only to get production-representative Lighthouse numbers locally.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = normalize('dist');
const PORT = Number(process.env.PORT || 8100);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.ico': 'image/x-icon',
};

http
  .createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      let fp = normalize(join(ROOT, p));
      if (!fp.startsWith(ROOT + sep) && fp !== ROOT) {
        res.writeHead(403);
        return res.end();
      }
      let data;
      try {
        data = await readFile(fp);
      } catch {
        try {
          fp = join(fp, 'index.html');
          data = await readFile(fp);
        } catch {
          res.writeHead(404, { 'content-type': 'text/html' });
          return res.end(await readFile(join(ROOT, '404.html')).catch(() => 'Not found'));
        }
      }
      const headers = { 'content-type': MIME[extname(fp)] || 'application/octet-stream' };
      headers['cache-control'] = p.startsWith('/_astro/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate';
      res.writeHead(200, headers);
      res.end(data);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  })
  .listen(PORT, () => console.log('cached server on', PORT));

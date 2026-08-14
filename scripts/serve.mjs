import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'dist');
const PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = join(ROOT, urlPath);

  try {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      if (existsSync(indexPath)) {
        const data = readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
        return;
      }
    }
  } catch (_) {}

  if (!existsSync(filePath)) {
    const notFound = join(ROOT, '404.html');
    if (existsSync(notFound)) {
      const data = readFileSync(notFound);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const data = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
  console.log(`Serving: ${ROOT}`);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });

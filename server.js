const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const dir = path.resolve(__dirname, 'dist');
const srcDir = path.resolve(__dirname);
// El runtime del Workspace se sirve desde la FUENTE (workspace/) como fallback:
// el build público --production ya no publica el preview interno en dist.
const wsSrcDir = path.resolve(__dirname, 'workspace');

function workspaceSourcePath(file) {
  if (!file.startsWith('/workspace/')) return null;
  let rel = file.slice('/workspace/'.length);
  const fp = path.join(wsSrcDir, rel);
  return fs.existsSync(fp) ? fp : null;
}

const mime = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.webmanifest':'application/manifest+json',
  '.json':'application/json',
  '.ico':'image/x-icon',
  '.xml':'application/xml',
  '.txt':'text/plain; charset=utf-8',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc':'msword',
  '.odt':'vnd.oasis.opendocument.text',
  '.rtf':'text/rtf',
  '.epub':'application/epub+zip',
  '.mobi':'application/x-mobipocket-ebook',
  '.md':'text/markdown; charset=utf-8',
  '.csv':'text/csv',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.htm':'text/html; charset=utf-8',
  '.wasm':'application/wasm',
  '.mjs':'application/javascript; charset=utf-8',
  '.mp4':'video/mp4',
  '.webm':'video/webm',
  '.mp3':'audio/mpeg',
  '.wav':'audio/wav',
  '.ogg':'audio/ogg'
};

const server = http.createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';

  let fp = path.join(dir, file);
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
    fp = path.join(fp, 'index.html');
  }
  if (!fs.existsSync(fp)) {
    fp = path.join(dir, file + '.html');
  }
  if (!fs.existsSync(fp)) {
    const wsFp = workspaceSourcePath(file);
    if (wsFp) fp = wsFp;
  }
  if (!fs.existsSync(fp) && file.endsWith('.html')) {
    fp = path.join(dir, '404.html');
    res.writeHead(404, {'Content-Type': 'text/html; charset=utf-8'});
    fs.readFile(fp, (err, data) => { res.end(err ? 'Not found' : data); });
    return;
  }
  if (!fs.existsSync(fp) && !path.extname(file)) {
    fp = path.join(dir, '404.html');
    res.writeHead(404, {'Content-Type': 'text/html; charset=utf-8'});
    fs.readFile(fp, (err, data) => { res.end(err ? 'Not found' : data); });
    return;
  }
  if (!fs.existsSync(fp)) {
    const srcFp = path.join(srcDir, file);
    if (fs.existsSync(srcFp)) fp = srcFp;
  }
  const ext = path.extname(fp).toLowerCase();
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mime[ext] || 'application/octet-stream'});
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`Use: set PORT=<number> & node server.js`);
    console.error(`Or stop the other process using port ${PORT}.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`APLUNO disponible en http://localhost:${PORT}`);
  console.log(`Sirviendo: ${dir}`);
  console.log(`Puerto: ${PORT}`);
});

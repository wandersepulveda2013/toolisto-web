const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname);
const mime = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.webmanifest':'application/manifest+json',
  '.json':'application/json',
  '.ico':'image/x-icon'
};
http.createServer((req,res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  const fp = path.join(dir, file);
  const ext = path.extname(fp).toLowerCase();
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mime[ext] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(8080, () => console.log('Server at http://localhost:8080'));

const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, 'dist');
const srcDir = path.resolve(__dirname);
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
  '.doc':'application/msword',
  '.odt':'application/vnd.oasis.opendocument.text',
  '.rtf':'text/rtf',
  '.epub':'application/epub+zip',
  '.mobi':'application/x-mobipocket-ebook',
  '.md':'text/markdown; charset=utf-8',
  '.csv':'text/csv',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.htm':'text/html; charset=utf-8'
};
http.createServer((req,res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  let fp = path.join(dir, file);
  if (!fs.existsSync(fp)) {
    fp = path.join(dir, file + '.html');
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
}).listen(8080, () => console.log('Server at http://localhost:8080 (serving dist/)'));

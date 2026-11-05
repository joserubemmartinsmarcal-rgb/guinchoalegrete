// Servidor estático local que imita a Vercel (cleanUrls). Uso: node tests/servidor.js [porta]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function criar() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    let arq = path.normalize(path.join(RAIZ, p));
    if (!arq.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
    if (!path.extname(arq) && fs.existsSync(arq + '.html')) arq += '.html';
    fs.readFile(arq, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' }).end(buf);
    });
  });
}
module.exports = { criar };
if (require.main === module) {
  const porta = Number(process.argv[2]) || 5173;
  criar().listen(porta, () => console.log(`GF em http://localhost:${porta}`));
}

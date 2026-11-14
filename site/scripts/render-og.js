'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function start() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(root, rel || 'og-card.html');
      if (path.relative(root, file).startsWith('..')) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, body) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await start();
  const { port } = server.address();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:' + port + '/og-card.html', { waitUntil: 'networkidle0' });
    await page.evaluate(() => globalThis.document.fonts.ready);
    const out = path.join(root, 'public', 'og.png');
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  process.stderr.write((err.stack || err.message) + '\n');
  process.exit(1);
});

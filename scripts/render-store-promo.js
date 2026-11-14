'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { pngSize, toOpaquePng } = require('./png');

const repo = path.resolve(__dirname, '..');
const storeDir = path.join(repo, 'store');
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
      const file = path.resolve(repo, rel);
      if (path.relative(repo, file).startsWith('..') || !file.startsWith(repo)) {
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

async function renderTile(page, port, tile, width, height, outPath) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:' + port + '/scripts/store-promo.html?tile=' + tile, {
    waitUntil: 'networkidle0',
  });
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.evaluate(() => globalThis.document.fonts.load('500 58px Newsreader'));
  const raw = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width, height },
    captureBeyondViewport: false,
  });
  const flat = toOpaquePng(raw);
  const info = pngSize(flat);
  if (info.width !== width || info.height !== height || info.colorType !== 2) {
    throw new Error(tile + ' rendered at ' + info.width + 'x' + info.height + ' color type ' + info.colorType);
  }
  fs.writeFileSync(outPath, flat);
}

async function main() {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.copyFileSync(
    path.join(repo, 'extension', 'icons', 'icon128.png'),
    path.join(storeDir, 'icon128.png'),
  );
  const server = await start();
  const { port } = server.address();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await renderTile(page, port, 'small', 440, 280, path.join(storeDir, 'promo-small.png'));
    await renderTile(page, port, 'marquee', 1400, 560, path.join(storeDir, 'promo-marquee.png'));
  } finally {
    await browser.close();
    server.close();
  }
  process.stdout.write('Wrote store icon and promo tiles\n');
}

main().catch((err) => {
  process.stderr.write((err.stack || err.message || String(err)) + '\n');
  process.exit(1);
});

'use strict';

// document/window/MouseEvent appear inside page.evaluate callbacks, which run in the page.
/* global document, window, MouseEvent */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const repo = path.resolve(__dirname, '..');
const extensionDir = path.join(repo, 'dist', 'extension');
const article = fs.readFileSync(path.join(repo, 'demo', 'article.html'));
const outDir = process.env.DOUBLE_CLICK_SHOTS || '/opt/cursor/artifacts';

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(article);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'double-click-chrome-'));
  const hostDir = path.join(profile, 'NativeMessagingHosts');
  fs.mkdirSync(hostDir, { recursive: true });
  const installedManifest = path.join(
    os.homedir(),
    '.config',
    'google-chrome',
    'NativeMessagingHosts',
    'com.lare.doubleclick.json',
  );
  if (!fs.existsSync(installedManifest)) {
    throw new Error('Run npm run build and node install.js before capturing screenshots.');
  }
  fs.copyFileSync(installedManifest, path.join(hostDir, 'com.lare.doubleclick.json'));
  const server = await serve();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    userDataDir: profile,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--window-size=1280,800',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const workerTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().includes('chrome-extension://'),
      { timeout: 15000 },
    );
    const extensionId = new URL(workerTarget.url()).host;
    process.stdout.write('Loaded extension ' + extensionId + '\n');
    const page = await browser.newPage();
    const logs = [];
    page.on('pageerror', (err) => logs.push(String(err)));
    page.on('console', (msg) => logs.push(msg.type() + ' ' + msg.text()));
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#passage');
    await page.evaluate(() => {
      const el = document.querySelector('#passage');
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const trigger = await page.waitForSelector('>>> .dc-trigger', { timeout: 10000 });
    await trigger.click();
    await page.waitForSelector('>>> .dc-panel', { timeout: 5000 });
    await page.evaluate(() => {
      const select = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-select');
      select.value = 'mock';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const input = await page.waitForSelector('>>> .dc-input');
    await input.click();
    await input.type('What is this night about?', { delay: 8 });
    await page.click('>>> .dc-send');
    await page.waitForFunction(() => {
      const root = document.querySelector('#double-click-root').shadowRoot;
      if (!root) return false;
      const send = root.querySelector('button.dc-send, button.dc-stop');
      const thread = root.querySelector('.dc-thread');
      const text = thread ? thread.innerText : '';
      if (text.includes('helper is not installed') || text.includes('disconnected')) return true;
      return Boolean(send) && send.textContent === 'Send' && text.includes('same passage');
    }, { timeout: 15000 });
    const panelText = await page.evaluate(() => {
      const root = document.querySelector('#double-click-root').shadowRoot;
      const thread = root.querySelector('.dc-thread');
      return thread ? thread.innerText : '';
    });
    if (!panelText.includes('What stands out')) {
      throw new Error('Popup did not receive a sample reply.\n' + panelText.slice(0, 800) + '\n' + logs.join('\n'));
    }
    await page.screenshot({ path: path.join(outDir, 'double-click-popup.png') });

    const history = await browser.newPage();
    await history.setViewport({ width: 1280, height: 800 });
    await history.goto('chrome-extension://' + extensionId + '/history.html', { waitUntil: 'domcontentloaded' });
    await history.waitForSelector('.item', { timeout: 10000 });
    await history.click('.item');
    await history.waitForFunction(() => document.body.innerText.includes('same passage'), { timeout: 10000 });
    await history.screenshot({ path: path.join(outDir, 'double-click-history.png') });
    process.stdout.write('Captured popup and history for ' + extensionId + '\n');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  process.stderr.write((err.stack || err.message || String(err)) + '\n');
  process.exit(1);
});

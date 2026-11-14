'use strict';

// document/window/MouseEvent appear inside page.evaluate callbacks, which run in the page.
/* global document, window, MouseEvent */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { EXPECTED_EXTENSION_ID, HOST_NAME } = require('../helper/src/constants');
const { stableNodePath } = require('../helper/install');
const { pngSize, toOpaquePng } = require('./png');

const repo = path.resolve(__dirname, '..');
const extensionDir = path.join(repo, 'dist', 'extension');
const outDir = path.join(repo, 'store', 'screenshots');
const article = fs.readFileSync(path.join(repo, 'demo', 'article.html'), 'utf8').replace(
  '</head>',
  '<style>::selection { background: rgba(227, 155, 74, 0.55); color: #241c14; } article { box-sizing: border-box !important; max-width: 360px !important; margin: 28px auto 64px !important; padding: 0 !important; }</style></head>',
);

function shQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(article);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function installHost(profile) {
  const hostDir = path.join(profile, 'NativeMessagingHosts');
  const home = path.join(profile, 'helper-home');
  fs.mkdirSync(hostDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const launchPath = path.join(profile, 'double-click-host');
  const nodePath = stableNodePath(process.execPath);
  const hostJs = path.join(repo, 'dist', 'helper', 'host.js');
  const source = [
    '#!/bin/sh',
    'export DOUBLE_CLICK_HOME=' + shQuote(home),
    'export DOUBLE_CLICK_MOCK_DELAY=0',
    'exec ' + shQuote(nodePath) + ' ' + shQuote(hostJs) + ' "$@"',
    '',
  ].join('\n');
  fs.writeFileSync(launchPath, source, { mode: 0o755 });
  fs.chmodSync(launchPath, 0o755);
  const manifest = {
    name: HOST_NAME,
    description: 'Double Click AI local helper',
    path: launchPath,
    type: 'stdio',
    allowed_origins: ['chrome-extension://' + EXPECTED_EXTENSION_ID + '/'],
  };
  fs.writeFileSync(path.join(hostDir, HOST_NAME + '.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function shot(page, file) {
  const raw = await page.screenshot({ type: 'png', captureBeyondViewport: false });
  const flat = toOpaquePng(raw);
  const info = pngSize(flat);
  if (info.width !== 1280 || info.height !== 800 || info.colorType !== 2) {
    throw new Error(path.basename(file) + ' is ' + info.width + 'x' + info.height + ' color type ' + info.colorType);
  }
  fs.writeFileSync(file, flat);
}

async function chooseSample(page) {
  await page.evaluate(() => {
    const select = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-select');
    select.value = 'mock';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function ask(page, text, marker) {
  await page.evaluate((value) => {
    const input = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-input');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await page.click('>>> .dc-send');
  await page.waitForFunction((needle) => {
    const root = document.querySelector('#double-click-root').shadowRoot;
    const send = root.querySelector('button.dc-send, button.dc-stop');
    const thread = root.querySelector('.dc-thread');
    const body = thread ? thread.innerText : '';
    if (body.includes('helper is not installed') || body.includes('disconnected') || body.includes('Could not reach')) {
      return body;
    }
    return Boolean(send) && send.textContent === 'Send' && body.includes(needle);
  }, { timeout: 20000 }, marker);
  const body = await page.evaluate(() => {
    const root = document.querySelector('#double-click-root').shadowRoot;
    return root.querySelector('.dc-thread').innerText;
  });
  if (!body.includes(marker) || body.includes('helper is not installed') || body.includes('Could not reach')) {
    throw new Error('Sample reply did not arrive.\n' + body.slice(0, 1200));
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'double-click-store-'));
  installHost(profile);
  const server = await serve();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
    headless: true,
    userDataDir: profile,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
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
      { timeout: 20000 },
    );
    const extensionId = new URL(workerTarget.url()).host;
    if (extensionId !== EXPECTED_EXTENSION_ID) {
      throw new Error('Loaded ' + extensionId + ' instead of pinned id ' + EXPECTED_EXTENSION_ID);
    }
    process.stdout.write('Loaded extension ' + extensionId + '\n');

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
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
    await chooseSample(page);
    await page.waitForFunction(() => {
      const quote = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-passage');
      return quote && quote.textContent.includes('fog missed the headland');
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await shot(page, path.join(outDir, 'highlight.png'));

    await ask(page, 'What is this night about?', 'What stands out');
    await ask(page, 'Why underline it once?', 'Continuing the same highlight');
    await page.evaluate(() => {
      const thread = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-thread');
      const users = thread.querySelectorAll('.dc-user');
      const last = users[users.length - 1];
      if (!last) return;
      const desired = last.offsetTop + last.offsetHeight - thread.clientHeight + 16;
      thread.scrollTop = Math.max(0, desired);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shot(page, path.join(outDir, 'chat.png'));
    if (logs.some((line) => line.startsWith('error'))) {
      process.stderr.write(logs.filter((line) => line.startsWith('error')).join('\n') + '\n');
    }

    const history = await browser.newPage();
    await history.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await history.goto('chrome-extension://' + extensionId + '/history.html', { waitUntil: 'domcontentloaded' });
    await history.waitForSelector('.item', { timeout: 10000 });
    await history.click('.item');
    await history.waitForFunction(() => document.body.innerText.includes('Continuing the same highlight'), { timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shot(history, path.join(outDir, 'history.png'));

    await history.evaluate(() => {
      const providers = document.querySelector('#providers');
      providers.open = true;
      window.scrollTo(0, providers.offsetTop);
    });
    await history.waitForSelector('.provider', { timeout: 10000 });
    await history.waitForFunction(() => {
      const status = document.querySelector('#helper-status');
      return status && status.textContent && status.textContent.trim().length > 0;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shot(history, path.join(outDir, 'providers.png'));
    process.stdout.write('Wrote store screenshots to ' + outDir + '\n');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  process.stderr.write((err.stack || err.message || String(err)) + '\n');
  process.exit(1);
});

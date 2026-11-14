// The page.evaluate callbacks run in the browser. They are exercised by Chrome, not by tsc.
// @ts-nocheck
'use strict';

// document/window/MouseEvent/getSelection/getComputedStyle run inside page.evaluate.
/* global document, window, MouseEvent, getSelection, getComputedStyle, Event */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const repo = path.resolve(__dirname, '..', '..');
const scripts = [
  path.join(repo, 'dist', 'extension', 'content', 'content.js'),
];

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

const chrome = chromePath();
let browser;
let server;
let origin;

function serve() {
  const html = '<!DOCTYPE html><html><body><p id="passage">The fog missed the headland entirely and left the rocks dry.</p></body></html>';
  return new Promise((resolve) => {
    const listener = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    listener.listen(0, '127.0.0.1', () => resolve(listener));
  });
}

async function panelState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#double-click-root');
    const panel = host.shadowRoot.querySelector('.dc-panel');
    const close = host.shadowRoot.querySelector('button[aria-label="Close"]');
    const rect = close.getBoundingClientRect();
    const top = host.shadowRoot.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)[0];
    return {
      display: getComputedStyle(panel).display,
      hidden: panel.hidden,
      open: host.dataset.open,
      rects: panel.getClientRects().length,
      thread: host.shadowRoot.querySelector('.dc-thread').innerText,
      closeHit: top ? (top.getAttribute('aria-label') || top.className) : '',
    };
  });
}

async function openPopup(behavior) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.evaluateOnNewDocument((config) => {
    window.__sent = [];
    window.__errors = [];
    window.__port = {
      postMessage(message) {
        window.__sent.push(message);
        if (message.type === 'cancel' && config.throwCancel) {
          throw new Error('disconnected port');
        }
        if (message.type === 'hello') {
          setTimeout(() => {
            if (!window.__onMsg) return;
            window.__onMsg({
              type: 'hello-ack',
              settings: { provider: 'grok', claudeOptIn: false },
              providers: [
                { id: 'grok', installed: false, resolvedPath: '', detectedPath: '' },
                { id: 'codex', installed: false, resolvedPath: '', detectedPath: '' },
                { id: 'cursor', installed: false, resolvedPath: '', detectedPath: '' },
                { id: 'claude', installed: false, resolvedPath: '', detectedPath: '' },
                { id: 'copilot', installed: false, resolvedPath: '', detectedPath: '' },
                { id: 'agy', installed: false, resolvedPath: '', detectedPath: '' },
                { id: 'mock', installed: true, resolvedPath: '' },
              ],
              nativeConnected: true,
              nativeError: '',
            });
          }, 10);
        }
        if (message.type === 'turn' && config.reply) {
          setTimeout(() => {
            if (!window.__onMsg) return;
            window.__onMsg({
              type: 'event',
              requestId: message.requestId,
              event: config.reply,
            });
          }, 30);
        }
      },
      onMessage: { addListener(fn) { window.__onMsg = fn; } },
      onDisconnect: { addListener() {} },
    };
    window.chrome = {
      runtime: {
        connect() { return window.__port; },
        onMessage: { addListener() {} },
        getURL(file) { return file; },
      },
    };
  }, behavior);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  for (const file of scripts) await page.addScriptTag({ path: file });
  await page.evaluate(() => {
    const el = document.querySelector('#passage');
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForSelector('>>> .dc-trigger');
  await page.click('>>> .dc-trigger');
  await page.waitForFunction(() => {
    const panel = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-panel');
    return panel && !panel.hidden;
  });
  page.__errors = errors;
  return page;
}

async function send(page, text) {
  await page.evaluate((value) => {
    const input = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-input');
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await page.click('>>> .dc-send');
}

test.before(async () => {
  if (!chrome) throw new Error('Chrome is required for the popup close test');
  server = await serve();
  origin = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 900, height: 700 },
  });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

test('close and escape dismiss an idle popup', { timeout: 30000 }, async () => {
  const page = await openPopup({ reply: null, throwCancel: false });
  await page.click('>>> button[aria-label="Close"]');
  const closed = await panelState(page);
  assert.equal(closed.display, 'none');
  assert.equal(closed.hidden, true);
  assert.equal(closed.open, '0');
  assert.equal(closed.rects, 0);
  await page.close();

  const again = await openPopup({ reply: null, throwCancel: false });
  await again.keyboard.press('Escape');
  const escaped = await panelState(again);
  assert.equal(escaped.display, 'none');
  assert.equal(escaped.open, '0');
  await again.close();
});

test('close still dismisses the popup after a failed turn', { timeout: 30000 }, async () => {
  const failure = {
    kind: 'error',
    code: 'not_installed',
    message: 'Grok is not installed.',
    hint: 'curl -fsSL https://x.ai/cli/install.sh | bash\ngrok login',
  };
  const page = await openPopup({ reply: failure, throwCancel: false });
  await send(page, 'What is this?');
  await page.waitForFunction(() => {
    const thread = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-thread');
    return thread && thread.innerText.includes('not installed');
  });
  const shown = await panelState(page);
  assert.equal(shown.display, 'flex');
  assert.equal(shown.closeHit, 'Close');
  await page.click('>>> button[aria-label="Close"]');
  const closed = await panelState(page);
  assert.equal(closed.display, 'none');
  assert.equal(closed.hidden, true);
  assert.equal(closed.open, '0');
  assert.equal(closed.rects, 0);
  assert.equal(page.__errors.length, 0);
  await page.close();

  const byKey = await openPopup({ reply: failure, throwCancel: false });
  await send(byKey, 'What is this?');
  await byKey.waitForFunction(() => {
    const thread = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-thread');
    return thread && thread.innerText.includes('not installed');
  });
  await byKey.evaluate(() => {
    const code = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-error code');
    code.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.focus();
  });
  await byKey.keyboard.press('Escape');
  const escaped = await panelState(byKey);
  assert.equal(escaped.display, 'none');
  assert.equal(escaped.open, '0');
  await byKey.close();
});

test('close works while streaming and after a cancel, even if cancel throws', { timeout: 30000 }, async () => {
  const streaming = await openPopup({ reply: null, throwCancel: true });
  await send(streaming, 'Still working');
  await streaming.waitForSelector('>>> .dc-stop');
  await streaming.click('>>> button[aria-label="Close"]');
  const closed = await panelState(streaming);
  assert.equal(closed.display, 'none');
  assert.equal(closed.open, '0');
  const sent = await streaming.evaluate(() => window.__sent.map((message) => message.type));
  assert.ok(sent.includes('cancel'));
  assert.equal(streaming.__errors.length, 0);
  await streaming.close();

  const cancelled = await openPopup({
    reply: { kind: 'error', code: 'cancelled', message: 'Stopped.', hint: '' },
    throwCancel: false,
  });
  await send(cancelled, 'Stop this');
  await cancelled.waitForFunction(() => {
    const thread = document.querySelector('#double-click-root').shadowRoot.querySelector('.dc-thread');
    return thread && thread.innerText.includes('Stopped');
  });
  await cancelled.keyboard.press('Escape');
  const after = await panelState(cancelled);
  assert.equal(after.display, 'none');
  assert.equal(after.open, '0');
  await cancelled.close();
});


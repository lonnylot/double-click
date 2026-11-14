'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

require(path.join(__dirname, '..', '..', 'extension', 'lib', 'chunking.js'));
const { Reassembler } = globalThis.DoubleClickChunks;
const { EXPECTED_EXTENSION_ID } = require('../src/constants');

const { originAllowed } = require('../host');

const HOST = path.join(__dirname, '..', 'host.js');
const ORIGIN = 'chrome-extension://' + EXPECTED_EXTENSION_ID + '/';
const STORE_ID = 'abcdefghijklmnopabcdefghijklmnop';

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function collect(proc) {
  const reassembler = new Reassembler();
  const messages = [];
  let buf = Buffer.alloc(0);
  proc.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) return;
      const obj = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
      buf = buf.subarray(4 + len);
      const full = reassembler.push(obj);
      if (full) messages.push(full);
    }
  });
  return messages;
}

function waitFor(messages, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for host output: ' + JSON.stringify(messages)));
      }
    }, 15);
  });
}

test('the host rejects a different extension origin', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-host-deny-'));
  const proc = spawn(process.execPath, [HOST, 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DOUBLE_CLICK_HOME: home },
  });
  const messages = collect(proc);
  const code = await new Promise((resolve) => proc.on('exit', resolve));
  assert.equal(code, 1);
  assert.equal(messages[0].type, 'error');
  assert.match(messages[0].message, /Double Click/);
});

test('originAllowed accepts the dev id and each configured store id', () => {
  const ids = [EXPECTED_EXTENSION_ID, STORE_ID];
  assert.equal(originAllowed(ORIGIN, ids), true);
  assert.equal(originAllowed('chrome-extension://' + STORE_ID, ids), true);
  assert.equal(originAllowed('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/', ids), false);
  assert.equal(originAllowed('https://dcai.larehq.com', ids), false);
});

test('the host accepts a store id recorded by the installer', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-host-store-'));
  fs.writeFileSync(path.join(home, 'host-config.json'), JSON.stringify({
    extensionIds: [EXPECTED_EXTENSION_ID, STORE_ID],
  }));
  const proc = spawn(process.execPath, [HOST, 'chrome-extension://' + STORE_ID + '/'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DOUBLE_CLICK_HOME: home, DOUBLE_CLICK_MOCK_DELAY: '0' },
  });
  const messages = collect(proc);
  proc.stdin.write(frame({ type: 'ping' }));
  const pong = await waitFor(messages, (message) => message.type === 'pong');
  assert.equal(pong.type, 'pong');
  proc.kill();
  await new Promise((resolve) => proc.on('exit', resolve));
});

test('mock provider and chunked echo work through native framing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-host-'));
  const proc = spawn(process.execPath, [HOST, ORIGIN], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DOUBLE_CLICK_HOME: home,
      DOUBLE_CLICK_MOCK_DELAY: '0',
      DOUBLE_CLICK_TEST_ECHO: '1',
    },
  });
  const messages = collect(proc);
  proc.stdin.write(frame({
    type: 'turn',
    requestId: 'r1',
    conversationId: 'conv-host',
    provider: 'mock',
    userText: 'What is this about?',
    selection: { text: 'The fog missed the headland.', title: 'Notes', url: 'https://example.com' },
  }));
  const done = await waitFor(messages, (message) => message.type === 'event' && message.event && message.event.kind === 'done');
  assert.match(done.event.text, /fog missed the headland/);
  const stored = JSON.parse(fs.readFileSync(path.join(home, 'sessions.json'), 'utf8'));
  assert.equal(stored['conv-host'].provider, 'mock');
  assert.equal(JSON.stringify(stored).includes('fog missed'), false);

  const payload = 'y'.repeat(1_200_000);
  proc.stdin.write(frame({ type: 'echo', data: payload }));
  const echoed = await waitFor(messages, (message) => message.type === 'echo');
  assert.equal(echoed.data, payload);

  proc.stdin.end();
  await new Promise((resolve) => proc.on('exit', resolve));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { packMessages, Reassembler, encodeBase64, decodeBase64 } = require('../../shared/chunking');
const { frameMessage, createParser } = require('../src/native-io');

test('base64 round-trips short and chunk-sized buffers', () => {
  for (const size of [0, 1, 2, 3, 4, 5, 480 * 1024]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 17) & 255;
    const decoded = decodeBase64(encodeBase64(bytes));
    assert.equal(Buffer.compare(Buffer.from(decoded), Buffer.from(bytes)), 0);
  }
});

test('messages under the cap stay whole and large ones reassemble under 1 MB', () => {
  const small = packMessages({ type: 'event', text: 'hi' });
  assert.equal(small.length, 1);
  assert.equal(small[0].text, 'hi');

  const payload = 'x'.repeat(1_200_000);
  const message = { type: 'echo', data: payload };
  const parts = packMessages(message);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(Buffer.byteLength(JSON.stringify(part)) < 1024 * 1024);
  }
  const reassembler = new Reassembler();
  let restored = null;
  for (const part of parts) restored = reassembler.push(part) || restored;
  assert.equal(restored.data, payload);

  const framed = frameMessage(message);
  const parsed = [];
  const push = createParser((obj) => parsed.push(obj));
  push(framed);
  const again = new Reassembler();
  let full = null;
  for (const obj of parsed) full = again.push(obj) || full;
  assert.equal(full.data, payload);
  for (const obj of parsed) assert.ok(Buffer.byteLength(JSON.stringify(obj)) < 1024 * 1024);
});


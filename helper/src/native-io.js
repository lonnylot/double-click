'use strict';

const path = require('path');

require(path.join(__dirname, '..', '..', 'extension', 'lib', 'chunking.js'));

const { packMessages } = globalThis.DoubleClickChunks;
const MAX_FRAME = 1024 * 1024;

function frameMessage(message) {
  const parts = packMessages(message);
  const frames = [];
  for (const part of parts) {
    const body = Buffer.from(JSON.stringify(part));
    if (body.length >= MAX_FRAME) {
      throw new Error('Native message still exceeds 1 MB after chunking');
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    frames.push(header, body);
  }
  return Buffer.concat(frames);
}

function createParser(onMessage) {
  let buf = Buffer.alloc(0);
  return function push(chunk) {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (len <= 0 || len > 64 * 1024 * 1024) {
        throw new Error('Invalid native message length');
      }
      if (buf.length < 4 + len) return;
      const body = buf.subarray(4, 4 + len).toString('utf8');
      buf = buf.subarray(4 + len);
      onMessage(JSON.parse(body));
    }
  };
}

module.exports = {
  frameMessage,
  createParser,
  MAX_FRAME,
};

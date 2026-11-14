'use strict';

const { EXPECTED_EXTENSION_ID } = require('./src/constants');
const { createRuntime } = require('./src/runtime');
const { frameMessage, createParser } = require('./src/native-io');

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '').toLowerCase();
}

function originAllowed(origin) {
  return normalizeOrigin(origin) === 'chrome-extension://' + EXPECTED_EXTENSION_ID;
}

function main() {
  const origin = process.argv[2];
  if (!originAllowed(origin)) {
    const frame = frameMessage({
      type: 'error',
      message: 'This helper only accepts the Double Click AI extension.',
    });
    process.stdout.write(frame, () => process.exit(1));
    return;
  }

  const runtime = createRuntime();
  const send = (message) => {
    process.stdout.write(frameMessage(message));
  };
  const push = createParser((msg) => {
    runtime.handle(msg, send).catch((err) => {
      send({
        type: 'error',
        requestId: msg && msg.requestId,
        message: (err && err.message) || 'Helper error',
      });
    });
  });

  process.stdin.on('data', (chunk) => {
    try {
      push(chunk);
    } catch (err) {
      console.error('double-click host:', err.message || err);
      process.exit(1);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

if (require.main === module) main();

module.exports = { main, originAllowed, normalizeOrigin };

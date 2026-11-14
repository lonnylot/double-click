'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { configuredExtensionIds, isExtensionId, normalizeExtensionId } = require('./src/extension-ids');
const { createRuntime } = require('./src/runtime');
const { frameMessage, createParser } = require('./src/native-io');

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '').toLowerCase();
}

function readAllowedExtensionIds() {
  const extras = [];
  const home = process.env.DOUBLE_CLICK_HOME || path.join(os.homedir(), '.double-click');
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, 'host-config.json'), 'utf8'));
    if (Array.isArray(config.extensionIds)) extras.push(...config.extensionIds);
    if (config.extensionId) extras.push(config.extensionId);
  } catch (_err) { /* helper not registered yet */ }
  const accepted = [];
  for (const value of extras) {
    const id = normalizeExtensionId(value);
    if (isExtensionId(id)) accepted.push(id);
  }
  return configuredExtensionIds(accepted);
}

function originAllowed(origin, ids) {
  const allowed = ids || readAllowedExtensionIds();
  const normalized = normalizeOrigin(origin);
  return allowed.some((id) => normalized === 'chrome-extension://' + id);
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

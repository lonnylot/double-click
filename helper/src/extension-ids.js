'use strict';

const { EXPECTED_EXTENSION_ID, STORE_EXTENSION_IDS } = require('./constants');

// Chrome extension ids are 32 characters drawn from a-p.
const ID_PATTERN = /^[a-p]{32}$/;

function normalizeExtensionId(value) {
  return String(value || '').trim().toLowerCase();
}

function isExtensionId(value) {
  return ID_PATTERN.test(value);
}

function assertExtensionId(value) {
  const id = normalizeExtensionId(value);
  if (!isExtensionId(id)) {
    throw new Error('Extension id must be 32 characters from a to p: ' + value);
  }
  return id;
}

function parseExtensionIdList(values) {
  const out = [];
  for (const value of values || []) {
    for (const part of String(value).split(',')) {
      if (!part.trim()) continue;
      out.push(assertExtensionId(part));
    }
  }
  return out;
}

function uniqueExtensionIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Dev id, then store ids checked into the repo, then extras (installer flags
// or ids recorded in the host config). Duplicates collapse to the first copy.
function configuredExtensionIds(extra, storeIds = STORE_EXTENSION_IDS) {
  return uniqueExtensionIds([
    assertExtensionId(EXPECTED_EXTENSION_ID),
    ...storeIds.map((id) => assertExtensionId(id)),
    ...parseExtensionIdList(extra || []),
  ]);
}

function extensionIdsFromArgv(argv) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--extension-id') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--extension-id needs an extension id');
      values.push(next);
      i += 1;
    } else if (arg.startsWith('--extension-id=')) {
      const value = arg.slice('--extension-id='.length);
      if (!value.trim()) throw new Error('--extension-id needs an extension id');
      values.push(value);
    }
  }
  if (!values.length) return [];
  const ids = uniqueExtensionIds(parseExtensionIdList(values));
  if (!ids.length) throw new Error('--extension-id needs an extension id');
  return ids;
}

function originsForExtensionIds(ids) {
  return ids.map((id) => 'chrome-extension://' + id + '/');
}

module.exports = {
  assertExtensionId,
  configuredExtensionIds,
  extensionIdsFromArgv,
  isExtensionId,
  normalizeExtensionId,
  originsForExtensionIds,
  parseExtensionIdList,
  uniqueExtensionIds,
};

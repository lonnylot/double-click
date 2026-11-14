'use strict';

const HOST_NAME = 'com.lare.doubleclick';
// Unpacked id, pinned by the public key in extension/manifest.json.
const EXPECTED_EXTENSION_ID = 'dkaimfjbcdiaeialfejfhppmlmcafabc';
// The Chrome Web Store assigns an id on the first upload. Add it here, then
// run `node install.js` again. Until that upload, this list stays empty.
// `node install.js --extension-id <id>` adds ids without editing this file.
const STORE_EXTENSION_IDS = [];
const TURN_TIMEOUT_MS = 180000;

module.exports = {
  HOST_NAME,
  EXPECTED_EXTENSION_ID,
  STORE_EXTENSION_IDS,
  TURN_TIMEOUT_MS,
};

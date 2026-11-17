export const HOST_NAME = 'com.lare.doubleclick';
// Unpacked id, pinned by the public key in extension/manifest.json.
export const EXPECTED_EXTENSION_ID = 'dkaimfjbcdiaeialfejfhppmlmcafabc';
// Public Chrome Web Store listing:
// https://chromewebstore.google.com/detail/double-click-ai/pbfbpkklipcgellnogpboeeplljimkfm
// `node install.js` writes these into the native host manifest's allowed_origins.
// `node install.js --extension-id <id>` adds ids without editing this file.
export const STORE_EXTENSION_IDS: readonly string[] = [
  'pbfbpkklipcgellnogpboeeplljimkfm',
];
export const TURN_TIMEOUT_MS = 180000;

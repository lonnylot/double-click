'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configuredExtensionIds,
  extensionIdsFromArgv,
  originsForExtensionIds,
} = require('../src/extension-ids');
const { EXPECTED_EXTENSION_ID, STORE_EXTENSION_IDS } = require('../src/constants');
const { installPlan, main } = require('../install');
const { HOST_NAME } = require('../src/constants');

const STORE_A = 'abcdefghijklmnopabcdefghijklmnop';
const STORE_B = 'bbcdefghijklmnopabcdefghijklmnop';

test('the store id list starts empty and the dev id stays first', () => {
  assert.deepEqual(STORE_EXTENSION_IDS, []);
  assert.deepEqual(configuredExtensionIds(), [EXPECTED_EXTENSION_ID]);
  assert.deepEqual(
    configuredExtensionIds([STORE_A, EXPECTED_EXTENSION_ID, STORE_A], [STORE_A, STORE_B]),
    [EXPECTED_EXTENSION_ID, STORE_A, STORE_B],
  );
  assert.deepEqual(originsForExtensionIds([EXPECTED_EXTENSION_ID, STORE_A]), [
    'chrome-extension://' + EXPECTED_EXTENSION_ID + '/',
    'chrome-extension://' + STORE_A + '/',
  ]);
});

test('--extension-id accepts repeats and comma-separated ids', () => {
  assert.deepEqual(extensionIdsFromArgv(['--dry-run']), []);
  assert.deepEqual(extensionIdsFromArgv([
    '--extension-id', STORE_A,
    '--extension-id=' + STORE_B + ',' + STORE_A,
    '--uninstall',
  ]), [STORE_A, STORE_B]);
  assert.throws(() => extensionIdsFromArgv(['--extension-id']), /needs an extension id/);
  assert.throws(() => extensionIdsFromArgv(['--extension-id', 'not-an-id']), /a to p/);
  assert.throws(() => extensionIdsFromArgv(['--extension-id=']), /needs an extension id/);
});

test('the native host manifest allowlist can hold the dev id and store ids', () => {
  const ids = configuredExtensionIds([STORE_A, STORE_B]);
  const plan = installPlan({
    platform: 'linux',
    home: '/home/ada',
    extensionIds: ids,
    launchPath: '/opt/double-click/double-click-host',
    manifestPath: '/home/ada/.double-click/com.lare.doubleclick.json',
  });
  assert.deepEqual(plan.extensionIds, [EXPECTED_EXTENSION_ID, STORE_A, STORE_B]);
  assert.deepEqual(plan.hostManifest.allowed_origins, [
    'chrome-extension://' + EXPECTED_EXTENSION_ID + '/',
    'chrome-extension://' + STORE_A + '/',
    'chrome-extension://' + STORE_B + '/',
  ]);
  assert.ok(plan.files.every((file) => file.body.allowed_origins.length === 3));
  assert.ok(plan.files.some((file) => file.path.endsWith('NativeMessagingHosts/' + HOST_NAME + '.json')));

  const single = installPlan({
    platform: 'darwin',
    home: '/Users/ada',
    extensionId: EXPECTED_EXTENSION_ID,
    launchPath: '/opt/double-click/double-click-host',
    manifestPath: '/Users/ada/.double-click/com.lare.doubleclick.json',
  });
  assert.deepEqual(single.hostManifest.allowed_origins, ['chrome-extension://' + EXPECTED_EXTENSION_ID + '/']);
});

test('a dry-run install keeps the dev id and every flag id', () => {
  const plan = main(['--dry-run', '--extension-id', STORE_A, '--extension-id', STORE_B + ',' + STORE_A]);
  assert.deepEqual(plan.extensionIds, [EXPECTED_EXTENSION_ID, STORE_A, STORE_B]);
  assert.equal(plan.hostManifest.name, HOST_NAME);
  assert.equal(plan.hostManifest.allowed_origins.length, 3);
});

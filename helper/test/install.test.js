'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  extensionIdFromKey,
  readExtensionId,
  installPlan,
  nativeMessagingDirs,
} = require('../install');
const { HOST_NAME, EXPECTED_EXTENSION_ID } = require('../src/constants');

test('the unpacked extension id is stable', () => {
  const repo = path.resolve(__dirname, '..', '..');
  const id = readExtensionId(repo);
  assert.equal(id, EXPECTED_EXTENSION_ID);
  assert.equal(id, 'dkaimfjbcdiaeialfejfhppmlmcafabc');
  const manifest = require(path.join(repo, 'extension', 'manifest.json'));
  assert.equal(extensionIdFromKey(manifest.key), id);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('nativeMessaging'));
});

test('install plans cover macOS, Linux, and Windows', () => {
  const launch = '/opt/double-click/double-click-host';
  const darwin = installPlan({
    platform: 'darwin',
    home: '/Users/ada',
    extensionId: EXPECTED_EXTENSION_ID,
    launchPath: launch,
    manifestPath: '/Users/ada/.double-click/com.lare.doubleclick.json',
  });
  assert.ok(darwin.files.some((file) => file.path.includes('Google/Chrome/NativeMessagingHosts/' + HOST_NAME + '.json')));
  assert.deepEqual(darwin.hostManifest.allowed_origins, ['chrome-extension://' + EXPECTED_EXTENSION_ID + '/']);
  assert.equal(darwin.hostManifest.path, launch);
  assert.equal(darwin.registries.length, 0);
  assert.ok(nativeMessagingDirs('darwin', '/Users/ada').some((dir) => dir.includes('Chrome for Testing')));

  const linux = installPlan({
    platform: 'linux',
    home: '/home/ada',
    extensionId: EXPECTED_EXTENSION_ID,
    launchPath: launch,
    manifestPath: '/home/ada/.double-click/com.lare.doubleclick.json',
  });
  assert.ok(linux.files.some((file) => file.path === '/home/ada/.config/google-chrome/NativeMessagingHosts/' + HOST_NAME + '.json'));
  assert.ok(linux.files.some((file) => file.path.includes('microsoft-edge')));
  assert.ok(linux.files.some((file) => file.path.includes('google-chrome-for-testing')));

  const win = installPlan({
    platform: 'win32',
    home: 'C:\\Users\\ada',
    extensionId: EXPECTED_EXTENSION_ID,
    launchPath: 'C:\\Users\\ada\\.double-click\\double-click-host.cmd',
    manifestPath: 'C:\\Users\\ada\\.double-click\\com.lare.doubleclick.json',
  });
  assert.equal(win.files.length, 1);
  assert.ok(win.registries.some((entry) => entry.key === 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST_NAME));
  assert.equal(win.registries[0].value, win.files[0].path);
});

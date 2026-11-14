'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extensionIdFromKey,
  readExtensionId,
  installPlan,
  nativeMessagingDirs,
  launcherSource,
  cellarOptPath,
  stableNodePath,
  pathEntryForExec,
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

test('the launcher keeps a stable Node path instead of a Homebrew Cellar pin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-node-'));
  const versioned = path.join(root, 'Cellar', 'node@24', '24.22.1', 'bin', 'node');
  const opt = path.join(root, 'opt', 'node@24', 'bin', 'node');
  const linked = path.join(root, 'bin', 'node');
  fs.mkdirSync(path.dirname(versioned), { recursive: true });
  fs.mkdirSync(path.dirname(opt), { recursive: true });
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.writeFileSync(versioned, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.symlinkSync(versioned, opt);
  fs.symlinkSync(versioned, linked);
  fs.chmodSync(versioned, 0o755);

  assert.equal(cellarOptPath(versioned), opt);
  assert.equal(cellarOptPath('/usr/local/Cellar/node/22.11.0/bin/node'), '/usr/local/opt/node/bin/node');
  assert.equal(stableNodePath(versioned, { pathEntry: null, commandPath: null }), opt);

  fs.rmSync(path.dirname(opt), { recursive: true });
  assert.equal(pathEntryForExec(versioned, path.dirname(linked) + path.delimiter + '/usr/bin'), linked);
  assert.equal(stableNodePath(versioned, {
    pathValue: path.dirname(linked),
    commandPath: versioned,
  }), linked);
  assert.equal(linked.includes('Cellar'), false);

  const source = launcherSource(opt, '/repo/helper/host.js', 'darwin');
  assert.match(source, /exec ".*" "\/repo\/helper\/host.js"/);
  assert.equal(source.includes('Cellar'), false);
  assert.equal(source.includes(opt), true);
  fs.rmSync(root, { recursive: true, force: true });
});

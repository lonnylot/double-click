'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { HOST_NAME } = require('./src/constants');

function extensionIdFromKey(b64) {
  const der = Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64');
  const hash = crypto.createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i += 1) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0x0f));
  }
  return id;
}

function readExtensionId(repoRoot) {
  const manifestPath = path.join(repoRoot, 'extension', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.key) throw new Error('extension/manifest.json is missing its key');
  return extensionIdFromKey(manifest.key);
}

function nativeMessagingDirs(platform, home) {
  if (platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return [
      path.join(base, 'Google', 'Chrome', 'NativeMessagingHosts'),
      path.join(base, 'Google', 'Chrome Beta', 'NativeMessagingHosts'),
      path.join(base, 'Google', 'Chrome for Testing', 'NativeMessagingHosts'),
      path.join(base, 'Chromium', 'NativeMessagingHosts'),
      path.join(base, 'Microsoft Edge', 'NativeMessagingHosts'),
      path.join(base, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
    ];
  }
  if (platform === 'win32') return [];
  const base = path.join(home, '.config');
  return [
    path.join(base, 'google-chrome', 'NativeMessagingHosts'),
    path.join(base, 'google-chrome-beta', 'NativeMessagingHosts'),
    path.join(base, 'google-chrome-unstable', 'NativeMessagingHosts'),
    path.join(base, 'google-chrome-for-testing', 'NativeMessagingHosts'),
    path.join(base, 'chromium', 'NativeMessagingHosts'),
    path.join(base, 'microsoft-edge', 'NativeMessagingHosts'),
    path.join(base, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
  ];
}

function registryKeys() {
  const tails = [
    'Google\\Chrome',
    'Google\\Chrome Beta',
    'Chromium',
    'Microsoft\\Edge',
    'BraveSoftware\\Brave-Browser',
  ];
  return tails.map((tail) => 'HKCU\\Software\\' + tail + '\\NativeMessagingHosts\\' + HOST_NAME);
}

function installPlan(opts) {
  const origin = 'chrome-extension://' + opts.extensionId + '/';
  const hostManifest = {
    name: HOST_NAME,
    description: 'Double Click local helper',
    path: opts.launchPath,
    type: 'stdio',
    allowed_origins: [origin],
  };
  if (opts.platform === 'win32') {
    return {
      hostManifest,
      origin,
      files: [{ path: opts.manifestPath, body: hostManifest }],
      registries: registryKeys().map((key) => ({ key, value: opts.manifestPath })),
    };
  }
  return {
    hostManifest,
    origin,
    files: nativeMessagingDirs(opts.platform, opts.home).map((dir) => ({
      path: path.join(dir, HOST_NAME + '.json'),
      body: hostManifest,
    })),
    registries: [],
  };
}

function launcherSource(nodePath, hostJs, platform) {
  if (platform === 'win32') {
    return '@echo off\r\n"' + nodePath + '" "' + hostJs + '" %*\r\n';
  }
  return '#!/bin/sh\nexec "' + nodePath + '" "' + hostJs + '" "$@"\n';
}

function applyInstall(plan, opts) {
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(opts.launchPath), { recursive: true });
    fs.writeFileSync(opts.launchPath, opts.launchSource, { mode: 0o755 });
    if (opts.platform !== 'win32') fs.chmodSync(opts.launchPath, 0o755);
    for (const file of plan.files) {
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, JSON.stringify(file.body, null, 2) + '\n', { mode: 0o644 });
    }
    if (opts.configPath) {
      fs.mkdirSync(path.dirname(opts.configPath), { recursive: true });
      fs.writeFileSync(opts.configPath, JSON.stringify({
        allowedOrigin: plan.origin,
        extensionId: opts.extensionId,
        hostName: HOST_NAME,
      }, null, 2) + '\n');
    }
    if (opts.platform === 'win32') {
      for (const entry of plan.registries) {
        const result = spawnSync('reg', ['add', entry.key, '/ve', '/d', entry.value, '/f'], { encoding: 'utf8' });
        if (result.status !== 0) {
          throw new Error((result.stderr || '').trim() || 'Could not write ' + entry.key);
        }
      }
    }
  }
  return plan;
}

function uninstall(plan, opts) {
  if (opts.dryRun) return;
  for (const file of plan.files) fs.rmSync(file.path, { force: true });
  fs.rmSync(opts.launchPath, { force: true });
  if (opts.platform === 'win32') {
    for (const entry of plan.registries) spawnSync('reg', ['delete', entry.key, '/f']);
  }
}

function pathsFor(repoRoot) {
  const userHome = os.homedir();
  const dataHome = process.env.DOUBLE_CLICK_HOME || path.join(userHome, '.double-click');
  const platform = process.platform;
  const launchPath = path.join(dataHome, platform === 'win32' ? 'double-click-host.cmd' : 'double-click-host');
  return {
    userHome,
    dataHome,
    platform,
    launchPath,
    manifestPath: path.join(dataHome, HOST_NAME + '.json'),
    configPath: path.join(dataHome, 'host-config.json'),
    hostJs: path.join(repoRoot, 'helper', 'host.js'),
    extensionId: readExtensionId(repoRoot),
  };
}

function main(argv = process.argv.slice(2)) {
  const repoRoot = path.resolve(__dirname, '..');
  const info = pathsFor(repoRoot);
  const plan = installPlan({
    platform: info.platform,
    home: info.userHome,
    extensionId: info.extensionId,
    launchPath: info.launchPath,
    manifestPath: info.manifestPath,
  });
  const dryRun = argv.includes('--dry-run');
  if (argv.includes('--uninstall')) {
    uninstall(plan, { dryRun, platform: info.platform, launchPath: info.launchPath });
    process.stdout.write('Removed the Double Click native host for ' + info.extensionId + '\n');
    return plan;
  }
  applyInstall(plan, {
    dryRun,
    platform: info.platform,
    launchPath: info.launchPath,
    launchSource: launcherSource(process.execPath, info.hostJs, info.platform),
    configPath: info.configPath,
    extensionId: info.extensionId,
  });
  process.stdout.write('Double Click helper registered.\n');
  process.stdout.write('Extension ID: ' + info.extensionId + '\n');
  process.stdout.write('Allowed origin: ' + plan.origin + '\n');
  process.stdout.write('Launcher: ' + info.launchPath + '\n');
  process.stdout.write('Host manifests: ' + plan.files.length + '\n');
  return plan;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write((err.message || String(err)) + '\n');
    process.exit(1);
  }
}

module.exports = {
  extensionIdFromKey,
  readExtensionId,
  nativeMessagingDirs,
  registryKeys,
  installPlan,
  launcherSource,
  applyInstall,
  main,
};

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
    description: 'Double Click AI local helper',
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

// process.execPath is the realpath. Homebrew's is versioned
// (.../Cellar/node@24/24.22.1/bin/node) and breaks on `brew upgrade`.
function cellarOptPath(execPath) {
  const normalized = String(execPath || '').replace(/\\/g, '/');
  const match = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/(bin\/node(?:\.exe)?)$/i.exec(normalized);
  if (!match) return null;
  const stable = match[1] + '/opt/' + match[2] + '/' + match[3];
  if (String(execPath).includes('\\') && !String(execPath).includes('/')) return stable.replace(/\//g, '\\');
  return stable;
}

function isCellarVersionPath(file) {
  return /\/Cellar\/[^/]+\/[^/]+\//.test(String(file || '').replace(/\\/g, '/'));
}

function fileExists(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

// Return a PATH entry for this Node without resolving it to its realpath.
function pathEntryForExec(execPath, pathValue, realpathImpl = fs.realpathSync) {
  let real = execPath;
  try {
    real = realpathImpl(execPath);
  } catch (_err) { /* compare against the given path */ }
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  const hits = [];
  for (const dir of String(pathValue || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    try {
      if (realpathImpl(candidate) === real) hits.push(candidate);
    } catch (_err) { /* not this directory */ }
  }
  return hits.find((hit) => !isCellarVersionPath(hit)) || null;
}

function commandVNode(options = {}) {
  const spawn = options.spawn || spawnSync;
  const shell = options.shell || '/bin/sh';
  let result;
  try {
    result = spawn(shell, ['-c', 'command -v node'], {
      encoding: 'utf8',
      timeout: 2000,
      env: options.env || process.env,
    });
  } catch (_err) {
    return null;
  }
  const line = String((result && result.stdout) || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  if (!line || !path.isAbsolute(line) || isCellarVersionPath(line)) return null;
  return line;
}

function stableNodePath(execPath, options = {}) {
  const exists = options.exists || fileExists;
  const opt = cellarOptPath(execPath);
  if (opt && exists(opt)) return opt;
  const pathValue = options.pathValue === undefined || options.pathValue === null
    ? (process.env.PATH || '')
    : options.pathValue;
  const fromPath = options.pathEntry === undefined
    ? pathEntryForExec(execPath, pathValue, options.realpath || fs.realpathSync)
    : options.pathEntry;
  if (fromPath && !isCellarVersionPath(fromPath) && exists(fromPath)) return fromPath;
  const commandPath = options.commandPath === undefined ? commandVNode(options) : options.commandPath;
  if (commandPath && path.isAbsolute(commandPath) && !isCellarVersionPath(commandPath) && exists(commandPath)) {
    return commandPath;
  }
  return execPath;
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
    process.stdout.write('Removed the Double Click AI native host for ' + info.extensionId + '\n');
    return plan;
  }
  applyInstall(plan, {
    dryRun,
    platform: info.platform,
    launchPath: info.launchPath,
    launchSource: launcherSource(stableNodePath(process.execPath), info.hostJs, info.platform),
    configPath: info.configPath,
    extensionId: info.extensionId,
  });
  process.stdout.write('Double Click AI helper registered.\n');
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
  cellarOptPath,
  isCellarVersionPath,
  pathEntryForExec,
  stableNodePath,
  applyInstall,
  main,
};

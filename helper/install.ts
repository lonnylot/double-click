import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HOST_NAME } from './src/constants';
import {
  assertExtensionId,
  configuredExtensionIds,
  extensionIdsFromArgv,
  originsForExtensionIds,
  uniqueExtensionIds,
} from './src/extension-ids';

interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

interface PlannedFile {
  path: string;
  body: HostManifest;
}

interface PlannedRegistry {
  key: string;
  value: string;
}

export interface InstallPlan {
  hostManifest: HostManifest;
  origin: string;
  origins: string[];
  extensionIds: string[];
  files: PlannedFile[];
  registries: PlannedRegistry[];
}

export interface InstallPlanOptions {
  platform: string;
  home: string;
  extensionIds?: readonly string[];
  extensionId?: string;
  launchPath: string;
  manifestPath: string;
}

interface ApplyOptions {
  dryRun?: boolean;
  platform: string;
  launchPath: string;
  launchSource?: string;
  configPath?: string;
  extensionId?: string;
}

export function extensionIdFromKey(b64: string): string {
  const der = Buffer.from(String(b64 || '').replace(/\s+/g, ''), 'base64');
  const hash = createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i += 1) {
    const byte = hash[i] ?? 0;
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

export function readExtensionId(repoRoot: string): string {
  const manifestPath = path.join(repoRoot, 'extension', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { key?: string };
  if (!manifest.key) throw new Error('extension/manifest.json is missing its key');
  return extensionIdFromKey(manifest.key);
}

export function nativeMessagingDirs(platform: string, home: string): string[] {
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

export function registryKeys(): string[] {
  const tails = [
    'Google\\Chrome',
    'Google\\Chrome Beta',
    'Chromium',
    'Microsoft\\Edge',
    'BraveSoftware\\Brave-Browser',
  ];
  return tails.map((tail) => 'HKCU\\Software\\' + tail + '\\NativeMessagingHosts\\' + HOST_NAME);
}

function planExtensionIds(opts: InstallPlanOptions): string[] {
  if (Array.isArray(opts.extensionIds)) {
    if (!opts.extensionIds.length) throw new Error('At least one extension id is required');
    return uniqueExtensionIds(opts.extensionIds.map((id) => assertExtensionId(id)));
  }
  if (opts.extensionId) return [assertExtensionId(opts.extensionId)];
  return configuredExtensionIds();
}

export function installPlan(opts: InstallPlanOptions): InstallPlan {
  const extensionIds = planExtensionIds(opts);
  const origins = originsForExtensionIds(extensionIds);
  const hostManifest: HostManifest = {
    name: HOST_NAME,
    description: 'Double Click AI local helper',
    path: opts.launchPath,
    type: 'stdio',
    allowed_origins: origins,
  };
  const base = {
    hostManifest,
    origin: origins[0] || '',
    origins,
    extensionIds,
  };
  if (opts.platform === 'win32') {
    return {
      ...base,
      files: [{ path: opts.manifestPath, body: hostManifest }],
      registries: registryKeys().map((key) => ({ key, value: opts.manifestPath })),
    };
  }
  return {
    ...base,
    files: nativeMessagingDirs(opts.platform, opts.home).map((dir) => ({
      path: path.join(dir, HOST_NAME + '.json'),
      body: hostManifest,
    })),
    registries: [],
  };
}

export function launcherSource(nodePath: string, hostJs: string, platform: string): string {
  if (platform === 'win32') {
    return '@echo off\r\n"' + nodePath + '" "' + hostJs + '" %*\r\n';
  }
  return '#!/bin/sh\nexec "' + nodePath + '" "' + hostJs + '" "$@"\n';
}

// process.execPath is the realpath. Homebrew's is versioned
// (.../Cellar/node@24/24.22.1/bin/node) and breaks on `brew upgrade`.
export function cellarOptPath(execPath: string): string | null {
  const normalized = String(execPath || '').replace(/\\/g, '/');
  const match = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/(bin\/node(?:\.exe)?)$/i.exec(normalized);
  if (!match) return null;
  const stable = (match[1] || '') + '/opt/' + (match[2] || '') + '/' + (match[3] || '');
  if (String(execPath).includes('\\') && !String(execPath).includes('/')) return stable.replace(/\//g, '\\');
  return stable;
}

export function isCellarVersionPath(file: string): boolean {
  return /\/Cellar\/[^/]+\/[^/]+\//.test(String(file || '').replace(/\\/g, '/'));
}

function fileExists(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

type Realpath = (file: string) => string;

// Return a PATH entry for this Node without resolving it to its realpath.
export function pathEntryForExec(
  execPath: string,
  pathValue: string,
  realpathImpl: Realpath = (file) => fs.realpathSync(file),
): string | null {
  let real = execPath;
  try {
    real = realpathImpl(execPath);
  } catch (_err) { /* compare against the given path */ }
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  const hits: string[] = [];
  for (const dir of String(pathValue || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    try {
      if (realpathImpl(candidate) === real) hits.push(candidate);
    } catch (_err) { /* not this directory */ }
  }
  return hits.find((hit) => !isCellarVersionPath(hit)) || null;
}

export interface StableNodeOptions {
  exists?: (file: string) => boolean;
  pathValue?: string | null;
  pathEntry?: string | null;
  realpath?: Realpath;
  commandPath?: string | null;
  spawn?: typeof spawnSync;
  shell?: string;
  env?: NodeJS.ProcessEnv;
}

function commandVNode(options: StableNodeOptions = {}): string | null {
  const spawn = options.spawn || spawnSync;
  const shell = options.shell || '/bin/sh';
  let result: ReturnType<typeof spawnSync> | null = null;
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

export function stableNodePath(execPath: string, options: StableNodeOptions = {}): string {
  const exists = options.exists || fileExists;
  const opt = cellarOptPath(execPath);
  if (opt && exists(opt)) return opt;
  const pathValue = options.pathValue === undefined || options.pathValue === null
    ? (process.env.PATH || '')
    : options.pathValue;
  const fromPath = options.pathEntry === undefined
    ? pathEntryForExec(execPath, pathValue, options.realpath || ((file) => fs.realpathSync(file)))
    : options.pathEntry;
  if (fromPath && !isCellarVersionPath(fromPath) && exists(fromPath)) return fromPath;
  const commandPath = options.commandPath === undefined ? commandVNode(options) : options.commandPath;
  if (commandPath && path.isAbsolute(commandPath) && !isCellarVersionPath(commandPath) && exists(commandPath)) {
    return commandPath;
  }
  return execPath;
}

export function applyInstall(plan: InstallPlan, opts: ApplyOptions): InstallPlan {
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(opts.launchPath), { recursive: true });
    fs.writeFileSync(opts.launchPath, opts.launchSource || '', { mode: 0o755 });
    if (opts.platform !== 'win32') fs.chmodSync(opts.launchPath, 0o755);
    for (const file of plan.files) {
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, JSON.stringify(file.body, null, 2) + '\n', { mode: 0o644 });
    }
    if (opts.configPath) {
      fs.mkdirSync(path.dirname(opts.configPath), { recursive: true });
      fs.writeFileSync(opts.configPath, JSON.stringify({
        allowedOrigins: plan.origins,
        allowedOrigin: plan.origin,
        extensionIds: plan.extensionIds,
        extensionId: plan.extensionIds[0],
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

function uninstall(plan: InstallPlan, opts: { dryRun?: boolean; platform: string; launchPath: string }): void {
  if (opts.dryRun) return;
  for (const file of plan.files) fs.rmSync(file.path, { force: true });
  fs.rmSync(opts.launchPath, { force: true });
  if (opts.platform === 'win32') {
    for (const entry of plan.registries) spawnSync('reg', ['delete', entry.key, '/f']);
  }
}

export interface InstallPaths {
  userHome: string;
  dataHome: string;
  platform: NodeJS.Platform;
  launchPath: string;
  manifestPath: string;
  configPath: string;
  hostJs: string;
  extensionId: string;
}

export function pathsFor(repoRoot: string): InstallPaths {
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
    hostJs: path.join(repoRoot, 'dist', 'helper', 'host.js'),
    extensionId: readExtensionId(repoRoot),
  };
}

function repoRootFromHere(): string {
  // The installer runs from helper/install.js. The same file is also emitted
  // under dist/helper/ because that directory is the tsc output root.
  if (path.basename(__dirname) === 'helper' && path.basename(path.dirname(__dirname)) === 'dist') {
    return path.resolve(__dirname, '..', '..');
  }
  return path.resolve(__dirname, '..');
}

export function main(argv: string[] = process.argv.slice(2)): InstallPlan {
  const repoRoot = repoRootFromHere();
  const info = pathsFor(repoRoot);
  const extensionIds = configuredExtensionIds(extensionIdsFromArgv(argv));
  const plan = installPlan({
    platform: info.platform,
    home: info.userHome,
    extensionIds,
    launchPath: info.launchPath,
    manifestPath: info.manifestPath,
  });
  const dryRun = argv.includes('--dry-run');
  if (argv.includes('--uninstall')) {
    uninstall(plan, { dryRun, platform: info.platform, launchPath: info.launchPath });
    process.stdout.write('Removed the Double Click AI native host for ' + extensionIds.join(', ') + '\n');
    return plan;
  }
  if (!dryRun && !fs.existsSync(info.hostJs)) {
    throw new Error('Missing ' + info.hostJs + '. From the Double Click AI folder, run npm run build before node install.js');
  }
  applyInstall(plan, {
    dryRun,
    platform: info.platform,
    launchPath: info.launchPath,
    launchSource: launcherSource(stableNodePath(process.execPath), info.hostJs, info.platform),
    configPath: info.configPath,
    extensionId: extensionIds[0],
  });
  process.stdout.write('Double Click AI helper registered.\n');
  process.stdout.write('Extension IDs: ' + extensionIds.join(', ') + '\n');
  for (const origin of plan.origins) {
    process.stdout.write('Allowed origin: ' + origin + '\n');
  }
  process.stdout.write('Launcher: ' + info.launchPath + '\n');
  process.stdout.write('Host manifests: ' + plan.files.length + '\n');
  return plan;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err && err.message
      ? String(err.message)
      : String(err);
    process.stderr.write(message + '\n');
    process.exit(1);
  }
}

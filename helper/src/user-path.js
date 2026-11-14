'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Chrome launched from the Dock inherits launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// CLIs installed into the login shell are invisible unless we rebuild PATH here.
const START = '__DOUBLE_CLICK_PATH_START__';
const END = '__DOUBLE_CLICK_PATH_END__';
const DEFAULT_TIMEOUT_MS = 2500;

let cache = null;

function clearUserPathCache() {
  cache = null;
}

function shellBasename(shell) {
  return path.basename(String(shell || '')).toLowerCase().replace(/\.exe$/i, '');
}

function pathProbeScript() {
  return "printf '%s\\n' '" + START + "'; printf '%s\\n' \"$PATH\"; printf '%s\\n' '" + END + "'";
}

function fishProbeScript() {
  return "printf '%s\\n' '" + START + "'; printf '%s\\n' (string join : $PATH); printf '%s\\n' '" + END + "'";
}

function shellArgs(shell) {
  const base = shellBasename(shell);
  if (base === 'fish') return ['-l', '-i', '-c', fishProbeScript()];
  if (base === 'csh' || base === 'tcsh') return ['-l', '-i', '-c', pathProbeScript()];
  if (base === 'sh' || base === 'dash') return ['-l', '-c', pathProbeScript()];
  return ['-ilc', pathProbeScript()];
}

function parseMarkedPath(output) {
  const text = String(output || '');
  const end = text.lastIndexOf(END);
  if (end < 0) return null;
  const start = text.lastIndexOf(START, end);
  if (start < 0) return null;
  const body = text.slice(start + START.length, end);
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const value = lines[lines.length - 1];
  if (!value || value.includes(START) || value.includes(END) || value.includes('printf')) return null;
  return value;
}

function shellEnv(env) {
  const next = { ...env };
  next.PAGER = 'cat';
  next.GIT_TERMINAL_PROMPT = '0';
  next.DISABLE_AUTO_UPDATE = 'true';
  return next;
}

function loginShellPath(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  let shell = options.shell || env.SHELL || '';
  if (!shell && platform !== 'win32') shell = '/bin/sh';
  if (!shell || platform === 'win32') return null;
  const spawn = options.spawn || spawnSync;
  const timeoutMs = options.timeoutMs === undefined || options.timeoutMs === null
    ? DEFAULT_TIMEOUT_MS
    : options.timeoutMs;
  let result;
  try {
    result = spawn(shell, shellArgs(shell), {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: shellEnv(env),
      windowsHide: true,
    });
  } catch (_err) {
    return null;
  }
  if (!result) return null;
  return parseMarkedPath(result.stdout);
}

function splitPath(value) {
  return String(value || '').split(path.delimiter).filter(Boolean);
}

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((part) => parseInt(part, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((part) => parseInt(part, 10) || 0);
  const count = Math.max(pa.length, pb.length);
  for (let i = 0; i < count; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function matchVersion(spec, versionNames) {
  const raw = String(spec || '').trim();
  if (!raw || raw === 'default' || raw === 'node' || raw === 'stable' || raw.startsWith('lts/')) return null;
  const want = raw.startsWith('v') ? raw : 'v' + raw;
  if (versionNames.includes(want)) return want;
  const matches = versionNames.filter((name) => name.startsWith(want + '.'));
  if (!matches.length) return null;
  matches.sort(compareVersions);
  return matches[matches.length - 1];
}

function readText(fsImpl, file) {
  try {
    return fsImpl.readFileSync(file, 'utf8').trim();
  } catch (_err) {
    return '';
  }
}

function resolveNvmAlias(name, nvmDir, versionNames, fsImpl, seen) {
  if (!name || seen.has(name)) return null;
  seen.add(name);
  const direct = matchVersion(name, versionNames);
  if (direct) return direct;
  const text = readText(fsImpl, path.join(nvmDir, 'alias', name));
  if (!text) return null;
  const fromFile = matchVersion(text, versionNames);
  if (fromFile) return fromFile;
  return resolveNvmAlias(text, nvmDir, versionNames, fsImpl, seen);
}

function nvmBin(home, env, fsImpl) {
  const nvmDir = env.NVM_DIR || path.join(home, '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');
  let names = [];
  try {
    names = fsImpl.readdirSync(versionsDir).filter((name) => /^v\d/.test(name));
  } catch (_err) {
    return '';
  }
  const resolved = resolveNvmAlias('default', nvmDir, names, fsImpl, new Set());
  if (!resolved) return '';
  return path.join(versionsDir, resolved, 'bin');
}

function fnmBins(home, env, platform) {
  const bins = [];
  if (env.FNM_MULTISHELL_PATH) bins.push(env.FNM_MULTISHELL_PATH);
  const roots = [
    env.FNM_DIR,
    path.join(home, '.local', 'share', 'fnm'),
    path.join(home, '.fnm'),
  ];
  if (platform === 'darwin') roots.push(path.join(home, 'Library', 'Application Support', 'fnm'));
  for (const root of roots) {
    if (root) bins.push(path.join(root, 'aliases', 'default', 'bin'));
  }
  return bins;
}

function candidateDirs(home, env, platform, fsImpl) {
  const dirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.grok', 'bin'),
    path.join(home, 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cursor', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'bin'),
    path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'shims'),
    path.join(home, '.asdf', 'bin'),
  ];
  if (platform === 'darwin') {
    dirs.push('/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin');
  } else if (platform === 'linux') {
    dirs.push(
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      path.join(home, '.linuxbrew', 'bin'),
    );
  } else if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(roaming, 'npm'), path.join(local, 'Programs'));
  }
  dirs.push(nvmBin(home, env, fsImpl));
  dirs.push(...fnmBins(home, env, platform));
  return dirs.filter(Boolean);
}

function directoryExists(fsImpl, dir) {
  try {
    return fsImpl.statSync(dir).isDirectory();
  } catch (_err) {
    return false;
  }
}

function wellKnownDirs(options = {}) {
  const fsImpl = options.fs || fs;
  const env = options.env || process.env;
  const home = options.home || env.HOME || env.USERPROFILE || os.homedir();
  const platform = options.platform || process.platform;
  return candidateDirs(home, env, platform, fsImpl).filter((dir) => directoryExists(fsImpl, dir));
}

function mergePathEntries(loginValue, knownDirs, baseValue) {
  const seen = new Set();
  const out = [];
  const add = (entry) => {
    if (!entry) return;
    const key = process.platform === 'win32' ? entry.toLowerCase() : entry;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  for (const entry of splitPath(loginValue)) add(entry);
  for (const entry of knownDirs) add(entry);
  for (const entry of splitPath(baseValue)) add(entry);
  return out;
}

function resolveUserPath(options = {}) {
  const env = options.env || process.env;
  const home = options.home || env.HOME || env.USERPROFILE || os.homedir();
  const base = env.PATH || env.Path || '';
  const shell = options.shell || env.SHELL || '';
  if (options.cache !== false && cache && cache.home === home && cache.shell === shell && cache.base === base) {
    return cache.value;
  }
  const login = options.loginPath !== undefined ? options.loginPath : loginShellPath({ ...options, env });
  const known = options.knownDirs || wellKnownDirs({ ...options, env, home });
  const value = mergePathEntries(login, known, base).join(path.delimiter);
  if (options.cache !== false) cache = { home, shell, base, value };
  return value;
}

function withUserPath(env, options = {}) {
  const source = env || process.env;
  const resolved = resolveUserPath({ ...options, env: source });
  const next = { ...source, PATH: resolved };
  if (Object.prototype.hasOwnProperty.call(source, 'Path') || (options.platform || process.platform) === 'win32') {
    next.Path = resolved;
  }
  return next;
}

module.exports = {
  START,
  END,
  clearUserPathCache,
  shellArgs,
  parseMarkedPath,
  loginShellPath,
  wellKnownDirs,
  mergePathEntries,
  resolveUserPath,
  withUserPath,
  nvmBin,
};

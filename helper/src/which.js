'use strict';

const fs = require('fs');
const path = require('path');

function pathEntries(env) {
  const raw = (env && (env.PATH || env.Path)) || '';
  return raw.split(path.delimiter).filter(Boolean);
}

function extensions(env) {
  if (process.platform !== 'win32') return [''];
  const raw = (env && env.PATHEXT) || '.COM;.EXE;.BAT;.CMD';
  const list = raw.split(';').filter(Boolean);
  if (!list.includes('')) list.push('');
  return list;
}

function isExecutable(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

// Look up a specific binary name on PATH. Never resolves the generic name "agent".
function which(bin, env) {
  const base = path.basename(String(bin || ''));
  const stem = base.toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
  if (!stem || stem === 'agent') return null;
  if (base !== bin || base.includes('/') || base.includes('\\')) return null;
  const envExts = extensions(env);
  for (const dir of pathEntries(env)) {
    for (const ext of envExts) {
      const candidate = path.join(dir, base + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

module.exports = { which };

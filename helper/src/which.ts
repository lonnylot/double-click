import * as fs from 'fs';
import * as path from 'path';

function pathEntries(env: NodeJS.ProcessEnv | undefined): string[] {
  const raw = (env && (env.PATH || env.Path)) || '';
  return raw.split(path.delimiter).filter(Boolean);
}

function extensions(env: NodeJS.ProcessEnv | undefined): string[] {
  if (process.platform !== 'win32') return [''];
  const raw = (env && env.PATHEXT) || '.COM;.EXE;.BAT;.CMD';
  const list = raw.split(';').filter(Boolean);
  if (!list.includes('')) list.push('');
  return list;
}

function commandStem(bin: string): string {
  return path.basename(String(bin || '')).toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
}

// Grok and Cursor have both shipped a generic `agent` binary. Never run it.
export function isGenericAgent(bin: string): boolean {
  return commandStem(bin) === 'agent';
}

export function isExecutable(file: string): boolean {
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
export function which(bin: string, env: NodeJS.ProcessEnv | undefined): string | null {
  const base = path.basename(String(bin || ''));
  const stem = commandStem(base);
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

export function classifyOverride(override: string): { path: string | null; note: string } {
  const candidate = String(override || '').trim();
  if (!candidate) return { path: null, note: '' };
  if (!path.isAbsolute(candidate)) return { path: null, note: 'Use an absolute path.' };
  if (isGenericAgent(candidate)) return { path: null, note: 'The generic agent command is not used.' };
  if (!isExecutable(candidate)) return { path: null, note: 'That file is not executable.' };
  return { path: candidate, note: '' };
}

// Absolute override wins when it is usable. An unusable override does not fall back to PATH.
export function resolveCommand(
  command: string | null | undefined,
  env: NodeJS.ProcessEnv | undefined,
  override?: string,
): string | null {
  const custom = String(override || '').trim();
  if (custom) return classifyOverride(custom).path;
  if (isGenericAgent(command || '')) return null;
  return which(command || '', env);
}

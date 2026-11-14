import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { HostEvent } from '../shared/protocol';
import { configuredExtensionIds, isExtensionId, normalizeExtensionId } from './src/extension-ids';
import { createParser, frameMessage } from './src/native-io';
import { createRuntime } from './src/runtime';

function textOf(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && err.message) return String(err.message);
  return fallback;
}

export function normalizeOrigin(origin: unknown): string {
  return String(origin || '').trim().replace(/\/+$/, '').toLowerCase();
}

export function readAllowedExtensionIds(): string[] {
  const extras: unknown[] = [];
  const home = process.env.DOUBLE_CLICK_HOME || path.join(os.homedir(), '.double-click');
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(home, 'host-config.json'), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const config = parsed as { extensionIds?: unknown; extensionId?: unknown };
      if (Array.isArray(config.extensionIds)) extras.push(...config.extensionIds);
      if (config.extensionId) extras.push(config.extensionId);
    }
  } catch (_err) { /* helper not registered yet */ }
  const accepted: string[] = [];
  for (const value of extras) {
    const id = normalizeExtensionId(value);
    if (isExtensionId(id)) accepted.push(id);
  }
  return configuredExtensionIds(accepted);
}

export function originAllowed(origin: unknown, ids?: readonly string[]): boolean {
  const allowed = ids || readAllowedExtensionIds();
  const normalized = normalizeOrigin(origin);
  return allowed.some((id) => normalized === 'chrome-extension://' + id);
}

export function main(): void {
  const origin = process.argv[2];
  if (!originAllowed(origin)) {
    const frame = frameMessage({
      type: 'error',
      message: 'This helper only accepts the Double Click AI extension.',
    });
    process.stdout.write(frame, () => process.exit(1));
    return;
  }

  const runtime = createRuntime();
  const send = (message: HostEvent) => {
    process.stdout.write(frameMessage(message));
  };
  const push = createParser((msg) => {
    const requestId = msg && typeof msg === 'object' && 'requestId' in msg && typeof msg.requestId === 'string'
      ? msg.requestId
      : undefined;
    runtime.handle(msg, send).catch((err: unknown) => {
      send({
        type: 'error',
        requestId,
        message: textOf(err, 'Helper error'),
      });
    });
  });

  process.stdin.on('data', (chunk: Buffer) => {
    try {
      push(chunk);
    } catch (err) {
      console.error('double-click host:', textOf(err, String(err)));
      process.exit(1);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

if (require.main === module) main();

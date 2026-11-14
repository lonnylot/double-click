import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TurnEvent, TurnInput } from '../../shared/protocol';
import { TURN_TIMEOUT_MS } from './constants';
import { stripEnv } from './env';
import { createState } from './parse-util';
import { getAdapter } from './providers';
import type { Adapter } from './providers/adapter';
import type { SessionMap } from './sessions';
import { resolveCommand } from './which';

type WhichFn = (command: string, env: NodeJS.ProcessEnv, override?: string) => string | null;

export interface RunTurnOptions {
  spawn?: typeof spawn;
  which?: WhichFn;
  env?: NodeJS.ProcessEnv;
  sessions?: SessionMap;
  onEvent: (event: TurnEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal && signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}

function authLike(text: string | undefined): boolean {
  return /auth|log ?in|sign in|not logged|unauthenticated|authentication required/i.test(text || '');
}

function decorate(adapter: Pick<Adapter, 'label' | 'installHint' | 'loginHint'>, event: TurnEvent): TurnEvent {
  if (!event || event.kind !== 'error') return event;
  const hintBits = [adapter.installHint, adapter.loginHint].filter(Boolean);
  if (event.code === 'not_installed') {
    return { ...event, hint: event.hint || hintBits.join('\n') };
  }
  if (event.code === 'not_logged_in' || authLike(event.message)) {
    return {
      ...event,
      code: 'not_logged_in',
      message: event.code === 'not_logged_in' ? event.message : adapter.label + ' is not signed in.',
      hint: adapter.loginHint || event.hint || '',
    };
  }
  if (!event.hint) return { ...event, hint: adapter.loginHint || '' };
  return event;
}

function refuseGeneric(command: string | null | undefined): void {
  const base = path.basename(command || '').toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
  if (base === 'agent') {
    throw new Error('Refusing to launch a generic agent binary. Use grok or cursor-agent.');
  }
}

function textOf(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && err.message) return String(err.message);
  return fallback;
}

function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT');
}

async function runMock(
  adapter: Adapter,
  turn: TurnInput,
  spec: { preassignedSessionId: string | null },
  emit: (event: TurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  emit({ kind: 'session', providerSessionId: spec.preassignedSessionId || '' });
  if (!adapter.answer) throw new Error('Mock provider has no answer');
  const text = adapter.answer(turn);
  const delayMs = Number(process.env.DOUBLE_CLICK_MOCK_DELAY ?? 12);
  const size = 28;
  for (let offset = 0; offset < text.length; offset += size) {
    if (signal.aborted) {
      emit({ kind: 'error', code: 'cancelled', message: 'Stopped.', hint: '' });
      return;
    }
    if (delayMs > 0) await wait(delayMs, signal);
    if (signal.aborted) {
      emit({ kind: 'error', code: 'cancelled', message: 'Stopped.', hint: '' });
      return;
    }
    emit({ kind: 'delta', text: text.slice(offset, offset + size) });
  }
  emit({ kind: 'done', text });
}

export async function runTurn(turn: TurnInput, options: RunTurnOptions): Promise<void> {
  const spawnImpl = (options && options.spawn) || spawn;
  const whichImpl = (options && options.which) || resolveCommand;
  const env = (options && options.env) || process.env;
  const sessions = options && options.sessions;
  const onEvent = options.onEvent;
  const signal = (options && options.signal) || new AbortController().signal;
  const timeoutMs = (options && options.timeoutMs) || Number(env.DOUBLE_CLICK_TURN_TIMEOUT_MS) || TURN_TIMEOUT_MS;
  const adapter = getAdapter(turn.provider);
  let settled = false;

  function emit(event: TurnEvent): void {
    if (settled) return;
    const next = decorate(adapter || { label: 'Provider', loginHint: '', installHint: '' }, event);
    if (next.kind === 'session' && sessions && turn.conversationId && next.providerSessionId) {
      sessions.set(turn.conversationId, {
        provider: turn.provider,
        providerSessionId: next.providerSessionId,
      });
    }
    if (next.kind === 'done' || next.kind === 'error') settled = true;
    onEvent(next);
  }

  if (!adapter) {
    emit({ kind: 'error', code: 'unknown_provider', message: 'Unknown provider.', hint: '' });
    return;
  }
  if (!String(turn.userText || '').trim()) {
    emit({ kind: 'error', code: 'empty', message: 'Write a question first.', hint: '' });
    return;
  }
  if (adapter.optIn && turn.claudeOptIn !== true) {
    emit({
      kind: 'error',
      code: 'opt_in',
      message: adapter.label + ' stays off until you enable it.',
      hint: adapter.caveat || 'Enable it in Providers after reading the note.',
    });
    return;
  }

  const stored = sessions && turn.conversationId ? sessions.get(turn.conversationId) : null;
  const providerSessionId = turn.providerSessionId
    || (stored && stored.provider === turn.provider ? stored.providerSessionId : null);
  const effective: TurnInput = {
    ...turn,
    providerSessionId: providerSessionId || null,
    userText: String(turn.userText).slice(0, 100000),
    selection: {
      text: String((turn.selection && turn.selection.text) || '').slice(0, 100000),
      title: String((turn.selection && turn.selection.title) || '').slice(0, 500),
      url: String((turn.selection && turn.selection.url) || '').slice(0, 2000),
    },
  };

  let cwd: string | null = null;
  try {
    cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'double-click-'));
    const directory = cwd;
    const spec = adapter.buildTurn(effective, directory);
    if (spec.preassignedSessionId) {
      emit({ kind: 'session', providerSessionId: spec.preassignedSessionId });
    }
    if (spec.mock) {
      await runMock(adapter, effective, spec, emit, signal);
      return;
    }
    refuseGeneric(spec.command);
    if ((spec.args || []).some((arg) => arg === '--bare' || arg === '--dangerously-skip-permissions' || arg === '--yolo' || arg === '--force' || arg === '--allow-all')) {
      emit({ kind: 'error', code: 'refused', message: 'Refusing an unsafe CLI flag.', hint: '' });
      return;
    }
    const binary = spec.command ? whichImpl(spec.command, env, turn.providerPath) : null;
    if (!binary) {
      emit({
        kind: 'error',
        code: 'not_installed',
        message: adapter.label + ' is not installed.',
        hint: [adapter.installHint, adapter.loginHint].filter(Boolean).join('\n'),
      });
      return;
    }
    refuseGeneric(binary);

    const childEnv = stripEnv(env);
    const state = createState();
    let stderr = '';
    await new Promise<void>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnImpl(binary, spec.args || [], {
          cwd: directory,
          env: childEnv,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        emit({ kind: 'error', code: 'spawn', message: textOf(err, 'Could not start the CLI.'), hint: adapter.installHint || '' });
        resolve();
        return;
      }

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      const onAbort = () => child.kill('SIGTERM');
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdin.on('error', () => {});
      if (spec.stdin) child.stdin.write(spec.stdin, () => child.stdin.end());
      else child.stdin.end();

      let stdoutBuf = '';
      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          const events = adapter.parseLine(trimmed, state) || [];
          for (const event of events) emit(event);
        } else {
          state.plain.push(trimmed);
        }
      };

      child.stdout.on('data', (buf: Buffer | string) => {
        stdoutBuf += buf.toString('utf8');
        let nl = stdoutBuf.indexOf('\n');
        while (nl >= 0) {
          consume(stdoutBuf.slice(0, nl).replace(/\r$/, ''));
          stdoutBuf = stdoutBuf.slice(nl + 1);
          nl = stdoutBuf.indexOf('\n');
        }
      });
      child.stderr.on('data', (buf: Buffer | string) => {
        stderr += buf.toString('utf8');
        if (stderr.length > 16000) stderr = stderr.slice(-16000);
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (isEnoent(err)) {
          emit({
            kind: 'error',
            code: 'not_installed',
            message: adapter.label + ' is not installed.',
            hint: [adapter.installHint, adapter.loginHint].filter(Boolean).join('\n'),
          });
        } else {
          emit({
            kind: 'error',
            code: 'spawn',
            message: textOf(err, 'Could not start the CLI.'),
            hint: adapter.installHint || '',
          });
        }
        resolve();
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (stdoutBuf.trim()) consume(stdoutBuf);
        if (settled) {
          resolve();
          return;
        }
        if (signal.aborted) {
          emit({ kind: 'error', code: 'cancelled', message: 'Stopped.', hint: '' });
        } else if (timedOut) {
          emit({
            kind: 'error',
            code: 'timeout',
            message: adapter.label + ' took too long and was stopped.',
            hint: '',
          });
        } else if (code === 0) {
          if (!state.sawText && state.plain.length) {
            state.text = state.plain.join('\n');
            state.sawText = true;
            emit({ kind: 'text', text: state.text });
          }
          emit({ kind: 'done', text: state.text || '' });
        } else {
          const tail = stderr.trim().slice(-800);
          if (/not found|ENOENT|no such file/i.test(tail)) {
            emit({
              kind: 'error',
              code: 'not_installed',
              message: adapter.label + ' is not installed.',
              hint: [adapter.installHint, adapter.loginHint].filter(Boolean).join('\n'),
            });
          } else {
            emit({
              kind: 'error',
              code: 'cli_error',
              message: tail || adapter.label + ' exited with code ' + String(code) + '.',
              hint: '',
            });
          }
        }
        resolve();
      });
    });
  } catch (err) {
    emit({ kind: 'error', code: 'helper', message: textOf(err, 'The helper failed.'), hint: '' });
  } finally {
    if (cwd) await fs.promises.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

export { decorate };

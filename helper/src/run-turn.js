'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { stripEnv } = require('./env');
const { resolveCommand } = require('./which');
const { createState } = require('./parse-util');
const { getAdapter } = require('./providers');
const { TURN_TIMEOUT_MS } = require('./constants');

function wait(ms, signal) {
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

function authLike(text) {
  return /auth|log ?in|sign in|not logged|unauthenticated|authentication required/i.test(text || '');
}

function decorate(adapter, event) {
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

function refuseGeneric(command) {
  const base = path.basename(command || '').toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
  if (base === 'agent') {
    throw new Error('Refusing to launch a generic agent binary. Use grok or cursor-agent.');
  }
}

async function runMock(adapter, turn, spec, emit, signal) {
  emit({ kind: 'session', providerSessionId: spec.preassignedSessionId });
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

async function runTurn(turn, options) {
  const spawnImpl = (options && options.spawn) || spawn;
  const whichImpl = (options && options.which) || resolveCommand;
  const env = (options && options.env) || process.env;
  const sessions = options && options.sessions;
  const onEvent = options.onEvent;
  const signal = (options && options.signal) || new AbortController().signal;
  const timeoutMs = (options && options.timeoutMs) || Number(env.DOUBLE_CLICK_TURN_TIMEOUT_MS) || TURN_TIMEOUT_MS;
  const adapter = getAdapter(turn.provider);
  let settled = false;

  function emit(event) {
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
  const effective = {
    ...turn,
    providerSessionId: providerSessionId || null,
    userText: String(turn.userText).slice(0, 100000),
    selection: {
      text: String((turn.selection && turn.selection.text) || '').slice(0, 100000),
      title: String((turn.selection && turn.selection.title) || '').slice(0, 500),
      url: String((turn.selection && turn.selection.url) || '').slice(0, 2000),
    },
  };

  let cwd = null;
  try {
    cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'double-click-'));
    const spec = adapter.buildTurn(effective, cwd);
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
    const binary = whichImpl(spec.command, env, turn.providerPath);
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
    await new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(binary, spec.args || [], {
          cwd,
          env: childEnv,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        emit({ kind: 'error', code: 'spawn', message: err.message || 'Could not start the CLI.', hint: adapter.installHint });
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
      const consume = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          const events = adapter.parseLine(trimmed, state) || [];
          for (const event of events) emit(event);
        } else {
          state.plain.push(trimmed);
        }
      };

      child.stdout.on('data', (buf) => {
        stdoutBuf += buf.toString('utf8');
        let nl = stdoutBuf.indexOf('\n');
        while (nl >= 0) {
          consume(stdoutBuf.slice(0, nl).replace(/\r$/, ''));
          stdoutBuf = stdoutBuf.slice(nl + 1);
          nl = stdoutBuf.indexOf('\n');
        }
      });
      child.stderr.on('data', (buf) => {
        stderr += buf.toString('utf8');
        if (stderr.length > 16000) stderr = stderr.slice(-16000);
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (err && err.code === 'ENOENT') {
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
            message: (err && err.message) || 'Could not start the CLI.',
            hint: adapter.installHint,
          });
        }
        resolve();
      });

      child.on('close', (code) => {
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
              message: tail || adapter.label + ' exited with code ' + code + '.',
              hint: '',
            });
          }
        }
        resolve();
      });
    });
  } catch (err) {
    emit({ kind: 'error', code: 'helper', message: err.message || 'The helper failed.', hint: '' });
  } finally {
    if (cwd) await fs.promises.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { runTurn, decorate };

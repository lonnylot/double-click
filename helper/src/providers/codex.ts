import type { TurnEvent } from '../../../shared/protocol';
import { buildPrompt } from '../prompt';
import { asRecord, errorText, parseJson, pushDone, pushError, pushMessage, pushSession } from '../parse-util';
import type { Adapter } from './adapter';

// Verified against https://developers.openai.com/codex/noninteractive (2026-11-13).
// `codex exec --json` emits JSONL: thread.started, turn.*, item.*, error.
// Resume flag placement before the `resume` subcommand matches `exec` owning --json/--sandbox.
// Whether `resume` accepts those flags was unverified in the research; they are exec-level flags.
export const codex = {
  id: 'codex',
  label: 'Codex',
  detail: 'ChatGPT subscription',
  command: 'codex',
  optIn: false,
  installHint: 'npm install -g @openai/codex',
  loginHint: 'codex login',
  buildTurn(turn, cwd) {
    const prompt = buildPrompt(turn);
    const args = [
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '-C',
      cwd,
    ];
    if (turn.providerSessionId) {
      args.push('resume', turn.providerSessionId, prompt);
      return { command: 'codex', args, stdin: null, preassignedSessionId: null };
    }
    // Documented: `codex exec -` reads the prompt from stdin.
    args.push('-');
    return { command: 'codex', args, stdin: prompt, preassignedSessionId: null };
  },
  parseLine(line, state) {
    const obj = parseJson(line);
    if (!obj) return [];
    const events: TurnEvent[] = [];
    if (obj.type === 'thread.started') pushSession(state, events, obj.thread_id);
    if (obj.type === 'item.completed' || obj.type === 'item.updated') {
      const item = asRecord(obj.item) || {};
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        pushMessage(state, events, item.text);
      }
    }
    if (obj.type === 'turn.failed' || obj.type === 'error') {
      pushError(state, events, errorText(obj.error || obj.message || obj));
    }
    if (obj.type === 'turn.completed') pushDone(state, events);
    return events;
  },
} satisfies Adapter;

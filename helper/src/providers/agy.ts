import type { TurnEvent } from '../../../shared/protocol';
import { buildPrompt } from '../prompt';
import { asRecord, parseJson, pushCanonical, pushDone, pushError, pushFlexible, pushSession } from '../parse-util';
import type { Adapter } from './adapter';

// Verified against https://antigravity.google/docs/cli/headless/ (2026-11-13).
// stream-json: init, step_update.step_update.text_delta, result.result.response / conversation_id.
// No documented flag disables every tool. Headless soft-denies approvals; --sandbox is set.
// --dangerously-skip-permissions is never passed.
export const agy = {
  id: 'agy',
  label: 'Antigravity',
  detail: 'Google AI subscription',
  command: 'agy',
  optIn: false,
  installHint: 'Install the Antigravity CLI so agy is on your PATH',
  loginHint: 'agy',
  buildTurn(turn, _cwd) {
    const prompt = buildPrompt(turn);
    const args = ['-p', prompt, '--output-format', 'stream-json', '--sandbox'];
    if (turn.providerSessionId) args.push('--conversation', turn.providerSessionId);
    return { command: 'agy', args, stdin: null, preassignedSessionId: null };
  },
  parseLine(line, state) {
    const obj = parseJson(line);
    if (!obj) return [];
    const events: TurnEvent[] = [];
    if (obj.event === 'init') pushSession(state, events, obj.conversation_id);
    if (obj.event === 'step_update') {
      const step = asRecord(obj.step_update) || {};
      pushSession(state, events, step.conversation_id);
      if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
        pushFlexible(state, events, step.text_delta);
      }
    }
    if (obj.event === 'result') {
      const result = asRecord(obj.result) || {};
      pushSession(state, events, result.conversation_id || obj.conversation_id);
      const status = result.status || obj.status;
      if (status && status !== 'SUCCESS') {
        const reason = result.error || obj.error || status;
        pushError(state, events, typeof reason === 'string' ? reason : errorString(reason));
      } else {
        const response = typeof result.response === 'string' ? result.response : obj.response;
        if (typeof response === 'string' && response) pushCanonical(state, events, response);
        pushDone(state, events);
      }
    }
    return events;
  },
} satisfies Adapter;

function errorString(value: unknown): string {
  if (typeof value === 'string') return value;
  return 'The CLI reported an error.';
}

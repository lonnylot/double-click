import type { TurnEvent } from '../../../shared/protocol';
import { buildPrompt } from '../prompt';
import { contentText, parseJson, pushCanonical, pushDone, pushError, pushFlexible, pushSession } from '../parse-util';
import type { Adapter } from './adapter';

// Flags and stream-json rules verified against
// https://cursor.com/docs/cli/reference/parameters and
// https://cursor.com/docs/cli/reference/output-format (2026-11-13).
// The binary is always cursor-agent, never the generic agent name.
export const cursor = {
  id: 'cursor',
  label: 'Cursor',
  detail: 'Cursor subscription',
  command: 'cursor-agent',
  optIn: false,
  installHint: 'curl https://cursor.com/install -fsS | bash',
  loginHint: 'cursor-agent login',
  buildTurn(turn, cwd) {
    const prompt = buildPrompt(turn);
    const args = [
      '--print',
      '--mode',
      'ask',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--sandbox',
      'enabled',
      '--trust',
      '--workspace',
      cwd,
    ];
    if (turn.providerSessionId) args.push('--resume', turn.providerSessionId);
    return { command: 'cursor-agent', args, stdin: prompt, preassignedSessionId: null };
  },
  parseLine(line, state) {
    const obj = parseJson(line);
    if (!obj) return [];
    const events: TurnEvent[] = [];
    if (obj.type === 'system' && obj.subtype === 'init') {
      pushSession(state, events, obj.session_id);
    }
    if (obj.type === 'assistant') {
      const hasTimestamp = obj.timestamp_ms !== undefined && obj.timestamp_ms !== null;
      const hasModelCall = obj.model_call_id !== undefined && obj.model_call_id !== null;
      // Buffered flush before a tool call, and the final duplicate flush, are not new text.
      if (hasModelCall || (!hasTimestamp && state.sawDelta)) return events;
      const text = contentText(obj.message);
      if (hasTimestamp || !state.sawText) pushFlexible(state, events, text);
    }
    if (obj.type === 'result') {
      pushSession(state, events, obj.session_id);
      if (obj.is_error || obj.subtype === 'error') {
        const reason = obj.result || obj.error || 'Cursor CLI reported an error.';
        pushError(state, events, typeof reason === 'string' ? reason : 'Cursor CLI reported an error.');
      } else {
        if (typeof obj.result === 'string') pushCanonical(state, events, obj.result);
        pushDone(state, events);
      }
    }
    return events;
  },
} satisfies Adapter;

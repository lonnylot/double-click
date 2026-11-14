import type { TurnEvent } from '../../../shared/protocol';
import { buildPrompt } from '../prompt';
import { asRecord, parseJson, pushCanonical, pushDone, pushError, pushFlexible, pushSession } from '../parse-util';
import type { Adapter } from './adapter';

// Verified against https://code.claude.com/docs/en/headless (2026-11-13).
// Token deltas: type stream_event, event.delta.type text_delta.
// --resume is documented. --session-id preassign is used only when the CLI returns a session_id.
// --bare is intentionally never passed: bare mode skips subscription OAuth.
export const claude = {
  id: 'claude',
  label: 'Claude Code',
  detail: 'Claude subscription, opt-in',
  command: 'claude',
  optIn: true,
  caveat:
    'Anthropic’s terms do not allow third-party products to route requests through Claude plan credentials. Double Click AI only starts the Claude Code program already installed on this computer and never reads your login files.',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  loginHint: 'claude auth login',
  buildTurn(turn, _cwd) {
    const prompt = buildPrompt(turn);
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--tools',
      '',
      '--disallowedTools',
      'mcp__*',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--max-turns',
      '1',
      '--permission-mode',
      'dontAsk',
      '--permission-prompts',
      'none',
    ];
    if (turn.providerSessionId) args.push('--resume', turn.providerSessionId);
    if (args.includes('--bare')) {
      throw new Error('Refusing to launch Claude Code with --bare');
    }
    return { command: 'claude', args, stdin: null, preassignedSessionId: null };
  },
  parseLine(line, state) {
    const obj = parseJson(line);
    if (!obj) return [];
    const events: TurnEvent[] = [];
    pushSession(state, events, obj.session_id);
    if (obj.type === 'stream_event') {
      const event = asRecord(obj.event);
      const delta = event ? asRecord(event.delta) : null;
      if (delta && delta.type === 'text_delta' && typeof delta.text === 'string') {
        pushFlexible(state, events, delta.text);
      }
    }
    if (obj.type === 'result') {
      if (obj.is_error || obj.subtype === 'error') {
        const reason = obj.error || obj.result || 'Claude Code reported an error.';
        pushError(state, events, typeof reason === 'string' ? reason : 'Claude Code reported an error.');
      } else {
        if (typeof obj.result === 'string') pushCanonical(state, events, obj.result);
        pushDone(state, events);
      }
    }
    return events;
  },
} satisfies Adapter;

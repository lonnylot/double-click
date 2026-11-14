import { randomUUID } from 'crypto';
import type { TurnEvent } from '../../../shared/protocol';
import { buildPrompt } from '../prompt';
import { parseJson, pushDone, pushError, pushFlexible, pushMessage, pushSession } from '../parse-util';
import type { Adapter } from './adapter';

// streaming-json shape verified against xai-org/grok-build user guide
// crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md (2026-11-13):
// {type:text,data}, {type:end,sessionId}, {type:error,message}. Thoughts are ignored.
export const grok = {
  id: 'grok',
  label: 'Grok',
  detail: 'SuperGrok or X Premium+',
  command: 'grok',
  optIn: false,
  installHint: 'curl -fsSL https://x.ai/cli/install.sh | bash',
  loginHint: 'grok login',
  buildTurn(turn, cwd) {
    const sessionId = turn.providerSessionId || randomUUID();
    const prompt = buildPrompt(turn);
    const args = [
      '--no-auto-update',
      '--output-format',
      'streaming-json',
      '-s',
      sessionId,
      '--cwd',
      cwd,
      '--max-turns',
      '1',
      '--no-plan',
      '--no-subagents',
      '--no-memory',
      '--disable-web-search',
      '--disallowed-tools',
      'run_terminal_cmd,search_replace,web_search,web_fetch,read_file,grep,list_dir,Agent',
      '--deny',
      'Bash',
      '--deny',
      'Edit',
      '--deny',
      'Write',
      '--deny',
      'Read',
      '--deny',
      'Grep',
      '--deny',
      'WebFetch',
      '--deny',
      'MCPTool',
      '-p',
      prompt,
    ];
    return { command: 'grok', args, stdin: null, preassignedSessionId: sessionId };
  },
  parseLine(line, state) {
    const obj = parseJson(line);
    if (!obj) return [];
    const events: TurnEvent[] = [];
    if (obj.type === 'text') pushFlexible(state, events, typeof obj.data === 'string' ? obj.data : '');
    if (obj.type === 'end') {
      pushSession(state, events, obj.sessionId || obj.session_id);
      pushDone(state, events);
    }
    if (obj.type === 'error') {
      pushError(state, events, typeof obj.message === 'string' ? obj.message : 'Grok CLI reported an error.');
    }
    if (!obj.type && typeof obj.text === 'string') {
      pushSession(state, events, obj.sessionId);
      pushMessage(state, events, obj.text);
      pushDone(state, events);
    }
    return events;
  },
} satisfies Adapter;

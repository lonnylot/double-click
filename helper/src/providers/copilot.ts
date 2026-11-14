import { randomUUID } from 'crypto';
import type { TurnEvent } from '../../../shared/protocol';
import { buildPrompt } from '../prompt';
import { asRecord, parseJson, pushDone, pushError, pushFlexible, pushMessage, pushSession } from '../parse-util';
import type { Adapter } from './adapter';

// Flags verified against the GitHub Copilot CLI command reference (2026-11-13).
// --silent is omitted: combined with --output-format=json it keeps only the final record.
// Event names follow the Copilot CLI JSONL envelope
// (session.start, assistant.message_delta data.deltaContent, assistant.message data.content,
// session.error, session.shutdown), as published in the Copilot SDK streaming events.
const EXCLUDED_TOOLS = [
  'bash',
  'powershell',
  'list_bash',
  'list_powershell',
  'read_bash',
  'read_powershell',
  'stop_bash',
  'stop_powershell',
  'write_bash',
  'write_powershell',
  'apply_patch',
  'create',
  'edit',
  'view',
  'list_agents',
  'read_agent',
  'task',
  'write_agent',
  'ask_user',
  'glob',
  'grep',
  'rg',
  'skill',
  'web_fetch',
].join(',');

export const copilot = {
  id: 'copilot',
  label: 'Copilot',
  detail: 'GitHub Copilot subscription',
  command: 'copilot',
  optIn: false,
  installHint: 'npm install -g @github/copilot',
  loginHint: 'copilot login',
  buildTurn(turn, cwd) {
    const sessionId = turn.providerSessionId || randomUUID();
    const prompt = buildPrompt(turn);
    const args = [
      '--session-id',
      sessionId,
      '--output-format=json',
      '--stream=on',
      '--no-ask-user',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      '--no-auto-update',
      '--sandbox',
      '-C',
      cwd,
      '--excluded-tools=' + EXCLUDED_TOOLS,
      '--deny-tool=shell,write,url,read,memory',
    ];
    // Prompt is piped on stdin. Passing -p would ignore that pipe.
    return { command: 'copilot', args, stdin: prompt, preassignedSessionId: sessionId };
  },
  parseLine(line, state) {
    const obj = parseJson(line);
    if (!obj) return [];
    const events: TurnEvent[] = [];
    const data = asRecord(obj.data) || {};
    if (obj.type === 'session.start' || obj.type === 'session.resume') {
      pushSession(state, events, data.sessionId || obj.sessionId);
    }
    if (obj.type === 'assistant.message_delta') {
      pushFlexible(state, events, typeof data.deltaContent === 'string' ? data.deltaContent : '');
    }
    if (obj.type === 'assistant.message') {
      pushMessage(state, events, typeof data.content === 'string' ? data.content : '');
    }
    if (obj.type === 'session.error') {
      pushError(state, events, typeof data.message === 'string' ? data.message : 'Copilot CLI reported an error.');
    }
    if (obj.type === 'session.shutdown') pushDone(state, events);
    return events;
  },
} satisfies Adapter;

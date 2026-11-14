import type { ErrorEvent, ParseState, SessionEvent, TextEvent, TurnEvent } from '../../shared/protocol';

export function createState(): ParseState {
  return {
    text: '',
    sessionId: null,
    sawText: false,
    sawDelta: false,
    plain: [],
    done: false,
  };
}

export function pushSession(state: ParseState, events: TurnEvent[], id: unknown): void {
  if (!id) return;
  const value = String(id);
  if (state.sessionId === value) return;
  state.sessionId = value;
  const event: SessionEvent = { kind: 'session', providerSessionId: value };
  events.push(event);
}

export function pushDelta(state: ParseState, events: TurnEvent[], text: unknown): void {
  if (!text) return;
  const value = String(text);
  state.text += value;
  state.sawText = true;
  state.sawDelta = true;
  events.push({ kind: 'delta', text: value });
}

export function pushCanonical(state: ParseState, events: TurnEvent[], text: unknown): void {
  if (typeof text !== 'string' || !text) return;
  if (text === state.text) return;
  state.text = text;
  state.sawText = true;
  const event: TextEvent = { kind: 'text', text };
  events.push(event);
}

// Deltas are appended. A chunk that repeats the whole answer so far is treated as a snapshot.
export function pushFlexible(state: ParseState, events: TurnEvent[], chunk: unknown): void {
  if (!chunk || typeof chunk !== 'string') return;
  if (state.text && chunk === state.text) return;
  if (
    state.text &&
    chunk.startsWith(state.text) &&
    chunk.length > state.text.length &&
    state.text.length >= 24
  ) {
    pushCanonical(state, events, chunk);
    return;
  }
  pushDelta(state, events, chunk);
}

export function pushMessage(state: ParseState, events: TurnEvent[], text: unknown): void {
  if (!text || typeof text !== 'string') return;
  if (!state.text) {
    pushDelta(state, events, text);
    return;
  }
  if (text === state.text || text.startsWith(state.text)) {
    pushCanonical(state, events, text);
    return;
  }
  const gap = state.text.endsWith('\n') ? '' : '\n\n';
  pushDelta(state, events, gap + text);
}

export function pushDone(state: ParseState, events: TurnEvent[]): void {
  if (state.done) return;
  state.done = true;
  events.push({ kind: 'done', text: state.text });
}

export function pushError(state: ParseState, events: TurnEvent[], message: unknown, code?: string): void {
  if (state.done) return;
  state.done = true;
  const event: ErrorEvent = {
    kind: 'error',
    message: typeof message === 'string' && message ? message : 'The CLI reported an error.',
    code: code || 'cli_error',
  };
  events.push(event);
}

export function parseJson(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch (_err) {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function contentText(message: unknown): string {
  const record = asRecord(message);
  if (!record) return '';
  const content = record.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is Record<string, unknown> => {
      const entry = asRecord(block);
      if (!entry) return false;
      return (entry.type === 'text' || entry.type === undefined) && typeof entry.text === 'string';
    })
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
}

export function errorText(value: unknown): string {
  if (!value) return 'The CLI reported an error.';
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return 'The CLI reported an error.';
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  return 'The CLI reported an error.';
}

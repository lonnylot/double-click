'use strict';

function createState() {
  return {
    text: '',
    sessionId: null,
    sawText: false,
    sawDelta: false,
    plain: [],
    done: false,
  };
}

function pushSession(state, events, id) {
  if (!id) return;
  const value = String(id);
  if (state.sessionId === value) return;
  state.sessionId = value;
  events.push({ kind: 'session', providerSessionId: value });
}

function pushDelta(state, events, text) {
  if (!text) return;
  state.text += text;
  state.sawText = true;
  state.sawDelta = true;
  events.push({ kind: 'delta', text });
}

function pushCanonical(state, events, text) {
  if (typeof text !== 'string' || !text) return;
  if (text === state.text) return;
  state.text = text;
  state.sawText = true;
  events.push({ kind: 'text', text });
}

// Deltas are appended. A chunk that repeats the whole answer so far is treated as a snapshot.
function pushFlexible(state, events, chunk) {
  if (!chunk) return;
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

function pushMessage(state, events, text) {
  if (!text) return;
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

function pushDone(state, events) {
  if (state.done) return;
  state.done = true;
  events.push({ kind: 'done', text: state.text });
}

function pushError(state, events, message, code) {
  if (state.done) return;
  state.done = true;
  events.push({
    kind: 'error',
    message: message || 'The CLI reported an error.',
    code: code || 'cli_error',
  });
}

function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch (_err) {
    return null;
  }
}

function contentText(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && (block.type === 'text' || block.type === undefined) && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function errorText(value) {
  if (!value) return 'The CLI reported an error.';
  if (typeof value === 'string') return value;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error === 'string') return value.error;
  return 'The CLI reported an error.';
}

module.exports = {
  createState,
  pushSession,
  pushDelta,
  pushCanonical,
  pushFlexible,
  pushMessage,
  pushDone,
  pushError,
  parseJson,
  contentText,
  errorText,
};

'use strict';

const mock = {
  id: 'mock',
  label: 'Sample reply',
  detail: 'Local preview',
  command: null,
  optIn: false,
  demo: true,
  installHint: '',
  loginHint: '',
  buildTurn(turn) {
    const sessionId = turn.providerSessionId || 'mock-' + turn.conversationId;
    return { command: null, args: [], stdin: null, preassignedSessionId: sessionId, mock: true };
  },
  answer(turn) {
    const passage = String((turn.selection && turn.selection.text) || '').trim();
    const clip = passage.length > 220 ? passage.slice(0, 217) + '…' : passage;
    const follow = turn.providerSessionId
      ? 'Continuing the same highlight.'
      : 'This is a local sample so you can try the conversation before a provider is signed in.';
    const lines = [
      follow,
      '',
      clip ? 'The passage says: “' + clip + '”' : 'No passage was attached.',
      '',
      '**What stands out**',
      '',
      '- The highlight is specific enough to ask a follow-up.',
      '- A signed-in provider replaces this sample with its own answer.',
      '',
      'Ask another question in this thread and it stays on the same passage.',
    ];
    return lines.join('\n');
  },
  parseLine() {
    return [];
  },
};

module.exports = { mock };

'use strict';

const { buildPrompt } = require('../prompt');
const {
  parseJson,
  pushSession,
  pushFlexible,
  pushCanonical,
  pushDone,
  pushError,
} = require('../parse-util');

// Verified against https://antigravity.google/docs/cli/headless/ (2026-11-13).
// stream-json: init, step_update.step_update.text_delta, result.result.response / conversation_id.
// No documented flag disables every tool. Headless soft-denies approvals; --sandbox is set.
// --dangerously-skip-permissions is never passed.
const agy = {
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
    if (!obj || typeof obj !== 'object') return [];
    const events = [];
    if (obj.event === 'init') pushSession(state, events, obj.conversation_id);
    if (obj.event === 'step_update') {
      const step = obj.step_update || {};
      pushSession(state, events, step.conversation_id);
      if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
        pushFlexible(state, events, step.text_delta);
      }
    }
    if (obj.event === 'result') {
      const result = obj.result || {};
      pushSession(state, events, result.conversation_id || obj.conversation_id);
      const status = result.status || obj.status;
      if (status && status !== 'SUCCESS') {
        pushError(state, events, result.error || obj.error || status);
      } else {
        const response = typeof result.response === 'string' ? result.response : obj.response;
        if (response) pushCanonical(state, events, response);
        pushDone(state, events);
      }
    }
    return events;
  },
};

module.exports = { agy };

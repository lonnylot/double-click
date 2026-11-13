'use strict';

const os = require('os');
const path = require('path');
const { ADAPTERS } = require('./providers');
const { which } = require('./which');
const { SessionMap } = require('./sessions');
const { runTurn } = require('./run-turn');

function describeProviders(env) {
  return ADAPTERS.map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    detail: adapter.detail || '',
    optIn: Boolean(adapter.optIn),
    demo: Boolean(adapter.demo),
    caveat: adapter.caveat || '',
    installHint: adapter.installHint || '',
    loginHint: adapter.loginHint || '',
    installed: Boolean(adapter.demo) || Boolean(adapter.command && which(adapter.command, env)),
  }));
}

function createRuntime(options = {}) {
  const env = options.env || process.env;
  const home = options.home || env.DOUBLE_CLICK_HOME || path.join(os.homedir(), '.double-click');
  const sessions = options.sessions || new SessionMap(path.join(home, 'sessions.json'));
  const controllers = new Map();

  async function handle(msg, send) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      send({ type: 'pong' });
      return;
    }
    if (msg.type === 'providers') {
      send({ type: 'providers', providers: describeProviders(env) });
      return;
    }
    if (msg.type === 'forget') {
      if (msg.conversationId) sessions.delete(msg.conversationId);
      send({ type: 'forgot', conversationId: msg.conversationId || null });
      return;
    }
    if (msg.type === 'echo' && env.DOUBLE_CLICK_TEST_ECHO === '1') {
      send({ type: 'echo', data: msg.data });
      return;
    }
    if (msg.type === 'cancel') {
      const controller = controllers.get(msg.requestId);
      if (controller) controller.abort();
      return;
    }
    if (msg.type !== 'turn') {
      send({ type: 'error', requestId: msg.requestId, message: 'Unknown message.' });
      return;
    }

    const controller = new AbortController();
    if (msg.requestId) controllers.set(msg.requestId, controller);
    try {
      await runTurn(
        {
          requestId: msg.requestId,
          conversationId: msg.conversationId,
          provider: msg.provider,
          providerSessionId: msg.providerSessionId || null,
          selection: msg.selection || {},
          userText: msg.userText,
          priorMessages: msg.priorMessages || [],
          claudeOptIn: msg.claudeOptIn === true,
        },
        {
          env,
          sessions,
          signal: controller.signal,
          onEvent(event) {
            send({ type: 'event', requestId: msg.requestId, event });
          },
        },
      );
    } finally {
      controllers.delete(msg.requestId);
    }
  }

  return { handle, sessions, describeProviders: () => describeProviders(env) };
}

module.exports = { createRuntime, describeProviders };

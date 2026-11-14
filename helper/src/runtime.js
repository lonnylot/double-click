'use strict';

const os = require('os');
const path = require('path');
const { ADAPTERS } = require('./providers');
const { which, classifyOverride } = require('./which');
const { withUserPath } = require('./user-path');
const { SessionMap } = require('./sessions');
const { runTurn } = require('./run-turn');

const PROVIDER_IDS = new Set(ADAPTERS.map((adapter) => adapter.id));

function sanitizeProviderPaths(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [id, raw] of Object.entries(value)) {
    if (!PROVIDER_IDS.has(id) || id === 'mock') continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 1024 || /[\r\n\0]/.test(trimmed)) continue;
    out[id] = trimmed;
  }
  return out;
}

function describeProviders(env, providerPaths = {}) {
  const paths = sanitizeProviderPaths(providerPaths);
  return ADAPTERS.map((adapter) => {
    const custom = paths[adapter.id] || '';
    const detected = !adapter.demo && adapter.command ? (which(adapter.command, env) || '') : '';
    let resolved = detected;
    let pathNote = '';
    if (!adapter.demo && custom) {
      const judged = classifyOverride(custom);
      resolved = judged.path || '';
      pathNote = judged.note || '';
    }
    return {
      id: adapter.id,
      label: adapter.label,
      detail: adapter.detail || '',
      optIn: Boolean(adapter.optIn),
      demo: Boolean(adapter.demo),
      caveat: adapter.caveat || '',
      installHint: adapter.installHint || '',
      loginHint: adapter.loginHint || '',
      installed: Boolean(adapter.demo) || Boolean(resolved),
      resolvedPath: resolved,
      detectedPath: detected,
      pathNote,
    };
  });
}

function createRuntime(options = {}) {
  const baseEnv = options.env || process.env;
  const env = options.userPath === false
    ? baseEnv
    : withUserPath(baseEnv, {
      cache: !options.env,
      ...(options.pathOptions || {}),
      env: baseEnv,
    });
  const home = options.home || env.DOUBLE_CLICK_HOME || path.join(os.homedir(), '.double-click');
  const sessions = options.sessions || new SessionMap(path.join(home, 'sessions.json'));
  const controllers = new Map();
  let providerPaths = sanitizeProviderPaths(options.providerPaths);

  async function handle(msg, send) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      send({ type: 'pong' });
      return;
    }
    if (msg.type === 'providers') {
      if (msg.providerPaths) providerPaths = sanitizeProviderPaths(msg.providerPaths);
      send({ type: 'providers', providers: describeProviders(env, providerPaths) });
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
          providerPath: typeof msg.providerPath === 'string'
            ? msg.providerPath
            : (providerPaths[msg.provider] || ''),
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

  return {
    handle,
    sessions,
    env,
    describeProviders: () => describeProviders(env, providerPaths),
  };
}

module.exports = { createRuntime, describeProviders, sanitizeProviderPaths };

import * as os from 'os';
import * as path from 'path';
import type { HostEvent, ProviderPaths, ProviderStatus, TurnEvent, TurnInput } from '../../shared/protocol';
import { ADAPTERS } from './providers';
import { runTurn } from './run-turn';
import { SessionMap } from './sessions';
import { withUserPath, type UserPathOptions } from './user-path';
import { classifyOverride, which } from './which';

const PROVIDER_IDS = new Set(ADAPTERS.map((adapter) => adapter.id));

export function sanitizeProviderPaths(value: unknown): ProviderPaths {
  const out: ProviderPaths = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, raw] of Object.entries(value)) {
    if (!PROVIDER_IDS.has(id) || id === 'mock') continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 1024 || /[\r\n\0]/.test(trimmed)) continue;
    out[id] = trimmed;
  }
  return out;
}

export function describeProviders(env: NodeJS.ProcessEnv, providerPaths: ProviderPaths = {}): ProviderStatus[] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  userPath?: boolean;
  pathOptions?: UserPathOptions;
  home?: string;
  sessions?: SessionMap;
  providerPaths?: ProviderPaths;
}

export interface Runtime {
  handle: (msg: unknown, send: (message: HostEvent) => void) => Promise<void>;
  sessions: SessionMap;
  env: NodeJS.ProcessEnv;
  describeProviders: () => ProviderStatus[];
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
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
  const controllers = new Map<string, AbortController>();
  let providerPaths = sanitizeProviderPaths(options.providerPaths);

  async function handle(msg: unknown, send: (message: HostEvent) => void): Promise<void> {
    if (!isRecord(msg)) return;
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
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
      const forgotten = typeof msg.conversationId === 'string' ? msg.conversationId : '';
      if (forgotten) sessions.delete(forgotten);
      send({ type: 'forgot', conversationId: forgotten || null });
      return;
    }
    if (msg.type === 'echo' && env.DOUBLE_CLICK_TEST_ECHO === '1') {
      send({ type: 'echo', data: msg.data });
      return;
    }
    if (msg.type === 'cancel') {
      const controller = requestId ? controllers.get(requestId) : undefined;
      if (controller) controller.abort();
      return;
    }
    if (msg.type !== 'turn') {
      send({ type: 'error', requestId, message: 'Unknown message.' });
      return;
    }

    const provider = typeof msg.provider === 'string' ? msg.provider : undefined;
    const controller = new AbortController();
    if (requestId) controllers.set(requestId, controller);
    const selection = isRecord(msg.selection) ? msg.selection : {};
    const turn: TurnInput = {
      requestId,
      conversationId: typeof msg.conversationId === 'string' ? msg.conversationId : undefined,
      provider,
      providerSessionId: typeof msg.providerSessionId === 'string' ? msg.providerSessionId : null,
      selection: {
        text: typeof selection.text === 'string' ? selection.text : undefined,
        title: typeof selection.title === 'string' ? selection.title : undefined,
        url: typeof selection.url === 'string' ? selection.url : undefined,
      },
      userText: typeof msg.userText === 'string' ? msg.userText : undefined,
      priorMessages: Array.isArray(msg.priorMessages)
        ? msg.priorMessages.filter(isRecord).map((message) => ({
          role: typeof message.role === 'string' ? message.role : undefined,
          content: typeof message.content === 'string' ? message.content : undefined,
        }))
        : [],
      claudeOptIn: msg.claudeOptIn === true,
      providerPath: typeof msg.providerPath === 'string'
        ? msg.providerPath
        : (provider ? (providerPaths[provider] || '') : ''),
    };
    try {
      await runTurn(turn, {
        env,
        sessions,
        signal: controller.signal,
        onEvent(event: TurnEvent) {
          send({ type: 'event', requestId, event });
        },
      });
    } finally {
      if (requestId) controllers.delete(requestId);
    }
  }

  return {
    handle,
    sessions,
    env,
    describeProviders: () => describeProviders(env, providerPaths),
  };
}

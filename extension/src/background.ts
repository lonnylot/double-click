import { Reassembler } from '../../shared/chunking';
import type { HostEvent, ProviderStatus, TurnEvent } from '../../shared/protocol';
import * as db from './lib/db';
import type { Conversation, StoredMessage } from './lib/db';
import { HOST_NAME, byId, LIST } from './lib/providers';

const chunks = new Reassembler();
const clients = new Set<chrome.runtime.Port>();
const inflight = new Map<string, TurnState>();
let nativePort: chrome.runtime.Port | null = null;
let nativeError = 'The helper is not connected yet.';
let providers: ProviderStatus[] = [];

interface Settings {
  provider: string;
  claudeOptIn: boolean;
  providerPaths: Record<string, string>;
}

interface TurnState {
  requestId: string;
  conversationId: string;
  port: chrome.runtime.Port;
  provider: string;
  providerSessionId: string | null;
  assistantText: string;
  finished: boolean;
}

let settings: Settings = { provider: 'codex', claudeOptIn: false, providerPaths: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textOf(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && err.message) return String(err.message);
  return fallback;
}

function sanitizeProviderPaths(value: unknown): Record<string, string> {
  const ids = new Set(LIST.map((item) => item.id));
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [id, raw] of Object.entries(value)) {
    if (!ids.has(id) || id === 'mock' || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 1024 || /[\r\n\0]/.test(trimmed)) continue;
    out[id] = trimmed;
  }
  return out;
}

function post(port: chrome.runtime.Port, message: object): void {
  try {
    port.postMessage(message);
  } catch (_err) {
    clients.delete(port);
  }
}

function broadcast(message: object): void {
  for (const port of clients) post(port, message);
}

async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  const saved: unknown = stored.settings;
  settings = Object.assign({ provider: 'codex', claudeOptIn: false, providerPaths: {} }, isRecord(saved) ? saved : {});
  if (typeof settings.provider !== 'string' || !byId(settings.provider)) settings.provider = 'codex';
  settings.claudeOptIn = settings.claudeOptIn === true;
  settings.providerPaths = sanitizeProviderPaths(settings.providerPaths);
  return settings;
}

async function saveSettings(next: unknown): Promise<Settings> {
  const incoming = isRecord(next) ? next : {};
  settings = {
    provider: typeof incoming.provider === 'string' && byId(incoming.provider) ? incoming.provider : settings.provider,
    claudeOptIn: incoming.claudeOptIn === true,
    providerPaths: Object.prototype.hasOwnProperty.call(incoming, 'providerPaths')
      ? sanitizeProviderPaths(incoming.providerPaths)
      : settings.providerPaths,
  };
  await chrome.storage.local.set({ settings });
  broadcast({ type: 'settings', settings });
  requestProviders();
  return settings;
}

function requestProviders(): boolean {
  if (!nativePort) return false;
  try {
    nativePort.postMessage({ type: 'providers', providerPaths: settings.providerPaths || {} });
    return true;
  } catch (_err) {
    nativePort = null;
    return false;
  }
}

async function touchHistory(): Promise<void> {
  await chrome.storage.session.set({ historyRevision: Date.now() });
}

function connectNative(): boolean {
  if (nativePort) return true;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
  } catch (err) {
    nativeError = textOf(err, 'Could not connect to the helper.');
    nativePort = null;
    return false;
  }
  nativeError = '';
  nativePort.onMessage.addListener((message: unknown) => {
    let full: unknown = message;
    try {
      full = chunks.push(message);
    } catch (err) {
      nativeError = textOf(err, 'Could not read a helper message.');
      return;
    }
    if (!full) return;
    handleNative(full);
  });
  nativePort.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError && chrome.runtime.lastError.message;
    nativePort = null;
    nativeError = reason || 'The helper disconnected.';
    for (const [requestId, turn] of inflight) {
      failTurn(turn, requestId, {
        kind: 'error',
        code: 'disconnected',
        message: 'The helper disconnected before the reply finished.',
        hint: 'From the Double Click AI folder, run: node install.js',
      });
    }
    broadcast({ type: 'native-status', connected: false, error: nativeError });
  });
  if (!requestProviders()) {
    nativeError = nativeError || 'The helper rejected the connection.';
    return false;
  }
  return true;
}

function asHostEvent(message: unknown): HostEvent | null {
  if (!isRecord(message) || typeof message.type !== 'string') return null;
  return message as unknown as HostEvent;
}

function handleNative(message: unknown): void {
  const event = asHostEvent(message);
  if (!event) return;
  if (event.type === 'providers') {
    providers = event.providers || [];
    broadcast({ type: 'providers', providers });
    return;
  }
  if (event.type === 'event' && event.requestId) {
    const turn = inflight.get(event.requestId);
    if (!turn) return;
    void applyEvent(turn, event.event);
    post(turn.port, { type: 'event', requestId: event.requestId, event: event.event });
    return;
  }
  if (event.type === 'error') {
    nativeError = event.message || 'Helper error';
    if (event.requestId && inflight.has(event.requestId)) {
      const turn = inflight.get(event.requestId);
      if (!turn) return;
      failTurn(turn, event.requestId, {
        kind: 'error',
        code: 'helper',
        message: nativeError,
        hint: '',
      });
    } else {
      broadcast({ type: 'native-status', connected: Boolean(nativePort), error: nativeError });
    }
  }
}

async function applyEvent(turn: TurnState, event: TurnEvent | undefined): Promise<void> {
  if (!event) return;
  if (event.kind === 'session' && event.providerSessionId) {
    turn.providerSessionId = event.providerSessionId;
    await db.update(turn.conversationId, (record) => {
      if (!record) return record;
      record.providerSessionId = event.providerSessionId;
      record.updatedAt = Date.now();
      return record;
    });
  } else if (event.kind === 'delta') {
    turn.assistantText += event.text || '';
  } else if (event.kind === 'text') {
    turn.assistantText = event.text || '';
  } else if (event.kind === 'done' || event.kind === 'error') {
    const text = 'text' in event ? event.text : undefined;
    if (typeof text === 'string' && text) turn.assistantText = text;
    await finishTurn(turn, event);
  }
}

async function finishTurn(turn: TurnState, event: TurnEvent): Promise<void> {
  if (turn.finished) return;
  turn.finished = true;
  inflight.delete(turn.requestId);
  const saved = await db.update(turn.conversationId, (record) => {
    if (!record) return record;
    if (turn.providerSessionId) record.providerSessionId = turn.providerSessionId;
    if (turn.assistantText) {
      record.messages.push({
        role: 'assistant',
        content: turn.assistantText,
        createdAt: Date.now(),
      });
    }
    record.lastError = event.kind === 'error'
      ? { message: event.message || 'Something went wrong.', hint: event.hint || '', code: event.code || '' }
      : null;
    record.updatedAt = Date.now();
    return record;
  });
  await touchHistory();
  post(turn.port, { type: 'persisted', requestId: turn.requestId, conversation: saved });
}

function failTurn(turn: TurnState, requestId: string, event: TurnEvent): void {
  post(turn.port, { type: 'event', requestId, event });
  void finishTurn(turn, event);
}

async function beginTurn(message: Record<string, unknown>, port: chrome.runtime.Port): Promise<void> {
  await loadSettings();
  const provider = typeof message.provider === 'string' ? message.provider : settings.provider;
  const requestId = typeof message.requestId === 'string' ? message.requestId : '';
  if (!byId(provider)) {
    post(port, {
      type: 'event',
      requestId,
      event: { kind: 'error', code: 'unknown_provider', message: 'Unknown provider.', hint: '' },
    });
    return;
  }
  if (provider === 'claude' && settings.claudeOptIn !== true) {
    post(port, {
      type: 'event',
      requestId,
      event: {
        kind: 'error',
        code: 'opt_in',
        message: 'Claude Code stays off until you enable it.',
        hint: byId('claude')?.caveat || '',
      },
    });
    return;
  }
  const userText = typeof message.userText === 'string' ? message.userText : '';
  if (!userText.trim()) {
    post(port, {
      type: 'event',
      requestId,
      event: { kind: 'error', code: 'empty', message: 'Write a question first.', hint: '' },
    });
    return;
  }

  const now = Date.now();
  const selection = isRecord(message.selection) ? message.selection : {};
  const conversationId = typeof message.conversationId === 'string' ? message.conversationId : '';
  const record = await db.update(conversationId, (current) => {
    const base: Conversation = current || {
      id: conversationId,
      url: typeof selection.url === 'string' ? selection.url : '',
      title: typeof selection.title === 'string' ? selection.title : '',
      selection: typeof selection.text === 'string' ? selection.text : '',
      provider,
      providerSessionId: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
      lastError: null,
    };
    if (base.provider !== provider) base.providerSessionId = null;
    base.provider = provider;
    base.title = base.title || (typeof selection.title === 'string' ? selection.title : '');
    base.url = base.url || (typeof selection.url === 'string' ? selection.url : '');
    base.selection = base.selection || (typeof selection.text === 'string' ? selection.text : '');
    base.messages.push({ role: 'user', content: String(message.userText), createdAt: now });
    base.updatedAt = now;
    base.lastError = null;
    return base;
  });
  if (!record) return;
  await touchHistory();

  const turn: TurnState = {
    requestId,
    conversationId,
    port,
    provider,
    providerSessionId: record.providerSessionId,
    assistantText: '',
    finished: false,
  };
  inflight.set(requestId, turn);

  if (!connectNative() || !nativePort) {
    failTurn(turn, requestId, {
      kind: 'error',
      code: 'no_helper',
      message: 'The Double Click AI helper is not installed.',
      hint: 'From the Double Click AI folder, run: node install.js',
    });
    return;
  }
  const portToHelper = nativePort;

  const prior: StoredMessage[] = record.messages.slice(0, -1);
  try {
    portToHelper.postMessage({
      type: 'turn',
      requestId,
      conversationId,
      provider,
      providerSessionId: record.providerSessionId,
      selection: {
        text: record.selection,
        title: record.title,
        url: record.url,
      },
      userText: message.userText,
      priorMessages: prior,
      claudeOptIn: settings.claudeOptIn === true,
      providerPath: (settings.providerPaths && settings.providerPaths[provider]) || '',
    });
  } catch (err) {
    failTurn(turn, requestId, {
      kind: 'error',
      code: 'no_helper',
      message: 'Could not reach the helper.',
      hint: textOf(err, 'From the Double Click AI folder, run: node install.js'),
    });
  }
}

function setupMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ask',
      title: 'Ask Double Click AI',
      contexts: ['selection'],
    });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  setupMenus();
  void loadSettings();
});
chrome.runtime.onStartup.addListener(() => {
  setupMenus();
  void loadSettings();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-chat') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  const sent = chrome.tabs.sendMessage(tab.id, { type: 'open-from-shortcut' });
  if (sent && typeof sent.catch === 'function') sent.catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ask' || !tab || !tab.id) return;
  const sent = chrome.tabs.sendMessage(tab.id, { type: 'open-from-shortcut' });
  if (sent && typeof sent.catch === 'function') sent.catch(() => {});
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'double-click') return;
  if (!port.sender || port.sender.id !== chrome.runtime.id) {
    port.disconnect();
    return;
  }
  clients.add(port);
  port.onDisconnect.addListener(() => clients.delete(port));
  port.onMessage.addListener((message: unknown) => {
    handleClient(message, port).catch((err: unknown) => {
      const requestId = isRecord(message) && typeof message.requestId === 'string' ? message.requestId : undefined;
      post(port, {
        type: 'event',
        requestId,
        event: { kind: 'error', code: 'helper', message: textOf(err, 'Something went wrong.'), hint: '' },
      });
    });
  });
});

async function handleClient(message: unknown, port: chrome.runtime.Port): Promise<void> {
  if (!isRecord(message) || typeof message.type !== 'string') return;
  if (message.type === 'hello') {
    await loadSettings();
    connectNative();
    post(port, {
      type: 'hello-ack',
      settings,
      providers,
      nativeConnected: Boolean(nativePort),
      nativeError: nativePort ? '' : nativeError,
    });
    return;
  }
  if (message.type === 'settings-set') {
    await saveSettings(message.settings || {});
    return;
  }
  if (message.type === 'history-list') {
    post(port, { type: 'history', conversations: await db.list() });
    return;
  }
  if (message.type === 'history-get') {
    const id = typeof message.id === 'string' ? message.id : '';
    post(port, { type: 'conversation', conversation: await db.get(id) });
    return;
  }
  if (message.type === 'history-delete') {
    const id = typeof message.id === 'string' ? message.id : '';
    await db.remove(id);
    if (nativePort && id) {
      try { nativePort.postMessage({ type: 'forget', conversationId: id }); } catch (_err) { /* helper may be down */ }
    }
    await touchHistory();
    post(port, { type: 'history', conversations: await db.list() });
    return;
  }
  if (message.type === 'history-delete-page') {
    const url = typeof message.url === 'string' ? message.url : '';
    const rows = await db.list();
    const ids = rows.filter((row) => row.url === url).map((row) => row.id);
    await db.removeMany(ids);
    if (nativePort) {
      for (const id of ids) {
        try { nativePort.postMessage({ type: 'forget', conversationId: id }); } catch (_err) { /* ignore */ }
      }
    }
    await touchHistory();
    post(port, { type: 'history', conversations: await db.list() });
    return;
  }
  if (message.type === 'open-history') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    return;
  }
  if (message.type === 'cancel') {
    if (nativePort) {
      try { nativePort.postMessage({ type: 'cancel', requestId: message.requestId }); } catch (_err) { /* ignore */ }
    }
    return;
  }
  if (message.type === 'turn') {
    await beginTurn(message, port);
  }
}

void loadSettings();

'use strict';

importScripts('lib/chunking.js', 'lib/db.js', 'lib/providers.js');

const chunks = new globalThis.DoubleClickChunks.Reassembler();
const clients = new Set();
const inflight = new Map();
let nativePort = null;
let nativeError = 'The helper is not connected yet.';
let providers = [];
let settings = { provider: 'codex', claudeOptIn: false };

function post(port, message) {
  try {
    port.postMessage(message);
  } catch (_err) {
    clients.delete(port);
  }
}

function broadcast(message) {
  for (const port of clients) post(port, message);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  settings = Object.assign({ provider: 'codex', claudeOptIn: false }, stored.settings || {});
  if (!globalThis.DoubleClickProviders.byId(settings.provider)) settings.provider = 'codex';
  settings.claudeOptIn = settings.claudeOptIn === true;
  return settings;
}

async function saveSettings(next) {
  settings = {
    provider: globalThis.DoubleClickProviders.byId(next.provider) ? next.provider : settings.provider,
    claudeOptIn: next.claudeOptIn === true,
  };
  await chrome.storage.local.set({ settings });
  broadcast({ type: 'settings', settings });
  return settings;
}

async function touchHistory() {
  await chrome.storage.session.set({ historyRevision: Date.now() });
}

function connectNative() {
  if (nativePort) return true;
  try {
    nativePort = chrome.runtime.connectNative(globalThis.DoubleClickProviders.HOST_NAME);
  } catch (err) {
    nativeError = (err && err.message) || 'Could not connect to the helper.';
    nativePort = null;
    return false;
  }
  nativeError = '';
  nativePort.onMessage.addListener((message) => {
    let full = message;
    try {
      full = chunks.push(message);
    } catch (err) {
      nativeError = err.message || 'Could not read a helper message.';
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
  try {
    nativePort.postMessage({ type: 'providers' });
  } catch (_err) {
    nativePort = null;
    nativeError = 'The helper rejected the connection.';
    return false;
  }
  return true;
}

function handleNative(message) {
  if (message.type === 'providers') {
    providers = message.providers || [];
    broadcast({ type: 'providers', providers });
    return;
  }
  if (message.type === 'event' && message.requestId) {
    const turn = inflight.get(message.requestId);
    if (!turn) return;
    applyEvent(turn, message.event);
    post(turn.port, { type: 'event', requestId: message.requestId, event: message.event });
    return;
  }
  if (message.type === 'error') {
    nativeError = message.message || 'Helper error';
    if (message.requestId && inflight.has(message.requestId)) {
      const turn = inflight.get(message.requestId);
      failTurn(turn, message.requestId, {
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

async function applyEvent(turn, event) {
  if (!event) return;
  if (event.kind === 'session' && event.providerSessionId) {
    turn.providerSessionId = event.providerSessionId;
    await globalThis.DoubleClickDB.update(turn.conversationId, (record) => {
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
    if (typeof event.text === 'string' && event.text) turn.assistantText = event.text;
    await finishTurn(turn, event);
  }
}

async function finishTurn(turn, event) {
  if (turn.finished) return;
  turn.finished = true;
  inflight.delete(turn.requestId);
  const saved = await globalThis.DoubleClickDB.update(turn.conversationId, (record) => {
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

function failTurn(turn, requestId, event) {
  post(turn.port, { type: 'event', requestId, event });
  finishTurn(turn, event);
}

async function beginTurn(message, port) {
  await loadSettings();
  const provider = message.provider || settings.provider;
  if (!globalThis.DoubleClickProviders.byId(provider)) {
    post(port, {
      type: 'event',
      requestId: message.requestId,
      event: { kind: 'error', code: 'unknown_provider', message: 'Unknown provider.', hint: '' },
    });
    return;
  }
  if (provider === 'claude' && settings.claudeOptIn !== true) {
    post(port, {
      type: 'event',
      requestId: message.requestId,
      event: {
        kind: 'error',
        code: 'opt_in',
        message: 'Claude Code stays off until you enable it.',
        hint: globalThis.DoubleClickProviders.byId('claude').caveat,
      },
    });
    return;
  }
  if (!String(message.userText || '').trim()) {
    post(port, {
      type: 'event',
      requestId: message.requestId,
      event: { kind: 'error', code: 'empty', message: 'Write a question first.', hint: '' },
    });
    return;
  }

  const now = Date.now();
  const selection = message.selection || {};
  const record = await globalThis.DoubleClickDB.update(message.conversationId, (current) => {
    const base = current || {
      id: message.conversationId,
      url: selection.url || '',
      title: selection.title || '',
      selection: selection.text || '',
      provider,
      providerSessionId: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
      lastError: null,
    };
    if (base.provider !== provider) base.providerSessionId = null;
    base.provider = provider;
    base.title = base.title || selection.title || '';
    base.url = base.url || selection.url || '';
    base.selection = base.selection || selection.text || '';
    base.messages.push({ role: 'user', content: String(message.userText), createdAt: now });
    base.updatedAt = now;
    base.lastError = null;
    return base;
  });
  await touchHistory();

  const turn = {
    requestId: message.requestId,
    conversationId: message.conversationId,
    port,
    provider,
    providerSessionId: record.providerSessionId,
    assistantText: '',
    finished: false,
  };
  inflight.set(message.requestId, turn);

  if (!connectNative()) {
    failTurn(turn, message.requestId, {
      kind: 'error',
      code: 'no_helper',
      message: 'The Double Click AI helper is not installed.',
      hint: 'From the Double Click AI folder, run: node install.js',
    });
    return;
  }

  const prior = record.messages.slice(0, -1);
  try {
    nativePort.postMessage({
      type: 'turn',
      requestId: message.requestId,
      conversationId: message.conversationId,
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
    });
  } catch (err) {
    failTurn(turn, message.requestId, {
      kind: 'error',
      code: 'no_helper',
      message: 'Could not reach the helper.',
      hint: (err && err.message) || 'From the Double Click AI folder, run: node install.js',
    });
  }
}

function setupMenus() {
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
  loadSettings();
});
chrome.runtime.onStartup.addListener(() => {
  setupMenus();
  loadSettings();
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
  port.onMessage.addListener((message) => {
    handleClient(message, port).catch((err) => {
      post(port, {
        type: 'event',
        requestId: message && message.requestId,
        event: { kind: 'error', code: 'helper', message: err.message || 'Something went wrong.', hint: '' },
      });
    });
  });
});

async function handleClient(message, port) {
  if (!message || typeof message !== 'object') return;
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
    post(port, { type: 'history', conversations: await globalThis.DoubleClickDB.list() });
    return;
  }
  if (message.type === 'history-get') {
    post(port, { type: 'conversation', conversation: await globalThis.DoubleClickDB.get(message.id) });
    return;
  }
  if (message.type === 'history-delete') {
    await globalThis.DoubleClickDB.remove(message.id);
    if (nativePort && message.id) {
      try { nativePort.postMessage({ type: 'forget', conversationId: message.id }); } catch (_err) { /* helper may be down */ }
    }
    await touchHistory();
    post(port, { type: 'history', conversations: await globalThis.DoubleClickDB.list() });
    return;
  }
  if (message.type === 'history-delete-page') {
    const rows = await globalThis.DoubleClickDB.list();
    const ids = rows.filter((row) => row.url === message.url).map((row) => row.id);
    await globalThis.DoubleClickDB.removeMany(ids);
    if (nativePort) {
      for (const id of ids) {
        try { nativePort.postMessage({ type: 'forget', conversationId: id }); } catch (_err) { /* ignore */ }
      }
    }
    await touchHistory();
    post(port, { type: 'history', conversations: await globalThis.DoubleClickDB.list() });
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

loadSettings();

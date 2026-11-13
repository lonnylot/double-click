'use strict';

const providerList = globalThis.DoubleClickProviders.LIST;
const markdown = globalThis.DoubleClickMarkdown.render;

const listEl = document.querySelector('#list');
const detailEl = document.querySelector('#detail');
const searchEl = document.querySelector('#search');
const statusEl = document.querySelector('#helper-status');
const providerEl = document.querySelector('#provider-list');

const state = {
  port: null,
  conversations: [],
  selectedId: null,
  query: '',
  settings: { provider: 'codex', claudeOptIn: false },
  providers: [],
  nativeConnected: false,
  nativeError: '',
  streaming: false,
  requestId: null,
  buffer: '',
  error: null,
  pendingDelete: null,
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function connect() {
  state.port = chrome.runtime.connect({ name: 'double-click' });
  state.port.onMessage.addListener(onMessage);
  state.port.onDisconnect.addListener(() => {
    state.port = null;
    state.nativeConnected = false;
    if (state.streaming) {
      state.streaming = false;
      state.error = { message: 'The helper disconnected.', hint: 'node install.js' };
      renderDetail();
    }
    setTimeout(connect, 400);
  });
  state.port.postMessage({ type: 'hello' });
  state.port.postMessage({ type: 'history-list' });
}

function onMessage(message) {
  if (!message) return;
  if (message.type === 'hello-ack' || message.type === 'settings' || message.type === 'providers') {
    if (message.settings) state.settings = message.settings;
    if (message.providers) state.providers = message.providers;
    if (message.type === 'hello-ack') {
      state.nativeConnected = Boolean(message.nativeConnected);
      state.nativeError = message.nativeError || '';
    }
    renderProviders();
  }
  if (message.type === 'history') {
    state.conversations = message.conversations || [];
    if (state.selectedId && !state.conversations.some((row) => row.id === state.selectedId)) {
      state.selectedId = null;
    }
    renderList();
    renderDetail();
  }
  if (message.type === 'conversation' && message.conversation && message.conversation.id === state.selectedId) {
    const index = state.conversations.findIndex((row) => row.id === message.conversation.id);
    if (index >= 0) state.conversations[index] = message.conversation;
    else state.conversations.unshift(message.conversation);
    renderList();
    renderDetail();
  }
  if (message.type === 'persisted' && message.conversation) {
    const index = state.conversations.findIndex((row) => row.id === message.conversation.id);
    if (index >= 0) state.conversations[index] = message.conversation;
    else state.conversations.unshift(message.conversation);
    if (message.requestId === state.requestId) {
      state.streaming = false;
      state.buffer = '';
    }
    renderList();
    renderDetail();
  }
  if (message.type === 'event' && message.requestId === state.requestId) {
    const event = message.event || {};
    if (event.kind === 'delta') state.buffer += event.text || '';
    if (event.kind === 'text') state.buffer = event.text || '';
    if (event.kind === 'done') {
      state.streaming = false;
      state.buffer = event.text || state.buffer;
      state.error = null;
    }
    if (event.kind === 'error') {
      state.streaming = false;
      state.error = event;
      state.buffer = '';
    }
    renderDetail();
  }
}

function selected() {
  return state.conversations.find((row) => row.id === state.selectedId) || null;
}

function matches(row) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  const blob = [
    row.title,
    row.url,
    row.selection,
    row.provider,
    ...(row.messages || []).map((message) => message.content),
  ].join('\n').toLowerCase();
  return blob.includes(query);
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch (_err) { /* ignore */ }
  return '';
}

function renderList() {
  const rows = state.conversations.filter(matches);
  listEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.conversations.length
      ? 'Nothing matches that search.'
      : 'Highlight text on a page and click Ask. Conversations land here.';
    listEl.append(empty);
    return;
  }
  const groups = new Map();
  for (const row of rows) {
    const key = row.url || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [url, items] of groups) {
    const group = document.createElement('section');
    const head = document.createElement('div');
    head.className = 'page-head';
    const titles = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'page-title';
    title.textContent = items[0].title || 'Untitled page';
    const link = document.createElement('div');
    link.className = 'page-url';
    const href = safeUrl(url);
    if (href) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = href;
      link.append(anchor);
    }
    titles.append(title, link);
    const removePage = document.createElement('button');
    removePage.type = 'button';
    removePage.className = 'ghost';
    removePage.textContent = 'Delete page';
    removePage.addEventListener('click', () => {
      state.port.postMessage({ type: 'history-delete-page', url });
    });
    head.append(titles, removePage);
    group.append(head);
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'item' + (item.id === state.selectedId ? ' active' : '');
      const excerpt = document.createElement('div');
      excerpt.className = 'excerpt';
      excerpt.textContent = item.selection || '';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const label = (providerList.find((entry) => entry.id === item.provider) || {}).label || item.provider;
      meta.textContent = label + ' · ' + formatTime(item.updatedAt);
      button.append(excerpt, meta);
      button.addEventListener('click', () => {
        state.selectedId = item.id;
        state.error = null;
        state.buffer = '';
        state.streaming = false;
        renderList();
        renderDetail();
      });
      group.append(button);
    }
    listEl.append(group);
  }
}

function renderDetail() {
  const row = selected();
  detailEl.replaceChildren();
  if (!row) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Choose a highlight to read the conversation and continue it.';
    detailEl.append(empty);
    return;
  }
  const head = document.createElement('div');
  head.className = 'detail-actions';
  const heading = document.createElement('h2');
  heading.textContent = row.title || 'Untitled page';
  const label = (providerList.find((entry) => entry.id === row.provider) || {}).label || row.provider;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = label;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = state.pendingDelete === row.id ? 'Confirm delete' : 'Delete';
  remove.addEventListener('click', () => {
    if (state.pendingDelete !== row.id) {
      state.pendingDelete = row.id;
      renderDetail();
      return;
    }
    state.pendingDelete = null;
    state.port.postMessage({ type: 'history-delete', id: row.id });
  });
  head.append(heading, meta, remove);

  const passage = document.createElement('blockquote');
  passage.className = 'passage';
  passage.textContent = row.selection || '';

  const thread = document.createElement('div');
  thread.className = 'thread';
  for (const message of row.messages || []) {
    const article = document.createElement('article');
    article.className = 'msg ' + message.role;
    if (message.role === 'assistant') {
      const body = document.createElement('div');
      body.className = 'md';
      body.innerHTML = markdown(message.content);
      article.append(body);
    } else {
      const paragraph = document.createElement('p');
      paragraph.textContent = message.content;
      article.append(paragraph);
    }
    thread.append(article);
  }
  if (state.buffer) {
    const article = document.createElement('article');
    article.className = 'msg assistant';
    const body = document.createElement('div');
    body.className = 'md';
    body.innerHTML = markdown(state.buffer);
    article.append(body);
    thread.append(article);
  }
  if (state.error) {
    const banner = document.createElement('div');
    banner.className = 'error';
    banner.textContent = state.error.message || 'Something went wrong.';
    if (state.error.hint) {
      const hint = document.createElement('code');
      hint.textContent = state.error.hint;
      banner.append(hint);
    }
    thread.append(banner);
  } else if (row.lastError && !state.streaming) {
    const banner = document.createElement('div');
    banner.className = 'error';
    banner.textContent = row.lastError.message || '';
    if (row.lastError.hint) {
      const hint = document.createElement('code');
      hint.textContent = row.lastError.hint;
      banner.append(hint);
    }
    thread.append(banner);
  }

  const form = document.createElement('form');
  form.className = 'composer';
  const area = document.createElement('textarea');
  area.rows = 2;
  area.placeholder = 'Continue this conversation';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'send';
  submit.textContent = state.streaming ? 'Stop' : 'Send';
  form.append(area, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.streaming) {
      state.port.postMessage({ type: 'cancel', requestId: state.requestId });
      state.streaming = false;
      renderDetail();
      return;
    }
    const userText = area.value.trim();
    if (!userText) return;
    state.requestId = uuid();
    state.streaming = true;
    state.buffer = '';
    state.error = null;
    row.messages.push({ role: 'user', content: userText, createdAt: Date.now() });
    area.value = '';
    state.port.postMessage({
      type: 'turn',
      requestId: state.requestId,
      conversationId: row.id,
      provider: row.provider,
      selection: { text: row.selection, title: row.title, url: row.url },
      userText,
    });
    renderDetail();
  });

  detailEl.append(head, passage, thread, form);
}

function renderProviders() {
  statusEl.textContent = state.nativeConnected
    ? 'Helper connected.'
    : (state.nativeError || 'Helper not connected. From the Double Click folder, run node install.js');
  providerEl.replaceChildren();
  const reported = new Map((state.providers || []).map((item) => [item.id, item]));
  for (const item of providerList) {
    const live = reported.get(item.id) || item;
    const card = document.createElement('article');
    card.className = 'provider';
    const name = document.createElement('strong');
    const ready = live.installed;
    name.textContent = item.label + (ready === false ? ' — not installed' : '');
    const hints = document.createElement('div');
    if (live.installHint) {
      const install = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = live.installHint;
      install.append(code);
      hints.append(install);
    }
    if (live.loginHint) {
      const login = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = live.loginHint;
      login.append(code);
      hints.append(login);
    }
    card.append(name, hints);
    if (item.id === 'claude') {
      const note = document.createElement('p');
      note.className = 'caveat';
      note.textContent = item.caveat;
      const label = document.createElement('label');
      label.className = 'caveat';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.settings.claudeOptIn === true;
      box.addEventListener('change', () => {
        state.settings = { ...state.settings, claudeOptIn: box.checked };
        state.port.postMessage({ type: 'settings-set', settings: state.settings });
      });
      label.append(box, document.createTextNode(' Use Claude Code on this computer'));
      card.append(note, label);
    }
    providerEl.append(card);
  }
}

searchEl.addEventListener('input', () => {
  state.query = searchEl.value;
  renderList();
});

document.querySelector('#open-tab').addEventListener('click', () => {
  if (window.top === window) {
    window.open(chrome.runtime.getURL('history.html'), '_blank', 'noopener');
  }
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.historyRevision && state.port && !state.streaming) {
    state.port.postMessage({ type: 'history-list' });
  }
});

renderList();
renderDetail();
renderProviders();
connect();

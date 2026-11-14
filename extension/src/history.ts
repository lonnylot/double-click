import type { Conversation } from './lib/db';
import { render } from './lib/markdown';
import { LIST } from './lib/providers';

const providerList = LIST;

function required<T extends Element>(selector: string): T {
  const found = document.querySelector(selector);
  if (!found) throw new Error('Missing ' + selector);
  return found as T;
}

const listEl = required<HTMLElement>('#list');
const detailEl = required<HTMLElement>('#detail');
const searchEl = required<HTMLInputElement>('#search');
const statusEl = required<HTMLElement>('#helper-status');
const providerEl = required<HTMLElement>('#provider-list');
const openTab = required<HTMLButtonElement>('#open-tab');

interface Settings {
  provider: string;
  claudeOptIn: boolean;
  providerPaths?: Record<string, string>;
}

interface LiveProvider {
  id: string;
  label?: string;
  installed?: boolean;
  resolvedPath?: string;
  detectedPath?: string;
  installHint?: string;
  loginHint?: string;
  pathNote?: string;
  caveat?: string;
  demo?: boolean;
}

interface UiError {
  message?: string;
  hint?: string;
}

const state: {
  port: chrome.runtime.Port | null;
  conversations: Conversation[];
  selectedId: string | null;
  query: string;
  settings: Settings;
  providers: LiveProvider[];
  nativeConnected: boolean;
  nativeError: string;
  streaming: boolean;
  requestId: string | null;
  buffer: string;
  error: UiError | null;
  pendingDelete: string | null;
} = {
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

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const sixth = bytes[6] ?? 0;
  const eighth = bytes[8] ?? 0;
  bytes[6] = (sixth & 0x0f) | 0x40;
  bytes[8] = (eighth & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function worker(): chrome.runtime.Port {
  if (!state.port) throw new Error('Not connected');
  return state.port;
}

function connect(): void {
  const port = chrome.runtime.connect({ name: 'double-click' });
  state.port = port;
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    state.port = null;
    state.nativeConnected = false;
    if (state.streaming) {
      state.streaming = false;
      state.error = { message: 'The helper disconnected.', hint: 'node install.js' };
      renderDetail();
    }
    setTimeout(connect, 400);
  });
  port.postMessage({ type: 'hello' });
  port.postMessage({ type: 'history-list' });
}

function onMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const record = message as Record<string, unknown>;
  if (record.type === 'hello-ack' || record.type === 'settings' || record.type === 'providers') {
    if (record.settings && typeof record.settings === 'object') state.settings = record.settings as Settings;
    if (Array.isArray(record.providers)) state.providers = record.providers as LiveProvider[];
    if (record.type === 'hello-ack') {
      state.nativeConnected = Boolean(record.nativeConnected);
      state.nativeError = typeof record.nativeError === 'string' ? record.nativeError : '';
    }
    renderProviders();
  }
  if (record.type === 'history') {
    state.conversations = Array.isArray(record.conversations) ? record.conversations as Conversation[] : [];
    if (state.selectedId && !state.conversations.some((row) => row.id === state.selectedId)) {
      state.selectedId = null;
    }
    renderList();
    renderDetail();
  }
  if (record.type === 'conversation' && record.conversation && typeof record.conversation === 'object') {
    const conversation = record.conversation as Conversation;
    if (conversation.id === state.selectedId) {
      const index = state.conversations.findIndex((row) => row.id === conversation.id);
      if (index >= 0) state.conversations[index] = conversation;
      else state.conversations.unshift(conversation);
      renderList();
      renderDetail();
    }
  }
  if (record.type === 'persisted' && record.conversation && typeof record.conversation === 'object') {
    const conversation = record.conversation as Conversation;
    const index = state.conversations.findIndex((row) => row.id === conversation.id);
    if (index >= 0) state.conversations[index] = conversation;
    else state.conversations.unshift(conversation);
    if (record.requestId === state.requestId) {
      state.streaming = false;
      state.buffer = '';
    }
    renderList();
    renderDetail();
  }
  if (record.type === 'event' && record.requestId === state.requestId) {
    const event = record.event && typeof record.event === 'object'
      ? record.event as { kind?: string; text?: string; message?: string; hint?: string }
      : {};
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

function selected(): Conversation | null {
  return state.conversations.find((row) => row.id === state.selectedId) || null;
}

function matches(row: Conversation): boolean {
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

function formatTime(value: number | undefined): string {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch (_err) { /* ignore */ }
  return '';
}

function renderList(): void {
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
  const groups = new Map<string, Conversation[]>();
  for (const row of rows) {
    const key = row.url || '';
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  for (const [url, items] of groups) {
    const group = document.createElement('section');
    const head = document.createElement('div');
    head.className = 'page-head';
    const titles = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'page-title';
    const first = items[0];
    title.textContent = (first && first.title) || 'Untitled page';
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
      worker().postMessage({ type: 'history-delete-page', url });
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

function renderDetail(): void {
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
    worker().postMessage({ type: 'history-delete', id: row.id });
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
      body.innerHTML = render(message.content);
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
    body.innerHTML = render(state.buffer);
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
      worker().postMessage({ type: 'cancel', requestId: state.requestId });
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
    worker().postMessage({
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

function saveProviderPath(id: string, value: string): void {
  const providerPaths = { ...(state.settings.providerPaths || {}) };
  const trimmed = String(value || '').trim();
  if (trimmed) providerPaths[id] = trimmed;
  else delete providerPaths[id];
  state.settings = { ...state.settings, providerPaths };
  if (state.port) state.port.postMessage({ type: 'settings-set', settings: state.settings });
}

function renderProviders(): void {
  statusEl.textContent = state.nativeConnected
    ? 'Helper connected.'
    : (state.nativeError || 'Helper not connected. From the Double Click AI folder, run node install.js');
  providerEl.replaceChildren();
  const reported = new Map((state.providers || []).map((item) => [item.id, item]));
  for (const item of providerList) {
    const live = reported.get(item.id) || item;
    const card = document.createElement('article');
    card.className = 'provider';
    const name = document.createElement('strong');
    const ready = 'installed' in live ? live.installed : undefined;
    name.textContent = item.label + (ready === false ? ' — not installed' : '');
    const hints = document.createElement('div');
    const resolvedPath = 'resolvedPath' in live ? live.resolvedPath : '';
    const detectedPath = 'detectedPath' in live ? live.detectedPath : '';
    const pathNote = 'pathNote' in live ? live.pathNote : '';
    if (!item.demo && reported.has(item.id)) {
      const resolved = document.createElement('div');
      const code = document.createElement('code');
      if (resolvedPath) code.textContent = resolvedPath;
      else if (detectedPath) code.textContent = 'Not found. Detected ' + detectedPath;
      else code.textContent = 'Not found';
      resolved.append(code);
      hints.append(resolved);
    }
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
    if (pathNote) {
      const note = document.createElement('p');
      note.className = 'caveat';
      note.textContent = pathNote;
      hints.append(note);
    }
    card.append(name, hints);
    if (!item.demo) {
      const field = document.createElement('label');
      field.className = 'path-field';
      const caption = document.createElement('span');
      caption.textContent = 'Custom path';
      const box = document.createElement('input');
      box.type = 'text';
      box.spellcheck = false;
      box.autocomplete = 'off';
      box.placeholder = 'Optional absolute path';
      box.value = (state.settings.providerPaths && state.settings.providerPaths[item.id]) || '';
      box.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          box.blur();
        }
      });
      box.addEventListener('change', () => saveProviderPath(item.id, box.value));
      field.append(caption, box);
      card.append(field);
    }
    if (item.id === 'claude') {
      const note = document.createElement('p');
      note.className = 'caveat';
      note.textContent = item.caveat || '';
      const labelEl = document.createElement('label');
      labelEl.className = 'caveat';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.settings.claudeOptIn === true;
      box.addEventListener('change', () => {
        state.settings = { ...state.settings, claudeOptIn: box.checked };
        worker().postMessage({ type: 'settings-set', settings: state.settings });
      });
      labelEl.append(box, document.createTextNode(' Use Claude Code on this computer'));
      card.append(note, labelEl);
    }
    providerEl.append(card);
  }
}

searchEl.addEventListener('input', () => {
  state.query = searchEl.value;
  renderList();
});

openTab.addEventListener('click', () => {
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

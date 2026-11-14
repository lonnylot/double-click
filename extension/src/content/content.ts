import { render } from '../lib/markdown';
import { LIST, byId, type CatalogProvider } from '../lib/providers';
import { styles } from './styles';

const globalScope = globalThis as typeof globalThis & { __doubleClickInstalled?: boolean };

if (!globalScope.__doubleClickInstalled) {
  globalScope.__doubleClickInstalled = true;

  const providerList = LIST;

  const host = document.createElement('div');
  host.id = 'double-click-root';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  const root = document.createElement('div');
  root.className = 'dc-root';
  shadow.append(style, root);
  (document.documentElement || document.body).append(host);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dc-trigger';
  trigger.title = 'Ask about this highlight (Alt+Shift+D)';
  trigger.innerHTML = '<span class="dc-mark" aria-hidden="true"></span><span>Ask</span>';

  const panel = document.createElement('section');
  panel.className = 'dc-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Double Click AI');
  panel.hidden = true;

  const bar = document.createElement('header');
  bar.className = 'dc-bar';
  const brand = document.createElement('div');
  brand.className = 'dc-brand';
  brand.innerHTML = '<span class="dc-mark" aria-hidden="true"></span><span>Double Click AI</span>';
  const select = document.createElement('select');
  select.className = 'dc-select';
  select.setAttribute('aria-label', 'Provider');
  const historyButton = document.createElement('button');
  historyButton.type = 'button';
  historyButton.className = 'dc-icon';
  historyButton.title = 'History';
  historyButton.setAttribute('aria-label', 'History');
  historyButton.textContent = '☰';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'dc-icon';
  closeButton.title = 'Close';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.textContent = '×';
  bar.append(brand, select, historyButton, closeButton);

  const quote = document.createElement('blockquote');
  quote.className = 'dc-passage';
  const thread = document.createElement('div');
  thread.className = 'dc-thread';
  const caveat = document.createElement('div');
  caveat.className = 'dc-caveat';
  const form = document.createElement('form');
  form.className = 'dc-composer';
  const input = document.createElement('textarea');
  input.className = 'dc-input';
  input.rows = 1;
  input.placeholder = 'Ask about this highlight';
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'dc-send';
  send.textContent = 'Send';
  form.append(input, send);
  const foot = document.createElement('p');
  foot.className = 'dc-foot';
  foot.textContent = 'Enter to send · Shift+Enter for a new line · Esc to close';
  panel.append(bar, quote, thread, caveat, form, foot);

  interface UiMessage {
    role: string;
    content: string;
  }

  interface UiError {
    message?: string;
    hint?: string;
  }

  interface UiSettings {
    provider: string;
    claudeOptIn: boolean;
    providerPaths?: Record<string, string>;
  }

  interface ProviderLive {
    id: string;
    installed?: boolean;
  }

  const ui: {
    port: chrome.runtime.Port | null;
    open: boolean;
    anchor: Range | null;
    selection: { text: string; title: string; url: string } | null;
    conversationId: string | null;
    messages: UiMessage[];
    streaming: boolean;
    requestId: string | null;
    buffer: string;
    error: UiError | null;
    settings: UiSettings;
    providerInfo: ProviderLive[];
    nativeConnected: boolean;
    nativeError: string;
  } = {
    port: null,
    open: false,
    anchor: null,
    selection: null,
    conversationId: null,
    messages: [],
    streaming: false,
    requestId: null,
    buffer: '',
    error: null,
    settings: { provider: 'codex', claudeOptIn: false },
    providerInfo: [],
    nativeConnected: false,
    nativeError: '',
  };

  function uuid(): string {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch (_err) { /* http pages */ }
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const sixth = bytes[6] ?? 0;
    const eighth = bytes[8] ?? 0;
    bytes[6] = (sixth & 0x0f) | 0x40;
    bytes[8] = (eighth & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function ensurePort(): chrome.runtime.Port {
    if (ui.port) return ui.port;
    const port = chrome.runtime.connect({ name: 'double-click' });
    ui.port = port;
    port.onMessage.addListener(onPort);
    port.onDisconnect.addListener(() => {
      ui.port = null;
      if (ui.streaming) {
        ui.streaming = false;
        ui.error = { message: 'The helper disconnected.', hint: 'From the Double Click AI folder, run: node install.js' };
        paint();
      }
    });
    port.postMessage({ type: 'hello' });
    return port;
  }

  function onPort(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const record = message as Record<string, unknown>;
    if (record.type === 'hello-ack' || record.type === 'settings' || record.type === 'providers') {
      const nextSettings = record.settings && typeof record.settings === 'object'
        ? record.settings as UiSettings
        : null;
      if (nextSettings && !ui.open) ui.settings = nextSettings;
      if (nextSettings && record.type === 'settings') ui.settings = nextSettings;
      if (Array.isArray(record.providers)) ui.providerInfo = record.providers as ProviderLive[];
      if (record.type === 'hello-ack') {
        ui.nativeConnected = Boolean(record.nativeConnected);
        ui.nativeError = typeof record.nativeError === 'string' ? record.nativeError : '';
        if (!ui.open && nextSettings) ui.settings = nextSettings;
      }
      fillProviders();
      paintCaveat();
      paintThread();
      return;
    }
    if (record.type !== 'event' || record.requestId !== ui.requestId) return;
    const event = record.event && typeof record.event === 'object' ? record.event as { kind?: string; text?: string; message?: string; hint?: string } : {};
    if (event.kind === 'delta') ui.buffer += event.text || '';
    if (event.kind === 'text') ui.buffer = event.text || '';
    if (event.kind === 'error') {
      ui.streaming = false;
      ui.error = event;
      if (ui.buffer) ui.messages.push({ role: 'assistant', content: ui.buffer });
      ui.buffer = '';
    }
    if (event.kind === 'done') {
      ui.streaming = false;
      const text = event.text || ui.buffer;
      if (text) ui.messages.push({ role: 'assistant', content: text });
      ui.buffer = '';
      ui.error = null;
    }
    paint();
  }

  function installed(id: string): boolean | null | undefined {
    const info = (ui.providerInfo || []).find((item) => item.id === id);
    return info ? info.installed : null;
  }

  function fillProviders(): void {
    const current = select.value || ui.settings.provider || 'codex';
    select.replaceChildren();
    for (const item of providerList) {
      const option = document.createElement('option');
      option.value = item.id;
      const ready = installed(item.id);
      option.textContent = ready === false ? item.label + ' — not installed' : item.label;
      select.append(option);
    }
    select.value = providerList.some((item) => item.id === current) ? current : 'codex';
    ui.settings = { ...ui.settings, provider: select.value };
  }

  function providerNote(id: string): string {
    const item: CatalogProvider | null = byId(id);
    return item && item.caveat ? item.caveat : '';
  }

  function paintCaveat(): void {
    caveat.replaceChildren();
    if (select.value !== 'claude') {
      caveat.hidden = true;
      return;
    }
    caveat.hidden = false;
    const note = document.createElement('p');
    note.textContent = providerNote('claude');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = ui.settings.claudeOptIn === true;
    box.addEventListener('change', () => {
      ui.settings = { ...ui.settings, claudeOptIn: box.checked, provider: select.value };
      ensurePort().postMessage({ type: 'settings-set', settings: ui.settings });
    });
    const words = document.createElement('span');
    words.textContent = 'Use Claude Code on this computer';
    label.append(box, words);
    caveat.append(note, label);
  }

  function addMessage(message: UiMessage): HTMLElement {
    const article = document.createElement('article');
    article.className = 'dc-msg dc-' + message.role;
    if (message.role === 'assistant') {
      const body = document.createElement('div');
      body.className = 'dc-md';
      body.innerHTML = render(message.content);
      article.append(body);
    } else {
      const paragraph = document.createElement('p');
      paragraph.textContent = message.content;
      article.append(paragraph);
    }
    return article;
  }

  function paintThread(): void {
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
    thread.replaceChildren();
    for (const message of ui.messages) thread.append(addMessage(message));
    if (ui.streaming) {
      const article = document.createElement('article');
      article.className = 'dc-msg dc-assistant';
      const body = document.createElement('div');
      body.className = 'dc-md';
      body.innerHTML = (ui.buffer ? render(ui.buffer) : '') + '<span class="dc-caret"></span>';
      article.append(body);
      thread.append(article);
    }
    if (ui.error) {
      const banner = document.createElement('div');
      banner.className = 'dc-error';
      banner.textContent = ui.error.message || 'Something went wrong.';
      if (ui.error.hint) {
        const hint = document.createElement('code');
        hint.textContent = ui.error.hint;
        banner.append(hint);
      }
      thread.append(banner);
    } else if (!ui.nativeConnected && ui.nativeError && ui.messages.length === 0 && !ui.streaming) {
      const banner = document.createElement('div');
      banner.className = 'dc-error';
      banner.textContent = ui.nativeError;
      const hint = document.createElement('code');
      hint.textContent = 'node install.js';
      banner.append(hint);
      thread.append(banner);
    }
    send.className = ui.streaming ? 'dc-stop' : 'dc-send';
    send.textContent = ui.streaming ? 'Stop' : 'Send';
    if (nearBottom) thread.scrollTop = thread.scrollHeight;
  }

  interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width?: number;
    height?: number;
  }

  function place(el: HTMLElement, rect: Box, width: number, height: number, below: boolean): { left: number; top: number } {
    const margin = 8;
    let left = below ? rect.left : Math.min(rect.right + margin, window.innerWidth - width - margin);
    let top = below ? rect.bottom + margin : rect.top - 4;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    if (left < margin) left = margin;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, (rect.top || 0) - height - margin);
    if (top < margin) top = margin;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    return { left, top };
  }

  function anchorRect(): Box {
    if (ui.anchor && typeof ui.anchor.getBoundingClientRect === 'function') {
      const rects = ui.anchor.getClientRects();
      if (rects.length) return rects[rects.length - 1] || { left: 24, top: 80, right: 80, bottom: 100, width: 56, height: 20 };
      const rect = ui.anchor.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) return rect;
    }
    return { left: 24, top: 80, right: 80, bottom: 100, width: 56, height: 20 };
  }

  function positionPanel(): void {
    place(panel, anchorRect(), panel.offsetWidth || 400, panel.offsetHeight || 280, true);
  }

  function paint(): void {
    paintThread();
    if (ui.open) positionPanel();
  }

  function selectedText(): { text: string; range: Range } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const range = selection.getRangeAt(0);
    if (host.contains(range.commonAncestorContainer)) return null;
    return { text, range: range.cloneRange() };
  }

  function hideTrigger(): void {
    trigger.remove();
    delete host.dataset.triggerLeft;
  }

  function showTrigger(): void {
    if (ui.open) return;
    const found = selectedText();
    if (!found) {
      hideTrigger();
      return;
    }
    ui.anchor = found.range;
    if (!trigger.isConnected) root.append(trigger);
    const spot = place(trigger, anchorRect(), 92, 30, false);
    host.dataset.triggerLeft = String(Math.round(spot.left));
    host.dataset.triggerTop = String(Math.round(spot.top));
    host.dataset.open = '0';
  }

  function toast(text: string): void {
    const note = document.createElement('div');
    note.className = 'dc-toast';
    note.textContent = text;
    root.append(note);
    setTimeout(() => note.remove(), 2200);
  }

  function openPanel(): void {
    const live = selectedText();
    const text = (live && live.text) || (ui.selection && ui.selection.text);
    if (!text) {
      toast('Highlight a passage first');
      return;
    }
    if (live) ui.anchor = live.range;
    ui.selection = { text, title: document.title || '', url: location.href };
    ui.conversationId = uuid();
    ui.messages = [];
    ui.buffer = '';
    ui.error = null;
    ui.streaming = false;
    ui.open = true;
    hideTrigger();
    quote.textContent = text;
    input.value = '';
    fillProviders();
    paintCaveat();
    panel.hidden = false;
    panel.classList.add('dc-in');
    if (!panel.isConnected) root.append(panel);
    host.dataset.open = '1';
    ensurePort();
    paint();
    input.focus();
  }

  function closePanel(): void {
    const port = ui.port;
    const requestId = ui.requestId;
    const shouldCancel = Boolean(ui.streaming && port && requestId);
    ui.open = false;
    ui.streaming = false;
    panel.hidden = true;
    host.dataset.open = '0';
    if (!shouldCancel || !port || !requestId) return;
    try {
      port.postMessage({ type: 'cancel', requestId });
    } catch (_err) { /* a disconnected port must not keep the popup on screen */ }
  }

  function submitQuestion(): void {
    if (ui.streaming) {
      ensurePort().postMessage({ type: 'cancel', requestId: ui.requestId });
      ui.streaming = false;
      if (ui.buffer) ui.messages.push({ role: 'assistant', content: ui.buffer });
      ui.buffer = '';
      paint();
      return;
    }
    const userText = input.value.trim();
    if (!userText) return;
    if (select.value === 'claude' && ui.settings.claudeOptIn !== true) {
      ui.error = {
        message: 'Claude Code stays off until you enable it.',
        hint: providerNote('claude'),
      };
      paint();
      return;
    }
    ui.settings = { ...ui.settings, provider: select.value };
    ui.messages.push({ role: 'user', content: userText });
    ui.buffer = '';
    ui.error = null;
    ui.streaming = true;
    ui.requestId = uuid();
    input.value = '';
    input.style.height = 'auto';
    ensurePort().postMessage({
      type: 'turn',
      requestId: ui.requestId,
      conversationId: ui.conversationId,
      provider: select.value,
      selection: ui.selection,
      userText,
    });
    paint();
  }

  select.addEventListener('change', () => {
    ui.settings = { ...ui.settings, provider: select.value };
    ensurePort().postMessage({ type: 'settings-set', settings: ui.settings });
    paintCaveat();
  });
  historyButton.addEventListener('click', () => ensurePort().postMessage({ type: 'open-history' }));
  closeButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitQuestion();
  });

  trigger.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPanel();
  });
  window.addEventListener('keydown', (event) => {
    if (!ui.open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  }, true);
  panel.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey && event.target === input && !event.isComposing) {
      event.preventDefault();
      submitQuestion();
    }
  });
  panel.addEventListener('mousedown', (event) => event.stopPropagation());
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());

  let selecting = false;
  document.addEventListener('mousedown', (event) => {
    if (event.composedPath().includes(host)) return;
    selecting = true;
  }, true);
  document.addEventListener('mouseup', () => {
    selecting = false;
    showTrigger();
  }, true);
  document.addEventListener('selectionchange', () => {
    if (ui.open || selecting) return;
    showTrigger();
  });
  window.addEventListener('scroll', () => {
    if (ui.open) positionPanel();
    else showTrigger();
  }, true);
  window.addEventListener('resize', () => {
    if (ui.open) positionPanel();
    else showTrigger();
  });
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const record = message as { type?: string };
    if (record.type !== 'open-from-shortcut') return;
    openPanel();
  });

  fillProviders();
}

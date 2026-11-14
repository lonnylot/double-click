'use strict';

if (!globalThis.__doubleClickInstalled) {
  globalThis.__doubleClickInstalled = true;

  const providerList = globalThis.DoubleClickProviders.LIST;
  const markdown = globalThis.DoubleClickMarkdown.render;

  const host = document.createElement('div');
  host.id = 'double-click-root';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = globalThis.DoubleClickStyles;
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
  panel.setAttribute('aria-label', 'Double Click');
  panel.hidden = true;

  const bar = document.createElement('header');
  bar.className = 'dc-bar';
  const brand = document.createElement('div');
  brand.className = 'dc-brand';
  brand.innerHTML = '<span class="dc-mark" aria-hidden="true"></span><span>Double Click</span>';
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

  const ui = {
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

  function uuid() {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch (_err) { /* http pages */ }
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function ensurePort() {
    if (ui.port) return ui.port;
    ui.port = chrome.runtime.connect({ name: 'double-click' });
    ui.port.onMessage.addListener(onPort);
    ui.port.onDisconnect.addListener(() => {
      ui.port = null;
      if (ui.streaming) {
        ui.streaming = false;
        ui.error = { message: 'The helper disconnected.', hint: 'From the Double Click folder, run: node install.js' };
        paint();
      }
    });
    ui.port.postMessage({ type: 'hello' });
    return ui.port;
  }

  function onPort(message) {
    if (!message) return;
    if (message.type === 'hello-ack' || message.type === 'settings' || message.type === 'providers') {
      if (message.settings && !ui.open) ui.settings = message.settings;
      if (message.settings && message.type === 'settings') ui.settings = message.settings;
      if (message.providers) ui.providerInfo = message.providers;
      if (message.type === 'hello-ack') {
        ui.nativeConnected = Boolean(message.nativeConnected);
        ui.nativeError = message.nativeError || '';
        if (!ui.open && message.settings) ui.settings = message.settings;
      }
      fillProviders();
      paintCaveat();
      paintThread();
      return;
    }
    if (message.type !== 'event' || message.requestId !== ui.requestId) return;
    const event = message.event || {};
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

  function installed(id) {
    const info = (ui.providerInfo || []).find((item) => item.id === id);
    return info ? info.installed : null;
  }

  function fillProviders() {
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

  function paintCaveat() {
    caveat.replaceChildren();
    if (select.value !== 'claude') {
      caveat.hidden = true;
      return;
    }
    caveat.hidden = false;
    const note = document.createElement('p');
    note.textContent = providerList.find((item) => item.id === 'claude').caveat;
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

  function addMessage(message) {
    const article = document.createElement('article');
    article.className = 'dc-msg dc-' + message.role;
    if (message.role === 'assistant') {
      const body = document.createElement('div');
      body.className = 'dc-md';
      body.innerHTML = markdown(message.content);
      article.append(body);
    } else {
      const paragraph = document.createElement('p');
      paragraph.textContent = message.content;
      article.append(paragraph);
    }
    return article;
  }

  function paintThread() {
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
    thread.replaceChildren();
    for (const message of ui.messages) thread.append(addMessage(message));
    if (ui.streaming) {
      const article = document.createElement('article');
      article.className = 'dc-msg dc-assistant';
      const body = document.createElement('div');
      body.className = 'dc-md';
      body.innerHTML = (ui.buffer ? markdown(ui.buffer) : '') + '<span class="dc-caret"></span>';
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

  function place(el, rect, width, height, below) {
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

  function anchorRect() {
    if (ui.anchor && typeof ui.anchor.getBoundingClientRect === 'function') {
      const rects = ui.anchor.getClientRects();
      if (rects.length) return rects[rects.length - 1];
      const rect = ui.anchor.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) return rect;
    }
    return { left: 24, top: 80, right: 80, bottom: 100, width: 56, height: 20 };
  }

  function positionPanel() {
    place(panel, anchorRect(), panel.offsetWidth || 400, panel.offsetHeight || 280, true);
  }

  function paint() {
    paintThread();
    if (ui.open) positionPanel();
  }

  function selectedText() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const range = selection.getRangeAt(0);
    if (host.contains(range.commonAncestorContainer)) return null;
    return { text, range: range.cloneRange() };
  }

  function hideTrigger() {
    trigger.remove();
    delete host.dataset.triggerLeft;
  }

  function showTrigger() {
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

  function toast(text) {
    const note = document.createElement('div');
    note.className = 'dc-toast';
    note.textContent = text;
    root.append(note);
    setTimeout(() => note.remove(), 2200);
  }

  function openPanel() {
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

  function closePanel() {
    if (ui.streaming && ui.port && ui.requestId) {
      ui.port.postMessage({ type: 'cancel', requestId: ui.requestId });
    }
    ui.open = false;
    ui.streaming = false;
    panel.hidden = true;
    host.dataset.open = '0';
  }

  function submitQuestion() {
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
        hint: providerList.find((item) => item.id === 'claude').caveat,
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
  closeButton.addEventListener('click', closePanel);
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
  panel.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
      return;
    }
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
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'open-from-shortcut') return;
    openPanel();
  });

  fillProviders();
}

'use strict';

// Shared by the helper (Node) and the extension service worker.
// Chrome caps each host-to-extension native message at 1 MB.
(function (root) {
  const LIMIT = 900 * 1024;
  const PIECE = 480 * 1024;
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function encodeBase64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const triple = (a << 16) | (b << 8) | c;
      out += ALPHABET[(triple >> 18) & 63];
      out += ALPHABET[(triple >> 12) & 63];
      out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '=';
      out += i + 2 < bytes.length ? ALPHABET[triple & 63] : '=';
    }
    return out;
  }

  function decodeBase64(text) {
    const clean = String(text || '').replace(/=+$/g, '').replace(/[^A-Za-z0-9+/]/g, '');
    const out = [];
    for (let i = 0; i < clean.length; i += 4) {
      const a = ALPHABET.indexOf(clean[i]);
      const b = ALPHABET.indexOf(clean[i + 1]);
      const c = i + 2 < clean.length ? ALPHABET.indexOf(clean[i + 2]) : -1;
      const d = i + 3 < clean.length ? ALPHABET.indexOf(clean[i + 3]) : -1;
      const triple = ((a < 0 ? 0 : a) << 18) | ((b < 0 ? 0 : b) << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
      out.push((triple >> 16) & 255);
      if (c >= 0) out.push((triple >> 8) & 255);
      if (d >= 0) out.push(triple & 255);
    }
    return new Uint8Array(out);
  }

  function uid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      try {
        return root.crypto.randomUUID();
      } catch (_err) {
        // randomUUID can throw outside a secure context.
      }
    }
    return 'chunk-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function packMessages(message) {
    const json = JSON.stringify(message);
    const bytes = new TextEncoder().encode(json);
    if (bytes.length <= LIMIT) return [message];
    const count = Math.ceil(bytes.length / PIECE);
    const id = uid();
    const parts = [];
    for (let index = 0; index < count; index += 1) {
      const slice = bytes.subarray(index * PIECE, Math.min(bytes.length, (index + 1) * PIECE));
      parts.push({
        type: 'chunk',
        id,
        index,
        count,
        data: encodeBase64(slice),
      });
    }
    return parts;
  }

  function Reassembler() {
    this.pending = new Map();
  }

  Reassembler.prototype.push = function push(message) {
    if (!message || message.type !== 'chunk') return message;
    let entry = this.pending.get(message.id);
    if (!entry) {
      entry = { count: message.count, parts: new Array(message.count) };
      this.pending.set(message.id, entry);
    }
    entry.parts[message.index] = decodeBase64(message.data);
    for (let i = 0; i < entry.count; i += 1) {
      if (entry.parts[i] === undefined) return null;
    }
    const total = entry.parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of entry.parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    this.pending.delete(message.id);
    const json = new TextDecoder().decode(merged);
    return JSON.parse(json);
  };

  root.DoubleClickChunks = {
    LIMIT,
    PIECE,
    encodeBase64,
    decodeBase64,
    packMessages,
    Reassembler,
  };
})(globalThis);

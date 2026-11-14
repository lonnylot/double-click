'use strict';

const fs = require('fs');
const path = require('path');

class SessionMap {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_err) {
      this.data = {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  get(conversationId) {
    const row = this.data[conversationId];
    if (!row || !row.providerSessionId) return null;
    return {
      provider: row.provider,
      providerSessionId: row.providerSessionId,
    };
  }

  set(conversationId, value) {
    if (!conversationId || !value || !value.providerSessionId) return;
    this.data[conversationId] = {
      provider: value.provider,
      providerSessionId: value.providerSessionId,
      updatedAt: Date.now(),
    };
    this.save();
  }

  delete(conversationId) {
    if (!this.data[conversationId]) return;
    delete this.data[conversationId];
    this.save();
  }
}

module.exports = { SessionMap };

import * as fs from 'fs';
import * as path from 'path';

interface StoredSession {
  provider?: string;
  providerSessionId?: string;
  updatedAt?: number;
}

export interface RememberedSession {
  provider: string | undefined;
  providerSessionId: string;
}

export class SessionMap {
  private file: string;
  private data: Record<string, StoredSession>;

  constructor(file: string) {
    this.file = file;
    this.data = {};
    this.load();
  }

  load(): void {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = parsed && typeof parsed === 'object' ? parsed as Record<string, StoredSession> : {};
    } catch (_err) {
      this.data = {};
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  get(conversationId: string): RememberedSession | null {
    const row = this.data[conversationId];
    if (!row || !row.providerSessionId) return null;
    return {
      provider: row.provider,
      providerSessionId: row.providerSessionId,
    };
  }

  set(conversationId: string, value: { provider?: string; providerSessionId?: string } | null | undefined): void {
    if (!conversationId || !value || !value.providerSessionId) return;
    this.data[conversationId] = {
      provider: value.provider,
      providerSessionId: value.providerSessionId,
      updatedAt: Date.now(),
    };
    this.save();
  }

  delete(conversationId: string): void {
    if (!this.data[conversationId]) return;
    delete this.data[conversationId];
    this.save();
  }
}

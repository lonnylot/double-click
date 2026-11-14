import type { Adapter } from './adapter';
import { agy } from './agy';
import { claude } from './claude';
import { codex } from './codex';
import { copilot } from './copilot';
import { cursor } from './cursor';
import { grok } from './grok';
import { mock } from './mock';

export type { Adapter } from './adapter';

export const ADAPTERS: Adapter[] = [codex, copilot, agy, grok, cursor, claude, mock];

export function getAdapter(id: string | undefined): Adapter | null {
  return ADAPTERS.find((adapter) => adapter.id === id) || null;
}

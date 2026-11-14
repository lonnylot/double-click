// Messages between the extension service worker and the native-messaging helper.
// Both sides import these types. The helper compiles them away; the extension bundles them away.

export interface HighlightSelection {
  text?: string;
  title?: string;
  url?: string;
}

export interface PriorMessage {
  role?: string;
  content?: string;
}

export interface TurnInput {
  requestId?: string;
  conversationId?: string;
  provider?: string;
  providerSessionId?: string | null;
  selection?: HighlightSelection;
  userText?: string;
  priorMessages?: PriorMessage[];
  claudeOptIn?: boolean;
  providerPath?: string;
}

export interface SessionEvent {
  kind: 'session';
  providerSessionId: string;
}

export interface DeltaEvent {
  kind: 'delta';
  text: string;
}

export interface TextEvent {
  kind: 'text';
  text: string;
}

export interface DoneEvent {
  kind: 'done';
  text?: string;
}

export interface ErrorEvent {
  kind: 'error';
  message?: string;
  code?: string;
  hint?: string;
}

export type TurnEvent = SessionEvent | DeltaEvent | TextEvent | DoneEvent | ErrorEvent;

export interface TurnSpec {
  command: string | null;
  args: string[];
  stdin: string | null;
  preassignedSessionId: string | null;
  mock?: boolean;
}

export interface ParseState {
  text: string;
  sessionId: string | null;
  sawText: boolean;
  sawDelta: boolean;
  plain: string[];
  done: boolean;
}

export interface ProviderStatus {
  id: string;
  label: string;
  detail: string;
  optIn: boolean;
  demo: boolean;
  caveat: string;
  installHint: string;
  loginHint: string;
  installed: boolean;
  resolvedPath: string;
  detectedPath: string;
  pathNote: string;
}

export interface ProviderPaths {
  [id: string]: string;
}

export interface TurnCommand extends TurnInput {
  type: 'turn';
}

export type HostRequest =
  | { type: 'ping' }
  | { type: 'providers'; providerPaths?: ProviderPaths }
  | { type: 'forget'; conversationId?: string }
  | { type: 'echo'; data?: unknown }
  | { type: 'cancel'; requestId?: string }
  | TurnCommand;

export type HostEvent =
  | { type: 'pong' }
  | { type: 'providers'; providers: ProviderStatus[] }
  | { type: 'forgot'; conversationId: string | null }
  | { type: 'echo'; data?: unknown }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'event'; requestId?: string; event: TurnEvent };

export interface ChunkMessage {
  type: 'chunk';
  id: string;
  index: number;
  count: number;
  data: string;
}

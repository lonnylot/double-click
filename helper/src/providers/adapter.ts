import type { ParseState, TurnEvent, TurnInput, TurnSpec } from '../../../shared/protocol';

export interface Adapter {
  id: string;
  label: string;
  detail?: string;
  command: string | null;
  optIn?: boolean;
  demo?: boolean;
  caveat?: string;
  installHint?: string;
  loginHint?: string;
  buildTurn: (turn: TurnInput, cwd: string) => TurnSpec;
  parseLine: (line: string, state: ParseState) => TurnEvent[];
  answer?: (turn: TurnInput) => string;
}

import type { Attachment, Turn } from './types';

export type GateRequest =
  | { kind: 'site'; origin: string }
  | { kind: 'risky'; description: string; reasons: string[]; reason: string }
  | { kind: 'ask'; question: string }
  | { kind: 'retry'; message: string };

export type PanelToBg =
  | { type: 'start'; conversationId: string | null; text: string; attachments: Attachment[]; tabId: number }
  | { type: 'stop' }
  | { type: 'gate'; requestId: string; value: string | boolean };

export type BgToPanel =
  | { type: 'conversation'; conversationId: string; turns: Turn[] }
  | { type: 'delta'; text: string }
  /** The model's thinking, streamed before its answer. */
  | { type: 'reasoning'; text: string }
  | { type: 'status'; status: 'running' | 'idle' }
  | { type: 'gate'; requestId: string; request: GateRequest }
  | { type: 'gate_closed'; requestId: string }
  | { type: 'error'; message: string };

export const PANEL_PORT = 'panel';

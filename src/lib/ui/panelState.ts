import type { BgToPanel, GateRequest } from '../messages';
import type { Turn } from '../types';

export interface PendingGate {
  requestId: string;
  request: GateRequest;
}

export interface PanelState {
  conversationId: string | null;
  turns: Turn[];
  streaming: string;
  reasoning: string;
  running: boolean;
  gates: PendingGate[];
  error: string | null;
}

export type PanelAction =
  | BgToPanel
  | { type: 'new_chat' }
  | { type: 'load'; conversationId: string; turns: Turn[] }
  | { type: 'dismiss_error' }
  | { type: 'disconnected' };

export const initialPanelState: PanelState = {
  conversationId: null,
  turns: [],
  streaming: '',
  reasoning: '',
  running: false,
  gates: [],
  error: null,
};

export function panelReducer(s: PanelState, a: PanelAction): PanelState {
  switch (a.type) {
    case 'conversation':
      return { ...s, conversationId: a.conversationId, turns: a.turns, streaming: '', reasoning: '' };
    case 'delta':
      return { ...s, streaming: s.streaming + a.text };
    case 'reasoning':
      return { ...s, reasoning: s.reasoning + a.text };
    case 'status':
      return a.status === 'running' ? { ...s, running: true, error: null } : { ...s, running: false, streaming: '', reasoning: '', gates: [] };
    case 'gate':
      return { ...s, gates: [...s.gates, { requestId: a.requestId, request: a.request }] };
    case 'gate_closed':
      return { ...s, gates: s.gates.filter((g) => g.requestId !== a.requestId) };
    case 'error':
      return { ...s, error: a.message };
    case 'dismiss_error':
      return { ...s, error: null };
    case 'new_chat':
      return s.running ? s : initialPanelState;
    case 'load':
      return s.running ? s : { ...initialPanelState, conversationId: a.conversationId, turns: a.turns };
    case 'disconnected':
      return { ...s, running: false, gates: [] };
  }
}

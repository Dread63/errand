import { describe, expect, it } from 'vitest';
import { initialPanelState, panelReducer } from '@/lib/ui/panelState';
import type { Turn } from '@/lib/types';

const turns: Turn[] = [{ kind: 'user', text: 'hi', attachments: [] }];

describe('panelReducer', () => {
  it('tracks conversation, streaming text and status', () => {
    let s = panelReducer(initialPanelState, { type: 'status', status: 'running' });
    s = panelReducer(s, { type: 'delta', text: 'Thin' });
    s = panelReducer(s, { type: 'delta', text: 'king' });
    expect(s.streaming).toBe('Thinking');
    s = panelReducer(s, { type: 'conversation', conversationId: 'c1', turns });
    expect(s).toMatchObject({ conversationId: 'c1', turns, streaming: '', running: true });
    s = panelReducer(s, { type: 'status', status: 'idle' });
    expect(s.running).toBe(false);
  });

  it('adds and removes approval gates; idle clears leftovers', () => {
    let s = panelReducer(initialPanelState, { type: 'gate', requestId: 'g1', request: { kind: 'site', origin: 'https://a.test' } });
    s = panelReducer(s, { type: 'gate', requestId: 'g2', request: { kind: 'ask', question: 'Size?' } });
    s = panelReducer(s, { type: 'gate_closed', requestId: 'g1' });
    expect(s.gates.map((g) => g.requestId)).toEqual(['g2']);
    expect(panelReducer(s, { type: 'status', status: 'idle' }).gates).toEqual([]);
  });

  it('new chat and load are ignored while running', () => {
    const running = panelReducer({ ...initialPanelState, conversationId: 'c1', turns }, { type: 'status', status: 'running' });
    expect(panelReducer(running, { type: 'new_chat' }).conversationId).toBe('c1');
    const idle = panelReducer(running, { type: 'status', status: 'idle' });
    expect(panelReducer(idle, { type: 'new_chat' })).toEqual(initialPanelState);
    expect(panelReducer(idle, { type: 'load', conversationId: 'c2', turns: [] })).toMatchObject({ conversationId: 'c2', turns: [] });
  });

  it('shows and dismisses errors; disconnect stops running', () => {
    let s = panelReducer(initialPanelState, { type: 'error', message: 'boom' });
    expect(s.error).toBe('boom');
    s = panelReducer(s, { type: 'dismiss_error' });
    expect(s.error).toBeNull();
    s = panelReducer({ ...s, running: true }, { type: 'disconnected' });
    expect(s.running).toBe(false);
  });
});

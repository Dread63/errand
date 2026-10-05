import { describe, expect, it } from 'vitest';
import { formatDuration, groupTurns, isFailed, stepNotes } from '@/lib/ui/activity';
import type { StepTurn, Turn } from '@/lib/types';

const step = (id: string, over: Partial<StepTurn> = {}): StepTurn => ({
  kind: 'step', id, label: `Step ${id}`, reasoning: '', call: { id, name: 'click', args: {} }, result: 'ok', risky: false, ...over,
});
const user = (text: string): Turn => ({ kind: 'user', text, attachments: [] });
const reply = (text: string): Turn => ({ kind: 'assistant', text });

describe('groupTurns', () => {
  it('folds consecutive steps between messages into one group', () => {
    const items = groupTurns([user('a'), step('1'), step('2'), reply('done'), user('b'), step('3'), reply('ok')], false);
    expect(items.map((i) => i.kind)).toEqual(['user', 'activity', 'assistant', 'user', 'activity', 'assistant']);
    const g = items[1];
    expect(g.kind === 'activity' && g.group.steps.map((s) => s.id)).toEqual(['1', '2']);
    expect(g.kind === 'activity' && g.group.live).toBe(false);
  });

  it('marks only the trailing group live while running, even before the first step', () => {
    expect(groupTurns([user('a')], true).map((i) => i.kind)).toEqual(['user', 'activity']);
    const items = groupTurns([user('a'), step('1'), reply('r'), user('b'), step('2')], true);
    const groups = items.filter((i) => i.kind === 'activity');
    expect(groups.map((g) => g.kind === 'activity' && g.group.live)).toEqual([false, true]);
    expect(groupTurns([user('a'), step('1'), reply('r')], true).filter((i) => i.kind === 'activity')).toHaveLength(1);
  });

  it('counts failures and measures duration from the first start to the last end', () => {
    const items = groupTurns(
      [user('a'), step('1', { startedAt: 1000, endedAt: 2000 }), step('2', { result: 'Error: gone', startedAt: 2000, endedAt: 25_000 }), reply('r')],
      false,
    );
    const g = items[1];
    if (g.kind !== 'activity') throw new Error('expected activity');
    expect(g.group.failures).toBe(1);
    expect(g.group.durationMs).toBe(24_000);
  });

  it('leaves duration unset for history without timestamps', () => {
    const g = groupTurns([user('a'), step('1'), reply('r')], false)[1];
    expect(g.kind === 'activity' && g.group.durationMs).toBeUndefined();
  });

  it('gives every item a stable key', () => {
    const keys = groupTurns([user('a'), step('1'), reply('r')], false).map((i) => i.key);
    expect(new Set(keys).size).toBe(3);
    expect(groupTurns([user('a'), step('1'), reply('r')], false).map((i) => i.key)).toEqual(keys);
  });
});

describe('isFailed', () => {
  it('detects errors and rejections', () => {
    expect(isFailed(step('1', { result: 'Error: x' }))).toBe(true);
    expect(isFailed(step('1', { result: 'The user rejected this action.' }))).toBe(true);
    expect(isFailed(step('1'))).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(400)).toBe('<1s');
    expect(formatDuration(4200)).toBe('4s');
    expect(formatDuration(65_000)).toBe('1m 05s');
  });
});

describe('stepNotes', () => {
  it('keeps the visible reasoning when the model also streamed thinking', () => {
    expect(stepNotes(step('1', { thinking: 'hmm', reasoning: 'Clicking Save' }))).toEqual({ thought: 'hmm', reasoning: 'Clicking Save' });
  });
  it('shows reasoning as the thought when there was no thinking, without repeating it', () => {
    expect(stepNotes(step('1', { reasoning: 'Clicking Save' }))).toEqual({ thought: 'Clicking Save' });
    expect(stepNotes(step('1'))).toEqual({});
  });
});

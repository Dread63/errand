import { describe, expect, it } from 'vitest';
import { applyChunk, finalize, fromCompletion, newAccumulator, stripThink } from '@/lib/llm/stream';

const names = ['click', 'done'];

describe('stream accumulation', () => {
  it('accumulates content deltas and native tool call fragments', () => {
    const acc = newAccumulator();
    expect(applyChunk(acc, { choices: [{ delta: { content: 'I will ' } }] })).toBe('I will ');
    applyChunk(acc, { choices: [{ delta: { content: 'click.' } }] });
    applyChunk(acc, {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'click', arguments: '{"i' } }] } }],
    });
    applyChunk(acc, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'd": 3}' } }] } }] });
    applyChunk(acc, { choices: [], usage: { prompt_tokens: 120, completion_tokens: 8 } });
    expect(finalize(acc, names)).toEqual({
      content: 'I will click.',
      toolCalls: [{ id: 'call_1', name: 'click', args: { id: 3 } }],
      usage: { promptTokens: 120, completionTokens: 8 },
    });
  });

  it('reports invalid argument JSON on the call instead of throwing', () => {
    const acc = newAccumulator();
    applyChunk(acc, { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'click', arguments: '{id: 3' } }] } }] });
    const r = finalize(acc, names);
    expect(r.toolCalls[0].name).toBe('click');
    expect(r.toolCalls[0].id).toBe('');
    expect(r.toolCalls[0].error).toMatch(/not valid JSON/);
  });

  it('falls back to a JSON tool call written in the text', () => {
    const acc = newAccumulator();
    applyChunk(acc, { choices: [{ delta: { content: 'Clicking now.\n```json\n{"name":"click","arguments":{"id":7}}\n```' } }] });
    expect(finalize(acc, names).toolCalls).toEqual([{ id: '', name: 'click', args: { id: 7 } }]);
  });

  it('parses non-streaming completions', () => {
    const r = fromCompletion(
      {
        choices: [
          { message: { content: 'ok', tool_calls: [{ id: 'x', function: { name: 'done', arguments: '{"summary":"s"}' } }] } },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      },
      names,
    );
    expect(r.toolCalls).toEqual([{ id: 'x', name: 'done', args: { summary: 's' } }]);
    expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 1 });
  });
});

describe('stripThink', () => {
  it('removes paired and unopened think blocks', () => {
    expect(stripThink('<think>hmm</think>Answer')).toBe('Answer');
    expect(stripThink('reasoning without open tag</think> Answer')).toBe('Answer');
    expect(stripThink('plain')).toBe('plain');
  });
});

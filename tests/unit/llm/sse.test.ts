import { describe, expect, it } from 'vitest';
import { createSseParser } from '@/lib/llm/sse';

describe('createSseParser', () => {
  it('handles events split across chunks and CRLF line endings', () => {
    const got: string[] = [];
    const p = createSseParser((d) => got.push(d));
    p.push('data: {"a"');
    p.push(':1}\r\n\r\ndata: [DO');
    p.push('NE]\n\n');
    expect(got).toEqual(['{"a":1}', '[DONE]']);
  });

  it('ignores comments and joins multi-line data', () => {
    const got: string[] = [];
    const p = createSseParser((d) => got.push(d));
    p.push(': keep-alive\n\ndata: one\ndata: two\n\n');
    expect(got).toEqual(['one\ntwo']);
  });

  it('flushes a trailing event without a blank line on end()', () => {
    const got: string[] = [];
    const p = createSseParser((d) => got.push(d));
    p.push('data: last');
    p.end();
    expect(got).toEqual(['last']);
  });
});

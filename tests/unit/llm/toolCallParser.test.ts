import { describe, expect, it } from 'vitest';
import { extractToolCallFromText } from '@/lib/llm/toolCallParser';

const names = ['click', 'type', 'done'];

describe('extractToolCallFromText', () => {
  it('reads Qwen-style <tool_call> tags', () => {
    expect(extractToolCallFromText('<tool_call>\n{"name": "click", "arguments": {"id": 4}}\n</tool_call>', names)).toEqual({
      name: 'click',
      args: { id: 4 },
    });
  });

  it('reads bare JSON embedded in prose, including "quotes" outside the object', () => {
    expect(extractToolCallFromText('He said "go". {"name":"type","args":{"id":2,"text":"a } b"}} ok', names)).toEqual({
      name: 'type',
      args: { id: 2, text: 'a } b' },
    });
  });

  it('accepts OpenAI-shaped {function:{name, arguments:"<json string>"}}', () => {
    expect(extractToolCallFromText('{"function":{"name":"done","arguments":"{\\"summary\\":\\"x\\"}"}}', names)).toEqual({
      name: 'done',
      args: { summary: 'x' },
    });
  });

  it('ignores unknown tools and non-tool JSON', () => {
    expect(extractToolCallFromText('{"name":"rm_rf","arguments":{}}', names)).toBeNull();
    expect(extractToolCallFromText('{"price": 12}', names)).toBeNull();
    expect(extractToolCallFromText('no json here', names)).toBeNull();
  });
});

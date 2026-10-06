import { describe, expect, it, vi } from 'vitest';
import { OpenAIClient, protocolUrl } from '@/lib/llm/client';
import type { ToolSchema } from '@/lib/llm/types';

const enc = new TextEncoder();
const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const sse = (chunks: string[]) =>
  new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const unsupported = () =>
  new Response('{"type":"error","error":{"type":"ModelProtocolUnsupported","message":"Model does not support this protocol."}}', { status: 400 });
const tools: ToolSchema[] = [{ type: 'function', function: { name: 'click', description: 'd', parameters: { type: 'object', properties: {} } } }];
const mk = (model: string) => ({ baseUrl: 'https://gw.test/zen/v1', apiKey: 'k', model });

describe('protocol fallback', () => {
  it('builds per-protocol urls', () => {
    expect(protocolUrl('https://gw.test/zen', 'responses')).toBe('https://gw.test/zen/v1/responses');
    expect(protocolUrl('https://gw.test/zen/v1/chat/completions', 'messages')).toBe('https://gw.test/zen/v1/messages');
  });

  it('falls back to the Responses API and remembers it', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/chat/completions')
        ? unsupported()
        : sse([
            ev({ type: 'response.output_text.delta', delta: 'Hi' }),
            ev({ type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'c1', name: 'click', arguments: '' } }),
            ev({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"id":' }),
            ev({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '2}' }),
            ev({ type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 3 } } }),
          ]),
    );
    const client = new OpenAIClient(mk('luna-a'), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'go' },
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'x', type: 'function' as const, function: { name: 'click', arguments: '{}' } }] },
      { role: 'tool' as const, tool_call_id: 'x', content: 'ok' },
    ];
    const r = await client.chat({ messages: msgs, tools });
    expect(r.content).toBe('Hi');
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'click', args: { id: 2 } }]);
    expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
    const body = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(body.instructions).toBe('sys');
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'go' }] },
      { type: 'function_call', call_id: 'x', name: 'click', arguments: '{}' },
      { type: 'function_call_output', call_id: 'x', output: 'ok' },
    ]);
    expect(body.tools[0]).toMatchObject({ type: 'function', name: 'click' });

    await client.chat({ messages: msgs, tools });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // second chat goes straight to /responses
  });

  it('falls through to the Anthropic Messages API', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/messages')
        ? sse([
            ev({ type: 'message_start', message: { usage: { input_tokens: 9, output_tokens: 1 } } }),
            ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
            ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Yo' } }),
            ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'click' } }),
            ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"id":7}' } }),
            ev({ type: 'message_delta', usage: { output_tokens: 4 } }),
          ])
        : unsupported(),
    );
    const client = new OpenAIClient(mk('muse-a'), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await client.chat({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'a', tool_calls: [{ id: 'x', type: 'function', function: { name: 'click', arguments: '{"id":1}' } }] },
        { role: 'tool', tool_call_id: 'x', content: 'ok' },
        { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] },
      ],
      tools,
    });
    expect(r.content).toBe('Yo');
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'click', args: { id: 7 } }]);
    expect(r.usage).toEqual({ promptTokens: 9, completionTokens: 4 });
    const [, init] = fetchImpl.mock.calls[2] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    const body = JSON.parse(String(init.body));
    expect(body.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }, { type: 'tool_use', id: 'x', name: 'click', input: { id: 1 } }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x', content: 'ok' },
          { type: 'text', text: 'look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' }, cache_control: { type: 'ephemeral' } },
        ],
      },
    ]);
    expect(body.tools[0]).toMatchObject({ name: 'click', input_schema: { type: 'object' } });
  });

  it('surfaces the error when every protocol is unsupported', async () => {
    const fetchImpl = vi.fn(async () => unsupported());
    await expect(new OpenAIClient(mk('none'), { fetchImpl: fetchImpl as unknown as typeof fetch, retryDelaysMs: [] }).chat({ messages: [], tools })).rejects.toThrow(/ModelProtocolUnsupported/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

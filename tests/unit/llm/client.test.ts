import { describe, expect, it, vi } from 'vitest';
import { chatUrl, listModels, modelsUrl, OpenAIClient } from '@/lib/llm/client';
import { LlmError } from '@/lib/errors';
import type { ToolSchema } from '@/lib/llm/types';

const enc = new TextEncoder();
const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
function sse(chunks: string[]): Response {
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const tools: ToolSchema[] = [
  { type: 'function', function: { name: 'click', description: '', parameters: { type: 'object', properties: {} } } },
];
const profile = { baseUrl: 'http://mac.ts.net:8000/v1', apiKey: 'sk-1', model: 'qwen' };

describe('chatUrl (Review Focus: base URL shapes)', () => {
  it.each([
    ['http://h:8000', 'http://h:8000/v1/chat/completions'],
    ['http://h:8000/', 'http://h:8000/v1/chat/completions'],
    ['http://h:8000/v1', 'http://h:8000/v1/chat/completions'],
    ['http://h:8000/v1/', 'http://h:8000/v1/chat/completions'],
    ['https://opencode.ai/zen/go/v1', 'https://opencode.ai/zen/go/v1/chat/completions'],
    ['http://h/v1/chat/completions', 'http://h/v1/chat/completions'],
  ])('%s → %s', (input, out) => {
    expect(chatUrl(input)).toBe(out);
  });
  it('derives the models url', () => {
    expect(modelsUrl('http://h:8000')).toBe('http://h:8000/v1/models');
  });
});

describe('OpenAIClient', () => {
  it('streams content and returns tool calls, sending auth, model, tools and stream flags', async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        ev({ choices: [{ delta: { content: 'Hi' } }] }),
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'click', arguments: '{"id":1}' } }] } }] }),
        'data: [DONE]\n\n',
      ]),
    );
    const deltas: string[] = [];
    const r = await new OpenAIClient(profile, { fetchImpl }).chat({
      messages: [{ role: 'user', content: 'x' }],
      tools,
      onDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(['Hi']);
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'click', args: { id: 1 } }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://mac.ts.net:8000/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'qwen', stream: true, tool_choice: 'auto' });
    expect(body.tools).toHaveLength(1);
  });

  it('sends the conversation id as x-opencode-session when given', async () => {
    const fetchImpl = vi.fn(async () => sse(['data: [DONE]\n\n']));
    const client = new OpenAIClient(profile, { fetchImpl });
    await client.chat({ messages: [], tools, sessionId: 'conv-1' });
    await client.chat({ messages: [], tools });
    const headers = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).map(([, init]) => init.headers as Record<string, string>);
    expect(headers[0]['x-opencode-session']).toBe('conv-1');
    expect(headers[1]['x-opencode-session']).toBeUndefined();
  });

  it('omits Authorization when there is no API key', async () => {
    const fetchImpl = vi.fn(async () => sse(['data: [DONE]\n\n']));
    await new OpenAIClient({ ...profile, apiKey: '' }, { fetchImpl }).chat({ messages: [], tools });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('accepts a non-streaming JSON response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'done!' } }] }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const r = await new OpenAIClient(profile, { fetchImpl }).chat({ messages: [], tools });
    expect(r.content).toBe('done!');
  });

  it('retries 5xx twice then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('busy', { status: 502 }))
      .mockResolvedValueOnce(sse([ev({ choices: [{ delta: { content: 'ok' } }] }), 'data: [DONE]\n\n']));
    const r = await new OpenAIClient(profile, { fetchImpl, retryDelaysMs: [0, 0] }).chat({ messages: [], tools });
    expect(r.content).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after 2 retries', async () => {
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 500 }));
    await expect(new OpenAIClient(profile, { fetchImpl, retryDelaysMs: [0, 0] }).chat({ messages: [], tools })).rejects.toThrow(
      /HTTP 500/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry 401', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 401 }));
    const err = await new OpenAIClient(profile, { fetchImpl, retryDelaysMs: [0, 0] })
      .chat({ messages: [], tools })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries network errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sse(['data: [DONE]\n\n']));
    await new OpenAIClient(profile, { fetchImpl, retryDelaysMs: [0, 0] }).chat({ messages: [], tools });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('times out an idle stream and reports it', async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = new ReadableStream({
        start(c) {
          init?.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    await expect(
      new OpenAIClient(profile, { fetchImpl, idleTimeoutMs: 20, retryDelaysMs: [] }).chat({ messages: [], tools }),
    ).rejects.toThrow(/No response from the model/);
  });

  it('propagates user abort without retrying', async () => {
    const c = new AbortController();
    const fetchImpl = vi.fn(async () => {
      c.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(
      new OpenAIClient(profile, { fetchImpl, retryDelaysMs: [0, 0] }).chat({ messages: [], tools, signal: c.signal }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('listModels', () => {
  it('returns model ids', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] })));
    expect(await listModels(profile, fetchImpl)).toEqual(['a', 'b']);
  });
});

import type { ToolCall } from '../types';
import { extractToolCallFromText } from './toolCallParser';
import type { ChatResult } from './types';

export interface StreamAccumulator {
  content: string;
  tools: Map<number, { id: string; name: string; args: string }>;
  usage?: { promptTokens: number; completionTokens: number };
}

type Chunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

export function newAccumulator(): StreamAccumulator {
  return { content: '', tools: new Map() };
}

export function applyChunk(acc: StreamAccumulator, chunk: unknown): string {
  const c = chunk as Chunk;
  if (c.usage && typeof c.usage.prompt_tokens === 'number') {
    acc.usage = { promptTokens: c.usage.prompt_tokens, completionTokens: c.usage.completion_tokens ?? 0 };
  }
  const delta = c.choices?.[0]?.delta;
  if (!delta) return '';
  for (const tc of delta.tool_calls ?? []) {
    const idx = tc.index ?? 0;
    const cur = acc.tools.get(idx) ?? { id: '', name: '', args: '' };
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.name += tc.function.name;
    if (tc.function?.arguments) cur.args += tc.function.arguments;
    acc.tools.set(idx, cur);
  }
  const text = delta.content ?? '';
  acc.content += text;
  return text;
}

export function stripThink(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^[\s\S]*?<\/think>/, '')
    .trim();
}

function parseNative(t: { id: string; name: string; args: string }): ToolCall {
  const raw = t.args.trim() || '{}';
  try {
    const args = JSON.parse(raw);
    if (args && typeof args === 'object' && !Array.isArray(args)) return { id: t.id, name: t.name, args };
    return { id: t.id, name: t.name, args: {}, error: 'Tool arguments must be a JSON object.' };
  } catch {
    return { id: t.id, name: t.name, args: {}, error: `Tool arguments were not valid JSON: ${raw.slice(0, 200)}` };
  }
}

export function finalize(acc: StreamAccumulator, toolNames: string[]): ChatResult {
  const content = stripThink(acc.content);
  const toolCalls = [...acc.tools.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => parseNative(t));
  if (toolCalls.length === 0) {
    const t = extractToolCallFromText(content, toolNames);
    if (t) toolCalls.push({ id: '', name: t.name, args: t.args });
  }
  const result: ChatResult = { content, toolCalls };
  if (acc.usage) result.usage = acc.usage;
  return result;
}

export function fromCompletion(json: unknown, toolNames: string[]): ChatResult {
  const j = json as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string | object } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const acc = newAccumulator();
  const msg = j.choices?.[0]?.message;
  acc.content = msg?.content ?? '';
  (msg?.tool_calls ?? []).forEach((tc, i) => {
    const a = tc.function?.arguments;
    acc.tools.set(i, { id: tc.id ?? '', name: tc.function?.name ?? '', args: typeof a === 'string' ? a : JSON.stringify(a ?? {}) });
  });
  if (typeof j.usage?.prompt_tokens === 'number') {
    acc.usage = { promptTokens: j.usage.prompt_tokens, completionTokens: j.usage.completion_tokens ?? 0 };
  }
  return finalize(acc, toolNames);
}

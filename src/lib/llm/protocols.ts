import { LlmError } from '../errors';
import type { Profile } from '../types';
import { applyChunk, finalize, fromCompletion as chatFromCompletion, type StreamAccumulator } from './stream';
import type { ChatMessage, ChatResult, ContentPart, ToolSchema } from './types';

/** Wire formats a gateway such as OpenCode may require per model. */
export type Protocol = 'chat' | 'responses' | 'messages';
export const PROTOCOLS: Protocol[] = ['chat', 'responses', 'messages'];

export interface ProtocolRequest {
  profile: Pick<Profile, 'model' | 'reasoningEffort'>;
  messages: ChatMessage[];
  tools: ToolSchema[];
  sessionId?: string;
}

export interface StreamDelta {
  text?: string;
  reasoning?: string;
}

export interface ProtocolAdapter {
  path: string;
  headers(apiKey: string): Record<string, string>;
  body(req: ProtocolRequest): Record<string, unknown>;
  /** Folds one parsed SSE event into the accumulator. Throws LlmError on a server-reported error. */
  applyEvent(acc: StreamAccumulator, json: unknown): StreamDelta;
  fromCompletion(json: unknown, toolNames: string[]): ChatResult;
}

const MAX_TOKENS = 16384;

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function serverError(e: unknown): LlmError {
  const o = asObj(e);
  return new LlmError(`Server error: ${str(o.message) || JSON.stringify(e)}`, true);
}

function parseDataUrl(url: string): { mediaType: string; data: string } | undefined {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return m ? { mediaType: m[1], data: m[2] } : undefined;
}

function systemText(messages: ChatMessage[]): string {
  return messages
    .filter((m): m is Extract<ChatMessage, { role: 'system' }> => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
}

function toolArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

// ---------- OpenAI Chat Completions ----------

const chat: ProtocolAdapter = {
  path: '/chat/completions',
  headers: (apiKey): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  body: ({ profile, messages, tools }) => ({
    model: profile.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(profile.reasoningEffort ? { reasoning_effort: profile.reasoningEffort } : {}),
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
  }),
  applyEvent(acc, json) {
    const err = asObj(json).error;
    if (err) throw serverError(err);
    const delta = (json as { choices?: Array<{ delta?: Obj }> }).choices?.[0]?.delta;
    const reasoning = delta?.reasoning_content ?? delta?.reasoning;
    return { text: applyChunk(acc, json), reasoning: typeof reasoning === 'string' ? reasoning : undefined };
  },
  fromCompletion: chatFromCompletion,
};

// ---------- OpenAI Responses ----------

function responsesInput(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      const parts: ContentPart[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      out.push({
        role: 'user',
        content: parts.map((p) =>
          p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: p.image_url.url },
        ),
      });
    } else if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
      for (const tc of m.tool_calls ?? []) {
        out.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || '{}' });
      }
    } else {
      out.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content });
    }
  }
  return out;
}

const responses: ProtocolAdapter = {
  path: '/responses',
  headers: chat.headers,
  body: ({ profile, messages, tools, sessionId }) => ({
    model: profile.model,
    ...(sessionId ? { prompt_cache_key: sessionId } : {}),
    instructions: systemText(messages) || undefined,
    input: responsesInput(messages),
    stream: true,
    store: false,
    ...(profile.reasoningEffort ? { reasoning: { effort: profile.reasoningEffort } } : {}),
    ...(tools.length
      ? {
          tools: tools.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
          tool_choice: 'auto',
        }
      : {}),
  }),
  applyEvent(acc, json) {
    const e = asObj(json);
    const type = str(e.type);
    const idx = typeof e.output_index === 'number' ? e.output_index : 0;
    switch (type) {
      case 'error':
        throw serverError(e.error ?? e);
      case 'response.failed':
        throw serverError(asObj(asObj(e.response).error));
      case 'response.output_text.delta': {
        const text = str(e.delta);
        acc.content += text;
        return { text };
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        return { reasoning: str(e.delta) };
      case 'response.output_item.added': {
        const item = asObj(e.item);
        if (item.type === 'function_call') {
          acc.tools.set(idx, { id: str(item.call_id) || str(item.id), name: str(item.name), args: str(item.arguments) });
        }
        return {};
      }
      case 'response.function_call_arguments.delta': {
        const cur = acc.tools.get(idx);
        if (cur) cur.args += str(e.delta);
        return {};
      }
      case 'response.output_item.done': {
        const item = asObj(e.item);
        const cur = acc.tools.get(idx);
        // The final item carries the complete arguments; prefer them over streamed fragments.
        if (cur && item.type === 'function_call' && str(item.arguments)) cur.args = str(item.arguments);
        return {};
      }
      case 'response.completed': {
        const u = asObj(asObj(e.response).usage);
        if (typeof u.input_tokens === 'number') acc.usage = { promptTokens: u.input_tokens, completionTokens: Number(u.output_tokens) || 0 };
        return {};
      }
      default:
        return {};
    }
  },
  fromCompletion(json, toolNames) {
    const j = asObj(json);
    const acc: StreamAccumulator = { content: '', tools: new Map() };
    const output = Array.isArray(j.output) ? j.output : [];
    output.forEach((raw, i) => {
      const item = asObj(raw);
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) if (asObj(c).type === 'output_text') acc.content += str(asObj(c).text);
      } else if (item.type === 'function_call') {
        acc.tools.set(i, { id: str(item.call_id) || str(item.id), name: str(item.name), args: str(item.arguments) });
      }
    });
    const u = asObj(j.usage);
    if (typeof u.input_tokens === 'number') acc.usage = { promptTokens: u.input_tokens, completionTokens: Number(u.output_tokens) || 0 };
    return finalize(acc, toolNames);
  },
};

// ---------- Anthropic Messages ----------

type Block = Obj;
type AnthropicMessage = { role: 'user' | 'assistant'; content: Block[] };

function anthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  // Anthropic requires alternating roles, and tool results live in user turns, so same-role neighbours merge.
  const push = (role: AnthropicMessage['role'], blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      const parts: ContentPart[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      push(
        'user',
        parts.flatMap((p): Block[] => {
          if (p.type === 'text') return p.text ? [{ type: 'text', text: p.text }] : [];
          const img = parseDataUrl(p.image_url.url);
          return [
            img
              ? { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }
              : { type: 'image', source: { type: 'url', url: p.image_url.url } },
          ];
        }),
      );
    } else if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: toolArgs(tc.function.arguments) });
      }
      push('assistant', blocks);
    } else {
      push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }]);
    }
  }
  // tool_result blocks must precede any other content in their user turn.
  for (const m of out) m.content.sort((a, b) => Number(b.type === 'tool_result') - Number(a.type === 'tool_result'));
  return out;
}

const CACHE = { type: 'ephemeral' };

/** Marks the final block so the whole conversation prefix is cached for the next step. */
function cacheLast(msgs: AnthropicMessage[]): AnthropicMessage[] {
  const last = msgs[msgs.length - 1]?.content.at(-1);
  if (last) last.cache_control = CACHE;
  return msgs;
}

const messagesProtocol: ProtocolAdapter = {
  path: '/messages',
  headers: (apiKey) => ({
    'anthropic-version': '2023-06-01',
    ...(apiKey ? { 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}` } : {}),
  }),
  body: ({ profile, messages, tools }) => ({
    model: profile.model,
    max_tokens: MAX_TOKENS,
    system: systemText(messages) ? [{ type: 'text', text: systemText(messages), cache_control: CACHE }] : undefined,
    messages: cacheLast(anthropicMessages(messages)),
    stream: true,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
          tool_choice: { type: 'auto' },
        }
      : {}),
  }),
  applyEvent(acc, json) {
    const e = asObj(json);
    const idx = typeof e.index === 'number' ? e.index : 0;
    switch (str(e.type)) {
      case 'error':
        throw serverError(e.error ?? e);
      case 'message_start': {
        const u = asObj(asObj(e.message).usage);
        if (typeof u.input_tokens === 'number') {
          const cached = Number(u.cache_read_input_tokens) || 0;
          acc.usage = { promptTokens: u.input_tokens + cached, completionTokens: Number(u.output_tokens) || 0 };
        }
        return {};
      }
      case 'message_delta': {
        const u = asObj(e.usage);
        if (acc.usage && typeof u.output_tokens === 'number') acc.usage.completionTokens = u.output_tokens;
        return {};
      }
      case 'content_block_start': {
        const b = asObj(e.content_block);
        if (b.type === 'tool_use') acc.tools.set(idx, { id: str(b.id), name: str(b.name), args: '' });
        else if (b.type === 'text' && str(b.text)) {
          acc.content += str(b.text);
          return { text: str(b.text) };
        }
        return {};
      }
      case 'content_block_delta': {
        const d = asObj(e.delta);
        if (d.type === 'text_delta') {
          acc.content += str(d.text);
          return { text: str(d.text) };
        }
        if (d.type === 'thinking_delta') return { reasoning: str(d.thinking) };
        if (d.type === 'input_json_delta') {
          const cur = acc.tools.get(idx);
          if (cur) cur.args += str(d.partial_json);
        }
        return {};
      }
      default:
        return {};
    }
  },
  fromCompletion(json, toolNames) {
    const j = asObj(json);
    const acc: StreamAccumulator = { content: '', tools: new Map() };
    (Array.isArray(j.content) ? j.content : []).forEach((raw, i) => {
      const b = asObj(raw);
      if (b.type === 'text') acc.content += str(b.text);
      else if (b.type === 'tool_use') acc.tools.set(i, { id: str(b.id), name: str(b.name), args: JSON.stringify(b.input ?? {}) });
    });
    const u = asObj(j.usage);
    if (typeof u.input_tokens === 'number') acc.usage = { promptTokens: u.input_tokens, completionTokens: Number(u.output_tokens) || 0 };
    return finalize(acc, toolNames);
  },
};

export const ADAPTERS: Record<Protocol, ProtocolAdapter> = { chat, responses, messages: messagesProtocol };

/** True when a gateway rejected the request because the model speaks a different wire protocol. */
export function isProtocolUnsupported(status: number | undefined, body: string): boolean {
  return (status === 400 || status === 404 || status === 405) && /ModelProtocolUnsupported|does not support this protocol/i.test(body);
}

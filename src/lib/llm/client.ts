import { LlmError } from '../errors';
import type { Profile } from '../types';
import { logTiming } from '../timing';
import { errMsg, sleep } from '../util';
import { createSseParser } from './sse';
import { applyChunk, finalize, fromCompletion, newAccumulator } from './stream';
import type { ChatMessage, ChatResult, ToolSchema } from './types';

export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** The model's thinking (reasoning_content / reasoning), streamed before its answer. */
  onReasoning?: (text: string) => void;
  /** Stable per-conversation id; OpenCode Go requires it as x-opencode-session. */
  sessionId?: string;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResult>;
}

export interface ClientOptions {
  fetchImpl?: typeof fetch;
  idleTimeoutMs?: number;
  retryDelaysMs?: number[];
}

export function chatUrl(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/, '');
  if (!/\/v\d+$/.test(u)) u += '/v1';
  return `${u}/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  return chatUrl(baseUrl).replace(/\/chat\/completions$/, '/models');
}

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export async function listModels(
  p: Pick<Profile, 'baseUrl' | 'apiKey'>,
  fetchImpl: typeof fetch = defaultFetch,
): Promise<string[]> {
  const url = modelsUrl(p.baseUrl);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: authHeaders(p.apiKey) });
  } catch (e) {
    throw new LlmError(`Could not reach ${url}: ${errMsg(e)}`, true);
  }
  if (!res.ok) throw new LlmError(`HTTP ${res.status} from ${url}`, false, res.status);
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return (json.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string');
}

export class OpenAIClient implements LlmClient {
  private fetchImpl: typeof fetch;
  private idleTimeoutMs: number;
  private retryDelays: number[];

  constructor(
    private profile: Pick<Profile, 'baseUrl' | 'apiKey' | 'model' | 'reasoningEffort'>,
    opts: ClientOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 120_000;
    this.retryDelays = opts.retryDelaysMs ?? [1000, 3000];
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    let last: LlmError | undefined;
    for (let attempt = 0; attempt <= this.retryDelays.length; attempt++) {
      if (attempt > 0) await sleep(this.retryDelays[attempt - 1], req.signal);
      const t0 = performance.now();
      try {
        return await this.once(req);
      } catch (e) {
        if (req.signal?.aborted) throw e;
        const err = e instanceof LlmError ? e : new LlmError(errMsg(e), true);
        logTiming(`model: attempt ${attempt + 1} failed (${err.message.slice(0, 120)})${err.retryable && attempt < this.retryDelays.length ? '; retrying' : ''}`, performance.now() - t0);
        if (!err.retryable) throw err;
        last = err;
      }
    }
    throw last ?? new LlmError('Model request failed', false);
  }

  private async once(req: ChatRequest): Promise<ChatResult> {
    const names = req.tools.map((t) => t.function.name);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(req.signal?.reason);
    req.signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort(new Error('timeout'));
      }, this.idleTimeoutMs);
    };
    const timeoutMsg = () => `No response from the model for ${Math.round(this.idleTimeoutMs / 1000)}s.`;
    arm();
    const t0 = performance.now();
    const since = () => performance.now() - t0;
    try {
      const body = {
        model: this.profile.model,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(this.profile.reasoningEffort ? { reasoning_effort: this.profile.reasoningEffort } : {}),
        ...(req.tools.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
      };
      let res: Response;
      try {
        res = await this.fetchImpl(chatUrl(this.profile.baseUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(this.profile.apiKey),
            ...(req.sessionId ? { 'x-opencode-session': req.sessionId } : {}),
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        if (req.signal?.aborted) throw e;
        throw new LlmError(timedOut ? timeoutMsg() : `Network error: ${errMsg(e)}`, true);
      }
      logTiming('model: response headers', since());
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        throw new LlmError(`HTTP ${res.status}: ${text.slice(0, 300)}`, retryable, res.status);
      }
      if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        return fromCompletion(await res.json(), names);
      }
      if (!res.body) throw new LlmError('Empty response body', true);

      const acc = newAccumulator();
      let done = false;
      let firstReasoning = -1;
      let firstOutput = -1;
      let reasoningChars = 0;
      const parser = createSseParser((data) => {
        if (data.trim() === '[DONE]') {
          done = true;
          return;
        }
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          return;
        }
        const err = (json as { error?: { message?: string } }).error;
        if (err) throw new LlmError(`Server error: ${err.message ?? JSON.stringify(err)}`, true);
        const delta = (json as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]?.delta;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoning === 'string' && reasoning) {
          if (firstReasoning < 0) firstReasoning = since();
          reasoningChars += reasoning.length;
          req.onReasoning?.(reasoning);
        }
        if (firstOutput < 0 && (delta?.content || delta?.tool_calls)) firstOutput = since();
        const text = applyChunk(acc, json);
        if (text) req.onDelta?.(text);
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (!done) {
          const { value, done: end } = await reader.read();
          if (end) break;
          arm();
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.end();
        if (firstReasoning >= 0) logTiming(`model: first reasoning token (${reasoningChars} chars total)`, firstReasoning);
        if (firstOutput >= 0) logTiming('model: first content/tool-call token', firstOutput);
        logTiming(`model: stream done (${acc.usage ? `${acc.usage.promptTokens} prompt / ${acc.usage.completionTokens} completion tokens` : 'no usage reported'})`, since());
      } catch (e) {
        if (e instanceof LlmError) throw e;
        if (req.signal?.aborted) throw e;
        throw new LlmError(timedOut ? timeoutMsg() : `Stream interrupted: ${errMsg(e)}`, true);
      } finally {
        reader.cancel().catch(() => {});
      }
      return finalize(acc, names);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}

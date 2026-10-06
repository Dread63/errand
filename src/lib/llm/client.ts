import { LlmError } from '../errors';
import type { Profile } from '../types';
import { logTiming } from '../timing';
import { errMsg, sleep } from '../util';
import { createSseParser } from './sse';
import { ADAPTERS, isProtocolUnsupported, PROTOCOLS, type Protocol } from './protocols';
import { finalize, newAccumulator } from './stream';
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

function apiRoot(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, '');
  u = u.replace(/\/(chat\/completions|responses|messages)$/, '');
  if (!/\/v\d+$/.test(u)) u += '/v1';
  return u;
}

export function chatUrl(baseUrl: string): string {
  return `${apiRoot(baseUrl)}/chat/completions`;
}

export function protocolUrl(baseUrl: string, protocol: Protocol): string {
  return `${apiRoot(baseUrl)}${ADAPTERS[protocol].path}`;
}

export function modelsUrl(baseUrl: string): string {
  return chatUrl(baseUrl).replace(/\/chat\/completions$/, '/models');
}

/** Protocol each model last worked with, so the fallback probe only costs one failed request per model. */
const knownProtocols = new Map<string, Protocol>();
const protocolKey = (p: Pick<Profile, 'baseUrl' | 'model'>) => `${apiRoot(p.baseUrl)}|${p.model}`;

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

  /** Tries the model's known protocol first, then the others when the gateway says it doesn't speak it. */
  async chat(req: ChatRequest): Promise<ChatResult> {
    const key = protocolKey(this.profile);
    const first = knownProtocols.get(key) ?? 'chat';
    const order = [first, ...PROTOCOLS.filter((p) => p !== first)];
    let unsupported: LlmError | undefined;
    for (const protocol of order) {
      try {
        const result = await this.chatWith(protocol, req);
        knownProtocols.set(key, protocol);
        return result;
      } catch (e) {
        if (!(e instanceof LlmError) || !e.protocolUnsupported) throw e;
        unsupported ??= e;
        logTiming(`model: ${protocol} protocol unsupported; trying next`, 0);
      }
    }
    throw unsupported ?? new LlmError('Model request failed', false);
  }

  private async chatWith(protocol: Protocol, req: ChatRequest): Promise<ChatResult> {
    let last: LlmError | undefined;
    for (let attempt = 0; attempt <= this.retryDelays.length; attempt++) {
      if (attempt > 0) await sleep(this.retryDelays[attempt - 1], req.signal);
      const t0 = performance.now();
      try {
        return await this.once(protocol, req);
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

  private async once(protocol: Protocol, req: ChatRequest): Promise<ChatResult> {
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
      const adapter = ADAPTERS[protocol];
      const body = adapter.body({ profile: this.profile, messages: req.messages, tools: req.tools, sessionId: req.sessionId });
      let res: Response;
      try {
        res = await this.fetchImpl(protocolUrl(this.profile.baseUrl, protocol), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...adapter.headers(this.profile.apiKey),
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
        const err = new LlmError(`HTTP ${res.status}: ${text.slice(0, 300)}`, retryable && !isProtocolUnsupported(res.status, text), res.status);
        err.protocolUnsupported = isProtocolUnsupported(res.status, text);
        throw err;
      }
      if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        return adapter.fromCompletion(await res.json(), names);
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
        const { text, reasoning } = adapter.applyEvent(acc, json);
        if (reasoning) {
          if (firstReasoning < 0) firstReasoning = since();
          reasoningChars += reasoning.length;
          req.onReasoning?.(reasoning);
        }
        if (firstOutput < 0 && (text || acc.tools.size)) firstOutput = since();
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

import type { AgentDeps } from '@/lib/agent/loop';
import type { BrowserDriver, RiskyRequest, UserGate } from '@/lib/agent/ports';
import { ToolError } from '@/lib/errors';
import type { ChatRequest, LlmClient } from '@/lib/llm/client';
import type { ChatResult } from '@/lib/llm/types';
import { SitePolicy } from '@/lib/policy/sites';
import { memoryKV } from '@/lib/storage/kv';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import { SitePermissionStore } from '@/lib/storage/sites';
import type { ActionTarget, ElementInfo, Observation, Profile, TabInfo, ToolCall, Turn } from '@/lib/types';
import { originOf } from '@/lib/url';

export const toolCall = (name: string, args: Record<string, unknown> = {}, content = ''): ChatResult => ({
  content,
  toolCalls: [{ id: '', name, args }],
});
export const textReply = (content: string): ChatResult => ({ content, toolCalls: [] });

export type FakeReply = ChatResult & { thinking?: string };

export class FakeLlm implements LlmClient {
  requests: ChatRequest[] = [];
  constructor(public script: Array<FakeReply | Error>) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const next = this.script.shift();
    if (!next) throw new Error('FakeLlm script exhausted');
    if (next instanceof Error) throw next;
    if (next.thinking) for (const ch of next.thinking.match(/.{1,5}/gs) ?? []) req.onReasoning?.(ch);
    const { thinking: _t, ...result } = next;
    return result;
  }
}

export function el(id: number, over: Partial<ElementInfo> = {}): ElementInfo {
  return {
    id,
    tag: 'button',
    role: 'button',
    name: `Button ${id}`,
    inForm: false,
    isSubmit: false,
    download: false,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    ...over,
  };
}

export class FakeDriver implements BrowserDriver {
  url = 'https://shop.test/';
  elements: Record<number, ElementInfo> = { 1: el(1) };
  performed: ToolCall[] = [];
  highlights: Array<ActionTarget | null> = [];
  reattached = 0;
  observeErrors: Error[] = [];
  performErrors: Error[] = [];
  observed = 0;

  async activeUrl() {
    return this.url;
  }
  async listTabs(): Promise<TabInfo[]> {
    return [{ index: 0, tabId: 1, title: 'Shop', url: this.url, active: true }];
  }
  async observe(): Promise<Observation> {
    const e = this.observeErrors.shift();
    if (e) throw e;
    this.observed++;
    return {
      snapshot: {
        url: this.url,
        title: 'Shop',
        restricted: false,
        elements: Object.values(this.elements),
        headings: [],
        scrollY: 0,
        scrollMaxY: 0,
        viewport: { w: 1000, h: 800 },
      },
      tabs: await this.listTabs(),
    };
  }
  async target(c: ToolCall): Promise<ActionTarget> {
    if (c.name === 'navigate' || c.name === 'new_tab') return { tabId: 1, origin: originOf(String(c.args.url)) };
    if (typeof c.args.id === 'number') {
      const e = this.elements[c.args.id];
      if (!e) throw new ToolError(`Element [${c.args.id}] no longer exists on the page.`);
      return { tabId: 1, origin: originOf(this.url), element: e, point: { x: 5, y: 5 } };
    }
    return { tabId: 1, origin: originOf(this.url) };
  }
  async perform(c: ToolCall): Promise<string> {
    const e = this.performErrors.shift();
    if (e) throw e;
    this.performed.push(c);
    if (c.name === 'navigate') this.url = String(c.args.url);
    return `ok ${c.name}`;
  }
  async highlight(t: ActionTarget | null) {
    this.highlights.push(t);
  }
  async reattach() {
    this.reattached++;
  }
}

export class FakeGate implements UserGate {
  siteAnswers: Array<'once' | 'always' | 'deny'> = [];
  riskyAnswers: boolean[] = [];
  askAnswers: string[] = [];
  retryAnswers: boolean[] = [];
  log: string[] = [];
  async site(origin: string) {
    this.log.push(`site:${origin}`);
    return this.siteAnswers.shift() ?? 'once';
  }
  async risky(r: RiskyRequest) {
    this.log.push(`risky:${r.description}`);
    return this.riskyAnswers.shift() ?? false;
  }
  async ask(q: string) {
    this.log.push(`ask:${q}`);
    return this.askAnswers.shift() ?? '';
  }
  async retry(m: string) {
    this.log.push(`retry:${m}`);
    return this.retryAnswers.shift() ?? false;
  }
}

export const testProfile: Profile = {
  id: 'p',
  name: 'Test',
  baseUrl: 'http://x/v1',
  apiKey: '',
  model: 'm',
  supportsVision: false,
  contextMode: 'standard',
  contextWindow: 100_000,
  maxScreenshots: 1,
};

export function setup(script: Array<FakeReply | Error>) {
  const llm = new FakeLlm(script);
  const driver = new FakeDriver();
  const gate = new FakeGate();
  const siteStore = new SitePermissionStore(memoryKV());
  const ctrl = new AbortController();
  let n = 0;
  const turnsSeen: Turn[][] = [];
  const deps: AgentDeps = {
    llm,
    driver,
    gate,
    sites: new SitePolicy(siteStore),
    profile: testProfile,
    settings: { ...DEFAULT_SETTINGS, stepLimit: 10 },
    hooks: { onTurns: (t) => turnsSeen.push(t), onDelta: () => {} },
    signal: ctrl.signal,
    newId: () => `id${++n}`,
  };
  return { llm, driver, gate, siteStore, ctrl, deps, turnsSeen };
}

export const task: Turn[] = [{ kind: 'user', text: 'Do the thing', attachments: [] }];
export const last = (turns: Turn[]) => turns[turns.length - 1];

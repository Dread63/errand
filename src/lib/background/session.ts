import { runAgent } from '../agent/loop';
import type { BrowserDriver, RiskyRequest, UserGate } from '../agent/ports';
import type { LlmClient } from '../llm/client';
import type { BgToPanel, GateRequest, PanelToBg } from '../messages';
import { type SiteDecision, SitePolicy } from '../policy/sites';
import type { HistoryStore } from '../storage/history';
import type { ProfileStore } from '../storage/profiles';
import type { SettingsStore } from '../storage/settings';
import type { SitePermissionStore } from '../storage/sites';
import type { Conversation, Profile } from '../types';
import { setTimingEnabled, timed } from '../timing';
import { errMsg } from '../util';

export interface DriverHandle extends BrowserDriver {
  start(tabId: number): Promise<void>;
  stop(): Promise<void>;
}

export interface SessionDeps {
  profiles: ProfileStore;
  settings: SettingsStore;
  siteStore: SitePermissionStore;
  history: HistoryStore;
  makeLlm(profile: Profile): LlmClient;
  makeDriver(): DriverHandle;
  newId?: () => string;
}

const aborted = () => new DOMException('Aborted', 'AbortError');

export class PortGate implements UserGate {
  private pending = new Map<string, (v: string | boolean) => void>();

  constructor(
    private post: (m: BgToPanel) => void,
    private signal: AbortSignal,
    private newId: () => string,
  ) {}

  private request(request: GateRequest): Promise<string | boolean> {
    return new Promise((resolve, reject) => {
      if (this.signal.aborted) return reject(aborted());
      const requestId = this.newId();
      const onAbort = () => {
        this.pending.delete(requestId);
        this.post({ type: 'gate_closed', requestId });
        reject(aborted());
      };
      this.signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, (v) => {
        this.signal.removeEventListener('abort', onAbort);
        resolve(v);
      });
      this.post({ type: 'gate', requestId, request });
    });
  }

  answer(requestId: string, value: string | boolean): void {
    const resolve = this.pending.get(requestId);
    if (!resolve) return;
    this.pending.delete(requestId);
    this.post({ type: 'gate_closed', requestId });
    resolve(value);
  }

  async site(origin: string): Promise<SiteDecision> {
    const v = await this.request({ kind: 'site', origin });
    return v === 'once' || v === 'always' ? v : 'deny';
  }

  async risky(req: RiskyRequest): Promise<boolean> {
    return (await this.request({ kind: 'risky', ...req })) === true;
  }

  async ask(question: string): Promise<string> {
    return String(await this.request({ kind: 'ask', question }));
  }

  async retry(message: string): Promise<boolean> {
    return (await this.request({ kind: 'retry', message })) === true;
  }
}

export class PanelSession {
  private abort: AbortController | null = null;
  private gate: PortGate | null = null;
  private running: Promise<void> | null = null;
  private newId: () => string;

  constructor(
    private port: { postMessage(m: BgToPanel): void },
    private deps: SessionDeps,
  ) {
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  private post(m: BgToPanel): void {
    try {
      this.port.postMessage(m);
    } catch {
      // the panel closed; the task is being stopped
    }
  }

  handle(msg: PanelToBg): Promise<void> | void {
    switch (msg.type) {
      case 'start':
        if (this.running) {
          this.post({ type: 'error', message: 'A task is already running. Stop it first.' });
          return;
        }
        this.running = this.run(msg).finally(() => {
          this.running = null;
        });
        return this.running;
      case 'stop':
        this.abort?.abort();
        return;
      case 'gate':
        this.gate?.answer(msg.requestId, msg.value);
        return;
    }
  }

  /** Called when the panel disconnects. */
  dispose(): void {
    this.abort?.abort();
  }

  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async run(msg: Extract<PanelToBg, { type: 'start' }>): Promise<void> {
    const settings = await this.deps.settings.get();
    setTimingEnabled(settings.debugTiming);
    const profile = settings.activeProfileId ? await this.deps.profiles.get(settings.activeProfileId) : undefined;
    if (!profile) {
      this.post({ type: 'error', message: 'No model profile selected. Choose one in the panel header or add one in Settings.' });
      return;
    }
    if (!profile.supportsVision && msg.attachments.some((a) => a.kind === 'image')) {
      this.post({
        type: 'error',
        message: `The profile "${profile.name}" does not support images. Remove image attachments or enable vision for this profile.`,
      });
      return;
    }

    const existing = msg.conversationId ? await this.deps.history.get(msg.conversationId) : undefined;
    const now = Date.now();
    const conv: Conversation = existing ?? {
      id: this.newId(),
      title: msg.text.slice(0, 60),
      createdAt: now,
      updatedAt: now,
      profileId: profile.id,
      turns: [],
    };
    conv.turns = [...conv.turns, { kind: 'user', text: msg.text, attachments: msg.attachments }];

    const abort = new AbortController();
    this.abort = abort;
    const gate = new PortGate((m) => this.post(m), abort.signal, this.newId);
    this.gate = gate;
    this.post({ type: 'status', status: 'running' });
    this.post({ type: 'conversation', conversationId: conv.id, turns: conv.turns });

    const driver = this.deps.makeDriver();
    try {
      await timed('session: start driver', () => driver.start(msg.tabId));
      conv.turns = await runAgent(conv.turns, {
        llm: this.deps.makeLlm(profile),
        driver,
        gate,
        sites: new SitePolicy(this.deps.siteStore),
        profile,
        settings,
        signal: abort.signal,
        newId: this.newId,
        sessionId: conv.id,
        hooks: {
          onTurns: (turns) => {
            conv.turns = turns;
            this.post({ type: 'conversation', conversationId: conv.id, turns });
          },
          onDelta: (text) => this.post({ type: 'delta', text }),
          onReasoning: (text) => this.post({ type: 'reasoning', text }),
        },
      });
    } catch (e) {
      conv.turns = [...conv.turns, { kind: 'assistant', text: `Error: ${errMsg(e)}` }];
    } finally {
      await driver.stop().catch(() => {});
      conv.updatedAt = Date.now();
      await this.deps.history.save(conv);
      this.abort = null;
      this.gate = null;
      this.post({ type: 'conversation', conversationId: conv.id, turns: conv.turns });
      this.post({ type: 'status', status: 'idle' });
    }
  }
}

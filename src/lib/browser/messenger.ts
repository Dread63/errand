import type { ContentReply, ContentRequest } from '../content/protocol';
import { ToolError } from '../errors';
import { errMsg } from '../util';

export interface MessengerDeps {
  sendMessage(tabId: number, msg: unknown): Promise<ContentReply | undefined>;
  inject(tabId: number): Promise<void>;
}

const chromeDeps = (): MessengerDeps => ({
  sendMessage: (tabId, msg) => chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }) as Promise<ContentReply | undefined>,
  inject: async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/content.js'] });
  },
});

export class ContentMessenger {
  private deps: MessengerDeps;

  constructor(deps?: MessengerDeps) {
    this.deps = deps ?? chromeDeps();
  }

  async ensureInjected(tabId: number): Promise<void> {
    try {
      const r = await this.deps.sendMessage(tabId, { __bc: true, req: { type: 'ping' } });
      if (r?.ok) return;
    } catch {
      // not injected yet
    }
    await this.deps.inject(tabId);
  }

  async send<T>(tabId: number, req: ContentRequest): Promise<T> {
    const msg = { __bc: true, req };
    let reply: ContentReply | undefined;
    try {
      reply = await this.deps.sendMessage(tabId, msg);
    } catch {
      // The page navigated or was loaded before install: inject and try once more.
      try {
        await this.deps.inject(tabId);
        reply = await this.deps.sendMessage(tabId, msg);
      } catch (e) {
        throw new ToolError(`Could not reach the page (it may still be loading): ${errMsg(e)}`);
      }
    }
    if (!reply) throw new ToolError('The page did not respond.');
    if (!reply.ok) throw new ToolError(reply.error);
    return reply.value as T;
  }
}

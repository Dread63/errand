import { TaskEndedError, ToolError } from '../errors';
import type { TabInfo } from '../types';
import { logTiming } from '../timing';
import { sleep } from '../util';

type Tab = chrome.tabs.Tab;
type Listener<T extends unknown[]> = { addListener(cb: (...a: T) => void): void; removeListener(cb: (...a: T) => void): void };

export interface TabsApi {
  get(tabId: number): Promise<Tab>;
  create(p: { url: string; active: boolean; windowId?: number }): Promise<Tab>;
  update(tabId: number, p: { url?: string; active?: boolean }): Promise<Tab | undefined>;
  remove(tabId: number): Promise<void>;
  group(o: { tabIds: number[]; groupId?: number }): Promise<number>;
  goBack(tabId: number): Promise<void>;
  onCreated: Listener<[Tab]>;
  onRemoved: Listener<[number]>;
}

export interface TabGroupsApi {
  update(groupId: number, p: { title?: string; color?: string }): Promise<unknown>;
}

export class AgentTabs {
  private tabIds = new Set<number>();
  private groupId = -1;
  private activeId = -1;
  private windowId: number | undefined;
  private ended = false;

  private readonly onCreated = (tab: Tab) => {
    if (tab.id === undefined || tab.openerTabId === undefined || !this.tabIds.has(tab.openerTabId)) return;
    this.adopt(tab.id).catch(() => {});
  };

  private readonly onRemoved = (tabId: number) => {
    if (!this.tabIds.delete(tabId)) return;
    if (this.activeId !== tabId) return;
    const next = [...this.tabIds][0];
    if (next === undefined) {
      this.ended = true;
      return;
    }
    this.activeId = next;
    this.tabs.update(next, { active: true }).catch(() => {});
  };

  constructor(
    private tabs: TabsApi,
    private groups: TabGroupsApi,
    private opts: { loadTimeoutMs?: number; pollMs?: number } = {},
  ) {}

  async start(seedTabId: number): Promise<void> {
    const seed = await this.tabs.get(seedTabId);
    this.windowId = seed.windowId;
    this.groupId = await this.tabs.group({ tabIds: [seedTabId] });
    await this.groups.update(this.groupId, { title: 'Errand', color: 'purple' });
    this.tabIds.add(seedTabId);
    this.activeId = seedTabId;
    await this.tabs.update(seedTabId, { active: true });
    this.tabs.onCreated.addListener(this.onCreated);
    this.tabs.onRemoved.addListener(this.onRemoved);
  }

  stop(): void {
    this.tabs.onCreated.removeListener(this.onCreated);
    this.tabs.onRemoved.removeListener(this.onRemoved);
  }

  private async adopt(tabId: number): Promise<void> {
    this.tabIds.add(tabId);
    this.activeId = tabId;
    await this.tabs.group({ tabIds: [tabId], groupId: this.groupId });
  }

  async active(): Promise<Tab> {
    if (this.ended) throw new TaskEndedError('All agent tabs were closed, so the task ended.');
    return this.tabs.get(this.activeId);
  }

  async list(): Promise<TabInfo[]> {
    const all = await Promise.all([...this.tabIds].map((id) => this.tabs.get(id).catch(() => null)));
    return all
      .filter((t): t is Tab => !!t)
      .sort((a, b) => a.index - b.index)
      .map((t, i) => ({ index: i, tabId: t.id!, title: t.title ?? '', url: t.url || t.pendingUrl || '', active: t.id === this.activeId }));
  }

  async open(url: string): Promise<void> {
    const t = await this.tabs.create({ url, active: true, windowId: this.windowId });
    await this.adopt(t.id!);
    await this.waitForLoad(t.id!);
  }

  async switchTo(index: number): Promise<void> {
    const t = (await this.list()).find((x) => x.index === index);
    if (!t) throw new ToolError(`No agent tab with index ${index}.`);
    await this.tabs.update(t.tabId, { active: true });
    this.activeId = t.tabId;
  }

  async close(index: number): Promise<void> {
    const list = await this.list();
    if (list.length <= 1) throw new ToolError("Can't close the last agent tab; call done instead.");
    const t = list.find((x) => x.index === index);
    if (!t) throw new ToolError(`No agent tab with index ${index}.`);
    await this.tabs.remove(t.tabId);
    this.onRemoved(t.tabId);
  }

  async navigate(url: string): Promise<void> {
    await this.tabs.update(this.activeId, { url });
    await this.waitForLoad(this.activeId);
  }

  async back(): Promise<void> {
    try {
      await this.tabs.goBack(this.activeId);
    } catch {
      throw new ToolError('There is no previous page.');
    }
    await this.waitForLoad(this.activeId);
  }

  async waitForLoad(tabId: number, timeoutMs = this.opts.loadTimeoutMs ?? 15_000): Promise<void> {
    const poll = this.opts.pollMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    await sleep(Math.min(poll, 100));
    while (Date.now() < deadline) {
      const t = await this.tabs.get(tabId).catch(() => null);
      if (!t || t.status === 'complete') return;
      await sleep(poll);
    }
    logTiming(`waitForLoad: gave up, tab ${tabId} still loading after`, timeoutMs);
  }
}

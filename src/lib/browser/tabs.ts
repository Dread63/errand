import { TaskEndedError, ToolError } from '../errors';
import type { TabInfo } from '../types';
import { logTiming } from '../timing';
import { sleep } from '../util';

type Tab = chrome.tabs.Tab;
type Listener<T extends unknown[]> = { addListener(cb: (...a: T) => void): void; removeListener(cb: (...a: T) => void): void };

export interface TabsApi {
  get(tabId: number): Promise<Tab>;
  query(q: { groupId: number }): Promise<Tab[]>;
  create(p: { url: string; active: boolean; windowId?: number }): Promise<Tab>;
  update(tabId: number, p: { url?: string; active?: boolean }): Promise<Tab | undefined>;
  remove(tabId: number): Promise<void>;
  group(o: { tabIds: number[]; groupId?: number }): Promise<number>;
  goBack(tabId: number): Promise<void>;
  onCreated: Listener<[Tab]>;
}

export interface TabGroupsApi {
  get(groupId: number): Promise<{ title?: string }>;
  update(groupId: number, p: { title?: string; color?: string }): Promise<unknown>;
}

const GROUP_TITLE = 'Errand';
const NO_GROUP = -1;

/**
 * The agent's workspace is a Chrome tab group. The group, not a private list, is the source of truth for
 * which tabs the agent can use, so tabs the user adds or closes at any time are picked up. One instance
 * outlives individual runs, so a stopped task resumes in the same group.
 */
export class AgentTabs {
  private groupId = NO_GROUP;
  private activeId = -1;
  private windowId: number | undefined;

  private readonly onCreated = (tab: Tab) => {
    if (tab.id === undefined || tab.openerTabId === undefined) return;
    const tabId = tab.id;
    this.tabs
      .get(tab.openerTabId)
      .then((opener) => (opener.groupId === this.groupId ? this.adopt(tabId) : undefined))
      .catch(() => {});
  };

  constructor(
    private tabs: TabsApi,
    private groups: TabGroupsApi,
    private opts: { loadTimeoutMs?: number; pollMs?: number } = {},
  ) {}

  /** Makes sure the agent has a group, creating one around `seedTabId` unless a usable one exists. */
  async prepare(seedTabId: number, fresh = false): Promise<number> {
    if (!fresh && this.groupId !== NO_GROUP && (await this.members()).length > 0) return this.groupId;
    const seed = await this.tabs.get(seedTabId);
    this.windowId = seed.windowId;
    this.activeId = seedTabId;
    const existing = fresh || seed.groupId === undefined || seed.groupId < 0 ? undefined : await this.groups.get(seed.groupId).catch(() => undefined);
    if (existing?.title === GROUP_TITLE) {
      this.groupId = seed.groupId;
      return this.groupId;
    }
    this.groupId = await this.tabs.group({ tabIds: [seedTabId] });
    await this.groups.update(this.groupId, { title: GROUP_TITLE, color: 'purple' });
    return this.groupId;
  }

  /** Begins a run: the user's tab is used if it belongs to the group, else the tab the agent last used. */
  async start(seedTabId: number): Promise<void> {
    await this.prepare(seedTabId);
    const members = await this.members();
    const pick = members.find((t) => t.id === seedTabId) ?? members.find((t) => t.id === this.activeId) ?? members[0];
    if (pick) {
      this.activeId = pick.id!;
      await this.tabs.update(pick.id!, { active: true });
    }
    this.tabs.onCreated.addListener(this.onCreated);
  }

  stop(): void {
    this.tabs.onCreated.removeListener(this.onCreated);
  }

  private async members(): Promise<Tab[]> {
    if (this.groupId === NO_GROUP) return [];
    const all = await this.tabs.query({ groupId: this.groupId }).catch(() => []);
    return all.sort((a, b) => a.index - b.index);
  }

  private async adopt(tabId: number): Promise<void> {
    await this.tabs.group({ tabIds: [tabId], groupId: this.groupId });
    this.activeId = tabId;
  }

  async active(): Promise<Tab> {
    const members = await this.members();
    if (members.length === 0) throw new TaskEndedError('All agent tabs were closed, so the task ended.');
    const current = members.find((t) => t.id === this.activeId);
    if (current) return current;
    this.activeId = members[0].id!;
    await this.tabs.update(this.activeId, { active: true }).catch(() => {});
    return members[0];
  }

  async list(): Promise<TabInfo[]> {
    return (await this.members()).map((t, i) => ({ index: i, tabId: t.id!, title: t.title ?? '', url: t.url || t.pendingUrl || '', active: t.id === this.activeId }));
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

  /** `grace` is a pause before the first check, for a navigation that has not started yet; callers that already waited pass 0. */
  async waitForLoad(tabId: number, timeoutMs = this.opts.loadTimeoutMs ?? 15_000, grace = Math.min(this.opts.pollMs ?? 50, 100)): Promise<void> {
    const poll = this.opts.pollMs ?? 50;
    const deadline = Date.now() + timeoutMs;
    if (grace) await sleep(grace);
    while (Date.now() < deadline) {
      const t = await this.tabs.get(tabId).catch(() => null);
      if (!t || t.status === 'complete') return;
      await sleep(poll);
    }
    logTiming(`waitForLoad: gave up, tab ${tabId} still loading after`, timeoutMs);
  }
}

import { describe, expect, it } from 'vitest';
import { AgentTabs, type TabsApi } from '@/lib/browser/tabs';
import { TaskEndedError, ToolError } from '@/lib/errors';

type Tab = chrome.tabs.Tab;

class FakeTabs implements TabsApi {
  tabs = new Map<number, Tab>();
  next = 100;
  groupCalls: Array<{ tabIds: number[]; groupId?: number }> = [];
  updates: Array<[number, object]> = [];
  created = new Set<(t: Tab) => void>();
  removed = new Set<(id: number) => void>();
  onCreated = { addListener: (cb: (t: Tab) => void) => void this.created.add(cb), removeListener: (cb: (t: Tab) => void) => void this.created.delete(cb) };
  onRemoved = { addListener: (cb: (id: number) => void) => void this.removed.add(cb), removeListener: (cb: (id: number) => void) => void this.removed.delete(cb) };
  add(over: Partial<Tab> = {}): Tab {
    const id = over.id ?? this.next++;
    const t = { id, index: this.tabs.size, windowId: 1, url: `https://site.test/${id}`, title: `Tab ${id}`, status: 'complete', active: false, ...over } as Tab;
    this.tabs.set(id, t);
    return t;
  }
  async get(id: number) {
    const t = this.tabs.get(id);
    if (!t) throw new Error(`No tab with id: ${id}`);
    return { ...t };
  }
  async create(p: { url: string; active: boolean }) {
    const t = this.add({ url: p.url, active: p.active });
    this.created.forEach((cb) => cb(t));
    return t;
  }
  async update(id: number, p: object) {
    this.updates.push([id, p]);
    Object.assign(this.tabs.get(id)!, p);
    return this.tabs.get(id);
  }
  async remove(id: number) {
    this.tabs.delete(id);
    this.removed.forEach((cb) => cb(id));
  }
  async group(o: { tabIds: number[]; groupId?: number }) {
    this.groupCalls.push(o);
    return o.groupId ?? 7;
  }
  async goBack() {}
  fireCreated(t: Tab) {
    this.created.forEach((cb) => cb(t));
  }
}

async function started() {
  const tabs = new FakeTabs();
  const seed = tabs.add({ id: 1 });
  const groupUpdates: unknown[] = [];
  const agent = new AgentTabs(tabs, { update: async (_id, p) => void groupUpdates.push(p) }, { pollMs: 1 });
  await agent.start(seed.id!);
  return { tabs, agent, groupUpdates };
}

describe('AgentTabs', () => {
  it('groups and activates the seed tab under an "Agent" group', async () => {
    const { tabs, agent, groupUpdates } = await started();
    expect(tabs.groupCalls[0]).toEqual({ tabIds: [1] });
    expect(groupUpdates[0]).toEqual({ title: 'Agent', color: 'purple' });
    expect(tabs.updates[0]).toEqual([1, { active: true }]);
    expect((await agent.active()).id).toBe(1);
  });

  it('adopts and follows tabs opened from agent tabs, ignores others', async () => {
    const { tabs, agent } = await started();
    tabs.fireCreated(tabs.add({ id: 50 }));
    tabs.fireCreated(tabs.add({ id: 51, openerTabId: 1 }));
    await Promise.resolve();
    expect((await agent.active()).id).toBe(51);
    expect((await agent.list()).map((t) => t.tabId)).toEqual([1, 51]);
    expect(tabs.groupCalls.at(-1)).toEqual({ tabIds: [51], groupId: 7 });
  });

  it('opens, switches and closes tabs by group index', async () => {
    const { agent } = await started();
    await agent.open('https://b.test/');
    const list = await agent.list();
    expect(list.map((t) => [t.index, t.active])).toEqual([
      [0, false],
      [1, true],
    ]);
    await agent.switchTo(0);
    expect((await agent.active()).id).toBe(1);
    await agent.close(1);
    expect((await agent.list()).length).toBe(1);
    await expect(agent.close(0)).rejects.toThrow("Can't close the last agent tab");
    await expect(agent.switchTo(5)).rejects.toBeInstanceOf(ToolError);
  });

  it('Review Focus: ends the task when the user closes every agent tab', async () => {
    const { tabs, agent } = await started();
    await tabs.remove(1);
    await expect(agent.active()).rejects.toBeInstanceOf(TaskEndedError);
  });

  it('moves to a remaining tab when the active one is closed', async () => {
    const { tabs, agent } = await started();
    await agent.open('https://b.test/');
    const newId = (await agent.active()).id!;
    await tabs.remove(newId);
    expect((await agent.active()).id).toBe(1);
  });

  it('stop removes listeners', async () => {
    const { tabs, agent } = await started();
    agent.stop();
    expect(tabs.created.size).toBe(0);
    expect(tabs.removed.size).toBe(0);
  });
});

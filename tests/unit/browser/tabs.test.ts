import { describe, expect, it } from 'vitest';
import { AgentTabs, type TabsApi } from '@/lib/browser/tabs';
import { TaskEndedError, ToolError } from '@/lib/errors';

type Tab = chrome.tabs.Tab;

class FakeTabs implements TabsApi {
  tabs = new Map<number, Tab>();
  next = 100;
  nextGroup = 7;
  groupCalls: Array<{ tabIds: number[]; groupId?: number }> = [];
  updates: Array<[number, object]> = [];
  created = new Set<(t: Tab) => void>();
  onCreated = { addListener: (cb: (t: Tab) => void) => void this.created.add(cb), removeListener: (cb: (t: Tab) => void) => void this.created.delete(cb) };
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
  async query(q: { groupId: number }) {
    return [...this.tabs.values()].filter((t) => t.groupId === q.groupId).map((t) => ({ ...t }));
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
  }
  async group(o: { tabIds: number[]; groupId?: number }) {
    this.groupCalls.push(o);
    const groupId = o.groupId ?? this.nextGroup++;
    for (const id of o.tabIds) this.tabs.get(id)!.groupId = groupId;
    return groupId;
  }
  async goBack() {}
  fireCreated(t: Tab) {
    this.created.forEach((cb) => cb(t));
  }
}

function makeAgent(tabs: FakeTabs, titles: Record<number, string> = {}) {
  const groupUpdates: unknown[] = [];
  const agent = new AgentTabs(
    tabs,
    { get: async (id) => ({ title: titles[id] }), update: async (_id, p) => void groupUpdates.push(p) },
    { pollMs: 1 },
  );
  return { agent, groupUpdates };
}

async function started() {
  const tabs = new FakeTabs();
  const seed = tabs.add({ id: 1 });
  const { agent, groupUpdates } = makeAgent(tabs);
  await agent.start(seed.id!);
  return { tabs, agent, groupUpdates };
}

describe('AgentTabs', () => {
  it('groups and activates the seed tab under an "Errand" group', async () => {
    const { tabs, agent, groupUpdates } = await started();
    expect(tabs.groupCalls[0]).toEqual({ tabIds: [1] });
    expect(groupUpdates[0]).toEqual({ title: 'Errand', color: 'purple' });
    expect(tabs.updates[0]).toEqual([1, { active: true }]);
    expect((await agent.active()).id).toBe(1);
  });

  it('adopts and follows tabs opened from agent tabs, ignores others', async () => {
    const { tabs, agent } = await started();
    tabs.fireCreated(tabs.add({ id: 50 }));
    tabs.fireCreated(tabs.add({ id: 51, openerTabId: 1 }));
    await new Promise((r) => setTimeout(r, 5));
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
  });

  it('prepare creates the group before any run, and start reuses it', async () => {
    const tabs = new FakeTabs();
    tabs.add({ id: 1 });
    const { agent } = makeAgent(tabs);
    expect(await agent.prepare(1)).toBe(7);
    tabs.add({ id: 2, groupId: 7 });
    await agent.start(1);
    expect(tabs.groupCalls).toHaveLength(1);
    expect((await agent.list()).map((t) => t.tabId)).toEqual([1, 2]);
  });

  it('a second run resumes in the same group on the tab the agent was using', async () => {
    const { tabs, agent } = await started();
    await agent.open('https://b.test/');
    const used = (await agent.active()).id!;
    agent.stop();
    await agent.start(999); // the user is on a tab outside the group, so the agent stays on its own
    expect(tabs.groupCalls.filter((c) => !c.groupId)).toHaveLength(1);
    expect((await agent.active()).id).toBe(used);
    agent.stop();
  });

  it('uses the tab you are on when it is in the group, and picks up tabs you added', async () => {
    const { tabs, agent } = await started();
    tabs.add({ id: 2, groupId: 7 });
    agent.stop();
    await agent.start(2);
    expect((await agent.active()).id).toBe(2);
    expect((await agent.list()).length).toBe(2);
  });

  it('adopts an existing Errand group around the seed tab instead of making a new one', async () => {
    const tabs = new FakeTabs();
    tabs.add({ id: 1, groupId: 3 });
    tabs.add({ id: 2, groupId: 3 });
    const { agent } = makeAgent(tabs, { 3: 'Errand' });
    await agent.prepare(1);
    expect(tabs.groupCalls).toHaveLength(0);
    expect((await agent.list()).length).toBe(2);
  });

  it('fresh forces a new group, leaving the old one alone', async () => {
    const { tabs, agent } = await started();
    tabs.add({ id: 2 });
    expect(await agent.prepare(2, true)).toBe(8);
    expect((await agent.list()).map((t) => t.tabId)).toEqual([2]);
    expect(tabs.tabs.get(1)!.groupId).toBe(7);
  });

  it('makes a new group when the old one was emptied', async () => {
    const { tabs, agent } = await started();
    await tabs.remove(1);
    tabs.add({ id: 5 });
    expect(await agent.prepare(5)).toBe(8);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { GroupSidePanel, type GroupSidePanelApi, PANEL_PATH } from '@/lib/background/groupSidePanel';

function event() {
  const listeners: Array<(...args: any[]) => void> = [];
  return { addListener: (cb: (...args: any[]) => void) => listeners.push(cb), fire: (...args: any[]) => listeners.forEach((cb) => cb(...args)) };
}

function setup() {
  const tabs = new Map<number, chrome.tabs.Tab>([
    [1, { id: 1, windowId: 10, groupId: 7 } as chrome.tabs.Tab],
    [2, { id: 2, windowId: 10, groupId: -1 } as chrome.tabs.Tab],
    [3, { id: 3, windowId: 20, groupId: 8 } as chrome.tabs.Tab],
  ]);
  const groups = new Map([
    [7, { id: 7, windowId: 10, title: 'Errand' }],
    [8, { id: 8, windowId: 20, title: 'Other' }],
  ]);
  const options = new Map<number | undefined, { enabled?: boolean; path?: string }>();
  const api = {
    tabs: {
      query: vi.fn(async () => [...tabs.values()].map((tab) => ({ ...tab }))),
      get: vi.fn(async (id: number) => {
        if (!tabs.has(id)) throw new Error('Tab closed');
        return { ...tabs.get(id)! };
      }),
      group: vi.fn(async ({ tabIds, groupId = 9 }: { tabIds: number[]; groupId?: number }) => {
        for (const id of tabIds) tabs.get(id)!.groupId = groupId;
        if (!groups.has(groupId)) groups.set(groupId, { id: groupId, windowId: tabs.get(tabIds[0])!.windowId, title: '' });
        return groupId;
      }),
      onUpdated: event(), onCreated: event(), onAttached: event(), onDetached: event(),
    },
    tabGroups: {
      get: vi.fn(async (id: number) => {
        if (!groups.has(id)) throw new Error('Group removed');
        return { ...groups.get(id)! };
      }),
      query: vi.fn(async ({ windowId, title }: { windowId?: number; title: string }) => [...groups.values()].filter((g) => (windowId === undefined || g.windowId === windowId) && g.title === title)),
      update: vi.fn(async (id: number, changes: object) => Object.assign(groups.get(id)!, changes)),
      onUpdated: event(), onRemoved: event(),
    },
    sidePanel: {
      setOptions: vi.fn(async ({ tabId, ...value }: { tabId?: number; enabled?: boolean; path?: string }) => { options.set(tabId, value); }),
      setPanelBehavior: vi.fn(async () => {}),
      open: vi.fn(async () => {}),
    },
    action: { onClicked: event() },
  };
  const controller = new GroupSidePanel(api as unknown as GroupSidePanelApi);
  controller.start();
  return { api, controller, tabs, groups, options };
}

describe('group side panel', () => {
  it('disables the global panel and scans existing groups on worker startup', async () => {
    const { controller, api, options } = setup();
    await controller.ready();
    expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
    expect(options.get(undefined)).toEqual({ enabled: false });
    expect(options.get(1)).toEqual({ enabled: true, path: PANEL_PATH });
    expect(options.get(2)?.enabled).toBe(false);
    expect(options.get(3)?.enabled).toBe(false);
  });

  it('tracks tabs dragged in/out and newly created grouped tabs', async () => {
    const { controller, api, tabs, options } = setup();
    await controller.ready();
    tabs.get(2)!.groupId = 7;
    api.tabs.onUpdated.fire(2, { groupId: 7 });
    await controller.ready();
    expect(options.get(2)?.enabled).toBe(true);
    tabs.get(1)!.groupId = -1;
    api.tabs.onUpdated.fire(1, { groupId: -1 });
    tabs.set(4, { id: 4, windowId: 10, groupId: 7 } as chrome.tabs.Tab);
    api.tabs.onCreated.fire(tabs.get(4));
    await controller.ready();
    expect(options.get(1)?.enabled).toBe(false);
    expect(options.get(4)?.enabled).toBe(true);
  });

  it('tracks renames in either direction and removed groups', async () => {
    const { controller, api, groups, options } = setup();
    await controller.ready();
    groups.get(7)!.title = 'Renamed';
    groups.get(8)!.title = 'Errand';
    api.tabGroups.onUpdated.fire(groups.get(7));
    api.tabGroups.onUpdated.fire(groups.get(8));
    await controller.ready();
    expect(options.get(1)?.enabled).toBe(false);
    expect(options.get(3)?.enabled).toBe(true);
    groups.delete(8);
    api.tabGroups.onRemoved.fire({ id: 8 });
    await controller.ready();
    expect(options.get(3)?.enabled).toBe(false);
  });

  it('issues enable then open synchronously, before any grouping lookup, and reuses the window group', async () => {
    const { controller, api, tabs, options } = setup();
    await controller.ready();
    api.tabs.get.mockClear();
    api.sidePanel.setOptions.mockClear();
    api.action.onClicked.fire(tabs.get(2));
    expect(api.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 2, path: PANEL_PATH, enabled: true });
    expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 2 });
    expect(api.sidePanel.setOptions.mock.invocationCallOrder[0]).toBeLessThan(api.sidePanel.open.mock.invocationCallOrder[0]);
    expect(api.tabs.get).not.toHaveBeenCalled();
    await controller.ready();
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [2], groupId: 7 });
    expect(api.tabGroups.update).not.toHaveBeenCalled();
    expect(options.get(2)?.enabled).toBe(true);
  });

  it('creates a purple Errand group instead of using one in another window', async () => {
    const { controller, api, tabs, groups } = setup();
    await controller.ready();
    api.action.onClicked.fire(tabs.get(3));
    await controller.ready();
    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [3] });
    expect(api.tabGroups.update).toHaveBeenCalledWith(9, { title: 'Errand', color: 'purple' });
    expect(groups.get(8)?.title).toBe('Other');
  });

  it('keeps existing members in their group on toolbar clicks', async () => {
    const { controller, api, tabs } = setup();
    await controller.ready();
    api.action.onClicked.fire(tabs.get(1));
    await controller.ready();
    expect(api.tabs.group).not.toHaveBeenCalled();
    expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 1 });
  });

  it('does not let a startup scan undo enable while adoption is pending', async () => {
    const { controller, api, tabs, options } = setup();
    let release!: () => void;
    const grouped = new Promise<void>((resolve) => { release = resolve; });
    const original = api.tabs.group.getMockImplementation()!;
    api.tabs.group.mockImplementation(async (params) => { await grouped; return original(params); });
    api.action.onClicked.fire(tabs.get(2));
    await vi.waitFor(() => expect(api.tabs.group).toHaveBeenCalled());
    expect(options.get(2)?.enabled).toBe(true);
    release();
    await controller.ready();
    expect(options.get(2)?.enabled).toBe(true);
  });
  it('disables a tab dragged out to another window', async () => {
    const { controller, api, tabs, options } = setup();
    await controller.ready();
    expect(options.get(1)?.enabled).toBe(true);
    Object.assign(tabs.get(1)!, { windowId: 30, groupId: -1 });
    api.tabs.onAttached.fire(1, { newWindowId: 30, newPosition: 0 });
    await controller.ready();
    expect(options.get(1)?.enabled).toBe(false);
  });
});

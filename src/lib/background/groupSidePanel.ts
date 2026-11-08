import { GROUP_TITLE } from '../browser/tabs';

// WXT emits src/entrypoints/sidepanel/index.html as sidepanel.html.
export const PANEL_PATH = 'sidepanel.html';

export interface GroupSidePanelApi {
  tabs: Pick<typeof chrome.tabs, 'query' | 'get' | 'group' | 'onUpdated' | 'onCreated' | 'onAttached' | 'onDetached'>;
  tabGroups: Pick<typeof chrome.tabGroups, 'get' | 'query' | 'update' | 'onUpdated' | 'onRemoved'>;
  sidePanel: Pick<typeof chrome.sidePanel, 'setOptions' | 'setPanelBehavior' | 'open'>;
  action: Pick<typeof chrome.action, 'onClicked'>;
}

/** Chrome owns visibility on tab switches; group membership controls per-tab eligibility. */
export class GroupSidePanel {
  private pending = Promise.resolve();
  private opening = new Set<number>();

  constructor(private api: GroupSidePanelApi) {}

  ready(): Promise<void> {
    return this.pending;
  }

  private enqueue(work: () => Promise<void>): void {
    this.pending = this.pending.then(work).catch((error) => console.warn('Errand side panel:', error));
  }

  start(): void {
    const { tabs, tabGroups, sidePanel, action } = this.api;
    // Explicitly reset the old global toolbar behavior on extension updates too.
    const behavior = sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    const defaults = sidePanel.setOptions({ enabled: false });
    this.enqueue(async () => {
      await Promise.all([behavior, defaults]);
      await this.sync();
    });
    tabs.onUpdated.addListener((_id, change) => {
      if (change.groupId !== undefined) this.enqueue(() => this.sync());
    });
    tabs.onCreated.addListener(() => this.enqueue(() => this.sync()));
    // Moving a tab to another window drops it from its group without a groupId onUpdated.
    tabs.onAttached.addListener(() => this.enqueue(() => this.sync()));
    tabs.onDetached.addListener(() => this.enqueue(() => this.sync()));
    tabGroups.onUpdated.addListener(() => this.enqueue(() => this.sync()));
    tabGroups.onRemoved.addListener(() => this.enqueue(() => this.sync()));
    action.onClicked.addListener((tab) => this.open(tab));
  }

  private async isMember(tab: chrome.tabs.Tab): Promise<boolean> {
    if (tab.groupId === undefined || tab.groupId < 0) return false;
    const group = await this.api.tabGroups.get(tab.groupId).catch(() => undefined);
    return group?.title === GROUP_TITLE;
  }

  private async sync(): Promise<void> {
    const groups = new Set((await this.api.tabGroups.query({ title: GROUP_TITLE })).map((g) => g.id));
    await Promise.all(
      (await this.api.tabs.query({})).map(async (tab) => {
        // A toolbar click temporarily enables the tab before async adoption. A scan
        // already in flight must not undo that enable while open() is processing.
        if (tab.id === undefined || this.opening.has(tab.id)) return;
        const enabled = tab.groupId !== undefined && groups.has(tab.groupId);
        // Tabs may close while a scan is in flight.
        await this.api.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled }).catch(() => {});
      }),
    );
  }

  private open(tab: chrome.tabs.Tab): void {
    if (tab.id === undefined) return;
    const tabId = tab.id;
    this.opening.add(tabId);
    // Both API calls must be issued in the action's user gesture, without an
    // await (including an await for tabs.group/query) before open(). Chrome
    // processes setOptions before open on the same extension API connection.
    const enabled = this.api.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
    const opened = this.api.sidePanel.open({ tabId });
    // Attach rejection handlers immediately; adoption still runs if opening fails.
    void Promise.all([enabled, opened]).catch((error) => console.warn('Errand side panel open:', error));
    this.enqueue(async () => {
      try {
        const current = await this.api.tabs.get(tabId);
        if (!(await this.isMember(current))) {
          const groups = await this.api.tabGroups.query({ windowId: current.windowId, title: GROUP_TITLE });
          const groupId = await this.api.tabs.group({ tabIds: [tabId], ...(groups[0] ? { groupId: groups[0].id } : {}) });
          if (!groups[0]) await this.api.tabGroups.update(groupId, { title: GROUP_TITLE, color: 'purple' });
        }
      } finally {
        this.opening.delete(tabId);
        await this.sync();
      }
    });
  }
}

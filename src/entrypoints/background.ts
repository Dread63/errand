import { GroupSidePanel } from '@/lib/background/groupSidePanel';
import { PanelSession } from '@/lib/background/session';
import { Cdp } from '@/lib/browser/cdp';
import { ChromeDriver } from '@/lib/browser/driver';
import { ContentMessenger } from '@/lib/browser/messenger';
import { AgentTabs, type TabGroupsApi, type TabsApi } from '@/lib/browser/tabs';
import { OpenAIClient } from '@/lib/llm/client';
import { type BgToPanel, PANEL_PORT, type PanelToBg } from '@/lib/messages';
import { HistoryStore } from '@/lib/storage/history';
import { chromeKV } from '@/lib/storage/kv';
import { ProfileStore } from '@/lib/storage/profiles';
import { SettingsStore } from '@/lib/storage/settings';
import { BypassStore, SitePermissionStore } from '@/lib/storage/sites';

export default defineBackground(() => {
  const panels = new GroupSidePanel(chrome);
  panels.start();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    const kv = chromeKV();
    const agentTabs = new AgentTabs(chrome.tabs as unknown as TabsApi, chrome.tabGroups as unknown as TabGroupsApi);
    const session = new PanelSession(
      { postMessage: (m: BgToPanel) => port.postMessage(m) },
      {
        profiles: new ProfileStore(kv),
        settings: new SettingsStore(kv),
        siteStore: new SitePermissionStore(kv),
        bypass: new BypassStore(kv),
        history: new HistoryStore(kv),
        makeLlm: (profile) => new OpenAIClient(profile),
        workspace: agentTabs,
        makeDriver: () => new ChromeDriver(agentTabs, new Cdp(), new ContentMessenger()),
      },
    );
    // Dispatch in arrival order, but don't wait for a handler to finish ('start' runs the whole task).
    let dispatch = Promise.resolve();
    port.onMessage.addListener((m: PanelToBg) => {
      dispatch = dispatch.then(async () => {
        // The panel can connect before toolbar adoption finishes. Do not let prepare()
        // create a competing workspace while the clicked tab is being grouped.
        if (m.type === 'prepare' || m.type === 'start') await panels.ready();
        void session.handle(m);
      });
    });
    port.onDisconnect.addListener(() => session.dispose());
  });
});

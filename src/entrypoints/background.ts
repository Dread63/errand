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
import { SitePermissionStore } from '@/lib/storage/sites';

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  chrome.runtime.onInstalled.addListener(() => {
    new ProfileStore(chromeKV()).seedDefaults().catch(() => {});
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    const kv = chromeKV();
    const session = new PanelSession(
      { postMessage: (m: BgToPanel) => port.postMessage(m) },
      {
        profiles: new ProfileStore(kv),
        settings: new SettingsStore(kv),
        siteStore: new SitePermissionStore(kv),
        history: new HistoryStore(kv),
        makeLlm: (profile) => new OpenAIClient(profile),
        makeDriver: () =>
          new ChromeDriver(
            new AgentTabs(chrome.tabs as unknown as TabsApi, chrome.tabGroups as unknown as TabGroupsApi),
            new Cdp(),
            new ContentMessenger(),
          ),
      },
    );
    port.onMessage.addListener((m: PanelToBg) => {
      void session.handle(m);
    });
    port.onDisconnect.addListener(() => session.dispose());
  });
});

import { chromeKV } from '@/lib/storage/kv';
import { ProfileStore } from '@/lib/storage/profiles';

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.runtime.onInstalled.addListener(() => {
    new ProfileStore(chromeKV()).seedDefaults().catch(() => {});
  });
});

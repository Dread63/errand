import { useEffect } from 'react';
import { chromeKV } from '../storage/kv';
import { SettingsStore } from '../storage/settings';

export function useTheme(): void {
  useEffect(() => {
    const store = new SettingsStore(chromeKV());
    const apply = async () => {
      document.documentElement.dataset.theme = (await store.get()).theme;
    };
    void apply();
    const onChanged = (changes: Record<string, unknown>) => {
      if ('settings' in changes) void apply();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
}

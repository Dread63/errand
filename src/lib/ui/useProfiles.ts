import { useEffect, useState } from 'react';
import { chromeKV } from '../storage/kv';
import { ProfileStore } from '../storage/profiles';
import { SettingsStore } from '../storage/settings';
import type { Profile } from '../types';
import { activeProfile } from './models';

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const kv = chromeKV();
    const load = async () => {
      setProfiles(await new ProfileStore(kv).list());
      setActiveId((await new SettingsStore(kv).get()).activeProfileId);
    };
    void load();
    const onChanged = () => void load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const setActive = async (id: string) => {
    await new SettingsStore(chromeKV()).update({ activeProfileId: id });
  };

  return { profiles, activeId, active: activeProfile(profiles, activeId), setActive };
}

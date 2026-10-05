import type { Profile } from '../types';
import type { KV } from './kv';
import type { SettingsStore } from './settings';

const KEY = 'profiles';

export class ProfileStore {
  constructor(private kv: KV) {}

  async list(): Promise<Profile[]> {
    return (await this.kv.get<Profile[]>(KEY)) ?? [];
  }

  async get(id: string): Promise<Profile | undefined> {
    return (await this.list()).find((p) => p.id === id);
  }

  async save(profile: Profile): Promise<void> {
    const all = await this.list();
    const i = all.findIndex((p) => p.id === profile.id);
    if (i >= 0) all[i] = profile;
    else all.push(profile);
    await this.kv.set(KEY, all);
  }

  async remove(id: string): Promise<void> {
    await this.kv.set(KEY, (await this.list()).filter((p) => p.id !== id));
  }
}

/** Saves a profile, making it active when no stored profile is active (e.g. the first one added). */
export async function saveProfile(profiles: ProfileStore, settings: SettingsStore, p: Profile): Promise<void> {
  await profiles.save(p);
  const { activeProfileId } = await settings.get();
  if (!activeProfileId || !(await profiles.get(activeProfileId))) await settings.update({ activeProfileId: p.id });
}

/** Removes a profile; if it was active, the first remaining profile (or none) becomes active. */
export async function removeProfile(profiles: ProfileStore, settings: SettingsStore, id: string): Promise<void> {
  await profiles.remove(id);
  if ((await settings.get()).activeProfileId === id) await settings.update({ activeProfileId: (await profiles.list())[0]?.id ?? null });
}

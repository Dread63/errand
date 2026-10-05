import { listModels } from '../llm/client';
import type { Profile } from '../types';
import type { CatalogEntry } from '../ui/models';
import { errMsg } from '../util';
import type { KV } from './kv';
import type { ProfileStore } from './profiles';
import type { SettingsStore } from './settings';

const KEY = 'modelCatalog';
export const REFRESH_MS = 5 * 60_000;

/** Last known model ids per profile, so the model menu opens instantly. */
export class ModelCatalog {
  constructor(
    private kv: KV,
    private list: (p: Profile) => Promise<string[]> = (p) => listModels(p),
    private now: () => number = Date.now,
  ) {}

  async all(): Promise<Record<string, CatalogEntry>> {
    return (await this.kv.get<Record<string, CatalogEntry>>(KEY)) ?? {};
  }

  async refresh(p: Profile, opts: { force?: boolean } = {}): Promise<CatalogEntry> {
    const all = await this.all();
    const prev = all[p.id];
    if (!opts.force && prev && !prev.error && this.now() - prev.fetchedAt < REFRESH_MS) return prev;
    let next: CatalogEntry;
    try {
      next = { models: await this.list(p), fetchedAt: this.now() };
    } catch (e) {
      next = { models: prev?.models ?? [], fetchedAt: prev?.fetchedAt ?? 0, error: errMsg(e) };
    }
    await this.kv.set(KEY, { ...(await this.all()), [p.id]: next });
    return next;
  }
}

export async function selectModel(profiles: ProfileStore, settings: SettingsStore, profileId: string, model: string): Promise<void> {
  const p = await profiles.get(profileId);
  if (!p) return;
  if (p.model !== model) await profiles.save({ ...p, model });
  await settings.update({ activeProfileId: profileId });
}

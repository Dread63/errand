import type { Profile } from '../types';
import type { KV } from './kv';

const KEY = 'profiles';

export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'macbook',
    name: 'MacBook (Tailscale)',
    baseUrl: 'http://macbook.your-tailnet.ts.net:8000/v1',
    apiKey: '',
    model: 'qwen3.6-35b-a3b',
    supportsVision: false,
    contextMode: 'compact',
    contextWindow: 32768,
    maxScreenshots: 1,
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: '',
    model: 'glm-5.3-flash',
    supportsVision: false,
    contextMode: 'full',
    contextWindow: 1_000_000,
    maxScreenshots: 3,
  },
];

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

  async seedDefaults(): Promise<void> {
    if ((await this.kv.get(KEY)) === undefined) await this.kv.set(KEY, DEFAULT_PROFILES);
  }
}

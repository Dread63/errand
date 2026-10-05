import type { KV } from './kv';

const KEY = 'allowedOrigins';

export class SitePermissionStore {
  constructor(private kv: KV) {}

  async list(): Promise<string[]> {
    return [...((await this.kv.get<string[]>(KEY)) ?? [])].sort();
  }

  async isAllowed(origin: string): Promise<boolean> {
    return (await this.list()).includes(origin);
  }

  async allow(origin: string): Promise<void> {
    const all = new Set(await this.list());
    all.add(origin);
    await this.kv.set(KEY, [...all]);
  }

  async revoke(origin: string): Promise<void> {
    await this.kv.set(KEY, (await this.list()).filter((o) => o !== origin));
  }
}

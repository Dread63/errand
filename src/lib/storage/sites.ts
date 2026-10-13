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

/** Sites where routine risky actions skip the approval prompt. Saved per site, never per tab. */
export class BypassStore {
  constructor(private kv: KV) {}

  async origins(): Promise<string[]> {
    return [...((await this.kv.get<string[]>('bypassOrigins')) ?? [])].sort();
  }

  async setOrigin(origin: string, on: boolean): Promise<void> {
    const all = new Set(await this.origins());
    if (on) all.add(origin);
    else all.delete(origin);
    await this.kv.set('bypassOrigins', [...all]);
  }

  async applies(origin: string): Promise<boolean> {
    return (await this.origins()).includes(origin);
  }
}

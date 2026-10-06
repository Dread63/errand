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

/** Where the "skip approval for risky actions" setting lives: per site (saved) and per tab (this browser session). */
export class BypassStore {
  constructor(
    private local: KV,
    private session: KV,
  ) {}

  async origins(): Promise<string[]> {
    return [...((await this.local.get<string[]>('bypassOrigins')) ?? [])].sort();
  }

  async setOrigin(origin: string, on: boolean): Promise<void> {
    const all = new Set(await this.origins());
    if (on) all.add(origin);
    else all.delete(origin);
    await this.local.set('bypassOrigins', [...all]);
  }

  async tabs(): Promise<number[]> {
    return (await this.session.get<number[]>('bypassTabs')) ?? [];
  }

  async setTab(tabId: number, on: boolean): Promise<void> {
    const all = new Set(await this.tabs());
    if (on) all.add(tabId);
    else all.delete(tabId);
    await this.session.set('bypassTabs', [...all]);
  }

  async applies(origin: string, tabId: number): Promise<boolean> {
    return (await this.tabs()).includes(tabId) || (await this.origins()).includes(origin);
  }
}

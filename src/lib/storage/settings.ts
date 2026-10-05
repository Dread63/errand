import type { Settings } from '../types';
import type { KV } from './kv';

const KEY = 'settings';

export const DEFAULT_RISKY_KEYWORDS = [
  'buy',
  'pay',
  'purchase',
  'order',
  'checkout',
  'confirm',
  'delete',
  'remove',
  'send',
  'post',
  'publish',
  'transfer',
  'subscribe',
];

export const DEFAULT_SETTINGS: Settings = {
  activeProfileId: null,
  stepLimit: 30,
  riskyKeywords: DEFAULT_RISKY_KEYWORDS,
  debugTiming: false,
  theme: 'system',
};

export class SettingsStore {
  constructor(private kv: KV) {}

  async get(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...((await this.kv.get<Partial<Settings>>(KEY)) ?? {}) };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.get()), ...patch };
    await this.kv.set(KEY, next);
    return next;
  }
}

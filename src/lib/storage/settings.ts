import type { Settings } from '../types';
import type { KV } from './kv';

/** Retired per-site auto-approve list, removed once. */
const LEGACY_BYPASS_KEY = 'bypassOrigins';
/** Set after the one-time cleanup so later reads do not write. */
const MIGRATED_KEY = 'legacyApprovalMigrated';

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
  'submit',
  'payment',
];

/** Saved copies of the list from before submit and payment were added. */
const PREVIOUS_RISKY_KEYWORDS = [
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

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, i) => word === b[i]);
}

export const DEFAULT_SETTINGS: Settings = {
  activeProfileId: null,
  troubleLimit: 8,
  riskyKeywords: DEFAULT_RISKY_KEYWORDS,
  debugTiming: false,
  theme: 'system',
};

export class SettingsStore {
  constructor(private kv: KV) {}

  async get(): Promise<Settings> {
    if ((await this.kv.get<boolean>(MIGRATED_KEY)) !== true) {
      if ((await this.kv.get(LEGACY_BYPASS_KEY)) !== undefined) await this.kv.remove(LEGACY_BYPASS_KEY);
      const raw = (await this.kv.get<Record<string, unknown>>(KEY)) ?? {};
      if ('approvalMode' in raw || 'stepLimit' in raw) {
        const { approvalMode: _mode, stepLimit: _limit, ...rest } = raw;
        await this.kv.set(KEY, rest);
      }
      await this.kv.set(MIGRATED_KEY, true);
    }
    // A total-step cap is not a trouble threshold: discard the legacy value.
    const raw = (await this.kv.get<Partial<Settings> & { stepLimit?: number; approvalMode?: unknown }>(KEY)) ?? {};
    const { stepLimit: _legacy, approvalMode: _mode, ...stored } = raw;
    const limit = stored.troubleLimit;
    const savedKeywords = stored.riskyKeywords;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      riskyKeywords: Array.isArray(savedKeywords) && sameWords(savedKeywords, PREVIOUS_RISKY_KEYWORDS)
        ? DEFAULT_RISKY_KEYWORDS
        : savedKeywords ?? DEFAULT_SETTINGS.riskyKeywords,
      troubleLimit: typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
        ? Math.min(200, Math.round(limit))
        : DEFAULT_SETTINGS.troubleLimit,
    };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.get()), ...patch };
    await this.kv.set(KEY, next);
    return next;
  }
}

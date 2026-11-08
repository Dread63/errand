import { resolveApprovalMode } from '../policy/approval';
import type { Settings } from '../types';
import type { KV } from './kv';

/** Retired per-site auto-approve list. Reading settings deletes it. */
const LEGACY_BYPASS_KEY = 'bypassOrigins';

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
  troubleLimit: 8,
  riskyKeywords: DEFAULT_RISKY_KEYWORDS,
  debugTiming: false,
  theme: 'system',
  approvalMode: 'ask',
};

export class SettingsStore {
  constructor(private kv: KV) {}

  async get(): Promise<Settings> {
    if ((await this.kv.get(LEGACY_BYPASS_KEY)) !== undefined) await this.kv.remove(LEGACY_BYPASS_KEY);
    // A total-step cap is not a trouble threshold: discard the legacy value.
    const { stepLimit: _legacy, ...stored } = (await this.kv.get<Partial<Settings> & { stepLimit?: number }>(KEY)) ?? {};
    const limit = stored.troubleLimit;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      troubleLimit: typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
        ? Math.min(200, Math.round(limit))
        : DEFAULT_SETTINGS.troubleLimit,
      approvalMode: resolveApprovalMode(stored.approvalMode),
    };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.get()), ...patch };
    await this.kv.set(KEY, next);
    return next;
  }
}

import type { SitePermissionStore } from '../storage/sites';

export type SiteStatus = 'allowed' | 'denied' | 'ask';
export type SiteDecision = 'once' | 'always' | 'deny';

const NO_PERMISSION_NEEDED = /^(about:|chrome:|chrome-extension:|edge:|devtools:)/;

/** Site permissions for one task: "once" and "deny" last for this instance; "always" is stored. */
export class SitePolicy {
  private once = new Set<string>();
  private denied = new Set<string>();

  constructor(private store: SitePermissionStore) {}

  async check(origin: string): Promise<SiteStatus> {
    if (NO_PERMISSION_NEEDED.test(origin)) return 'allowed';
    if (this.denied.has(origin)) return 'denied';
    if (this.once.has(origin) || (await this.store.isAllowed(origin))) return 'allowed';
    return 'ask';
  }

  async apply(origin: string, decision: SiteDecision): Promise<void> {
    if (decision === 'deny') this.denied.add(origin);
    else if (decision === 'once') this.once.add(origin);
    else await this.store.allow(origin);
  }
}

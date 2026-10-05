import { describe, expect, it } from 'vitest';
import { SitePolicy } from '@/lib/policy/sites';
import { memoryKV } from '@/lib/storage/kv';
import { SitePermissionStore } from '@/lib/storage/sites';

describe('SitePolicy', () => {
  it('asks for unknown web origins', async () => {
    expect(await new SitePolicy(new SitePermissionStore(memoryKV())).check('https://a.test')).toBe('ask');
  });
  it('allows browser pages without asking', async () => {
    const p = new SitePolicy(new SitePermissionStore(memoryKV()));
    expect(await p.check('chrome://newtab')).toBe('allowed');
    expect(await p.check('about://')).toBe('allowed');
  });
  it('once is remembered only by this policy instance (one task)', async () => {
    const store = new SitePermissionStore(memoryKV());
    const p = new SitePolicy(store);
    await p.apply('https://a.test', 'once');
    expect(await p.check('https://a.test')).toBe('allowed');
    expect(await new SitePolicy(store).check('https://a.test')).toBe('ask');
  });
  it('always persists to the store', async () => {
    const store = new SitePermissionStore(memoryKV());
    await new SitePolicy(store).apply('https://a.test', 'always');
    expect(await store.isAllowed('https://a.test')).toBe(true);
    expect(await new SitePolicy(store).check('https://a.test')).toBe('allowed');
  });
  it('deny lasts for this task', async () => {
    const p = new SitePolicy(new SitePermissionStore(memoryKV()));
    await p.apply('https://a.test', 'deny');
    expect(await p.check('https://a.test')).toBe('denied');
  });
});

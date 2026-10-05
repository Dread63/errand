import { describe, expect, it } from 'vitest';
import { memoryKV } from '@/lib/storage/kv';
import { ModelCatalog, REFRESH_MS, selectModel } from '@/lib/storage/models';
import { ProfileStore } from '@/lib/storage/profiles';
import { SettingsStore } from '@/lib/storage/settings';
import { testProfile } from '../agent/fakes';

describe('ModelCatalog', () => {
  it('fetches, caches, and throttles refreshes', async () => {
    let calls = 0;
    let t = 0;
    const cat = new ModelCatalog(memoryKV(), async () => (calls++, ['a', 'b']), () => t);
    expect(await cat.refresh(testProfile)).toEqual({ models: ['a', 'b'], fetchedAt: 0 });
    t = REFRESH_MS - 1;
    await cat.refresh(testProfile);
    expect(calls).toBe(1);
    await cat.refresh(testProfile, { force: true });
    expect(calls).toBe(2);
    t = 2 * REFRESH_MS;
    await cat.refresh(testProfile);
    expect(calls).toBe(3);
    expect((await cat.all())[testProfile.id].models).toEqual(['a', 'b']);
  });

  it('keeps the last known models and records the error when a refresh fails', async () => {
    let fail = false;
    let t = 0;
    const cat = new ModelCatalog(memoryKV(), async () => {
      if (fail) throw new Error('Could not reach http://x/v1/models: offline');
      return ['a'];
    }, () => t);
    await cat.refresh(testProfile);
    fail = true;
    t = REFRESH_MS;
    const e = await cat.refresh(testProfile);
    expect(e.models).toEqual(['a']);
    expect(e.error).toMatch(/offline/);
    fail = false;
    t = 3 * REFRESH_MS;
    expect((await cat.refresh(testProfile)).error).toBeUndefined();
  });

  it('retries a failed provider without waiting for the throttle', async () => {
    let calls = 0;
    const cat = new ModelCatalog(memoryKV(), async () => {
      calls++;
      throw new Error('down');
    }, () => 0);
    await cat.refresh(testProfile);
    await cat.refresh(testProfile);
    expect(calls).toBe(2);
  });
});

describe('selectModel', () => {
  it("sets the profile's model and makes it active", async () => {
    const kv = memoryKV();
    const profiles = new ProfileStore(kv);
    const settings = new SettingsStore(kv);
    await profiles.save(testProfile);
    await profiles.save({ ...testProfile, id: 'q', name: 'Q' });
    await selectModel(profiles, settings, 'q', 'kimi-k3');
    expect((await profiles.get('q'))!.model).toBe('kimi-k3');
    expect((await profiles.get('p'))!.model).toBe('m');
    expect((await settings.get()).activeProfileId).toBe('q');
  });
});

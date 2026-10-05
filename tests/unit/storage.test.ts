import { describe, expect, it } from 'vitest';
import { memoryKV } from '@/lib/storage/kv';
import { DEFAULT_PROFILES, ProfileStore } from '@/lib/storage/profiles';
import { DEFAULT_RISKY_KEYWORDS, DEFAULT_SETTINGS, SettingsStore } from '@/lib/storage/settings';
import { SitePermissionStore } from '@/lib/storage/sites';
import { HistoryStore } from '@/lib/storage/history';
import type { Conversation, Profile } from '@/lib/types';

const profile = (id: string): Profile => ({
  id,
  name: id,
  baseUrl: 'http://x/v1',
  apiKey: '',
  model: 'm',
  supportsVision: false,
  contextMode: 'standard',
  contextWindow: 32000,
  maxScreenshots: 1,
});

describe('ProfileStore', () => {
  it('saves, updates and removes profiles', async () => {
    const s = new ProfileStore(memoryKV());
    await s.save(profile('a'));
    await s.save({ ...profile('a'), name: 'renamed' });
    await s.save(profile('b'));
    expect((await s.list()).map((p) => p.name)).toEqual(['renamed', 'b']);
    await s.remove('a');
    expect(await s.get('a')).toBeUndefined();
  });

  it('seeds defaults only once', async () => {
    const s = new ProfileStore(memoryKV());
    await s.seedDefaults();
    expect(await s.list()).toEqual(DEFAULT_PROFILES);
    await s.remove('macbook');
    await s.seedDefaults();
    expect((await s.list()).map((p) => p.id)).toEqual(['opencode-go']);
  });

  it('defaults: MacBook is compact, OpenCode Go is full', () => {
    expect(DEFAULT_PROFILES.find((p) => p.id === 'macbook')?.contextMode).toBe('compact');
    expect(DEFAULT_PROFILES.find((p) => p.id === 'opencode-go')?.contextMode).toBe('full');
  });
});

describe('SettingsStore', () => {
  it('returns defaults and merges updates', async () => {
    const s = new SettingsStore(memoryKV());
    expect(await s.get()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.stepLimit).toBe(30);
    expect(DEFAULT_RISKY_KEYWORDS).toContain('checkout');
    await s.update({ stepLimit: 12 });
    expect((await s.get()).stepLimit).toBe(12);
    expect((await s.get()).riskyKeywords).toEqual(DEFAULT_RISKY_KEYWORDS);
  });
});

describe('SitePermissionStore', () => {
  it('allows, dedupes and revokes origins', async () => {
    const s = new SitePermissionStore(memoryKV());
    await s.allow('https://b.test');
    await s.allow('https://a.test');
    await s.allow('https://a.test');
    expect(await s.list()).toEqual(['https://a.test', 'https://b.test']);
    expect(await s.isAllowed('https://a.test')).toBe(true);
    await s.revoke('https://a.test');
    expect(await s.isAllowed('https://a.test')).toBe(false);
  });
});

describe('HistoryStore', () => {
  const conv = (id: string, updatedAt: number): Conversation => ({
    id,
    title: `t-${id}`,
    createdAt: 0,
    updatedAt,
    profileId: 'p',
    turns: [
      { kind: 'user', text: 'hi', attachments: [] },
      {
        kind: 'step',
        id: 's1',
        label: 'Click',
        reasoning: '',
        call: { id: 'c', name: 'click', args: { id: 1 } },
        result: 'ok',
        risky: false,
        observation: { url: 'u', title: 't', summary: 's', detail: 'd', tabs: '', screenshot: 'data:image/jpeg;base64,AAA' },
      },
    ],
  });

  it('lists newest first and strips screenshots on save', async () => {
    const s = new HistoryStore(memoryKV());
    await s.save(conv('a', 1));
    await s.save(conv('b', 2));
    expect((await s.list()).map((m) => m.id)).toEqual(['b', 'a']);
    const got = await s.get('a');
    const step = got?.turns[1];
    expect(step?.kind === 'step' && step.observation?.screenshot).toBeFalsy();
    expect(step?.kind === 'step' && step.observation?.detail).toBe('d');
  });

  it('re-saving updates the index entry and remove deletes it', async () => {
    const s = new HistoryStore(memoryKV());
    await s.save(conv('a', 1));
    await s.save({ ...conv('a', 5), title: 'new' });
    expect(await s.list()).toEqual([{ id: 'a', title: 'new', updatedAt: 5 }]);
    await s.remove('a');
    expect(await s.list()).toEqual([]);
    expect(await s.get('a')).toBeUndefined();
  });
});

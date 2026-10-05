import { describe, expect, it } from 'vitest';
import { canSend, filterModels, menuGroups, prettyModel, supportsVisionFor } from '@/lib/ui/models';
import type { Profile } from '@/lib/types';

const prof = (over: Partial<Profile> = {}): Profile => ({
  id: 'p', name: 'P', baseUrl: 'http://x/v1', apiKey: '', model: 'glm-5.3-flash',
  supportsVision: false, contextMode: 'standard', contextWindow: 1000, maxScreenshots: 1, ...over,
});

describe('prettyModel', () => {
  it('title-cases words and keeps version numbers', () => {
    expect(prettyModel('glm-5.3-flash')).toBe('GLM 5.3 Flash');
    expect(prettyModel('qwen3.6-35b-a3b')).toBe('Qwen3.6 35B A3B');
    expect(prettyModel('org/kimi-k3')).toBe('Kimi K3');
    expect(prettyModel('')).toBe('Choose a model');
  });
});

describe('supportsVisionFor', () => {
  it('uses the profile flag when no per-model list is set', () => {
    expect(supportsVisionFor(prof({ supportsVision: true }), 'x')).toBe(true);
    expect(supportsVisionFor(prof(), 'x')).toBe(false);
  });
  it('uses the per-model list when it is non-empty', () => {
    const p = prof({ supportsVision: true, visionModels: ['kimi-k3'] });
    expect(supportsVisionFor(p, 'kimi-k3')).toBe(true);
    expect(supportsVisionFor(p, 'glm-5.3')).toBe(false);
    expect(supportsVisionFor(prof({ visionModels: [] , supportsVision: true}), 'a')).toBe(true);
  });
});

describe('filterModels', () => {
  it('matches case-insensitively on any substring', () => {
    expect(filterModels(['GLM-5.3', 'kimi-k3', 'glm-5.3-flash'], 'glm')).toEqual(['GLM-5.3', 'glm-5.3-flash']);
    expect(filterModels(['a', 'b'], '  ')).toEqual(['a', 'b']);
  });
});

describe('menuGroups', () => {
  it('groups by profile, keeps the current model even if not fetched, and carries errors', () => {
    const a = prof({ id: 'a', name: 'A', model: 'typed-by-hand' });
    const b = prof({ id: 'b', name: 'B', model: 'm2' });
    const groups = menuGroups([a, b], { a: { models: ['m1'], fetchedAt: 1, error: 'down' } }, '');
    expect(groups).toEqual([
      { profileId: 'a', name: 'A', models: ['typed-by-hand', 'm1'], error: 'down' },
      { profileId: 'b', name: 'B', models: ['m2'] },
    ]);
  });
  it('drops groups with no match when searching', () => {
    const a = prof({ id: 'a', name: 'A', model: 'x1' });
    const b = prof({ id: 'b', name: 'B', model: 'y1' });
    expect(menuGroups([a, b], {}, 'y').map((g) => g.profileId)).toEqual(['b']);
  });
  it('does not list an empty current model', () => {
    expect(menuGroups([prof({ model: '' })], { p: { models: ['m'], fetchedAt: 1 } }, '')[0].models).toEqual(['m']);
  });
});

describe('canSend', () => {
  it('needs a profile with a model id', () => {
    expect(canSend(null)).toBe(false);
    expect(canSend(prof({ model: '  ' }))).toBe(false);
    expect(canSend(prof())).toBe(true);
  });
});

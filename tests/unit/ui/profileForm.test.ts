import { describe, expect, it } from 'vitest';
import { newProfile, parseKeywords, validateProfile } from '@/lib/ui/profileForm';

describe('validateProfile', () => {
  it('accepts a complete profile', () => {
    expect(validateProfile({ ...newProfile(), name: 'Mac', baseUrl: 'http://mac.ts.net:8000/v1', model: 'qwen' })).toEqual([]);
  });
  it('reports each problem', () => {
    const errs = validateProfile({ ...newProfile(), name: ' ', baseUrl: 'ftp://x', model: '', contextWindow: 100, maxScreenshots: 0 });
    expect(errs).toEqual([
      'Name is required.',
      'Base URL must start with http:// or https://.',
      'Model is required.',
      'Context window must be a whole number of at least 2048 tokens.',
      'Screenshots kept must be between 1 and 10.',
    ]);
  });
  it('new profiles default to standard mode without vision', () => {
    expect(newProfile()).toMatchObject({ contextMode: 'standard', supportsVision: false, maxScreenshots: 3 });
  });
});

describe('parseKeywords', () => {
  it('splits on commas and newlines, trims, lowercases and dedupes', () => {
    expect(parseKeywords('Buy, pay\n\nDelete,buy ')).toEqual(['buy', 'pay', 'delete']);
  });
});

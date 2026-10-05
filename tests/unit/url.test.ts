import { describe, expect, it } from 'vitest';
import { isWebUrl, normalizeNavUrl, originOf } from '@/lib/url';

describe('originOf', () => {
  it('returns scheme + host for web urls', () => {
    expect(originOf('https://shop.test/cart?x=1')).toBe('https://shop.test');
    expect(originOf('http://127.0.0.1:8000/a')).toBe('http://127.0.0.1:8000');
  });
  it('returns scheme://host for browser pages', () => {
    expect(originOf('chrome://newtab/')).toBe('chrome://newtab');
    expect(originOf('about:blank')).toBe('about://');
  });
  it('returns invalid: for garbage', () => {
    expect(originOf('not a url')).toBe('invalid:');
  });
});

describe('isWebUrl', () => {
  it('accepts http and https only', () => {
    expect(isWebUrl('https://a.test')).toBe(true);
    expect(isWebUrl('http://a.test')).toBe(true);
    expect(isWebUrl('chrome://settings')).toBe(false);
    expect(isWebUrl('about:blank')).toBe(false);
  });
});

describe('normalizeNavUrl', () => {
  it('adds https:// when no scheme is given', () => {
    expect(normalizeNavUrl('example.com/path')).toBe('https://example.com/path');
  });
  it('keeps explicit schemes and trims', () => {
    expect(normalizeNavUrl('  http://a.test ')).toBe('http://a.test');
    expect(normalizeNavUrl('about:blank')).toBe('about:blank');
  });
});

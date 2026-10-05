import { describe, expect, it } from 'vitest';
import { clip, errMsg, sleep } from '@/lib/util';

describe('clip', () => {
  it('leaves short strings alone', () => {
    expect(clip('abc', 5)).toBe('abc');
  });
  it('truncates and reports the removed length', () => {
    expect(clip('abcdefghij', 4)).toBe('abcd…[+6 chars]');
  });
});

describe('errMsg', () => {
  it('reads Error messages and stringifies others', () => {
    expect(errMsg(new Error('boom'))).toBe('boom');
    expect(errMsg(42)).toBe('42');
  });
});

describe('sleep', () => {
  it('rejects when aborted', async () => {
    const c = new AbortController();
    const p = sleep(10_000, c.signal);
    c.abort(new Error('stop'));
    await expect(p).rejects.toThrow('stop');
  });
});

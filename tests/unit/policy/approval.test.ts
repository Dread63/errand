import { describe, expect, it } from 'vitest';
import { resolveApprovalMode, skipsRoutineRisk, skipsSitePrompt, taskSummary } from '@/lib/policy/approval';

describe('approval mode', () => {
  it('falls back to Ask', () => {
    expect(resolveApprovalMode(undefined)).toBe('ask');
    expect(resolveApprovalMode('site')).toBe('ask');
    expect(resolveApprovalMode('hands-off')).toBe('hands-off');
  });

  it('never lets a mode or a task grant skip a hard gate', () => {
    for (const mode of ['ask', 'auto', 'hands-off'] as const) {
      expect(skipsRoutineRisk(mode, true, true)).toBe(false);
      expect(skipsRoutineRisk(mode, false, true)).toBe(false);
    }
    expect(skipsRoutineRisk('ask', false, false)).toBe(false);
    expect(skipsRoutineRisk('ask', true, false)).toBe(true);
    expect(skipsRoutineRisk('auto', false, false)).toBe(true);
    expect(skipsRoutineRisk('hands-off', false, false)).toBe(true);
  });

  it('only Hands-off skips the site prompt', () => {
    expect(skipsSitePrompt('ask')).toBe(false);
    expect(skipsSitePrompt('auto')).toBe(false);
    expect(skipsSitePrompt('hands-off')).toBe(true);
  });

  it('makes a Hands-off summary one line', () => {
    expect(taskSummary('hands-off', 'Opened the page.\nThe price is $5.')).toBe('Opened the page. The price is $5.');
    expect(taskSummary('hands-off', ' \n ')).toBe('Task complete.');
    expect(taskSummary('ask', 'Opened the page.\nThe price is $5.')).toBe('Opened the page.\nThe price is $5.');
  });
});

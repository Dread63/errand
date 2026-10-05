import { describe, expect, it } from 'vitest';
import { classifyRisk, isSensitiveField } from '@/lib/policy/risky';
import { DEFAULT_RISKY_KEYWORDS } from '@/lib/storage/settings';
import type { ActionTarget, ElementInfo, ToolCall } from '@/lib/types';

const el = (over: Partial<ElementInfo> = {}): ElementInfo => ({
  id: 1,
  tag: 'button',
  role: 'button',
  name: 'Next',
  inForm: false,
  isSubmit: false,
  download: false,
  rect: { x: 0, y: 0, w: 1, h: 1 },
  ...over,
});
const target = (e?: ElementInfo): ActionTarget => ({ tabId: 1, origin: 'https://a.test', element: e });
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: 'c', name, args });
const risk = (c: ToolCall, e?: ElementInfo) => classifyRisk(c, target(e), DEFAULT_RISKY_KEYWORDS);

describe('isSensitiveField', () => {
  it.each([
    [{ tag: 'input', type: 'password' }],
    [{ tag: 'input', autocomplete: 'cc-number' }],
    [{ tag: 'input', autocomplete: 'one-time-code' }],
    [{ tag: 'input', fieldName: 'card_cvc' }],
    [{ tag: 'input', fieldName: 'otp' }],
  ])('%o is sensitive', (over) => {
    expect(isSensitiveField(el(over as Partial<ElementInfo>))).toBe(true);
  });
  it('plain fields are not', () => {
    expect(isSensitiveField(el({ tag: 'input', type: 'text', fieldName: 'email' }))).toBe(false);
  });
});

describe('classifyRisk', () => {
  it('flags typing into sensitive fields', () => {
    expect(risk(call('type', { id: 1, text: 'x' }), el({ tag: 'input', type: 'password' })).reasons).toEqual([
      'Typing into a password, payment or one-time-code field',
    ]);
  });
  it('flags submit buttons and keyword labels (whole words only)', () => {
    expect(risk(call('click'), el({ isSubmit: true, name: 'Go' })).risky).toBe(true);
    expect(risk(call('click'), el({ name: 'Place order' })).reasons).toEqual(['Label contains "order"']);
    expect(risk(call('click'), el({ name: 'Ordered list help' })).risky).toBe(false);
    expect(risk(call('click'), el({ name: 'Next' })).risky).toBe(false);
  });
  it('flags Enter inside a form via type(submit) or key', () => {
    expect(risk(call('type', { id: 1, text: 'q', submit: true }), el({ tag: 'input', inForm: true })).risky).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), el({ tag: 'input', inForm: true })).risky).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), el({ tag: 'input', inForm: false })).risky).toBe(false);
  });
  it('flags downloads and file uploads', () => {
    expect(risk(call('click'), el({ tag: 'a', role: 'link', name: 'Get', href: 'https://a.test/app.dmg' })).risky).toBe(true);
    expect(risk(call('click'), el({ tag: 'a', role: 'link', name: 'Get', download: true })).risky).toBe(true);
    expect(risk(call('click'), el({ tag: 'input', type: 'file', name: 'Upload' })).risky).toBe(true);
  });
  it('honours the model flag but the model cannot un-flag a rule', () => {
    expect(risk(call('scroll', { direction: 'down', risky: true })).reasons).toEqual(['The model flagged this action as risky']);
    expect(risk(call('click', { risky: false }), el({ isSubmit: true })).risky).toBe(true);
  });
  it('uses the configured keyword list', () => {
    expect(classifyRisk(call('click'), target(el({ name: 'Archive' })), ['archive']).risky).toBe(true);
  });
});

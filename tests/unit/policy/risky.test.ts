import { describe, expect, it } from 'vitest';
import { validateCall } from '@/lib/agent/tools';
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
    expect(risk(call('type', { id: 1, text: 'q', submit: true }), el({ tag: 'input', inForm: true })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), el({ tag: 'input', inForm: true })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), el({ tag: 'input', inForm: false })).risky).toBe(false);
    // A newline in typed text presses Enter too.
    expect(risk(call('type', { id: 1, text: 'a\nb' }), el({ tag: 'input', inForm: true })).reasons).toEqual(['Pressing Enter inside a form']);
    expect(risk(call('type', { id: 1, text: 'a\nb' }), el({ tag: 'input', inForm: true })).hard).toBe(true);
    expect(risk(call('type', { text: 'a\tb' }), el({ tag: 'input', inForm: true })).risky).toBe(false);
  });
  it('treats every form submission as a hard gate, including an ordinary field or a plain submit button', () => {
    expect(risk(call('click'), el({ isSubmit: true, name: 'Go' })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), el({ name: 'Go', inForm: true })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), el({ isSubmit: true, name: 'Place order' })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Space' }), el({ isSubmit: true, name: 'Go' })).hard).toBe(true);
    expect(risk(call('type', { text: '1 Main St', submit: true }), el({ tag: 'input', name: 'Address', inForm: true })).hard).toBe(true);
    expect(risk(call('click'), el({ tag: 'a', role: 'link', name: 'Get', download: true })).hard).toBe(false);
    expect(risk(call('scroll', { direction: 'down', risky: true })).hard).toBe(false);
  });
  it('keeps the hard gate when a key press submits a sensitive field or activates a keyword button', () => {
    expect(risk(call('key', { combo: 'Enter' }), el({ tag: 'input', type: 'password', inForm: true })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), el({ tag: 'input', autocomplete: 'cc-number' })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Return' }), el({ name: 'Pay now', inForm: true })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Space' }), el({ name: 'Delete account' })).hard).toBe(true);
    expect(risk(call('key', { combo: 'Tab' }), el({ name: 'Pay now' })).risky).toBe(false);
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

  it('treats type as a click when it targets a pay or submit control, and Enter outside a form', () => {
    const checked = (name: string, args: Record<string, unknown>, element: ElementInfo, vision = false) =>
      classifyRisk(validateCall({ id: 'c', name, args }, vision), target(element), DEFAULT_RISKY_KEYWORDS);
    const pay = el({ name: 'Pay now', inForm: false, isSubmit: false });
    const order = el({ name: 'Place order', inForm: false, isSubmit: false });
    const submit = el({ name: 'Continue', inForm: true, isSubmit: true });
    expect(checked('type', { id: 1, text: 'x' }, pay)).toMatchObject({ risky: true, hard: true });
    expect(checked('type', { x: 4, y: 5, text: 'x' }, pay, true).hard).toBe(true);
    expect(checked('type', { id: 1, text: 'x' }, submit)).toMatchObject({ risky: true, hard: true, reasons: ['Typing activates a submit button'] });
    expect(checked('type', { text: 'x', submit: true }, pay).hard).toBe(true);
    expect(checked('type', { text: 'a\nb' }, order).reasons).toContain('Label contains "order"');
    expect(checked('type', { text: 'a\nb' }, order).hard).toBe(true);
    expect(checked('key', { combo: 'NumpadEnter' }, pay).hard).toBe(true);
    // Typing plain text into a focused button does not click it.
    expect(checked('type', { text: 'hello' }, pay).hard).toBe(false);
    // A newline in a spreadsheet cell is not a form submit. Tab-then-Enter is not blanket-blocked either.
    const cell = el({ tag: 'textarea', role: 'textbox', name: '', inForm: false });
    expect(checked('type', { text: 'hi\n' }, cell).risky).toBe(false);
    expect(checked('type', { text: '1\t\n' }, el({ tag: 'input', role: 'textbox', type: 'text', name: 'Quantity', inForm: false })).risky).toBe(false);
    expect(checked('type', { text: '1\t', submit: true }, el({ tag: 'input', role: 'textbox', type: 'text', name: 'Quantity', inForm: false })).risky).toBe(false);
    const field = (name: string) => el({ tag: 'input', role: 'textbox', type: 'text', name, inForm: false, isSubmit: false });
    expect(checked('type', { id: 1, text: '100' }, field('Order number')).hard).toBe(false);
    expect(checked('type', { id: 1, text: 'Hi' }, field('Post title')).hard).toBe(false);
    expect(checked('type', { id: 1, text: 'a@b.c' }, field('Confirm email')).hard).toBe(false);
    expect(checked('click', { id: 1 }, field('Order number')).hard).toBe(false);
    expect(checked('click', { id: 1 }, field('Post title')).hard).toBe(false);
    expect(checked('click', { id: 1 }, field('Confirm email')).hard).toBe(false);
    expect(checked('key', { combo: 'Enter' }, field('Order number')).risky).toBe(false);
    expect(checked('key', { combo: 'Space' }, field('Post title')).risky).toBe(false);
    expect(checked('type', { id: 1, text: 'x' }, el({ tag: 'a', role: 'link', name: 'Get', download: true }))).toMatchObject({ risky: true, hard: false });
  });

  it('hard-gates a pay or buy label on any control that is not a text field', () => {
    const checked = (name: string, args: Record<string, unknown>, element: ElementInfo) =>
      classifyRisk(validateCall({ id: 'c', name, args }, false), target(element), DEFAULT_RISKY_KEYWORDS);
    const control = (tag: string, role: string, name: string) =>
      el({ tag, role, name, inForm: false, isSubmit: false });
    const buy = control('div', 'clickable', 'Buy now');
    const pay = control('span', 'clickable', 'Pay now');
    const order = control('div', 'clickable', 'Place order');
    expect(checked('click', { id: 1 }, buy)).toMatchObject({ risky: true, hard: true, reasons: ['Label contains "buy"'] });
    expect(checked('key', { combo: 'Enter' }, buy).hard).toBe(true);
    expect(checked('key', { combo: 'Space' }, buy).hard).toBe(true);
    expect(checked('click', { id: 1 }, pay).hard).toBe(true);
    expect(checked('key', { combo: 'Enter' }, pay).hard).toBe(true);
    expect(checked('key', { combo: 'Space' }, pay).hard).toBe(true);
    for (const element of [
      control('span', 'clickable', 'Pay now'),
      control('label', 'clickable', 'Pay now'),
      control('td', 'clickable', 'Pay now'),
      control('div', 'option', 'Pay now'),
      control('div', 'tab', 'Pay now'),
      control('div', 'checkbox', 'Pay now'),
      control('div', 'menuitemradio', 'Pay now'),
    ]) {
      expect(checked('click', { id: 1 }, element).hard).toBe(true);
      expect(checked('key', { combo: 'Enter' }, element).hard).toBe(true);
      expect(checked('key', { combo: 'Space' }, element).hard).toBe(true);
    }
    expect(checked('type', { id: 1, text: 'x' }, order)).toMatchObject({ risky: true, hard: true });
    expect(checked('type', { text: 'x', submit: true }, order).hard).toBe(true);
    expect(checked('type', { text: 'hello' }, order).risky).toBe(false);
    expect(checked('click', { id: 1 }, control('div', 'clickable', 'Next')).risky).toBe(false);
  });

  it('hard-gates keys that enter a password or card, including paste, but not navigation', () => {
    const password = el({ tag: 'input', role: 'textbox', type: 'password', name: 'Password' });
    const card = el({ tag: 'input', role: 'textbox', autocomplete: 'cc-number', name: 'Card' });
    expect(risk(call('key', { combo: 's' }), password).hard).toBe(true);
    expect(risk(call('key', { combo: 'e' }), password).hard).toBe(true);
    expect(risk(call('key', { combo: 'Meta+v' }), card)).toMatchObject({ hard: true });
    expect(risk(call('key', { combo: 'Control+v' }), card).hard).toBe(true);
    expect(risk(call('key', { combo: 'Tab' }), password).risky).toBe(false);
    expect(risk(call('key', { combo: 'Shift+Tab' }), password).risky).toBe(false);
    expect(risk(call('key', { combo: 'Escape' }), password).risky).toBe(false);
    expect(risk(call('key', { combo: 'ArrowLeft' }), password).risky).toBe(false);
    expect(risk(call('key', { combo: 'a' }), el({ tag: 'input', role: 'textbox', type: 'text', name: 'Quantity' })).risky).toBe(false);
  });

  it('hard-gates clicks, typing, and keys on a frame the page cannot read', () => {
    const frame = el({ tag: 'iframe', role: 'generic', name: 'Secure payment input frame' });
    expect(risk(call('type', { text: '4242' }), frame)).toMatchObject({ hard: true, reasons: ['Interacting with a frame the page cannot read'] });
    expect(risk(call('click'), frame).hard).toBe(true);
    expect(risk(call('key', { combo: 'Enter' }), frame).hard).toBe(true);
    expect(risk(call('scroll', { direction: 'down' }), frame).risky).toBe(false);
    expect(risk(call('hover'), frame).risky).toBe(false);
  });
});

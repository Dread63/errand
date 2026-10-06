import { describe, expect, it } from 'vitest';
import { describeCall, pillLabel, TOOL_NAMES, TOOL_SCHEMAS, toolSchemas, validateCall } from '@/lib/agent/tools';
import { ToolError } from '@/lib/errors';
import type { ElementInfo, ToolCall } from '@/lib/types';

const c = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: 'x', name, args });

describe('TOOL_SCHEMAS', () => {
  it('defines the 15 spec tools', () => {
    expect(TOOL_NAMES).toEqual([
      'click', 'type', 'select', 'scroll', 'hover', 'key', 'navigate', 'back', 'wait',
      'read_text', 'new_tab', 'switch_tab', 'close_tab', 'ask_user', 'done',
    ]);
    for (const t of TOOL_SCHEMAS) expect(t.function.parameters).toMatchObject({ type: 'object' });
  });
});

describe('toolSchemas', () => {
  const props = (vision: boolean, name: string) =>
    (toolSchemas(vision).find((t) => t.function.name === name)!.function.parameters as { properties: Record<string, unknown>; required: string[] });
  it('offers x/y only to vision models', () => {
    expect(props(false, 'click').properties).not.toHaveProperty('x');
    expect(props(false, 'click').required).toEqual(['id']);
    expect(props(true, 'click').properties).toHaveProperty('x');
    expect(props(true, 'click').required).toEqual([]);
    expect(props(true, 'hover').properties).toHaveProperty('y');
  });
  it('type needs only text, so it can type into whatever has focus', () => {
    expect(props(false, 'type').required).toEqual(['text']);
  });
});

describe('validateCall', () => {
  it('type without an id is allowed', () => {
    expect(validateCall(c('type', { text: 'Rent\t1200' })).args).toEqual({ text: 'Rent\t1200' });
  });
  it('accepts screenshot coordinates from vision models only', () => {
    expect(validateCall(c('click', { x: '120', y: 45 }), true).args).toEqual({ x: 120, y: 45 });
    expect(() => validateCall(c('click', { x: 120, y: 45 }))).toThrow('click requires "id".');
    expect(() => validateCall(c('click', { x: 120 }), true)).toThrow('click needs both "x" and "y".');
    expect(() => validateCall(c('click', { x: -1, y: 4 }), true)).toThrow(/must not be negative/);
    expect(() => validateCall(c('hover', {}), true)).toThrow('hover requires "id", or "x" and "y" from the screenshot.');
  });
  it('prefers an id over coordinates when both are given', () => {
    expect(validateCall(c('click', { id: 3, x: 1, y: 2 }), true).args).toEqual({ id: 3 });
  });
  it('clamps key repeat to 1..50', () => {
    expect(validateCall(c('key', { combo: 'Tab', repeat: 500 })).args.repeat).toBe(50);
    expect(validateCall(c('key', { combo: 'Tab', repeat: 0 })).args.repeat).toBe(1);
  });
  it('coerces numeric strings and bracketed ids from small models', () => {
    expect(validateCall(c('click', { id: '12' })).args).toEqual({ id: 12 });
    expect(validateCall(c('click', { id: '[7]' })).args).toEqual({ id: 7 });
    expect(validateCall(c('type', { id: 1, text: 'hi', submit: 'true' })).args).toEqual({ id: 1, text: 'hi', submit: true });
  });
  it('drops unknown arguments', () => {
    expect(validateCall(c('back', { foo: 1 })).args).toEqual({});
  });
  it('rejects unknown tools, missing args and bad types with model-readable messages', () => {
    expect(() => validateCall(c('fly'))).toThrow(/Unknown tool "fly"/);
    expect(() => validateCall(c('click'))).toThrow(ToolError);
    expect(() => validateCall(c('click'))).toThrow('click requires "id".');
    expect(() => validateCall(c('click', { id: 'abc' }))).toThrow(/must be an integer/);
    expect(() => validateCall(c('scroll', {}))).toThrow(/direction" or "id/);
    expect(() => validateCall(c('scroll', { direction: 'sideways' }))).toThrow(/one of up, down/);
  });
  it('normalizes urls and blocks non-web schemes', () => {
    expect(validateCall(c('navigate', { url: 'example.com' })).args.url).toBe('https://example.com/');
    expect(() => validateCall(c('navigate', { url: 'javascript:alert(1)' }))).toThrow(/Only http/);
  });
  it('clamps wait', () => {
    expect(validateCall(c('wait', { ms: 99999 })).args.ms).toBe(10000);
  });
});

describe('describeCall', () => {
  const field = (over: Partial<ElementInfo>): ElementInfo => ({
    id: 3, tag: 'input', role: 'textbox', name: 'Password', inForm: true, isSubmit: false, download: false,
    rect: { x: 0, y: 0, w: 1, h: 1 }, ...over,
  });
  it('uses the element label when known', () => {
    expect(describeCall(c('click', { id: 3 }), { tabId: 1, origin: 'o', element: field({ role: 'button', name: 'Add to cart' }) })).toBe(
      'Click the "Add to cart" button',
    );
    expect(describeCall(c('click', { id: 3 }))).toBe('Click an item on the page');
  });
  it('describes coordinate, focused-element and repeated actions', () => {
    expect(describeCall(c('click', { x: 120, y: 45 }))).toBe('Click the page');
    expect(describeCall(c('click', { x: 120, y: 45 }), { tabId: 1, origin: 'o', element: field({ role: 'gridcell', name: 'A1' }) })).toBe(
      'Click "A1"',
    );
    expect(describeCall(c('type', { text: 'Rent\t1200\nFood' }))).toBe('Type "Rent⇥1200⏎Food" into the current field');
    expect(describeCall(c('key', { combo: 'Tab', repeat: 3 }))).toBe('Press Tab ×3');
  });
  it('masks text typed into sensitive fields', () => {
    expect(describeCall(c('type', { id: 3, text: 'hunter2' }), { tabId: 1, origin: 'o', element: field({ type: 'password' }) })).toBe(
      'Type "••••••" into the "Password" text box',
    );
  });
});

describe('pillLabel', () => {
  const el = (over: Partial<ElementInfo>): ElementInfo => ({
    id: 3, tag: 'input', role: 'textbox', name: 'Password', inForm: true, isSubmit: false, download: false,
    rect: { x: 0, y: 0, w: 1, h: 1 }, ...over,
  });
  const t = (element: ElementInfo) => ({ tabId: 1, origin: 'o', element });
  it('names only the kind of element, never its name or the typed text', () => {
    expect(pillLabel(c('click', { id: 3 }), t(el({ role: 'button', name: 'Place order' })))).toBe('Clicking a button');
    expect(pillLabel(c('type', { id: 3, text: 'hunter2' }), t(el({})))).toBe('Typing into a text field');
    expect(pillLabel(c('click', { id: 3 }), t(el({ role: 'weirdrole' })))).toBe('Clicking an item');
    expect(pillLabel(c('click', { x: 1, y: 2 }))).toBe('Clicking the page');
  });
});

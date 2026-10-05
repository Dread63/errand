import { describe, expect, it } from 'vitest';
import { describeCall, TOOL_NAMES, TOOL_SCHEMAS, validateCall } from '@/lib/agent/tools';
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

describe('validateCall', () => {
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
      'Click button "Add to cart"',
    );
    expect(describeCall(c('click', { id: 3 }))).toBe('Click element [3]');
  });
  it('masks text typed into sensitive fields', () => {
    expect(describeCall(c('type', { id: 3, text: 'hunter2' }), { tabId: 1, origin: 'o', element: field({ type: 'password' }) })).toBe(
      'Type "••••••" into textbox "Password"',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { parseCombo } from '@/lib/browser/keys';
import { ToolError } from '@/lib/errors';

describe('parseCombo', () => {
  it('named keys', () => {
    expect(parseCombo('Enter')).toEqual({ key: 'Enter', code: 'Enter', keyCode: 13, modifiers: 0, text: '\r' });
    expect(parseCombo('Shift+Tab')).toEqual({ key: 'Tab', code: 'Tab', keyCode: 9, modifiers: 8 });
    expect(parseCombo('escape')).toMatchObject({ key: 'Escape', keyCode: 27 });
    expect(parseCombo('ArrowDown')).toMatchObject({ key: 'ArrowDown', keyCode: 40 });
  });
  it('characters produce text unless Ctrl/Alt/Meta is held', () => {
    expect(parseCombo('x')).toEqual({ key: 'x', code: 'KeyX', keyCode: 88, modifiers: 0, text: 'x' });
    expect(parseCombo('Shift+a')).toMatchObject({ key: 'A', text: 'A', modifiers: 8 });
    expect(parseCombo('Control+a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, modifiers: 2, commands: ['selectAll'] });
    expect(parseCombo('Meta+a')).toMatchObject({ modifiers: 4, commands: ['selectAll'] });
    expect(parseCombo('5')).toMatchObject({ code: 'Digit5', text: '5' });
  });
  it('rejects unknown keys and modifiers', () => {
    expect(() => parseCombo('Hyper+a')).toThrow(ToolError);
    expect(() => parseCombo('F13')).toThrow('Unknown key "F13".');
    expect(() => parseCombo('')).toThrow(/Empty/);
  });
});

import { ToolError } from '../errors';

export interface KeySpec {
  key: string;
  code: string;
  keyCode: number;
  modifiers: number;
  text?: string;
  commands?: string[];
}

const MODS: Record<string, number> = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

const NAMED: Record<string, [key: string, code: string, keyCode: number, text?: string]> = {
  enter: ['Enter', 'Enter', 13, '\r'],
  return: ['Enter', 'Enter', 13, '\r'],
  tab: ['Tab', 'Tab', 9],
  escape: ['Escape', 'Escape', 27],
  esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8],
  delete: ['Delete', 'Delete', 46],
  space: [' ', 'Space', 32, ' '],
  arrowup: ['ArrowUp', 'ArrowUp', 38],
  up: ['ArrowUp', 'ArrowUp', 38],
  arrowdown: ['ArrowDown', 'ArrowDown', 40],
  down: ['ArrowDown', 'ArrowDown', 40],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37],
  left: ['ArrowLeft', 'ArrowLeft', 37],
  arrowright: ['ArrowRight', 'ArrowRight', 39],
  right: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36],
  end: ['End', 'End', 35],
  pageup: ['PageUp', 'PageUp', 33],
  pagedown: ['PageDown', 'PageDown', 34],
};

const SHORTCUT_COMMANDS: Record<string, string> = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' };

export function parseCombo(combo: string): KeySpec {
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new ToolError('Empty key combination.');
  let modifiers = 0;
  for (const m of parts.slice(0, -1)) {
    const bit = MODS[m.toLowerCase()];
    if (bit === undefined) throw new ToolError(`Unknown modifier "${m}".`);
    modifiers |= bit;
  }
  const last = parts[parts.length - 1];
  const textAllowed = (modifiers & (1 | 2 | 4)) === 0;
  const named = NAMED[last.toLowerCase()];
  if (named) {
    const [key, code, keyCode, text] = named;
    return { key, code, keyCode, modifiers, ...(text && textAllowed ? { text } : {}) };
  }
  if (last.length !== 1) throw new ToolError(`Unknown key "${last}".`);
  const upper = last.toUpperCase();
  const key = modifiers & 8 ? upper : last;
  const code = /[a-z]/i.test(last) ? `Key${upper}` : /[0-9]/.test(last) ? `Digit${last}` : '';
  const spec: KeySpec = { key, code, keyCode: upper.charCodeAt(0), modifiers };
  if (textAllowed) spec.text = key;
  const cmd = SHORTCUT_COMMANDS[last.toLowerCase()];
  if (!textAllowed && modifiers & (2 | 4) && cmd) spec.commands = [cmd];
  return spec;
}

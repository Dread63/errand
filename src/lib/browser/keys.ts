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

/** US-layout punctuation keys: unshifted char -> [code, Windows virtual key code, shifted char]. */
const PUNCT: Record<string, [code: string, keyCode: number, shifted: string]> = {
  '-': ['Minus', 189, '_'],
  '=': ['Equal', 187, '+'],
  '[': ['BracketLeft', 219, '{'],
  ']': ['BracketRight', 221, '}'],
  '\\': ['Backslash', 220, '|'],
  ';': ['Semicolon', 186, ':'],
  "'": ['Quote', 222, '"'],
  ',': ['Comma', 188, '<'],
  '.': ['Period', 190, '>'],
  '/': ['Slash', 191, '?'],
  '`': ['Backquote', 192, '~'],
};
const DIGIT_SHIFTED = ')!@#$%^&*(';
/** Shifted char -> the unshifted key that produces it. */
const UNSHIFT: Record<string, string> = Object.fromEntries([
  ...Object.entries(PUNCT).map(([k, v]) => [v[2], k]),
  ...[...DIGIT_SHIFTED].map((c, i) => [c, String(i)]),
]);

function splitCombo(combo: string): string[] {
  const s = combo.trim();
  // A trailing "+" is the plus key itself ("+", "Shift++"), not a separator.
  if (s.endsWith('+')) return [...splitCombo(s.slice(0, -1).replace(/\+$/, '')), '+'].filter(Boolean);
  return s
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
}

export function parseCombo(combo: string): KeySpec {
  const parts = splitCombo(combo);
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
  // "+" or "!" is typed as Shift plus the key that carries it.
  let base = last;
  if (UNSHIFT[last]) {
    base = UNSHIFT[last];
    modifiers |= 8;
  } else if (/[A-Z]/.test(last)) {
    modifiers |= 8;
  }
  const shift = (modifiers & 8) !== 0;
  const punct = PUNCT[base];
  let key: string;
  let code: string;
  let keyCode: number;
  if (/[a-z]/i.test(base)) {
    key = shift ? base.toUpperCase() : base.toLowerCase();
    code = `Key${base.toUpperCase()}`;
    keyCode = base.toUpperCase().charCodeAt(0);
  } else if (/[0-9]/.test(base)) {
    key = shift ? DIGIT_SHIFTED[Number(base)] : base;
    code = `Digit${base}`;
    keyCode = base.charCodeAt(0);
  } else if (punct) {
    key = shift ? punct[2] : base;
    [code, keyCode] = punct;
  } else {
    key = last;
    code = '';
    keyCode = last.charCodeAt(0);
  }
  const spec: KeySpec = { key, code, keyCode, modifiers };
  if (textAllowed) spec.text = key;
  const cmd = SHORTCUT_COMMANDS[last.toLowerCase()];
  if (!textAllowed && modifiers & (2 | 4) && cmd) spec.commands = [cmd];
  return spec;
}

import { ToolError } from '../errors';
import type { ToolSchema } from '../llm/types';
import { isSensitiveField } from '../policy/risky';
import type { ActionTarget, ElementInfo, ToolCall } from '../types';
import { normalizeNavUrl } from '../url';
import { clip } from '../util';

type Prop = { type: 'integer' | 'string' | 'boolean'; description?: string; enum?: string[] };

const COMMON: Record<string, Prop> = {
  reason: { type: 'string', description: 'One short sentence: why this action.' },
  risky: { type: 'boolean', description: 'Set true if this action is irreversible, spends money, sends data or deletes something.' },
};
const ID: Prop = { type: 'integer', description: 'Element id from the latest page state' };
const X: Prop = { type: 'integer', description: 'Screenshot x coordinate in pixels; use instead of id for things with no id' };
const Y: Prop = { type: 'integer', description: 'Screenshot y coordinate in pixels' };

function tool(name: string, description: string, properties: Record<string, Prop>, required: string[] = []): ToolSchema {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties: { ...properties, ...COMMON }, required } },
  };
}

/** Coordinates are offered only to models that see the screenshot. */
export function toolSchemas(vision: boolean): ToolSchema[] {
  const at: Record<string, Prop> = vision ? { x: X, y: Y } : {};
  const target = vision ? ' Pass id, or x and y for something visible in the screenshot that has no id.' : '';
  return [
    tool('click', `Click an element.${target}`, { id: ID, ...at }, vision ? [] : ['id']),
    tool(
      'type',
      `Type text. With id${vision ? ' (or x and y)' : ''}, clicks that spot first; without, types into whatever has focus (e.g. a selected spreadsheet cell). In text, a tab character (\\t) presses Tab and a newline (\\n) presses Enter, so a whole row or table can be entered in one call.`,
      {
        id: ID,
        ...at,
        text: { type: 'string' },
        submit: { type: 'boolean', description: 'Press Enter after typing' },
        clear: { type: 'boolean', description: 'Select all and delete existing text first (default: true with id, false otherwise)' },
      },
      ['text'],
    ),
    tool('select', 'Choose an option in a dropdown (<select>) by its visible text or value.', { id: ID, value: { type: 'string' } }, ['id', 'value']),
    tool('scroll', 'Scroll the page up or down, or scroll an element into view.', {
      direction: { type: 'string', enum: ['up', 'down'] },
      id: ID,
    }),
    tool('hover', `Move the mouse over an element (e.g. to open a menu).${target}`, { id: ID, ...at }, vision ? [] : ['id']),
    tool(
      'key',
      'Press a key or combination, e.g. "Enter", "Escape", "Control+a", "ArrowDown", "+". To enter text use type instead.',
      { combo: { type: 'string' }, repeat: { type: 'integer', description: 'Press it this many times (default 1, max 50)' } },
      ['combo'],
    ),
    tool('navigate', 'Go to a URL in the current tab.', { url: { type: 'string' } }, ['url']),
    tool('back', 'Go back to the previous page.', {}),
    tool('wait', 'Wait for the page to update (max 10000 ms).', { ms: { type: 'integer' } }, ['ms']),
    tool('read_text', 'Read the text content of the current page.', {}),
    tool('new_tab', 'Open a URL in a new agent tab and switch to it.', { url: { type: 'string' } }, ['url']),
    tool('switch_tab', 'Switch to another agent tab by index.', { index: { type: 'integer' } }, ['index']),
    tool('close_tab', 'Close an agent tab by index.', { index: { type: 'integer' } }, ['index']),
    tool('ask_user', 'Ask the user a question and wait for the answer.', { question: { type: 'string' } }, ['question']),
    tool('done', 'Finish the task with a summary for the user.', { summary: { type: 'string' } }, ['summary']),
  ];
}

export const TOOL_SCHEMAS: ToolSchema[] = toolSchemas(false);
const VISION_SCHEMAS: ToolSchema[] = toolSchemas(true);

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.function.name);

function coerce(key: string, v: unknown, spec: Prop): unknown {
  if (v === undefined || v === null) return undefined;
  if (spec.type === 'integer') {
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/^\[|\]$/g, ''));
    if (!Number.isInteger(n)) throw new ToolError(`"${key}" must be an integer, got ${JSON.stringify(v)}.`);
    return n;
  }
  if (spec.type === 'boolean') {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    throw new ToolError(`"${key}" must be true or false.`);
  }
  const s = typeof v === 'string' ? v : String(v);
  if (spec.enum && !spec.enum.includes(s)) throw new ToolError(`"${key}" must be one of ${spec.enum.join(', ')}.`);
  return s;
}

function checkUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(normalizeNavUrl(input));
  } catch {
    throw new ToolError(`"${input}" is not a valid URL.`);
  }
  if (!['http:', 'https:', 'about:'].includes(u.protocol)) throw new ToolError(`Only http(s) URLs are allowed, got "${u.protocol}".`);
  return u.toString();
}

/** Checks a call against the tools the model was offered; x/y are only accepted from vision models. */
export function validateCall(call: ToolCall, vision = false): ToolCall {
  const schema = (vision ? VISION_SCHEMAS : TOOL_SCHEMAS).find((t) => t.function.name === call.name);
  if (!schema) throw new ToolError(`Unknown tool "${call.name}". Available tools: ${TOOL_NAMES.join(', ')}.`);
  const params = schema.function.parameters as { properties: Record<string, Prop>; required: string[] };
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(call.args)) {
    const spec = params.properties[k];
    if (!spec) continue;
    const value = coerce(k, v, spec);
    if (value !== undefined) args[k] = value;
  }
  for (const r of params.required) {
    if (args[r] === undefined || args[r] === '') throw new ToolError(`${call.name} requires "${r}".`);
  }
  if (call.name === 'scroll' && args.id === undefined && args.direction === undefined) {
    throw new ToolError('scroll requires "direction" or "id".');
  }
  if ((args.x === undefined) !== (args.y === undefined)) throw new ToolError(`${call.name} needs both "x" and "y".`);
  if (args.x !== undefined) {
    if ((args.x as number) < 0 || (args.y as number) < 0) throw new ToolError('"x" and "y" must not be negative.');
    // An id is the more precise target; drop coordinates rather than guess which one was meant.
    if (args.id !== undefined) {
      delete args.x;
      delete args.y;
    }
  }
  if ((call.name === 'click' || call.name === 'hover') && args.id === undefined && args.x === undefined) {
    throw new ToolError(`${call.name} requires "id", or "x" and "y" from the screenshot.`);
  }
  if (call.name === 'key' && args.repeat !== undefined) args.repeat = Math.min(Math.max(args.repeat as number, 1), 50);
  if (call.name === 'wait') args.ms = Math.min(Math.max(args.ms as number, 0), 10_000);
  if (call.name === 'navigate' || call.name === 'new_tab') args.url = checkUrl(String(args.url));
  return { id: call.id, name: call.name, args };
}

/** Plain-English nouns for element roles. Anything else (generic, clickable, gridcell…) is described by its name alone. */
const ROLE_WORD: Record<string, string> = {
  button: 'button', link: 'link', textbox: 'text box', searchbox: 'search box', combobox: 'dropdown', listbox: 'list',
  option: 'option', checkbox: 'checkbox', radio: 'radio button', switch: 'switch', tab: 'tab', menuitem: 'menu item',
  slider: 'slider', img: 'image', heading: 'heading',
};

function plainWhat(el: ElementInfo | undefined, a: Record<string, unknown>): string {
  if (!el) return a.id !== undefined ? 'an item on the page' : a.x !== undefined ? 'the page' : 'the current field';
  const word = ROLE_WORD[el.role];
  const name = clip(el.name, 60);
  if (name) return word ? `the "${name}" ${word}` : `"${name}"`;
  return word ? `a ${word}` : 'an item on the page';
}

export function describeCall(call: ToolCall, target?: ActionTarget): string {
  const el = target?.element;
  const a = call.args;
  const what = plainWhat(el, a);
  switch (call.name) {
    case 'click':
      return `Click ${what}`;
    case 'hover':
      return `Hover over ${what}`;
    case 'type': {
      const text = el && isSensitiveField(el) ? '••••••' : clip(String(a.text).replace(/\t/g, '⇥').replace(/\n/g, '⏎'), 80);
      return `Type "${text}" into ${what}${a.submit ? ' and press Enter' : ''}`;
    }
    case 'select':
      return `Select "${a.value}" in ${what}`;
    case 'scroll':
      return a.id !== undefined ? `Scroll to ${what}` : `Scroll ${a.direction}`;
    case 'key':
      return `Press ${a.combo}${typeof a.repeat === 'number' && a.repeat > 1 ? ` ×${a.repeat}` : ''}`;
    case 'navigate':
      return `Go to ${a.url}`;
    case 'back':
      return 'Go back';
    case 'wait':
      return `Wait ${a.ms} ms`;
    case 'read_text':
      return 'Read page text';
    case 'new_tab':
      return `Open new tab: ${a.url}`;
    case 'switch_tab':
      return `Switch to tab ${a.index}`;
    case 'close_tab':
      return `Close tab ${a.index}`;
    case 'ask_user':
      return 'Ask you a question';
    case 'done':
      return 'Finish';
    default:
      return 'Invalid tool call';
  }
}

const ROLE_NOUN: Record<string, string> = {
  button: 'a button', link: 'a link', textbox: 'a text field', searchbox: 'a search box', combobox: 'a dropdown', listbox: 'a list',
  option: 'an option', checkbox: 'a checkbox', radio: 'a radio button', switch: 'a switch', tab: 'a tab', menuitem: 'a menu item',
  slider: 'a slider', img: 'an image', heading: 'a heading', gridcell: 'a cell', cell: 'a cell',
};

/** Short, generic description for the on-page cursor pill: what kind of element, never its name or typed text. */
export function pillLabel(call: ToolCall, target?: ActionTarget): string {
  const el = target?.element;
  const noun = el ? (ROLE_NOUN[el.role] ?? 'an item') : call.args.x !== undefined ? 'the page' : 'an item';
  switch (call.name) {
    case 'click':
      return `Clicking ${noun}`;
    case 'hover':
      return `Hovering over ${noun}`;
    case 'type':
      return el ? `Typing into ${noun}` : 'Typing';
    case 'select':
      return `Choosing from ${noun}`;
    case 'scroll':
      return 'Scrolling';
    default:
      return describeCall(call, target); // key, navigate, etc. carry no element or field names
  }
}

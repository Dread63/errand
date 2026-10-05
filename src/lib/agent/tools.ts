import { ToolError } from '../errors';
import type { ToolSchema } from '../llm/types';
import { isSensitiveField } from '../policy/risky';
import type { ActionTarget, ToolCall } from '../types';
import { normalizeNavUrl } from '../url';
import { clip } from '../util';

type Prop = { type: 'integer' | 'string' | 'boolean'; description?: string; enum?: string[] };

const COMMON: Record<string, Prop> = {
  reason: { type: 'string', description: 'One short sentence: why this action.' },
  risky: { type: 'boolean', description: 'Set true if this action is irreversible, spends money, sends data or deletes something.' },
};
const ID: Prop = { type: 'integer', description: 'Element id from the latest page state' };

function tool(name: string, description: string, properties: Record<string, Prop>, required: string[] = []): ToolSchema {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties: { ...properties, ...COMMON }, required } },
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  tool('click', 'Click an element.', { id: ID }, ['id']),
  tool(
    'type',
    'Click a text field and type into it. Replaces existing text unless clear is false.',
    {
      id: ID,
      text: { type: 'string' },
      submit: { type: 'boolean', description: 'Press Enter after typing' },
      clear: { type: 'boolean', description: 'Clear existing text first (default true)' },
    },
    ['id', 'text'],
  ),
  tool('select', 'Choose an option in a dropdown (<select>) by its visible text or value.', { id: ID, value: { type: 'string' } }, ['id', 'value']),
  tool('scroll', 'Scroll the page up or down, or scroll an element into view.', {
    direction: { type: 'string', enum: ['up', 'down'] },
    id: ID,
  }),
  tool('hover', 'Move the mouse over an element (e.g. to open a menu).', { id: ID }, ['id']),
  tool('key', 'Press a key or combination, e.g. "Enter", "Escape", "Control+a", "ArrowDown".', { combo: { type: 'string' } }, ['combo']),
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

export function validateCall(call: ToolCall): ToolCall {
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === call.name);
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
  if (call.name === 'wait') args.ms = Math.min(Math.max(args.ms as number, 0), 10_000);
  if (call.name === 'navigate' || call.name === 'new_tab') args.url = checkUrl(String(args.url));
  return { id: call.id, name: call.name, args };
}

export function describeCall(call: ToolCall, target?: ActionTarget): string {
  const el = target?.element;
  const a = call.args;
  const what = el ? `${el.role} "${clip(el.name || el.tag, 60)}"` : a.id !== undefined ? `element [${a.id}]` : '';
  switch (call.name) {
    case 'click':
      return `Click ${what}`;
    case 'hover':
      return `Hover over ${what}`;
    case 'type': {
      const text = el && isSensitiveField(el) ? '••••••' : clip(String(a.text), 80);
      return `Type "${text}" into ${what}${a.submit ? ' and press Enter' : ''}`;
    }
    case 'select':
      return `Select "${a.value}" in ${what}`;
    case 'scroll':
      return what ? `Scroll to ${what}` : `Scroll ${a.direction}`;
    case 'key':
      return `Press ${a.combo}`;
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

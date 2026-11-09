import type { ActionTarget, ElementInfo, ToolCall } from '../types';

const SENSITIVE_AUTOCOMPLETE = /(current-password|new-password|one-time-code|cc-)/i;
const SENSITIVE_NAME = /(pass(word)?|pwd|card|ccnum|cc-?num|cvc|cvv|csc|security.?code|otp|one.?time)/i;
const FILE_EXT = /\.(zip|exe|dmg|pkg|msi|pdf|tar|gz|tgz|7z|rar|iso|apk|deb|rpm)(\?|#|$)/i;

export function isSensitiveField(e: ElementInfo): boolean {
  return (
    e.type === 'password' ||
    (!!e.autocomplete && SENSITIVE_AUTOCOMPLETE.test(e.autocomplete)) ||
    (!!e.fieldName && SENSITIVE_NAME.test(e.fieldName))
  );
}

function matchKeyword(label: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(label)) return kw;
  }
  return null;
}

const lastKey = (combo: unknown) => String(combo).split('+').pop()?.trim().toLowerCase();
const isEnter = (combo: unknown) => ['enter', 'return', 'numpadenter'].includes(lastKey(combo) ?? '');
const isSpace = (combo: unknown) => lastKey(combo) === 'space';
const NAV_KEYS = new Set(['tab', 'escape', 'esc', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown']);

/** A frame we could not read inside. Same-origin frames are opened and described as their contents. */
function isOpaqueFrame(e: ElementInfo): boolean {
  return e.tag === 'iframe' || e.tag === 'frame';
}

/** Buttons, links, and submit controls. Enter or Space activates these. A text field does not. */
export function isActivatingControl(e: ElementInfo): boolean {
  if (e.isSubmit) return true;
  if (e.role === 'button' || e.role === 'link' || e.role === 'menuitem') return true;
  if (e.tag === 'button' || e.tag === 'a' || e.tag === 'summary') return true;
  return e.tag === 'input' && ['submit', 'button', 'image', 'reset'].includes((e.type ?? '').toLowerCase());
}

/** Where typed characters go. A button, even one that is also an input, is not one of these. */
export function isTextEntry(e: ElementInfo): boolean {
  if (isActivatingControl(e)) return false;
  if (e.role === 'checkbox' || e.role === 'radio' || e.role === 'switch' || e.role === 'tab') return false;
  if (e.tag === 'textarea' || e.role === 'textbox' || e.role === 'searchbox') return true;
  if (e.tag === 'input') {
    const t = (e.type ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'file', 'hidden', 'range', 'color'].includes(t);
  }
  return false;
}

/** Tab, Escape, and arrows move through a field. Shift is allowed. Paste and other shortcuts are not. */
export function isNavigationKey(combo: unknown): boolean {
  const parts = String(combo).split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  return !!key && NAV_KEYS.has(key) && parts.every((m) => m === 'shift');
}

/**
 * After Tab inside a type call, more characters are safe only in an ordinary text field.
 * The original field was already approved; same id means focus did not move.
 */
export function focusAllowsTypedText(now: ElementInfo | null, startId: number | undefined): boolean {
  if (!now) return false;
  if (startId !== undefined && now.id === startId) return true;
  return isTextEntry(now) && !isSensitiveField(now) && !isOpaqueFrame(now);
}

/** After Tab, Enter is safe in a text field that will not submit a form or type a secret. */
export function focusAllowsEnter(now: ElementInfo | null, startId: number | undefined): boolean {
  if (!now) return false;
  if (startId !== undefined && now.id === startId) return true;
  return isTextEntry(now) && !now.inForm && !isSensitiveField(now) && !isOpaqueFrame(now);
}

function submitReason(call: ToolCall, pressesEnter: boolean): string {
  if (call.name === 'click') return 'Clicking a submit button';
  if (call.name === 'type' && call.args.submit !== true && !/[\r\n]/.test(String(call.args.text ?? ''))) return 'Typing activates a submit button';
  return pressesEnter || call.name === 'type' ? 'Pressing Enter on a submit button' : 'Pressing Space on a submit button';
}

export function classifyRisk(call: ToolCall, target: ActionTarget, keywords: string[]): { risky: boolean; reasons: string[]; hard: boolean } {
  const reasons: string[] = [];
  /** A mode or task grant never skips these: credentials, payment, keyword labels, form submits, and unread frames. */
  let hard = false;
  const e = target.element;
  if (e) {
    const text = String(call.args.text ?? '');
    // type clicks its target first whenever it has an id or coordinates (ChromeDriver.act).
    const typeClicks = call.name === 'type' && (call.args.id !== undefined || call.args.x !== undefined);
    const typesEnter = call.name === 'type' && (call.args.submit === true || /[\r\n]/.test(text));
    const pressesEnter = call.name === 'key' && isEnter(call.args.combo);
    const pressesSpace = call.name === 'key' && isSpace(call.args.combo);
    const sendsEnter = pressesEnter || typesEnter;
    // Keyword and submit gates apply when the action activates something that is not a text field.
    // A div, span, option, or checkbox labelled "Buy now" counts. An "Order number" text field does not.
    const activates = !isTextEntry(e) && (call.name === 'click' || typeClicks || sendsEnter || pressesSpace);
    if (call.name === 'type' && isSensitiveField(e)) {
      reasons.push('Typing into a password, payment or one-time-code field');
      hard = true;
    }
    if (call.name === 'key' && isSensitiveField(e) && !isNavigationKey(call.args.combo) && !pressesEnter) {
      reasons.push('Pressing a key in a password, payment or one-time-code field');
      hard = true;
    }
    if (sendsEnter && isSensitiveField(e)) {
      reasons.push('Pressing Enter in a password, payment or one-time-code field');
      hard = true;
    }
    // Enter inside a form submits it, including from an ordinary field such as an address.
    if (sendsEnter && e.inForm) {
      reasons.push('Pressing Enter inside a form');
      hard = true;
    }
    if (activates) {
      const kw = matchKeyword(e.name, keywords);
      if (kw) {
        reasons.push(`Label contains "${kw}"`);
        hard = true;
      }
    }
    if (activates && e.isSubmit) {
      reasons.push(submitReason(call, pressesEnter));
      hard = true;
    }
    if (isOpaqueFrame(e) && (call.name === 'click' || call.name === 'type' || call.name === 'key')) {
      reasons.push('Interacting with a frame the page cannot read');
      hard = true;
    }
    if (call.name === 'click' || typeClicks) {
      if (e.download || (e.href && FILE_EXT.test(e.href))) reasons.push('May download a file');
      if (e.type === 'file') reasons.push('Opens a file upload');
    }
  }
  if (call.args.risky === true) reasons.push('The model flagged this action as risky');
  return { risky: reasons.length > 0, reasons, hard };
}

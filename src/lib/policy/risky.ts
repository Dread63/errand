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
const isEnter = (combo: unknown) => ['enter', 'return'].includes(lastKey(combo) ?? '');
const isSpace = (combo: unknown) => lastKey(combo) === 'space';

export function classifyRisk(call: ToolCall, target: ActionTarget, keywords: string[]): { risky: boolean; reasons: string[]; hard: boolean } {
  const reasons: string[] = [];
  /** A mode or task grant never skips these: credentials, payment, keyword labels, and any form submit. */
  let hard = false;
  const e = target.element;
  if (e) {
    const typesEnter = call.args.submit === true || /[\r\n]/.test(String(call.args.text ?? ''));
    const pressesEnter = call.name === 'key' && isEnter(call.args.combo);
    const pressesSpace = call.name === 'key' && isSpace(call.args.combo);
    const activates = call.name === 'click' || pressesEnter || pressesSpace;
    if (call.name === 'type' && isSensitiveField(e)) {
      reasons.push('Typing into a password, payment or one-time-code field');
      hard = true;
    }
    // Enter inside a form submits it, including from an ordinary field such as an address.
    if (call.name === 'type' && typesEnter && e.inForm) {
      reasons.push('Pressing Enter inside a form');
      hard = true;
    }
    if (pressesEnter && e.inForm) {
      reasons.push('Pressing Enter inside a form');
      hard = true;
    }
    if (pressesEnter && isSensitiveField(e)) {
      reasons.push('Pressing Enter in a password, payment or one-time-code field');
      hard = true;
    }
    if (activates) {
      const kw = matchKeyword(e.name, keywords);
      if (kw) {
        reasons.push(`Label contains "${kw}"`);
        hard = true;
      }
    }
    // Click, Enter, and Space all activate a focused submit button.
    if (activates && e.isSubmit) {
      reasons.push(call.name === 'click' ? 'Clicking a submit button' : pressesEnter ? 'Pressing Enter on a submit button' : 'Pressing Space on a submit button');
      hard = true;
    }
    if (call.name === 'click') {
      if (e.download || (e.href && FILE_EXT.test(e.href))) reasons.push('May download a file');
      if (e.type === 'file') reasons.push('Opens a file upload');
    }
  }
  if (call.args.risky === true) reasons.push('The model flagged this action as risky');
  return { risky: reasons.length > 0, reasons, hard };
}

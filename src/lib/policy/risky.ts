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
  /** Reasons a task mode or task grant never skips: credentials, payment and checkout-style labels. */
  let hard = false;
  const e = target.element;
  if (e) {
    if (call.name === 'type' && isSensitiveField(e)) {
      reasons.push('Typing into a password, payment or one-time-code field');
      hard = true;
    }
    const typesEnter = call.args.submit === true || /[\r\n]/.test(String(call.args.text ?? ''));
    if (call.name === 'type' && typesEnter && e.inForm) reasons.push('Pressing Enter inside a form');
    const pressesEnter = call.name === 'key' && isEnter(call.args.combo);
    if (pressesEnter && e.inForm) reasons.push('Pressing Enter inside a form');
    if (pressesEnter && isSensitiveField(e)) {
      reasons.push('Pressing Enter in a password, payment or one-time-code field');
      hard = true;
    }
    // Enter and Space activate a focused button just as a click does.
    if (call.name === 'click' || pressesEnter || (call.name === 'key' && isSpace(call.args.combo))) {
      const kw = matchKeyword(e.name, keywords);
      if (kw) {
        reasons.push(`Label contains "${kw}"`);
        hard = true;
      }
    }
    if (call.name === 'click') {
      if (e.isSubmit) reasons.push('Clicking a submit button');
      if (e.download || (e.href && FILE_EXT.test(e.href))) reasons.push('May download a file');
      if (e.type === 'file') reasons.push('Opens a file upload');
    }
  }
  if (call.args.risky === true) reasons.push('The model flagged this action as risky');
  return { risky: reasons.length > 0, reasons, hard };
}

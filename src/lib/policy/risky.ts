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

const isEnter = (combo: unknown) => String(combo).split('+').pop()?.trim().toLowerCase() === 'enter';

export function classifyRisk(call: ToolCall, target: ActionTarget, keywords: string[]): { risky: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const e = target.element;
  if (e) {
    if (call.name === 'type' && isSensitiveField(e)) reasons.push('Typing into a password, payment or one-time-code field');
    const typesEnter = call.args.submit === true || /[\r\n]/.test(String(call.args.text ?? ''));
    if (call.name === 'type' && typesEnter && e.inForm) reasons.push('Pressing Enter inside a form');
    if (call.name === 'key' && isEnter(call.args.combo) && e.inForm) reasons.push('Pressing Enter inside a form');
    if (call.name === 'click') {
      if (e.isSubmit) reasons.push('Clicking a submit button');
      const kw = matchKeyword(e.name, keywords);
      if (kw) reasons.push(`Label contains "${kw}"`);
      if (e.download || (e.href && FILE_EXT.test(e.href))) reasons.push('May download a file');
      if (e.type === 'file') reasons.push('Opens a file upload');
    }
  }
  if (call.args.risky === true) reasons.push('The model flagged this action as risky');
  return { risky: reasons.length > 0, reasons };
}

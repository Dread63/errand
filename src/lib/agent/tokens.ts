import type { ChatMessage } from '../llm/types';

export const IMAGE_TOKENS = 1000;
export const TOOLS_OVERHEAD_TOKENS = 1500;

export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    chars += 16;
    if (m.role === 'assistant') {
      chars += (m.content ?? '').length;
      for (const tc of m.tool_calls ?? []) chars += tc.function.name.length + tc.function.arguments.length;
    } else if (typeof m.content === 'string') {
      chars += m.content.length;
    } else {
      for (const p of m.content) {
        if (p.type === 'text') chars += p.text.length;
        else images++;
      }
    }
  }
  return Math.ceil(chars / 4) + images * IMAGE_TOKENS;
}

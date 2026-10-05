import type { ContextMode, ElementInfo, Rect } from '../types';

export type ContentRequest =
  | { type: 'ping' }
  | { type: 'snapshot'; mode: ContextMode }
  | { type: 'resolve'; id: number; scroll: boolean }
  | { type: 'focused' }
  | { type: 'readText'; maxChars: number }
  | { type: 'select'; id: number; value: string }
  | { type: 'overlay'; op: 'active'; on: boolean }
  | { type: 'overlay'; op: 'move'; x: number; y: number }
  | { type: 'overlay'; op: 'click'; x: number; y: number }
  | { type: 'overlay'; op: 'hover'; rect: Rect | null }
  | { type: 'overlay'; op: 'highlight'; rect: Rect | null; label?: string };

export type ResolveResult = { ok: true; x: number; y: number; info: ElementInfo } | { ok: false; error: string };

export type ContentReply = { ok: true; value: unknown } | { ok: false; error: string };

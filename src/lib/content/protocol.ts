import type { ContextMode, ElementInfo, Rect } from '../types';

export type ContentRequest =
  | { type: 'ping' }
  | { type: 'snapshot'; mode: ContextMode }
  | { type: 'resolve'; id: number; scroll: boolean }
  | { type: 'focused' }
  /** Describes what is drawn at a viewport point (for coordinate actions). */
  | { type: 'pointInfo'; x: number; y: number }
  | { type: 'readText'; maxChars: number }
  | { type: 'select'; id: number; value: string }
  /** Suspend (on) or restore (off) other extensions' frames, which block the debugger. */
  | { type: 'guard'; on: boolean }
  | { type: 'overlay'; op: 'active'; on: boolean }
  | { type: 'overlay'; op: 'move'; x: number; y: number; label?: string }
  | { type: 'overlay'; op: 'click'; x: number; y: number }
  | { type: 'overlay'; op: 'hover'; rect: Rect | null }
  | { type: 'overlay'; op: 'highlight'; rect: Rect | null; label?: string };

export type ResolveResult =
  | { ok: true; x: number; y: number; info: ElementInfo; /** What a click at x/y would land on instead, e.g. an open menu. */ coveredBy?: ElementInfo }
  | { ok: false; error: string };

export type ContentReply = { ok: true; value: unknown } | { ok: false; error: string };

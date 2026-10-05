import type { StepTurn, Turn } from '../types';

export interface ActivityGroup {
  steps: StepTurn[];
  live: boolean;
  failures: number;
  durationMs?: number;
}

export type ChatItem =
  | { kind: 'user'; turn: Extract<Turn, { kind: 'user' }>; key: string }
  | { kind: 'assistant'; text: string; key: string }
  | { kind: 'activity'; group: ActivityGroup; key: string };

export function isFailed(s: StepTurn): boolean {
  return s.result.startsWith('Error') || s.result.startsWith('The user rejected');
}

function finish(steps: StepTurn[], live: boolean): ActivityGroup {
  const starts = steps.map((s) => s.startedAt).filter((x): x is number => x !== undefined);
  const ends = steps.map((s) => s.endedAt).filter((x): x is number => x !== undefined);
  const g: ActivityGroup = { steps, live, failures: steps.filter(isFailed).length };
  if (starts.length && ends.length) g.durationMs = Math.max(...ends) - Math.min(...starts);
  return g;
}

/** Folds consecutive step turns into activity groups; the trailing group is live while running. */
export function groupTurns(turns: Turn[], running: boolean): ChatItem[] {
  const out: ChatItem[] = [];
  let pending: StepTurn[] = [];
  let pendingKey = '';
  const flush = (live: boolean) => {
    if (!pending.length && !live) return;
    out.push({ kind: 'activity', group: finish(pending, live), key: `a-${pendingKey || out.length}` });
    pending = [];
    pendingKey = '';
  };
  turns.forEach((t, i) => {
    if (t.kind === 'step') {
      if (!pending.length) pendingKey = t.id;
      pending.push(t);
      return;
    }
    flush(false);
    if (t.kind === 'user') out.push({ kind: 'user', turn: t, key: `u-${i}` });
    else out.push({ kind: 'assistant', text: t.text, key: `r-${i}` });
  });
  const lastIsUserOrStep = turns.length > 0 && turns[turns.length - 1].kind !== 'assistant';
  flush(running && lastIsUserOrStep);
  return out;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

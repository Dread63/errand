import type { ApprovalMode } from '../types';

const MODES: readonly ApprovalMode[] = ['ask', 'auto', 'hands-off'];

export const APPROVAL_MODE_LABEL: Record<ApprovalMode, string> = {
  ask: 'Ask',
  auto: 'Auto',
  'hands-off': 'Hands-off',
};

export const APPROVAL_MODE_HINT: Record<ApprovalMode, string> = {
  ask: 'Ask before each risky action.',
  auto: 'Skip routine risky actions during this task. Passwords and payments still ask.',
  'hands-off': 'Also open new sites for this task only. Passwords and payments still ask. A one-line summary is shown when the task finishes.',
};

/** Missing or unrecognized values stay on Ask. */
export function resolveApprovalMode(value: unknown): ApprovalMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as ApprovalMode) : 'ask';
}

/**
 * Auto, Hands-off, and an ephemeral task grant skip routine risky prompts.
 * A hard gate (password, payment, or a risky-keyword label) always stays.
 */
export function skipsRoutineRisk(mode: ApprovalMode, taskGrant: boolean, hard: boolean): boolean {
  if (hard) return false;
  return taskGrant || mode === 'auto' || mode === 'hands-off';
}

/** Hands-off may read a new site for this task. That allow is not stored. */
export function skipsSitePrompt(mode: ApprovalMode): boolean {
  return mode === 'hands-off';
}

/** Hands-off still reports each finished task in one line. Other modes keep the model's text. */
export function taskSummary(mode: ApprovalMode, text: string): string {
  if (mode !== 'hands-off') return text;
  const line = text.replace(/\s+/g, ' ').trim();
  return line || 'Task complete.';
}

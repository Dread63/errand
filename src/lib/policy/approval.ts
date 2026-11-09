import type { ApprovalMode } from '../types';

const MODES: readonly ApprovalMode[] = ['ask', 'auto', 'hands-off'];

export const APPROVAL_MODE_LABEL: Record<ApprovalMode, string> = {
  ask: 'Ask',
  auto: 'Auto',
  'hands-off': 'Hands-off',
};

export const APPROVAL_MODE_HINT: Record<ApprovalMode, string> = {
  ask: 'Ask before risky actions. This choice applies only to the task you send.',
  auto: 'Skip routine actions such as downloads for this task. Passwords, payments, and form submits still ask.',
  'hands-off': 'Also open new sites for this task only. Passwords, payments, and form submits still ask. The task ends with one sentence.',
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

const SUMMARY_MAX = 160;

/** Hands-off reports every ending as one sentence. Other modes keep the model's text. */
export function taskSummary(mode: ApprovalMode, text: string): string {
  if (mode !== 'hands-off') return text;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 'Task complete.';
  const end = flat.search(/[.!?](?:\s|$)/);
  let line = end === -1 ? flat : flat.slice(0, end + 1);
  if (line.length > SUMMARY_MAX) line = `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
  return line;
}

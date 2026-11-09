import type { SiteDecision } from '../policy/sites';
import type { ActionTarget, ContextMode, Observation, TabInfo, ToolCall, Turn } from '../types';

export interface BrowserDriver {
  activeUrl(): Promise<string>;
  listTabs(): Promise<TabInfo[]>;
  observe(opts: { mode: ContextMode; screenshot: boolean }): Promise<Observation>;
  target(call: ToolCall): Promise<ActionTarget>;
  perform(call: ToolCall, target: ActionTarget, mode: ContextMode): Promise<string>;
  highlight(target: ActionTarget | null): Promise<void>;
  reattach(): Promise<void>;
}

export interface RiskyRequest {
  description: string;
  reasons: string[];
  reason: string;
  /** False for passwords, payments, and form submits. Those prompts have no task-grant button. */
  grantable: boolean;
}

/** `task` approves the action on screen and skips later routine prompts until the task ends. */
export type RiskyDecision = 'approve' | 'reject' | 'task';

export interface UserGate {
  site(origin: string): Promise<SiteDecision>;
  risky(req: RiskyRequest): Promise<RiskyDecision>;
  ask(question: string): Promise<string>;
  retry(message: string): Promise<boolean>;
}

export interface AgentHooks {
  onTurns(turns: Turn[]): void;
  onDelta(text: string): void;
  onReasoning?(text: string): void;
}

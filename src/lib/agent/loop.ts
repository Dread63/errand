import { DetachedError, TaskEndedError, ToolError } from '../errors';
import type { LlmClient } from '../llm/client';
import type { ChatMessage, ChatResult } from '../llm/types';
import { classifyRisk, isSensitiveField } from '../policy/risky';
import type { SitePolicy } from '../policy/sites';
import type { ActionTarget, ObservationRecord, Profile, Settings, StepTurn, ToolCall, Turn } from '../types';
import { logTiming, timed } from '../timing';
import { originOf } from '../url';
import { errMsg } from '../util';
import { buildMessages } from './context';
import type { AgentHooks, BrowserDriver, UserGate } from './ports';
import { renderSnapshot } from './render';
import { estimateTokens } from './tokens';
import { describeCall, toolSchemas, validateCall } from './tools';

export interface AgentDeps {
  llm: LlmClient;
  driver: BrowserDriver;
  gate: UserGate;
  sites: SitePolicy;
  profile: Profile;
  settings: Settings;
  hooks: AgentHooks;
  signal: AbortSignal;
  newId?: () => string;
  /** Passed to the model as a stable per-conversation session id. */
  sessionId?: string;
  /** Clock for step timestamps; defaults to Date.now. */
  now?: () => number;
}

const MAX_THINKING = 4000;

interface ModelReply {
  result: ChatResult;
  thinking: string;
  thinkingMs: number;
}

/** Ends the task with a message for the user. */
class StopTask extends Error {}

const NUDGE =
  'You replied without calling a tool, so nothing happened. If the task is finished, call done with your answer; otherwise call the next tool.';

async function ensureSite(d: AgentDeps, origin: string): Promise<boolean> {
  const status = await d.sites.check(origin);
  if (status === 'allowed') return true;
  if (status === 'denied') return false;
  const decision = await d.gate.site(origin);
  await d.sites.apply(origin, decision);
  return decision !== 'deny';
}

/** Runs fn; on DetachedError asks the user to Retry, reattaches and runs fn again. */
async function guarded<T>(d: AgentDeps, fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof DetachedError)) throw e;
      const again = await d.gate.retry(`${e.message} Press Retry to try again.`);
      if (!again) throw new StopTask('Stopped: the agent lost control of the tab.');
      await d.driver.reattach().catch(() => {});
    }
  }
}

async function observe(d: AgentDeps): Promise<ObservationRecord> {
  const url = await d.driver.activeUrl();
  const origin = originOf(url);
  if (!(await ensureSite(d, origin))) {
    const tabs = (await d.driver.listTabs())
      .map((t) => `${t.active ? '*' : ' '} ${t.index}: ${t.title} — ${t.url}`)
      .join('\n');
    return {
      url,
      title: '',
      summary: `${url} (not permitted)`,
      detail: `URL: ${url}\nThe user has not allowed the agent on ${origin}. You cannot read or act on this page. Navigate elsewhere, switch tabs, or call done.`,
      tabs,
    };
  }
  const mode = d.profile.contextMode;
  let o;
  try {
    o = await d.driver.observe({ mode, screenshot: d.profile.supportsVision });
  } catch (e) {
    if (!(e instanceof ToolError)) throw e;
    return {
      url,
      title: '',
      summary: `${url} (could not be read)`,
      detail: `URL: ${url}\nThis page could not be read: ${e.message} Wait and try again, navigate elsewhere, or call done.`,
      tabs: '',
    };
  }
  const r = renderSnapshot(o.snapshot, o.tabs, mode, !!o.screenshot);
  const record: ObservationRecord = { url: o.snapshot.url, title: o.snapshot.title, summary: r.summary, detail: r.detail, tabs: r.tabs };
  if (o.screenshot) record.screenshot = o.screenshot;
  return record;
}

async function callModel(d: AgentDeps, messages: ChatMessage[], now: () => number): Promise<ModelReply> {
  for (;;) {
    let thinking = '';
    let firstAt = 0;
    let lastAt = 0;
    try {
      const result = await d.llm.chat({
        messages,
        tools: toolSchemas(d.profile.supportsVision),
        signal: d.signal,
        onDelta: (t) => d.hooks.onDelta(t),
        onReasoning: (t) => {
          const at = now();
          if (!thinking) firstAt = at;
          lastAt = at;
          thinking += t;
          d.hooks.onReasoning?.(t);
        },
        ...(d.sessionId ? { sessionId: d.sessionId } : {}),
      });
      const trimmed = thinking.trim();
      return {
        result,
        thinking: trimmed.length > MAX_THINKING ? `…${trimmed.slice(-MAX_THINKING)}` : trimmed,
        thinkingMs: trimmed ? Math.max(1, lastAt - firstAt) : 0,
      };
    } catch (e) {
      if (d.signal.aborted) throw e;
      const msg = errMsg(e);
      if (!(await d.gate.retry(`Model request failed: ${msg}`))) throw new StopTask(`Stopped: the model request failed (${msg}).`);
    }
  }
}

async function act(d: AgentDeps, call: ToolCall, step: StepTurn): Promise<string> {
  let target: ActionTarget;
  try {
    target = await d.driver.target(call);
  } catch (e) {
    if (e instanceof ToolError) return `Error: ${e.message}`;
    throw e;
  }
  step.label = describeCall(call, target);
  if (!(await ensureSite(d, target.origin))) return `Error: the user denied access to ${target.origin}.`;
  const risk = classifyRisk(call, target, d.settings.riskyKeywords);
  if (risk.risky) {
    step.risky = true;
    await d.driver.highlight(target).catch(() => {});
    const ok = await d.gate.risky({
      description: step.label,
      reasons: risk.reasons,
      reason: typeof call.args.reason === 'string' ? call.args.reason : step.reasoning,
    });
    await d.driver.highlight(null).catch(() => {});
    if (!ok) return 'The user rejected this action. Do not retry it; choose a different approach or call done.';
  }
  let result: string;
  try {
    result = await d.driver.perform(call, target, d.profile.contextMode);
  } catch (e) {
    if (e instanceof ToolError) return `Error: ${e.message}`;
    throw e;
  }
  if (call.name === 'type' && target.element && isSensitiveField(target.element)) {
    step.call = { ...call, args: { ...call.args, text: '••••••' } };
  }
  return result;
}

export async function runAgent(initial: Turn[], d: AgentDeps): Promise<Turn[]> {
  const turns = [...initial];
  const push = (t: Turn) => {
    if (t.kind === 'step' && t.endedAt === undefined) t.endedAt = now();
    turns.push(t);
    d.hooks.onTurns([...turns]);
  };
  const newId = d.newId ?? (() => crypto.randomUUID());
  const now = d.now ?? Date.now;
  const limit = d.settings.stepLimit;
  let malformed = 0;
  let calibration = 1;
  let acted = false;
  /** Set after a mid-task plain-text reply: shown to the model once on the next request. */
  let nudge: ChatMessage[] | null = null;
  let nudged = false;

  try {
    for (let n = 0; n < limit; n++) {
      if (d.signal.aborted) throw new StopTask('Stopped.');
      const stepStart = performance.now();
      const startedAt = now();
      const observation = await timed(`step ${n + 1}: observe (total)`, () => guarded(d, () => observe(d)));
      const messages = buildMessages({ profile: d.profile, stepLimit: limit, turns, current: observation, calibration });
      if (nudge) messages.push(...nudge);
      nudge = null;
      const reply = await timed(`step ${n + 1}: model (total, ~${estimateTokens(messages)} prompt tokens est.)`, () => callModel(d, messages, now));
      const result = reply.result;
      logTiming(`step ${n + 1}: until model reply`, performance.now() - stepStart);
      if (result.usage?.promptTokens) {
        calibration = Math.min(3, Math.max(0.5, result.usage.promptTokens / estimateTokens(messages)));
      }

      const raw = result.toolCalls[0];
      if (!raw) {
        const text = result.content.trim();
        // Mid-task, a reply without a tool call is usually narration ("Let me check…"), not the
        // answer. Ask once for a tool call; a second plain reply is taken as the final answer.
        if (acted && !nudged && n + 1 < limit) {
          nudged = true;
          nudge = [
            { role: 'assistant', content: text || '(empty reply)' },
            { role: 'user', content: NUDGE },
          ];
          continue;
        }
        push({ kind: 'assistant', text: text || '(The model returned an empty reply.)' });
        return turns;
      }
      nudged = false;

      const id = newId();
      const step: StepTurn = {
        kind: 'step',
        id,
        label: describeCall(raw),
        reasoning: result.content.trim(),
        call: { ...raw, id: raw.id || id },
        result: '',
        risky: false,
        observation,
        startedAt,
        ...(reply.thinking ? { thinking: reply.thinking, thinkingMs: reply.thinkingMs } : {}),
      };

      let call: ToolCall;
      try {
        if (raw.error) throw new ToolError(raw.error);
        call = validateCall(step.call, d.profile.supportsVision);
        step.call = call;
        step.label = describeCall(call);
        malformed = 0;
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        malformed++;
        step.label = 'Invalid tool call';
        step.result = `Error: ${e.message}`;
        push(step);
        if (malformed > 2) {
          const again = await d.gate.retry(
            `The model produced ${malformed} invalid tool calls in a row. Last output: ${raw.name} ${JSON.stringify(raw.args)} ${raw.error ?? e.message}`,
          );
          if (!again) throw new StopTask('Stopped after repeated invalid tool calls.');
          malformed = 0;
        }
        continue;
      }

      if (call.name === 'done') {
        step.label = 'Finished';
        step.result = 'Task complete.';
        push(step);
        push({ kind: 'assistant', text: String(call.args.summary) });
        return turns;
      }
      if (call.name === 'ask_user') {
        const answer = await d.gate.ask(String(call.args.question));
        step.result = `User answered: ${answer}`;
        push(step);
        continue;
      }

      step.result = await timed(`step ${n + 1}: act ${call.name}`, () => guarded(d, () => act(d, call, step)));
      acted = true;
      push(step);
    }
    push({ kind: 'assistant', text: `Stopped: reached the step limit of ${limit} steps.` });
  } catch (e) {
    if (e instanceof StopTask || e instanceof TaskEndedError) push({ kind: 'assistant', text: e.message });
    else if (d.signal.aborted) push({ kind: 'assistant', text: 'Stopped.' });
    else push({ kind: 'assistant', text: `Error: ${errMsg(e)}` });
  }
  return turns;
}

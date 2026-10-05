import type { ChatMessage, ContentPart } from '../llm/types';
import type { Attachment, ObservationRecord, Profile, StepTurn, Turn } from '../types';
import { clip } from '../util';
import { MODE_LIMITS, type ModeLimits } from './modes';
import { systemPrompt } from './prompts';
import { estimateTokens, TOOLS_OVERHEAD_TOKENS } from './tokens';

export interface ContextInput {
  profile: Profile;
  stepLimit: number;
  turns: Turn[];
  current: ObservationRecord | null;
  /** Ratio of real prompt tokens to our estimate, from the last API `usage`. */
  calibration?: number;
}

interface StepPlan {
  full: boolean;
  screenshot: boolean;
  shortResult: boolean;
  dropped: boolean;
}

export function contextBudget(p: Profile): number {
  return p.contextWindow - Math.min(4096, Math.floor(p.contextWindow * 0.2)) - TOOLS_OVERHEAD_TOKENS;
}

function userMessage(text: string, attachments: Attachment[], attChars: number, vision: boolean): ChatMessage {
  let body = text;
  for (const a of attachments) {
    if (a.kind === 'text') body += `\n\n<attachment name="${a.name}">\n${clip(a.text ?? '', attChars)}\n</attachment>`;
  }
  const images = vision ? attachments.filter((a) => a.kind === 'image' && a.dataUrl) : [];
  if (!images.length) return { role: 'user', content: body };
  const parts: ContentPart[] = [{ type: 'text', text: body }];
  for (const a of images) parts.push({ type: 'image_url', image_url: { url: a.dataUrl! } });
  return { role: 'user', content: parts };
}

function observationMessage(o: ObservationRecord, full: boolean, shot: boolean): ChatMessage {
  const tabs = full && o.tabs ? `Agent tabs (* = active):\n${o.tabs}\n\n` : '';
  const body = full ? o.detail : `Earlier page: ${o.summary}`;
  const text = `${full ? 'Page state:' : 'Earlier page state:'}\n<page_content untrusted="true">\n${tabs}${body}\n</page_content>`;
  if (!shot || !o.screenshot) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: o.screenshot } },
    ],
  };
}

function render(input: ContextInput, plans: Map<number, StepPlan>, limits: ModeLimits, currentShot: boolean): ChatMessage[] {
  const { profile, turns } = input;
  const out: ChatMessage[] = [{ role: 'system', content: systemPrompt(profile.contextMode, input.stepLimit) }];
  const textAttachments = turns.reduce((n, t) => n + (t.kind === 'user' ? t.attachments.filter((a) => a.kind === 'text').length : 0), 0);
  const attChars = limits.attachmentChars(profile, textAttachments);
  let dropped = 0;
  const flushDropped = () => {
    if (!dropped) return;
    out.push({ role: 'user', content: `[${dropped} earlier step(s) omitted to fit the context window]` });
    dropped = 0;
  };
  turns.forEach((t, i) => {
    if (t.kind === 'step' && plans.get(i)!.dropped) {
      dropped++;
      return;
    }
    flushDropped();
    if (t.kind === 'user') {
      out.push(userMessage(t.text, t.attachments, attChars, profile.supportsVision));
    } else if (t.kind === 'assistant') {
      out.push({ role: 'assistant', content: t.text });
    } else {
      const p = plans.get(i)!;
      if (t.observation) out.push(observationMessage(t.observation, p.full, p.screenshot));
      out.push({
        role: 'assistant',
        content: t.reasoning || null,
        tool_calls: [
          { id: t.call.id, type: 'function', function: { name: t.call.name || 'invalid', arguments: JSON.stringify(t.call.args) } },
        ],
      });
      out.push({ role: 'tool', tool_call_id: t.call.id, content: p.shortResult ? clip(t.result, 500) : t.result });
    }
  });
  flushDropped();
  if (input.current) out.push(observationMessage(input.current, true, currentShot));
  return out;
}

const DEGRADE: Array<(p: StepPlan) => boolean> = [
  (p) => {
    if (!p.full) return false;
    p.full = false;
    return true;
  },
  (p) => {
    if (!p.screenshot) return false;
    p.screenshot = false;
    return true;
  },
  (p) => {
    if (p.shortResult) return false;
    p.shortResult = true;
    return true;
  },
  (p) => {
    if (p.dropped) return false;
    p.dropped = true;
    return true;
  },
];

export function buildMessages(input: ContextInput): ChatMessage[] {
  const { profile, turns } = input;
  const limits = MODE_LIMITS[profile.contextMode];
  const stepIdx = turns.flatMap((t, i) => (t.kind === 'step' ? [i] : []));

  let shots = profile.supportsVision ? limits.screenshots(profile) : 0;
  const currentShot = !!input.current?.screenshot && shots > 0;
  if (currentShot) shots--;

  const plans = new Map<number, StepPlan>();
  for (let k = stepIdx.length - 1, rank = 0; k >= 0; k--, rank++) {
    const t = turns[stepIdx[k]] as StepTurn;
    const shot = !!t.observation?.screenshot && shots > 0;
    if (shot) shots--;
    plans.set(stepIdx[k], { full: rank < limits.fullObservations, screenshot: shot, shortResult: false, dropped: false });
  }

  const budget = contextBudget(profile);
  const cal = input.calibration ?? 1;
  let messages = render(input, plans, limits, currentShot);
  const degradable = stepIdx.slice(0, -1); // never degrade the most recent step
  for (const degrade of DEGRADE) {
    for (const i of degradable) {
      if (estimateTokens(messages) * cal <= budget) return messages;
      if (degrade(plans.get(i)!)) messages = render(input, plans, limits, currentShot);
    }
  }
  return messages;
}

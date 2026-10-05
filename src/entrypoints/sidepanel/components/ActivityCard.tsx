import { useEffect, useState } from 'react';
import type { StepTurn } from '@/lib/types';
import { type ActivityGroup, formatDuration, isFailed } from '@/lib/ui/activity';
import { IconCheck, IconChevronDown, IconChevronRight, IconSparkle, IconSpinner, IconWarning, IconX } from '@/lib/ui/icons';

function ThinkingRow({ text, ms }: { text: string; ms?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <button className="act-row think" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      <span className="act-ic"><IconSparkle size={13} /></span>
      <span className="act-main">
        <span className="muted">{ms ? `Thought for ${formatDuration(ms)}` : 'Thought'}</span>
        <span className={open ? 'think-full' : 'think-preview'}>{text}</span>
      </span>
    </button>
  );
}

function StepRow({ step }: { step: StepTurn }) {
  const [open, setOpen] = useState(false);
  const failed = isFailed(step);
  const shot = step.observation?.screenshot;
  const thought = step.thinking || step.reasoning;
  return (
    <>
      {thought && <ThinkingRow text={thought} ms={step.thinkingMs} />}
      <button className={`act-row${open ? ' open' : ''}${failed ? ' failed' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`act-ic ${failed ? 'bad' : 'ok'}`}>{failed ? <IconX size={13} /> : <IconCheck size={13} />}</span>
        <span className="act-label">{step.label}</span>
        {step.risky && <span className="badge">approval</span>}
        {shot && !open && <img className="thumb" src={shot} alt="" />}
      </button>
      {open && (
        <div className="act-detail">
          {shot && <img className="shot" src={shot} alt="Page before this step" />}
          <pre className="result">{step.result}</pre>
        </div>
      )}
    </>
  );
}

interface Props {
  group: ActivityGroup;
  streaming: string;
  reasoning: string;
}

export function ActivityCard({ group, streaming, reasoning }: Props) {
  const [open, setOpen] = useState(group.live);
  useEffect(() => {
    setOpen(group.live);
  }, [group.live]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!group.live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [group.live]);

  const n = group.steps.length;
  const firstStart = group.steps[0]?.startedAt;
  const elapsed = group.live ? (firstStart ? now - firstStart : undefined) : group.durationMs;
  const title = group.live ? `Working · step ${n + 1}` : `Worked through ${n} step${n === 1 ? '' : 's'}`;

  return (
    <div className={`act${group.live ? ' live' : ''}`}>
      <button className="act-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <span className={group.live ? 'shimmer act-title' : 'act-title'}>{title}</span>
        {group.failures > 0 && (
          <span className="act-fail"><IconWarning size={12} /> {group.failures}</span>
        )}
        {elapsed !== undefined && <span className="muted act-time">{formatDuration(elapsed)}</span>}
      </button>
      {open && (
        <div className="act-body">
          {group.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
          {group.live && (
            <div className="act-row live-row" data-testid="thinking">
              <span className="act-ic"><IconSpinner size={13} /></span>
              <span className="act-main">
                {streaming ? (
                  <span className="think-preview">{streaming.slice(-400)}</span>
                ) : reasoning ? (
                  <>
                    <span className="shimmer">Thinking…</span>
                    <span className="think-preview">{reasoning.slice(-400)}</span>
                  </>
                ) : (
                  <span className="shimmer">Working…</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

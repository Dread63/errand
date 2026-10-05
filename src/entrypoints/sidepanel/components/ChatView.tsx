import { useEffect, useRef } from 'react';
import type { Turn } from '@/lib/types';
import { StepCard } from './StepCard';

export function ChatView({ turns, streaming, running }: { turns: Turn[]; streaming: string; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, streaming, running]);

  return (
    <div className="chat">
      {turns.length === 0 && (
        <p className="empty">Describe a task and I'll do it in this tab. I'll ask before using a new site or doing anything risky.</p>
      )}
      {turns.map((t, i) => {
        if (t.kind === 'step') return <StepCard key={t.id} step={t} />;
        if (t.kind === 'assistant') return <div key={i} className="msg assistant">{t.text}</div>;
        return (
          <div key={i} className="msg user">
            {t.text}
            {t.attachments.length > 0 && <div className="att">{t.attachments.map((a) => a.name).join(', ')}</div>}
          </div>
        );
      })}
      {running && <div className="msg thinking">{streaming ? streaming.slice(-400) : 'Working…'}</div>}
      <div ref={end} />
    </div>
  );
}

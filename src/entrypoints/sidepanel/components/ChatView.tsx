import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Turn } from '@/lib/types';
import { groupTurns } from '@/lib/ui/activity';
import { IconFile } from '@/lib/ui/icons';
import { ActivityCard } from './ActivityCard';
import { Markdown } from './Markdown';

interface Props {
  turns: Turn[];
  streaming: string;
  reasoning: string;
  running: boolean;
}

export function ChatView({ turns, streaming, reasoning, running }: Props) {
  const items = useMemo(() => groupTurns(turns, running), [turns, running]);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = box.current!;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (pinned.current) box.current!.scrollTop = box.current!.scrollHeight;
  }, [items, streaming, reasoning]);

  return (
    <div className="chat" ref={box}>
      {items.length === 0 && (
        <div className="empty">
          <div className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4.5 3.2c-.6-.3-1.3.3-1.1.9l5.3 15.6c.2.7 1.2.7 1.4 0l1.9-5.6c.1-.3.3-.5.6-.6l5.6-1.9c.7-.2.7-1.2 0-1.4z" fill="#fff" /></svg>
          </div>
          <h2>What should I do in this tab?</h2>
          <p>I'll ask before using a new site or doing anything risky.</p>
        </div>
      )}
      {items.map((it) => {
        if (it.kind === 'activity') return <ActivityCard key={it.key} group={it.group} streaming={streaming} reasoning={reasoning} />;
        if (it.kind === 'assistant') return <Markdown key={it.key} text={it.text} />;
        return (
          <div key={it.key} className="user-msg">
            {it.turn.attachments.length > 0 && (
              <div className="user-atts">
                {it.turn.attachments.map((a, i) =>
                  a.kind === 'image' && a.dataUrl ? (
                    <img key={i} src={a.dataUrl} alt={a.name} />
                  ) : (
                    <span key={i} className="user-file"><IconFile size={13} /> {a.name}</span>
                  ),
                )}
              </div>
            )}
            <div className="bubble">{it.turn.text}</div>
          </div>
        );
      })}
    </div>
  );
}

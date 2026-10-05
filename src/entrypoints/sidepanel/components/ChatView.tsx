import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Turn } from '@/lib/types';
import { groupTurns } from '@/lib/ui/activity';
import { IconFile, Logo } from '@/lib/ui/icons';
import { ActivityCard } from './ActivityCard';
import { Markdown } from './Markdown';

interface Props {
  turns: Turn[];
  streaming: string;
  reasoning: string;
  running: boolean;
  /** False until the user has set up at least one provider. */
  connected: boolean;
}

export function ChatView({ turns, streaming, reasoning, running, connected }: Props) {
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
      {items.length === 0 &&
        (connected ? (
          <div className="empty">
            <Logo size={48} />
            <h2>What should I do in this tab?</h2>
            <p>I'll ask before using a new site or doing anything risky.</p>
          </div>
        ) : (
          <div className="empty">
            <Logo size={48} />
            <h2>Connect a model to get started</h2>
            <p>Errand works with any OpenAI-compatible API: OpenAI, OpenRouter, Ollama, LM Studio and more.</p>
            <button className="btn primary" onClick={() => chrome.runtime.openOptionsPage()}>Open Settings</button>
          </div>
        ))}
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

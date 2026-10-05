import { useCallback, useEffect, useMemo, useState } from 'react';
import { HistoryStore } from '@/lib/storage/history';
import { chromeKV } from '@/lib/storage/kv';
import type { Conversation, ConversationMeta } from '@/lib/types';
import { IconX } from '@/lib/ui/icons';

function relative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function HistoryList({ onOpen }: { onOpen: (c: Conversation) => void }) {
  const store = useMemo(() => new HistoryStore(chromeKV()), []);
  const [items, setItems] = useState<ConversationMeta[]>([]);
  const refresh = useCallback(async () => setItems(await store.list()), [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!items.length) return <p className="empty-note">No saved chats yet.</p>;
  return (
    <ul className="history">
      {items.map((m) => (
        <li key={m.id}>
          <button
            className="history-open"
            onClick={async () => {
              const c = await store.get(m.id);
              if (c) onOpen(c);
            }}
          >
            <span className="history-title">{m.title || 'Untitled'}</span>
            <time title={new Date(m.updatedAt).toLocaleString()}>{relative(m.updatedAt)}</time>
          </button>
          <button
            className="icon-btn sm"
            aria-label={`Delete ${m.title}`}
            title="Delete"
            onClick={async () => {
              await store.remove(m.id);
              await refresh();
            }}
          >
            <IconX size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

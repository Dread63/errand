import { useCallback, useEffect, useMemo, useState } from 'react';
import { HistoryStore } from '@/lib/storage/history';
import { chromeKV } from '@/lib/storage/kv';
import type { Conversation, ConversationMeta } from '@/lib/types';

export function HistoryList({ onOpen }: { onOpen: (c: Conversation) => void }) {
  const store = useMemo(() => new HistoryStore(chromeKV()), []);
  const [items, setItems] = useState<ConversationMeta[]>([]);
  const refresh = useCallback(async () => setItems(await store.list()), [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!items.length) return <p className="empty">No saved chats yet.</p>;
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
            <span>{m.title || 'Untitled'}</span>
            <time>{new Date(m.updatedAt).toLocaleString()}</time>
          </button>
          <button
            aria-label={`Delete ${m.title}`}
            onClick={async () => {
              await store.remove(m.id);
              await refresh();
            }}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

import type { Conversation, ConversationMeta, Turn } from '../types';
import type { KV } from './kv';

const INDEX = 'conv:index';
const key = (id: string) => `conv:${id}`;

export function stripScreenshots(turns: Turn[]): Turn[] {
  return turns.map((t) => {
    if (t.kind !== 'step' || !t.observation?.screenshot) return t;
    const { screenshot: _drop, ...observation } = t.observation;
    return { ...t, observation };
  });
}

export class HistoryStore {
  constructor(private kv: KV) {}

  async list(): Promise<ConversationMeta[]> {
    const all = (await this.kv.get<ConversationMeta[]>(INDEX)) ?? [];
    return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Conversation | undefined> {
    return this.kv.get<Conversation>(key(id));
  }

  async save(c: Conversation): Promise<void> {
    await this.kv.set(key(c.id), { ...c, turns: stripScreenshots(c.turns) });
    const index = (await this.list()).filter((m) => m.id !== c.id);
    index.push({ id: c.id, title: c.title, updatedAt: c.updatedAt });
    await this.kv.set(INDEX, index);
  }

  async remove(id: string): Promise<void> {
    await this.kv.remove(key(id));
    await this.kv.set(INDEX, (await this.list()).filter((m) => m.id !== id));
  }
}

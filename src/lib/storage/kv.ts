export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      const v = m.get(key);
      return v === undefined ? undefined : (structuredClone(v) as T);
    },
    async set(key, value) {
      m.set(key, structuredClone(value));
    },
    async remove(key) {
      m.delete(key);
    },
  };
}

export function chromeKV(area: chrome.storage.StorageArea = chrome.storage.local): KV {
  return {
    async get<T>(key: string) {
      const r = await area.get(key);
      return r[key] as T | undefined;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

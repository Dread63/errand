import { useCallback, useEffect, useMemo, useState } from 'react';
import { chromeKV } from '../storage/kv';
import { ModelCatalog } from '../storage/models';
import type { Profile } from '../types';
import type { CatalogEntry } from './models';

export function useModelCatalog(profiles: Profile[]) {
  const store = useMemo(() => new ModelCatalog(chromeKV()), []);
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  useEffect(() => {
    void store.all().then(setCatalog);
  }, [store]);

  const refreshOne = useCallback(
    async (p: Profile, force: boolean) => {
      setRefreshing((s) => new Set(s).add(p.id));
      const entry = await store.refresh(p, { force });
      setCatalog((c) => ({ ...c, [p.id]: entry }));
      setRefreshing((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    },
    [store],
  );

  const refreshAll = useCallback(
    (force = false) => {
      for (const p of profiles) void refreshOne(p, force);
    },
    [profiles, refreshOne],
  );

  return { catalog, refreshAll, refreshOne, refreshing };
}

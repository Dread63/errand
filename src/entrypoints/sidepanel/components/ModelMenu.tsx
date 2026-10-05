import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '@/lib/types';
import { IconCheck, IconChevronDown, IconRefresh, IconSettings, IconWarning } from '@/lib/ui/icons';
import { type CatalogEntry, menuGroups, prettyModel, supportsVisionFor } from '@/lib/ui/models';

interface Props {
  profiles: Profile[];
  active: Profile | null;
  catalog: Record<string, CatalogEntry>;
  refreshing: Set<string>;
  disabled: boolean;
  onOpen(): void;
  onRefresh(p: Profile): void;
  onSelect(profileId: string, model: string): void;
}

export function ModelMenu({ profiles, active, catalog, refreshing, disabled, onOpen, onRefresh, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => menuGroups(profiles, catalog, query), [profiles, catalog, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.models.map((m) => ({ profileId: g.profileId, model: m }))), [groups]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => setCursor(0), [query]);

  const choose = (profileId: string, model: string) => {
    onSelect(profileId, model);
    setOpen(false);
    setQuery('');
  };

  let idx = -1;
  return (
    <div className="mm" ref={root}>
      <button
        className={`pill${open ? ' on' : ''}`}
        aria-label="Model"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={active ? `${active.name} · ${active.model}` : 'Choose a model'}
        disabled={disabled}
        onClick={() => {
          if (!open) onOpen();
          setOpen((o) => !o);
        }}
      >
        {prettyModel(active?.model ?? '')} <IconChevronDown size={12} />
      </button>
      {open && (
        <div className="mm-pop" role="listbox" aria-label="Models">
          <input
            className="mm-search"
            placeholder="Search models…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(flat.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter' && flat[cursor]) {
                choose(flat[cursor].profileId, flat[cursor].model);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          <div className="mm-list">
            {groups.map((g) => {
              const p = profiles.find((x) => x.id === g.profileId)!;
              return (
                <div key={g.profileId}>
                  <div className="mm-group">
                    <span>{g.name}</span>
                    <button className="icon-btn sm" aria-label={`Refresh ${g.name}`} title="Refresh models" onClick={() => onRefresh(p)}>
                      <IconRefresh size={12} />
                    </button>
                  </div>
                  {g.models.map((m) => {
                    idx++;
                    const selected = active?.id === g.profileId && active.model === m;
                    return (
                      <button
                        key={m}
                        role="option"
                        aria-selected={selected}
                        className={`mm-opt${idx === cursor ? ' hot' : ''}${selected ? ' sel' : ''}`}
                        onClick={() => choose(g.profileId, m)}
                      >
                        <span className="mm-name">{m}</span>
                        {supportsVisionFor(p, m) && <span className="tag">vision</span>}
                        {selected && <IconCheck size={14} />}
                      </button>
                    );
                  })}
                  {refreshing.has(g.profileId) && g.models.length === 0 && <div className="mm-note muted">Loading…</div>}
                  {g.error && (
                    <div className="mm-note warn"><IconWarning size={12} /> Couldn't reach {g.name} — showing last known models</div>
                  )}
                </div>
              );
            })}
            {groups.length === 0 && <div className="mm-note muted">No models match “{query}”.</div>}
          </div>
          <button className="mm-foot" onClick={() => chrome.runtime.openOptionsPage()}>
            <IconSettings size={14} /> Manage providers…
          </button>
        </div>
      )}
    </div>
  );
}

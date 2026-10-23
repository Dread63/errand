import { useEffect, useMemo, useState } from 'react';
import { chromeKV } from '@/lib/storage/kv';
import { BypassStore } from '@/lib/storage/sites';
import { IconGlobe } from '@/lib/ui/icons';
import { targetTabId } from '@/lib/ui/targetTab';
import { originOf } from '@/lib/url';

/** Shows the agent's tab group, and the per-site auto-approve toggle for the page you are looking at. */
export function TabChip({ groupId }: { groupId: number | null }) {
  const [group, setGroup] = useState<{ count: number; title: string; icon?: string } | null>(null);
  const [site, setSite] = useState<{ origin: string; host: string } | null>(null);
  const [bypass, setBypass] = useState(false);
  const store = useMemo(() => new BypassStore(chromeKV()), []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (groupId !== null) {
        const tabs = await chrome.tabs.query({ groupId }).catch(() => []);
        const active = tabs.find((t) => t.active) ?? tabs[0];
        if (alive) setGroup(tabs.length ? { count: tabs.length, title: active?.title || active?.url || '', icon: active?.favIconUrl } : null);
      }
      const id = await targetTabId();
      const t = id === undefined ? null : await chrome.tabs.get(id).catch(() => null);
      const origin = t?.url ? originOf(t.url) : '';
      if (!alive) return;
      if (/^https?:/.test(origin)) {
        setSite({ origin, host: new URL(origin).host });
        setBypass((await store.origins()).includes(origin));
      } else setSite(null);
    };
    void load();
    const reload = () => void load();
    chrome.tabs.onActivated.addListener(reload);
    chrome.tabs.onUpdated.addListener(reload);
    chrome.tabs.onRemoved.addListener(reload);
    chrome.storage.onChanged.addListener(reload);
    return () => {
      alive = false;
      chrome.tabs.onActivated.removeListener(reload);
      chrome.tabs.onUpdated.removeListener(reload);
      chrome.tabs.onRemoved.removeListener(reload);
      chrome.storage.onChanged.removeListener(reload);
    };
  }, [groupId, store]);

  return (
    <>
      {group && (
        <div className="tabchip" title={group.title}>
          {group.icon ? <img src={group.icon} alt="" /> : <IconGlobe size={12} />}
          <span>
            Errand group · {group.count} {group.count === 1 ? 'tab' : 'tabs'}
          </span>
        </div>
      )}
      {site && (
        <label className={`bypass${bypass ? ' on' : ''}`} title="Skip approval for routine risky actions on this site, in any tab. Passwords, payment and checkout buttons still ask. Unchecking removes it from your saved sites in Settings.">
          <input
            type="checkbox"
            checked={bypass}
            onChange={(e) => {
              setBypass(e.target.checked);
              void store.setOrigin(site.origin, e.target.checked);
            }}
          />
          Auto-approve on {site.host}
        </label>
      )}
    </>
  );
}

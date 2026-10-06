import { useEffect, useMemo, useState } from 'react';
import { chromeKV } from '@/lib/storage/kv';
import { BypassStore } from '@/lib/storage/sites';
import { IconGlobe } from '@/lib/ui/icons';
import { targetTabId } from '@/lib/ui/targetTab';

export function TabChip() {
  const [tab, setTab] = useState<{ id: number; title: string; icon?: string } | null>(null);
  const [bypass, setBypass] = useState(false);
  const store = useMemo(() => new BypassStore(chromeKV(), chromeKV(chrome.storage.session)), []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const id = await targetTabId();
      if (id === undefined) return;
      const t = await chrome.tabs.get(id).catch(() => null);
      if (alive && t) {
        setTab({ id, title: t.title || t.url || 'this tab', icon: t.favIconUrl });
        setBypass((await store.tabs()).includes(id));
      }
    };
    void load();
    const onUpdated = () => void load();
    chrome.tabs.onActivated.addListener(onUpdated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      alive = false;
      chrome.tabs.onActivated.removeListener(onUpdated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  if (!tab) return null;
  return (
    <>
    <div className="tabchip" title={tab.title}>
      {tab.icon ? <img src={tab.icon} alt="" /> : <IconGlobe size={12} />}
      <span>Working in: {tab.title}</span>
    </div>
    <label className={`bypass${bypass ? ' on' : ''}`} title="Skip approval for routine risky actions in this tab. Passwords, payment and checkout buttons still ask.">
      <input
        type="checkbox"
        checked={bypass}
        onChange={(e) => {
          setBypass(e.target.checked);
          void store.setTab(tab.id, e.target.checked);
        }}
      />
      Auto-approve in this tab
    </label>
    </>
  );
}

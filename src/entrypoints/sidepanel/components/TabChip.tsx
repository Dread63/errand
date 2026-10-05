import { useEffect, useState } from 'react';
import { IconGlobe } from '@/lib/ui/icons';
import { targetTabId } from '@/lib/ui/targetTab';

export function TabChip() {
  const [tab, setTab] = useState<{ title: string; icon?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const id = await targetTabId();
      if (id === undefined) return;
      const t = await chrome.tabs.get(id).catch(() => null);
      if (alive && t) setTab({ title: t.title || t.url || 'this tab', icon: t.favIconUrl });
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
    <div className="tabchip" title={tab.title}>
      {tab.icon ? <img src={tab.icon} alt="" /> : <IconGlobe size={12} />}
      <span>Working in: {tab.title}</span>
    </div>
  );
}

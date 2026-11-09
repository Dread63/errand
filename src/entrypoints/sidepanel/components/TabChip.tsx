import { useEffect, useState } from 'react';
import { IconGlobe } from '@/lib/ui/icons';

/** Shows the agent's tab group. */
export function TabChip({ groupId }: { groupId: number | null }) {
  const [group, setGroup] = useState<{ count: number; title: string; icon?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (groupId === null) {
        if (alive) setGroup(null);
        return;
      }
      const tabs = await chrome.tabs.query({ groupId }).catch(() => []);
      const active = tabs.find((t) => t.active) ?? tabs[0];
      if (alive) setGroup(tabs.length ? { count: tabs.length, title: active?.title || active?.url || '', icon: active?.favIconUrl } : null);
    };
    void load();
    const reload = () => void load();
    chrome.tabs.onActivated.addListener(reload);
    chrome.tabs.onUpdated.addListener(reload);
    chrome.tabs.onRemoved.addListener(reload);
    return () => {
      alive = false;
      chrome.tabs.onActivated.removeListener(reload);
      chrome.tabs.onUpdated.removeListener(reload);
      chrome.tabs.onRemoved.removeListener(reload);
    };
  }, [groupId]);

  if (!group) return null;
  return (
    <div className="tabchip" title={group.title}>
      {group.icon ? <img src={group.icon} alt="" /> : <IconGlobe size={12} />}
      <span>
        Errand group · {group.count} {group.count === 1 ? 'tab' : 'tabs'}
      </span>
    </div>
  );
}

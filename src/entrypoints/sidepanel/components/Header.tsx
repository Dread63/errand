import { IconBack, IconHistory, IconNewChat, IconSettings } from '@/lib/ui/icons';

interface Props {
  title: string;
  view: 'chat' | 'history';
  busy: boolean;
  onNew(): void;
  onToggleHistory(): void;
}

export function Header({ title, view, busy, onNew, onToggleHistory }: Props) {
  return (
    <header className="hd">
      {view === 'history' ? (
        <button className="icon-btn" aria-label="Back to chat" title="Back to chat" onClick={onToggleHistory}>
          <IconBack />
        </button>
      ) : null}
      <span className="hd-title" title={title}>{view === 'history' ? 'History' : title}</span>
      <button className="icon-btn" aria-label="New chat" title="New chat" onClick={onNew} disabled={busy}>
        <IconNewChat />
      </button>
      <button className="icon-btn" aria-label="History" title="History" aria-pressed={view === 'history'} onClick={onToggleHistory} disabled={busy}>
        <IconHistory />
      </button>
      <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => chrome.runtime.openOptionsPage()}>
        <IconSettings />
      </button>
    </header>
  );
}

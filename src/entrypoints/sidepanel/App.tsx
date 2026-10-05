import { useState } from 'react';
import type { Attachment } from '@/lib/types';
import { targetTabId } from '@/lib/ui/targetTab';
import { usePanelPort } from '@/lib/ui/usePanelPort';
import { useProfiles } from '@/lib/ui/useProfiles';
import { ChatView } from './components/ChatView';
import { Composer } from './components/Composer';
import { GateCard } from './components/GateCard';
import { HistoryList } from './components/HistoryList';
import { ProfilePicker } from './components/ProfilePicker';

export function App() {
  const { state, dispatch, send } = usePanelPort();
  const { profiles, activeId, active, setActive } = useProfiles();
  const [view, setView] = useState<'chat' | 'history'>('chat');

  async function onSend(text: string, attachments: Attachment[]) {
    const tabId = await targetTabId();
    if (tabId === undefined) {
      dispatch({ type: 'error', message: 'There is no tab for the agent to control.' });
      return;
    }
    send({ type: 'start', conversationId: state.conversationId, text, attachments, tabId });
  }

  return (
    <div className="app">
      <header>
        <button onClick={() => dispatch({ type: 'new_chat' })} disabled={state.running}>New</button>
        <button onClick={() => setView((v) => (v === 'chat' ? 'history' : 'chat'))} disabled={state.running}>
          {view === 'chat' ? 'History' : 'Chat'}
        </button>
        <ProfilePicker profiles={profiles} activeId={activeId} disabled={state.running} onChange={(id) => void setActive(id)} />
        <button aria-label="Settings" title="Settings" onClick={() => chrome.runtime.openOptionsPage()}>⚙</button>
      </header>
      {view === 'history' ? (
        <HistoryList
          onOpen={(c) => {
            dispatch({ type: 'load', conversationId: c.id, turns: c.turns });
            setView('chat');
          }}
        />
      ) : (
        <>
          <ChatView turns={state.turns} streaming={state.streaming} running={state.running} />
          <div className="gates">
            {state.gates.map((g) => (
              <GateCard key={g.requestId} gate={g} onAnswer={(value) => send({ type: 'gate', requestId: g.requestId, value })} />
            ))}
          </div>
          {state.error && (
            <div className="error" role="alert">
              <span>{state.error}</span>
              <button aria-label="Dismiss" onClick={() => dispatch({ type: 'dismiss_error' })}>×</button>
            </div>
          )}
          <Composer running={state.running} vision={active?.supportsVision ?? false} onSend={(t, a) => void onSend(t, a)} onStop={() => send({ type: 'stop' })} />
        </>
      )}
    </div>
  );
}

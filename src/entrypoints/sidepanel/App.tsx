import { useMemo, useState } from 'react';
import { chromeKV } from '@/lib/storage/kv';
import { selectModel } from '@/lib/storage/models';
import { ProfileStore } from '@/lib/storage/profiles';
import { SettingsStore } from '@/lib/storage/settings';
import type { Attachment } from '@/lib/types';
import { IconX } from '@/lib/ui/icons';
import { canSend, supportsVisionFor } from '@/lib/ui/models';
import { targetTabId } from '@/lib/ui/targetTab';
import { useModelCatalog } from '@/lib/ui/useModelCatalog';
import { usePanelPort } from '@/lib/ui/usePanelPort';
import { useProfiles } from '@/lib/ui/useProfiles';
import { useTheme } from '@/lib/ui/useTheme';
import { ChatView } from './components/ChatView';
import { Composer } from './components/Composer';
import { GateCard } from './components/GateCard';
import { Header } from './components/Header';
import { HistoryList } from './components/HistoryList';
import { ModelMenu } from './components/ModelMenu';
import { TabChip } from './components/TabChip';

export function App() {
  useTheme();
  const { state, dispatch, send } = usePanelPort();
  const { profiles, active } = useProfiles();
  const { catalog, refreshAll, refreshOne, refreshing } = useModelCatalog(profiles);
  const stores = useMemo(() => ({ profiles: new ProfileStore(chromeKV()), settings: new SettingsStore(chromeKV()) }), []);
  const [view, setView] = useState<'chat' | 'history'>('chat');

  const firstUser = state.turns.find((t) => t.kind === 'user');
  const title = firstUser && firstUser.kind === 'user' ? firstUser.text : 'New chat';

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
      <Header
        title={title}
        view={view}
        busy={state.running}
        onNew={() => {
          dispatch({ type: 'new_chat' });
          setView('chat');
        }}
        onToggleHistory={() => setView((v) => (v === 'chat' ? 'history' : 'chat'))}
      />
      {view === 'history' ? (
        <HistoryList
          onOpen={(c) => {
            dispatch({ type: 'load', conversationId: c.id, turns: c.turns });
            setView('chat');
          }}
        />
      ) : (
        <>
          <ChatView turns={state.turns} streaming={state.streaming} reasoning={state.reasoning} running={state.running} />
          {state.gates.length > 0 && (
            <div className="gates">
              {state.gates.map((g) => (
                <GateCard key={g.requestId} gate={g} onAnswer={(value) => send({ type: 'gate', requestId: g.requestId, value })} />
              ))}
            </div>
          )}
          {state.error && (
            <div className="error" role="alert">
              <span>{state.error}</span>
              <button className="icon-btn sm" aria-label="Dismiss" onClick={() => dispatch({ type: 'dismiss_error' })}>
                <IconX size={14} />
              </button>
            </div>
          )}
          <TabChip />
          <Composer
            running={state.running}
            ready={canSend(active)}
            vision={active ? supportsVisionFor(active, active.model) : false}
            modelMenu={
              <ModelMenu
                profiles={profiles}
                active={active}
                catalog={catalog}
                refreshing={refreshing}
                disabled={state.running}
                onOpen={() => refreshAll(false)}
                onRefresh={(p) => void refreshOne(p, true)}
                onSelect={(profileId, model) => void selectModel(stores.profiles, stores.settings, profileId, model)}
              />
            }
            onSend={(t, a) => void onSend(t, a)}
            onStop={() => send({ type: 'stop' })}
          />
        </>
      )}
    </div>
  );
}

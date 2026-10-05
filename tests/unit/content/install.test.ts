// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { installContentAgent } from '@/lib/content/agent';

type Listener = (msg: unknown, sender: unknown, send: (r: unknown) => void) => boolean;

function fakeChrome(id: string | undefined) {
  const listeners: Listener[] = [];
  const runtime = { id, onMessage: { addListener: (l: Listener) => void listeners.push(l) } };
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime };
  return { listeners, runtime };
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__browserControlAlive;
});

describe('installContentAgent', () => {
  it('installs once per live extension context', () => {
    const c = fakeChrome('ext');
    installContentAgent();
    installContentAgent();
    expect(c.listeners).toHaveLength(1);
  });

  it('re-installs after the extension was reloaded and the old script was orphaned', () => {
    const old = fakeChrome('ext');
    installContentAgent();
    old.runtime.id = undefined; // Chrome clears runtime.id when the old context is invalidated
    const fresh = fakeChrome('ext');
    installContentAgent();
    expect(fresh.listeners).toHaveLength(1);
  });
});

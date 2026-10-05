import { describe, expect, it } from 'vitest';
import { type DriverHandle, PanelSession } from '@/lib/background/session';
import type { BgToPanel } from '@/lib/messages';
import { memoryKV } from '@/lib/storage/kv';
import { HistoryStore } from '@/lib/storage/history';
import { ProfileStore } from '@/lib/storage/profiles';
import { SettingsStore } from '@/lib/storage/settings';
import { SitePermissionStore } from '@/lib/storage/sites';
import { FakeDriver, FakeLlm, testProfile, toolCall } from '../agent/fakes';
import type { ChatResult } from '@/lib/llm/types';

class FakeHandle extends FakeDriver implements DriverHandle {
  started: number | null = null;
  stopped = false;
  async start(tabId: number) {
    this.started = tabId;
  }
  async stop() {
    this.stopped = true;
  }
}

async function until(fn: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 2));
  }
}

async function setup(script: ChatResult[], opts: { allow?: boolean; vision?: boolean; noProfile?: boolean } = {}) {
  const kv = memoryKV();
  const profiles = new ProfileStore(kv);
  const settings = new SettingsStore(kv);
  const siteStore = new SitePermissionStore(kv);
  const history = new HistoryStore(kv);
  if (!opts.noProfile) await profiles.save({ ...testProfile, supportsVision: !!opts.vision });
  await settings.update({ activeProfileId: opts.noProfile ? null : testProfile.id });
  if (opts.allow) await siteStore.allow('https://shop.test');
  const posted: BgToPanel[] = [];
  const driver = new FakeHandle();
  const llm = new FakeLlm(script);
  let n = 0;
  const session = new PanelSession(
    { postMessage: (m) => posted.push(m) },
    { profiles, settings, siteStore, history, makeLlm: () => llm, makeDriver: () => driver, newId: () => `id${++n}` },
  );
  return { session, posted, driver, history, llm };
}

const start = { type: 'start' as const, conversationId: null, text: 'Click it', attachments: [], tabId: 42 };

describe('PanelSession', () => {
  it('runs a task end to end, streams state and saves history', async () => {
    const s = await setup([toolCall('click', { id: 1 }), toolCall('done', { summary: 'Clicked.' })], { allow: true });
    await s.session.handle(start);
    expect(s.driver.started).toBe(42);
    expect(s.driver.stopped).toBe(true);
    expect(s.posted[0]).toEqual({ type: 'status', status: 'running' });
    expect(s.posted.at(-1)).toEqual({ type: 'status', status: 'idle' });
    const convs = s.posted.filter((m) => m.type === 'conversation');
    const final = convs.at(-1) as Extract<BgToPanel, { type: 'conversation' }>;
    expect(final.turns.at(-1)).toEqual({ kind: 'assistant', text: 'Clicked.' });
    const saved = await s.history.list();
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe('Click it');
  });

  it('uses the conversation id as the model session id', async () => {
    const s = await setup([toolCall('done', { summary: 'ok' })], { allow: true });
    await s.session.handle(start);
    const convId = (await s.history.list())[0].id;
    expect(s.llm.requests[0].sessionId).toBe(convId);
  });

  it('relays approvals through the port and continues with the answer', async () => {
    const s = await setup([toolCall('done', { summary: 'ok' })]);
    const run = s.session.handle(start);
    await until(() => s.posted.some((m) => m.type === 'gate'));
    const gate = s.posted.find((m) => m.type === 'gate') as Extract<BgToPanel, { type: 'gate' }>;
    expect(gate.request).toEqual({ kind: 'site', origin: 'https://shop.test' });
    s.session.handle({ type: 'gate', requestId: gate.requestId, value: 'once' });
    await run;
    expect(s.posted).toContainEqual({ type: 'gate_closed', requestId: gate.requestId });
    expect(s.driver.observed).toBe(1);
  });

  it('Review Focus: closing the panel during an approval stops the task and saves it', async () => {
    const s = await setup([toolCall('done', { summary: 'never' })]);
    s.session.handle(start);
    await until(() => s.posted.some((m) => m.type === 'gate'));
    s.session.dispose();
    await s.session.idle();
    expect(s.driver.stopped).toBe(true);
    const conv = await s.history.get((await s.history.list())[0].id);
    expect(conv?.turns.at(-1)).toEqual({ kind: 'assistant', text: 'Stopped.' });
    expect(s.llm.requests).toHaveLength(0);
  });

  it('continues an existing conversation', async () => {
    const s = await setup([toolCall('done', { summary: 'one' }), toolCall('done', { summary: 'two' })], { allow: true });
    await s.session.handle(start);
    const id = (await s.history.list())[0].id;
    await s.session.handle({ ...start, conversationId: id, text: 'And again' });
    const conv = await s.history.get(id);
    expect(conv?.turns.filter((t) => t.kind === 'user').map((t) => (t.kind === 'user' ? t.text : ''))).toEqual(['Click it', 'And again']);
    expect(await s.history.list()).toHaveLength(1);
  });

  it('refuses to start without a profile', async () => {
    const s = await setup([], { noProfile: true });
    await s.session.handle(start);
    expect(s.posted).toEqual([{ type: 'error', message: expect.stringMatching(/No model profile selected/) }]);
  });

  it('rejects image attachments for profiles without vision', async () => {
    const s = await setup([]);
    await s.session.handle({ ...start, attachments: [{ name: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,A' }] });
    expect(s.posted[0]).toMatchObject({ type: 'error', message: expect.stringMatching(/does not support images/) });
    expect(s.driver.started).toBeNull();
  });

  it('rejects a second start while running', async () => {
    const s = await setup([toolCall('done', { summary: 'x' })]);
    const run = s.session.handle(start);
    await until(() => s.posted.some((m) => m.type === 'gate'));
    await s.session.handle(start);
    expect(s.posted).toContainEqual({ type: 'error', message: 'A task is already running. Stop it first.' });
    s.session.handle({ type: 'stop' });
    await run;
  });
});

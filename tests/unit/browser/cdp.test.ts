import { describe, expect, it } from 'vitest';
import { Cdp, type DebuggerApi } from '@/lib/browser/cdp';
import { DetachedError, ExtensionConflictError, ToolError } from '@/lib/errors';

type DetachCb = (source: { tabId?: number }, reason: string) => void;

class FakeDebugger implements DebuggerApi {
  attached = new Set<number>();
  attachCalls = 0;
  sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  listeners = new Set<DetachCb>();
  attachError: Error | null = null;
  commandError: Error | null = null;
  commandErrors: Error[] = [];
  getTargets: () => Promise<Array<{ tabId?: number; attached: boolean; extensionId?: string }>> = async () => [];
  onDetach = {
    addListener: (cb: DetachCb) => void this.listeners.add(cb),
    removeListener: (cb: DetachCb) => void this.listeners.delete(cb),
  };
  async attach(t: { tabId: number }) {
    this.attachCalls++;
    if (this.attachError) throw this.attachError;
    this.attached.add(t.tabId);
  }
  async detach(t: { tabId: number }) {
    this.attached.delete(t.tabId);
  }
  async sendCommand(_t: { tabId: number }, method: string, params?: object) {
    if (this.commandError) throw this.commandError;
    const once = this.commandErrors.shift();
    if (once) throw once;
    this.sent.push({ method, params: params as Record<string, unknown> });
    return method === 'Page.captureScreenshot' ? { data: 'AAA' } : {};
  }
  fireDetach(tabId: number, reason: string) {
    this.attached.delete(tabId);
    this.listeners.forEach((cb) => cb({ tabId }, reason));
  }
}

describe('Cdp', () => {
  it('attaches once and sends a move/press/release click', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    await cdp.click(1, 10, 20);
    await cdp.click(1, 11, 21);
    expect(api.attachCalls).toBe(1);
    expect(api.sent.slice(0, 3).map((s) => s.params?.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    expect(api.sent[1].params).toMatchObject({ x: 10, y: 20, button: 'left', clickCount: 1 });
  });

  it('sends keys: rawKeyDown with commands for shortcuts, keyDown with text for Enter', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    await cdp.key(1, 'Control+a');
    expect(api.sent[0].params).toMatchObject({ type: 'rawKeyDown', key: 'a', modifiers: 2, commands: ['selectAll'] });
    expect(api.sent[1].params).toMatchObject({ type: 'keyUp', key: 'a' });
    await cdp.key(1, 'Enter');
    expect(api.sent[2].params).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r' });
  });

  it('inserts text, scrolls and screenshots', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    await cdp.insertText(1, 'hello');
    await cdp.wheel(1, 100, 200, 640);
    expect(await cdp.screenshot(1)).toBe('data:image/jpeg;base64,AAA');
    expect(api.sent.map((s) => s.method)).toEqual(['Input.insertText', 'Input.dispatchMouseEvent', 'Page.captureScreenshot']);
    expect(api.sent[1].params).toMatchObject({ type: 'mouseWheel', x: 100, y: 200, deltaY: 640 });
  });

  it('after the user cancels the debugging bar, throws DetachedError until cleared', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    await cdp.ensure(1);
    api.fireDetach(1, 'canceled_by_user');
    await expect(cdp.click(1, 0, 0)).rejects.toBeInstanceOf(DetachedError);
    cdp.clearCanceled();
    await cdp.click(1, 0, 0);
    expect(api.attachCalls).toBe(2);
  });

  it('re-attaches silently after other detach reasons', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    await cdp.ensure(1);
    api.fireDetach(1, 'target_closed');
    await cdp.ensure(1);
    expect(api.attachCalls).toBe(2);
  });

  it('maps attach failures to DetachedError and command failures to ToolError', async () => {
    const api = new FakeDebugger();
    api.attachError = new Error('Another debugger is already attached');
    await expect(new Cdp(api).ensure(1)).rejects.toBeInstanceOf(DetachedError);
    const api2 = new FakeDebugger();
    const cdp2 = new Cdp(api2);
    await cdp2.ensure(1);
    api2.commandError = new Error('Invalid parameters');
    await expect(cdp2.click(1, 0, 0)).rejects.toBeInstanceOf(ToolError);
  });

  it('reports another extension blocking the tab as ExtensionConflictError, on attach and on commands', async () => {
    const conflict = 'Cannot access a chrome-extension:// URL of different extension';
    const api = new FakeDebugger();
    api.attachError = new Error(conflict);
    const err = await new Cdp(api).ensure(1).catch((e) => e);
    expect(err).toBeInstanceOf(ExtensionConflictError);
    expect(err).toBeInstanceOf(DetachedError);
    expect(err.message).not.toMatch(/DevTools/);
    const api2 = new FakeDebugger();
    const cdp2 = new Cdp(api2);
    await cdp2.ensure(1);
    api2.commandError = new Error(conflict);
    await expect(cdp2.click(1, 0, 0)).rejects.toBeInstanceOf(ExtensionConflictError);
  });

  it('on a conflict, re-suspends frames and retries only the failed command', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    const swept: number[] = [];
    cdp.setConflictHandler(async (tabId) => void swept.push(tabId));
    await cdp.ensure(1);
    api.commandErrors = [new Error('Cannot access a chrome-extension:// URL of different extension')];
    await cdp.click(1, 5, 5);
    expect(swept).toEqual([1]);
    // The mouseMoved that failed is retried; the click still has exactly one press and one release.
    expect(api.sent.map((s) => s.params?.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
  });

  it('re-attaches and retries when Chrome detaches mid-command because a frame appeared', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    cdp.setConflictHandler(async () => {});
    await cdp.ensure(1);
    api.commandErrors = [new Error('Detached while handling command.')];
    api.fireDetach(1, 'target_closed');
    await cdp.insertText(1, 'hi');
    expect(api.attachCalls).toBe(2);
    expect(api.sent.map((s) => s.method)).toEqual(['Input.insertText']);
  });

  it('retries attaching after a conflict', async () => {
    const api = new FakeDebugger();
    let attachFails = 1;
    const attach = api.attach.bind(api);
    api.attach = async (t) => {
      if (attachFails-- > 0) throw new Error('Cannot access a chrome-extension:// URL of different extension');
      return attach(t);
    };
    const cdp = new Cdp(api);
    let swept = 0;
    cdp.setConflictHandler(async () => void swept++);
    await cdp.ensure(1);
    expect(swept).toBe(1);
  });

  it('gives up with ExtensionConflictError after two retries', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    cdp.setConflictHandler(async () => {});
    await cdp.ensure(1);
    const conflict = () => new Error('Cannot access a chrome-extension:// URL of different extension');
    api.commandErrors = [conflict(), conflict(), conflict()];
    await expect(cdp.insertText(1, 'x')).rejects.toBeInstanceOf(ExtensionConflictError);
  });

  it('treats "already attached" as fine only when the attachment is ours', async () => {
    const already = new Error('Another debugger is already attached to the tab with id: 1.');
    const mine = new FakeDebugger();
    mine.attachError = already;
    mine.getTargets = async () => [{ tabId: 1, attached: true, extensionId: 'me' }];
    await new Cdp(mine, 'me').ensure(1);
    const theirs = new FakeDebugger();
    theirs.attachError = already;
    theirs.getTargets = async () => [{ tabId: 1, attached: true, extensionId: 'someone-else' }];
    await expect(new Cdp(theirs, 'me').ensure(1)).rejects.toBeInstanceOf(DetachedError);
  });

  it('detachAll detaches and dispose removes the listener', async () => {
    const api = new FakeDebugger();
    const cdp = new Cdp(api);
    await cdp.ensure(1);
    await cdp.ensure(2);
    await cdp.detachAll();
    expect(api.attached.size).toBe(0);
    cdp.dispose();
    expect(api.listeners.size).toBe(0);
  });
});

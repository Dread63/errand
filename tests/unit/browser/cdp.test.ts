import { describe, expect, it } from 'vitest';
import { Cdp, type DebuggerApi } from '@/lib/browser/cdp';
import { DetachedError, ToolError } from '@/lib/errors';

type DetachCb = (source: { tabId?: number }, reason: string) => void;

class FakeDebugger implements DebuggerApi {
  attached = new Set<number>();
  attachCalls = 0;
  sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  listeners = new Set<DetachCb>();
  attachError: Error | null = null;
  commandError: Error | null = null;
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

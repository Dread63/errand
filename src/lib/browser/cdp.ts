import { DetachedError, ToolError } from '../errors';
import { errMsg } from '../util';
import { parseCombo } from './keys';

type DetachListener = (source: { tabId?: number }, reason: string) => void;

export interface DebuggerApi {
  attach(target: { tabId: number }, version: string): Promise<void>;
  detach(target: { tabId: number }): Promise<void>;
  sendCommand(target: { tabId: number }, method: string, params?: object): Promise<unknown>;
  onDetach: { addListener(cb: DetachListener): void; removeListener(cb: DetachListener): void };
}

export class Cdp {
  private attached = new Set<number>();
  private canceled = new Set<number>();
  private api: DebuggerApi;

  private readonly onDetach: DetachListener = (source, reason) => {
    if (source.tabId === undefined) return;
    this.attached.delete(source.tabId);
    if (reason === 'canceled_by_user') this.canceled.add(source.tabId);
  };

  constructor(api?: DebuggerApi) {
    this.api = api ?? (chrome.debugger as unknown as DebuggerApi);
    this.api.onDetach.addListener(this.onDetach);
  }

  dispose(): void {
    this.api.onDetach.removeListener(this.onDetach);
  }

  clearCanceled(): void {
    this.canceled.clear();
  }

  async ensure(tabId: number): Promise<void> {
    if (this.canceled.has(tabId)) throw new DetachedError('You closed the debugging bar, so the agent lost control of this tab.');
    if (this.attached.has(tabId)) return;
    try {
      await this.api.attach({ tabId }, '1.3');
    } catch (e) {
      if (!/already attached/i.test(errMsg(e)) || /another/i.test(errMsg(e))) {
        throw new DetachedError(`Could not control this tab: ${errMsg(e)}.`);
      }
    }
    this.attached.add(tabId);
  }

  private async send<T = unknown>(tabId: number, method: string, params?: object): Promise<T> {
    await this.ensure(tabId);
    try {
      return (await this.api.sendCommand({ tabId }, method, params)) as T;
    } catch (e) {
      if (!this.attached.has(tabId)) throw new DetachedError(`Lost control of the tab: ${errMsg(e)}.`);
      throw new ToolError(`Browser command ${method} failed: ${errMsg(e)}`);
    }
  }

  async move(tabId: number, x: number, y: number): Promise<void> {
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }

  async click(tabId: number, x: number, y: number): Promise<void> {
    await this.move(tabId, x, y);
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async wheel(tabId: number, x: number, y: number, deltaY: number): Promise<void> {
    await this.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  }

  async insertText(tabId: number, text: string): Promise<void> {
    await this.send(tabId, 'Input.insertText', { text });
  }

  async key(tabId: number, combo: string): Promise<void> {
    const k = parseCombo(combo);
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers: k.modifiers };
    await this.send(tabId, 'Input.dispatchKeyEvent', {
      ...base,
      type: k.text ? 'keyDown' : 'rawKeyDown',
      ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}),
      ...(k.commands ? { commands: k.commands } : {}),
    });
    await this.send(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  async screenshot(tabId: number): Promise<string> {
    const r = await this.send<{ data: string }>(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    return `data:image/jpeg;base64,${r.data}`;
  }

  async detachAll(): Promise<void> {
    const ids = [...this.attached];
    this.attached.clear();
    await Promise.all(ids.map((tabId) => this.api.detach({ tabId }).catch(() => {})));
  }
}

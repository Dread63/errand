import { DetachedError, ExtensionConflictError, ToolError } from '../errors';
import { errMsg } from '../util';
import { parseCombo } from './keys';

const CONFLICT = /chrome-extension:\/\/ URL of different extension/i;
const DETACHED_MID_COMMAND = /Detached while handling command/i;
const MAX_CONFLICT_RETRIES = 2;
const conflictError = () =>
  new ExtensionConflictError(
    "Another browser extension has a hidden frame in this page, which stops Chrome from letting the agent control it. If this keeps happening, disable that extension for this site.",
  );

type DetachListener = (source: { tabId?: number }, reason: string) => void;

export interface DebuggerApi {
  attach(target: { tabId: number }, version: string): Promise<void>;
  detach(target: { tabId: number }): Promise<void>;
  sendCommand(target: { tabId: number }, method: string, params?: object): Promise<unknown>;
  getTargets(): Promise<Array<{ tabId?: number; attached: boolean; extensionId?: string }>>;
  onDetach: { addListener(cb: DetachListener): void; removeListener(cb: DetachListener): void };
}

export class Cdp {
  private attached = new Set<number>();
  private canceled = new Set<number>();
  private api: DebuggerApi;
  private onConflict: ((tabId: number) => Promise<void>) | null = null;

  private readonly onDetach: DetachListener = (source, reason) => {
    if (source.tabId === undefined) return;
    this.attached.delete(source.tabId);
    if (reason === 'canceled_by_user') this.canceled.add(source.tabId);
  };

  private ownId: string;

  constructor(api?: DebuggerApi, ownExtensionId?: string) {
    this.api = api ?? (chrome.debugger as unknown as DebuggerApi);
    this.ownId = ownExtensionId ?? globalThis.chrome?.runtime?.id ?? '';
    this.api.onDetach.addListener(this.onDetach);
  }

  dispose(): void {
    this.api.onDetach.removeListener(this.onDetach);
  }

  clearCanceled(): void {
    this.canceled.clear();
  }

  /** Called when another extension's frame blocks the tab, before the failed step is retried. */
  setConflictHandler(fn: (tabId: number) => Promise<void>): void {
    this.onConflict = fn;
  }

  async ensure(tabId: number): Promise<void> {
    if (this.canceled.has(tabId)) throw new DetachedError('You closed the debugging bar, so the agent lost control of this tab.');
    if (this.attached.has(tabId)) return;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.api.attach({ tabId }, '1.3');
        break;
      } catch (e) {
        const m = errMsg(e);
        if (CONFLICT.test(m)) {
          if (attempt >= MAX_CONFLICT_RETRIES || !this.onConflict) throw conflictError();
          await this.onConflict(tabId);
          continue;
        }
        // Chrome says "Another debugger is already attached" even when that debugger is us
        // (e.g. after the service worker restarted), so check who holds the attachment.
        if (/already attached/i.test(m) && (await this.attachedByUs(tabId))) break;
        throw new DetachedError(`Could not control this tab: ${m}. If DevTools is open for this tab, close it.`);
      }
    }
    this.attached.add(tabId);
  }

  private async attachedByUs(tabId: number): Promise<boolean> {
    try {
      const targets = await this.api.getTargets();
      return targets.some((t) => t.tabId === tabId && t.attached && t.extensionId === this.ownId);
    } catch {
      return false;
    }
  }

  private async send<T = unknown>(tabId: number, method: string, params?: object): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.ensure(tabId);
      try {
        return (await this.api.sendCommand({ tabId }, method, params)) as T;
      } catch (e) {
        const m = errMsg(e);
        // A foreign frame either blocks the command or makes Chrome drop the session mid-command.
        // Retry just this command, so a half-sent click is completed rather than replayed.
        if (CONFLICT.test(m) || DETACHED_MID_COMMAND.test(m)) {
          if (attempt >= MAX_CONFLICT_RETRIES || !this.onConflict) throw conflictError();
          await this.onConflict(tabId);
          continue;
        }
        if (/not attached/i.test(m) && attempt < MAX_CONFLICT_RETRIES) {
          this.attached.delete(tabId);
          continue;
        }
        if (!this.attached.has(tabId)) throw new DetachedError(`Lost control of the tab: ${m}.`);
        throw new ToolError(`Browser command ${method} failed: ${m}`);
      }
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

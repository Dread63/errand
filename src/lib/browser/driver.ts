import { MODE_LIMITS } from '../agent/modes';
import type { BrowserDriver } from '../agent/ports';
import type { ContentRequest, ResolveResult } from '../content/protocol';
import { ToolError } from '../errors';
import type { ActionTarget, ContextMode, ElementInfo, Observation, PageSnapshot, TabInfo, ToolCall } from '../types';
import { isWebUrl, originOf } from '../url';
import { clip, sleep } from '../util';
import type { Cdp } from './cdp';
import type { ContentMessenger } from './messenger';
import type { AgentTabs } from './tabs';

export type TabsLike = Pick<AgentTabs, 'start' | 'stop' | 'active' | 'list' | 'open' | 'switchTo' | 'close' | 'navigate' | 'back' | 'waitForLoad'>;
export type CdpLike = Pick<Cdp, 'ensure' | 'move' | 'click' | 'wheel' | 'insertText' | 'key' | 'screenshot' | 'detachAll' | 'clearCanceled' | 'dispose'>;
export type MessengerLike = Pick<ContentMessenger, 'ensureInjected' | 'send'>;

const ELEMENT_TOOLS = new Set(['click', 'type', 'select', 'hover']);

const label = (t: ActionTarget) => (t.element ? `${t.element.role} "${clip(t.element.name || t.element.tag, 60)}"` : 'the element');

export class ChromeDriver implements BrowserDriver {
  private viewport = { w: 1280, h: 800 };
  private isMac: boolean;
  private settleMs: number;

  constructor(
    private tabs: TabsLike,
    private cdp: CdpLike,
    private content: MessengerLike,
    opts: { isMac?: boolean; settleMs?: number } = {},
  ) {
    this.isMac = opts.isMac ?? /Mac/.test(globalThis.navigator?.userAgent ?? '');
    this.settleMs = opts.settleMs ?? 300;
  }

  async start(tabId: number): Promise<void> {
    await this.tabs.start(tabId);
  }

  async stop(): Promise<void> {
    try {
      const t = await this.tabs.active();
      if (isWebUrl(t.url ?? '')) await this.content.send(t.id!, { type: 'overlay', op: 'active', on: false });
    } catch {
      // tab gone or page unreachable
    }
    await this.cdp.detachAll();
    this.cdp.dispose();
    this.tabs.stop();
  }

  async reattach(): Promise<void> {
    this.cdp.clearCanceled();
    const t = await this.tabs.active();
    await this.cdp.ensure(t.id!);
  }

  async activeUrl(): Promise<string> {
    const t = await this.tabs.active();
    return t.url || t.pendingUrl || '';
  }

  listTabs(): Promise<TabInfo[]> {
    return this.tabs.list();
  }

  async observe({ mode, screenshot }: { mode: ContextMode; screenshot: boolean }): Promise<Observation> {
    const first = await this.tabs.active();
    await this.tabs.waitForLoad(first.id!);
    const tab = await this.tabs.active();
    const tabId = tab.id!;
    const url = tab.url ?? '';
    const tabs = await this.tabs.list();
    if (!isWebUrl(url)) {
      const snapshot: PageSnapshot = {
        url,
        title: tab.title ?? '',
        restricted: true,
        elements: [],
        headings: [],
        scrollY: 0,
        scrollMaxY: 0,
        viewport: this.viewport,
      };
      return { snapshot, tabs };
    }
    await this.cdp.ensure(tabId);
    await this.content.ensureInjected(tabId);
    await this.content.send(tabId, { type: 'overlay', op: 'active', on: true });
    const snapshot = await this.content.send<PageSnapshot>(tabId, { type: 'snapshot', mode });
    this.viewport = snapshot.viewport;
    const shot = screenshot ? await this.cdp.screenshot(tabId) : undefined;
    return shot ? { snapshot, tabs, screenshot: shot } : { snapshot, tabs };
  }

  private async resolve(tabId: number, origin: string, id: number): Promise<ActionTarget> {
    const r = await this.content.send<ResolveResult>(tabId, { type: 'resolve', id, scroll: true });
    if (!r.ok) throw new ToolError(r.error);
    return { tabId, origin, element: r.info, point: { x: r.x, y: r.y } };
  }

  async target(call: ToolCall): Promise<ActionTarget> {
    const tab = await this.tabs.active();
    const tabId = tab.id!;
    const url = tab.url ?? '';
    const origin = originOf(url);
    const needsPage = ELEMENT_TOOLS.has(call.name) || (call.name === 'scroll' && call.args.id !== undefined) || call.name === 'read_text';
    if (needsPage && !isWebUrl(url)) throw new ToolError('This page cannot be controlled. Use navigate or new_tab to go to a website.');
    if (ELEMENT_TOOLS.has(call.name) || (call.name === 'scroll' && call.args.id !== undefined)) {
      return this.resolve(tabId, origin, Number(call.args.id));
    }
    switch (call.name) {
      case 'key': {
        const focused = isWebUrl(url) ? await this.content.send<ElementInfo | null>(tabId, { type: 'focused' }).catch(() => null) : null;
        return focused ? { tabId, origin, element: focused } : { tabId, origin };
      }
      case 'navigate':
      case 'new_tab':
        return { tabId, origin: originOf(String(call.args.url)) };
      case 'switch_tab': {
        const t = (await this.tabs.list()).find((x) => x.index === Number(call.args.index));
        if (!t) throw new ToolError(`No agent tab with index ${call.args.index}.`);
        return { tabId: t.tabId, origin: originOf(t.url) };
      }
      default:
        return { tabId, origin };
    }
  }

  private async overlay(tabId: number, req: ContentRequest): Promise<void> {
    await this.content.send(tabId, req).catch(() => {}); // visuals are best-effort
  }

  private async pointTo(t: ActionTarget): Promise<{ x: number; y: number }> {
    if (!t.point) throw new ToolError('This action needs an element id.');
    await this.overlay(t.tabId, { type: 'overlay', op: 'move', x: t.point.x, y: t.point.y });
    await this.overlay(t.tabId, { type: 'overlay', op: 'hover', rect: t.element?.rect ?? null });
    return t.point;
  }

  private async settle(tabId: number): Promise<void> {
    await sleep(this.settleMs);
    await this.tabs.waitForLoad(tabId).catch(() => {});
  }

  async perform(call: ToolCall, target: ActionTarget, mode: ContextMode): Promise<string> {
    const tabId = target.tabId;
    const a = call.args;
    switch (call.name) {
      case 'click': {
        const p = await this.pointTo(target);
        await this.cdp.click(tabId, p.x, p.y);
        await this.overlay(tabId, { type: 'overlay', op: 'click', x: p.x, y: p.y });
        await this.settle(tabId);
        return `Clicked ${label(target)}.`;
      }
      case 'hover': {
        const p = await this.pointTo(target);
        await this.cdp.move(tabId, p.x, p.y);
        return `Hovering over ${label(target)}.`;
      }
      case 'type': {
        const p = await this.pointTo(target);
        await this.cdp.click(tabId, p.x, p.y);
        if (a.clear !== false) {
          await this.cdp.key(tabId, this.isMac ? 'Meta+a' : 'Control+a');
          await this.cdp.key(tabId, 'Backspace');
        }
        await this.cdp.insertText(tabId, String(a.text));
        if (a.submit === true) {
          await this.cdp.key(tabId, 'Enter');
          await this.settle(tabId);
        }
        return `Typed into ${label(target)}${a.submit === true ? ' and pressed Enter' : ''}.`;
      }
      case 'select': {
        await this.pointTo(target);
        return this.content.send<string>(tabId, { type: 'select', id: Number(a.id), value: String(a.value) });
      }
      case 'scroll': {
        if (target.point) return `Scrolled ${label(target)} into view.`;
        const x = Math.round(this.viewport.w / 2);
        const y = Math.round(this.viewport.h / 2);
        await this.overlay(tabId, { type: 'overlay', op: 'move', x, y });
        await this.cdp.wheel(tabId, x, y, (a.direction === 'up' ? -1 : 1) * Math.round(this.viewport.h * 0.8));
        await sleep(this.settleMs);
        return `Scrolled ${a.direction}.`;
      }
      case 'key':
        await this.cdp.key(tabId, String(a.combo));
        await this.settle(tabId);
        return `Pressed ${a.combo}.`;
      case 'navigate':
        await this.tabs.navigate(String(a.url));
        return `Navigated to ${a.url}.`;
      case 'back':
        await this.tabs.back();
        return 'Went back.';
      case 'wait':
        await sleep(Number(a.ms));
        return `Waited ${a.ms} ms.`;
      case 'read_text': {
        const text = await this.content.send<string>(tabId, { type: 'readText', maxChars: MODE_LIMITS[mode].readTextTokens * 4 });
        return `<page_content untrusted="true">\n${text}\n</page_content>`;
      }
      case 'new_tab':
        await this.tabs.open(String(a.url));
        return `Opened ${a.url} in a new tab.`;
      case 'switch_tab':
        await this.tabs.switchTo(Number(a.index));
        return `Switched to tab ${a.index}.`;
      case 'close_tab':
        await this.tabs.close(Number(a.index));
        return `Closed tab ${a.index}.`;
      default:
        throw new ToolError(`Unsupported action "${call.name}".`);
    }
  }

  async highlight(target: ActionTarget | null): Promise<void> {
    const tabId = target?.tabId ?? (await this.tabs.active()).id!;
    await this.overlay(tabId, {
      type: 'overlay',
      op: 'highlight',
      rect: target?.element?.rect ?? null,
      ...(target ? { label: 'Waiting for your approval' } : {}),
    });
  }
}

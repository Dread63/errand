import { MODE_LIMITS } from '../agent/modes';
import { pillLabel } from '../agent/tools';
import type { BrowserDriver } from '../agent/ports';
import type { ContentRequest, ResolveResult } from '../content/protocol';
import { ToolError } from '../errors';
import type { ActionTarget, ContextMode, ElementInfo, Observation, PageSnapshot, TabInfo, ToolCall } from '../types';
import { isWebUrl, originOf } from '../url';
import { timed } from '../timing';
import { clip, sleep } from '../util';
import type { Cdp } from './cdp';
import { fitScreenshot } from './image';
import type { ContentMessenger } from './messenger';
import type { AgentTabs } from './tabs';

export type TabsLike = Pick<AgentTabs, 'start' | 'stop' | 'active' | 'list' | 'open' | 'switchTo' | 'close' | 'navigate' | 'back' | 'waitForLoad'>;
export type CdpLike = Pick<Cdp, 'setConflictHandler' | 'ensure' | 'move' | 'click' | 'wheel' | 'insertText' | 'key' | 'screenshot' | 'detachAll' | 'clearCanceled' | 'dispose'>;
export type MessengerLike = Pick<ContentMessenger, 'ensureInjected' | 'send'>;

const ELEMENT_TOOLS = new Set(['click', 'type', 'select', 'hover']);
const POINT_TOOLS = new Set(['click', 'type', 'hover']);

const label = (t: ActionTarget) =>
  t.element ? `${t.element.role} "${clip(t.element.name || t.element.tag, 60)}"` : t.point ? `(${t.point.x}, ${t.point.y})` : 'the focused element';

export class ChromeDriver implements BrowserDriver {
  private viewport = { w: 1280, h: 800 };
  private ringShown = false;
  /** What the current action is, shown next to the on-page cursor. */
  private stepLabel: string | undefined;
  private guardedTabs = new Set<number>();
  private scrollStepMs: number;
  private isMac: boolean;
  private settleMs: number;
  private fitImage: (dataUrl: string, w: number, h: number) => Promise<string>;

  constructor(
    private tabs: TabsLike,
    private cdp: CdpLike,
    private content: MessengerLike,
    opts: {
      isMac?: boolean;
      settleMs?: number;
      scrollStepMs?: number;
      fitImage?: (dataUrl: string, w: number, h: number) => Promise<string>;
    } = {},
  ) {
    this.fitImage = opts.fitImage ?? fitScreenshot;
    this.isMac = opts.isMac ?? /Mac/.test(globalThis.navigator?.userAgent ?? '');
    this.settleMs = opts.settleMs ?? 300;
    this.scrollStepMs = opts.scrollStepMs ?? 30;
    this.cdp.setConflictHandler((tabId) => this.suspendForeignFrames(tabId));
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
    for (const tabId of this.guardedTabs) await this.content.send(tabId, { type: 'guard', on: false }).catch(() => {});
    this.guardedTabs.clear();
    await this.cdp.detachAll();
    this.cdp.dispose();
    this.tabs.stop();
  }

  async reattach(): Promise<void> {
    this.cdp.clearCanceled();
    const t = await this.tabs.active();
    if (isWebUrl(t.url ?? '')) await this.suspendForeignFrames(t.id!);
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
    await timed('observe: waitForLoad', () => this.tabs.waitForLoad(first.id!));
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
    await timed('observe: inject content script', () => this.content.ensureInjected(tabId));
    await timed('observe: guard foreign frames', () => this.suspendForeignFrames(tabId));
    await timed('observe: attach debugger', () => this.cdp.ensure(tabId));
    await timed('observe: show overlay', () => this.content.send(tabId, { type: 'overlay', op: 'active', on: true }));
    const snapshot = await timed('observe: snapshot', () => this.content.send<PageSnapshot>(tabId, { type: 'snapshot', mode }));
    this.viewport = snapshot.viewport;
    const shot = screenshot
      ? await timed('observe: screenshot', async () => {
          const raw = await this.cdp.screenshot(tabId);
          return this.fitImage(raw, snapshot.viewport.w, snapshot.viewport.h).catch(() => raw);
        })
      : undefined;
    return shot ? { snapshot, tabs, screenshot: shot } : { snapshot, tabs };
  }

  private async resolve(tabId: number, origin: string, id: number, pointer: boolean): Promise<ActionTarget> {
    const r = await this.content.send<ResolveResult>(tabId, { type: 'resolve', id, scroll: true });
    if (!r.ok) throw new ToolError(r.error);
    if (pointer && r.coveredBy) {
      // The click would land on whatever is on top, so report that instead of a false success.
      const c = r.coveredBy;
      throw new ToolError(
        `Element [${id}] is covered by ${c.role} "${clip(c.name || c.tag, 60)}" (probably an open menu, popup or dialog), so it cannot be clicked. Close that first (press Escape, or click its close button), then try again.`,
      );
    }
    return { tabId, origin, element: r.info, point: { x: r.x, y: r.y } };
  }

  async target(call: ToolCall): Promise<ActionTarget> {
    const tab = await this.tabs.active();
    const tabId = tab.id!;
    const url = tab.url ?? '';
    const origin = originOf(url);
    const byId = call.args.id !== undefined && (ELEMENT_TOOLS.has(call.name) || call.name === 'scroll');
    const byPoint = !byId && call.args.x !== undefined && POINT_TOOLS.has(call.name);
    const needsPage = byId || byPoint || call.name === 'type' || call.name === 'read_text';
    if (needsPage && !isWebUrl(url)) throw new ToolError('This page cannot be controlled. Use navigate or new_tab to go to a website.');
    if (byId) return this.resolve(tabId, origin, Number(call.args.id), POINT_TOOLS.has(call.name));
    if (byPoint) return this.at(tabId, origin, Number(call.args.x), Number(call.args.y));
    switch (call.name) {
      case 'type':
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

  private async at(tabId: number, origin: string, x: number, y: number): Promise<ActionTarget> {
    const { w, h } = this.viewport;
    if (x >= w || y >= h) throw new ToolError(`(${x}, ${y}) is outside the ${w}×${h} screenshot.`);
    const element = await this.content.send<ElementInfo | null>(tabId, { type: 'pointInfo', x, y }).catch(() => null);
    return element ? { tabId, origin, element, point: { x, y } } : { tabId, origin, point: { x, y } };
  }

  /** Inserts text; tab characters press Tab and newlines press Enter (moving between cells or fields). */
  private async typeText(tabId: number, text: string): Promise<void> {
    for (const part of text.replace(/\r\n?/g, '\n').split(/([\t\n])/)) {
      if (part === '\t') await this.cdp.key(tabId, 'Tab');
      else if (part === '\n') await this.cdp.key(tabId, 'Enter');
      else if (part) await this.cdp.insertText(tabId, part);
    }
  }

  private async overlay(tabId: number, req: ContentRequest): Promise<void> {
    await this.content.send(tabId, req).catch(() => {}); // visuals are best-effort
  }

  /** Chrome refuses debugger access while another extension's frame is in the page. */
  private async suspendForeignFrames(tabId: number): Promise<void> {
    this.guardedTabs.add(tabId);
    await this.content.send(tabId, { type: 'guard', on: true }).catch(() => {});
  }

  private async clearRing(tabId: number): Promise<void> {
    if (!this.ringShown) return;
    this.ringShown = false;
    await this.overlay(tabId, { type: 'overlay', op: 'hover', rect: null });
  }

  private async pointTo(t: ActionTarget): Promise<{ x: number; y: number }> {
    if (!t.point) throw new ToolError('This action needs an element id or x and y.');
    await this.overlay(t.tabId, { type: 'overlay', op: 'move', x: t.point.x, y: t.point.y, label: this.stepLabel });
    await this.overlay(t.tabId, { type: 'overlay', op: 'hover', rect: t.element?.rect ?? null });
    this.ringShown = true;
    return t.point;
  }

  /** Wheel-scrolls in small steps so the page scrolls smoothly instead of jumping. */
  private async smoothWheel(tabId: number, x: number, y: number, deltaY: number): Promise<void> {
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      await this.cdp.wheel(tabId, x, y, deltaY / steps);
      await sleep(this.scrollStepMs);
    }
  }

  private async settle(tabId: number): Promise<void> {
    await sleep(this.settleMs);
    await timed('settle: waitForLoad', () => this.tabs.waitForLoad(tabId)).catch(() => {});
  }

  async perform(call: ToolCall, target: ActionTarget, mode: ContextMode): Promise<string> {
    this.stepLabel = pillLabel(call, target);
    this.ringShown = false;
    try {
      return await this.act(call, target, mode);
    } finally {
      // The ring marks the element being acted on; once the action is over it must not linger
      // (it is fixed-position, so it would also drift away from the element as the page scrolls).
      if (call.name !== 'hover') await this.clearRing(target.tabId);
    }
  }

  private async act(call: ToolCall, target: ActionTarget, mode: ContextMode): Promise<string> {
    const tabId = target.tabId;
    const a = call.args;
    switch (call.name) {
      case 'click': {
        const p = await this.pointTo(target);
        await this.cdp.click(tabId, p.x, p.y);
        await this.overlay(tabId, { type: 'overlay', op: 'click', x: p.x, y: p.y });
        await this.clearRing(tabId); // the ring marks the click itself, not the page load that follows
        await this.settle(tabId);
        return `Clicked ${label(target)}.`;
      }
      case 'hover': {
        const p = await this.pointTo(target);
        await this.cdp.move(tabId, p.x, p.y);
        return `Hovering over ${label(target)}.`;
      }
      case 'type': {
        if (target.point) {
          const p = await this.pointTo(target);
          await this.cdp.click(tabId, p.x, p.y);
          await this.clearRing(tabId);
        }
        // Select-all is only safe in a real text field; in a spreadsheet it would select every cell.
        if (a.clear === true || (a.id !== undefined && a.clear !== false)) {
          await this.cdp.key(tabId, this.isMac ? 'Meta+a' : 'Control+a');
          await this.cdp.key(tabId, 'Backspace');
        }
        const text = String(a.text);
        await this.typeText(tabId, text);
        if (a.submit === true) await this.cdp.key(tabId, 'Enter');
        if (a.submit === true || /[\r\n]/.test(text)) await this.settle(tabId);
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
        await this.overlay(tabId, { type: 'overlay', op: 'move', x, y, label: this.stepLabel });
        await this.smoothWheel(tabId, x, y, (a.direction === 'up' ? -1 : 1) * Math.round(this.viewport.h * 0.8));
        await sleep(this.settleMs);
        return `Scrolled ${a.direction}.`;
      }
      case 'key': {
        const r = target.element?.rect;
        if (r) await this.pointTo({ ...target, point: { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) } });
        const times = typeof a.repeat === 'number' ? a.repeat : 1;
        for (let i = 0; i < times; i++) await this.cdp.key(tabId, String(a.combo));
        await this.settle(tabId);
        // Keys like Tab move focus; let the cursor follow so keyboard navigation is visible.
        const focused = await this.content.send<ElementInfo | null>(tabId, { type: 'focused' }).catch(() => null);
        if (focused) {
          const fr = focused.rect;
          await this.overlay(tabId, { type: 'overlay', op: 'move', x: Math.round(fr.x + fr.w / 2), y: Math.round(fr.y + fr.h / 2) });
        }
        return `Pressed ${a.combo}${times > 1 ? ` ${times} times` : ''}.`;
      }
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

import { describe, expect, it } from 'vitest';
import { ChromeDriver, type CdpLike, type MessengerLike, type TabsLike } from '@/lib/browser/driver';
import type { ContentRequest, ResolveResult } from '@/lib/content/protocol';
import { ToolError } from '@/lib/errors';
import type { ElementInfo, PageSnapshot, TabInfo, ToolCall } from '@/lib/types';

const info = (over: Partial<ElementInfo> = {}): ElementInfo => ({
  id: 4, tag: 'button', role: 'button', name: 'Go', inForm: false, isSubmit: false, download: false,
  rect: { x: 10, y: 20, w: 100, h: 30 }, ...over,
});

function setup(url = 'https://shop.test/') {
  const log: string[] = [];
  const tab = { id: 1, url, title: 'Shop' } as chrome.tabs.Tab;
  const tabs: TabsLike = {
    start: async () => void log.push('tabs.start'),
    stop: () => void log.push('tabs.stop'),
    active: async () => tab,
    list: async (): Promise<TabInfo[]> => [{ index: 0, tabId: 1, title: 'Shop', url: tab.url!, active: true }],
    open: async (u: string) => void log.push(`open:${u}`),
    switchTo: async (i: number) => void log.push(`switch:${i}`),
    close: async (i: number) => void log.push(`close:${i}`),
    navigate: async (u: string) => void log.push(`navigate:${u}`),
    back: async () => void log.push('back'),
    waitForLoad: async () => {},
  };
  const cdp: CdpLike = {
    ensure: async () => void log.push('cdp.ensure'),
    move: async (_t, x, y) => void log.push(`cdp.move:${x},${y}`),
    click: async (_t, x, y) => void log.push(`cdp.click:${x},${y}`),
    wheel: async (_t, x, y, d) => void log.push(`cdp.wheel:${x},${y},${d}`),
    insertText: async (_t, text) => void log.push(`cdp.insert:${text}`),
    key: async (_t, combo) => void log.push(`cdp.key:${combo}`),
    screenshot: async () => 'data:image/jpeg;base64,SHOT',
    detachAll: async () => void log.push('cdp.detachAll'),
    clearCanceled: () => void log.push('cdp.clearCanceled'),
    dispose: () => void log.push('cdp.dispose'),
  };
  const snapshot: PageSnapshot = {
    url, title: 'Shop', restricted: false, elements: [info()], headings: [], scrollY: 0, scrollMaxY: 0, viewport: { w: 1000, h: 800 },
  };
  let resolveResult: ResolveResult = { ok: true, x: 60, y: 35, info: info() };
  const content: MessengerLike = {
    ensureInjected: async () => void log.push('content.inject'),
    send: async <T,>(_t: number, req: ContentRequest): Promise<T> => {
      let detail = '';
      if (req.type === 'overlay' && (req.op === 'move' || req.op === 'click')) detail = `:${req.x},${req.y}`;
      if (req.type === 'overlay' && req.op === 'hover') detail = req.rect ? ':ring' : ':clear';
      log.push(`content.${req.type}${req.type === 'overlay' ? `.${req.op}` : ''}${detail}`);
      if (req.type === 'snapshot') return snapshot as T;
      if (req.type === 'resolve') return resolveResult as T;
      if (req.type === 'readText') return 'PAGE TEXT' as T;
      if (req.type === 'select') return 'Selected "M".' as T;
      if (req.type === 'focused') return info({ tag: 'input', inForm: true }) as T;
      return null as T;
    },
  };
  const driver = new ChromeDriver(tabs, cdp, content, { isMac: false, settleMs: 0 });
  return { driver, log, tab, setResolve: (r: ResolveResult) => (resolveResult = r) };
}
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: 'c', name, args });

describe('ChromeDriver.observe', () => {
  it('returns a restricted snapshot for browser pages without touching the page', async () => {
    const { driver, log } = setup('chrome://settings/');
    const o = await driver.observe({ mode: 'compact', screenshot: true });
    expect(o.snapshot.restricted).toBe(true);
    expect(o.screenshot).toBeUndefined();
    expect(log.filter((l) => l.startsWith('content') || l.startsWith('cdp'))).toEqual([]);
  });

  it('attaches, injects, activates the overlay and snapshots; screenshots only when asked', async () => {
    const { driver, log } = setup();
    const o = await driver.observe({ mode: 'compact', screenshot: false });
    expect(o.snapshot.elements).toHaveLength(1);
    expect(o.screenshot).toBeUndefined();
    expect(log).toEqual(['cdp.ensure', 'content.inject', 'content.overlay.active', 'content.snapshot']);
    expect((await driver.observe({ mode: 'compact', screenshot: true })).screenshot).toBe('data:image/jpeg;base64,SHOT');
  });
});

describe('ChromeDriver.target', () => {
  it('resolves elements to points', async () => {
    const { driver } = setup();
    expect(await driver.target(call('click', { id: 4 }))).toEqual({ tabId: 1, origin: 'https://shop.test', element: info(), point: { x: 60, y: 35 } });
  });
  it('turns stale ids into ToolError', async () => {
    const { driver, setResolve } = setup();
    setResolve({ ok: false, error: 'Element [4] no longer exists on the page.' });
    await expect(driver.target(call('click', { id: 4 }))).rejects.toThrow(new ToolError('Element [4] no longer exists on the page.'));
  });
  it('refuses element actions on browser pages', async () => {
    const { driver } = setup('chrome://newtab/');
    await expect(driver.target(call('click', { id: 1 }))).rejects.toBeInstanceOf(ToolError);
  });
  it('uses the destination origin for navigation and the focused element for keys', async () => {
    const { driver } = setup();
    expect((await driver.target(call('navigate', { url: 'https://other.test/x' }))).origin).toBe('https://other.test');
    expect((await driver.target(call('key', { combo: 'Enter' }))).element?.inForm).toBe(true);
  });
});

describe('ChromeDriver.perform', () => {
  it('moves the overlay cursor before the real click', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('click', { id: 4 }));
    log.length = 0;
    expect(await driver.perform(call('click', { id: 4 }), t, 'compact')).toBe('Clicked button "Go".');
    expect(log).toEqual([
      'content.overlay.move:60,35',
      'content.overlay.hover:ring',
      'cdp.click:60,35',
      'content.overlay.click:60,35',
      'content.overlay.hover:clear',
    ]);
  });

  it('types by focusing, clearing, inserting and optionally pressing Enter', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('type', { id: 4 }));
    log.length = 0;
    await driver.perform(call('type', { id: 4, text: 'socks', submit: true }), t, 'compact');
    expect(log.filter((l) => l.startsWith('cdp'))).toEqual([
      'cdp.click:60,35',
      'cdp.key:Control+a',
      'cdp.key:Backspace',
      'cdp.insert:socks',
      'cdp.key:Enter',
    ]);
  });

  it('clears the hover ring after typing so it does not stay stuck on the page', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('type', { id: 4 }));
    log.length = 0;
    await driver.perform(call('type', { id: 4, text: 'x' }), t, 'compact');
    expect(log.at(-1)).toBe('content.overlay.hover:clear');
  });

  it('moves the cursor to the focused element before pressing a key', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('key', { combo: 'Tab' }));
    log.length = 0;
    await driver.perform(call('key', { combo: 'Tab' }), t, 'compact');
    expect(log.indexOf('content.overlay.move:60,35')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('content.overlay.move:60,35')).toBeLessThan(log.indexOf('cdp.key:Tab'));
    expect(log.at(-1)).toBe('content.overlay.hover:clear');
  });

  it('follows focus with the cursor after a key press (e.g. Tab)', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('key', { combo: 'Tab' }));
    log.length = 0;
    await driver.perform(call('key', { combo: 'Tab' }), t, 'compact');
    const afterKey = log.slice(log.indexOf('cdp.key:Tab') + 1);
    expect(afterKey).toEqual(['content.focused', 'content.overlay.move:60,35', 'content.overlay.hover:clear']);
  });

  it('scrolls the page with a wheel event at the viewport center', async () => {
    const { driver, log } = setup();
    await driver.observe({ mode: 'compact', screenshot: false });
    const t = await driver.target(call('scroll', { direction: 'down' }));
    log.length = 0;
    await driver.perform(call('scroll', { direction: 'down' }), t, 'compact');
    expect(log).toContain('content.overlay.move:500,400');
    // Smooth: the 640px scroll is split into 8 small wheel steps instead of one jump.
    expect(log.filter((l) => l.startsWith('cdp.wheel'))).toEqual(Array(8).fill('cdp.wheel:500,400,80'));
  });

  it('wraps read_text as untrusted page content', async () => {
    const { driver } = setup();
    const t = await driver.target(call('read_text'));
    expect(await driver.perform(call('read_text'), t, 'compact')).toBe('<page_content untrusted="true">\nPAGE TEXT\n</page_content>');
  });

  it('delegates tab tools to AgentTabs', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('back'));
    await driver.perform(call('navigate', { url: 'https://a.test/' }), t, 'compact');
    await driver.perform(call('new_tab', { url: 'https://b.test/' }), t, 'compact');
    await driver.perform(call('switch_tab', { index: 0 }), t, 'compact');
    await driver.perform(call('close_tab', { index: 1 }), t, 'compact');
    await driver.perform(call('back'), t, 'compact');
    expect(log).toEqual(expect.arrayContaining(['navigate:https://a.test/', 'open:https://b.test/', 'switch:0', 'close:1', 'back']));
  });

  it('stop deactivates the overlay and detaches', async () => {
    const { driver, log } = setup();
    await driver.stop();
    expect(log).toEqual(['content.overlay.active', 'cdp.detachAll', 'cdp.dispose', 'tabs.stop']);
  });
});

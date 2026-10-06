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
  let handler: ((tabId: number) => Promise<void>) | null = null;
  const cdp: CdpLike = {
    setConflictHandler: (fn) => {
      handler = fn;
    },
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
  let focused: ElementInfo | null = info({ tag: 'input', inForm: true });
  let pointInfo: ElementInfo | null = info({ tag: 'div', role: 'generic', name: 'A1', rect: { x: 100, y: 40, w: 80, h: 20 } });
  const fitted: string[] = [];
  const labels: string[] = [];
  const content: MessengerLike = {
    ensureInjected: async () => void log.push('content.inject'),
    send: async <T,>(_t: number, req: ContentRequest): Promise<T> => {
      if (req.type === 'overlay' && req.op === 'move' && req.label) labels.push(req.label);
      let detail = '';
      if (req.type === 'overlay' && (req.op === 'move' || req.op === 'click')) detail = `:${req.x},${req.y}`;
      if (req.type === 'overlay' && req.op === 'hover') detail = req.rect ? ':ring' : ':clear';
      if (req.type === 'guard') detail = req.on ? ':on' : ':off';
      log.push(`content.${req.type}${req.type === 'overlay' ? `.${req.op}` : ''}${detail}`);
      if (req.type === 'snapshot') return snapshot as T;
      if (req.type === 'resolve') return resolveResult as T;
      if (req.type === 'readText') return 'PAGE TEXT' as T;
      if (req.type === 'select') return 'Selected "M".' as T;
      if (req.type === 'focused') return focused as T;
      if (req.type === 'pointInfo') return pointInfo as T;
      return null as T;
    },
  };
  const driver = new ChromeDriver(tabs, cdp, content, {
    isMac: false,
    settleMs: 0,
    fitImage: async (d, w, h) => {
      fitted.push(`${w}x${h}`);
      return `${d}#fit`;
    },
  });
  return {
    driver,
    log,
    tab,
    fitted,
    labels,
    conflictHandler: () => handler,
    setResolve: (r: ResolveResult) => (resolveResult = r),
    setFocused: (e: ElementInfo | null) => (focused = e),
    setPointInfo: (e: ElementInfo | null) => (pointInfo = e),
  };
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
    // Other extensions' frames are suspended before attaching, since they block the debugger.
    expect(log).toEqual(['content.inject', 'content.guard:on', 'cdp.ensure', 'content.overlay.active', 'content.snapshot']);
    // Screenshots are scaled to the CSS viewport so x/y from the model line up with the page.
    expect((await driver.observe({ mode: 'compact', screenshot: true })).screenshot).toBe('data:image/jpeg;base64,SHOT#fit');
  });
});

describe('ChromeDriver extension conflicts', () => {
  it('registers a conflict handler that re-suspends foreign frames', async () => {
    const { log, conflictHandler } = setup();
    await conflictHandler()!(1);
    expect(log).toContain('content.guard:on');
  });

  it('suspends foreign frames before re-attaching on Retry', async () => {
    const { driver, log } = setup();
    await driver.reattach();
    expect(log.filter((l) => l === 'content.guard:on' || l === 'cdp.ensure')).toEqual(['content.guard:on', 'cdp.ensure']);
  });

  it('restores suspended frames when the task stops', async () => {
    const { driver, log } = setup();
    await driver.observe({ mode: 'compact', screenshot: false });
    log.length = 0;
    await driver.stop();
    expect(log).toContain('content.guard:off');
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
  it('refuses to click, type into or hover an element something else is drawn over', async () => {
    const { driver, setResolve } = setup();
    setResolve({ ok: true, x: 60, y: 35, info: info(), coveredBy: info({ tag: 'div', role: 'listbox', name: 'Search options' }) });
    for (const name of ['click', 'type', 'hover']) {
      await expect(driver.target(call(name, { id: 4, text: 'x' }))).rejects.toThrow(/covered by listbox "Search options".*Escape/);
    }
    // Scrolling to it or picking a <select> option does not go through the pointer.
    expect((await driver.target(call('scroll', { id: 4 }))).point).toEqual({ x: 60, y: 35 });
    expect((await driver.target(call('select', { id: 4, value: 'M' }))).point).toEqual({ x: 60, y: 35 });
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

describe('ChromeDriver coordinate and focus targets', () => {
  it('resolves x/y to whatever is drawn there', async () => {
    const { driver, log } = setup();
    await driver.observe({ mode: 'compact', screenshot: false });
    const t = await driver.target(call('click', { x: 140, y: 50 }));
    expect(t).toMatchObject({ tabId: 1, origin: 'https://shop.test', point: { x: 140, y: 50 }, element: { name: 'A1' } });
    expect(log).toContain('content.pointInfo');
  });

  it('still targets a point when nothing describable is there', async () => {
    const { driver, setPointInfo } = setup();
    setPointInfo(null);
    expect(await driver.target(call('click', { x: 5, y: 5 }))).toEqual({ tabId: 1, origin: 'https://shop.test', point: { x: 5, y: 5 } });
  });

  it('rejects points outside the screenshot', async () => {
    const { driver } = setup();
    await driver.observe({ mode: 'compact', screenshot: false });
    await expect(driver.target(call('click', { x: 1000, y: 10 }))).rejects.toThrow('(1000, 10) is outside the 1000×800 screenshot.');
  });

  it('type without id or x/y targets the focused element without moving the mouse', async () => {
    const { driver, log, setFocused } = setup();
    setFocused(info({ tag: 'textarea', role: 'textbox', name: '', inForm: false }));
    const t = await driver.target(call('type', { text: 'Rent' }));
    expect(t.point).toBeUndefined();
    expect(t.element?.tag).toBe('textarea');
    log.length = 0;
    expect(await driver.perform(call('type', { text: 'Rent' }), t, 'compact')).toBe('Typed into textbox "textarea".');
    expect(log.filter((l) => l.startsWith('cdp'))).toEqual(['cdp.insert:Rent']);
  });
});

describe('ChromeDriver.perform', () => {
  it('clicks at screenshot coordinates', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('click', { x: 140, y: 50 }));
    log.length = 0;
    expect(await driver.perform(call('click', { x: 140, y: 50 }), t, 'compact')).toBe('Clicked generic "A1".');
    expect(log.filter((l) => l.startsWith('cdp'))).toEqual(['cdp.click:140,50']);
  });

  it('types a table in one call: tabs press Tab, newlines press Enter, and nothing is select-all cleared', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('type', { x: 140, y: 50, text: '' }));
    log.length = 0;
    await driver.perform(call('type', { x: 140, y: 50, text: 'Rent\t1200\r\nFood\t450\n' }), t, 'compact');
    expect(log.filter((l) => l.startsWith('cdp'))).toEqual([
      'cdp.click:140,50',
      'cdp.insert:Rent',
      'cdp.key:Tab',
      'cdp.insert:1200',
      'cdp.key:Enter',
      'cdp.insert:Food',
      'cdp.key:Tab',
      'cdp.insert:450',
      'cdp.key:Enter',
    ]);
  });

  it('clears before typing only when asked, unless targeting a field by id', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('type', { text: 'x' }));
    log.length = 0;
    await driver.perform(call('type', { text: 'x', clear: true }), t, 'compact');
    expect(log.filter((l) => l.startsWith('cdp'))).toEqual(['cdp.key:Control+a', 'cdp.key:Backspace', 'cdp.insert:x']);
  });

  it('repeats a key press', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('key', { combo: 'Tab' }));
    log.length = 0;
    expect(await driver.perform(call('key', { combo: 'Tab', repeat: 3 }), t, 'compact')).toBe('Pressed Tab 3 times.');
    expect(log.filter((l) => l.startsWith('cdp'))).toEqual(['cdp.key:Tab', 'cdp.key:Tab', 'cdp.key:Tab']);
  });

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

  it('clears the ring right after the click, before waiting for the page to settle', async () => {
    const { driver, log } = setup();
    const t = await driver.target(call('click', { id: 4 }));
    log.length = 0;
    await driver.perform(call('click', { id: 4 }), t, 'compact');
    expect(log.indexOf('content.overlay.hover:clear')).toBe(log.indexOf('content.overlay.click:60,35') + 1);
  });

  it('sends the step description with cursor moves so the page can label the cursor', async () => {
    const { driver, labels } = setup();
    const t = await driver.target(call('click', { id: 4 }));
    await driver.perform(call('click', { id: 4 }), t, 'compact');
    expect(labels).toEqual(['Clicking a button']);
  });

  it('keeps the label off focus-follow moves after a key press', async () => {
    const { driver, labels } = setup();
    const t = await driver.target(call('key', { combo: 'Tab' }));
    await driver.perform(call('key', { combo: 'Tab' }), t, 'compact');
    expect(labels.every((l) => l.startsWith('Press'))).toBe(true);
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
    expect(log.filter((l) => l.endsWith('hover:clear'))).toHaveLength(1);
    expect(log.indexOf('content.overlay.hover:clear')).toBeLessThan(log.indexOf('cdp.insert:x'));
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

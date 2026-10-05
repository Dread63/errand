// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameGuard as RealFrameGuard } from '@/lib/content/guard';

// Guards observe the shared test document; stop each one so it can't affect later tests.
const guards: RealFrameGuard[] = [];
class FrameGuard extends RealFrameGuard {
  constructor(doc: Document, id: string) {
    super(doc, id);
    guards.push(this);
  }
}
afterEach(() => guards.splice(0).forEach((g) => g.stop()));

const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = (src: string, id: string) => {
  const f = document.createElement('iframe');
  f.setAttribute('src', src);
  f.id = id;
  return f;
};

beforeEach(() => {
  document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
});

describe('FrameGuard', () => {
  it("removes other extensions' frames but keeps ours and normal frames", () => {
    document.getElementById('a')!.append(frame('chrome-extension://other/x.html', 'foreign'), frame('chrome-extension://mine/y.html', 'own'), frame('https://site.test/', 'web'));
    const removed = new FrameGuard(document, 'mine').start();
    expect(removed).toEqual(['other']);
    expect(document.getElementById('foreign')).toBeNull();
    expect(document.getElementById('own')).not.toBeNull();
    expect(document.getElementById('web')).not.toBeNull();
  });

  it('keeps removing frames that are re-added while active', async () => {
    const g = new FrameGuard(document, 'mine');
    g.start();
    const late = frame('chrome-extension://other/x.html', 'late');
    document.getElementById('b')!.append(late);
    await tick();
    expect(late.isConnected).toBe(false);
    g.stop();
    expect(late.isConnected).toBe(true); // restored
    const after = frame('chrome-extension://other/x.html', 'after');
    document.getElementById('b')!.append(after);
    await tick();
    expect(after.isConnected).toBe(true); // no longer guarded
  });

  it('finds frames inside shadow roots', () => {
    const host = document.getElementById('a')!;
    host.attachShadow({ mode: 'open' }).append(frame('chrome-extension://other/x.html', 'shadowed'));
    new FrameGuard(document, 'mine').start();
    expect(host.shadowRoot!.getElementById('shadowed')).toBeNull();
  });

  it('restores only one copy of a frame that was re-added several times', async () => {
    const g = new FrameGuard(document, 'mine');
    g.start();
    for (let i = 0; i < 3; i++) {
      document.getElementById('b')!.append(frame('chrome-extension://other/x.html', `copy${i}`));
      await tick();
    }
    g.stop();
    expect(document.querySelectorAll('iframe[src="chrome-extension://other/x.html"]')).toHaveLength(1);
  });

  it('stops fighting an extension that re-adds its frame instantly, instead of looping forever', async () => {
    const b = document.getElementById('b')!;
    const add = () => b.append(frame('chrome-extension://stubborn/x.html', 'stubborn'));
    add();
    // The other extension re-adds its frame as soon as it is removed.
    new MutationObserver(() => {
      if (!document.querySelector('iframe[src^="chrome-extension://stubborn"]')) add();
    }).observe(document.body, { childList: true, subtree: true });
    const g = new FrameGuard(document, 'mine');
    g.start();
    for (let i = 0; i < 200; i++) await tick();
    expect(g.stubborn()).toEqual(['stubborn']);
    expect(document.querySelector('iframe[src^="chrome-extension://stubborn"]')).not.toBeNull();
  });

  it('restores removed frames in their original place on stop', () => {
    const a = document.getElementById('a')!;
    a.append(document.createElement('span'), frame('chrome-extension://other/x.html', 'foreign'), document.createElement('em'));
    const g = new FrameGuard(document, 'mine');
    g.start();
    g.stop();
    expect(Array.from(a.children).map((c) => c.tagName)).toEqual(['SPAN', 'IFRAME', 'EM']);
  });
});

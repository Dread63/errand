// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Overlay, OVERLAY_HOST_ID } from '@/lib/content/overlay';

beforeEach(() => {
  document.documentElement.querySelectorAll(`#${OVERLAY_HOST_ID}`).forEach((n) => n.remove());
});

describe('Overlay', () => {
  it('mounts one host and toggles the active border and cursor', () => {
    const o = new Overlay(document, 0);
    expect(document.querySelectorAll(`#${OVERLAY_HOST_ID}`)).toHaveLength(1);
    o.setActive(true);
    expect(o.shadow.querySelector('.border')!.classList.contains('on')).toBe(true);
    expect(o.shadow.querySelector('.cursor')!.classList.contains('on')).toBe(true);
    o.setActive(false);
    expect(o.shadow.querySelector('.border')!.classList.contains('on')).toBe(false);
  });

  it('moves the cursor and resolves after the animation', async () => {
    const o = new Overlay(document, 0);
    await o.moveTo(120, 80);
    expect((o.shadow.querySelector('.cursor') as HTMLElement).style.transform).toBe('translate(120px, 80px)');
  });

  it('shows and hides highlight boxes with a label', () => {
    const o = new Overlay(document, 0);
    o.highlight({ x: 10, y: 20, w: 100, h: 30 }, 'Waiting for your approval');
    const hl = o.shadow.querySelector('.highlight') as HTMLElement;
    expect(hl.style.display).toBe('block');
    expect(hl.style.left).toBe('7px');
    expect(o.shadow.querySelector('.label')!.textContent).toBe('Waiting for your approval');
    o.highlight(null);
    expect(hl.style.display).toBe('none');
  });

  it('re-attaches if the page removed the host', () => {
    const o = new Overlay(document, 0);
    document.getElementById(OVERLAY_HOST_ID)!.remove();
    o.setActive(true);
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull();
  });

  it('adds a click ripple', () => {
    const o = new Overlay(document, 0);
    o.click(5, 5);
    expect(o.shadow.querySelectorAll('.ripple')).toHaveLength(1);
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { arcPoint, labelPlacement, moveDuration, Overlay, OVERLAY_HOST_ID } from '@/lib/content/overlay';

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

  it('replaces a stale overlay left behind by a previous extension version', () => {
    const stale = document.createElement('div');
    stale.id = OVERLAY_HOST_ID;
    document.documentElement.appendChild(stale);
    new Overlay(document, 0);
    expect(document.querySelectorAll(`#${OVERLAY_HOST_ID}`)).toHaveLength(1);
    expect(stale.isConnected).toBe(false);
  });

  it('adds a click ripple', () => {
    const o = new Overlay(document, 0);
    o.click(5, 5);
    expect(o.shadow.querySelectorAll('.ripple')).toHaveLength(1);
  });
  it('shows the action label with the cursor, keeps it across unlabeled moves, and clears it when inactive', async () => {
    const o = new Overlay(document, 0);
    o.setActive(true);
    await o.moveTo(10, 10, 'Click button "Nonstop only"');
    const tag = o.shadow.querySelector('.tag') as HTMLElement;
    expect(tag.textContent).toBe('Click button "Nonstop only"');
    expect(tag.classList.contains('on')).toBe(true);
    await o.moveTo(20, 20);
    expect(tag.textContent).toBe('Click button "Nonstop only"');
    o.setActive(false);
    expect(tag.classList.contains('on')).toBe(false);
    expect(tag.textContent).toBe('');
  });

  it('truncates long labels to 40 characters', async () => {
    const o = new Overlay(document, 0);
    await o.moveTo(0, 0, 'x'.repeat(60));
    expect(o.shadow.querySelector('.tag')!.textContent).toBe(`${'x'.repeat(39)}…`);
  });

  it('flips the label away from the right and bottom edges', () => {
    expect(labelPlacement(100, 100, 120, 22, 1000, 800)).toEqual({ left: false, above: false });
    expect(labelPlacement(950, 100, 120, 22, 1000, 800)).toEqual({ left: true, above: false });
    expect(labelPlacement(100, 790, 120, 22, 1000, 800)).toEqual({ left: false, above: true });
  });

  it('bends the path a little, more for longer moves but never past 60px', () => {
    const mid = arcPoint({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(mid.x).toBe(50);
    expect(Math.abs(mid.y)).toBeCloseTo(12, 0);
    const far = arcPoint({ x: 0, y: 0 }, { x: 2000, y: 0 });
    expect(Math.abs(far.y)).toBe(60);
    expect(arcPoint({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('scales move duration with distance between 180 and 450 ms', () => {
    expect(moveDuration(0)).toBe(180);
    expect(moveDuration(5000)).toBe(450);
    expect(moveDuration(400)).toBeGreaterThan(180);
    expect(moveDuration(400)).toBeLessThan(450);
  });
});

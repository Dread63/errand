import { describe, expect, it } from 'vitest';
import { fit, logoSvg, ringArc } from '@/lib/ui/logo';

const CURSOR_EDGES = [90, (Math.atan2(37, 38) * 180) / Math.PI];

describe('logoSvg', () => {
  it('is a 128 viewBox SVG with the ring gradient and the cursor', () => {
    const svg = logoSvg();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 128 128"');
    expect(svg).toContain('#9579ff');
    expect(svg).toContain('#5b3fe0');
    expect(svg).toContain('M0 0 L0 52');
  });

  it('uses the given id for its gradient so several logos can share a page', () => {
    expect(logoSvg({ id: 'a' })).toContain('id="a-g"');
    expect(logoSvg({ id: 'b' })).toContain('url(#b-g)');
  });

  it('leaves equal clearance either side of the cursor', () => {
    for (const small of [false, true]) {
      const { start, end } = ringArc(small);
      const deg = ([x, y]: [number, number]) => ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      const startPad = deg(start) - CURSOR_EDGES[0];
      const endPad = CURSOR_EDGES[1] - deg(end);
      expect(startPad).toBeGreaterThan(0);
      expect(Math.abs(startPad - endPad)).toBeLessThan(0.01);
    }
  });

  it('keeps the artwork inside the central 96px of the canvas, centred', () => {
    for (const small of [false, true]) {
      const { box } = fit(small);
      expect(box.x0).toBeGreaterThanOrEqual(16 - 1e-9);
      expect(box.y0).toBeGreaterThanOrEqual(16 - 1e-9);
      expect(box.x1).toBeLessThanOrEqual(112 + 1e-9);
      expect(box.y1).toBeLessThanOrEqual(112 + 1e-9);
      expect(Math.abs(box.x0 + box.x1 - 128)).toBeLessThan(1e-6);
      expect(Math.abs(box.y0 + box.y1 - 128)).toBeLessThan(1e-6);
    }
  });
});

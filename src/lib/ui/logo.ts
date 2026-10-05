// The Errand mark: an open ring with a cursor whose tip sits at the ring's centre and whose body
// leaves through the ring's gap. Shared by the in-app <Logo> and scripts/build-icons.ts, so it
// must stay plain, dependency-free TypeScript (Node runs that script with type stripping).

const CURSOR = 'M0 0 L0 52 L12.5 40 L21 59 L30 55 L21.5 37 L38 37 Z';
const CURSOR_W = 38;
const CURSOR_H = 59;
/** The cursor body spans these directions from its tip, in degrees clockwise from +x. */
const RIGHT_EDGE = (Math.atan2(37, 38) * 180) / Math.PI;
const LEFT_EDGE = 90;

interface Geometry {
  r: number;
  stroke: number;
  cursorScale: number;
  clearance: number;
}

const REGULAR: Geometry = { r: 42, stroke: 15, cursorScale: 1.08, clearance: 6 };
/** Heavier strokes and a wider gap so the mark survives 16 and 32px. */
const SMALL: Geometry = { r: 36, stroke: 18, cursorScale: 1.3, clearance: 13 };

const geometry = (small: boolean) => (small ? SMALL : REGULAR);
const point = (r: number, deg: number): [number, number] => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
const n = (v: number) => +v.toFixed(3);

/** The ring arc, centred on the origin, leaving equal clearance either side of the cursor body. */
export function ringArc(small = false): { d: string; start: [number, number]; end: [number, number] } {
  const { r, stroke, clearance } = geometry(small);
  const pad = ((stroke / 2 + clearance) / r) * (180 / Math.PI);
  const start = point(r, LEFT_EDGE + pad);
  const end = point(r, RIGHT_EDGE - pad);
  return { d: `M${n(start[0])} ${n(start[1])} A${r} ${r} 0 1 1 ${n(end[0])} ${n(end[1])}`, start, end };
}

/**
 * Scale and offset that centre the mark's bounding box in a `safe`-sized square of the 128 canvas.
 * Chrome wants 96 (16px padding) for the store icon; toolbar sizes use nearly the whole canvas.
 */
export function fit(small = false, safe = 96): { k: number; tx: number; ty: number; box: { x0: number; y0: number; x1: number; y1: number } } {
  const { r, stroke, cursorScale } = geometry(small);
  const outer = r + stroke / 2;
  const x0 = -outer;
  const y0 = -outer;
  const x1 = Math.max(outer, CURSOR_W * cursorScale + 1);
  const y1 = Math.max(outer, CURSOR_H * cursorScale + 1);
  const k = safe / Math.max(x1 - x0, y1 - y0);
  const tx = 64 - (k * (x0 + x1)) / 2;
  const ty = 64 - (k * (y0 + y1)) / 2;
  return { k, tx, ty, box: { x0: tx + k * x0, y0: ty + k * y0, x1: tx + k * x1, y1: ty + k * y1 } };
}

export function logoSvg({ size = 128, small = false, safe = 96, id = 'errand' }: { size?: number; small?: boolean; safe?: number; id?: string } = {}): string {
  const { stroke, cursorScale } = geometry(small);
  const { k, tx, ty } = fit(small, safe);
  const g = `${id}-g`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128" role="img" aria-label="Errand">` +
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9579ff"/><stop offset="1" stop-color="#5b3fe0"/></linearGradient></defs>` +
    `<g transform="translate(${n(tx)} ${n(ty)}) scale(${n(k)})">` +
    `<path d="${ringArc(small).d}" fill="none" stroke="url(#${g})" stroke-width="${stroke}" stroke-linecap="round"/>` +
    `<path d="${CURSOR}" transform="scale(${cursorScale})" fill="#7c5cff" stroke="#7c5cff" stroke-width="${n(2 / cursorScale)}" stroke-linejoin="round"/>` +
    `</g></svg>`
  );
}

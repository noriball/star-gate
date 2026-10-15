import type { ColorParams, WheelStyle } from './config';

/** State of one "random wheel": filter densities (C,M,Y), overall filter strength, invert amount. */
export interface WheelState { cmy: [number, number, number]; strength: number; invert: number }

/** Deterministic hash -> [0,1). Pure integer maths, identical on every platform. */
export function hash01(...v: number[]): number {
  let h = 0x811c9dc5;
  for (const n of v) {
    h ^= n | 0; h = Math.imul(h, 0x01000193);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function stepState(seed: number, wheel: number, k: number, style: WheelStyle): WheelState {
  const h = (j: number) => hash01(seed, wheel, k, j);
  if (style === 'classic') {
    return { cmy: [h(0), h(1), h(2)], strength: 0.3 + 0.7 * h(3), invert: h(4) < 0.25 ? 1 : 0 };
  }
  // vivid: stretch the random CMY triple to full range (max 1, min 0) so every filter is a saturated colour
  const raw = [h(0), h(1), h(2)], lo = Math.min(...raw), hi = Math.max(...raw), sp = hi - lo || 1;
  return { cmy: raw.map(v => (v - lo) / sp) as [number, number, number], strength: 0.3 + 0.5 * h(3), invert: h(4) < 0.15 ? 1 : 0 };
}

/** Wheel state at animation frame `frame` (fractional ok). Depends only on its arguments. */
export function wheelState(c: Pick<ColorParams, 'seed' | 'mode' | 'period'> & { wheelStyle?: WheelStyle }, wheel: number, frame: number): WheelState {
  const style = c.wheelStyle ?? 'classic';
  const period = Math.max(1, c.period);
  const x = frame / period;
  const k = Math.floor(x);
  const a = stepState(c.seed, wheel, k, style);
  if (c.mode === 'step') return a;
  const b = stepState(c.seed, wheel, k + 1, style);
  const t = smooth(x - k);
  const m = (p: number, q: number) => p + (q - p) * t;
  return {
    cmy: [m(a.cmy[0], b.cmy[0]), m(a.cmy[1], b.cmy[1]), m(a.cmy[2], b.cmy[2])],
    strength: m(a.strength, b.strength),
    // classic: plain blend; vivid: flip quickly around the segment midpoint instead of drifting through flat grey
    invert: style === 'classic' ? m(a.invert, b.invert) : a.invert + (b.invert - a.invert) * smooth(Math.min(1, Math.max(0, (x - k - 0.45) / 0.1))),
  };
}

export const wheelStates = (c: ColorParams, frame: number): WheelState[] => [0, 1, 2].map(w => wheelState(c, w, frame));

// CPU reference of the colour pass in shaders.ts (DISPLAY_FS). Keep in sync.
import type { ColorParams, Contrast, StripSpec } from './config';
import type { WheelState } from './wheel';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function curve(v: number, kind: Contrast, c: Pick<ColorParams, 'contrastHigh' | 'contrastLow'> & { lowCurve?: ColorParams['lowCurve'] }): number {
  if (kind === 'none') return v;
  // high: steep S-ish ramp about mid-grey (clips blacks/whites); low: gamma lift that keeps true black at 0
  if (kind === 'low') return c.lowCurve === 'gamma' ? Math.pow(Math.max(v, 0), c.contrastLow) : clamp01((v - 0.5) * c.contrastLow + 0.5);
  return clamp01((v - 0.5) * c.contrastHigh + 0.5);
}

const PRIMARY: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// Filter colour = 1 - density (cyan filter removes red, etc.)
const BASE_FILTER: Record<string, [number, number, number]> = { C: [1, 0, 0], M: [0, 1, 0], Y: [0, 0, 1] };

export function stripTint(s: StripSpec, w: WheelState): [number, number, number] {
  const cmy = s.filter === 'wheel' ? w.cmy : BASE_FILTER[s.filter];
  const pr = PRIMARY[s.channel];
  return [0, 1, 2].map(i => {
    const filt = 1 - cmy[i];
    return pr[i] + (filt - pr[i]) * w.strength;
  }) as [number, number, number];
}

/**
 * Output saturation: Rec.709 luma-preserving mix between the grey (luma) and the colour. 0 = greyscale, 1 = identity.
 * Above 1 the boost is limited per pixel so no channel leaves [0,1]: hue and luma are kept and nothing is clipped
 * (saturated colours simply stop gaining chroma at the gamut edge).
 */
export function saturate(rgb: [number, number, number], sat: number): [number, number, number] {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const d = rgb.map(v => v - l);
  let k = Math.max(sat, 0);
  if (k > 1) {
    let lim = k;
    for (const x of d) { if (x < -1e-12) lim = Math.min(lim, l / -x); else if (x > 1e-12) lim = Math.min(lim, (1 - l) / x); }
    k = Math.max(1, lim);
  }
  return d.map(x => clamp01(l + x * k)) as [number, number, number];
}

/** rgb in [0,1] (linear, post-tonemap) -> recombined rgb. */
export function applyColor(rgb: [number, number, number], c: ColorParams, wheels: WheelState[]): [number, number, number] {
  const n = c.strips.length;
  const norm = 3 / n;
  let add: [number, number, number] = [0, 0, 0];
  let screen: [number, number, number] = [1, 1, 1];
  for (const s of c.strips) {
    const w = wheels[s.wheel];
    let v = curve(rgb[s.channel], s.contrast, c);
    v = v + (1 - 2 * v) * w.invert;
    const t = stripTint(s, w);
    for (let i = 0; i < 3; i++) {
      const k = v * t[i] * s.weight * norm;
      add[i] += k;
      screen[i] *= 1 - clamp01(k);
    }
  }
  const out = c.mix === 'add' ? (add.map(clamp01) as [number, number, number]) : ([0, 1, 2].map(i => 1 - screen[i]) as [number, number, number]);
  return out;
}

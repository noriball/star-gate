import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOR, STRIP_PRESETS, parseStrips, type ColorParams } from '../src/color/config';
import { wheelState, wheelStates, hash01 } from '../src/color/wheel';
import { applyColor } from '../src/color/pipeline';

const HASH_123 = 0.47373863449320197;
const base = (o: Partial<ColorParams> = {}): ColorParams => ({ ...JSON.parse(JSON.stringify(DEFAULT_COLOR)), ...o });

describe('colour wheel determinism', () => {
  it('same seed/wheel/frame gives identical state, regardless of call order', () => {
    const c = base({ seed: 42 });
    const a = [0, 17, 95.5, 300].map(f => wheelState(c, 1, f));
    const b = [300, 95.5, 17, 0].map(f => wheelState(c, 1, f)).reverse();
    expect(b).toEqual(a);
  });

  it('pins a known value (guards against accidental change of the hash/stream)', () => {
    expect(hash01(1, 2, 3)).toBeCloseTo(HASH_123, 12);
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
    const s = wheelState(base({ seed: 1, mode: 'step', period: 10 }), 0, 0);
    expect(s).toEqual(wheelState(base({ seed: 1, mode: 'step', period: 10 }), 0, 9.99));
  });

  it('different seeds or wheels differ', () => {
    expect(wheelState(base({ seed: 1 }), 0, 5)).not.toEqual(wheelState(base({ seed: 2 }), 0, 5));
    expect(wheelState(base({ seed: 1 }), 0, 5)).not.toEqual(wheelState(base({ seed: 1 }), 1, 5));
  });

  it('step mode is constant within a period and jumps at the boundary', () => {
    const c = base({ mode: 'step', period: 24 });
    expect(wheelState(c, 0, 0)).toEqual(wheelState(c, 0, 23.9));
    expect(wheelState(c, 0, 24)).toEqual(wheelState(c, 0, 47));
    expect(wheelState(c, 0, 23.9)).not.toEqual(wheelState(c, 0, 24));
    for (const f of [0, 24, 48, 72]) { const i = wheelState(c, 0, f).invert; expect([0, 1]).toContain(i); }
  });

  it('smooth mode is continuous and hits the step values at segment starts', () => {
    const s = base({ mode: 'smooth', period: 24 }), t = base({ mode: 'step', period: 24 });
    expect(wheelState(s, 2, 48)).toEqual(wheelState(t, 2, 48));
    const a = wheelState(s, 2, 23.999), b = wheelState(s, 2, 24.001);
    expect(a.strength).toBeCloseTo(b.strength, 3);
    expect(a.cmy[0]).toBeCloseTo(b.cmy[0], 3);
  });

  it('all values stay in range', () => {
    const c = base({ seed: 9 });
    for (let f = 0; f < 500; f += 7) for (const w of wheelStates(c, f)) {
      for (const v of [...w.cmy, w.strength, w.invert]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
});

describe('strip config + mixing', () => {
  it('presets have the expected strip counts', () => {
    expect(STRIP_PRESETS['rgb-3']).toHaveLength(3);
    expect(STRIP_PRESETS['rgb-6']).toHaveLength(6);
    expect(STRIP_PRESETS['rgb-12']).toHaveLength(12);
  });

  it('parseStrips accepts valid config and rejects bad config', () => {
    expect(parseStrips(STRIP_PRESETS['rgb-12'])).toHaveLength(12);
    expect(() => parseStrips([])).toThrow();
    expect(() => parseStrips([{ channel: 3, contrast: 'none', wheel: 0, filter: 'C' }])).toThrow(/channel/);
  });

  it('identity config (no contrast, zero filter strength, no invert) passes colour through at any strip count', () => {
    for (const preset of ['rgb-3', 'rgb-6', 'rgb-12']) {
      const c = base({ saturation: 1, strips: STRIP_PRESETS[preset].map(s => ({ ...s, contrast: 'none' as const })) });
      const flat = [0, 1, 2].map(() => ({ cmy: [0.5, 0.5, 0.5] as [number, number, number], strength: 0, invert: 0 }));
      const out = applyColor([0.2, 0.5, 0.9], c, flat);
      expect(out[0]).toBeCloseTo(0.2, 12); expect(out[1]).toBeCloseTo(0.5, 12); expect(out[2]).toBeCloseTo(0.9, 12);
    }
  });

  it('full invert flips each channel; output is deterministic', () => {
    const c = base({ saturation: 1, strips: STRIP_PRESETS['rgb-3'].map(s => ({ ...s, contrast: 'none' as const })) });
    const inv = [0, 1, 2].map(() => ({ cmy: [0, 0, 0] as [number, number, number], strength: 0, invert: 1 }));
    const out = applyColor([0.2, 0.5, 0.9], c, inv);
    expect(out[0]).toBeCloseTo(0.8, 12); expect(out[2]).toBeCloseTo(0.1, 12);
    expect(applyColor([0.3, 0.3, 0.3], c, wheelStates(c, 12))).toEqual(applyColor([0.3, 0.3, 0.3], c, wheelStates(c, 12)));
  });
});

describe('contrast curves', () => {
  it('keep true black black in gamma mode (no lifted background) and are monotonic', async () => {
    const { curve } = await import('../src/color/pipeline');
    const c = base({ lowCurve: 'gamma', contrastLow: 0.6 });
    for (const k of ['none', 'low', 'high'] as const) {
      expect(curve(0, k, c)).toBe(0);
      let prev = -1; for (let v = 0; v <= 1.0001; v += 0.05) { const o = curve(v, k, c); expect(o).toBeGreaterThanOrEqual(prev); prev = o; }
    }
    expect(curve(0.2, 'low', c)).toBeGreaterThan(0.2);   // lifts shadows
    expect(curve(0.8, 'high', c)).toBeGreaterThan(0.8);  // steeper above mid
  });
});

describe('saturated wheels and saturation control', () => {
  it('every wheel filter is a fully saturated CMY colour (max 1, min 0) with strong tint', () => {
    const c = base({ seed: 5, mode: 'step', period: 10, wheelStyle: 'vivid' });
    for (let f = 0; f < 600; f += 10) for (const w of wheelStates(c, f)) {
      expect(Math.max(...w.cmy)).toBeCloseTo(1, 12);
      expect(Math.min(...w.cmy)).toBeCloseTo(0, 12);
      expect(w.strength).toBeGreaterThanOrEqual(0.3 - 1e-12);
    }
  });

  it('hue visibly changes between wheel steps (filters differ by a wide margin over time)', () => {
    const c = base({ seed: 1, mode: 'step', period: 20, wheelStyle: 'vivid' });
    let changes = 0, prev = wheelState(c, 0, 0);
    for (let k = 1; k < 20; k++) { const w = wheelState(c, 0, k * 20); if (Math.hypot(...w.cmy.map((v, i) => v - prev.cmy[i])) > 0.5) changes++; prev = w; }
    expect(changes).toBeGreaterThanOrEqual(8);
  });

  it('saturate(): identity at 1, grey at 0, luma preserved, clamped', async () => {
    const { saturate } = await import('../src/color/pipeline');
    const rgb: [number, number, number] = [0.8, 0.3, 0.1], l = 0.2126 * 0.8 + 0.7152 * 0.3 + 0.0722 * 0.1;
    saturate(rgb, 1).forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 12));
    for (const v of saturate(rgb, 0)) expect(v).toBeCloseTo(l, 12);
    const boosted = saturate(rgb, 1.5);
    expect(boosted[0] - boosted[2]).toBeGreaterThan(rgb[0] - rgb[2]);
    for (const v of saturate([1, 0, 0], 3)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('default grading is the classic one (not the vivid opt-in): original curves, wheels, no saturation boost', () => {
    expect(DEFAULT_COLOR).toMatchObject({ contrastHigh: 3, contrastLow: 0.35, saturation: 1, lowCurve: 'lift', wheelStyle: 'classic', period: 48, mode: 'smooth' });
  });

  it('classic wheels pin: strength in [0.3,1], plain-blended invert, filters not forced to saturation', () => {
    const c = base({ seed: 1, mode: 'smooth', period: 48 });
    let nonSat = 0;
    for (let f = 0; f < 480; f += 7) for (const w of wheelStates(c, f)) {
      expect(w.strength).toBeGreaterThanOrEqual(0.3 - 1e-12); expect(w.strength).toBeLessThanOrEqual(1 + 1e-12);
      if (Math.min(...w.cmy) > 0.05) nonSat++;
    }
    expect(nonSat).toBeGreaterThan(10);
  });

  it('low curve: lift (classic) lifts black, gamma keeps it', async () => {
    const { curve } = await import('../src/color/pipeline');
    expect(curve(0, 'low', base())).toBeCloseTo(0.5 - 0.5 * 0.35, 12);
    expect(curve(0, 'low', base({ lowCurve: 'gamma', contrastLow: 0.9 }))).toBe(0);
  });
});

describe('output saturation (applied to the final picture)', async () => {
  const { saturate } = await import('../src/color/pipeline');
  const { RANGES } = await import('../src/core/params');
  const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);
  const samples: [number, number, number][] = [[0.8, 0.3, 0.1], [0.2, 0.5, 0.9], [1, 0.2, 0], [0.05, 0.9, 0.4], [0.5, 0.5, 0.5], [0, 0, 0], [1, 1, 1], [0.95, 0.9, 0.05]];

  it('0 = greyscale (Rec.709 luma), 1 = identity', () => {
    for (const c of samples) {
      const g = saturate(c, 0); g.forEach(v => expect(v).toBeCloseTo(luma(c), 12));
      saturate(c, 1).forEach((v, i) => expect(v).toBeCloseTo(c[i], 12));
    }
  });

  it('is monotonic: chroma never decreases as the slider goes 0 -> 2', () => {
    for (const c of samples) { let prev = -1; for (let s = 0; s <= 2.0001; s += 0.05) { const ch = chroma(saturate(c, s)); expect(ch).toBeGreaterThanOrEqual(prev - 1e-12); prev = ch; } }
  });

  it('keeps luma, stays inside [0,1] without clipping, and preserves hue (channel order/ratios) when boosting', () => {
    for (const c of samples) for (const s of [0.3, 0.7, 1.3, 2]) {
      const o = saturate(c, s);
      o.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
      expect(luma(o)).toBeCloseTo(luma(c), 9);
      // hue: the deviations from luma keep their proportions (a clipped result would not)
      const d = c.map(v => v - luma(c)), e = o.map(v => v - luma(o));
      const k = chroma(d) > 1e-9 ? chroma(e) / chroma(d) : 1;
      d.forEach((x, i) => expect(e[i]).toBeCloseTo(x * k, 9));
    }
  });

  it('is deterministic and a saturated primary does not shift when boosted', () => {
    expect(saturate([0.8, 0.3, 0.1], 1.6)).toEqual(saturate([0.8, 0.3, 0.1], 1.6));
    expect(saturate([1, 0, 0], 2)).toEqual([1, 0, 0]);
  });

  it('slider range is 0..2, default 1 (no change to the default look), and it lives in the saved colour params', () => {
    expect(RANGES['color.saturation']).toMatchObject({ min: 0, max: 2 });
    expect(DEFAULT_COLOR.saturation).toBe(1);
    expect(JSON.parse(JSON.stringify({ color: DEFAULT_COLOR })).color.saturation).toBe(1);
  });
});

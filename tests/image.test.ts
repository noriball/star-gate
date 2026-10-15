import { describe, expect, it } from 'vitest';
import {
  drawnSize, fitMaxSize, fnv1a, imageStatus, imageWeights, panelToImage, preAdjust, seamWeight, seamless, segmentCoord, wrapCoord,
  type ImageFileInfo, type MapOpts,
} from '../src/art/imageMap';

const base: MapOpts = { fit: 'fill', wrap: 'mirror', scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0, canvasAspect: 1.5, imgAspect: 1.5 };
const opts = (o: Partial<MapOpts> = {}): MapOpts => ({ ...base, ...o });

// synthetic test image: a deterministic gradient (no third-party content)
function syntheticImage(w: number, h: number): Uint8Array {
  const b = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 4; b[k] = (x * 255) / (w - 1); b[k + 1] = (y * 255) / (h - 1); b[k + 2] = (x + y) % 256; b[k + 3] = 255; }
  return b;
}

describe('fit / fill / tile placement', () => {
  it('fill covers the panel, fit contains the image, tile draws it at panel height', () => {
    for (const [ca, ia] of [[1.5, 1.5], [1.5, 0.75], [1.5, 3], [0.5, 2]]) {
      const f = drawnSize('fill', ca, ia), c = drawnSize('fit', ca, ia);
      expect(f.w).toBeGreaterThanOrEqual(ca - 1e-12); expect(f.h).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(c.w).toBeLessThanOrEqual(ca + 1e-12); expect(c.h).toBeLessThanOrEqual(1 + 1e-12);
      expect(f.w / f.h).toBeCloseTo(ia, 12); expect(c.w / c.h).toBeCloseTo(ia, 12); // aspect never distorted
    }
    expect(drawnSize('tile', 1.5, 2)).toEqual({ w: 2, h: 1 });
  });

  it('panel centre maps to image centre; corners of the panel hit image corners when aspects match', () => {
    const c = panelToImage(0, 0, opts()); expect(c.u).toBeCloseTo(0.5, 12); expect(c.v).toBeCloseTo(0.5, 12);
    const k = panelToImage(0.75, 0.5, opts()); expect(k.u).toBeCloseTo(1, 12); expect(k.v).toBeCloseTo(1, 12);
  });

  it('fit leaves no-light margins outside the image; fill and tile never do', () => {
    const o = (fit: 'fit' | 'fill' | 'tile') => opts({ fit, imgAspect: 0.5 }); // tall image on a wide panel
    expect(panelToImage(0.7, 0, o('fit')).inside).toBe(false);
    expect(panelToImage(0, 0, o('fit')).inside).toBe(true);
    expect(panelToImage(0.7, 0, o('fill')).inside).toBe(true);
    expect(panelToImage(0.7, 0, o('tile')).inside).toBe(true);
  });

  it('scale, offset and rotation transform as expected', () => {
    // scale 2 magnifies: a panel point sees the image point that scale 1 shows at half the distance from the centre
    const a = panelToImage(0.2, 0.1, opts({ scale: 2 })), b = panelToImage(0.1, 0.05, opts({ scale: 1 }));
    expect(a.u).toBeCloseTo(b.u, 12); expect(a.v).toBeCloseTo(b.v, 12);
    // offset moves the image with the panel point
    const o = panelToImage(0.3, 0.1, opts({ offsetX: 0.3, offsetY: 0.1 })); expect(o.u).toBeCloseTo(0.5, 12); expect(o.v).toBeCloseTo(0.5, 12);
    // 90° rotation sends the panel +x axis to image ±y
    const r = panelToImage(0.3, 0, opts({ rotationDeg: 90, wrap: 'repeat' }));
    expect(r.u).toBeCloseTo(0.5, 12); expect(r.v).toBeCloseTo(0.5 - 0.3 / drawnSize('fill', 1.5, 1.5).h, 9);
  });

  it('tile repeats with the image width', () => {
    const o = opts({ fit: 'tile', imgAspect: 1, wrap: 'repeat' });
    expect(panelToImage(0.1, 0.1, o).u).toBeCloseTo(panelToImage(1.1, 0.1, o).u, 12);
  });
});

describe('wrapping and seamless scroll', () => {
  it('mirror is continuous and 2-periodic; repeat is 1-periodic', () => {
    for (let t = -3; t < 3; t += 0.013) {
      expect(wrapCoord(t, 'mirror')).toBeGreaterThanOrEqual(0); expect(wrapCoord(t, 'mirror')).toBeLessThanOrEqual(1);
      expect(Math.abs(wrapCoord(t + 1e-6, 'mirror') - wrapCoord(t, 'mirror'))).toBeLessThan(1e-5); // no jump anywhere
      expect(wrapCoord(t + 2, 'mirror')).toBeCloseTo(wrapCoord(t, 'mirror'), 9);
      expect(wrapCoord(t + 1, 'repeat')).toBeCloseTo(wrapCoord(t, 'repeat'), 9);
    }
    expect(wrapCoord(1.25, 'mirror')).toBeCloseTo(0.75, 12);
  });

  it('repeat seam hiding: a non-tiling function becomes continuous across the tile border', () => {
    const ramp = (u: number) => u; // jumps from 1 to 0 when tiled naively
    const m = 0.2;
    expect(Math.abs(ramp(0.9999) - ramp(0.0001))).toBeGreaterThan(0.99); // the seam without hiding
    const left = seamless(ramp, 0.99999, m), right = seamless(ramp, 0.00001, m);
    expect(Math.abs(left - right)).toBeLessThan(1e-3);
    // and the whole curve is smooth (no jumps) across many tile boundaries
    let prev = seamless(ramp, 0, m);
    for (let i = 1; i <= 4000; i++) { const u = (i / 1000) % 1, v = seamless(ramp, u, m); expect(Math.abs(v - prev)).toBeLessThan(0.02); prev = v; }
    expect(seamWeight(0.5, m)).toBe(1); expect(seamWeight(0, m)).toBe(0); expect(seamWeight(0.3, 0)).toBe(1);
  });

  it('the scroll never shows a seam: sampling a window sliding across the border is continuous (mirror and repeat)', () => {
    const img = (u: number) => Math.sin(u * 7) + u; // arbitrary picture, not periodic
    for (const wrap of ['mirror', 'repeat'] as const) {
      const F = (t: number) => { const w = wrap === 'mirror' ? wrapCoord(t, 'mirror') : seamless(img, ((t % 1) + 1) % 1, 0.2); return wrap === 'mirror' ? img(w) : w; };
      let prev = F(0.9);
      for (let t = 0.9; t < 3.1; t += 0.001) { const v = F(t); expect(Math.abs(v - prev)).toBeLessThan(0.05); prev = v; }
    }
  });
});

describe('several images along the scroll direction', () => {
  it('weights always sum to 1 and pick the expected images', () => {
    for (const mode of ['single', 'sequence', 'crossfade'] as const) for (const n of [1, 2, 3, 5]) for (let u = 0; u < 1; u += 0.037) {
      expect(imageWeights(u, n, mode, 0).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
    expect(imageWeights(0.5, 3, 'single', 2)).toEqual([0, 0, 1]);
    expect(imageWeights(0.1, 4, 'sequence')).toEqual([1, 0, 0, 0]);
    expect(imageWeights(0.9, 4, 'sequence')).toEqual([0, 0, 0, 1]);
  });

  it('crossfade is smooth, peaks at segment centres and wraps around the panel border', () => {
    expect(imageWeights(0.5 / 4, 4, 'crossfade')[0]).toBeCloseTo(1, 12);
    expect(imageWeights(1.5 / 4, 4, 'crossfade')[1]).toBeCloseTo(1, 12);
    let prev = imageWeights(0, 3, 'crossfade');
    for (let i = 1; i <= 1000; i++) { const w = imageWeights(i / 1000 % 1, 3, 'crossfade'); w.forEach((v, k) => expect(Math.abs(v - prev[k])).toBeLessThan(0.05)); prev = w; }
    const a = imageWeights(1e-9, 3, 'crossfade'), b = imageWeights(1 - 1e-9, 3, 'crossfade');
    a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 6)); // cyclic: no jump at the panel border
  });

  it('sequence places each image in its own segment of the panel', () => {
    expect(segmentCoord(0.6, 2, 'sequence').uLocal).toBeCloseTo(0.2, 12);
    expect(segmentCoord(0.6, 2, 'sequence').canvasScale).toBe(0.5);
    expect(segmentCoord(0.6, 2, 'crossfade')).toEqual({ uLocal: 0.6, canvasScale: 1 });
  });
});

describe('colour handling, size limits and identity', () => {
  it('pre-adjust is neutral by default and behaves for contrast/saturation', () => {
    const c: [number, number, number] = [0.2, 0.5, 0.8];
    preAdjust(c, 1, 1).forEach((v, i) => expect(v).toBeCloseTo(c[i], 10));
    const grey = preAdjust(c, 1, 0); expect(grey[0]).toBeCloseTo(grey[1], 9); expect(grey[1]).toBeCloseTo(grey[2], 9);
    const hi = preAdjust([0.1, 0.1, 0.1], 2, 1), lo = preAdjust([0.1, 0.1, 0.1], 0.5, 1);
    expect(hi[0]).toBeLessThan(0.1); expect(lo[0]).toBeGreaterThan(0.1); // dark grey (below mid in display space): more contrast = darker
  });

  it('large images are downscaled with the aspect kept; small ones are untouched', () => {
    expect(fitMaxSize(8000, 4000, 4096)).toEqual({ width: 4096, height: 2048, scaled: true });
    expect(fitMaxSize(1000, 3000, 2048)).toEqual({ width: 683, height: 2048, scaled: true });
    expect(fitMaxSize(640, 480, 4096)).toEqual({ width: 640, height: 480, scaled: false });
  });

  it('fnv1a is stable and content-sensitive (synthetic image)', () => {
    expect(fnv1a(new TextEncoder().encode('a'))).toBe('e40c292c'); // published FNV-1a("a")
    const a = syntheticImage(32, 24), b = syntheticImage(32, 24); b[100] ^= 1;
    expect(fnv1a(a)).toBe(fnv1a(syntheticImage(32, 24))); expect(fnv1a(a)).not.toBe(fnv1a(b));
  });

  it('missing / mismatched images are detected for a reloaded project', () => {
    const f = (name: string, hash = 'aaaaaaaa'): ImageFileInfo => ({ name, bytes: 10, width: 4, height: 4, hash });
    expect(imageStatus([f('a.png')], [f('a.png')]).state).toBe('ok');
    const miss = imageStatus([f('a.png')], []); expect(miss.state).toBe('missing'); expect((miss as any).message).toContain('a.png');
    expect(imageStatus([], []).state).toBe('missing');
    expect(imageStatus([f('a.png')], [f('b.png')]).state).toBe('mismatch');
    expect(imageStatus([f('a.png')], [f('a.png', 'bbbbbbbb')]).state).toBe('mismatch'); // same name, different pixels
    expect(imageStatus([f('a.png'), f('b.png')], [f('a.png')]).state).toBe('mismatch');
  });
});

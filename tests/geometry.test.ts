import { describe, expect, it } from 'vitest';
import { STRICT_DEFAULTS as DEFAULTS, clone } from '../src/core/params';
import { cameraZ, panelOffset, slitCentreNdcX, slitNdcRange, slitSides, tanHalf, traceRay } from '../src/core/geometry';

// Independent analytic solution: pinhole projection of the 3D point (offsetX, 0, 0)
// seen from (0,0,c) with half-FOV tangents (tx, ty): ndcX = offsetX / (c * tx).
function analyticNdcX(offsetX: number, c: number, fovYdeg: number, aspect: number) {
  const tx = Math.tan((fovYdeg * Math.PI) / 360) * aspect;
  return offsetX / (c * tx);
}

/** Scan NDC x at 1/100000 resolution along ny=0, return passing extent. */
function scanSlit(c: number, p = DEFAULTS, side: 1 | -1 = 1) {
  const n = 200000;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= n; i++) {
    const nx = -1 + (2 * i) / n;
    if (traceRay(nx, 0, c, p, 0, side)) { lo = Math.min(lo, nx); hi = Math.max(hi, nx); }
  }
  return { lo, hi, centre: (lo + hi) / 2 };
}

describe('slit image position', () => {
  const p = DEFAULTS;
  for (const c of [1.6, 2.5, 4, 8, 15.5]) {
    it(`centre matches analytic projection at c=${c} ft`, () => {
      const scan = scanSlit(c);
      const expected = analyticNdcX(p.slit.offsetX, c, p.camera.fovY, p.filmAspect);
      expect(slitCentreNdcX(c, p)).toBeCloseTo(expected, 12);
      expect(scan.centre).toBeCloseTo(expected, 4);
      const [l, r] = slitNdcRange(c, p);
      expect(scan.lo).toBeCloseTo(l, 4);
      expect(scan.hi).toBeCloseTo(r, 4);
    });
  }

  it('moves outward from the centre as the camera advances', () => {
    expect(slitCentreNdcX(2, p)).toBeGreaterThan(slitCentreNdcX(4, p));
  });

  it('is vertically bounded by slit.height', () => {
    const c = 3, nx = slitCentreNdcX(c, p);
    const ny = (p.slit.height / 2) / (c * tanHalf(p).y);
    expect(traceRay(nx, ny * 0.999, c, p)).not.toBeNull();
    expect(traceRay(nx, ny * 1.001, c, p)).toBeNull();
  });

  it('continues to the panel at depth c + distance', () => {
    const c = 4;
    const hit = traceRay(slitCentreNdcX(c, p), 0, c, p)!;
    expect(hit.panel.x).toBeCloseTo(p.slit.offsetX * (1 + p.panel.distance / c), 9);
  });

  it('camera path runs from track start to near distance', () => {
    const q = clone(p);
    expect(cameraZ(0, q)).toBeCloseTo(q.track.nearDistance + q.track.length);
    expect(cameraZ(1, q)).toBeCloseTo(q.track.nearDistance);
  });
});

describe('mirrored slit (double exposure)', () => {
  const p = DEFAULTS;
  for (const c of [1.6, 3, 7, 15.5]) {
    it(`second slit is the exact mirror image at c=${c} ft`, () => {
      const a = scanSlit(c, p, 1), b = scanSlit(c, p, -1);
      expect(b.centre).toBeCloseTo(-analyticNdcX(p.slit.offsetX, c, p.camera.fovY, p.filmAspect), 4);
      expect(b.lo).toBeCloseTo(-a.hi, 4);
      expect(b.hi).toBeCloseTo(-a.lo, 4);
      const [l, r] = slitNdcRange(c, p, -1);
      expect([l, r][0]).toBeCloseTo(-slitNdcRange(c, p, 1)[1], 12);
      expect(r).toBeCloseTo(-slitNdcRange(c, p, 1)[0], 12);
      expect(slitCentreNdcX(c, p, -1)).toBeCloseTo(-slitCentreNdcX(c, p, 1), 12);
    });
  }

  it('the +x slit does not pass the -x image and vice versa', () => {
    const c = 4;
    expect(traceRay(slitCentreNdcX(c, p, -1), 0, c, p, 0, 1)).toBeNull();
    expect(traceRay(slitCentreNdcX(c, p, 1), 0, c, p, 0, -1)).toBeNull();
  });

  it('hits mirrored panel x positions (-x_s(1+d/c))', () => {
    const c = 4;
    const hit = traceRay(slitCentreNdcX(c, p, -1), 0, c, p, 0, -1)!;
    expect(hit.panel.x).toBeCloseTo(-p.slit.offsetX * (1 + p.panel.distance / c), 9);
  });

  it('doubleExposure toggles the set of slit sides', () => {
    expect(slitSides(p)).toEqual([1, -1]);
    expect(slitSides({ ...p, doubleExposure: false })).toEqual([1]);
  });
});

describe('frame animation', () => {
  const p = clone(DEFAULTS);
  it('linear accel scrolls exactly scrollPerFrame per frame', () => {
    p.accel = 'linear';
    expect(panelOffset(10, p)).toBeCloseTo(0.1, 12);
    expect(panelOffset(11, p) - panelOffset(10, p)).toBeCloseTo(p.art.scrollPerFrame, 12);
  });
  it('ease-in accelerates but keeps the same total travel', () => {
    p.accel = 'ease-in';
    const d1 = panelOffset(11, p) - panelOffset(10, p), d2 = panelOffset(201, p) - panelOffset(200, p);
    expect(d2).toBeGreaterThan(d1);
    expect(panelOffset(p.art.frames, p)).toBeCloseTo(p.art.scrollPerFrame * p.art.frames, 12);
  });
});

import { cameraInterval, easeInv, ease, gatherSamples } from '../src/core/geometry';

describe('gather coverage (no gaps between substeps)', () => {
  const p = clone(DEFAULTS);
  const cols = 4000;

  it('ease inverse round-trips for all accel modes', () => {
    for (const m of ['linear', 'ease-in', 'exponential'] as const)
      for (const s of [0, 0.1, 0.5, 0.9, 1]) expect(easeInv(ease(s, m), m)).toBeCloseTo(s, 12);
  });

  it('every pixel column between the far and near slit images is exposed (contiguous, no gaps)', () => {
    for (const side of [1, -1] as const) {
      const far = Math.abs(slitCentreNdcX(p.track.nearDistance + p.track.length, p));
      const near = Math.min(1, Math.abs(slitCentreNdcX(p.track.nearDistance, p)));
      let covered = 0, total = 0;
      for (let i = 0; i < cols; i++) {
        const ax = far + ((near - far) * (i + 0.5)) / cols; // strictly inside the swept range
        const iv = cameraInterval(side * ax, 0, side, p);
        total++;
        if (iv && iv.sHi > iv.sLo) covered++;
      }
      expect(covered).toBe(total);
    }
  });

  it('outside the swept range nothing is exposed (true unexposed region)', () => {
    const far = Math.abs(slitCentreNdcX(p.track.nearDistance + p.track.length, p));
    expect(cameraInterval(far * 0.9, 0, 1, p)).toBeNull();
    expect(cameraInterval(-far * 0.9, 0, 1, p)).toBeNull();
  });

  it('the interval agrees with the ray test: inside passes, just outside blocked', () => {
    const t = tanHalf(p);
    for (const [nx, ny] of [[0.3, 0], [0.5, 0.2], [-0.4, -0.3], [0.7, 0.1]]) {
      const side = nx > 0 ? 1 : -1;
      const iv = cameraInterval(nx, ny, side, p)!;
      expect(iv).not.toBeNull();
      const cAt = (s: number) => p.track.nearDistance + p.track.length * (1 - ease(s, p.accel));
      const eps = 1e-6;
      expect(traceRay(nx, ny, cAt((iv.sLo + iv.sHi) / 2), p, 0, side)).not.toBeNull();
      expect(traceRay(nx, ny, cAt(iv.sLo + eps), p, 0, side)).not.toBeNull();
      expect(traceRay(nx, ny, cAt(iv.sHi - eps), p, 0, side)).not.toBeNull();
      if (iv.sLo > 0.01) expect(traceRay(nx, ny, cAt(iv.sLo - 0.005), p, 0, side)).toBeNull();
      if (iv.sHi < 0.99) expect(traceRay(nx, ny, cAt(iv.sHi + 0.005), p, 0, side)).toBeNull();
      void t;
    }
  });

  it('the total exposed time matches a brute-force fine substep count', () => {
    const [nx, ny] = [0.45, 0.1];
    const iv = cameraInterval(nx, ny, 1, p)!;
    let hits = 0; const n = 200000;
    for (let k = 0; k < n; k++) {
      const c = p.track.nearDistance + p.track.length * (1 - ease((k + 0.5) / n, p.accel));
      if (traceRay(nx, ny, c, p, 0, 1)) hits++;
    }
    expect(hits / n).toBeCloseTo(iv.sHi - iv.sLo, 4);
  });

  it('gather sample count scales with substeps and is bounded', () => {
    expect(gatherSamples(16)).toBe(8);
    expect(gatherSamples(128)).toBe(16);
    expect(gatherSamples(1024)).toBe(64);
    expect(gatherSamples(99999)).toBe(64);
  });
});

import { DEFAULTS as APP_DEFAULTS, PRESETS } from '../src/core/params';
import { orient, slideSign } from '../src/core/geometry';

describe('orientation (left-right / top-bottom)', () => {
  const lr = clone(APP_DEFAULTS), tb = { ...clone(APP_DEFAULTS), orientation: 'top-bottom' as const };

  it('default is left-right', () => {
    expect(APP_DEFAULTS.orientation).toBe('left-right');
    expect(PRESETS[0].params.orientation).toBe('left-right');
  });

  it('orient() is identity for left-right, a transpose for top-bottom, and an involution', () => {
    expect(orient(0.3, -0.7, 'left-right')).toEqual([0.3, -0.7]);
    expect(orient(0.3, -0.7, 'top-bottom')).toEqual([-0.7, 0.3]);
    const [a, b] = orient(...orient(0.3, -0.7, 'top-bottom'), 'top-bottom');
    expect([a, b]).toEqual([0.3, -0.7]);
  });

  it('top-bottom pixel (nx,ny) sees exactly what left-right pixel (ny,nx) sees, for every pixel', () => {
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      const nx = -0.99 + (1.98 * i) / 39, ny = -0.99 + (1.98 * j) / 39;
      for (const side of [1, -1] as const) {
        const a = cameraInterval(...orient(nx, ny, tb.orientation), side, tb), b = cameraInterval(ny, nx, side, lr);
        expect(a).toEqual(b);
      }
    }
  });

  it('left-right: walls left and right with a vertical gap; top-bottom: walls above/below with a horizontal gap', () => {
    const far = lr.track.nearDistance + lr.track.length, tx = tanHalf(lr).x;
    const gap = (lr.slit.offsetX - lr.slit.width / 2) / (far * tx);
    const exposed = (q: typeof lr, nx: number, ny: number) => [1, -1].some(sd => cameraInterval(...orient(nx, ny, q.orientation), sd as 1 | -1, q) !== null);
    // left-right: gap is a vertical band around nx=0 (any ny), exposed outside it
    expect(exposed(lr, gap * 0.5, 0.1)).toBe(false);
    expect(exposed(lr, -gap * 0.5, -0.4)).toBe(false);
    expect(exposed(lr, gap * 1.5, 0.1)).toBe(true);
    // top-bottom: the same band, but around ny=0, horizontal
    expect(exposed(tb, 0.1, gap * 0.5)).toBe(false);
    expect(exposed(tb, -0.4, -gap * 0.5)).toBe(false);
    expect(exposed(tb, 0.1, gap * 1.5)).toBe(true);
    expect(exposed(tb, gap * 0.5, 0.5)).toBe(true); // a vertical strip is NOT a gap in top-bottom
  });

  it('exactly one orientation at a time: the gap is never both a vertical and a horizontal band', () => {
    // a pixel on the nx=0 axis away from the centre is dark in left-right only within the gap strip; in top-bottom it is lit
    expect(cameraInterval(...orient(0, 0.6, 'left-right'), 1, lr)).toBeNull();
    expect(cameraInterval(...orient(0, 0.6, 'top-bottom'), 1, tb)).not.toBeNull();
  });

  it('slide sign: default mirrors the slide so each wall flows outward; un-mirrored keeps both walls sliding the same way', () => {
    expect(APP_DEFAULTS.art.mirrorSlide).toBe(true);
    expect(slideSign(lr, 1)).toBe(1); expect(slideSign(lr, -1)).toBe(-1);
    const m = { ...lr, art: { ...lr.art, mirrorSlide: false } };
    expect(slideSign(m, 1)).toBe(1); expect(slideSign(m, -1)).toBe(1);
  });
});

import { sampleWindow } from '../src/core/geometry';
import { ART_KINDS, STRICT_DEFAULTS } from '../src/core/params';

describe('edge-preserving sample window and look defaults', () => {
  const iv = { sLo: 0.2, sHi: 0.6 };
  it('sharpness 0 integrates the whole interval; weight is always the full interval', () => {
    const w0 = sampleWindow(iv, 0);
    expect(w0.lo).toBeCloseTo(0.2, 12); expect(w0.hi).toBeCloseTo(0.6, 12);
    for (const k of [0, 0.3, 0.7, 0.95]) expect(sampleWindow(iv, k).weight).toBeCloseTo(0.4, 12);
  });
  it('higher sharpness narrows the window about the midpoint and stays inside the interval', () => {
    let prev = Infinity;
    for (const k of [0, 0.25, 0.5, 0.75, 0.95]) {
      const w = sampleWindow(iv, k);
      expect((w.lo + w.hi) / 2).toBeCloseTo(0.4, 12);
      expect(w.hi - w.lo).toBeLessThan(prev); prev = w.hi - w.lo;
      expect(w.lo).toBeGreaterThanOrEqual(iv.sLo - 1e-12); expect(w.hi).toBeLessThanOrEqual(iv.sHi + 1e-12);
    }
    expect(sampleWindow(iv, 5).hi - sampleWindow(iv, 5).lo).toBeCloseTo(0.4 * 0.05, 12); // clamped to 0.95
  });
  it('default preset is the classic two-wall look (noise art, colour separation off, classic grading when enabled); vivid/crisp art is opt-in only', () => {
    expect(ART_KINDS).toEqual(expect.arrayContaining(['noise', 'crystal', 'circuit', 'bands', 'facets']));
    const d = APP_DEFAULTS, v = PRESETS.find(x => x.name.startsWith('Vivid'))!.params;
    expect(PRESETS[0].name).toBe('Two-Wall-Classic');
    expect(d.art.kind).toBe('noise'); expect(d.doubleExposure).toBe(true); expect(d.exposure.sharpness).toBe(0); expect(d.exposure.depthFade).toBe(0);
    expect(d.color.enabled).toBe(false); expect(d.color.lowCurve).toBe('lift'); expect(d.color.wheelStyle).toBe('classic'); expect(d.color.saturation).toBe(1);
    expect(v.art.kind).toBe('bands'); expect(v.color.wheelStyle).toBe('vivid'); expect(v.exposure.sharpness).toBeGreaterThan(0);
  });
  it('no four-wall (top+bottom added to left+right) mode exists anywhere in the params or presets', () => {
    const text = JSON.stringify([APP_DEFAULTS, STRICT_DEFAULTS, PRESETS]);
    expect(text).not.toMatch(/fourWalls|hLength|wallMode/);
    for (const q of [APP_DEFAULTS, STRICT_DEFAULTS, ...PRESETS.map(x => x.params)]) expect(Object.keys(q.slit).sort()).toEqual(['extendEnds', 'height', 'offsetX', 'width']); // no slit.offsetY (image.offsetY is unrelated)
    expect(PRESETS.map(p => p.name).join()).not.toMatch(/Four|Tunnel-/);
  });
});

describe('scroll direction per wall (artwork flows away from the central gap)', () => {
  const p = clone(APP_DEFAULTS);
  const tx = tanHalf(p).x;

  /** art coordinate u of the feature that sits at ndc x = side*0.4 when the slide is at rest */
  const u0For = (side: 1 | -1, q = p) => (side * q.slit.offsetX + q.panel.distance * side * 0.4 * tanHalf(q).x) / q.panel.width + 0.5;

  /** NDC x of the pixel on the middle row where the art coordinate u equals u0, for the wall on `side` at slide offset `off`. */
  function featureNdcX(side: 1 | -1, off: number, u0: number, q = p): number {
    // along the middle row the slit passes at c = side*X/(nx*tx); u is monotonic in nx there
    const uAt = (nx: number) => {
      const c = (side * q.slit.offsetX) / (nx * tx);
      return traceRay(nx, 0, c, q, slideSign(q, side) * off, side)!.uv!.u;
    };
    let lo = side > 0 ? 0.12 : -0.98, hi = side > 0 ? 0.98 : -0.12; // inside the exposed range
    const increasing = uAt(hi) > uAt(lo);
    for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; ((uAt(mid) < u0) === increasing) ? (lo = mid) : (hi = mid); }
    return (lo + hi) / 2;
  }

  it('default: the left wall flows left (outward) and the right wall flows right (outward) as the slide advances', () => {
    for (const off of [0.3, 1, 2.5]) {
      const l0 = featureNdcX(-1, 0, u0For(-1)), l1 = featureNdcX(-1, off, u0For(-1));
      const r0 = featureNdcX(1, 0, u0For(1)), r1 = featureNdcX(1, off, u0For(1));
      expect(l1).toBeLessThan(l0);   // left wall: moves to more negative x = toward the left edge
      expect(r1).toBeGreaterThan(r0); // right wall: moves to more positive x = toward the right edge
    }
  });

  it('un-mirrored (previous behaviour): both walls move to +x, so the left wall flowed inward', () => {
    const q = { ...p, art: { ...p.art, mirrorSlide: false } };
    expect(featureNdcX(-1, 1, u0For(-1, q), q)).toBeGreaterThan(featureNdcX(-1, 0, u0For(-1, q), q)); // left: toward the centre
    expect(featureNdcX(1, 1, u0For(1, q), q)).toBeGreaterThan(featureNdcX(1, 0, u0For(1, q), q));   // right: outward
  });

  it('the right wall is unchanged by the fix (same slide sign as before)', () => {
    const before = { ...p, art: { ...p.art, mirrorSlide: false } };
    expect(slideSign(p, 1)).toBe(slideSign(before, 1));
  });

  it('frame 0 has no slide, so the static frame is unaffected by the sign', () => {
    expect(panelOffset(0, p)).toBe(0);
  });

  it('top-bottom uses the same path: the two walls (top, bottom) flow away from the horizontal gap', () => {
    // in top-bottom the left-right wall on side s appears as the wall at ndc y with sign s; outward there = away from y=0
    const tb = { ...p, orientation: 'top-bottom' as const };
    for (const side of [1, -1] as const) {
      const a = featureNdcX(side, 0, u0For(side, tb), tb), b = featureNdcX(side, 1, u0For(side, tb), tb);
      expect(Math.abs(b)).toBeGreaterThan(Math.abs(a)); // |ndc| grows: moves away from the centre line
      expect(orient(0, a, 'top-bottom')[0]).toBe(a);    // the transposed pixel (nx=a,ny=0) of the LR frame is (0,a) here
    }
  });
});

import { FIXED_CENTRE_GAP } from '../src/core/params';
import { gapBlend, gapMap, innerEdge, naturalGap } from '../src/core/geometry';

describe('centre gap control', () => {
  const base = clone(APP_DEFAULTS);
  const withGap = (g: number, o: 'left-right' | 'top-bottom' = 'left-right') => ({ ...clone(base), centreGap: g, orientation: o });
  const unexposed = (q: typeof base, nx: number, ny: number) => {
    const [ox, sy] = orient(nx, ny, q.orientation);
    const sx = gapMap(ox, sy, q);
    if (sx === null) return true;
    return [1, -1].every(sd => cameraInterval(sx, sy, sd as 1 | -1, q) === null);
  };
  /** half-width (NDC) of the dark band around the centre line on the row/column through (.,0.15) */
  const gapHalfWidth = (q: typeof base) => {
    let lo = 0, hi = 1; // find smallest |coordinate| that is exposed, scanning the axis the gap is measured along
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; const dark = q.orientation === 'left-right' ? unexposed(q, m, 0.15) : unexposed(q, 0.15, m); dark ? (lo = m) : (hi = m); }
    return (lo + hi) / 2;
  };

  it('the centre gap is fixed at 0.005 in the defaults and every preset; the map is the identity at the natural gap only', () => {
    expect(FIXED_CENTRE_GAP).toBe(0.005);
    expect(APP_DEFAULTS.centreGap).toBe(0.005);
    for (const pr of PRESETS) expect(pr.params.centreGap).toBe(0.005);
    expect(naturalGap(APP_DEFAULTS)).toBeCloseTo(0.1093, 3);          // the physical geometry's gap is unchanged
    const nat = withGap(naturalGap(base));
    for (const x of [-0.99, -0.3, -0.12, 0, 0.12, 0.5, 0.99]) for (const y of [-0.9, 0, 0.9]) expect(gapMap(x, y, nat)).toBe(x);
  });

  it('natural gap equals the measured dark band of the physical render', () => {
    expect(gapHalfWidth(withGap(naturalGap(base)))).toBeCloseTo(naturalGap(base), 3);
  });

  it('the visible gap equals the control value for any setting, in both orientations', () => {
    for (const o of ['left-right', 'top-bottom'] as const) for (const g of [0.02, 0.05, 0.08, 0.15, 0.25]) {
      expect(gapHalfWidth(withGap(g, o))).toBeCloseTo(g, 3);
    }
  });

  it('gap 0: nothing is black on the centre line (walls meet); frame edge and orientation are respected', () => {
    const q = withGap(0);
    for (const y of [-0.8, -0.3, 0, 0.3, 0.8]) { expect(unexposed(q, 0.003, y)).toBe(false); expect(unexposed(q, -0.003, y)).toBe(false); }
    const t = withGap(0, 'top-bottom');
    for (const x of [-0.8, -0.3, 0, 0.3, 0.8]) { expect(unexposed(t, x, 0.003)).toBe(false); expect(unexposed(t, x, -0.003)).toBe(false); }
  });

  const strict = clone(STRICT_DEFAULTS); // finite 6 ft slit: its ends are visible as notches
  const finite = (g: number) => ({ ...clone(strict), slit: { ...strict.slit, offsetX: 1.2 }, panel: { ...strict.panel, distance: 0.8 }, centreGap: g });

  it('finite slit (research value): the inner edge slants outward toward the top and bottom (the notch)', () => {
    expect(innerEdge(0, strict)).toBeCloseTo(naturalGap(strict), 12);
    expect(innerEdge(1, strict)).toBeGreaterThan(naturalGap(strict) * 1.3);
    expect(innerEdge(-0.9, strict)).toBeCloseTo(innerEdge(0.9, strict), 12); // top/bottom symmetric
  });

  it('extended slit (default): the slit ends lie outside the view, so the inner edge is the natural gap on every row', () => {
    expect(base.slit.extendEnds).toBe(true);
    for (const y of [-1, -0.9, -0.5, 0, 0.5, 0.9, 1]) expect(innerEdge(y, base)).toBeCloseTo(naturalGap(base), 12);
  });

  /** first lit column (output NDC, right half) on a row, found on the 1280-px grid the exports use */
  const edgePx = (q: typeof base, ny: number, W = 1280) => {
    for (let i = 0; i < W / 2; i++) { const nx = (i + 0.5) / (W / 2); if (!unexposed(q, nx, ny)) return i; }
    return W / 2;
  };

  it('inner wall edge is a straight vertical line: constant x across all rows (±1 px) at the default and at gap 0, both orientations', () => {
    for (const g of [APP_DEFAULTS.centreGap, 0.07, 0.03, 0]) for (const o of ['left-right', 'top-bottom'] as const) {
      const q = withGap(g, o);
      const edges: number[] = [];
      for (let r = 0; r < 120; r++) { const ny = -0.995 + (1.99 * r) / 119; edges.push(o === 'left-right' ? edgePx(q, ny) : edgePx({ ...q, orientation: 'left-right' } as typeof base, ny)); }
      // (top-bottom is the transposed left-right frame, so its inner edge is checked along the same rows of the left-right frame)
      expect(Math.max(...edges) - Math.min(...edges), `gap ${g} ${o}`).toBeLessThanOrEqual(1);
    }
  });

  it('the picture is not cut by the ends of the slit or of the back panel anywhere along the inner edge (default); the finite setup is', () => {
    const far = base.track.nearDistance + base.track.length, g0 = naturalGap(base);
    for (const [q, expectAllHit] of [[base, true], [finite(naturalGap(finite(0))), false]] as const) {
      let misses = 0;
      for (let r = 0; r < 100; r++) {
        const ny = -0.995 + (1.99 * r) / 99, nx = naturalGap(q) * 1.02;          // just inside the first lit column
        const c = (q.slit.offsetX - q.slit.width / 2) / (nx * tanHalf(q).x);       // camera distance at which that pixel is lit (near the far end)
        const hit = traceRay(nx, ny, Math.min(c, far), q, 0, 1);
        if (hit === null) misses++;
      }
      expect(expectAllHit ? misses === 0 : misses > 10, `misses ${misses}`).toBe(true);
    }
    expect(g0).toBeGreaterThan(0);
  });

  it('the finite slit does show the notch (edge moves by tens of pixels) — this is what the default no longer has', () => {
    const q = finite(naturalGap(finite(0))); // natural gap of the finite geometry
    const edges = [0, 40, 80, 119].map(r => edgePx(q, -0.995 + (1.99 * r) / 119));
    expect(Math.max(...edges) - Math.min(...edges)).toBeGreaterThan(20);
  });

  it('gap 0 with the finite slit still straightens its notch (the straightening applies in proportion as the gap closes)', () => {
    const q = finite(0);
    for (const y of [-0.99, -0.9, 0.9, 0.99]) expect(unexposed(q, 0.002, y)).toBe(false);
    expect(unexposed(finite(naturalGap(finite(0))), 0.12, 0.99)).toBe(true); // at the natural gap the physical notch remains
  });

  it('gap 0: the walls are cross-faded across the centre line, with no seam (continuous weights, matching sources at the band edges)', () => {
    const q = withGap(0);
    expect(gapBlend(0.5, 0.2, q)).toBeNull(); expect(gapBlend(0.02, 0.2, q)).toBeNull();
    expect(gapBlend(0.004, 0.2, withGap(0.05))).toBeNull(); // only when the gap is closed
    let prevW = 0;
    for (let i = -100; i <= 100; i++) {
      const nx = (i / 100) * 0.0099, b = gapBlend(nx, 0.3, q)!;
      expect(b.w).toBeGreaterThanOrEqual(prevW - 1e-12); expect(b.w).toBeGreaterThanOrEqual(0); expect(b.w).toBeLessThanOrEqual(1); prevW = b.w;
      expect(b.left).toBeLessThanOrEqual(-naturalGap(q) + 1e-12); expect(b.right).toBeGreaterThanOrEqual(naturalGap(q) - 1e-12);
    }
    const at = (nx: number) => gapBlend(nx, 0.3, q)!;
    expect(at(-0.0099).w).toBeCloseTo(0, 3); expect(at(0.0099).w).toBeCloseTo(1, 3);
    // outside the band the plain map takes over with the same source positions (continuity)
    expect(gapMap(0.0101, 0.3, q)!).toBeCloseTo(at(0.0099).right + 0.0002 * (1 - naturalGap(q)), 3);
    expect(gapMap(-0.0101, 0.3, q)!).toBeCloseTo(at(-0.0099).left - 0.0002 * (1 - naturalGap(q)), 3);
  });

  it('map is monotonic, keeps the frame edge fixed and sends the gap edge to the natural gap edge', () => {
    const q = withGap(0.04), g0 = naturalGap(q);
    expect(gapMap(1, 0, q)).toBeCloseTo(1, 12); expect(gapMap(-1, 0.5, q)).toBeCloseTo(-1, 12);
    expect(gapMap(0.04 + 1e-9, 0, q)!).toBeCloseTo(g0, 6); expect(gapMap(-0.04 - 1e-9, 0, q)!).toBeCloseTo(-g0, 6);
    let prev = -Infinity;
    for (let x = 0.0401; x <= 1; x += 0.01) { const m = gapMap(x, 0.3, q)!; expect(m).toBeGreaterThan(prev); prev = m; }
    expect(gapMap(0.03, 0, q)).toBeNull();
    // left and right walls stay on their own side (flow directions untouched)
    expect(gapMap(0.5, 0, q)!).toBeGreaterThan(0); expect(gapMap(-0.5, 0, q)!).toBeLessThan(0);
  });

  it('the control is part of the saved params JSON', () => {
    const json = JSON.parse(JSON.stringify(withGap(0.05)));
    expect(json.centreGap).toBe(0.05);
  });

  it('single exposure has no central gap to control: map is a no-op', () => {
    const q = { ...withGap(0.02), doubleExposure: false };
    expect(gapMap(0.01, 0, q)).toBe(0.01);
  });
});

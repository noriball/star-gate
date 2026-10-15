// Slit-scan geometry. Slit plane z=0; camera on the z axis at z=c>0 looking toward -z;
// back-lit art panel at z=-panel.distance. This file is the CPU reference of what the
// fragment shader in shaders.ts computes; keep the two in sync.
import type { Params } from './params';

/** Slit side: +1 = first exposure at +offsetX, -1 = mirrored second exposure at -offsetX. */
export type Side = 1 | -1;

/**
 * Half-length (ft) of the slit mask along its long direction. A finite 6 ft slit ends inside the field of view when
 * the camera is far away (its ends show up as slanted notches next to the central gap). With `extendEnds` (default)
 * the slit and the back panel are treated as larger than any view (the art mirrors beyond the panel edge instead of ending),
 * so the walls' inner edges are straight from top to bottom.
 */
export const slitHalfLength = (p: Params): number => (p.slit.extendEnds ? Infinity : p.slit.height / 2);

/** Slit sides exposed per frame (double exposure = two walls forming a tunnel). */
export function slitSides(p: Params): Side[] {
  return p.doubleExposure ? [1, -1] : [1];
}

/**
 * Frame orientation. 'left-right': vertical slit, walls left and right, central vertical gap (default).
 * 'top-bottom': the same tunnel turned 90°: pixel (nx,ny) is evaluated as pixel (ny,nx) of the
 * left-right frame, so every parameter, the animation and the export behave identically; only the
 * picture is rotated. Exactly one orientation is active at a time.
 */
export type Orientation = 'left-right' | 'top-bottom';

/** Map an output NDC pixel to the left-right frame the slit geometry is defined in (an involution). */
export function orient(nx: number, ny: number, o: Orientation): [number, number] {
  return o === 'top-bottom' ? [ny, nx] : [nx, ny];
}

/**
 * Slide direction of a wall. Mirrored (default): each wall's artwork flows away from the central gap
 * (left wall to the left, right wall to the right; top/bottom likewise). A feature fixed on the art sits
 * at ndc x ∝ (u·W + slide·offset − X)/d, so it moves outward iff slide has the sign of the wall's side.
 * Un-mirrored: both walls slide the same way (the left wall then flows inward).
 */
export const slideSign = (p: Params, side: Side): 1 | -1 => (p.art.mirrorSlide ? side : 1);

/**
 * Natural half-width of the central unexposed gap, as a fraction of the frame width (height in top-bottom):
 * no camera position ever sees a slit closer to the centre than (offset − slit width/2)/(farthest distance · tan).
 * NDC runs -1..1, so this equals the gap's full width as a fraction of the frame.
 */
export function naturalGap(p: Params): number {
  const far = p.track.nearDistance + p.track.length;
  return Math.max(0, (p.slit.offsetX - p.slit.width / 2) / (far * tanHalf(p).x));
}

/** Half-width of the soft cross-fade between the two walls when the gap is closed (gap 0), as a fraction of the frame half-width. */
export const GAP_BLEND_BAND = 0.01;
/** Slider values below this snap to 0 (walls meet and are cross-faded instead of showing a hard seam). */
export const GAP_SNAP = 0.005;

/** The gap actually used: the control clamped, snapped to 0 when almost closed (unless it is the natural gap). */
export function effectiveGap(p: Params): number {
  const g = Math.min(Math.max(p.centreGap, 0), 0.95);
  return g < GAP_SNAP && Math.abs(g - naturalGap(p)) > 1e-9 ? 0 : g;
}

/**
 * Closed gap (effective gap 0): the left and right walls meet at the centre line. Inside |nx| < GAP_BLEND_BAND the two walls'
 * inner-edge content is cross-faded (smoothstep) instead of switching abruptly, so no seam line is drawn.
 * Returns source x of the left wall, of the right wall, and the weight of the right wall; null when the gap is not closed.
 */
export function gapBlend(nx: number, ny: number, p: Params): { left: number; right: number; w: number } | null {
  if (!p.doubleExposure || effectiveGap(p) !== 0 || Math.abs(nx) >= GAP_BLEND_BAND) return null;
  const g0 = naturalGap(p), edge = g0 + (g0 > 1e-9 ? 1 : 0) * (innerEdge(ny, p) - g0), k = 1 - edge;
  const t = Math.min(1, Math.max(0, (nx + GAP_BLEND_BAND) / (2 * GAP_BLEND_BAND)));
  return { left: -(edge + k * Math.max(-nx, 0)), right: edge + k * Math.max(nx, 0), w: t * t * (3 - 2 * t) };
}

/** Nearest exposed |ndc x| on the row ny of the physical render (the wall's inner edge). Slants outward near the top/bottom. */
export function innerEdge(ny: number, p: Params): number {
  const far = p.track.nearDistance + p.track.length, dy = Math.abs(ny) * tanHalf(p).y;
  const cMax = dy > 1e-6 ? Math.min(far, slitHalfLength(p) / dy) : far;
  return Math.max(0, (p.slit.offsetX - p.slit.width / 2) / (Math.max(cMax, p.track.nearDistance) * tanHalf(p).x));
}

/**
 * Centre-gap control. Output NDC (nx,ny), after orientation, -> source NDC x of the physical geometry.
 * The visible gap is `p.centreGap`; each wall is rescaled horizontally between the gap edge and the frame
 * edge, so its look, brightness and flow direction are those of the physical render. Identity when the control
 * equals the natural gap. When the gap is narrower than natural, the wall's slanted inner edge (the notch at the
 * top and bottom) is straightened in proportion, so at gap 0 the walls meet along the whole centre line with no
 * black notch. Returns null inside the output gap (unexposed, black). Only for the two-wall (double exposure) tunnel.
 */
export function gapMap(nx: number, ny: number, p: Params): number | null {
  if (!p.doubleExposure) return nx;
  const g0 = naturalGap(p), g = effectiveGap(p);
  if (Math.abs(g - g0) < 1e-9) return nx;
  const a = Math.abs(nx);
  if (a <= g) return null;
  const t = g0 > 1e-9 ? Math.min(1, Math.max(0, (g0 - g) / g0)) : 0;
  const edge = g0 + t * (innerEdge(ny, p) - g0);
  return Math.sign(nx) * (edge + ((a - g) * (1 - edge)) / (1 - g));
}

/** Distance fog: brightness factor for light recorded at camera distance c (1 at the near end). */
export function depthFade(c: number, p: Params): number {
  return Math.pow(p.track.nearDistance / Math.max(c, p.track.nearDistance), p.exposure.depthFade);
}

export function ease(s: number, mode: Params['accel']): number {
  switch (mode) {
    case 'linear': return s;
    case 'ease-in': return s * s; // starts slow, accelerates
    case 'exponential': return (Math.exp(3 * s) - 1) / (Math.exp(3) - 1);
  }
}

/** Camera distance from the slit plane at exposure progress s in [0,1] (far -> near). */
export function cameraZ(s: number, p: Params): number {
  return p.track.nearDistance + p.track.length * (1 - ease(s, p.accel));
}

export function tanHalf(p: Params): { x: number; y: number } {
  const y = Math.tan((p.camera.fovY * Math.PI) / 360);
  return { x: y * p.filmAspect, y };
}

/** Analytic NDC x of the slit's centre line (pinhole projection of the point (offsetX,0,0)). */
export function slitCentreNdcX(c: number, p: Params, side: Side = 1): number {
  return (side * p.slit.offsetX) / (c * tanHalf(p).x);
}

/** Analytic NDC x extent [left,right] of the slit image. */
export function slitNdcRange(c: number, p: Params, side: Side = 1): [number, number] {
  const k = c * tanHalf(p).x;
  const x = side * p.slit.offsetX;
  return [(x - p.slit.width / 2) / k, (x + p.slit.width / 2) / k];
}

export interface RayHit {
  slit: { x: number; y: number };
  panel: { x: number; y: number };
  uv: { u: number; v: number } | null; // null if the ray misses the physical panel
}

/** Trace the ray through NDC pixel (nx,ny) for camera distance c. null = blocked by mask. */
export function traceRay(nx: number, ny: number, c: number, p: Params, panelOffset = 0, side: Side = 1): RayHit | null {
  const t = tanHalf(p);
  const dx = nx * t.x, dy = ny * t.y; // direction xy per unit depth
  const sx = c * dx, sy = c * dy;
  if (Math.abs(sx - side * p.slit.offsetX) > p.slit.width / 2 || Math.abs(sy) > slitHalfLength(p)) return null;
  const depth = c + p.panel.distance;
  const px = depth * dx, py = depth * dy;
  const u = (px - panelOffset) / p.panel.width + 0.5;
  const v = py / p.panel.height + 0.5;
  // u is unbounded: the artwork tiles (mirrored) horizontally as the slide travels.
  // with extendEnds the back panel is also treated as larger than any view (mirrored art), so it never cuts the picture
  const uv = p.slit.extendEnds || (v >= 0 && v <= 1) ? { u, v } : null;
  return { slit: { x: sx, y: sy }, panel: { x: px, y: py }, uv };
}

/**
 * Art slide position (ft) at animation frame f. Scroll speed follows the accel curve:
 * linear gives exactly scrollPerFrame*f; the other modes keep the same total travel
 * over art.frames but start slow and accelerate.
 */
export function panelOffset(frame: number, p: Params): number {
  const n = p.art.frames;
  return p.art.scrollPerFrame * n * ease(Math.min(Math.max(frame / n, 0), 1), p.accel);
}

/** Inverse of ease(): exposure progress s for eased value u in [0,1]. */
export function easeInv(u: number, mode: Params['accel']): number {
  switch (mode) {
    case 'linear': return u;
    case 'ease-in': return Math.sqrt(u);
    case 'exponential': return Math.log(1 + u * (Math.exp(3) - 1)) / 3;
  }
}

/**
 * Gather formulation: the exposure-progress interval [sLo,sHi] ⊂ [0,1] during which the ray
 * through NDC pixel (nx,ny) passes the slit on `side` (null = never). The ray passes iff
 * |c·dx − X| ≤ w/2 and c·|dy| ≤ H/2, which is an interval in camera distance c, mapped
 * through the camera path. Continuous in the pixel, so no gaps regardless of sample count.
 * Mirrors gather() in SLIT_FS.
 */
export function cameraInterval(nx: number, ny: number, side: Side, p: Params): { sLo: number; sHi: number } | null {
  const t = tanHalf(p);
  const dx = nx * t.x, dy = ny * t.y;
  const X = side * p.slit.offsetX, hw = p.slit.width / 2;
  let lo: number, hi: number;
  if (Math.abs(dx) < 1e-6) {
    if (Math.abs(X) > hw) return null;
    lo = 0; hi = 1e9;
  } else {
    const a = (X - hw) / dx, b = (X + hw) / dx;
    lo = Math.min(a, b); hi = Math.max(a, b);
  }
  if (Math.abs(dy) > 1e-6) hi = Math.min(hi, slitHalfLength(p) / Math.abs(dy));
  const near = p.track.nearDistance, len = p.track.length;
  lo = Math.max(lo, near); hi = Math.min(hi, near + len);
  if (hi <= lo) return null;
  return { sLo: easeInv(1 - (hi - near) / len, p.accel), sHi: easeInv(1 - (lo - near) / len, p.accel) };
}

/**
 * Edge-preserving sampling window: sample only the central (1 - sharpness) fraction of a pixel's
 * exposure interval while keeping the full interval as the brightness weight, so band edges are
 * not smeared by the slit width. sharpness 0 = integrate the whole interval (physical).
 */
export function sampleWindow(iv: { sLo: number; sHi: number }, sharpness: number): { lo: number; hi: number; weight: number } {
  const k = Math.min(0.95, Math.max(0, sharpness)), mid = (iv.sLo + iv.sHi) / 2, half = ((iv.sHi - iv.sLo) / 2) * (1 - k);
  return { lo: mid - half, hi: mid + half, weight: iv.sHi - iv.sLo };
}

/** Stratified samples per pixel inside the interval, derived from exposure.samples (substeps). */
export function gatherSamples(substeps: number): number {
  return Math.min(64, Math.max(8, Math.round(substeps / 8)));
}

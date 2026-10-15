// Pure mapping logic for user-image artwork. IMAGE_ART_FS (imageShaders.ts) mirrors these functions.
// Panel coordinates q are in "panel-height units": q.y in [-0.5,0.5] spans the panel height, q.x in
// [-aspect/2, aspect/2] its width. The slide (scroll) runs along x, i.e. along the art texture's u axis.

export type Fit = 'fill' | 'fit' | 'tile';
export type Wrap = 'mirror' | 'repeat';
export type SeqMode = 'single' | 'sequence' | 'crossfade';
export const FITS: Fit[] = ['fill', 'fit', 'tile'];
export const WRAPS: Wrap[] = ['mirror', 'repeat'];
export const SEQ_MODES: SeqMode[] = ['single', 'sequence', 'crossfade'];
export const MAX_IMAGES = 8;
export const MAX_IMAGE_SIDE = 4096;

export interface ImageFileInfo { name: string; bytes: number; width: number; height: number; hash: string }

export interface MapOpts {
  fit: Fit; wrap: Wrap; scale: number; offsetX: number; offsetY: number; rotationDeg: number;
  canvasAspect: number; // aspect of the area the image is placed in (panel, or one panel segment)
  imgAspect: number;
}

/** Size (panel-height units) at which the image is drawn before user scale: fill covers, fit contains, tile = panel height. */
export function drawnSize(fit: Fit, canvasAspect: number, imgAspect: number): { w: number; h: number } {
  if (fit === 'tile') return { w: imgAspect, h: 1 };
  const hCover = Math.max(1, canvasAspect / imgAspect), hContain = Math.min(1, canvasAspect / imgAspect);
  const h = fit === 'fill' ? hCover : hContain;
  return { w: h * imgAspect, h };
}

/** Wrap a texture coordinate: mirror (continuous at tile borders) or repeat. */
export function wrapCoord(t: number, wrap: Wrap): number {
  if (wrap === 'repeat') return t - Math.floor(t);
  const m = t - 2 * Math.floor(t / 2); // [0,2)
  return 1 - Math.abs(1 - m);
}

/** Panel point -> image uv. inside=false (only for fit) means the panel point lies outside the image: no light. */
export function panelToImage(qx: number, qy: number, o: MapOpts): { u: number; v: number; inside: boolean } {
  const th = (o.rotationDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const px = qx - o.offsetX, py = qy - o.offsetY;
  const x = (c * px + s * py) / o.scale, y = (-s * px + c * py) / o.scale;
  const d = drawnSize(o.fit, o.canvasAspect, o.imgAspect);
  const u = x / d.w + 0.5, v = y / d.h + 0.5;
  if (o.fit === 'fit') return { u, v, inside: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
  return { u: wrapCoord(u, o.wrap), v: wrapCoord(v, o.wrap), inside: true };
}

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Weight of the direct sample in the seam-hiding cross-fade (repeat wrap): 0 at the tile border, 1 inside. */
export function seamWeight(u: number, margin: number): number {
  if (margin <= 0) return 1;
  return smoothstep(0, margin, u) * smoothstep(0, margin, 1 - u);
}

/** Make any function of the panel u (0..1) tile seamlessly: blend with the half-shifted copy near the borders. */
export function seamless<T extends number>(F: (u: number) => T, u: number, margin: number): number {
  const w = seamWeight(u, margin);
  return w * F(u) + (1 - w) * F((u + 0.5) % 1);
}

/** Per-image weights along the panel for the sequence modes. u in [0,1). Sums to 1. */
export function imageWeights(u: number, n: number, mode: SeqMode, single = 0): number[] {
  const w = new Array<number>(n).fill(0);
  if (n <= 0) return w;
  if (mode === 'single') { w[Math.min(Math.max(single, 0), n - 1)] = 1; return w; }
  if (mode === 'sequence') { w[Math.min(n - 1, Math.floor(u * n))] = 1; return w; }
  const t = u * n - 0.5, k = Math.floor(t), f = smoothstep(0, 1, t - k);
  const a = ((k % n) + n) % n, b = (((k + 1) % n) + n) % n;
  w[a] += 1 - f; w[b] += f;
  return w;
}

/** Local panel-u inside the segment of the image that owns u (sequence mode); the whole panel otherwise. */
export function segmentCoord(u: number, n: number, mode: SeqMode): { uLocal: number; canvasScale: number } {
  if (mode !== 'sequence' || n <= 1) return { uLocal: u, canvasScale: 1 };
  const x = u * n; return { uLocal: x - Math.floor(x), canvasScale: 1 / n };
}

/** Optional pre-adjust of the (linear) image colour: contrast and saturation in display (gamma 2.2) space. Neutral = identity. */
export function preAdjust(rgb: [number, number, number], contrast: number, saturation: number): [number, number, number] {
  const s = rgb.map(v => Math.pow(Math.max(v, 0), 1 / 2.2));
  let t = s.map(v => (v - 0.5) * contrast + 0.5);
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  t = t.map(v => Math.min(1, Math.max(0, l + (v - l) * saturation)));
  return t.map(v => Math.pow(v, 2.2)) as [number, number, number];
}

/** Largest size not exceeding `max` on either side, aspect preserved, never upscaled. */
export function fitMaxSize(w: number, h: number, max: number): { width: number; height: number; scaled: boolean } {
  const k = Math.min(1, max / Math.max(w, h));
  return k >= 1 ? { width: w, height: h, scaled: false } : { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), scaled: true };
}

/** FNV-1a (32 bit) of file bytes, hex. Identifies an image for the reload check. */
export function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type ImageStatus = { state: 'ok' } | { state: 'missing' | 'mismatch'; message: string };

/** Compare the images a project (params JSON) expects with what is loaded now. */
export function imageStatus(expected: ImageFileInfo[], loaded: ImageFileInfo[]): ImageStatus {
  if (expected.length === 0 && loaded.length === 0) return { state: 'missing', message: 'No image loaded: choose or drop PNG/JPEG/WebP files.' };
  if (loaded.length === 0) return { state: 'missing', message: `Missing image${expected.length > 1 ? 's' : ''}: ${expected.map(f => f.name).join(', ')}. Load the same file${expected.length > 1 ? 's' : ''} again.` };
  if (expected.length === 0) return { state: 'ok' };
  const bad = expected.filter((e, i) => !loaded[i] || loaded[i].name !== e.name || loaded[i].hash !== e.hash);
  if (loaded.length !== expected.length || bad.length) {
    const names = (bad.length ? bad : expected).map(f => f.name).join(', ');
    return { state: 'mismatch', message: `Image mismatch (${names}): the loaded files differ from the ones this project was made with.` };
  }
  return { state: 'ok' };
}

// Deterministic generator for the bundled sample artwork (public/samples/*.png).
// No third-party content, no network: every picture is computed from a seed with the code below.
//   node scripts/make-samples.mjs            # writes public/samples/*.png and thumbs/*.png
// All pictures tile seamlessly along x (the scroll axis of the slit-scan panel).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_IDS = ['flower', 'coral', 'architecture', 'circuit', 'cells', 'marbling', 'painting', 'stripes'];
export const SAMPLE_SEEDS = { flower: 11, coral: 23, architecture: 37, circuit: 41, cells: 53, marbling: 67, painting: 71, stripes: 83 };

// ---------------------------------------------------------------- random & noise
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ihash(x, y, z, seed) {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.min(1, Math.max(0, v));
function vnoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => ihash(xi + a, yi + b, zi + c, seed);
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), u), mix(h(0, 1, 0), h(1, 1, 0), u), v),
    mix(mix(h(0, 0, 1), h(1, 0, 1), u), mix(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
/** Noise periodic in x with period W: x is wrapped onto a cylinder. One unit of the noise lattice = `size` pixels. */
function pnoise(x, y, W, size, seed, z = 0) {
  const a = (2 * Math.PI * x) / W, R = W / (2 * Math.PI * size);
  return vnoise3(R * Math.cos(a) + 100, R * Math.sin(a) + 100, y / size + z, seed);
}
function pfbm(x, y, W, size, seed, oct = 5, z = 0) {
  let s = 0, a = 0.5, n = 1;
  for (let i = 0; i < oct; i++) { s += a * pnoise(x, y, W, size / n, seed + i * 17, z); a *= 0.5; n *= 2; }
  return s;
}
function hsv(h, s, v) {
  h = h - Math.floor(h);
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}
const wrapDx = (dx, W) => { dx = dx - W * Math.round(dx / W); return dx; };

// ---------------------------------------------------------------- tiny raster canvas (float RGB, wraps in x)
class Canvas {
  constructor(W, H) { this.W = W; this.H = H; this.px = new Float32Array(W * H * 3); }
  fill(fn) {
    const { W, H, px } = this;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fn(x, y), k = (y * W + x) * 3; px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; }
  }
  blend(x, y, c, a) {
    if (a <= 0 || y < 0 || y >= this.H) return;
    x = ((x % this.W) + this.W) % this.W; const k = (y * this.W + x) * 3, p = this.px;
    p[k] = mix(p[k], c[0], a); p[k + 1] = mix(p[k + 1], c[1], a); p[k + 2] = mix(p[k + 2], c[2], a);
  }
  /** anti-aliased thick segment, drawn on three x copies so it wraps around the tile */
  line(x0, y0, x1, y1, w, c, alpha = 1) {
    const hw = w / 2 + 0.75, dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    for (const off of [-this.W, 0, this.W]) {
      const ax = x0 + off, bx = x1 + off;
      const xa = Math.floor(Math.min(ax, bx) - hw), xb = Math.ceil(Math.max(ax, bx) + hw);
      if (xb < 0 || xa >= this.W) continue;
      const ya = Math.max(0, Math.floor(Math.min(y0, y1) - hw)), yb = Math.min(this.H - 1, Math.ceil(Math.max(y0, y1) + hw));
      for (let y = ya; y <= yb; y++) for (let x = Math.max(0, xa); x <= Math.min(this.W - 1, xb); x++) {
        const t = clamp01(((x - ax) * dx + (y - y0) * dy) / len2), qx = ax + t * dx, qy = y0 + t * dy;
        const d = Math.hypot(x - qx, y - qy), cov = clamp01(w / 2 + 0.5 - d);
        if (cov > 0) this.blend(x, y, c, cov * alpha);
      }
    }
  }
  disc(cx, cy, r, c, alpha = 1) {
    for (const off of [-this.W, 0, this.W]) {
      const xa = Math.floor(cx + off - r - 1), xb = Math.ceil(cx + off + r + 1);
      if (xb < 0 || xa >= this.W) continue;
      for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(this.H - 1, Math.ceil(cy + r + 1)); y++)
        for (let x = Math.max(0, xa); x <= Math.min(this.W - 1, xb); x++) { const d = Math.hypot(x - cx - off, y - cy); this.blend(x, y, c, clamp01(r + 0.5 - d) * alpha); }
    }
  }
  ring(cx, cy, r, w, c, alpha = 1) {
    for (const off of [-this.W, 0, this.W]) {
      const xa = Math.floor(cx + off - r - w), xb = Math.ceil(cx + off + r + w);
      if (xb < 0 || xa >= this.W) continue;
      for (let y = Math.max(0, Math.floor(cy - r - w)); y <= Math.min(this.H - 1, Math.ceil(cy + r + w)); y++)
        for (let x = Math.max(0, xa); x <= Math.min(this.W - 1, xb); x++) { const d = Math.abs(Math.hypot(x - cx - off, y - cy) - r); this.blend(x, y, c, clamp01(w / 2 + 0.5 - d) * alpha); }
    }
  }
}

// ---------------------------------------------------------------- the eight pictures
function flower(W, H, seed) {
  const r = mulberry32(seed), s = H / 1024, cv = new Canvas(W, H);
  cv.fill((x, y) => { const n = pfbm(x, y, W, 90 * s, seed, 4); return hsv(0.72 + 0.06 * n, 0.85, 0.10 + 0.22 * (y / H) + 0.12 * n); });
  const flowers = [];
  const cols = 4;
  for (let i = 0; i < cols; i++) {
    flowers.push({ x: ((i + 0.5) / cols) * W + (r() - 0.5) * 60 * s, y: H * (0.30 + 0.12 * r()), R: (250 + 60 * r()) * s, k: 8 + 2 * Math.floor(r() * 4), hue: 0.92 + 0.12 * r(), rot: r() * 6.28 });
    flowers.push({ x: ((i + 0.0) / cols) * W + (r() - 0.5) * 40 * s, y: H * (0.78 + 0.08 * r()), R: (190 + 50 * r()) * s, k: 7 + 2 * Math.floor(r() * 4), hue: 0.05 + 0.2 * r(), rot: r() * 6.28 });
  }
  const layers = [[1.0, 0.45, 0, 0.0], [0.78, 0.55, 0.06, 0.5], [0.52, 0.65, 0.12, 1.0], [0.3, 0.8, 0.2, 1.7]];
  for (const f of flowers) {
    const xa = Math.floor(f.x - f.R * 1.05), xb = Math.ceil(f.x + f.R * 1.05);
    for (let y = Math.max(0, Math.floor(f.y - f.R * 1.05)); y < Math.min(H, Math.ceil(f.y + f.R * 1.05)); y++)
      for (let x = xa; x <= xb; x++) {
        const dx = x - f.x, dy = y - f.y, rr = Math.hypot(dx, dy), phi = Math.atan2(dy, dx) + f.rot;
        for (const [sc, sharp, dh, rotk] of layers) {
          const kk = f.k, petal = Math.pow(Math.abs(Math.cos((kk * (phi + rotk)) / 2)), 0.55 + sharp * 0.6);
          const Rp = f.R * sc * (0.35 + 0.65 * petal);
          if (rr < Rp) {
            const t = rr / Rp, vein = 1 - 0.55 * sstep(0.0, 0.07, Math.abs(Math.sin((kk * (phi + rotk)) / 2)) * (1 - t * 0.4));
            const hue = f.hue + dh + 0.10 * t, val = (0.45 + 0.55 * t * t + 0.1 * (1 - t)) * (0.55 + 0.45 * vein);
            cv.blend(x, y, hsv(hue, 0.92 - 0.15 * (1 - t), clamp01(val)), 1 - sstep(Rp - 1.5, Rp, rr) * 0.0);
          }
        }
        if (rr < f.R * 0.06) cv.blend(x, y, hsv(0.13, 0.95, 1), 1);
      }
  }
  for (let i = 0; i < 90; i++) cv.disc(r() * W, r() * H, (1 + 3 * r()) * s, hsv(0.1 + 0.8 * r(), 0.6, 1), 0.8);
  return cv.px;
}

function coral(W, H, seed) {
  const r = mulberry32(seed), s = H / 1024, cv = new Canvas(W, H);
  cv.fill((x, y) => { const n = pfbm(x, y, W, 120 * s, seed, 4); const t = y / H; return hsv(0.55 + 0.08 * (1 - t) + 0.03 * n, 0.9, 0.12 + 0.35 * (1 - t) * (0.6 + 0.6 * n)); });
  const roots = 13;
  const tips = [];
  const branch = (x, y, ang, len, w, depth, hue) => {
    if (depth < 0 || len < 3 * s) return;
    const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
    cv.line(x, y, x1, y1, Math.max(1.2, w), hsv(hue, 0.85 - 0.15 * (depth / 9), 0.55 + 0.45 * (1 - depth / 9)), 0.97);
    if (depth === 0 || len < 8 * s) tips.push([x1, y1]);
    const n = r() < 0.18 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const da = (i - (n - 1) / 2) * (0.5 + 0.35 * r()) + (r() - 0.5) * 0.3;
      branch(x1, y1, ang + da, len * (0.70 + 0.1 * r()), w * 0.74, depth - 1, hue + (r() - 0.5) * 0.03);
    }
  };
  for (let i = 0; i < roots; i++) {
    const x = ((i + 0.5 + (r() - 0.5) * 0.5) / roots) * W, hue = [0.0, 0.03, 0.95, 0.07, 0.99][i % 5];
    branch(x, H + 4 * s, -Math.PI / 2 + (r() - 0.5) * 0.4, (150 + 90 * r()) * s, (17 + 6 * r()) * s, 8, hue);
  }
  for (const [x, y] of tips) cv.disc(x, y, (2 + 2.5 * r()) * s, hsv(0.12 + 0.05 * r(), 0.5, 1), 0.95);
  for (let i = 0; i < 160; i++) cv.disc(r() * W, r() * H, (1 + 2 * r()) * s, hsv(0.5, 0.3, 1), 0.35);
  return cv.px;
}

function architecture(W, H, seed) {
  const r = mulberry32(seed), s = H / 1024, cv = new Canvas(W, H);
  cv.fill((x, y) => { const t = y / H; return hsv(0.60 + 0.04 * t, 0.9, 0.18 + 0.30 * (1 - Math.abs(t - 0.45) * 1.6)); });
  const blocks = 4, lw = 1.8 * s, cyan = hsv(0.5, 0.35, 1), white = [1, 1, 1], amber = hsv(0.11, 0.9, 1), mag = hsv(0.88, 0.7, 1);
  const horizon = H * 0.46;
  for (let b = 0; b < blocks; b++) {
    const cx = ((b + 0.5) / blocks) * W, span = W / blocks * 0.46;
    // ground grid in perspective
    for (let i = -14; i <= 14; i++) cv.line(cx, horizon, cx + i * span * 0.16, H, lw * 0.8, cyan, 0.55);
    for (let j = 1; j < 18; j++) { const t = Math.pow(j / 18, 2.1), y = horizon + t * (H - horizon); cv.line(cx - span, y, cx + span, y, lw * 0.8, cyan, 0.5); }
    // facades left/right: window grids converging on the vanishing point
    for (const side of [-1, 1]) {
      const x0 = cx + side * span * 0.28, x1 = cx + side * span * 0.97, hTop = H * (0.04 + 0.14 * r()), hBot = H * (0.86 + 0.06 * r());
      const yTop = (x) => mix(horizon, hTop, (Math.abs(x - cx) - span * 0.28 * 0) / (span * 0.97));
      const yBot = (x) => mix(horizon, hBot, (Math.abs(x - cx)) / (span * 0.97));
      cv.line(x0, yTop(x0), x0, yBot(x0), lw * 1.4, white);
      cv.line(x1, yTop(x1), x1, yBot(x1), lw * 1.4, white);
      cv.line(x0, yTop(x0), x1, yTop(x1), lw * 1.4, white);
      cv.line(x0, yBot(x0), x1, yBot(x1), lw * 1.4, white);
      const cols = 7;
      for (let i = 1; i < cols; i++) { const t = Math.pow(i / cols, 0.8), x = mix(x0, x1, t); cv.line(x, yTop(x), x, yBot(x), lw, amber, 0.85); }
      for (let j = 1; j < 14; j++) { const f = j / 14; cv.line(x0, mix(yTop(x0), yBot(x0), f), x1, mix(yTop(x1), yBot(x1), f), lw, cyan, 0.9); }
      // lit windows
      for (let i = 0; i < 24; i++) {
        const t = (Math.floor(r() * 6) + 0.5) / 6, f = (Math.floor(r() * 13) + 0.5) / 13, x = mix(x0, x1, Math.pow(t, 1.0));
        cv.disc(x, mix(yTop(x), yBot(x), f), (4 + 5 * (1 - t)) * s, i % 3 ? amber : mag, 0.9);
      }
    }
    // vanishing lines and horizon
    for (let i = 0; i < 12; i++) { const a = -0.9 + (1.8 * i) / 11; cv.line(cx, horizon, cx + Math.sin(a) * span * 1.6, horizon - Math.cos(a) * H * 0.7, lw * 0.7, white, 0.35); }
    cv.disc(cx, horizon, 6 * s, white, 1);
  }
  cv.line(0, horizon, W, horizon, lw * 1.6, white, 0.9);
  return cv.px;
}

function circuit(W, H, seed) {
  const r = mulberry32(seed), s = H / 1024, cv = new Canvas(W, H);
  cv.fill((x, y) => { const n = pfbm(x, y, W, 40 * s, seed, 3); return hsv(0.40 + 0.03 * n, 0.85, 0.16 + 0.10 * n); });
  const pitch = 20 * s, gx = Math.round(W / pitch), gy = Math.round(H / pitch);
  const copper = hsv(0.095, 0.85, 1), gold = hsv(0.13, 0.75, 1), cyan = hsv(0.5, 0.8, 1);
  const traces = 190;
  for (let t = 0; t < traces; t++) {
    let x = Math.floor(r() * gx), y = Math.floor(r() * gy), dir = Math.floor(r() * 8), w = (2.5 + 2.2 * r()) * s;
    const col = r() < 0.2 ? cyan : r() < 0.5 ? gold : copper, steps = 5 + Math.floor(r() * 11);
    const sx = x, sy = y;
    for (let i = 0; i < steps; i++) {
      const len = 1 + Math.floor(r() * 7);
      const dxs = [1, 1, 0, -1, -1, -1, 0, 1], dys = [0, 1, 1, 1, 0, -1, -1, -1];
      const nx = x + dxs[dir] * len, ny = Math.min(gy, Math.max(0, y + dys[dir] * len));
      cv.line(x * pitch, y * pitch, nx * pitch, ny * pitch, w, col, 0.97);
      x = nx; y = ny;
      if (r() < 0.65) dir = (dir + (r() < 0.5 ? 1 : 7)) % 8; // turn by 45 degrees
      if (r() < 0.15) dir = (dir + 2 * (r() < 0.5 ? 1 : 3)) % 8;
    }
    for (const [px, py] of [[sx, sy], [x, y]]) { cv.disc(px * pitch, py * pitch, w * 1.9, col); cv.disc(px * pitch, py * pitch, w * 0.8, [0.02, 0.05, 0.03]); }
  }
  // chips with pins
  for (let i = 0; i < 16; i++) {
    const w = (70 + 90 * r()) * s, h = (50 + 70 * r()) * s, x = r() * W, y = r() * (H - h), pins = Math.max(3, Math.round(w / (12 * s)));
    cv.line(x, y, x + w, y, h, [0.03, 0.04, 0.05], 1); cv.line(x, y + h / 2, x + w, y + h / 2, h, [0.03, 0.04, 0.05], 1);
    cv.line(x, y, x + w, y, 2 * s, hsv(0.55, 0.3, 0.9), 0.8); cv.disc(x + 7 * s, y + 7 * s, 3 * s, hsv(0.55, 0.3, 0.9), 0.9);
    for (let p = 0; p < pins; p++) { const px = x + ((p + 0.5) * w) / pins; cv.line(px, y - 9 * s, px, y, 3 * s, [0.95, 0.85, 0.5]); cv.line(px, y + h, px, y + h + 9 * s, 3 * s, [0.95, 0.85, 0.5]); }
  }
  return cv.px;
}

function cells(W, H, seed) {
  const s = H / 1024, GX = Math.max(8, Math.round(W / (64 * s))), GY = Math.max(4, Math.round(H / (64 * s))), cw = W / GX, ch = H / GY;
  const pts = new Float32Array(GX * GY * 2);
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { pts[(j * GX + i) * 2] = (i + 0.15 + 0.7 * ihash(i, j, 1, seed)) * cw; pts[(j * GX + i) * 2 + 1] = (j + 0.15 + 0.7 * ihash(i, j, 2, seed)) * ch; }
  const cv = new Canvas(W, H);
  cv.fill((x, y) => {
    const gi = Math.floor(x / cw), gj = Math.floor(y / ch);
    let d1 = 1e9, d2 = 1e9, bi = 0, bj = 0, bx = 0, by = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const j = gj + b; if (j < 0 || j >= GY) continue;
      const i = (((gi + a) % GX) + GX) % GX, wrap = Math.floor((gi + a) / GX) * W;
      const px = pts[(j * GX + i) * 2] + wrap, py = pts[(j * GX + i) * 2 + 1], d = Math.hypot(x - px, y - py);
      if (d < d1) { d2 = d1; d1 = d; bi = i; bj = j; bx = px; by = py; } else if (d < d2) d2 = d;
    }
    const id = ihash(bi, bj, 3, seed), id2 = ihash(bi, bj, 4, seed);
    const hue = [0.50, 0.58, 0.83, 0.92, 0.12, 0.35][Math.floor(id * 6) % 6] + 0.05 * id2;
    const edge = sstep(0, 3.5 * s, (d2 - d1)), nuc = 1 - sstep(10 * s, 16 * s, d1), ring = 1 - sstep(0, 2.5 * s, Math.abs(d1 - 24 * s * (0.6 + id2)));
    const base = hsv(hue, 0.9 - 0.4 * nuc, 0.30 + 0.55 * (1 - d1 / (50 * s)) * (0.6 + 0.4 * id2));
    const g = [base[0] * edge + (1 - edge) * 0.02, base[1] * edge + (1 - edge) * 0.02, base[2] * edge + (1 - edge) * 0.02];
    const nucc = hsv(hue + 0.45, 0.8, 0.25);
    return [mix(g[0], nucc[0], nuc * 0.8) + 0.35 * ring * edge * (1 - nuc), mix(g[1], nucc[1], nuc * 0.8) + 0.35 * ring * edge * (1 - nuc), mix(g[2], nucc[2], nuc * 0.8) + 0.35 * ring * edge * (1 - nuc)];
  });
  return cv.px;
}

function marbling(W, H, seed) {
  const s = H / 1024, cv = new Canvas(W, H);
  const pal = [[0.60, 0.95, 0.55], [0.05, 0.95, 1], [0.12, 0.9, 1], [0.83, 0.85, 0.85], [0.50, 0.9, 0.9], [0.0, 0.0, 0.08]];
  cv.fill((x, y) => {
    const qx = pfbm(x, y, W, 180 * s, seed, 4), qy = pfbm(x, y, W, 180 * s, seed + 31, 4);
    const wx = x + 260 * s * (qx - 0.5), wy = y + 260 * s * (qy - 0.5);
    const rx = pfbm(wx, wy, W, 150 * s, seed + 7, 4), f = pfbm(wx + 140 * s * (rx - 0.5), wy, W, 130 * s, seed + 13, 5);
    const bands = f * 7, id = Math.floor(bands), t = bands - id;
    const c0 = pal[((id % 6) + 6) % 6], c1 = pal[(((id + 1) % 6) + 6) % 6];
    const a = hsv(c0[0], c0[1], c0[2]), b = hsv(c1[0], c1[1], c1[2]), m = sstep(0.62, 0.78, t);
    const vein = 1 - 0.85 * (1 - sstep(0, 0.045, Math.min(t, 1 - t)));   // dark ink lines between paints
    const sheen = 0.88 + 0.12 * Math.sin(f * 90);
    return [mix(a[0], b[0], m) * vein * sheen, mix(a[1], b[1], m) * vein * sheen, mix(a[2], b[2], m) * vein * sheen];
  });
  return cv.px;
}

function painting(W, H, seed) {
  const r = mulberry32(seed), s = H / 1024, cv = new Canvas(W, H);
  const bands = 5, bandCol = Array.from({ length: bands }, (_, i) => hsv((i * 0.21 + 0.03) % 1, 0.8, 0.55 + 0.4 * r()));
  cv.fill((x, y) => { const i = Math.floor(((x + 0.18 * y) / W) * bands + bands * 8) % bands; const c = bandCol[i], t = y / H; return [c[0] * (0.6 + 0.4 * t), c[1] * (0.6 + 0.4 * t), c[2] * (0.6 + 0.4 * t)]; });
  const shapes = [];
  for (let i = 0; i < 38; i++) {
    const type = Math.floor(r() * 4);
    shapes.push({ type, x: r() * W, y: r() * H, size: (60 + 260 * Math.pow(r(), 1.5)) * s, rot: r() * 6.28, h0: r(), h1: r(), v: 0.7 + 0.3 * r(), ar: 0.4 + 1.4 * r() });
  }
  shapes.sort((a, b) => b.size - a.size);
  for (const sh of shapes) {
    const R = sh.size * 1.6;
    for (let y = Math.max(0, Math.floor(sh.y - R)); y < Math.min(H, Math.ceil(sh.y + R)); y++)
      for (let x = Math.floor(sh.x - R); x <= Math.ceil(sh.x + R); x++) {
        const dx = x - sh.x, dy = y - sh.y, c = Math.cos(sh.rot), sn = Math.sin(sh.rot), u = c * dx + sn * dy, v = -sn * dx + c * dy;
        let inside = false;
        if (sh.type === 0) inside = Math.hypot(u, v) < sh.size;
        else if (sh.type === 1) inside = Math.abs(u) < sh.size * sh.ar && Math.abs(v) < sh.size;
        else if (sh.type === 2) inside = v > -sh.size && v < sh.size && Math.abs(u) < (sh.size - v) * 0.5 * sh.ar + 1;   // triangle
        else { const rr = Math.hypot(u, v); inside = rr < sh.size && rr > sh.size * 0.62 && v > -sh.size * 0.3; }       // arc band
        if (!inside) continue;
        const t = clamp01((u / sh.size + 1) / 2), col = hsv(mix(sh.h0, sh.h1, t), 0.9, sh.v * (0.65 + 0.35 * (1 - clamp01(Math.abs(v) / sh.size))));
        cv.blend(x, y, col, 1);
      }
  }
  for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * H; cv.line(x, y, x + (r() - 0.5) * 500 * s, y + (r() - 0.5) * 300 * s, (3 + 7 * r()) * s, hsv(r(), 0.2 * r(), 1), 0.9); }
  return cv.px;
}

function stripes(W, H, seed) {
  const r = mulberry32(seed), s = H / 1024, cv = new Canvas(W, H);
  const rows = [];
  let y = 0;
  while (y < H) { const h = (70 + 150 * r()) * s; rows.push({ y0: y, y1: Math.min(H, y + h), type: Math.floor(r() * 5), k: 8 + 4 * Math.floor(r() * 10), m: 1 + Math.floor(r() * 4), p: r(), c: Math.floor(r() * 4) }); y += h; }
  const palettes = [[[0, 0, 0], [1, 1, 1], hsv(0.0, 1, 1)], [[0, 0, 0], hsv(0.14, 1, 1), hsv(0.55, 1, 1)], [[1, 1, 1], hsv(0.85, 1, 1), [0, 0, 0]], [[0, 0, 0], hsv(0.5, 1, 1), hsv(0.9, 1, 1)]];
  cv.fill((x, yy) => {
    const row = rows.find(rw => yy >= rw.y0 && yy < rw.y1) ?? rows[rows.length - 1], pal = palettes[row.c], u = x / W, v = (yy - row.y0) / (row.y1 - row.y0 + 1e-6);
    let ph;
    if (row.type === 0) ph = row.k * u;
    else if (row.type === 1) ph = row.k * u + row.m * (yy / H) * 3;
    else if (row.type === 2) ph = row.k * u + 0.5 * Math.abs(((v * row.m * 2) % 2) - 1);
    else if (row.type === 3) { const dx = wrapDx(x - W * row.p, W), rr = Math.hypot(dx / 2.2, yy - (row.y0 + row.y1) / 2); ph = rr / (14 * s) / 1 + 0.5; return stripeColor(ph, pal); }
    else ph = row.k * u * (1 + 0.0) + 0.25 * Math.sin(2 * Math.PI * (row.m * u + v));
    return stripeColor(ph, pal);
  });
  for (const rw of rows) cv.line(0, rw.y0, W, rw.y0, 3 * s, [1, 1, 1], 1);
  return cv.px;
}
function stripeColor(ph, pal) {
  const f = ph - Math.floor(ph);
  if (f < 0.42 || f > 0.92) return pal[0];   // pattern is symmetric in f, so integer-period stripes tile without a seam
  if (f < 0.5) return pal[1];
  return f < 0.8 ? pal[2] : pal[1];
}

const GENERATORS = { flower, coral, architecture, circuit, cells, marbling, painting, stripes };

/** Render one sample. Deterministic for (id, width, height). Returns {width,height,rgb(Uint8Array)}. */
export function renderSample(id, width = 1536, height = 768) {
  const gen = GENERATORS[id];
  if (!gen) throw new Error('unknown sample ' + id);
  const f = gen(width, height, SAMPLE_SEEDS[id]);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(clamp01(f[i]) * 255);
  return { width, height, rgb };
}

/** Mean |first column - last column| relative to the mean |difference of neighbouring columns| (≈1 when the tile is seamless). */
export function seamRatio({ width, height, rgb }) {
  let seam = 0, inner = 0, n = 0;
  for (let y = 0; y < height; y++) for (let c = 0; c < 3; c++) {
    seam += Math.abs(rgb[(y * width) * 3 + c] - rgb[(y * width + width - 1) * 3 + c]);
    for (let x = 0; x < width - 1; x += 7) { inner += Math.abs(rgb[(y * width + x) * 3 + c] - rgb[(y * width + x + 1) * 3 + c]); n++; }
  }
  return (seam / (height * 3)) / (inner / n + 1e-9);
}

// ---------------------------------------------------------------- PNG writer (RGB8, adaptive filters, zlib level 9)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng({ width, height, rgb }) {
  const bpp = 3, stride = width * bpp, raw = Buffer.alloc((stride + 1) * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride), prev = y ? rgb.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      cand[0][i] = row[i]; cand[1][i] = (row[i] - a) & 255; cand[2][i] = (row[i] - b) & 255; cand[3][i] = (row[i] - ((a + b) >> 1)) & 255; cand[4][i] = (row[i] - paeth(a, b, c)) & 255;
    }
    let best = 0, bs = Infinity;
    for (let f = 0; f < 5; f++) { let sum = 0; for (let i = 0; i < stride; i++) { const v = cand[f][i]; sum += v < 128 ? v : 256 - v; } if (sum < bs) { bs = sum; best = f; } }
    raw[y * (stride + 1)] = best; raw.set(cand[best], y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Box-filter downscale used for the thumbnails. */
export function downscale({ width, height, rgb }, tw, th) {
  const out = new Uint8Array(tw * th * 3), fx = width / tw, fy = height / th;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++) for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) { s += rgb[(yy * width + xx) * 3 + c]; n++; }
    out[(y * tw + x) * 3 + c] = Math.round(s / n);
  }
  return { width: tw, height: th, rgb: out };
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
  const W = Number(process.env.SAMPLE_W ?? 1536), H = Number(process.env.SAMPLE_H ?? 768);
  mkdirSync(join(root, 'thumbs'), { recursive: true });
  let total = 0;
  for (const id of SAMPLE_IDS) {
    const t0 = Date.now(), img = renderSample(id, W, H), png = encodePng(img);
    writeFileSync(join(root, `${id}.png`), png); writeFileSync(join(root, 'thumbs', `${id}.png`), encodePng(downscale(img, 192, Math.round((192 * H) / W))));
    total += png.length;
    console.log(`${id.padEnd(13)} ${W}x${H}  ${(png.length / 1024).toFixed(0).padStart(5)} KB  seam ratio ${seamRatio(img).toFixed(2)}  ${Date.now() - t0} ms`);
  }
  console.log(`total ${(total / 1048576).toFixed(2)} MB`);
}

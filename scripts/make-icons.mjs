// Generates the app icons (public/icons/*.png): a small slit-scan tunnel drawn from scratch, no third-party art.
//   node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './make-samples.mjs';

const hsv = (h, s, v) => { h -= Math.floor(h); const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** `pad`: fraction of the icon kept as safe margin (maskable icons need ~20%) */
function icon(size, pad) {
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const k = 1 - pad; u /= k; v /= k;
    let c = [0.04, 0.04, 0.07];
    if (Math.abs(u) <= 1 && Math.abs(v) <= 1) {
      const gap = 0.11, a = Math.abs(u);
      if (a > gap) {
        // two walls of streaks converging on the centre: colour bands by ray angle, bright near the gap, rings along the rays
        const ang = Math.atan2(v, a), r = Math.hypot(a, v);
        const band = Math.floor((ang / Math.PI + 0.5) * 9), hue = (band * 0.137 + (u > 0 ? 0.0 : 0.5)) % 1;
        const ring = 0.55 + 0.45 * Math.sin(r * 22);
        const edge = sstep(0.0, 0.05, Math.abs(((ang / Math.PI + 0.5) * 9) % 1 - 0.5) * 2 - 0.0) ;
        const glow = Math.pow(1 - sstep(gap, 1.1, a), 1.5);
        c = hsv(hue, 0.85 - 0.5 * glow, (0.35 + 0.65 * ring) * (0.6 + 0.4 * edge) + 0.5 * glow).map(t => Math.min(1, t));
      }
    }
    const o = (y * size + x) * 3; rgb[o] = Math.round(c[0] * 255); rgb[o + 1] = Math.round(c[1] * 255); rgb[o + 2] = Math.round(c[2] * 255);
  }
  return { width: size, height: size, rgb };
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(dir, { recursive: true });
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.2], ['apple-touch-icon.png', 180, 0], ['favicon-32.png', 32, 0]]) {
  writeFileSync(join(dir, name), encodePng(icon(size, pad)));
  console.log('wrote', name);
}

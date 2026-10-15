import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, sampleThumbUrl, sampleUrl } from '../src/art/samples';
import { DEFAULTS, DEFAULT_IMAGE } from '../src/core/params';
import { SAMPLE_IDS, downscale, encodePng, renderSample, seamRatio } from '../scripts/make-samples.mjs';

const root = join(__dirname_(), '..', 'public', 'samples');
function __dirname_(): string { return decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/\/$/, ''); }

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** width/height from a PNG file's IHDR */
function pngSize(bytes: Uint8Array) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  sig.forEach((b, i) => expect(bytes[i]).toBe(b));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('IHDR');
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

describe('bundled sample images', () => {
  it('manifest lists exactly the generated samples (6–8 of them)', () => {
    expect(SAMPLES.map(s => s.id)).toEqual(SAMPLE_IDS);
    expect(SAMPLES.length).toBeGreaterThanOrEqual(6); expect(SAMPLES.length).toBeLessThanOrEqual(8);
    expect(new Set(SAMPLES.map(s => s.id)).size).toBe(SAMPLES.length);
  });

  it('every listed sample and thumbnail file exists, decodes to the listed dimensions, and the set stays small', () => {
    let total = 0;
    for (const s of SAMPLES) {
      const f = join(root, `${s.id}.png`), t = join(root, 'thumbs', `${s.id}.png`);
      expect(existsSync(f), f).toBe(true); expect(existsSync(t), t).toBe(true);
      expect(pngSize(readFileSync(f))).toEqual({ width: s.width, height: s.height });
      const th = pngSize(readFileSync(t)); expect(th.width / th.height).toBeCloseTo(s.width / s.height, 1);
      total += statSync(f).size + statSync(t).size;
      expect(sampleUrl(s.id, '/')).toBe(`/samples/${s.id}.png`); expect(sampleThumbUrl(s.id, '/app/')).toBe(`/app/samples/thumbs/${s.id}.png`);
    }
    expect(total).toBeLessThan(10 * 1024 * 1024);
  });

  it('the generator is deterministic and each picture is detailed, saturated and tileable along x', () => {
    for (const id of SAMPLE_IDS) {
      const a = renderSample(id, 256, 128), b = renderSample(id, 256, 128);
      expect(same(a.rgb, b.rgb), id + ' deterministic').toBe(true);
      // detail: many distinct colours; saturation: mean (max-min) of the channels is clearly above grey
      const seen = new Set<number>(); let chroma = 0;
      for (let i = 0; i < a.rgb.length; i += 3) { seen.add((a.rgb[i] >> 3) << 10 | (a.rgb[i + 1] >> 3) << 5 | (a.rgb[i + 2] >> 3)); chroma += Math.max(a.rgb[i], a.rgb[i + 1], a.rgb[i + 2]) - Math.min(a.rgb[i], a.rgb[i + 1], a.rgb[i + 2]); }
      expect(seen.size, id + ' colours').toBeGreaterThan(8);
      expect(chroma / (a.rgb.length / 3), id + ' chroma').toBeGreaterThan(25);
      expect(seamRatio(a), id + ' seam').toBeLessThan(2.5);   // wrap-around columns differ no more than ordinary neighbours
    }
  });

  it('different seeds/ids give different pictures, and the PNG encoder round-trips the header and size', () => {
    const f = renderSample('flower', 128, 64), c = renderSample('coral', 128, 64);
    expect(same(f.rgb, c.rgb)).toBe(false);
    const png = encodePng(f); expect(pngSize(png)).toEqual({ width: 128, height: 64 });
    expect(downscale(f, 32, 16).rgb.length).toBe(32 * 16 * 3);
  });

  it('default artwork stays procedural; samples are opt-in and not stored as missing files', () => {
    expect(DEFAULTS.art.kind).toBe('noise');
    expect(DEFAULTS.image.sample).toBeNull(); expect(DEFAULT_IMAGE.sample).toBeNull();
    expect(JSON.parse(JSON.stringify({ ...DEFAULTS.image, sample: 'coral' })).sample).toBe('coral');
  });
});

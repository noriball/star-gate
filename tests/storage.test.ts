import { describe, expect, it } from 'vitest';
import { DEFAULTS, clone, FIXED_CENTRE_GAP } from '../src/core/params';
import { DEFAULT_UI, STORAGE_KEY, STORAGE_VERSION, deserialize, loadSettings, paramsFromJson, resetSettings, saveSettings, serialize } from '../src/storage';
import { chooseFloatFormat } from '../src/core/features';

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

describe('settings storage', () => {
  it('round-trips a changed project and is versioned', () => {
    const p = clone(DEFAULTS); p.slit.offsetX = 1.7; p.orientation = 'top-bottom'; p.art.kind = 'bands'; p.color.enabled = true; p.art.frame = 99;
    const text = serialize(p, { quality: 'low', lowPower: true });
    expect(JSON.parse(text).v).toBe(STORAGE_VERSION);
    const r = deserialize(text)!;
    expect(r.params.slit.offsetX).toBe(1.7); expect(r.params.orientation).toBe('top-bottom'); expect(r.params.art.kind).toBe('bands'); expect(r.params.color.enabled).toBe(true);
    expect(r.params.art.frame).toBe(0);                      // the current frame is not persisted
    expect(r.ui).toEqual({ quality: 'low', lowPower: true });
  });
  it('is safe on corrupt, empty, foreign or other-version data', () => {
    for (const bad of [null, '', '{', 'not json', '[]', '42', '{"v":999,"params":{}}', '{"params":{}}', '"x"']) expect(deserialize(bad as string | null)).toBeNull();
    const st = mem(); st.m.set(STORAGE_KEY, '{broken'); expect(loadSettings(st)).toBeNull();
    expect(loadSettings(null)).toBeNull();
  });
  it('validates values: wrong types, NaN, unknown enums and out-of-range numbers fall back or clamp; unknown keys are dropped', () => {
    const evil = { v: 1, params: { slit: { offsetX: 'big', width: 9999, height: NaN, extra: 1 }, orientation: 'sideways', accel: 7, art: { kind: 'virus', seed: -5, frames: 1e9 }, color: { strips: [{ channel: 9 }], enabled: 'yes' }, centreGap: 0.4, hax: {} }, ui: { quality: 'ultra', lowPower: 3 } };
    const r = deserialize(JSON.stringify(evil))!;
    expect(r.params.slit.offsetX).toBe(DEFAULTS.slit.offsetX); expect(r.params.slit.width).toBe(0.3); expect(r.params.slit.height).toBe(DEFAULTS.slit.height);
    expect(r.params.orientation).toBe('left-right'); expect(r.params.accel).toBe(DEFAULTS.accel); expect(r.params.art.kind).toBe(DEFAULTS.art.kind);
    expect(r.params.art.seed).toBe(0); expect(r.params.art.frames).toBe(1200);
    expect(r.params.color.strips).toEqual(DEFAULTS.color.strips); expect(r.params.color.enabled).toBe(DEFAULTS.color.enabled);
    expect((r.params as unknown as Record<string, unknown>).hax).toBeUndefined();
    expect(r.params.centreGap).toBe(FIXED_CENTRE_GAP);        // the fixed centre gap cannot be changed through storage
    expect(r.ui).toEqual(DEFAULT_UI);
  });
  it('user images are not restorable (start on the default artwork) but a bundled sample is', () => {
    const p = clone(DEFAULTS); p.art.kind = 'image'; p.image.files = [{ name: 'a.png', bytes: 1, width: 1, height: 1, hash: 'x' }];
    expect(deserialize(serialize(p, DEFAULT_UI))!.params.art.kind).toBe(DEFAULTS.art.kind);
    p.image.sample = 'coral'; const r = deserialize(serialize(p, DEFAULT_UI))!; expect(r.params.art.kind).toBe('image'); expect(r.params.image.sample).toBe('coral'); expect(r.params.image.files).toEqual([]);
  });
  it('save / load / reset through a storage object; a throwing storage never breaks the app', () => {
    const st = mem(); expect(saveSettings(clone(DEFAULTS), DEFAULT_UI, st)).toBe(true); expect(loadSettings(st)!.params).toEqual(DEFAULTS);
    resetSettings(st); expect(loadSettings(st)).toBeNull();
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
    expect(saveSettings(clone(DEFAULTS), DEFAULT_UI, boom)).toBe(false); expect(loadSettings(boom)).toBeNull(); expect(() => resetSettings(boom)).not.toThrow();
  });
  it('params JSON import: tolerant merge onto the defaults, null on garbage', () => {
    const p = paramsFromJson(JSON.stringify({ slit: { offsetX: 0.5 }, nonsense: 1 }))!; expect(p.slit.offsetX).toBe(0.5); expect(p.slit.width).toBe(DEFAULTS.slit.width);
    expect(paramsFromJson('garbage')).toBeNull(); expect(paramsFromJson('3')).toBeNull();
    expect(paramsFromJson(JSON.stringify(DEFAULTS))).toEqual(DEFAULTS);
  });
});

describe('WebGL capability fallback', () => {
  it('prefers 32-bit float, falls back to half-float, and explains what is missing', () => {
    expect(chooseFloatFormat({ webgl2: true, colorBufferFloat: true, colorBufferHalfFloat: true })).toEqual({ format: 'RGBA32F' });
    expect(chooseFloatFormat({ webgl2: true, colorBufferFloat: false, colorBufferHalfFloat: true })).toEqual({ format: 'RGBA16F' });
    expect(chooseFloatFormat({ webgl2: false, colorBufferFloat: false, colorBufferHalfFloat: false })).toMatchObject({ error: expect.stringMatching(/WebGL2/) });
    expect(chooseFloatFormat({ webgl2: true, colorBufferFloat: false, colorBufferHalfFloat: false })).toMatchObject({ error: expect.stringMatching(/floating-point/) });
  });
});

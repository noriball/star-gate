// Persistence of settings in localStorage: versioned, validated, and safe against corrupt or foreign data.
import { ART_KINDS, DEFAULTS, FIXED_CENTRE_GAP, RANGES, clone, type Params } from './core/params';
import { SEQ_MODES, FITS, WRAPS } from './art/imageMap';
import { parseStrips } from './color/config';

export const STORAGE_KEY = 'stargate.settings';
export const STORAGE_VERSION = 1;

export interface UiSettings { quality: 'auto' | 'high' | 'medium' | 'low'; lowPower: boolean }
export const DEFAULT_UI: UiSettings = { quality: 'auto', lowPower: false };

const ENUMS: Record<string, readonly string[]> = {
  accel: ['linear', 'ease-in', 'exponential'], orientation: ['left-right', 'top-bottom'],
  'art.kind': ART_KINDS, 'image.mode': SEQ_MODES, 'image.fit': FITS, 'image.wrap': WRAPS,
  'color.mode': ['smooth', 'step'], 'color.mix': ['add', 'screen'], 'color.lowCurve': ['lift', 'gamma'], 'color.wheelStyle': ['classic', 'vivid'],
  'color.stripPreset': ['rgb-3', 'rgb-6', 'rgb-12', 'custom'],
};
/** keys that are never persisted: they describe the moment, not the look */
const SKIP = new Set(['art.frame', 'image.files', 'image.sample']);

/** Copy `src` onto a clone of `base`, keeping only known keys with valid types, clamping numbers into their ranges. */
export function sanitizeInto(base: unknown, src: unknown, path = ''): unknown {
  if (Array.isArray(base)) {
    if (path === 'color.strips') { try { return parseStrips(src); } catch { return base; } }
    return base;
  }
  if (base && typeof base === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(base as object)) {
      const p = path ? `${path}.${k}` : k, b = (base as Record<string, unknown>)[k];
      const v = src && typeof src === 'object' ? (src as Record<string, unknown>)[k] : undefined;
      out[k] = SKIP.has(p) || v === undefined ? b : sanitizeInto(b, v, p);
    }
    return out;
  }
  if (typeof base === 'number') {
    if (typeof src !== 'number' || !Number.isFinite(src)) return base;
    const r = (RANGES as Record<string, { min: number; max: number }>)[path];
    return r ? Math.min(r.max, Math.max(r.min, src)) : src;
  }
  if (typeof base === 'boolean') return typeof src === 'boolean' ? src : base;
  if (typeof base === 'string') {
    if (typeof src !== 'string') return base;
    const allowed = ENUMS[path]; return allowed && !allowed.includes(src) ? base : src;
  }
  return base;   // null (e.g. image.sample) and anything unknown keep the default
}

/** Params (as JSON text) -> a fully valid Params; the centre gap is always the fixed one. */
export function paramsFromJson(text: string, defaults: Params = DEFAULTS): Params | null {
  let raw: unknown; try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const p = sanitizeInto(clone(defaults), raw) as Params;
  p.centreGap = FIXED_CENTRE_GAP;
  return p;
}

export function serialize(params: Params, ui: UiSettings): string {
  const { art, image, ...rest } = params;
  const img = { ...image, files: [], sample: image.sample };   // image files cannot be stored; bundled samples can
  return JSON.stringify({ v: STORAGE_VERSION, params: { ...rest, art: { ...art, frame: 0 }, image: img }, ui });
}

export function deserialize(text: string | null, defaults: Params = DEFAULTS): { params: Params; ui: UiSettings } | null {
  if (!text) return null;
  let raw: { v?: unknown; params?: unknown; ui?: unknown }; try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || raw.v !== STORAGE_VERSION) return null;                       // other version: ignore (start from defaults)
  const params = sanitizeInto(clone(defaults), raw.params) as Params; params.centreGap = FIXED_CENTRE_GAP;
  // bundled samples can be reloaded; user files cannot, so such a project starts on the default artwork
  const sample = (raw.params as { image?: { sample?: unknown } } | undefined)?.image?.sample;
  if (typeof sample === 'string' && /^[a-z]+$/.test(sample)) params.image.sample = sample; else if (params.art.kind === 'image') params.art.kind = defaults.art.kind;
  const uiIn = (raw.ui ?? {}) as Partial<UiSettings>;
  const ui: UiSettings = { quality: (['auto', 'high', 'medium', 'low'] as const).includes(uiIn.quality as never) ? uiIn.quality as UiSettings['quality'] : DEFAULT_UI.quality, lowPower: typeof uiIn.lowPower === 'boolean' ? uiIn.lowPower : DEFAULT_UI.lowPower };
  return { params, ui };
}

type StoreLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function safeStorage(): StoreLike | null { try { const s = window.localStorage; s.getItem('x'); return s; } catch { return null; } }
export function loadSettings(st: StoreLike | null = safeStorage(), defaults: Params = DEFAULTS) { try { return deserialize(st?.getItem(STORAGE_KEY) ?? null, defaults); } catch { return null; } }
export function saveSettings(params: Params, ui: UiSettings, st: StoreLike | null = safeStorage()): boolean { try { st?.setItem(STORAGE_KEY, serialize(params, ui)); return !!st; } catch { return false; } }
export function resetSettings(st: StoreLike | null = safeStorage()) { try { st?.removeItem(STORAGE_KEY); } catch { /* ignore */ } }

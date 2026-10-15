// Pluggable colour-separation config (docs/design.md §6). The research is unsure what the
// "12 strips" are, so strip count, per-strip settings and the mix formula are data.

export const MAX_STRIPS = 16;
export type Contrast = 'none' | 'low' | 'high';
/** 'wheel' = tint taken from the strip's wheel; C/M/Y = fixed filter, density from wheel strength. */
export type Filter = 'wheel' | 'C' | 'M' | 'Y';
export type Mix = 'add' | 'screen';
export type WheelMode = 'smooth' | 'step';
/** Low-contrast curve: 'lift' = flattened slope about mid-grey (original, lifts blacks); 'gamma' = keeps black at 0. */
export type LowCurve = 'lift' | 'gamma';
/** 'classic' = original random wheels; 'vivid' = fully saturated CMY filters with stronger tint and fast inversion. */
export type WheelStyle = 'classic' | 'vivid';

export interface StripSpec {
  channel: 0 | 1 | 2;   // source record: R, G or B
  contrast: Contrast;
  wheel: 0 | 1 | 2;     // which random wheel drives this strip
  filter: Filter;
  weight: number;
}

export interface ColorParams {
  enabled: boolean;
  seed: number;
  mode: WheelMode;
  period: number;        // frames per wheel step / per smooth segment
  contrastHigh: number;  // slope of the high-contrast curve
  saturation: number;    // final saturation multiplier (1 = unchanged)
  lowCurve: LowCurve;
  wheelStyle: WheelStyle;
  contrastLow: number;   // low-contrast curve: slope ('lift') or gamma exponent ('gamma')
  mix: Mix;
  stripPreset: string;   // key of STRIP_PRESETS, or 'custom'
  strips: StripSpec[];
}

function build(contrasts: Contrast[], filters: Filter[]): StripSpec[] {
  const out: StripSpec[] = [];
  for (const f of filters) for (const c of contrasts) for (const ch of [0, 1, 2] as const)
    out.push({ channel: ch, contrast: c, wheel: ch, filter: f, weight: 1 });
  return out;
}

export const STRIP_PRESETS: Record<string, StripSpec[]> = {
  'rgb-3': build(['none'], ['wheel']),
  // 3 channels x high/low contrast = the "3 high + 3 low" reading of Loftus' account.
  'rgb-6': build(['high', 'low'], ['wheel']),
  // Speculative 12: the 6 above, each also through a fixed CMY-family filter variant.
  'rgb-12': [...build(['high', 'low'], ['wheel']), ...build(['high', 'low'], ['C'])],
};

export const DEFAULT_COLOR: ColorParams = {
  enabled: false,
  seed: 1,
  mode: 'smooth',
  period: 48,
  contrastHigh: 3,
  contrastLow: 0.35,
  saturation: 1,
  lowCurve: 'lift',
  wheelStyle: 'classic',
  mix: 'add',
  stripPreset: 'rgb-6',
  strips: STRIP_PRESETS['rgb-6'].map(s => ({ ...s })),
};

/** Validate user-supplied strip JSON; throws with a readable message. */
export function parseStrips(x: unknown): StripSpec[] {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_STRIPS) throw new Error(`strips must be an array of 1..${MAX_STRIPS}`);
  return x.map((s, i) => {
    const bad = (m: string) => new Error(`strip ${i}: ${m}`);
    if (![0, 1, 2].includes(s?.channel)) throw bad('channel must be 0,1,2');
    if (!['none', 'low', 'high'].includes(s.contrast)) throw bad('contrast must be none|low|high');
    if (![0, 1, 2].includes(s.wheel)) throw bad('wheel must be 0,1,2');
    if (!['wheel', 'C', 'M', 'Y'].includes(s.filter)) throw bad('filter must be wheel|C|M|Y');
    const weight = s.weight === undefined ? 1 : Number(s.weight);
    if (!Number.isFinite(weight)) throw bad('weight must be a number');
    return { channel: s.channel, contrast: s.contrast, wheel: s.wheel, filter: s.filter, weight };
  });
}

/** Optional vivid grading (opt-in; the default is the classic look). */
export const VIVID_COLOR: Partial<ColorParams> = {
  period: 36, contrastHigh: 4.5, contrastLow: 0.9, saturation: 1.35, lowCurve: 'gamma', wheelStyle: 'vivid',
};

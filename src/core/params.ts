import { DEFAULT_COLOR, VIVID_COLOR, type ColorParams } from '../color/config';
// Parameter table from docs/design.md §4. Uncertain research values are variable
// within the listed ranges. Lengths in ft.

export const ART_KINDS = ['noise', 'crystal', 'circuit', 'bands', 'facets', 'image'] as const; // 'image' = the user's own files
export type ArtKind = (typeof ART_KINDS)[number];

import type { Orientation } from './geometry';
import type { Fit, ImageFileInfo, SeqMode, Wrap } from '../art/imageMap';

/** User-image artwork. Images themselves are not stored in the params: only their name, size and a content hash. */
export interface ImageParams {
  mode: SeqMode; index: number; fit: Fit; wrap: Wrap;
  scale: number; offsetX: number; offsetY: number; rotation: number;
  contrast: number; saturation: number; seamBlend: number;
  files: ImageFileInfo[];
  sample: string | null; // id of a bundled sample (always reproducible, no missing-file warning), or null for the user's own files
}
export const DEFAULT_IMAGE: ImageParams = {
  mode: 'single', index: 0, fit: 'fill', wrap: 'mirror', scale: 1, offsetX: 0, offsetY: 0, rotation: 0,
  contrast: 1, saturation: 1, seamBlend: 0.2, files: [], sample: null,
};

export interface Params {
  image: ImageParams;
  slit: { height: number; width: number; offsetX: number; extendEnds: boolean };
  panel: { width: number; height: number; distance: number };
  track: { length: number; nearDistance: number };
  camera: { fovY: number; fStop: number };
  exposure: { samples: number; previewSamples: number; realSeconds: number; gain: number; jitter: boolean; depthFade: number; sharpness: number };
  art: { kind: ArtKind; scrollPerFrame: number; frame: number; frames: number; seed: number; alongFreq: number; mirrorSlide: boolean };
  doubleExposure: boolean;
  centreGap: number; // visible width of the central unexposed gap, fraction of frame width (height in top-bottom); locked to FIXED_CENTRE_GAP in the UI
  orientation: Orientation; // 'left-right' (default) or 'top-bottom': the same tunnel rotated 90°, one at a time
  color: ColorParams;
  accel: 'linear' | 'ease-in' | 'exponential';
  filmAspect: number;
}

export interface Range { min: number; max: number; step: number; log?: boolean }

export const RANGES = {
  'slit.height': { min: 4, max: 6, step: 0.05 },
  'slit.width': { min: 0.01, max: 0.3, step: 0.005 },
  'slit.offsetX': { min: 0, max: 3, step: 0.05 },
  centreGap: { min: 0, max: 0.3, step: 0.005 },
  'panel.width': { min: 6, max: 20, step: 0.5 },
  'panel.height': { min: 2, max: 16, step: 0.5 },
  'panel.distance': { min: 0.25, max: 6, step: 0.05 },
  'track.length': { min: 6, max: 20, step: 0.5 },
  'track.nearDistance': { min: 0.4, max: 4, step: 0.05 },
  'camera.fovY': { min: 15, max: 70, step: 1 },
  'camera.fStop': { min: 1.4, max: 8, step: 0.1 }, // blur: M2+, display only
  'exposure.samples': { min: 16, max: 1024, step: 16, log: true },
  'exposure.previewSamples': { min: 8, max: 256, step: 8, log: true },
  'exposure.realSeconds': { min: 45, max: 300, step: 5 }, // info only
  'exposure.depthFade': { min: 0, max: 2, step: 0.05 },
  'exposure.sharpness': { min: 0, max: 0.95, step: 0.05 },
  'exposure.gain': { min: 1, max: 1000, step: 1, log: true },
  'art.scrollPerFrame': { min: 0, max: 0.2, step: 0.005 },
  'art.frames': { min: 24, max: 1200, step: 1 },
  'art.frame': { min: 0, max: 1200, step: 1 }, // max follows art.frames in the UI
  'color.seed': { min: 0, max: 999, step: 1 },
  'color.period': { min: 1, max: 240, step: 1 },
  'color.saturation': { min: 0, max: 2, step: 0.05 },
  'color.contrastHigh': { min: 1, max: 8, step: 0.1 },
  'color.contrastLow': { min: 0.2, max: 1, step: 0.05 },
  'image.index': { min: 0, max: 7, step: 1 },
  'image.scale': { min: 0.2, max: 5, step: 0.05, log: true },
  'image.offsetX': { min: -1, max: 1, step: 0.01 },
  'image.offsetY': { min: -1, max: 1, step: 0.01 },
  'image.rotation': { min: -180, max: 180, step: 1 },
  'image.contrast': { min: 0.5, max: 2, step: 0.05 },
  'image.saturation': { min: 0, max: 2, step: 0.05 },
  'image.seamBlend': { min: 0, max: 0.5, step: 0.01 },
  'art.alongFreq': { min: 1, max: 40, step: 1 },
  'art.seed': { min: 0, max: 999, step: 1 },
} satisfies Record<string, Range>;

/** The research-faithful values of docs/design.md §4 (preset 'Trumbull-Strict'). */
export const STRICT_DEFAULTS: Params = {
  image: JSON.parse(JSON.stringify(DEFAULT_IMAGE)),
  slit: { height: 6, width: 0.05, offsetX: 0.8, extendEnds: false },  // research value: a finite 6 ft slit (its ends show as notches)
  panel: { width: 12, height: 8, distance: 2 },
  track: { length: 14, nearDistance: 1.5 },
  camera: { fovY: 35, fStop: 1.8 },
  exposure: { samples: 128, previewSamples: 32, realSeconds: 120, gain: 60, jitter: true, depthFade: 0, sharpness: 0 },
  art: { kind: 'noise', scrollPerFrame: 0.01, frame: 0, frames: 240, seed: 7, alongFreq: 1, mirrorSlide: true },
  doubleExposure: true,
  centreGap: 0, // set to the natural gap below
  orientation: 'left-right',
  color: JSON.parse(JSON.stringify(DEFAULT_COLOR)),
  accel: 'ease-in',
  filmAspect: 2.2,
};

/**
 * App default: the two-wall left/right tunnel with a vertical central gap, the natural green/teal/yellow
 * streaks of the noise artwork, colour separation off. Reconstructed from the settings that produced
 * docs/samples/m3-frame-*.png (frame 0 pixel-identical; later frames differ on the left wall only, whose slide now flows outward).
 */
export const DEFAULTS: Params = {
  ...JSON.parse(JSON.stringify(STRICT_DEFAULTS)),
  slit: { height: 6, width: 0.05, offsetX: 1.2, extendEnds: true },  // slit longer than the view: straight inner edges
  panel: { width: 12, height: 8, distance: 0.8 },
  exposure: { samples: 128, previewSamples: 32, realSeconds: 120, gain: 40, jitter: true, depthFade: 0, sharpness: 0 },
  color: JSON.parse(JSON.stringify(DEFAULT_COLOR)), // colour separation is optional and off, as in the reference frames
};

/** The centre gap is fixed by user decision: 0.5% of the frame width (height in top-bottom). The slider is locked to it. */
export const FIXED_CENTRE_GAP = 0.005;
export function withFixedGap(p: Params): Params { p.centreGap = FIXED_CENTRE_GAP; return p; }
withFixedGap(STRICT_DEFAULTS);
withFixedGap(DEFAULTS);

export type Preset = { name: string; params: Params };

export function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

const RAW_PRESETS: Preset[] = [
  { name: 'Two-Wall-Classic', params: clone(DEFAULTS) },
  { name: 'Two-Wall-Top-Bottom', params: { ...clone(DEFAULTS), orientation: 'top-bottom' } },
  { name: 'Trumbull-Strict', params: clone(STRICT_DEFAULTS) },
  {
    name: 'Variant-A',
    params: { ...clone(STRICT_DEFAULTS), slit: { ...STRICT_DEFAULTS.slit, height: 4 },
      exposure: { ...STRICT_DEFAULTS.exposure, realSeconds: 60 } },
  },
  // Optional crisp/saturated variant (not the default): banded artwork, vivid grading, edge-preserving sampling.
  {
    name: 'Vivid-Bands (optional)',
    params: { ...clone(DEFAULTS),
      art: { ...DEFAULTS.art, kind: 'bands', alongFreq: 12, scrollPerFrame: 0.006, mirrorSlide: true },
      panel: { width: 12, height: 3, distance: 0.8 },
      exposure: { ...DEFAULTS.exposure, gain: 130, sharpness: 0.7, depthFade: 0.5 },
      color: { ...clone(DEFAULTS.color), ...VIVID_COLOR } },
  },
  { name: 'Free', params: clone(DEFAULTS) },
];

/** Every preset uses the fixed centre gap. */
export const PRESETS: Preset[] = RAW_PRESETS.map(pr => ({ ...pr, params: withFixedGap(pr.params) }));

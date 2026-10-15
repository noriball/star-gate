export const SAMPLE_IDS: string[];
export const SAMPLE_SEEDS: Record<string, number>;
export interface RawImage { width: number; height: number; rgb: Uint8Array }
export function renderSample(id: string, width?: number, height?: number): RawImage;
export function seamRatio(img: RawImage): number;
export function encodePng(img: RawImage): Uint8Array;
export function downscale(img: RawImage, tw: number, th: number): RawImage;

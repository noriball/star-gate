// WebGL capability decision, separated from the renderer so the fallback logic can be tested.
export interface Caps { webgl2: boolean; colorBufferFloat: boolean; colorBufferHalfFloat: boolean }
export type FloatChoice = { format: 'RGBA32F' | 'RGBA16F' } | { error: string };

/** 32-bit float targets when the browser allows them, otherwise half-float (enough for this renderer: no float blending is used). */
export function chooseFloatFormat(c: Caps): FloatChoice {
  if (!c.webgl2) return { error: 'This browser or device does not provide WebGL2, which STAR GATE needs. Try a current Chrome, Edge, Firefox or Safari (iOS 15+/macOS 12+) with hardware acceleration enabled.' };
  if (c.colorBufferFloat) return { format: 'RGBA32F' };
  if (c.colorBufferHalfFloat) return { format: 'RGBA16F' };
  return { error: 'This GPU cannot render to floating-point textures (EXT_color_buffer_float / EXT_color_buffer_half_float are missing). Try another browser or device.' };
}

export class FeatureError extends Error {}

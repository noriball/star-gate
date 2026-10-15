// Compose user images into the panel artwork texture (one additive pass per image). Mirrors imageMap.ts.
// The image textures are SRGB8_ALPHA8, so sampling returns linear light (correct sRGB handling).
export const IMAGE_ART_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uImg;
uniform float uImgAspect, uPanelAspect, uScale, uRot, uContrast, uSat, uSeam;
uniform vec2  uOffset;
uniform int   uFit, uWrap, uMode, uN, uIdx, uSingle;   // fit: 0 fill 1 fit 2 tile; wrap: 0 mirror 1 repeat; mode: 0 single 1 sequence 2 crossfade
float wrapC(float t){ return uWrap == 1 ? fract(t) : 1. - abs(1. - mod(t, 2.)); }
vec2 drawn(float ca){
  if(uFit == 2) return vec2(uImgAspect, 1.);
  float hC = max(1., ca/uImgAspect), hF = min(1., ca/uImgAspect), h = uFit == 0 ? hC : hF;
  return vec2(h*uImgAspect, h);
}
vec3 adjust(vec3 c){
  vec3 s = pow(max(c, 0.), vec3(1./2.2));
  s = (s - .5)*uContrast + .5;
  float l = dot(s, vec3(.2126, .7152, .0722));
  s = clamp(vec3(l) + (s - vec3(l))*uSat, 0., 1.);
  return pow(s, vec3(2.2));
}
// panel texture coords (u,v) -> weighted linear colour of this image
vec3 evalAt(float u, float v){
  float n = float(uN), weight = 0., uLoc = u, ca = uPanelAspect;
  if(uMode == 0){ weight = uIdx == uSingle ? 1. : 0.; }
  else if(uMode == 1){ float x = u*n; weight = int(min(n - 1., floor(x))) == uIdx ? 1. : 0.; uLoc = x - floor(x); ca = uPanelAspect/n; }
  else { float t = u*n - .5, k = floor(t), f = smoothstep(0., 1., t - k); int a = int(mod(k, n)), b = int(mod(k + 1., n)); weight = (uIdx == a ? 1. - f : 0.) + (uIdx == b ? f : 0.); }
  vec2 q = vec2((uLoc - .5)*ca, v - .5) - uOffset;
  float c = cos(radians(uRot)), s = sin(radians(uRot));
  vec2 p = vec2(c*q.x + s*q.y, -s*q.x + c*q.y) / uScale;
  vec2 d = drawn(ca);
  vec2 raw = p / d + .5;
  // gradients from the continuous panel coordinate, so wrapping/segment borders never pick a wrong mip level
  vec2 gx = dFdx(vUv)*vec2(uPanelAspect, 1.), gy = dFdy(vUv)*vec2(uPanelAspect, 1.);
  vec2 ux = vec2(c*gx.x + s*gx.y, -s*gx.x + c*gx.y) / (uScale*d), uy = vec2(c*gy.x + s*gy.y, -s*gy.x + c*gy.y) / (uScale*d);
  bool inside = uFit != 1 || (raw.x >= 0. && raw.x <= 1. && raw.y >= 0. && raw.y <= 1.);
  vec2 uv = uFit == 1 ? raw : vec2(wrapC(raw.x), wrapC(raw.y));
  vec3 col = textureGrad(uImg, uv, ux, uy).rgb;          // sampled unconditionally (uniform control flow)
  if(uFit != 1 && uWrap == 1 && uSeam > 0.){             // repeat: hide the image's own tile seam along the scroll axis (cross-fade with the half-shifted copy)
    float w = smoothstep(0., uSeam, uv.x) * smoothstep(0., uSeam, 1. - uv.x);
    col = w*col + (1. - w)*textureGrad(uImg, vec2(fract(uv.x + .5), uv.y), ux, uy).rgb;
  }
  return (inside ? adjust(col) : vec3(0.)) * weight;
}
void main(){
  float u = vUv.x, v = vUv.y;
  vec3 col;
  if(uWrap == 1 && uSeam > 0.){                         // repeat: cross-fade with the half-shifted copy near the tile border
    float w = smoothstep(0., uSeam, u) * smoothstep(0., uSeam, 1. - u);
    col = w*evalAt(u, v) + (1. - w)*evalAt(fract(u + .5), v);
  } else col = evalAt(u, v);
  o = vec4(col, 1.);
}`;

// Gather slit-scan: one full-screen pass. For each pixel, solve for the camera-distance interval
// in which its ray passes the slit (mirrors geometry.ts cameraInterval), then average stratified
// samples of the artwork over that interval, weighted by the exposed fraction of the exposure.
// Continuous per pixel => no gaps between discrete substeps.

/** Uneven density of the SOURCE artwork (the back-lit panel), shared by the procedural and the image art shaders.
 * It is multiplied into the picture before the slit-scan, so the slit stretches it like the picture itself: the soft
 * blotches turn into streak-aligned density bands and the fine grain into fibres. q = panel position in panel-height units. */
export const UNEVEN_GLSL = `
float h31(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y)*p.z); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float s = 0., a = .5; for(int i=0;i<4;i++){ s += a*vn(p); p = p*2.03 + 7.1; a *= .5; } return s/.9375; }
float densityAt(vec2 q, float amount, float seed){
  if(amount <= 0.) return 1.;
  float big   = fbm3(vec3(q*vec2(9., 4.), seed)) - .5;                 // soft blotches
  float mid   = fbm3(vec3(q*vec2(26., 9.) + 17., seed + 3.)) - .5;     // finer cloud
  float fibre = vn(vec3(q*vec2(120., 46.), seed + 7.)) - .5;           // grain
  return exp(amount*(5.0*big + 3.0*mid + 1.6*fibre) - .3*amount*amount);
}
`;
export const SLIT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uArt;
uniform vec2  uTan, uPanel, uPx;     // half-fov tangents, panel size, NDC size of one pixel
uniform float uSlitX, uSlitW, uSlitH, uPanelDist, uPanelOff;
uniform float uNear, uLen, uSeed, uFade, uSharp;
uniform int   uAccel, uM, uSides, uJitter, uTranspose, uMirrorSlide, uExtend;
uniform vec2  uGap;                  // centre gap: x = wanted (output), y = natural (physical geometry)
const float E3M1 = 19.0855369;       // exp(3) - 1
const float BAND = 0.01;             // geometry.ts GAP_BLEND_BAND
float ease(float s){ return uAccel == 0 ? s : (uAccel == 1 ? s*s : (exp(3.*s) - 1.) / E3M1); }
float easeInv(float u){ u = clamp(u, 0., 1.); return uAccel == 0 ? u : (uAccel == 1 ? sqrt(u) : log(1. + u*E3M1) / 3.); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21) + uSeed); p += dot(p, p+45.32); return fract(p.x*p.y); }

// Mirrors geometry.ts cameraInterval(): per-pixel camera-distance interval in which the ray passes the
// slit at signed offset X, averaged over stratified samples and weighted by the exposed time fraction.
// Continuous per pixel => no gaps between discrete substeps.
vec3 gather(vec2 d, float X, float slide, float jit){
  float hw = uSlitW * .5, lo, hi;
  if(abs(d.x) < 1e-6){ if(abs(X) > hw) return vec3(0.); lo = 0.; hi = 1e9; }
  else { float a = (X - hw)/d.x, b = (X + hw)/d.x; lo = min(a,b); hi = max(a,b); }
  if(abs(d.y) > 1e-6) hi = min(hi, uSlitH*.5/abs(d.y));
  lo = max(lo, uNear); hi = min(hi, uNear + uLen);
  if(hi <= lo) return vec3(0.);
  float sLo = easeInv(1. - (hi - uNear)/uLen), sHi = easeInv(1. - (lo - uNear)/uLen);
  float sMid = .5*(sLo + sHi), sHalf = .5*(sHi - sLo)*(1. - clamp(uSharp, 0., .95));   // sharpness: sample the central part only
  vec2 dg = uPx * uTan;               // ray-direction change per pixel
  vec3 sum = vec3(0.);
  for(int k=0;k<64;k++){
    if(k >= uM) break;
    float s = sMid - sHalf + 2.*sHalf * ((float(k) + jit) / float(uM));
    float c = uNear + uLen * (1. - ease(s));
    vec2 p = (c + uPanelDist) * d;
    vec2 uv = vec2((p.x - slide*uPanelOff)/uPanel.x + .5, p.y/uPanel.y + .5);
    if(uExtend == 0 && (uv.y < 0. || uv.y > 1.)) continue;     // beyond the physical panel (extendEnds: the panel tiles/mirrors instead)
    vec2 g = (c + uPanelDist) * dg / uPanel;
    sum += textureGrad(uArt, uv, vec2(g.x, 0.), vec2(0., g.y)).rgb * pow(uNear / c, uFade);
  }
  return sum / float(uM) * (sHi - sLo);
}
vec3 colorAt(vec2 ndc, float jit){
  vec2 d = ndc * uTan;
  vec3 col = gather(d, uSlitX, 1., jit);
  if(uSides == 2) col += gather(d, -uSlitX, uMirrorSlide == 1 ? -1. : 1., jit);
  return col;
}
void main(){
  vec2 ndc = vUv * 2. - 1.;
  if(uTranspose == 1) ndc = ndc.yx;          // top-bottom orientation: evaluate the rotated frame
  float jit = uJitter == 1 ? hash(gl_FragCoord.xy) : .5;
  if(uSides == 2 && uGap.x != uGap.y){        // centre-gap control (mirrors geometry.ts gapMap / gapBlend)
    float a = abs(ndc.x), g = uGap.x;
    float far = uNear + uLen, dyy = abs(ndc.y) * uTan.y;
    float cMax = dyy > 1e-6 ? min(far, uSlitH*.5/dyy) : far;
    float inner = max(0., (uSlitX - uSlitW*.5) / (max(cMax, uNear) * uTan.x));   // natural inner edge on this row
    float t = uGap.y > 1e-9 ? clamp((uGap.y - g)/uGap.y, 0., 1.) : 0.;
    float edge = uGap.y + t*(inner - uGap.y), k = (1. - edge) / (1. - g);
    if(g == 0. && a < BAND){                  // closed gap: cross-fade the two walls' inner edges, no seam line
      float u = ndc.x, w = smoothstep(-BAND, BAND, u);
      vec3 cl = colorAt(vec2(-(edge + k*max(-u, 0.)), ndc.y), jit), cr = colorAt(vec2(edge + k*max(u, 0.), ndc.y), jit);
      o = vec4(mix(cl, cr, w), 1.); return;
    }
    if(a <= g){ o = vec4(0., 0., 0., 1.); return; }
    ndc.x = sign(ndc.x) * (edge + (a - g) * k);
  }
  o = vec4(colorAt(ndc, jit), 1.);
}`;

export const FULL_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

// Display: tone-map the float accumulation, optional colour-separation pass (mirrors
// color/pipeline.ts applyColor), then gamma.
export const DISPLAY_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uAcc; uniform float uGain;
uniform int uColorOn, uStripN, uMix, uLowGamma;
uniform vec2 uContrast;            // high slope, low slope
uniform float uSat;
uniform vec4 uStripA[16];          // channel, contrast(0 none,1 low,2 high), wheel, weight
uniform float uStripF[16];         // filter: 0 wheel, 1 C, 2 M, 3 Y
uniform vec3 uWCmy[3];
uniform vec2 uWSI[3];              // strength, invert
float curve(float v, int k){
  if(k == 0) return v;
  if(k == 1) return uLowGamma == 1 ? pow(max(v, 0.), uContrast.y) : clamp((v - .5) * uContrast.y + .5, 0., 1.);   // low: gamma (black stays black) or classic flattened slope
  return clamp((v - .5) * uContrast.x + .5, 0., 1.);  // high
}
// Output saturation (mirrors pipeline.ts saturate): luma-preserving, boost limited to the gamut so nothing clips.
vec3 saturateOut(vec3 c, float s){
  float l = dot(c, vec3(.2126, .7152, .0722));
  vec3 d = c - vec3(l);
  float k = max(s, 0.);
  if(k > 1.){
    float lim = k;
    for(int i=0;i<3;i++){ float x = d[i]; if(x < -1e-12) lim = min(lim, l / -x); else if(x > 1e-12) lim = min(lim, (1. - l) / x); }
    k = max(1., lim);
  }
  return clamp(vec3(l) + d * k, 0., 1.);
}
vec3 colorPass(vec3 a){
  float norm = 3. / float(uStripN);
  vec3 add = vec3(0.), scr = vec3(1.);
  for(int i=0;i<16;i++){
    if(i >= uStripN) break;
    vec4 sa = uStripA[i];
    int ch = int(sa.x + .5), w = int(sa.z + .5), f = int(uStripF[i] + .5);
    float v = curve(a[ch], int(sa.y + .5));
    v = v + (1. - 2.*v) * uWSI[w].y;
    vec3 cmy = f == 0 ? uWCmy[w] : vec3(f == 1 ? 1. : 0., f == 2 ? 1. : 0., f == 3 ? 1. : 0.);
    vec3 pr = vec3(ch == 0 ? 1. : 0., ch == 1 ? 1. : 0., ch == 2 ? 1. : 0.);
    vec3 tint = mix(pr, 1. - cmy, uWSI[w].x);
    vec3 k = v * tint * sa.w * norm;
    add += k;
    scr *= 1. - clamp(k, 0., 1.);
  }
  return uMix == 0 ? clamp(add, 0., 1.) : 1. - scr;
}
void main(){
  vec3 a = texture(uAcc, vUv).rgb;
  a = 1. - exp(-a * uGain);               // soft film shoulder
  if(uColorOn == 1) a = colorPass(a);
  if(uSat != 1.) a = saturateOut(a, uSat);      // final output saturation (after colour separation; also with it off)
  o = vec4(pow(a, vec3(1./2.2)), 1.);
}`;

// Procedural artwork, generators selected by uKind (0 noise, 1 crystal, 2 circuit, 3 bands, 4 facets).
export const ART_FS = (`#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform float uSeed, uStretch, uUneven, uPA; uniform vec2 uAspect; uniform int uKind;
/*UNEVEN*/
float h(vec2 p){ p = fract(p*vec2(123.34,456.21)+uSeed); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec2 h2(vec2 p){ return vec2(h(p), h(p+7.77)); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<6;i++){ s+=a*n(p); p=p*2.03+17.; a*=.5; } return s; }
vec3 pal(float t){ return .5 + .5*cos(6.2832*(t + vec3(0., .33, .67))); }

vec3 noiseArt(vec2 p){
  vec2 w = vec2(fbm(p+vec2(0.,uSeed)), fbm(p+vec2(5.2,1.3)));
  float f = fbm(p + 2.5*w);
  float bands = .5 + .5*sin(f*34. + w.x*8.);
  float lines = smoothstep(.92, 1., sin((p.x*9. + w.y*6.)*3.1416));
  vec2 g = abs(fract(p*4. + w) - .5);
  float grid = smoothstep(.47, .5, max(g.x, g.y));
  return pal(f*1.3) * bands + vec3(1.,.9,.7)*lines + vec3(.2,.8,1.)*grid*.8;
}

// Voronoi crystal: facet colour per cell, bright ridges at cell borders, internal growth bands.
vec3 crystalArt(vec2 p){
  p *= 2.2;
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 9., d2 = 9.; vec2 id = vec2(0.);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(i,j), c = h2(ip+g);
    float d = length(g + c - fp);
    if(d < d1){ d2 = d1; d1 = d; id = ip+g; } else if(d < d2) d2 = d;
  }
  float edge = smoothstep(.12, 0., d2 - d1);
  float cell = h(id);
  float rings = .5 + .5*sin(d1*38. + cell*20.);
  return pal(cell) * (.25 + .75*rings) + vec3(.9,.95,1.)*edge;
}

// Circuit board: orthogonal traces on a grid, pads/vias, copper-on-dark colouring.
vec3 circuitArt(vec2 p){
  p *= 9.;
  vec2 ip = floor(p), fp = fract(p) - .5;
  float r = h(ip);
  float tr = 0.;
  float wdt = .07;
  if(r < .35)      tr = step(abs(fp.y), wdt);                                  // horizontal
  else if(r < .7)  tr = step(abs(fp.x), wdt);                                  // vertical
  else if(r < .85) tr = step(abs(fp.x - fp.y), wdt*1.4) * step(length(fp), .5); // diagonal
  else             tr = step(abs(fp.x + fp.y), wdt*1.4) * step(length(fp), .5);
  float pad = step(length(fp), .16) * step(.8, h(ip + 3.1));
  float hole = step(length(fp), .06) * step(.8, h(ip + 3.1));
  float chip = step(.93, h(floor(p/3.)+9.)) * step(max(abs(fract(p/3.).x-.5), abs(fract(p/3.).y-.5)), .4);
  vec3 copper = pal(h(floor(p/3.)) * .25 + .05);
  vec3 c = vec3(.02,.05,.04) + .05*fbm(p*2.);
  c += copper * (tr*.9 + pad);
  c = mix(c, vec3(.03), chip);
  c += chip * step(.45, fract(p.x*3.)) * .25;
  return c * (1. - hole);
}

vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(fract(h + vec3(0., 2./3., 1./3.))*6. - 3.) - 1., 0., 1.); return v * mix(vec3(1.), k, s); }
float edgeLine(vec2 f, float w){ vec2 d = min(f, 1. - f); return 1. - smoothstep(0., w, min(d.x, d.y)); }

// Layered banded colour fields: hard-edged saturated cells in two scales, bright seams between cells.
// x is the slide direction (stretched), so cell edges in x become rings and edges in y become spokes.
vec3 bandsArt(vec2 p){
  vec2 a = p * vec2(1.0, 5.);
  vec2 b = p * vec2(.3, 1.7) + 31.;
  vec2 ia = floor(a), ib = floor(b);
  float ha = h(ia), hb = h(ib + 7.);
  float hue = mix(hb + .08*h(ia.yy), ha, step(.45, h(ib + 3.)));    // coarse field shows through in places
  vec3 c = hsv(hue + .12*ib.y, 1., .45 + .55*h(ia + 11.));
  c *= .35 + .65*step(.3, fract(ha*7.));                              // dark cells give contrast between bands
  c *= .5 + .5*mod(ia.x, 2.);                                          // alternating light/dark rings: makes the flow along the streaks visible
  c += vec3(1., .95, .85) * edgeLine(fract(a), .02) * .6;            // thin bright seams
  c = mix(c, hsv(hb + .5, 1., 1.), edgeLine(fract(b), .02));         // coloured seams on the coarse grid
  return c;
}

// Sharp crystal facets: flat saturated colour per Voronoi cell, bright borders.
vec3 facetsArt(vec2 p){
  p *= vec2(.5, 3.2);
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 9., d2 = 9.; vec2 id = vec2(0.);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(i,j), c = h2(ip+g);
    vec2 dv = (g + c - fp) * vec2(1., 1.);
    float d = length(dv);
    if(d < d1){ d2 = d1; d1 = d; id = ip+g; } else if(d < d2) d2 = d;
  }
  float cell = h(id), cell2 = h(id + 5.3);
  vec3 c = hsv(cell + .15*cell2, 1., .4 + .6*step(.35, cell2));
  float border = 1. - smoothstep(0., .06, d2 - d1);
  return c * (1. - .35*d1) + vec3(1., .96, .9) * border;
}

void main(){
  vec2 p = (vUv - .5) * uAspect * 3.;
  p.x *= uStretch;                         // fine detail along the slide direction => visible flow along the streaks
  vec3 c = uKind == 1 ? crystalArt(p) : (uKind == 2 ? circuitArt(p) : (uKind == 3 ? bandsArt(p) : (uKind == 4 ? facetsArt(p) : noiseArt(p))));
  c *= densityAt((vUv - .5)*vec2(uPA, 1.), uUneven, uSeed);          // uneven density of the source artwork
  o = vec4(c, 1.);
}`).replace('/*UNEVEN*/', UNEVEN_GLSL);

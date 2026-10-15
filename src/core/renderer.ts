import type { Params } from './params';
import { effectiveGap, gatherSamples, naturalGap, panelOffset, slitSides, tanHalf } from './geometry';
import { makeProgram } from './gl';
import { FeatureError, chooseFloatFormat } from './features';
import { DISPLAY_FS, FULL_VS, SLIT_FS } from './shaders';
import { wheelStates } from '../color/wheel';
import { makeArtTexture } from '../art/procedural';
import { ImageArtStore } from '../art/imageArt';

/** Slit-scan renderer: per-pixel gather of the exposure integral, then tone-map/colour display. */
export class SlitScanRenderer {
  private gl: WebGL2RenderingContext;
  private slitProg: WebGLProgram;
  private dispProg: WebGLProgram;
  private vbo: WebGLBuffer;
  private acc: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private art: WebGLTexture | null = null;
  private artKey = '';
  private procArt: WebGLTexture | null = null;
  readonly images: ImageArtStore;
  private w = 0; private h = 0;
  readonly floatFormat: 'RGBA32F' | 'RGBA16F';
  lastMs = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    // (the checks below run on `gl`; `this.gl` is assigned once they pass)
    const choice = chooseFloatFormat({ webgl2: !!gl, colorBufferFloat: !!gl?.getExtension('EXT_color_buffer_float'), colorBufferHalfFloat: !!gl?.getExtension('EXT_color_buffer_half_float') });
    if ('error' in choice) throw new FeatureError(choice.error);
    this.gl = gl!;
    const gl2 = gl!;
    this.floatFormat = choice.format;
    this.slitProg = makeProgram(gl2, FULL_VS, SLIT_FS);
    this.dispProg = makeProgram(gl2, FULL_VS, DISPLAY_FS);
    this.vbo = gl2.createBuffer()!;
    this.images = new ImageArtStore(gl2);
    this.acc = gl2.createTexture()!;
    this.fbo = gl2.createFramebuffer()!;
    gl2.enableVertexAttribArray(0);
  }

  private floatTex(tex: WebGLTexture, fbo: WebGLFramebuffer, w: number, h: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.floatFormat === 'RGBA32F' ? gl.RGBA32F : gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  }

  private resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    this.floatTex(this.acc, this.fbo, w, h);
    // NEAREST for the display read of acc
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.acc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  private quad(x0: number, x1: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, -1, x1, -1, x0, 1, x0, 1, x1, -1, x1, 1]), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  private ensureArt(p: Params) {
    if (p.art.kind === 'image') {
      // user images: composed once into the panel texture; the key covers every input that changes it
      const { files: _files, ...ip } = p.image;
      const key = `image|${this.images.version}|${JSON.stringify(ip)}|${p.panel.width / p.panel.height}`;
      if (key !== this.artKey) {
        this.art = this.images.compose(p, () => this.quad(-1, 1));
        this.artKey = key;
      }
      return;
    }
    const key = `${p.art.kind}|${p.art.seed}|${p.art.alongFreq}|${p.panel.width / p.panel.height}`;
    if (key !== this.artKey) {
      this.quad(-1, 1);
      this.procArt = makeArtTexture(this.gl, p.art.kind, p.art.seed, p.art.alongFreq, p.panel.width / p.panel.height, this.procArt ?? undefined);
      this.art = this.procArt;
      this.artKey = key;
    }
  }

  /** One full-screen gather pass of the tunnel into `fbo` (size w×h). */
  private gather(fbo: WebGLFramebuffer, w: number, h: number, p: Params, samples: number) {
    const gl = this.gl;
    this.ensureArt(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.slitProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.art);
    const u = (n: string) => gl.getUniformLocation(this.slitProg, n);
    const th = tanHalf(p);
    gl.uniform1i(u('uArt'), 0);
    gl.uniform2f(u('uTan'), th.x, th.y);
    gl.uniform2f(u('uPx'), p.orientation === 'top-bottom' ? 2 / h : 2 / w, p.orientation === 'top-bottom' ? 2 / w : 2 / h);
    gl.uniform1f(u('uSlitX'), p.slit.offsetX);
    gl.uniform1f(u('uSlitW'), p.slit.width);
    gl.uniform1f(u('uSlitH'), p.slit.extendEnds ? 1e6 : p.slit.height);   // 1e6 ft: the slit never ends inside the view
    gl.uniform2f(u('uPanel'), p.panel.width, p.panel.height);
    gl.uniform1f(u('uPanelDist'), p.panel.distance);
    gl.uniform1f(u('uPanelOff'), panelOffset(p.art.frame, p));
    gl.uniform1f(u('uFade'), p.exposure.depthFade);
    gl.uniform1f(u('uSharp'), p.exposure.sharpness);
    gl.uniform1f(u('uNear'), p.track.nearDistance);
    gl.uniform1f(u('uLen'), p.track.length);
    gl.uniform1f(u('uSeed'), ((p.art.seed * 100003 + p.art.frame) % 977) * 0.0137);
    gl.uniform1i(u('uAccel'), ['linear', 'ease-in', 'exponential'].indexOf(p.accel));
    gl.uniform1i(u('uM'), gatherSamples(samples));
    const g0 = naturalGap(p); let g = effectiveGap(p); if (Math.abs(g - g0) < 1e-9) g = g0;
    gl.uniform2f(u('uGap'), g, g0);
    gl.uniform1i(u('uSides'), slitSides(p).length);
    gl.uniform1i(u('uTranspose'), p.orientation === 'top-bottom' ? 1 : 0);
    gl.uniform1i(u('uMirrorSlide'), p.art.mirrorSlide ? 1 : 0);
    gl.uniform1i(u('uJitter'), p.exposure.jitter ? 1 : 0);
    gl.uniform1i(u('uExtend'), p.slit.extendEnds ? 1 : 0);
    this.quad(-1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private uploadColor(p: Params) {
    const gl = this.gl, prog = this.dispProg, c = p.color;
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('uColorOn'), c.enabled ? 1 : 0);
    gl.uniform1f(u('uSat'), c.saturation);   // output saturation applies with or without colour separation
    if (!c.enabled) return;
    const code = { none: 0, low: 1, high: 2 } as const;
    const fcode = { wheel: 0, C: 1, M: 2, Y: 3 } as const;
    const A = new Float32Array(64), F = new Float32Array(16);
    c.strips.forEach((s, i) => { A.set([s.channel, code[s.contrast], s.wheel, s.weight], i * 4); F[i] = fcode[s.filter]; });
    const W = wheelStates(c, p.art.frame);
    gl.uniform1i(u('uStripN'), c.strips.length);
    gl.uniform1i(u('uMix'), c.mix === 'add' ? 0 : 1);
    gl.uniform2f(u('uContrast'), c.contrastHigh, c.contrastLow);
    gl.uniform1i(u('uLowGamma'), c.lowCurve === 'gamma' ? 1 : 0);
    gl.uniform4fv(u('uStripA[0]'), A);
    gl.uniform1fv(u('uStripF[0]'), F);
    gl.uniform3fv(u('uWCmy[0]'), new Float32Array(W.flatMap(w => w.cmy)));
    gl.uniform2fv(u('uWSI[0]'), new Float32Array(W.flatMap(w => [w.strength, w.invert])));
  }

  /** samples overrides exposure.samples (cheaper playback preview). */
  render(p: Params, samples = p.exposure.samples, height = 720) {
    const t0 = performance.now();
    const gl = this.gl;
    const W = Math.round(height * p.filmAspect);
    this.resize(W, height);

    this.gather(this.fbo, W, height, p, samples);

    // display
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, height);
    gl.useProgram(this.dispProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.acc);
    gl.uniform1i(gl.getUniformLocation(this.dispProg, 'uAcc'), 0);
    gl.uniform1f(gl.getUniformLocation(this.dispProg, 'uGain'), p.exposure.gain);
    gl.uniform1f(gl.getUniformLocation(this.dispProg, 'uUneven'), p.exposure.unevenness);
    gl.uniform1f(gl.getUniformLocation(this.dispProg, 'uFrame'), p.art.frame);
    gl.uniform1f(gl.getUniformLocation(this.dispProg, 'uAspect'), p.filmAspect);
    this.uploadColor(p);
    this.quad(-1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
    this.lastMs = performance.now() - t0;
  }
}

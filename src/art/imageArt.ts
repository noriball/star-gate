import { IMAGE_ART_FS } from './imageShaders';
import { FULL_VS } from '../core/shaders';
import { makeProgram } from '../core/gl';
import { MAX_IMAGES, MAX_IMAGE_SIDE, fitMaxSize, fnv1a, imageStatus, type ImageFileInfo, type ImageStatus } from './imageMap';
import type { Params } from '../core/params';

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const isAcceptedImage = (f: { type: string; name: string }) =>
  ACCEPTED_TYPES.includes(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);

/** Runtime holder of the user's images (textures live here, not in the params JSON). */
export class ImageArtStore {
  readonly files: ImageFileInfo[] = [];
  private textures: WebGLTexture[] = [];
  private aspects: number[] = [];
  version = 0; // bumps whenever the set of images changes
  sampleId: string | null = null; // set when the loaded image is a bundled sample
  readonly maxSide: number;
  private prog: WebGLProgram;
  private target: WebGLTexture | null = null;
  private fbo: WebGLFramebuffer;
  private size = '';

  constructor(private gl: WebGL2RenderingContext) {
    this.maxSide = Math.min(MAX_IMAGE_SIDE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    this.prog = makeProgram(gl, FULL_VS, IMAGE_ART_FS);
    this.fbo = gl.createFramebuffer()!;
  }

  get count() { return this.textures.length; }

  /** Load one of the bundled samples (fetched from the app's own static files). */
  async loadSample(id: string, url: string): Promise<ImageFileInfo[]> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`sample ${id}: HTTP ${r.status}`);
    return this.load([new File([await r.blob()], `${id}.png`, { type: 'image/png' })], id);
  }

  clear() {
    this.sampleId = null;
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.textures = []; this.aspects = []; this.files.length = 0; this.version++;
  }

  /** Replace the loaded set (max 8 images). Large images are downscaled to maxSide. Returns the metadata to store in the params. */
  async load(list: File[], sample: string | null = null): Promise<ImageFileInfo[]> {
    const gl = this.gl;
    const picked = list.filter(isAcceptedImage).slice(0, MAX_IMAGES);
    if (!picked.length) throw new Error('No PNG/JPEG/WebP file among the dropped files.');
    const staged: { tex: WebGLTexture; info: ImageFileInfo; aspect: number }[] = [];
    try {
      for (const f of picked) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const bmp = await createImageBitmap(new Blob([bytes], { type: f.type || 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
        const sz = fitMaxSize(bmp.width, bmp.height, this.maxSide);
        const c = document.createElement('canvas'); c.width = sz.width; c.height = sz.height;
        const x = c.getContext('2d')!; x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); // transparent areas give no light
        x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, sz.width, sz.height);
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, c);   // hardware sRGB -> linear on sampling
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        staged.push({ tex, aspect: bmp.width / bmp.height, info: { name: f.name, bytes: f.size, width: bmp.width, height: bmp.height, hash: fnv1a(bytes) } });
        bmp.close();
      }
    } catch (e) { staged.forEach(s => gl.deleteTexture(s.tex)); throw e; }
    this.clear();
    this.sampleId = sample;
    for (const s of staged) { this.textures.push(s.tex); this.aspects.push(s.aspect); this.files.push(s.info); }
    return this.files.map(f => ({ ...f }));
  }

  status(expected: ImageFileInfo[]): ImageStatus { return imageStatus(expected, this.files); }

  /** Compose the panel artwork texture from the loaded images with the image params. Returns the (re)used target texture. */
  compose(p: Params, bindQuad: () => void): WebGLTexture {
    const gl = this.gl, ip = p.image;
    const H = Math.min(2048, this.maxSide), W = Math.min(this.maxSide, Math.round(H * (p.panel.width / p.panel.height)));
    if (!this.target) this.target = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    if (this.size !== `${W}x${H}`) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null); this.size = `${W}x${H}`; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const u = (n: string) => gl.getUniformLocation(this.prog, n);
    const modeIdx = { single: 0, sequence: 1, crossfade: 2 }[ip.mode], fitIdx = { fill: 0, fit: 1, tile: 2 }[ip.fit];
    gl.uniform1f(u('uPanelAspect'), p.panel.width / p.panel.height);
    gl.uniform1f(u('uScale'), ip.scale); gl.uniform1f(u('uRot'), ip.rotation);
    gl.uniform1f(u('uContrast'), ip.contrast); gl.uniform1f(u('uSat'), ip.saturation); gl.uniform1f(u('uSeam'), ip.wrap === 'repeat' ? ip.seamBlend : 0);
    gl.uniform2f(u('uOffset'), ip.offsetX, ip.offsetY);
    gl.uniform1i(u('uFit'), fitIdx); gl.uniform1i(u('uWrap'), ip.wrap === 'repeat' ? 1 : 0);
    gl.uniform1i(u('uMode'), modeIdx); gl.uniform1i(u('uN'), Math.max(1, this.textures.length));
    gl.uniform1i(u('uSingle'), Math.min(ip.index, Math.max(0, this.textures.length - 1)));
    gl.uniform1i(u('uImg'), 0);
    bindQuad();
    for (let i = 0; i < this.textures.length; i++) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      gl.uniform1f(u('uImgAspect'), this.aspects[i]); gl.uniform1i(u('uIdx'), i);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = ip.wrap === 'repeat' ? gl.REPEAT : gl.MIRRORED_REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);        // along the scroll: never a seam
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    return this.target;
  }
}

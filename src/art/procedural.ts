import { ART_FS, FULL_VS } from '../core/shaders';
import { ART_KINDS, type ArtKind } from '../core/params';
import { makeProgram } from '../core/gl';

/** Renders the procedural test artwork into a mipmapped texture sized to the panel aspect. */
export function makeArtTexture(gl: WebGL2RenderingContext, kind: ArtKind, seed: number, stretch: number, panelAspect: number, uneven: number, existing?: WebGLTexture): WebGLTexture {
  const H = 1024, W = Math.round(H * panelAspect);
  const tex = existing ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const prog = makeProgram(gl, FULL_VS, ART_FS);
  gl.useProgram(prog);
  gl.uniform1f(gl.getUniformLocation(prog, 'uSeed'), seed * 0.137);
  gl.uniform1f(gl.getUniformLocation(prog, 'uStretch'), stretch);
  gl.uniform1f(gl.getUniformLocation(prog, 'uUneven'), uneven);
  gl.uniform1f(gl.getUniformLocation(prog, 'uPA'), panelAspect);
  gl.uniform1i(gl.getUniformLocation(prog, 'uKind'), ART_KINDS.indexOf(kind));
  gl.uniform2f(gl.getUniformLocation(prog, 'uAspect'), panelAspect, 1);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteProgram(prog);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  return tex;
}

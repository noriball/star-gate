import { clone, type Params } from '../core/params';
import type { SlitScanRenderer } from '../core/renderer';
import { BlobSink, PartedZip, ZipWriter, type ZipSink } from './zip';
import { WebMMuxer } from './webm';

export type ExportFormat = 'zip' | 'folder' | 'webm';

export interface ExportOpts {
  name: string;        // base name of the files
  format: ExportFormat;
  height: number;      // frame height in px; width = height * film aspect
  fps: number;
  start: number;       // first animation frame (0-based). Frames are numbered start+1, start+2, ... so ranges concatenate
  count: number;
  samples: number;
  partMb: number;      // max size of one ZIP part
}

export interface Progress { done: number; total: number; skipped: number; state: 'running' | 'done' | 'cancelled' | 'error'; message?: string; parts?: number; nextStart?: number }

/** Where results go. The browser implementation downloads blobs; tests inject their own. */
export interface ExportIO {
  saveBlob(filename: string, blob: Blob): void | Promise<void>;
  /** Optional File System Access directory (format 'folder'). */
  dir?: DirLike;
}
export interface DirLike {
  has(name: string): Promise<boolean>;
  write(name: string, data: Blob | Uint8Array | string): Promise<void>;
}

export const frameFile = (frameNumber: number) => `frame_${String(frameNumber).padStart(6, '0')}.png`;

/** ffmpeg commands for a folder/zip of frames; `startNumber` is the number of the first frame file. */
export function encodeScript(o: ExportOpts, w: number, h: number): string {
  const sn = o.start + 1;
  return `#!/bin/sh
# Encode these frames (${w}x${h}, ${o.fps} fps). Unzip all parts of the sequence into ONE folder, then: sh encode.sh
set -e
# ProRes 422 HQ (editing master)
ffmpeg -y -framerate ${o.fps} -start_number ${sn} -i frame_%06d.png -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le ${o.name}_prores.mov
# H.264 (playable everywhere)
ffmpeg -y -framerate ${o.fps} -start_number ${sn} -i frame_%06d.png -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart ${o.name}_h264.mp4
`;
}

export function partName(name: string, first: number, last: number) {
  const p = (n: number) => String(n).padStart(6, '0');
  return `${name}_frames_${p(first)}-${p(last)}.zip`;
}

/** Plan of a run, used for the UI summary and by tests. */
export function planExport(o: Pick<ExportOpts, 'start' | 'count'>, totalFrames: number) {
  const total = Math.max(0, Math.min(o.count, totalFrames - o.start));
  return { total, first: o.start + 1, last: o.start + total };
}

const toBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const pngOf = (canvas: HTMLCanvasElement) => new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
const tick = () => new Promise<void>(r => setTimeout(r));

export function browserIO(dir?: DirLike): ExportIO {
  return {
    dir,
    saveBlob(filename, blob) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.rel = 'noopener';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    },
  };
}

/** File System Access directory wrapper. */
export function dirFromHandle(h: FileSystemDirectoryHandle): DirLike {
  return {
    async has(name) { try { const f = await (await h.getFileHandle(name)).getFile(); return f.size > 0; } catch { return false; } },
    async write(name, data) {
      const fh = await h.getFileHandle(name, { create: true }), w = await fh.createWritable();
      await w.write(data as FileSystemWriteChunkType); await w.close();
    },
  };
}

/** Pick a WebCodecs codec this browser can encode, or null. */
export async function pickVideoCodec(width: number, height: number, fps: number): Promise<{ codec: string; mkv: 'V_VP9' | 'V_VP8' } | null> {
  const VE = (globalThis as { VideoEncoder?: { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> } }).VideoEncoder;
  if (!VE) return null;
  for (const [codec, mkv] of [['vp09.00.10.08', 'V_VP9'], ['vp8', 'V_VP8']] as const) {
    try { if ((await VE.isConfigSupported({ codec, width, height, framerate: fps, bitrate: 8e6 })).supported) return { codec, mkv }; } catch { /* try next */ }
  }
  return null;
}

/**
 * Render a frame range and deliver it in the browser: ZIP parts (downloads), PNG files in a chosen folder, or a WebM video
 * encoded with WebCodecs. Rendering is the same code path as the preview (same texture, same shader), only the resolution differs.
 */
export async function runExport(
  getRenderer: () => SlitScanRenderer, canvas: HTMLCanvasElement, base: Params, o: ExportOpts, io: ExportIO,
  onProgress: (p: Progress) => void, signal: AbortSignal,
): Promise<void> {
  const plan = planExport(o, base.art.frames);
  const total = plan.total;
  const prog: Progress = { done: 0, total, skipped: 0, state: 'running', parts: 0 };
  const p = clone(base);
  let zip: PartedZip | null = null;
  let encoder: { encode(f: unknown, o?: unknown): void; flush(): Promise<void>; close(): void; encodeQueueSize: number } | null = null;
  try {
    if (total < 1) throw new Error('nothing to render: start frame is past art.frames');
    const rend = () => getRenderer();
    let muxer: WebMMuxer | null = null;
    let meta = '', script = '';
    const renderFrame = async (i: number) => {
      p.art.frame = o.start + i;
      rend().render(p, o.samples, o.height);
    };

    if (o.format === 'zip') {
      zip = new PartedZip(Math.max(1, o.partMb) * 1048576, () => new BlobSink(), async (sink, first, last) => {
        await io.saveBlob(partName(o.name, first, last), (sink as BlobSink).blob()); prog.parts = (prog.parts ?? 0) + 1;
      });
    } else if (o.format === 'webm') {
      await renderFrame(0); // sizes the canvas
      const c = await pickVideoCodec(canvas.width, canvas.height, o.fps);
      if (!c) throw new Error('This browser cannot encode video (WebCodecs VideoEncoder with VP8/VP9 is missing). Use the ZIP export and ffmpeg instead.');
      muxer = new WebMMuxer({ width: canvas.width, height: canvas.height, fps: o.fps, codec: c.mkv });
      const VE = (globalThis as unknown as { VideoEncoder: new (i: { output(ch: { byteLength: number; copyTo(d: Uint8Array): void; timestamp: number; type: string }): void; error(e: Error): void }) => typeof encoder & { configure(c: unknown): void } }).VideoEncoder;
      const e = new VE({
        output: ch => { const d = new Uint8Array(ch.byteLength); ch.copyTo(d); muxer!.addChunk(d, ch.timestamp, ch.type === 'key'); },
        error: err => { prog.message = String(err); },
      });
      e.configure({ codec: c.codec, width: canvas.width, height: canvas.height, framerate: o.fps, bitrate: Math.round(8e6 * (canvas.width * canvas.height) / (1280 * 582)) });
      encoder = e;
    }

    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      const frameNo = o.start + i + 1;
      if (o.format === 'folder') {
        if (!io.dir) throw new Error('No folder selected.');
        if (await io.dir.has(frameFile(frameNo))) { prog.skipped++; prog.done++; onProgress({ ...prog }); continue; }   // resume
        await renderFrame(i);
        await io.dir.write(frameFile(frameNo), await pngOf(canvas));
      } else if (o.format === 'zip') {
        await renderFrame(i);
        await zip!.add(frameNo, frameFile(frameNo), await toBytes(await pngOf(canvas)));
      } else {
        await renderFrame(i);
        const VF = (globalThis as unknown as { VideoFrame: new (src: HTMLCanvasElement, init: { timestamp: number; duration: number }) => { close(): void } }).VideoFrame;
        while (encoder!.encodeQueueSize > 6) await tick();
        const vf = new VF(canvas, { timestamp: Math.round((i * 1e6) / o.fps), duration: Math.round(1e6 / o.fps) });
        encoder!.encode(vf, { keyFrame: i % Math.max(1, Math.round(o.fps)) === 0 }); vf.close();
      }
      prog.done++; prog.nextStart = o.start + i + 1; onProgress({ ...prog });
      await tick();   // let the UI repaint and the cancel click land
    }

    const w = canvas.width, h = canvas.height;
    meta = JSON.stringify({ export: o, width: w, height: h, frames: total, firstFrame: plan.first, lastFrame: plan.last, params: base }, null, 2);
    script = encodeScript(o, w, h);
    if (o.format === 'zip') {
      await zip!.addExtra('meta.json', new TextEncoder().encode(meta)); await zip!.addExtra('encode.sh', new TextEncoder().encode(script));
      await zip!.flush();
    } else if (o.format === 'folder') {
      await io.dir!.write('meta.json', meta); await io.dir!.write('encode.sh', script);
    } else {
      await encoder!.flush(); encoder!.close(); encoder = null;
      await io.saveBlob(`${o.name}.webm`, muxer!.finish());
    }
    onProgress({ ...prog, state: 'done' });
  } catch (e) {
    const cancelled = (e as Error).name === 'AbortError';
    try { encoder?.close(); } catch { /* ignore */ }
    // cancelling a ZIP export keeps the frames already rendered: the open part is finished and downloaded
    if (cancelled && zip) { try { await zip.flush(); } catch { /* ignore */ } }
    onProgress({ ...prog, state: cancelled ? 'cancelled' : 'error', message: cancelled ? (prog.done ? `kept ${prog.done} frame(s); resume with start frame ${o.start + prog.done}` : undefined) : (e as Error).message });
  }
}

export { ZipWriter };
export type { ZipSink };

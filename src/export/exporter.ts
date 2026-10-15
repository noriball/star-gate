import { clone, type Params } from '../core/params';
import type { SlitScanRenderer } from '../core/renderer';

export interface ExportOpts {
  name: string;        // folder under renders/
  height: number;      // frame height in px; width = height * film aspect
  fps: number;
  start: number;       // first animation frame
  count: number;
  samples: number;
  overwrite: boolean;  // false = resume: skip frames already on disk
}

export interface Progress { done: number; total: number; skipped: number; state: 'running' | 'done' | 'cancelled' | 'error'; message?: string }

const frameName = (i: number) => `frame_${String(i + 1).padStart(6, '0')}.png`;
const url = (name: string, file: string) => `/__export/${encodeURIComponent(name)}/${file}`;

export function encodeScript(o: ExportOpts, w: number, h: number): string {
  return `#!/bin/sh
# Encode renders/${o.name} (${w}x${h}, ${o.fps} fps). Run from this folder: sh encode.sh
set -e
# ProRes 422 HQ (editing master)
ffmpeg -y -framerate ${o.fps} -i frame_%06d.png -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le ${o.name}_prores.mov
# H.264 (playable everywhere)
ffmpeg -y -framerate ${o.fps} -i frame_%06d.png -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart ${o.name}_h264.mp4
`;
}

async function post(name: string, file: string, body: Blob | string, signal: AbortSignal) {
  const r = await fetch(url(name, file), { method: 'POST', body, signal });
  if (!r.ok) throw new Error(`upload ${file}: HTTP ${r.status}`);
}

/** Render a frame range offline and POST each PNG to the dev server (renders/<name>/). */
export async function runExport(
  renderer: SlitScanRenderer, canvas: HTMLCanvasElement, base: Params, o: ExportOpts,
  onProgress: (p: Progress) => void, signal: AbortSignal,
): Promise<void> {
  const total = Math.min(o.count, base.art.frames - o.start);
  const prog: Progress = { done: 0, total, skipped: 0, state: 'running' };
  try {
    if (total < 1) throw new Error('nothing to render: start frame is past art.frames');
    if (o.overwrite) await fetch(url(o.name, 'frames'), { method: 'DELETE', signal });
    const have = new Set<string>(o.overwrite ? [] : await (await fetch(url(o.name, 'list'), { signal })).json());
    const p = clone(base);
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      if (have.has(frameName(i))) { prog.skipped++; prog.done++; onProgress({ ...prog }); continue; }
      p.art.frame = o.start + i;
      renderer.render(p, o.samples, o.height);
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
      await post(o.name, frameName(i), blob, signal);
      prog.done++; onProgress({ ...prog });
      await new Promise(r => setTimeout(r)); // let the UI repaint / cancel click land
    }
    const w = canvas.width, h = canvas.height;
    await post(o.name, 'encode.sh', encodeScript(o, w, h), signal);
    await post(o.name, 'meta.json', JSON.stringify({ export: o, width: w, height: h, frames: total, params: base }, null, 2), signal);
    onProgress({ ...prog, state: 'done' });
  } catch (e) {
    const cancelled = (e as Error).name === 'AbortError';
    onProgress({ ...prog, state: cancelled ? 'cancelled' : 'error', message: cancelled ? undefined : (e as Error).message });
  }
}

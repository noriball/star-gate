import type { Params } from '../core/params';
import type { SlitScanRenderer } from '../core/renderer';
import { browserIO, dirFromHandle, pickVideoCodec, runExport, type ExportFormat, type Progress } from '../export/exporter';

const HEIGHTS = [360, 540, 582, 720, 1080, 1440, 2160]; // 582 -> 1280×582 (2.2:1)

/** Export section: ZIP of PNG frames (downloads, split into parts), PNG files in a folder (File System Access), or a WebM video (WebCodecs). */
export function buildExportPanel(
  root: HTMLElement, canvas: HTMLCanvasElement, getRenderer: () => SlitScanRenderer, params: Params,
  guard: () => string | null, onStart: () => void, onEnd: () => void,
) {
  const h = document.createElement('h2'); h.textContent = 'Export';
  const box = document.createElement('div'); box.id = 'export';
  box.innerHTML = `
    <div class="row"><label>format</label><select id="ex-format" style="grid-column:2/4"></select></div>
    <div class="row"><label>name</label><input id="ex-name" value="stargate" style="grid-column:2/4"></div>
    <div class="row"><label>height</label><select id="ex-h" style="grid-column:2/4"></select></div>
    <div class="row"><label>fps</label><input id="ex-fps" type="number" value="24" min="1" max="120" style="grid-column:2/4"></div>
    <div class="row"><label>start frame</label><input id="ex-start" type="number" value="0" min="0" style="grid-column:2/4"></div>
    <div class="row"><label>frame count</label><input id="ex-count" type="number" value="24" min="1" style="grid-column:2/4"></div>
    <div class="row" id="ex-part-row"><label>zip part (MB)</label><input id="ex-part" type="number" value="256" min="16" max="1500" style="grid-column:2/4"></div>
    <div><button id="ex-go">Export</button> <button id="ex-cancel" disabled>Cancel</button></div>
    <progress id="ex-bar" value="0" max="1" style="width:100%;margin-top:6px"></progress>
    <div id="ex-status" style="color:#8a8f99;font-size:12px"></div>
    <div id="ex-hint" style="color:#8a8f99;font-size:11px;margin-top:4px"></div>`;
  root.append(h, box);
  const $ = <T extends HTMLElement>(id: string) => box.querySelector('#' + id) as T;
  const fmt = $<HTMLSelectElement>('ex-format'), sel = $<HTMLSelectElement>('ex-h');
  fmt.add(new Option('ZIP of PNG frames (download)', 'zip'));
  const hasDir = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  if (hasDir) fmt.add(new Option('PNG files in a folder', 'folder'));
  const hasVideo = typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'function' && typeof (globalThis as { VideoFrame?: unknown }).VideoFrame === 'function';
  if (hasVideo) fmt.add(new Option('WebM video (encoded in the browser)', 'webm'));
  for (const v of HEIGHTS) sel.add(new Option(`${v}p  (${Math.round(v * params.filmAspect)}×${v})`, String(v)));
  sel.value = '720';
  const hint = () => {
    const f = fmt.value as ExportFormat;
    $('ex-part-row').style.display = f === 'zip' ? '' : 'none';
    $('ex-hint').textContent = f === 'zip'
      ? 'Frames are numbered from start+1 and split into zip parts; unzip all parts into one folder and run encode.sh (ffmpeg). To continue, set start frame to the last exported frame.'
      : f === 'folder' ? 'Existing frame files in the folder are skipped, so running again resumes.'
      : 'Direct video: VP9 (or VP8) in a .webm file. Use ZIP + ffmpeg for ProRes/H.264.';
  };
  fmt.onchange = hint; hint();
  let ctl: AbortController | null = null;

  $('ex-go').onclick = async () => {
    if (ctl) return;
    const blocked = guard();
    if (blocked) { $('ex-status').textContent = 'error: export refused — ' + blocked; return; }
    const format = fmt.value as ExportFormat;
    const opts = {
      name: $<HTMLInputElement>('ex-name').value.replace(/[^A-Za-z0-9_-]/g, '_') || 'stargate', format,
      height: +sel.value, fps: +$<HTMLInputElement>('ex-fps').value || 24,
      start: Math.max(0, +$<HTMLInputElement>('ex-start').value || 0), count: Math.max(1, +$<HTMLInputElement>('ex-count').value || 1),
      samples: params.exposure.samples, partMb: +$<HTMLInputElement>('ex-part').value || 256,
    };
    let dir;
    if (format === 'folder') {
      try { dir = dirFromHandle(await (window as unknown as { showDirectoryPicker(o?: unknown): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' })); }
      catch { $('ex-status').textContent = 'cancelled: no folder chosen'; return; }
    }
    if (format === 'webm') {
      const c = await pickVideoCodec(Math.round(opts.height * params.filmAspect), opts.height, opts.fps);
      if (!c) { $('ex-status').textContent = 'error: this browser cannot encode VP8/VP9 video; use the ZIP export'; return; }
    }
    ctl = new AbortController(); onStart();
    $<HTMLButtonElement>('ex-go').disabled = true; $<HTMLButtonElement>('ex-cancel').disabled = false;
    const show = (p: Progress) => {
      $<HTMLProgressElement>('ex-bar').max = Math.max(1, p.total); $<HTMLProgressElement>('ex-bar').value = p.done;
      $('ex-status').textContent = `${p.state}: ${p.done}/${p.total}` + (p.skipped ? ` (${p.skipped} already in the folder)` : '') + (p.parts ? `, ${p.parts} zip part(s) downloaded` : '') + (p.message ? ` — ${p.message}` : '');
    };
    await runExport(getRenderer, canvas, params, opts, browserIO(dir), show, ctl.signal);
    ctl = null;
    $<HTMLButtonElement>('ex-go').disabled = false; $<HTMLButtonElement>('ex-cancel').disabled = true;
    onEnd();
  };
  $('ex-cancel').onclick = () => ctl?.abort();
}

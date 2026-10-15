import { DEFAULTS, clone } from './core/params';
import { SlitScanRenderer } from './core/renderer';
import { buildPanel } from './ui/panel';
import { imageStatus } from './art/imageMap';
import { sampleUrl } from './art/samples';
import { buildExportPanel } from './ui/exportPanel';

const FPS = 24;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const params = clone(DEFAULTS);
const playback = { playing: false };
const renderer = new SlitScanRenderer(canvas);

let ui: ReturnType<typeof buildPanel>;
let dirty = true;
let last = 0, acc = 0;
let drewPreview = false;
let exporting = false;

function schedule() { dirty = true; }

function tick(now: number) {
  requestAnimationFrame(tick);
  if (exporting) { last = now; return; }
  const dt = Math.min(now - last, 250); last = now;
  if (playback.playing) {
    acc += dt;
    const step = Math.floor((acc * FPS) / 1000);
    if (step > 0) {
      acc -= (step * 1000) / FPS;
      params.art.frame = (params.art.frame + step) % params.art.frames;
      ui.syncAll(); dirty = true;
    }
  } else acc = 0;
  if (!dirty) return;
  dirty = false;
  // low sample count while playing; full quality once paused / on parameter edits at rest
  drewPreview = playback.playing;
  renderer.render(params, playback.playing ? Math.min(params.exposure.previewSamples, params.exposure.samples) : params.exposure.samples, 720);
  ui.refreshInfo();
}

ui = buildPanel(document.getElementById('panel')!, params, playback, schedule, () =>
  `float buffer: ${renderer.floatFormat}\nlast render: ${renderer.lastMs.toFixed(0)} ms${drewPreview ? ' (preview samples)' : ` (${params.exposure.samples} samples)`}\n` +
  `frame ${params.art.frame}/${params.art.frames} @ ${FPS}fps\nphysical exposure (info only): ${params.exposure.realSeconds}s/frame`,
  { load: f => renderer.images.load(f), loadSample: id => renderer.images.loadSample(id, sampleUrl(id)), sampleId: () => renderer.images.sampleId, clear: () => renderer.images.clear(), loaded: () => renderer.images.files.map(x => ({ ...x })), status: e => renderer.images.status(e) });
buildExportPanel(document.getElementById('panel')!, canvas, renderer, params,
  () => {   // export guard: image artwork must be present and identical to what the project expects
    if (params.art.kind !== 'image') return null;
    if (params.image.sample) return renderer.images.sampleId === params.image.sample ? null : `Sample image "${params.image.sample}" is still loading.`;
    const st = imageStatus(params.image.files, renderer.images.files);
    return st.state === 'ok' ? null : (st as { message: string }).message;
  }, () => { playback.playing = false; exporting = true; }, () => { exporting = false; dirty = true; });
(window as any).__star = { params, renderer, schedule, playback };
requestAnimationFrame(tick);

// drag-and-drop of image files anywhere on the page
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void (window as any).__loadImages?.(files);
});

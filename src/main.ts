import { DEFAULTS, clone, type Params } from './core/params';
import { SlitScanRenderer } from './core/renderer';
import { FeatureError } from './core/features';
import { buildPanel } from './ui/panel';
import { buildAppPanel } from './ui/appPanel';
import { imageStatus } from './art/imageMap';
import { sampleUrl } from './art/samples';
import { buildExportPanel } from './ui/exportPanel';
import { DEFAULT_UI, loadSettings, resetSettings, safeStorage, saveSettings, type UiSettings } from './storage';

const FPS = 24;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const stage = document.getElementById('stage')!;
const panelEl = document.getElementById('panel')!;

function fatal(title: string, detail: string) {
  stage.innerHTML = '';
  const d = document.createElement('div'); d.style.cssText = 'max-width:34em;padding:24px;color:#e6e8ee;line-height:1.5';
  const h = document.createElement('h2'); h.textContent = title; h.style.margin = '0 0 8px';
  const p = document.createElement('p'); p.textContent = detail;
  d.append(h, p); stage.append(d); panelEl.style.display = 'none';
}

let renderer: SlitScanRenderer;
try { renderer = new SlitScanRenderer(canvas); }
catch (e) { fatal(e instanceof FeatureError ? 'Cannot start' : 'Cannot start the renderer', (e as Error).message); throw e; }

// ---- settings: defaults <- saved settings (versioned, validated); phones start in low-power mode
const store = safeStorage();
const saved = loadSettings(store, DEFAULTS);
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
const params: Params = saved ? saved.params : clone(DEFAULTS);
const uiSettings: UiSettings = saved ? saved.ui : { ...DEFAULT_UI, lowPower: isPhone };
const playback = { playing: false };

let panelUi: ReturnType<typeof buildPanel>;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;
const frameLabel = document.getElementById('frame-label')!;
let dirty = true, exporting = false, contextLost = false;
let last = 0, acc = 0, drewPreview = false, adaptiveH = 0, ema = 16, saveTimer = 0;

function persist() { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => saveSettings(params, uiSettings, store), 400); }
function schedule() { dirty = true; persist(); syncTransport(); }

/** The Start/Stop button and frame scrubber under the picture. */
function syncTransport() {
  playBtn.textContent = playback.playing ? '❚❚ Stop' : '▶ Start';
  playBtn.setAttribute('aria-pressed', String(playback.playing));
  playBtn.disabled = exporting;
  scrub.max = String(Math.max(1, params.art.frames - 1)); scrub.value = String(params.art.frame);
  frameLabel.textContent = `${params.art.frame + 1} / ${params.art.frames}`;
}
function togglePlay() { if (exporting) return; playback.playing = !playback.playing; syncTransport(); dirty = true; }

// ---- preview resolution: user quality, screen size/DPR, and (auto) adaptive scaling while playing
const QUALITY_H = { high: 720, medium: 540, low: 360 } as const;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
function baseHeight() {
  const cap = even((stage.clientHeight || 600) * Math.min(window.devicePixelRatio || 1, 2));
  const want = uiSettings.quality === 'auto' ? (isPhone ? 432 : 720) : QUALITY_H[uiSettings.quality];
  return even(Math.min(want, Math.max(240, cap)));
}
function previewHeight(playing: boolean) {
  const base = baseHeight();
  if (!playing || uiSettings.quality !== 'auto') return base;
  if (!adaptiveH || adaptiveH > base) adaptiveH = base;
  return even(adaptiveH);
}
function adapt(ms: number) {   // keep ~30 fps: shrink fast, grow slowly
  ema = ema * 0.8 + ms * 0.2; const base = baseHeight();
  if (ema > 40) adaptiveH = Math.max(240, (adaptiveH || base) * 0.85); else if (ema < 20) adaptiveH = Math.min(base, (adaptiveH || base) * 1.06);
}
function sampleCount(playing: boolean) {
  const lp = uiSettings.lowPower;
  return playing ? Math.min(params.exposure.previewSamples, lp ? 16 : params.exposure.samples) : Math.min(params.exposure.samples, lp ? 64 : params.exposure.samples);
}

function tick(now: number) {
  requestAnimationFrame(tick);
  if (exporting || contextLost) { last = now; return; }
  const dt = Math.min(now - last, 250); last = now;
  if (playback.playing) {
    acc += dt;
    const step = Math.floor((acc * FPS) / 1000);
    if (step > 0) {
      acc -= (step * 1000) / FPS;
      params.art.frame = (params.art.frame + step) % params.art.frames;
      panelUi.syncAll(); syncTransport(); dirty = true;
    }
  } else acc = 0;
  if (!dirty) return;
  dirty = false;
  drewPreview = playback.playing;
  renderer.render(params, sampleCount(playback.playing), previewHeight(playback.playing));
  if (playback.playing) adapt(renderer.lastMs);
  panelUi.refreshInfo();
}

function applyParams(p: Params) { Object.assign(params, clone(p)); panelUi.syncAll(); schedule(); }

panelUi = buildPanel(panelEl, params, playback, schedule, () =>
  `float buffer: ${renderer.floatFormat}\nlast render: ${renderer.lastMs.toFixed(0)} ms @ ${canvas.width}×${canvas.height}${drewPreview ? ' (preview samples)' : ` (${sampleCount(false)} samples)`}\n` +
  `frame ${params.art.frame}/${params.art.frames} @ ${FPS}fps\nphysical exposure (info only): ${params.exposure.realSeconds}s/frame`,
  { load: (f, k) => renderer.images.load(f, null, k ?? 'file'), sourceKind: () => renderer.images.sourceKind, maxSide: () => renderer.images.maxSide, loadSample: id => renderer.images.loadSample(id, sampleUrl(id)), sampleId: () => renderer.images.sampleId, clear: () => renderer.images.clear(), loaded: () => renderer.images.files.map(x => ({ ...x })), status: e => renderer.images.status(e) });
buildAppPanel(panelEl, params, uiSettings, {
  onUi: () => { adaptiveH = 0; schedule(); }, applyParams, storageOk: !!store,
  reset: () => { resetSettings(store); applyParams(clone(DEFAULTS)); },
});
buildExportPanel(panelEl, canvas, () => renderer, params,
  () => {   // export guard: image artwork must be present and identical to what the project expects
    if (params.art.kind !== 'image') return null;
    if (params.image.sample) return renderer.images.sampleId === params.image.sample ? null : `Sample image "${params.image.sample}" is still loading.`;
    const st = imageStatus(params.image.files, renderer.images.files);
    return st.state === 'ok' ? null : (st as { message: string }).message;
  }, () => { playback.playing = false; exporting = true; syncTransport(); }, () => { exporting = false; dirty = true; syncTransport(); });
playBtn.addEventListener('click', togglePlay);
scrub.addEventListener('input', () => { params.art.frame = +scrub.value; panelUi.syncAll(); schedule(); });
window.addEventListener('keydown', e => { if (e.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); togglePlay(); } });
syncTransport();
(window as any).__star = { params, get renderer() { return renderer; }, schedule, playback, uiSettings };

// a restored project that used a bundled sample reloads it (user files cannot be restored)
if (params.art.kind === 'image' && params.image.sample) void (window as any).__pickSample?.(params.image.sample);
requestAnimationFrame(tick);

// ---- robustness: WebGL context loss/restore, resize/DPR changes
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; playback.playing = false; });
canvas.addEventListener('webglcontextrestored', async () => {
  const src = renderer.images.snapshotSources();
  try {
    renderer = new SlitScanRenderer(canvas);
    if (src.files.length) await renderer.images.load(src.files, src.sample, src.kind);
  } catch (e) { fatal('The graphics context was lost', (e as Error).message); return; }
  contextLost = false; dirty = true;
});
new ResizeObserver(() => { dirty = true; }).observe(stage);
window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', () => { dirty = true; });

// ---- panel as a bottom sheet on narrow screens
const toggle = document.getElementById('sheet-toggle');
toggle?.addEventListener('click', () => { const open = document.body.classList.toggle('sheet-open'); toggle.setAttribute('aria-expanded', String(open)); });

// ---- drag-and-drop of image files anywhere on the page
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void (window as any).__loadImages?.(files);
});

// ---- offline use: register the service worker of a production build (never in dev)
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => { /* offline mode is optional */ });
}

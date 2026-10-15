import { STRIP_PRESETS, parseStrips } from '../color/config';
import { SAMPLES, sampleThumbUrl } from '../art/samples';
import { FITS, SEQ_MODES, WRAPS, type ImageFileInfo, type ImageStatus } from '../art/imageMap';
import { ART_KINDS, PRESETS, RANGES, clone, type Params, type Range } from '../core/params';

type Path = keyof typeof RANGES;

function get(p: Params, path: string): number {
  return path.split('.').reduce((o: any, k) => o[k], p);
}
function set(p: Params, path: string, v: number) {
  const ks = path.split('.');
  const last = ks.pop()!;
  ks.reduce((o: any, k) => o[k], p)[last] = v;
}

const LABELS: Record<string, string> = { 'color.saturation': 'saturation (output)', 'image.saturation': 'image saturation', centreGap: 'centre gap' };

const GROUPS: [string, Path[]][] = [
  ['Slit', ['centreGap', 'slit.height', 'slit.width', 'slit.offsetX']],
  ['Panel', ['panel.width', 'panel.height', 'panel.distance']],
  ['Camera track', ['track.length', 'track.nearDistance', 'camera.fovY', 'camera.fStop']],
  ['Exposure', ['exposure.samples', 'exposure.previewSamples', 'exposure.gain', 'exposure.depthFade', 'exposure.sharpness', 'exposure.realSeconds']],
  ['Animation', ['art.frame', 'art.frames', 'art.scrollPerFrame']],
  ['Artwork', ['art.seed', 'art.alongFreq']],
  ['Image artwork', ['image.index', 'image.scale', 'image.offsetX', 'image.offsetY', 'image.rotation', 'image.contrast', 'image.saturation', 'image.seamBlend']],
  ['Colour separation', ['color.saturation', 'color.seed', 'color.period', 'color.contrastHigh', 'color.contrastLow']],
];

export interface Playback { playing: boolean }

export interface PanelHooks {
  load(files: File[]): Promise<ImageFileInfo[]>;
  clear(): void;
  loadSample(id: string): Promise<ImageFileInfo[]>;
  sampleId(): string | null;
  loaded(): ImageFileInfo[];
  status(expected: ImageFileInfo[]): ImageStatus;
}

/** Recursively copy known keys of a saved params object onto the live params (arrays replace). */
export function mergeParams(target: any, src: any) {
  for (const k of Object.keys(target)) {
    if (!(k in src)) continue;
    if (target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) mergeParams(target[k], src[k]);
    else target[k] = src[k];
  }
}

export function buildPanel(root: HTMLElement, params: Params, playback: Playback, onChange: () => void, info: () => string, hooks: PanelHooks) {
  root.innerHTML = '<h1>STAR GATE · M1</h1>';
  const infoEl = document.createElement('div');
  infoEl.id = 'info';
  const sync: (() => void)[] = [];

  const pre = document.createElement('select');
  for (const pr of PRESETS) pre.add(new Option(pr.name));
  pre.onchange = () => {
    Object.assign(params, clone(PRESETS.find(x => x.name === pre.value)!.params));
    params.image.files = hooks.loaded();   // presets never carry images; keep describing the ones loaded
    sync.forEach(f => f()); onChange();
  };
  const h = document.createElement('h2'); h.textContent = 'Preset';
  root.append(h, pre);


  for (const [title, paths] of GROUPS) {
    const g = document.createElement('h2'); g.textContent = title; root.append(g);
    if (title === 'Animation') {
      const play = document.createElement('button');
      const label = () => (play.textContent = playback.playing ? '❚❚ Pause' : '▶ Play');
      play.onclick = () => { playback.playing = !playback.playing; label(); onChange(); };
      label(); root.append(play);
    }
    if (title === 'Colour separation') {
      root.append(checkbox('enabled', () => params.color.enabled, v => (params.color.enabled = v)));
      root.append(select('wheel mode', ['smooth', 'step'], () => params.color.mode, v => (params.color.mode = v as 'smooth' | 'step')));
      root.append(select('low curve', ['lift', 'gamma'], () => params.color.lowCurve, v => (params.color.lowCurve = v as 'lift' | 'gamma')));
      root.append(select('wheel style', ['classic', 'vivid'], () => params.color.wheelStyle, v => (params.color.wheelStyle = v as 'classic' | 'vivid')));
      root.append(select('mix', ['add', 'screen'], () => params.color.mix, v => (params.color.mix = v as 'add' | 'screen')));
      root.append(select('strips', [...Object.keys(STRIP_PRESETS), 'custom'], () => params.color.stripPreset, v => {
        params.color.stripPreset = v;
        if (v !== 'custom') params.color.strips = STRIP_PRESETS[v].map(x => ({ ...x }));
        syncStrips();
      }));
    }
    if (title === 'Artwork') root.append(select('kind', [...ART_KINDS], () => params.art.kind, v => (params.art.kind = v as Params['art']['kind'])));
    if (title === 'Image artwork') root.append(imageBlock());
    for (const path of paths) root.append(slider(path, RANGES[path]));
  }

  const ta = document.createElement('textarea');
  ta.rows = 6; ta.style.cssText = 'width:100%;box-sizing:border-box;background:#1c1c22;color:#ddd;border:1px solid #333;font:11px monospace';
  const err = document.createElement('div'); err.style.color = '#e88';
  const apply = document.createElement('button'); apply.textContent = 'Apply strip JSON';
  function syncStrips() { ta.value = JSON.stringify(params.color.strips); err.textContent = ''; }
  apply.onclick = () => {
    try {
      params.color.strips = parseStrips(JSON.parse(ta.value));
      params.color.stripPreset = 'custom'; sync.forEach(f => f()); err.textContent = ''; onChange();
    } catch (e) { err.textContent = (e as Error).message; }
  };
  sync.push(syncStrips); syncStrips();
  root.append(ta, apply, err);

  const g = document.createElement('h2'); g.textContent = 'Options'; root.append(g);
  root.append(select('accel', ['linear', 'ease-in', 'exponential'], () => params.accel, v => (params.accel = v as Params['accel'])));
  root.append(select('orientation', ['left-right', 'top-bottom'], () => params.orientation, v => (params.orientation = v as Params['orientation'])));
  root.append(checkbox('mirror slide (walls flow outward)', () => params.art.mirrorSlide, v => (params.art.mirrorSlide = v)));
  root.append(checkbox('double exposure', () => params.doubleExposure, v => (params.doubleExposure = v)));
  root.append(checkbox('jitter (dither)', () => params.exposure.jitter, v => (params.exposure.jitter = v)));
  const json = document.createElement('button');
  json.textContent = 'Copy params JSON';
  json.onclick = () => navigator.clipboard?.writeText(JSON.stringify(params, null, 2));
  const imp = document.createElement('textarea'); imp.rows = 3; imp.placeholder = 'paste params JSON here';
  imp.style.cssText = 'width:100%;box-sizing:border-box;background:#1c1c22;color:#ddd;border:1px solid #333;font:11px monospace;margin-top:6px';
  const impBtn = document.createElement('button'); impBtn.textContent = 'Load params JSON';
  const impErr = document.createElement('div'); impErr.style.color = '#e88';
  impBtn.onclick = () => {
    try {
      mergeParams(params, JSON.parse(imp.value)); impErr.textContent = ''; sync.forEach(f => f()); onChange();
      if (params.art.kind === 'image' && params.image.sample && hooks.sampleId() !== params.image.sample) void (window as any).__pickSample(params.image.sample); // bundled: reload it automatically
    }
    catch (e) { impErr.textContent = (e as Error).message; }
  };
  root.append(json, imp, impBtn, impErr, infoEl);

  function refreshInfo() { infoEl.textContent = info(); }

  /** File picker, drag-and-drop hint, loaded list, mode/fit/wrap selects and the 'missing image' warning. */
  function imageBlock() {
    const box = document.createElement('div');
    const file = document.createElement('input'); file.type = 'file'; file.multiple = true; file.accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
    const clear = document.createElement('button'); clear.textContent = 'Remove images';
    const list = document.createElement('div'); list.style.cssText = 'color:#8a8f99;font-size:12px;margin:4px 0';
    const warn = document.createElement('div'); warn.id = 'image-warning'; warn.style.cssText = 'color:#f0a050;font-size:12px;margin:4px 0';
    // sample picker: dropdown + thumbnails
    const thumbs: HTMLButtonElement[] = SAMPLES.map(sm => {
      const b = document.createElement('button'); b.title = `${sm.title}: ${sm.description}`; b.style.cssText = 'padding:0;border:1px solid #333;background:#000;width:76px;height:40px;margin:0 3px 3px 0;cursor:pointer';
      const im = document.createElement('img'); im.src = sampleThumbUrl(sm.id); im.alt = sm.title; im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'; b.append(im);
      b.onclick = () => void pickSample(sm.id); return b;
    });
    const thumbRow = document.createElement('div'); thumbRow.style.cssText = 'margin:4px 0'; thumbRow.append(...thumbs);
    const sampleSel = select('sample image', ['my own images…', ...SAMPLES.map(sm => sm.title)], () => (params.image.sample ? SAMPLES.find(sm => sm.id === params.image.sample)?.title ?? 'my own images…' : 'my own images…'), v => {
      const sm = SAMPLES.find(x => x.title === v);
      if (sm) void pickSample(sm.id); else file.click();   // 'my own images…' opens the file picker; the dropdown shows the real state again via sync
    });
    const show = () => {
      const have = hooks.loaded();
      list.textContent = have.length ? have.map((f, i) => `${i}: ${f.name} (${f.width}×${f.height}, ${(f.bytes / 1024).toFixed(0)} KB)`).join('\n') : 'Drop PNG/JPEG/WebP files onto the page, or choose files (up to 8).';
      list.style.whiteSpace = 'pre-line';
      const st = hooks.status(params.image.files);
      // bundled samples are always reproducible: they never raise the missing-image warning
      warn.textContent = params.art.kind === 'image' && !params.image.sample && st.state !== 'ok' ? '⚠ ' + (st as { message: string }).message : '';
      thumbs.forEach((b, i) => { b.style.outline = params.image.sample === SAMPLES[i].id ? '2px solid #7fb0ff' : '1px solid #333'; });
    };
    const doLoad = async (files: File[]) => {
      try {
        params.image.files = await hooks.load(files);
        params.image.sample = null;
        params.art.kind = 'image'; sync.forEach(f => f()); onChange();
      } catch (e) { warn.textContent = '⚠ ' + (e as Error).message; }
    };
    file.onchange = () => { if (file.files?.length) void doLoad([...file.files]); };
    const pickSample = async (id: string) => {
      try { params.image.files = await hooks.loadSample(id); params.image.sample = id; params.art.kind = 'image'; sync.forEach(f => f()); onChange(); }
      catch (e) { warn.textContent = '⚠ ' + (e as Error).message; }
    };
    (window as any).__pickSample = pickSample;
    clear.onclick = () => { hooks.clear(); params.image.files = []; params.image.sample = null; sync.forEach(f => f()); onChange(); };
    (window as any).__loadImages = doLoad; // used by the drag-and-drop handler in main.ts
    sync.push(show); show();
    box.append(
      sampleSel, thumbRow,
      select('mode', [...SEQ_MODES], () => params.image.mode, v => (params.image.mode = v as typeof params.image.mode)),
      select('fit', [...FITS], () => params.image.fit, v => (params.image.fit = v as typeof params.image.fit)),
      select('wrap', [...WRAPS], () => params.image.wrap, v => (params.image.wrap = v as typeof params.image.wrap)),
      file, clear, list, warn);
    return box;
  }
  refreshInfo();
  return { refreshInfo, syncAll: () => sync.forEach(f => f()) };

  function slider(path: Path, r: Range) {
    const row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('label'); label.textContent = LABELS[path] ?? path;
    const inp = document.createElement('input'); inp.type = 'range';
    const out = document.createElement('output');
    const toPos = (v: number) => (r.log ? Math.log(v) : v);
    const fromPos = (x: number) => (r.log ? Math.exp(x) : x);
    inp.min = String(toPos(r.min));
    const setMax = () => (inp.max = String(toPos(path === 'art.frame' ? params.art.frames - 1 : r.max)));
    setMax();
    inp.step = r.log ? 'any' : String(r.step);
    const show = () => {
      setMax();
      const v = get(params, path);
      inp.value = String(toPos(v));
      out.textContent = v >= 100 ? v.toFixed(0) : String(+v.toFixed(3));
    };
    inp.oninput = () => {
      let v = fromPos(+inp.value);
      if (r.log) v = Math.round(v / r.step) * r.step;
      set(params, path, v);
      if (path === 'art.frames') params.art.frame = Math.min(params.art.frame, v - 1);
      show(); refreshInfo(); onChange();
    };
    sync.push(show); show();
    row.append(label, inp, out);
    return row;
  }
  function select(name: string, opts: string[], getter: () => string, setter: (v: string) => void) {
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = name;
    const s = document.createElement('select'); opts.forEach(o => s.add(new Option(o)));
    const show = () => (s.value = getter());
    s.onchange = () => { setter(s.value); onChange(); };
    sync.push(show); show();
    row.append(l, s); return row;
  }
  function checkbox(name: string, getter: () => boolean, setter: (v: boolean) => void) {
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = name;
    const c = document.createElement('input'); c.type = 'checkbox';
    const show = () => (c.checked = getter());
    c.onchange = () => { setter(c.checked); onChange(); };
    sync.push(show); show();
    row.append(l, c); return row;
  }
}

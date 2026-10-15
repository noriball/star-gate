import { FIXED_CENTRE_GAP } from '../core/params';
import { CameraController, defaultFacing, takeSnapshot, type CameraError, type Facing } from '../art/camera';
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

const LABELS: Record<string, string> = { 'color.saturation': 'saturation (output)', 'image.saturation': 'image saturation', centreGap: 'centre gap (fixed)' };

// Only controls whose effect is clearly visible are shown. Everything else keeps its (preset) value and is still saved/loaded.
const GROUPS: [string, Path[]][] = [
  ['Look', ['exposure.gain', 'panel.distance', 'camera.fovY']],
  ['Animation', ['art.frame', 'art.scrollPerFrame']],
  ['Artwork', ['art.seed']],
  ['Image artwork', ['image.index', 'image.scale', 'image.offsetX', 'image.offsetY', 'image.rotation']],
  ['Colour separation', ['color.saturation', 'color.period']],
];

export interface Playback { playing: boolean }

export interface PanelHooks {
  load(files: File[], kind?: 'file' | 'camera'): Promise<ImageFileInfo[]>;
  sourceKind(): 'file' | 'sample' | 'camera' | null;
  maxSide(): number;
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
    Object.assign(params, clone(PRESETS.find(x => x.name === pre.value)!.params)); params.centreGap = FIXED_CENTRE_GAP;
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
    if (title === 'Colour separation') root.append(checkbox('separation on', () => params.color.enabled, v => (params.color.enabled = v)));
    if (title === 'Artwork') root.append(select('kind', [...ART_KINDS], () => params.art.kind, v => (params.art.kind = v as Params['art']['kind'])));
    if (title === 'Image artwork') root.append(imageBlock());
    for (const path of paths) root.append(slider(path, RANGES[path]));
  }


  const g = document.createElement('h2'); g.textContent = 'Options'; root.append(g);
  root.append(select('accel', ['linear', 'ease-in', 'exponential'], () => params.accel, v => (params.accel = v as Params['accel'])));
  root.append(select('orientation', ['left-right', 'top-bottom'], () => params.orientation, v => (params.orientation = v as Params['orientation'])));
  root.append(checkbox('double exposure', () => params.doubleExposure, v => (params.doubleExposure = v)));
  root.append(infoEl);

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
    let camOpen = false;
    const CAMERA_OPT = 'camera snapshot…';
    const sampleSel = select('sample image', ['my own images…', CAMERA_OPT, ...SAMPLES.map(sm => sm.title)], () => (camOpen ? CAMERA_OPT : params.image.sample ? SAMPLES.find(sm => sm.id === params.image.sample)?.title ?? 'my own images…' : 'my own images…'), v => {
      const sm = SAMPLES.find(x => x.title === v);
      camOpen = v === CAMERA_OPT; show();
      if (sm) void pickSample(sm.id); else if (!camOpen) file.click();   // 'my own images…' opens the file picker; the dropdown shows the real state again via sync
    });
    // ---- camera snapshot input (all local: nothing is sent anywhere)
    const camBox = document.createElement('div'); camBox.style.cssText = 'display:none;border:1px solid #333;border-radius:6px;padding:6px;margin:6px 0';
    const secure = typeof window !== 'undefined' && window.isSecureContext !== false;
    // created on first use (reads navigator.mediaDevices then), so nothing touches the camera API until the user asks
    let camCtl: CameraController | null = null; let unsub: (() => void) | null = null;
    const camera = () => { if (!camCtl) { camCtl = new CameraController(typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined, secure); unsub = camCtl.onDeviceChange(() => void refreshDevices()); } return camCtl; };
    const cam = { get active() { return camCtl?.active ?? null; }, start: (o: Parameters<CameraController['start']>[0]) => camera().start(o), stop: () => camCtl?.stop(), devices: () => camera().devices() };
    void unsub;
    let facing: Facing = defaultFacing({ userAgent: navigator.userAgent, coarsePointer: matchMedia?.('(pointer: coarse)').matches, maxTouchPoints: navigator.maxTouchPoints });
    let lastSnap: File | null = null;
    const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.style.cssText = 'width:100%;max-height:200px;background:#000;display:none;border-radius:4px';
    const camMsg = document.createElement('div'); camMsg.style.cssText = 'font-size:12px;margin:4px 0;color:#8a8f99';
    const mk = (t: string) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'margin:2px 4px 2px 0;min-height:32px'; return b; };
    const bFront = mk('front (user)'), bRear = mk('rear (environment)'), bStart = mk('Start camera'), bSnap = mk('Take snapshot'), bRetake = mk('Retake'), bClose = mk('Close camera'), bDl = mk('Download snapshot PNG');
    const devSel = document.createElement('select'); devSel.style.cssText = 'width:100%;margin:4px 0';
    const lab = (t: string, c: HTMLInputElement) => { const l = document.createElement('label'); l.style.cssText = 'display:block;font-size:12px;color:#aab'; l.append(c, ' ' + t); return l; };
    const mPrev = document.createElement('input'); mPrev.type = 'checkbox'; mPrev.checked = true;
    const mSnap = document.createElement('input'); mSnap.type = 'checkbox';
    const showCamMsg = (t: string, bad = false) => { camMsg.textContent = t; camMsg.style.color = bad ? '#f0a050' : '#8a8f99'; };
    const refreshCam = () => {
      const on = !!cam.active;
      bFront.style.outline = facing === 'user' ? '2px solid #7fb0ff' : ''; bRear.style.outline = facing === 'environment' ? '2px solid #7fb0ff' : '';
      bStart.disabled = on; bSnap.disabled = !on; bRetake.disabled = !on || video.paused === false; bClose.disabled = !on; bDl.disabled = !lastSnap;
      video.style.display = on ? 'block' : 'none';
      video.style.transform = mPrev.checked && facing === 'user' && !devSel.value ? 'scaleX(-1)' : '';   // preview only
    };
    const refreshDevices = async () => {
      try {
        const keep = devSel.value; const list = await cam.devices(); devSel.innerHTML = '';
        devSel.add(new Option('camera: automatic (by front/rear)', ''));
        for (const d of list) devSel.add(new Option(d.label, d.deviceId));
        devSel.value = list.some(d => d.deviceId === keep) ? keep : '';
      } catch { /* listing is optional */ }
    };
    const startCam = async () => {
      try {
        showCamMsg('Starting camera…');
        const stream = await cam.start({ deviceId: devSel.value || null, facing: devSel.value ? 'any' : facing, idealWidth: 1920, idealHeight: 1080 });
        video.srcObject = stream; await video.play();
        await refreshDevices();   // labels only appear after permission has been granted
        showCamMsg('Camera ready. Take a snapshot to use it as the artwork.');
      } catch (e) { const ce = e as CameraError; showCamMsg(ce?.message ?? String(e), true); video.srcObject = null; }
      refreshCam();
    };
    const closeCam = () => { cam.stop(); video.srcObject = null; showCamMsg('Camera closed.'); refreshCam(); };
    bStart.onclick = () => void startCam();
    bClose.onclick = closeCam;
    const setFacing = (f: Facing) => { facing = f; devSel.value = ''; refreshCam(); if (cam.active) void startCam(); };
    bFront.onclick = () => setFacing('user'); bRear.onclick = () => setFacing('environment');
    devSel.onchange = () => { if (cam.active) void startCam(); else refreshCam(); };
    mPrev.onchange = refreshCam;
    bSnap.onclick = async () => {
      try {
        const f = await takeSnapshot(video, { maxSide: hooks.maxSide(), mirror: mSnap.checked }); lastSnap = f;
        params.image.files = await hooks.load([f], 'camera'); params.image.sample = null; params.art.kind = 'image';
        video.pause(); showCamMsg('Snapshot taken (' + f.name + '). Retake to resume the preview.'); sync.forEach(x => x()); onChange();
      } catch (e) { showCamMsg((e as Error).message, true); }
      refreshCam();
    };
    bRetake.onclick = () => { void video.play(); showCamMsg('Camera ready.'); refreshCam(); };
    bDl.onclick = () => { if (!lastSnap) return; const a = document.createElement('a'); a.href = URL.createObjectURL(lastSnap); a.download = lastSnap.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    video.addEventListener('pause', refreshCam); video.addEventListener('play', refreshCam);
    const stopAll = () => cam.stop();                                   // always release the camera
    window.addEventListener('pagehide', stopAll); window.addEventListener('beforeunload', stopAll);
    const note = document.createElement('div'); note.style.cssText = 'font-size:12px;color:#f0a050;margin-top:4px'; note.textContent = 'A snapshot is not saved in the params JSON: download it as PNG and reload it via "my own images" to reproduce a project. Everything stays on this device.';
    const rowF = document.createElement('div'); rowF.append(bFront, bRear);
    const rowB = document.createElement('div'); rowB.append(bStart, bSnap, bRetake, bClose, bDl);
    camBox.append(rowF, devSel, lab('mirror front camera (preview only)', mPrev), lab('mirror snapshot', mSnap), video, camMsg, rowB, note);
    if (!secure) showCamMsg('The camera needs HTTPS (or http://localhost). See README: npm run dev:https.', true);
    refreshCam();
    const show = () => {
      camBox.style.display = camOpen ? 'block' : 'none';
      const have = hooks.loaded();
      list.textContent = have.length ? have.map((f, i) => `${i}: ${f.name} (${f.width}×${f.height}, ${(f.bytes / 1024).toFixed(0)} KB)`).join('\n') : 'Drop PNG/JPEG/WebP files onto the page, or choose files (up to 8).';
      list.style.whiteSpace = 'pre-line';
      if (hooks.sourceKind() === 'camera') list.textContent += '\n(camera snapshot: not saved in the params JSON)';
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
      sampleSel, camBox, thumbRow,
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
    if (path === 'centreGap') { inp.disabled = true; inp.title = 'The centre gap is fixed at 0.005 of the frame size'; }
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
    // controls that only matter in a given mode are hidden otherwise (image controls: image artwork; wheel period: colour separation)
    const visible = path.startsWith('image.') ? () => params.art.kind === 'image' : path === 'color.period' ? () => params.color.enabled : null;
    if (visible) { const vis = () => { row.style.display = visible() ? '' : 'none'; }; sync.push(vis); vis(); }
    row.append(label, inp, out);
    return row;
  }
  function select(name: string, opts: string[], getter: () => string, setter: (v: string) => void) {
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = name;
    const s = document.createElement('select'); opts.forEach(o => s.add(new Option(o)));
    const show = () => (s.value = getter());
    s.onchange = () => { setter(s.value); sync.forEach(f => f()); onChange(); };
    sync.push(show); show();
    row.append(l, s); return row;
  }
  function checkbox(name: string, getter: () => boolean, setter: (v: boolean) => void) {
    const row = document.createElement('div'); row.className = 'row';
    const l = document.createElement('label'); l.textContent = name;
    const c = document.createElement('input'); c.type = 'checkbox';
    const show = () => (c.checked = getter());
    c.onchange = () => { setter(c.checked); sync.forEach(f => f()); onChange(); };
    sync.push(show); show();
    row.append(l, c); return row;
  }
}

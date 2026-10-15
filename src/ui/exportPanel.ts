import type { Params } from '../core/params';
import type { SlitScanRenderer } from '../core/renderer';
import { runExport, type Progress } from '../export/exporter';

const HEIGHTS = [360, 540, 582, 720, 1080, 1440]; // 582 -> 1280×582 (2.2:1)

export function buildExportPanel(root: HTMLElement, canvas: HTMLCanvasElement, renderer: SlitScanRenderer, params: Params, guard: () => string | null, onStart: () => void, onEnd: () => void) {
  const h = document.createElement('h2'); h.textContent = 'Export (PNG sequence)';
  const box = document.createElement('div'); box.id = 'export';
  box.innerHTML = `
    <div class="row"><label>name</label><input id="ex-name" value="stargate" style="grid-column:2/4"></div>
    <div class="row"><label>height</label><select id="ex-h" style="grid-column:2/4"></select></div>
    <div class="row"><label>fps</label><input id="ex-fps" type="number" value="24" min="1" max="120" style="grid-column:2/4"></div>
    <div class="row"><label>start frame</label><input id="ex-start" type="number" value="0" min="0" style="grid-column:2/4"></div>
    <div class="row"><label>frame count</label><input id="ex-count" type="number" value="24" min="1" style="grid-column:2/4"></div>
    <div class="row"><label>overwrite</label><input id="ex-over" type="checkbox"><span style="grid-column:3"></span></div>
    <div><button id="ex-go">Export / resume</button> <button id="ex-cancel" disabled>Cancel</button></div>
    <progress id="ex-bar" value="0" max="1" style="width:100%;margin-top:6px"></progress>
    <div id="ex-status" style="color:#8a8f99;font-size:12px"></div>`;
  root.append(h, box);
  const $ = <T extends HTMLElement>(id: string) => box.querySelector('#' + id) as T;
  const sel = $<HTMLSelectElement>('ex-h');
  for (const v of HEIGHTS) sel.add(new Option(`${v}p  (${Math.round(v * params.filmAspect)}×${v})`, String(v)));
  sel.value = '720';
  let ctl: AbortController | null = null;

  $('ex-go').onclick = async () => {
    if (ctl) return;
    const blocked = guard();
    if (blocked) { $('ex-status').textContent = 'error: export refused — ' + blocked; return; }
    ctl = new AbortController();
    onStart();
    $<HTMLButtonElement>('ex-go').disabled = true; $<HTMLButtonElement>('ex-cancel').disabled = false;
    const show = (p: Progress) => {
      $<HTMLProgressElement>('ex-bar').max = Math.max(1, p.total);
      $<HTMLProgressElement>('ex-bar').value = p.done;
      $('ex-status').textContent = `${p.state}: ${p.done}/${p.total}` + (p.skipped ? ` (${p.skipped} resumed from disk)` : '') + (p.message ? ` — ${p.message}` : '');
    };
    await runExport(renderer, canvas, params, {
      name: $<HTMLInputElement>('ex-name').value.replace(/[^A-Za-z0-9_-]/g, '_') || 'stargate',
      height: +sel.value, fps: +$<HTMLInputElement>('ex-fps').value || 24,
      start: +$<HTMLInputElement>('ex-start').value || 0, count: +$<HTMLInputElement>('ex-count').value || 1,
      samples: params.exposure.samples, overwrite: $<HTMLInputElement>('ex-over').checked,
    }, show, ctl.signal);
    ctl = null;
    $<HTMLButtonElement>('ex-go').disabled = false; $<HTMLButtonElement>('ex-cancel').disabled = true;
    onEnd();
  };
  $('ex-cancel').onclick = () => ctl?.abort();
}

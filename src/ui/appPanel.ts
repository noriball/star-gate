import { DEFAULTS, clone, type Params } from '../core/params';
import { DEFAULT_UI, paramsFromJson, type UiSettings } from '../storage';

/** App-level controls: preview quality / low-power, reset to defaults, params JSON file import/export. */
export function buildAppPanel(
  root: HTMLElement, params: Params, ui: UiSettings,
  hooks: { onUi(): void; applyParams(p: Params): void; reset(): void; storageOk: boolean },
) {
  const h = document.createElement('h2'); h.textContent = 'App'; root.append(h);
  const row = (label: string, el: HTMLElement) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = label; el.style.gridColumn = '2/4'; r.append(l, el); root.append(r); };
  const q = document.createElement('select');
  for (const [v, t] of [['auto', 'auto (adaptive, ~30 fps)'], ['high', 'high (720p preview)'], ['medium', 'medium (540p)'], ['low', 'low (360p)']]) q.add(new Option(t, v));
  q.value = ui.quality; q.onchange = () => { ui.quality = q.value as UiSettings['quality']; hooks.onUi(); };
  row('preview quality', q);
  const lp = document.createElement('input'); lp.type = 'checkbox'; lp.checked = ui.lowPower;
  lp.onchange = () => { ui.lowPower = lp.checked; hooks.onUi(); };
  row('low-power mode', lp);
  const note = document.createElement('div'); note.style.cssText = 'color:#8a8f99;font-size:11px;margin:2px 0 6px';
  note.textContent = 'Low-power: fewer samples while playing/idle. Only the preview is affected; exports always use the full settings.' + (hooks.storageOk ? '' : ' (Browser storage is unavailable: settings will not be remembered.)');
  root.append(note);
  const mk = (t: string, f: () => void) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'margin:2px 4px 2px 0;min-height:32px'; b.onclick = f; return b; };
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.style.display = 'none';
  const msg = document.createElement('div'); msg.style.cssText = 'font-size:12px;color:#f0a050';
  file.onchange = async () => {
    const f = file.files?.[0]; if (!f) return;
    const p = paramsFromJson(await f.text(), DEFAULTS);
    if (!p) { msg.textContent = 'That file is not a valid params JSON.'; return; }
    msg.textContent = ''; hooks.applyParams(p); file.value = '';
  };
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' })); a.download = 'star-gate-params.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const reset = mk('Reset to defaults', () => { if (confirm('Reset all settings to the defaults?')) { Object.assign(ui, DEFAULT_UI); q.value = ui.quality; lp.checked = ui.lowPower; hooks.reset(); } });
  root.append(mk('Download params JSON', dl), mk('Import params JSON…', () => file.click()), reset, file, msg);
  void clone;
}

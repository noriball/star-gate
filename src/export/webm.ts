// Minimal WebM (Matroska) muxer for one VP8/VP9 video track, enough for browser playback with seeking (Cues).
// Used with WebCodecs' VideoEncoder so the app can write a video without any server or ffmpeg.

const enc = new TextEncoder();
function idBytes(id: number): number[] { const out: number[] = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff); return out; }
/** EBML data size as a variable length integer (always 8 bytes when `wide`, else minimal). */
export function vsize(n: number, wide = false): number[] {
  let len = 1; if (wide) len = 8; else while (n >= Math.pow(2, 7 * len) - 1 && len < 8) len++;
  const out = new Array<number>(len).fill(0); let v = n;
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 1 << (8 - len);
  return out;
}
type Bytes = Uint8Array;
const cat = (parts: (Bytes | number[])[]): Bytes => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const el = (id: number, payload: Bytes | number[]): Bytes => cat([idBytes(id), vsize(payload.length), payload]);
function uint(v: number): number[] { const o: number[] = []; for (let x = v; ; x = Math.floor(x / 256)) { o.unshift(x % 256); if (x < 256) break; } return o; }
const uintEl = (id: number, v: number) => el(id, uint(v));
const strEl = (id: number, s: string) => el(id, enc.encode(s));
function f64(v: number): Bytes { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return b; }

export interface WebMOptions { width: number; height: number; fps: number; codec: 'V_VP8' | 'V_VP9' }
interface Block { data: Bytes; tMs: number; key: boolean }

export class WebMMuxer {
  private blocks: Block[] = [];
  constructor(private o: WebMOptions) {}
  get count() { return this.blocks.length; }

  /** timestampUs: presentation time in microseconds */
  addChunk(data: Bytes, timestampUs: number, key: boolean) { this.blocks.push({ data: data.slice(), tMs: Math.round(timestampUs / 1000), key }); }

  finish(): Blob {
    const { width, height, fps, codec } = this.o;
    const durationMs = this.blocks.length ? this.blocks[this.blocks.length - 1].tMs + Math.round(1000 / fps) : 0;
    const header = el(0x1a45dfa3, cat([uintEl(0x4286, 1), uintEl(0x42f7, 1), uintEl(0x42f2, 4), uintEl(0x42f3, 8), strEl(0x4282, 'webm'), uintEl(0x4287, 4), uintEl(0x4285, 2)]));
    const info = el(0x1549a966, cat([uintEl(0x2ad7b1, 1000000), strEl(0x4d80, 'star-gate'), strEl(0x5741, 'star-gate'), el(0x4489, f64(durationMs))]));
    const tracks = el(0x1654ae6b, el(0xae, cat([uintEl(0xd7, 1), uintEl(0x73c5, 1), uintEl(0x83, 1), strEl(0x86, codec), el(0xe0, cat([uintEl(0xb0, width), uintEl(0xba, height)]))])));
    // clusters: a new one at every key frame (or at least every 30 s)
    const clusters: { bytes: Bytes; tMs: number }[] = [];
    let cur: { t0: number; items: Bytes[] } | null = null;
    const flush = () => { if (cur) clusters.push({ tMs: cur.t0, bytes: el(0x1f43b675, cat([uintEl(0xe7, cur.t0), ...cur.items])) }); cur = null; };
    for (const b of this.blocks) {
      if (!cur || (b.key && cur.items.length > 0) || b.tMs - cur.t0 > 30000) { flush(); cur = { t0: b.tMs, items: [] }; }
      const rel = b.tMs - cur.t0;
      cur.items.push(el(0xa3, cat([[0x81, (rel >> 8) & 0xff, rel & 0xff, b.key ? 0x80 : 0x00], b.data])));
    }
    flush();
    // cues (seeking): positions are relative to the start of the Segment payload
    let pos = info.length + tracks.length; const cues: Bytes[] = [];
    for (const c of clusters) { cues.push(el(0xbb, cat([uintEl(0xb3, c.tMs), el(0xb7, cat([uintEl(0xf7, 1), uintEl(0xf1, pos)]))]))); pos += c.bytes.length; }
    const cuesEl = el(0x1c53bb6b, cat(cues));
    const payload = cat([info, tracks, ...clusters.map(c => c.bytes), cuesEl]);
    return new Blob([header, cat([idBytes(0x18538067), vsize(payload.length, true)]), payload] as BlobPart[], { type: 'video/webm' });
  }
}

/** Tiny EBML reader used by the tests: lists top-level children of a master element. */
export function readEbml(buf: Bytes, start = 0, end = buf.length): { id: number; start: number; size: number; end: number }[] {
  const out: { id: number; start: number; size: number; end: number }[] = []; let p = start;
  while (p < end) {
    let idLen = 1; while (idLen < 4 && !(buf[p] & (0x80 >> (idLen - 1)))) idLen++;
    let id = 0; for (let i = 0; i < idLen; i++) id = id * 256 + buf[p + i];
    p += idLen; let len = 1; while (len < 8 && !(buf[p] & (0x80 >> (len - 1)))) len++;
    let size = buf[p] & (0xff >> len); for (let i = 1; i < len; i++) size = size * 256 + buf[p + i];
    p += len; out.push({ id, start: p, size, end: p + size }); p += size;
  }
  return out;
}

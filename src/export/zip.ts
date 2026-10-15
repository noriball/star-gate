// Minimal streaming ZIP writer ("stored" entries: PNGs are already compressed). No ZIP64: parts are kept far below 4 GB
// and 65535 files by the exporter. Dates are fixed so the same input always gives the same bytes.
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export const MAX_ZIP_ENTRIES = 60000;
const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00:00

export interface ZipSink { write(chunk: Uint8Array): void | Promise<void> }
interface Entry { name: Uint8Array; crc: number; size: number; offset: number }

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private done = false;
  constructor(private sink: ZipSink) {}

  /** bytes written so far (including headers) */
  get bytes() { return this.offset; }
  get count() { return this.entries.length; }
  /** size this entry will add: local header + data + its central directory record */
  static entryCost(name: string, size: number) { const n = new TextEncoder().encode(name).length; return 30 + n + size + 46 + n; }

  async add(name: string, data: Uint8Array): Promise<void> {
    if (this.done) throw new Error('zip already finished');
    if (this.entries.length >= MAX_ZIP_ENTRIES) throw new Error('too many files in one zip part');
    const nm = new TextEncoder().encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, DOS_TIME, true); h.setUint16(12, DOS_DATE, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    this.entries.push({ name: nm, crc, size: data.length, offset: this.offset });
    await this.sink.write(new Uint8Array(h.buffer)); await this.sink.write(nm); await this.sink.write(data);
    this.offset += 30 + nm.length + data.length;
  }

  /** Write the central directory; the sink then holds a complete .zip */
  async finish(): Promise<void> {
    if (this.done) return; this.done = true;
    const start = this.offset; let size = 0;
    for (const e of this.entries) {
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, DOS_TIME, true); c.setUint16(14, DOS_DATE, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.size, true); c.setUint32(24, e.size, true);
      c.setUint16(28, e.name.length, true); c.setUint32(42, e.offset, true);
      await this.sink.write(new Uint8Array(c.buffer)); await this.sink.write(e.name); size += 46 + e.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.entries.length, true); end.setUint16(10, this.entries.length, true);
    end.setUint32(12, size, true); end.setUint32(16, start, true);
    await this.sink.write(new Uint8Array(end.buffer));
    this.offset += size + 22;
  }
}

/** Sink collecting chunks into a Blob (the browser may keep large Blobs on disk, not in the JS heap). */
export class BlobSink implements ZipSink {
  private parts: BlobPart[] = [];
  write(chunk: Uint8Array) { this.parts.push(chunk.slice()); }
  blob(type = 'application/zip') { return new Blob(this.parts, { type }); }
}

/**
 * Splits an unbounded stream of files over several zip parts of at most `maxBytes` each, so very long or very large
 * sequences never need one huge archive in memory. `open(first)` creates the sink for a new part, `close` receives
 * the finished part and the numbers of the first and last frame it contains.
 */
export class PartedZip {
  private zip: ZipWriter | null = null;
  private first = 0; private last = 0; private parts = 0;
  constructor(private maxBytes: number, private open: (firstFrame: number) => ZipSink, private close: (sink: ZipSink, first: number, last: number, partIndex: number) => Promise<void> | void) {}
  get partCount() { return this.parts; }

  async add(frame: number, name: string, data: Uint8Array) {
    const cost = ZipWriter.entryCost(name, data.length);
    if (this.zip && this.zip.count > 0 && (this.zip.bytes + cost + 22 > this.maxBytes || this.zip.count >= MAX_ZIP_ENTRIES - 3)) await this.flush();
    if (!this.zip) { this.first = frame; this.sink = this.open(frame); this.zip = new ZipWriter(this.sink); }
    await this.zip.add(name, data); this.last = frame;
  }
  /** extra non-frame file (meta.json, encode.sh) goes into the current/last part */
  async addExtra(name: string, data: Uint8Array) {
    if (!this.zip) return;
    await this.zip.add(name, data);
  }
  private sink!: ZipSink;
  async flush() {
    if (!this.zip) return;
    await this.zip.finish(); await this.close(this.sink, this.first, this.last, this.parts++); this.zip = null;
  }
}

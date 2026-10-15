import { describe, expect, it } from 'vitest';
import { BlobSink, PartedZip, ZipWriter, crc32 } from '../src/export/zip';
import { WebMMuxer, readEbml } from '../src/export/webm';
import { encodeScript, frameFile, partName, planExport, runExport, type ExportIO, type ExportOpts } from '../src/export/exporter';
import { DEFAULTS, clone } from '../src/core/params';

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint16(o, true);

/** read a stored zip back: entries by name, verifying structure and CRCs */
function readZip(z: Uint8Array) {
  const eocd = z.length - 22;
  expect(u32(z, eocd)).toBe(0x06054b50);
  const n = u16(z, eocd + 10), cdSize = u32(z, eocd + 12), cdOff = u32(z, eocd + 16);
  expect(cdOff + cdSize).toBe(eocd);
  const out = new Map<string, Uint8Array>(); let p = cdOff;
  for (let i = 0; i < n; i++) {
    expect(u32(z, p)).toBe(0x02014b50);
    const crc = u32(z, p + 16), size = u32(z, p + 20), nl = u16(z, p + 28), lh = u32(z, p + 42);
    const name = new TextDecoder().decode(z.slice(p + 46, p + 46 + nl));
    expect(u32(z, lh)).toBe(0x04034b50); expect(u16(z, lh + 8)).toBe(0); // stored
    const dl = u16(z, lh + 26), data = z.slice(lh + 30 + dl, lh + 30 + dl + size);
    expect(crc32(data)).toBe(crc); out.set(name, data); p += 46 + nl;
  }
  return out;
}

describe('zip writer', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it('writes a valid, deterministic zip that reads back byte for byte', async () => {
    const make = async () => { const s = new BlobSink(), z = new ZipWriter(s); await z.add('frame_000001.png', new Uint8Array([1, 2, 3, 4])); await z.add('meta.json', new TextEncoder().encode('{"a":1}')); await z.finish(); return bytesOf(s.blob()); };
    const a = await make(), b = await make();
    expect(a).toEqual(b);
    const files = readZip(a);
    expect([...files.keys()]).toEqual(['frame_000001.png', 'meta.json']);
    expect(files.get('frame_000001.png')).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(new TextDecoder().decode(files.get('meta.json'))).toBe('{"a":1}');
  });
  it('splits a long sequence over parts below the size limit, each readable on its own, frames in order', async () => {
    const sinks: BlobSink[] = []; const ranges: [number, number][] = [];
    const pz = new PartedZip(2000, () => { const s = new BlobSink(); sinks.push(s); return s; }, (_s, f, l) => { ranges.push([f, l]); });
    for (let f = 1; f <= 10; f++) await pz.add(f, frameFile(f), new Uint8Array(500).fill(f));
    await pz.addExtra('meta.json', new TextEncoder().encode('{}')); await pz.flush();
    expect(sinks.length).toBeGreaterThan(2);
    expect(ranges[0][0]).toBe(1); expect(ranges[ranges.length - 1][1]).toBe(10);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);   // no frame lost or duplicated
    let total = 0;
    for (const s of sinks) { const z = await bytesOf(s.blob()); expect(z.length).toBeLessThanOrEqual(2000 + 200); const f = readZip(z); total += [...f.keys()].filter(k => k.startsWith('frame_')).length; }
    expect(total).toBe(10);
    expect(readZip(await bytesOf(sinks[sinks.length - 1].blob())).has('meta.json')).toBe(true);
  });
});

describe('frame numbering, ranges and scripts', () => {
  it('plan clamps to the animation length; frames are numbered from start+1', () => {
    expect(planExport({ start: 0, count: 24 }, 240)).toEqual({ total: 24, first: 1, last: 24 });
    expect(planExport({ start: 24, count: 24 }, 240)).toEqual({ total: 24, first: 25, last: 48 });
    expect(planExport({ start: 230, count: 24 }, 240)).toEqual({ total: 10, first: 231, last: 240 });
    expect(planExport({ start: 300, count: 5 }, 240).total).toBe(0);
    expect(frameFile(7)).toBe('frame_000007.png'); expect(partName('x', 1, 24)).toBe('x_frames_000001-000024.zip');
  });
  it('encode.sh continues at the right frame number (resume by range)', () => {
    const o = { name: 'run', format: 'zip', height: 582, fps: 24, start: 48, count: 24, samples: 128, partMb: 256 } as ExportOpts;
    expect(encodeScript(o, 1280, 582)).toContain('-start_number 49 -i frame_%06d.png');
    expect(encodeScript({ ...o, start: 0 }, 1280, 582)).toContain('-start_number 1 ');
  });
});

describe('runExport with a mocked renderer (no server involved)', () => {
  const fakeCanvas = () => { const frames: number[] = []; return { frames, canvas: { width: 1280, height: 582, toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([137, 80, 78, 71, frames[frames.length - 1] ?? 0])], { type: 'image/png' })) } as unknown as HTMLCanvasElement }; };
  const setup = (opts: Partial<ExportOpts> = {}) => {
    const { frames, canvas } = fakeCanvas(); const saved: { name: string; blob: Blob }[] = [];
    const renderer = { render: (p: { art: { frame: number } }, samples: number, height: number) => { frames.push(p.art.frame); expect(samples).toBe(128); expect(height).toBe(582); } };
    const io: ExportIO = { saveBlob: (name, blob) => { saved.push({ name, blob }); } };
    const o: ExportOpts = { name: 'job', format: 'zip', height: 582, fps: 24, start: 0, count: 10, samples: 128, partMb: 1, ...opts };
    const progress: string[] = [];
    const run = (signal = new AbortController().signal, base = clone(DEFAULTS)) => runExport(() => renderer as never, canvas, base, o, io, p => progress.push(p.state), signal);
    return { frames, saved, progress, run };
  };

  it('renders exactly the requested frame range with the same render call as the preview and zips it with meta + encode.sh', async () => {
    const t = setup({ start: 4, count: 6 }); await t.run();
    expect(t.frames).toEqual([4, 5, 6, 7, 8, 9]);                       // animation frame indices
    expect(t.saved.length).toBe(1); expect(t.saved[0].name).toBe('job_frames_000005-000010.zip');
    const files = readZip(await bytesOf(t.saved[0].blob));
    expect([...files.keys()].filter(k => k.startsWith('frame_'))).toEqual(['frame_000005.png', 'frame_000006.png', 'frame_000007.png', 'frame_000008.png', 'frame_000009.png', 'frame_000010.png']);
    expect(new TextDecoder().decode(files.get('encode.sh'))).toContain('-start_number 5');
    const meta = JSON.parse(new TextDecoder().decode(files.get('meta.json'))); expect(meta.firstFrame).toBe(5); expect(meta.params.centreGap).toBe(0.005);
    expect(t.progress.at(-1)).toBe('done');
  });
  it('is deterministic: two runs give identical zip bytes', async () => {
    const a = setup(), b = setup(); await a.run(); await b.run();
    expect(await bytesOf(a.saved[0].blob)).toEqual(await bytesOf(b.saved[0].blob));
  });
  it('cancel keeps the frames already rendered (finished part is delivered) and reports where to resume', async () => {
    const t = setup({ count: 10 }); const ac = new AbortController();
    const orig = t.progress.push.bind(t.progress); let n = 0; t.progress.push = (...a: string[]) => { if (++n === 3) ac.abort(); return orig(...a); };
    await t.run(ac.signal);
    expect(t.progress.at(-1)).toBe('cancelled'); expect(t.saved.length).toBe(1);
    const frames = [...readZip(await bytesOf(t.saved[0].blob)).keys()].filter(k => k.startsWith('frame_'));
    expect(frames.length).toBeGreaterThanOrEqual(2); expect(frames.length).toBeLessThan(10);
  });
  it('past-the-end start frame is an error, not an empty download', async () => {
    const t = setup({ start: 500 }); await t.run(); expect(t.progress.at(-1)).toBe('error'); expect(t.saved.length).toBe(0);
  });
  it('folder format skips frames already there (resume) and writes meta.json + encode.sh', async () => {
    const { canvas } = fakeCanvas(); const written: string[] = []; const have = new Set(['frame_000001.png', 'frame_000002.png']);
    const io: ExportIO = { saveBlob() { /* not used */ }, dir: { has: async n => have.has(n), write: async n => { written.push(n); } } };
    const rendered: number[] = []; const states: string[] = [];
    await runExport(() => ({ render: (p: { art: { frame: number } }) => rendered.push(p.art.frame) }) as never, canvas, clone(DEFAULTS), { name: 'f', format: 'folder', height: 582, fps: 24, start: 0, count: 4, samples: 128, partMb: 1 }, io, p => states.push(`${p.state}:${p.skipped}`), new AbortController().signal);
    expect(rendered).toEqual([2, 3]); expect(written).toEqual(['frame_000003.png', 'frame_000004.png', 'meta.json', 'encode.sh']); expect(states.at(-1)).toBe('done:2');
  });
});

describe('webm muxer', () => {
  it('writes a well-formed WebM: EBML header, one video track with the right size, clusters with all blocks, cues pointing at clusters', async () => {
    const m = new WebMMuxer({ width: 1280, height: 582, fps: 24, codec: 'V_VP9' });
    for (let i = 0; i < 50; i++) m.addChunk(new Uint8Array([i, i, i]), Math.round((i * 1e6) / 24), i % 24 === 0);
    const buf = await bytesOf(m.finish());
    const top = readEbml(buf); expect(top.map(e => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
    const header = readEbml(buf, top[0].start, top[0].end); expect(new TextDecoder().decode(buf.slice(header.find(e => e.id === 0x4282)!.start, header.find(e => e.id === 0x4282)!.end))).toBe('webm');
    const seg = top[1]; expect(seg.end).toBe(buf.length);                  // segment size is exact
    const kids = readEbml(buf, seg.start, seg.end); expect(kids.map(k => k.id)).toEqual([0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1f43b675, 0x1f43b675, 0x1c53bb6b]);
    const track = readEbml(buf, readEbml(buf, kids[1].start, kids[1].end)[0].start, readEbml(buf, kids[1].start, kids[1].end)[0].end);
    expect(new TextDecoder().decode(buf.slice(track.find(e => e.id === 0x86)!.start, track.find(e => e.id === 0x86)!.end))).toBe('V_VP9');
    const video = readEbml(buf, track.find(e => e.id === 0xe0)!.start, track.find(e => e.id === 0xe0)!.end);
    expect(video.map(v => buf.slice(v.start, v.end).reduce((a, b) => a * 256 + b, 0))).toEqual([1280, 582]);
    let blocks = 0; for (const c of kids.filter(k => k.id === 0x1f43b675)) blocks += readEbml(buf, c.start, c.end).filter(e => e.id === 0xa3).length;
    expect(blocks).toBe(50);
    const cues = readEbml(buf, kids[5].start, kids[5].end); expect(cues.length).toBe(3);
    for (const cue of cues) { const pos = readEbml(buf, readEbml(buf, cue.start, cue.end)[1].start, readEbml(buf, cue.start, cue.end)[1].end); const off = buf.slice(pos[1].start, pos[1].end).reduce((a, b) => a * 256 + b, 0); expect(buf[seg.start + off]).toBe(0x1f); }   // points at a Cluster ID
  });
});

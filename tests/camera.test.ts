import { describe, expect, it } from 'vitest';
import { CameraController, buildConstraintAttempts, defaultFacing, describeCameraError, shouldFallBack, snapshotSize, type MediaDevicesLike } from '../src/art/camera';

const err = (name: string) => Object.assign(new Error(name), { name });
function fakeStream() {
  const tracks = [0, 1].map(() => ({ stopped: 0, stop() { this.stopped++; } }));
  return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream };
}
/** mock mediaDevices: `plan` decides per call whether getUserMedia resolves or rejects */
function mockDevices(plan: (c: MediaStreamConstraints, n: number) => Error | null, devices: Partial<MediaDeviceInfo>[] = []) {
  const calls: MediaStreamConstraints[] = []; const streams: ReturnType<typeof fakeStream>[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const md: MediaDevicesLike = {
    async getUserMedia(c) { calls.push(c); const e = plan(c, calls.length); if (e) throw e; const f = fakeStream(); streams.push(f); return f.stream; },
    async enumerateDevices() { return devices as MediaDeviceInfo[]; },
    addEventListener(t, fn) { (listeners[t] ??= []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] ?? []).filter(x => x !== fn); },
  };
  return { md, calls, streams, listeners };
}

describe('constraint building', () => {
  it('rear/front toggle: facingMode exact, then ideal, then any camera', () => {
    const a = buildConstraintAttempts({ facing: 'environment' });
    expect(a.map(c => JSON.stringify((c.video as MediaTrackConstraints).facingMode ?? 'any'))).toEqual(['{"exact":"environment"}', '{"ideal":"environment"}', '"any"']);
    expect(buildConstraintAttempts({ facing: 'user' })[0]).toEqual({ video: { facingMode: { exact: 'user' } }, audio: false });
    expect(buildConstraintAttempts({ facing: 'any' })).toEqual([{ video: true, audio: false }]);
  });
  it('a chosen device is tried first (exact deviceId), then the facing fallbacks; never audio', () => {
    const a = buildConstraintAttempts({ deviceId: 'cam-2', facing: 'user', idealWidth: 1920, idealHeight: 1080 });
    expect((a[0].video as MediaTrackConstraints).deviceId).toEqual({ exact: 'cam-2' });
    expect((a[0].video as MediaTrackConstraints).width).toEqual({ ideal: 1920 });
    expect(a.length).toBe(4); a.forEach(c => expect(c.audio).toBe(false));
  });
  it('default facing: rear on phones/tablets, front on desktop', () => {
    expect(defaultFacing({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('environment');
    expect(defaultFacing({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' })).toBe('environment');
    expect(defaultFacing({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', coarsePointer: false, maxTouchPoints: 0 })).toBe('user');
    expect(defaultFacing({ userAgent: 'Mozilla/5.0 (Macintosh)', coarsePointer: true, maxTouchPoints: 5 })).toBe('environment');
    expect(defaultFacing()).toBe('user');
  });
});

describe('controller: fallback order and cleanup', () => {
  it('uses the first constraint set that works and keeps the stream', async () => {
    const m = mockDevices(() => null); const cam = new CameraController(m.md);
    const s = await cam.start({ facing: 'environment' });
    expect(m.calls.length).toBe(1); expect(cam.active).toBe(s); expect(cam.lastUsed).toEqual(m.calls[0]);
  });
  it('exact facing fails (Overconstrained) -> ideal is tried; then any camera', async () => {
    const m = mockDevices((c, n) => (n < 3 ? err('OverconstrainedError') : null)); const cam = new CameraController(m.md);
    await cam.start({ facing: 'environment' });
    expect(m.calls.map(c => JSON.stringify((c.video as MediaTrackConstraints).facingMode ?? 'any'))).toEqual(['{"exact":"environment"}', '{"ideal":"environment"}', '"any"']);
    expect(cam.lastUsed).toEqual({ video: true, audio: false });
  });
  it('exact device missing (NotFound) falls back; permission denied and in-use do NOT fall back', async () => {
    const nf = mockDevices((c, n) => (n === 1 ? err('NotFoundError') : null)); await new CameraController(nf.md).start({ deviceId: 'gone', facing: 'user' });
    expect(nf.calls.length).toBe(2);
    for (const name of ['NotAllowedError', 'NotReadableError']) {
      const m = mockDevices(() => err(name)); const cam = new CameraController(m.md);
      await expect(cam.start({ facing: 'user' })).rejects.toMatchObject({ code: name === 'NotAllowedError' ? 'denied' : 'in-use' });
      expect(m.calls.length).toBe(1); expect(cam.active).toBeNull();
    }
  });
  it('stop() stops all tracks; restarting stops the previous stream first; double stop is safe', async () => {
    const m = mockDevices(() => null); const cam = new CameraController(m.md);
    await cam.start({ facing: 'user' }); const first = m.streams[0];
    await cam.start({ facing: 'user' });
    first.tracks.forEach(t => expect(t.stopped).toBe(1));
    cam.stop(); cam.stop();
    m.streams[1].tracks.forEach(t => expect(t.stopped).toBe(1)); expect(cam.active).toBeNull();
  });
  it('error messages: permission denied, no camera, in use, insecure context, unsupported', async () => {
    expect(describeCameraError(err('NotAllowedError')).code).toBe('denied');
    expect(describeCameraError(err('NotFoundError')).message).toMatch(/No camera/);
    expect(describeCameraError(err('NotReadableError')).message).toMatch(/in use/);
    expect(describeCameraError(err('X'), false)).toMatchObject({ code: 'insecure' });
    expect(describeCameraError(err('X'), false).message).toMatch(/HTTPS/);
    const insecure = new CameraController(mockDevices(() => null).md, false); expect(insecure.available).toBe(false);
    await expect(insecure.start({ facing: 'user' })).rejects.toMatchObject({ code: 'insecure' });
    await expect(new CameraController(undefined).start({ facing: 'user' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(shouldFallBack(err('OverconstrainedError'))).toBe(true); expect(shouldFallBack(err('NotAllowedError'))).toBe(false);
  });
  it('device list: only video inputs, placeholder labels before permission, refresh on devicechange, unsubscribe works', async () => {
    const m = mockDevices(() => null, [{ kind: 'videoinput', deviceId: 'a', label: '' }, { kind: 'audioinput', deviceId: 'm', label: 'Mic' }, { kind: 'videoinput', deviceId: 'b', label: 'Back camera' }]);
    const cam = new CameraController(m.md);
    expect(await cam.devices()).toEqual([{ deviceId: 'a', label: 'Camera 1' }, { deviceId: 'b', label: 'Back camera' }]);
    let n = 0; const off = cam.onDeviceChange(() => n++); m.listeners.devicechange.forEach(f => f()); expect(n).toBe(1);
    off(); expect(m.listeners.devicechange.length).toBe(0);
    expect(await new CameraController(undefined).devices()).toEqual([]);
  });
});

describe('snapshot size', () => {
  it('uses the same max-side downscale as loaded images and never upscales', () => {
    expect(snapshotSize(1920, 1080, 4096)).toEqual({ width: 1920, height: 1080 });
    expect(snapshotSize(8000, 6000, 4096)).toEqual({ width: 4096, height: 3072 });
    expect(snapshotSize(1080, 1920, 1000)).toEqual({ width: 563, height: 1000 }); // portrait phone frame stays portrait
  });
});

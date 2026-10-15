// Camera input for the artwork: constraint building, error mapping and a small controller that always stops its tracks.
// Pure/injectable so it can be unit-tested with a mocked navigator.mediaDevices. Nothing here sends data anywhere.

export type Facing = 'user' | 'environment';

export interface CameraOptions {
  deviceId?: string | null;    // a specific camera chosen from the list (wins over facing)
  facing: Facing | 'any';
  idealWidth?: number;
  idealHeight?: number;
}

/** Default facing: rear camera on phones/tablets (touch + coarse pointer), front camera on desktops. */
export function defaultFacing(env: { userAgent?: string; coarsePointer?: boolean; maxTouchPoints?: number } = {}): Facing {
  const ua = env.userAgent ?? '';
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const touchCoarse = !!env.coarsePointer && (env.maxTouchPoints ?? 0) > 0;
  return mobileUa || touchCoarse ? 'environment' : 'user';
}

/**
 * Constraint sets to try, in order. A chosen device is tried exactly first; otherwise the facing mode is tried as
 * `exact`, then `ideal`, then any camera. Permission/in-use errors never fall through (see shouldFallBack).
 */
export function buildConstraintAttempts(o: CameraOptions): MediaStreamConstraints[] {
  const size: MediaTrackConstraints = {};
  if (o.idealWidth) size.width = { ideal: o.idealWidth };
  if (o.idealHeight) size.height = { ideal: o.idealHeight };
  const out: MediaStreamConstraints[] = [];
  if (o.deviceId) out.push({ video: { ...size, deviceId: { exact: o.deviceId } }, audio: false });
  if (o.facing !== 'any') {
    out.push({ video: { ...size, facingMode: { exact: o.facing } }, audio: false });
    out.push({ video: { ...size, facingMode: { ideal: o.facing } }, audio: false });
  }
  out.push({ video: Object.keys(size).length ? size : true, audio: false });
  return out;
}

export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'no-camera' | 'in-use' | 'constraints' | 'unknown';
export interface CameraError { code: CameraErrorCode; message: string }

export function describeCameraError(e: unknown, secure = true): CameraError {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (!secure) return { code: 'insecure', message: 'The camera needs a secure context: open this page over HTTPS (or http://localhost), e.g. with `npm run dev:https`.' };
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError':
      return { code: 'denied', message: 'Camera permission was denied. Allow camera access for this site in the browser settings and try again.' };
    case 'NotFoundError': case 'DevicesNotFoundError':
      return { code: 'no-camera', message: 'No camera was found on this device.' };
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      return { code: 'in-use', message: 'The camera could not be started: it is probably in use by another application or tab.' };
    case 'OverconstrainedError': case 'ConstraintNotSatisfiedError':
      return { code: 'constraints', message: 'No camera satisfies the requested settings.' };
    case 'TypeError':
      return { code: 'unsupported', message: 'This browser does not support camera access (getUserMedia).' };
    default:
      return { code: 'unknown', message: `Camera error: ${(e as Error)?.message ?? String(e)}` };
  }
}

/** Only "this exact request cannot be met" errors justify trying a looser request. */
export function shouldFallBack(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? '';
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'NotFoundError' || name === 'DevicesNotFoundError';
}

export interface MediaDevicesLike {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  addEventListener?(type: string, fn: () => void): void;
  removeEventListener?(type: string, fn: () => void): void;
}

export interface CameraDevice { deviceId: string; label: string }

export class CameraController {
  private stream: MediaStream | null = null;
  /** constraint sets tried by the last start() (for diagnostics/tests) */
  lastAttempts: MediaStreamConstraints[] = [];
  lastUsed: MediaStreamConstraints | null = null;

  constructor(private md: MediaDevicesLike | undefined, private secure: boolean = true) {}

  get active(): MediaStream | null { return this.stream; }
  get available(): boolean { return !!this.md && this.secure; }

  /** Start (or restart) the camera. Stops any running stream first; stops partial streams on failure. */
  async start(o: CameraOptions): Promise<MediaStream> {
    this.stop();
    if (!this.secure) throw describeCameraError(null, false);
    if (!this.md?.getUserMedia) throw { code: 'unsupported', message: 'This browser does not support camera access (getUserMedia).' } satisfies CameraError;
    const attempts = buildConstraintAttempts(o);
    this.lastAttempts = attempts;
    let lastErr: unknown = null;
    for (const c of attempts) {
      try {
        const s = await this.md.getUserMedia(c);
        this.stream = s; this.lastUsed = c;
        return s;
      } catch (e) {
        lastErr = e;
        if (!shouldFallBack(e)) break;      // denied / in use / unknown: looser constraints will not help
      }
    }
    throw describeCameraError(lastErr, this.secure);
  }

  /** Stop every track and forget the stream. Safe to call repeatedly. */
  stop() {
    const s = this.stream; this.stream = null;
    s?.getTracks().forEach(t => { try { t.stop(); } catch { /* already stopped */ } });
  }

  /** Cameras known to the browser. Labels are empty until permission has been granted; call again after a grant. */
  async devices(): Promise<CameraDevice[]> {
    if (!this.md?.enumerateDevices) return [];
    const all = await this.md.enumerateDevices();
    return all.filter(d => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  /** Refresh callback on hot-plug (devicechange). Returns an unsubscribe function. */
  onDeviceChange(fn: () => void): () => void {
    this.md?.addEventListener?.('devicechange', fn);
    return () => this.md?.removeEventListener?.('devicechange', fn);
  }
}

export interface SnapshotOptions { maxSide: number; mirror: boolean }

/** Pixel size of a snapshot after the same max-size rule as loaded images (never upscaled, aspect kept). */
export function snapshotSize(videoW: number, videoH: number, maxSide: number): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(videoW, videoH, 1));
  return { width: Math.max(1, Math.round(videoW * k)), height: Math.max(1, Math.round(videoH * k)) };
}

/** Grab the current video frame as a PNG File. The video element is already upright (browsers apply the sensor rotation). */
export async function takeSnapshot(video: HTMLVideoElement, o: SnapshotOptions, name = `camera-snapshot-${Date.now()}.png`): Promise<File> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The camera has no picture yet.');
  const { width, height } = snapshotSize(video.videoWidth, video.videoHeight, o.maxSide);
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const x = c.getContext('2d')!;
  if (o.mirror) { x.translate(width, 0); x.scale(-1, 1); }
  x.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode the snapshot'))), 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

# STAR GATE

Digital recreation of the slit-scan "Star Gate" tunnel from *2001: A Space Odyssey* (1968): a physical model of the
slit mask, back-lit artwork and advancing camera, integrated per pixel in a WebGL2 shader. Scope is the tunnel only;
see `docs/design.md` (model, parameters) and `docs/research-stargate.md` (sources and uncertainties).

It is a **static web app**: `npm run build` produces plain files (`dist/`) that any static host can serve, from the site root or
from a sub-path, on desktop and phone. There is no backend; everything is computed on your device and nothing is uploaded.

## Features
- **Slit-scan renderer**: per-pixel integration of the camera's exposure through the slit (no gaps between substeps);
  double exposure = two mirrored slits forming a left and a right wall with a central gap.
- **Orientation**: `left-right` (default: vertical slit, walls left/right, vertical gap) or `top-bottom` (the same tunnel
  turned 90°: walls above/below, horizontal gap). Exactly one is active; all parameters, playback and export work in both.
- **Centre gap — fixed at 0.005** (user decision): the central unexposed gap is 0.5% of the frame width (height in top-bottom),
  about 3 px at 1280. The slider is shown but locked, every preset and any loaded params JSON use 0.005. The two walls are
  rescaled horizontally between the gap edge and the frame edge, so their look, brightness and flow direction are those of the
  physical render; the model's own (natural) gap is ≈ 0.109. The mapping code (`gapMap`, `gapBlend`, snap below 0.005, cross-fade
  at 0) is kept and tested but not user-adjustable.
- **Straight inner wall edges** (`slit.extendEnds`, on by default): a physical 6 ft slit and an 8 ft back panel both *end* inside
  the view when the camera is far away, which cut a slanted notch (a kink) into each wall's inner edge next to the central gap
  (≈ 44 px at 1280×582, on ~225 rows at the top and bottom). With the option on, the slit and panel are treated as larger than any
  view (the art mirrors beyond the panel edge), so the inner edges are straight vertical lines from top to bottom and the streaks
  stay straight lines converging on the vanishing point. Untick it (or use `Trumbull-Strict` / `Variant-A`) for the finite,
  research-faithful ends. At gap 0 the two walls meet along the centre line and are cross-faded over ±1% of the frame width, so
  no hard seam line is drawn.
- **Animation and playback**: Play/Pause, frame scrubber, `art.scrollPerFrame` with an accel curve (linear / ease-in /
  exponential). Each wall's artwork flows away from the central gap (`mirror slide`; untick for the old same-direction slide).
  Playback uses `exposure.previewSamples`; paused frames use `exposure.samples`.
- **Artwork**: five procedural generators: `noise` (default), `crystal`, `circuit`, `bands`, `facets`; or `image`: your own
  PNG/JPEG/WebP files (see below).
- **Image artwork** (`kind: image`): choose files (several allowed, max 8) with the picker in *Image artwork* or drag-and-drop
  them anywhere on the page; nothing is uploaded, the files stay in the browser. They are placed on the back-lit panel like the
  procedural art, so slit integration, orientation, centre gap, playback, colour separation and export apply unchanged.
  - *mode*: `single` (pick with `image.index`), `sequence` (images laid end to end along the scroll direction), `crossfade`
    (smooth blend between images along the scroll direction, wrapping around the panel).
  - *fit*: `fill` (covers the panel), `fit` (whole image, dark margins), `tile` (image at panel height, repeated).
  - *wrap* along the scroll: `mirror` (always continuous) or `repeat` (tile seams are hidden by a cross-fade of width
    `image.seamBlend`), so playback never shows a seam.
  - `image.scale / offsetX / offsetY / rotation` place the image; `image.contrast / saturation` are optional pre-adjusts (neutral = 1).
  - **Sample images**: the *sample image* dropdown (or the thumbnails below it) loads one of 8 bundled pictures instantly:
    flower, coral, architecture, circuit, cells, marbling, painting, stripes (1536×768, seamless along the scroll axis, ~6.5 MB total
    in `public/samples/`, served by the dev server and copied into the build). `my own images…` opens the file picker. A project
    stores only the sample id (`image.sample`), so samples never raise a missing-image warning and are reloaded automatically.
    They are produced by `npm run samples` (`node scripts/make-samples.mjs`): deterministic (fixed seeds), no third-party content,
    no network; `SAMPLE_W` / `SAMPLE_H` change the size.
  - Images are decoded as sRGB (hardware sRGB texture, linear light inside), downscaled to at most 4096 px on the long side.
  - The params JSON stores only each file's name, size and a content hash. After loading a project JSON (*Load params JSON*) without
    the images, the panel shows a **missing image** warning, and **export refuses to start** until the same files are loaded.
    The export uses the very same composed texture as the preview (it does not depend on the output resolution).
- **Output saturation** (`saturation (output)`, 0–2, default 1 = unchanged): final luma-preserving (Rec.709) saturation of the
  rendered tunnel, applied after colour separation and with it off, for procedural and image art, both orientations, preview and
  export. Boosts are limited to the colour gamut so nothing clips. (Not to be confused with `image saturation`, the optional
  per-image pre-adjust.)
- **Colour separation** (off by default): R/G/B strips with high/low-contrast curves, CMY filter tints and three seeded
  "random wheels" that change smoothly or stepwise over time. Strip list and mix formula are configurable (JSON box).
  `wheel style: vivid`, `low curve: gamma`, `saturation` give a more saturated grade.
- **Presets**: `Two-Wall-Classic` (default), `Two-Wall-Top-Bottom`, `Trumbull-Strict` (research values), `Variant-A`,
  `Vivid-Bands (optional)`, `Free`.
- **Export** in the browser: ZIP of PNG frames, PNG files in a folder, or a WebM video; progress, cancel, resume by frame range.

## Run (development)
```sh
npm install
npm run dev          # http://127.0.0.1:5173
npm run dev:https    # HTTPS with a self-signed certificate on your LAN address, for testing the camera on a phone (see below)
```
Only controls with a clearly visible effect are shown in the panel (a bottom sheet on narrow screens): *Look* (`exposure.gain`, `panel.distance`, `camera.fovY`), *Animation*, *Artwork*, *Colour separation* (`saturation (output)`, plus the wheel period once separation is on) and, in image mode, the image placement sliders. All other parameters keep their preset values and are still saved/loaded in the params JSON (ranges: `docs/design.md` §4).

## Test / build / preview
```sh
npm test             # vitest: geometry, orientation, colour, samples, camera constraints, ZIP/WebM writers, storage, service worker
npm run build        # typecheck + production bundle in dist/ (relative URLs, service worker, CSP meta)
npm run preview      # builds, then serves dist/ at http://127.0.0.1:4173
```
The build works from any sub-path (all URLs are relative, `base: './'`), e.g. `https://example.com/apps/stargate/`.

## Hosting (static files only)
Upload `dist/` anywhere that serves static files over **HTTPS** (HTTPS is required for the camera and the offline service worker).
Nothing else to configure. Ready-made config, nothing is deployed for you:
- **GitHub Pages**: `.github/workflows/pages.yml` builds, tests and publishes `dist/` when pushed to `main` (set Settings → Pages → Source: *GitHub Actions*).
- **Netlify / Cloudflare Pages**: build command `npm run build`, publish directory `dist`. `public/_headers` (copied into `dist/`) adds the CSP and cache headers below.
- **Any other host**: copy `dist/`. Serve `index.html`, `sw.js` and `manifest.webmanifest` with `Cache-Control: no-cache` and `assets/*` as immutable if you can; the app also works without these headers.

### Privacy and security
- All processing is local (WebGL on your GPU). There is **no analytics and no external request at runtime**: the build contains no
  `http(s)://` URL that is fetched (the only matches are the text `http://localhost` in a camera help message). The camera stream and
  snapshots, loaded images and exports never leave the device.
- The production page carries this **Content-Security-Policy** (as a `<meta>`; send it as a response header too if your host allows):
  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'
  ```
  (`'unsafe-inline'` is only for style attributes set by the UI code.) Suggested extra header: `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.
- The camera needs a secure context: HTTPS (or `http://localhost`). The page never asks for the microphone.

## Phone and PWA
- **Layout**: below 820 px width the panel is a bottom sheet (tap *Controls*), safe-area insets are respected, touch targets are enlarged on
  coarse pointers, and `prefers-reduced-motion` turns UI animation off. Checked at 390 px width: no horizontal overflow.
- **Low-power / preview quality** (panel section *App*): `auto` keeps playback near 30 fps by scaling the preview resolution
  (never below 240 px high), or pick 720/540/360 p; *low-power mode* uses fewer samples (16 while playing, ≤ 64 idle). Phones start in
  low-power mode. Only the preview is affected: **exports always use the full settings**.
- **Install / offline**: a web app manifest, generated icons (`npm run icons`) and a service worker (production builds only). The worker precaches the
  app shell and the bundled samples under a cache name derived from the build's file contents, deletes old caches on activation, and loads
  pages network-first so a new deployment is picked up at once (the cached shell is only the offline fallback).
- **Settings** are remembered in `localStorage` (versioned, validated; broken or foreign data is ignored). *Reset to defaults*, *Download params JSON*
  and *Import params JSON…* are in the *App* section. Loaded images (not bundled samples) cannot be remembered.
- **Robustness**: float render targets fall back to half-float; if WebGL2 is missing a plain explanation is shown; a lost WebGL context is rebuilt
  automatically (images are re-uploaded); resize / DPR changes redraw.

### Using the camera on a phone during development
`getUserMedia` only works over HTTPS (or localhost), so a phone opening `http://<computer-ip>:5173` is blocked.
1. Phone and computer on the same Wi-Fi. Run `npm run dev:https` (needs the `openssl` command; it creates `.certs/` with a 30-day self-signed certificate that lists your LAN addresses and prints the URL).
2. On the phone open `https://<computer-ip>:5173`. The browser warns about the certificate (it is self-signed): choose *Advanced → continue* (Android Chrome) or *Show details → visit this website* (iOS Safari). If your LAN address changes, run `node scripts/dev-cert.mjs --force`.
3. Artwork → *sample image* → *camera snapshot…* → *Start camera*, allow the permission, *Take snapshot*.
A deployed copy on an HTTPS host needs none of this.

## Camera snapshot as artwork
*sample image → camera snapshot…* opens a live preview. *front (user)* / *rear (environment)* choose the camera (rear by default on phones,
front on desktop; if `exact` facing is not supported it falls back to `ideal`, then to any camera); the dropdown lists the cameras (names appear
once permission is granted and refresh when a camera is plugged in); *mirror front camera* affects the preview only, *mirror snapshot* the saved picture.
*Take snapshot* freezes the preview and uses the frame as `image` artwork (same pipeline as any image: scale/offset/rotation, wrap, colour
separation, orientation, playback, export; downscaled to the same maximum size). *Retake* resumes the preview, *Close camera* stops every track (also on page hide/unload).
Errors are explained (permission denied, no camera, camera in use, insecure context). A snapshot is **not stored in the params JSON**: use *Download snapshot PNG* and load
it again via *my own images* to reproduce a project. EXIF orientation of loaded photos is honoured.

## Export (in the browser)
**Export** section: *ZIP of PNG frames* (downloads, split into parts), *PNG files in a folder* (File System Access API, resumable) or *WebM video*
(WebCodecs, when the browser supports it). Name, height (e.g. 582 = 1280×582), fps, start frame and count select the range; frames are numbered
`start+1…` so ranges can be rendered in several runs. ZIP parts contain `meta.json` and `encode.sh`; unzip them into one folder and run
`sh encode.sh` (ffmpeg) for ProRes/H.264. Details and the ffmpeg commands: `docs/export.md`. The export length is capped at `art.frames` (240 by default) minus the start frame.

## Samples (`docs/samples/`)
- `m3-frame-1/24/48.png`: default preset, frames 0, 23 and 47 at 1280×582. **Regenerated after the flow-direction fix**
  (left wall now flows outward; the straight-edge fix; and the fixed 0.005 centre gap, which narrows the dark gap to ≈3 px), so they match the preview.
- `orientation-left-right.png`, `orientation-top-bottom.png`: frame 23 of each orientation.
- `kink-*-before-after.png`: crops (top = before the straight-edge fix, bottom = after) of the inner wall edge at the top/bottom of the default frame and at gap 0.
- `saturation-0.png`, `saturation-1.png`, `saturation-2.png`: output saturation 0 / 1 (= default, identical to `m3-frame-24.png`) / 2.
- `sample-images-contact-sheet.png`: the 8 bundled sample pictures; `sample-*-tunnel.png`, `sample-painting-top-bottom.png`: tunnels made from some of them (scale 0.4, frame 23).
- `image-art-left-right.png`, `image-art-top-bottom.png`: frame 23 with a synthetic test image (generated gradient, circles and lines; no third-party picture), `image.scale` 0.5.
- `default-left-right-4s.mp4`: 96 frames / 4 s at 24 fps exported from the default preset and encoded with `encode.sh`.

## Troubleshooting
- **"Cannot start" / blank picture**: the browser or GPU lacks WebGL2 or float render targets; use a current Chrome, Edge, Firefox or Safari with hardware acceleration.
- **Camera: "needs HTTPS"**: use `npm run dev:https` on a LAN, `http://localhost` on the same computer, or an HTTPS host.
- **Camera: permission denied / in use / not found**: allow the camera for the site in the browser settings, close other apps using it, or pick another camera in the list.
- **Offline mode does not start**: service workers need HTTPS (or localhost) and a production build (`npm run build`, not `npm run dev`). Reload once after the first visit.
- **I see an old version**: reload once more (the new service worker takes over on the next load) or clear the site data; caches are versioned per build.
- **ZIP parts / ffmpeg**: unzip all parts into one folder before running `encode.sh`; if ffmpeg is missing, `brew install ffmpeg`.
- **Folder export asks for access every time**: the File System Access API requires a user gesture each run; the files already in the folder are skipped.
- **"Missing image" / "Image mismatch" warning, export refused**: load the same image files the project was made with (names and contents are checked).
- **Samples missing in a build / 404 for `samples/…`**: run `npm run samples` to regenerate `public/samples/`.
- **Image art looks smooth / low detail**: the slit only sees a narrow strip of the panel, so lower `image.scale` (e.g. 0.3–0.5) to bring more of the picture into that strip.
- **Playback looks noisier or blockier than a paused frame**: playback uses `exposure.previewSamples` and (auto quality) a smaller resolution; pick *high* quality or pause.
- **Settings look wrong after an update**: *App → Reset to defaults*.

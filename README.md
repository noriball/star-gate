# STAR GATE

Digital recreation of the slit-scan "Star Gate" tunnel from *2001: A Space Odyssey* (1968): a physical model of the
slit mask, back-lit artwork and advancing camera, integrated per pixel in a WebGL2 shader. Scope is the tunnel only;
see `docs/design.md` (model, parameters) and `docs/research-stargate.md` (sources and uncertainties).

## Features
- **Slit-scan renderer**: per-pixel integration of the camera's exposure through the slit (no gaps between substeps);
  double exposure = two mirrored slits forming a left and a right wall with a central gap.
- **Orientation**: `left-right` (default: vertical slit, walls left/right, vertical gap) or `top-bottom` (the same tunnel
  turned 90°: walls above/below, horizontal gap). Exactly one is active; all parameters, playback and export work in both.
- **Centre gap**: one control (`centreGap`, fraction of the frame width, or height in top-bottom) sets the visible width of the
  central unexposed gap directly, from the default 0.1093 down to 0 (walls meet along the centre line). It remaps each wall
  between the gap edge and the frame edge, so look, brightness and flow direction are unchanged. At the default value it is
  an exact identity; at 0 the two walls are different exposures, so a thin seam (bright inner edges meeting) is visible.
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
- **PNG-sequence export** with progress, cancel and resume, then ffmpeg encode.

## Run
```sh
npm install
npm run dev        # http://127.0.0.1:5173 (needs a WebGL2 browser with EXT_color_buffer_float)
```
Parameters are in the right-hand panel (ranges from `docs/design.md` §4).

## Test / build
```sh
npm test           # vitest: slit geometry vs analytic solution, gather coverage, orientation, scroll direction, colour wheels
npm run build      # typecheck + production bundle in dist/
```

## Export (dev server only)
Use the **Export** section of the panel: name, height (e.g. 582 = 1280×582, 2.2:1), fps, start frame, count.
Frames are written to `renders/<name>/frame_000001.png …` with `meta.json` and `encode.sh`. Cancel any time; export again
with the same name (overwrite off) to resume. Encode from that folder:
```sh
sh encode.sh       # ProRes 422 HQ .mov + H.264 .mp4 via ffmpeg
```
Details: `docs/export.md`. The export length is capped at `art.frames` (240 by default) minus the start frame.

## Samples (`docs/samples/`)
- `m3-frame-1/24/48.png`: default preset, frames 0, 23 and 47 at 1280×582. **Regenerated after the flow-direction fix**
  (left wall now flows outward), so they match the preview again; the earlier versions differed on the left half.
- `gap-default.png`, `gap-half.png`, `gap-zero.png`: centre gap 0.1093 (default), 0.0546 and 0, frame 23.
- `orientation-left-right.png`, `orientation-top-bottom.png`: frame 23 of each orientation.
- `saturation-0.png`, `saturation-1.png`, `saturation-2.png`: output saturation 0 / 1 (= default, identical to `m3-frame-24.png`) / 2.
- `sample-images-contact-sheet.png`: the 8 bundled sample pictures; `sample-*-tunnel.png`, `sample-painting-top-bottom.png`: tunnels made from some of them (scale 0.4, frame 23).
- `image-art-left-right.png`, `image-art-top-bottom.png`: frame 23 with a synthetic test image (generated gradient, circles and lines; no third-party picture), `image.scale` 0.5.
- `default-left-right-4s.mp4`: 96 frames / 4 s at 24 fps exported from the default preset and encoded with `encode.sh`.

## Troubleshooting
- **Blank page / "EXT_color_buffer_float required"**: the browser or GPU lacks float render targets; use a recent
  Chrome/Edge/Safari with hardware acceleration on.
- **Black preview after pulling changes**: restart `npm run dev`; Vite does not always reload `vite.config.ts` changes
  (the export endpoint lives there).
- **Export says HTTP 404 / does nothing**: export only works against the dev server (`npm run dev`), not a built bundle.
- **ffmpeg not found**: install it (`brew install ffmpeg`) and run `sh encode.sh` again; the PNG frames are kept.
- **Resume re-renders everything**: check *overwrite* is unticked and the name is unchanged.
- **Export capped / fewer frames than expected**: count is limited by `art.frames − start frame`; raise `art.frames`.
- **"Missing image" / "Image mismatch" warning, export refused**: load the same image files the project was made with (names and contents are checked).
- **Samples missing in a build / 404 for `/samples/…`**: run `npm run samples` to regenerate `public/samples/`.
- **Image art looks smooth / low detail**: the slit only sees a narrow strip of the panel, so lower `image.scale` (e.g. 0.3–0.5) to bring more of the picture into that strip.
- **Playback looks noisier than a paused frame**: playback uses `exposure.previewSamples`; raise it, or pause for a clean frame.
- **Frames from older exports look different on the left wall**: they predate the flow-direction fix; re-export.

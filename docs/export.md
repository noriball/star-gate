# Export (M3)
Dev server only (`npm run dev`): the panel's **Export** section renders frames offline at the chosen height
(width = height × 2.2) with `exposure.samples` substeps and POSTs each PNG to `/__export/<name>/`,
which the Vite plugin writes to `renders/<name>/frame_000001.png …` (plus `meta.json`, `encode.sh`).
- **Cancel**: stops after the current frame; finished frames stay on disk.
- **Resume**: press Export again with the same name and *overwrite* unchecked; existing frames are skipped.
  Jitter is seeded per frame, so resumed output matches an uninterrupted run.
- Frame count is capped at `art.frames − start frame`.

Encode (also written to `renders/<name>/encode.sh`; run from that folder):
```sh
ffmpeg -framerate 24 -i frame_%06d.png -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le out_prores.mov
ffmpeg -framerate 24 -i frame_%06d.png -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart out_h264.mp4
```

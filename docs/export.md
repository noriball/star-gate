# Export (in the browser, no server)
The **Export** section of the panel renders a frame range with the exact preview pipeline (same texture, same shader) at the chosen height
(width = height × 2.2) and `exposure.samples`, and hands the result over in one of three ways:

| format | needs | result |
|---|---|---|
| ZIP of PNG frames | any browser | one or more `…_frames_000001-000120.zip` downloads (a new part starts when `zip part (MB)` is reached, so long or 4K sequences never need one huge file in memory); every zip is self-contained and also gets `meta.json` + `encode.sh` in the last part |
| PNG files in a folder | File System Access API (Chrome/Edge desktop) | frames written into a folder you choose; frames already there are skipped, so running again resumes |
| WebM video | WebCodecs `VideoEncoder` with VP9/VP8 (Chrome/Edge/recent Safari) | `name.webm` encoded in the browser (about 8 Mbit/s at 1280×582) |

Frames are numbered `start frame + 1`, `+ 2`, …; to continue an interrupted export set `start frame` to the number of the last frame you have.
Cancelling a ZIP export keeps the frames already rendered (the open part is downloaded) and tells you which start frame to resume from.

## Encoding the ZIP route
Unzip all parts into **one** folder and run `encode.sh` from it (or the commands below; replace the numbers with your fps and first frame):
```sh
ffmpeg -framerate 24 -start_number 1 -i frame_%06d.png -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le out_prores.mov
ffmpeg -framerate 24 -start_number 1 -i frame_%06d.png -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart out_h264.mp4
```

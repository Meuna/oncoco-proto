# Custom OpenCV.js build

The app currently loads the prebuilt `opencv.js` from `@techstark/opencv-js` (~10 MB, every
module, wasm embedded as base64). This folder holds a recipe for a much smaller build with only
`core` + `imgproc` and the functions listed in `opencv_js.config.py`. **It has not been run yet.**

## Build

```sh
scripts/opencv/build.sh   # OPENCV_VERSION / EMSDK_VERSION / WORK can be overridden
```

It clones emsdk and OpenCV into `~/.cache/oncoco-opencv`, then writes `vendor/opencv/opencv.js`.
It keeps OpenCV's default single-file output (wasm embedded), so the file is a drop-in
replacement for the npm one.

## Swap it in

In `src/algorithms/lib/opencv.ts`, replace the URL import:

```ts
import opencvUrl from '../../../vendor/opencv/opencv.js?url';
```

Keep the file name `opencv*.js` so `workbox.globIgnores` in `vite.config.ts` still excludes it
from the precache. Files under 100 MB can be committed; the npm package can then be removed.

## Notes

- If a function is missing at runtime (`cv.xxx is not a function`), add it to the whitelist.
  The TypeScript types still come from `@techstark/opencv-js` and describe the full API.
- Not every C++ method is bound even in the full build (e.g. `Mat.release`).
- A separate `.wasm` file (`--disable_single_file`) would be ~25% smaller over the wire, but the
  loader evaluates the script from a string, so Emscripten can't locate the wasm by itself: the
  wrapper's `locateFile` would have to be patched.

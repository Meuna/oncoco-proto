# CLAUDE.md

## 1. Project summary
- Static PWA (Vite + TypeScript, no UI framework). It shows the rear camera full-screen and draws the output of the selected CV algorithm on an overlay canvas, with a toggleable perf overlay.
- Algorithms are hot-swappable from a `<select>`. All computation runs in one module Worker. Deployed to GitHub Pages at `/oncoco-proto/`.

## 2. Dev environment & commands
- Dev container: `.devcontainer/devcontainer.json` uses image `typescript-node:24` and forwards port 5173. CI also uses Node 24.
- **npm only** (the lockfile is `package-lock.json`). Don't use Bun, pnpm or yarn.
- `npm run dev`: Vite dev server on `localhost:5173`. `npm run dev:host`: also listens on the LAN, but the camera requires HTTPS, so see the README for tunnel/USB/mkcert options.
- `npm run build`: runs `tsc` and then `vite build` into `dist/`. `npm run preview`: serves the build (`--host`). The service worker is active only in the build or preview, never in dev.
- `npm run typecheck`: runs `tsc` (`noEmit`). There is **no `test` or `lint` script**.
- `npm run gen:icons`: regenerates the placeholder PNG icons into `public/icons/` (`scripts/gen-icons.mjs`).
- `scripts/opencv/build.sh`: recipe for a minimal custom OpenCV.js build (core + imgproc whitelist). Documented in `scripts/opencv/README.md`, not run yet.
- Deploy: `.github/workflows/pages.yml` runs on push to `main` or manually: `npm ci`, `npm run build`, then uploads `dist/` and deploys it to Pages.
- Base path: `REPO_BASE = '/oncoco-proto/'` in `vite.config.ts`, applied only for `build` (dev uses `/`). Build runtime asset URLs from `import.meta.env.BASE_URL`.

## 3. Architecture
- Camera (`src/core/camera.ts`): `facingMode: { ideal: 'environment' }`, `width: { ideal: 1280 }`, no audio. It must be called from a user gesture (the start button), and errors are typed as `CameraError`.
- Loop (`src/core/loop.ts`): only one frame is in flight at a time, and frames that arrive meanwhile are skipped. The overlay canvas is sized as CSS size × `min(devicePixelRatio, MAX_DPR=2)`.
- Switching (`src/core/algoHost.ts`): a `generation` counter discards stale loads and results. The worker waits for an in-flight `process`, then calls `dispose`. The choice is saved in `localStorage['oncoco.algo']`.
- Protocol: `src/core/workerProtocol.ts` (`load`/`setParams`/`process` in, `progress`/`ready`/`loadError`/`result`/`processError` out).
- Wiring and perf panel text: `src/main.ts`. DOM: `src/ui/dom.ts`.

## 4. Algorithm contract (`src/algorithms/types.ts`)
- `AlgorithmEntry<R>`, one per algorithm, exported from `src/algorithms/<name>.ts`:
  - `id: string` (kebab-case, also the saved localStorage value)
  - `label: string` (text shown in the dropdown)
  - `input?: 'imageData' | 'videoFrame' | 'none'` (default `'imageData'`)
  - `maxInputWidth?: number` (ImageData only: the core downscales to this width and keeps the aspect ratio)
  - `backend?: string` (display only, shown as `back` in the perf overlay: `'js-cpu'`, `'none'`…)
  - `createProcessor(): Processor<R> | Promise<Processor<R>>`: called **in the worker only**, by convention as `async () => new (await import('./x.processor')).XProcessor()`
  - `createRenderer(): Renderer<R>`: called on the main thread once the processor is ready
- `Processor<R>` (worker, no DOM):
  - `init({ signal, onProgress }): Promise<void>`: `signal` aborts when the user switches away. `onProgress(p∈[0,1]|null, msg?)` drives the loader UI.
  - `process(frame: FrameInput, t: number): R | Promise<R>`, where `FrameInput = ImageData | VideoFrame | null`. The worker closes a `VideoFrame` after `process`.
  - `transferables?(result): Transferable[]`: these buffers are moved, not copied, so allocate fresh ones every frame.
  - `dispose(): void`
- `Renderer<R>` (main thread): `draw(result, ctx, map: CoordMapper)` and an optional `dispose()`. The canvas is cleared and `ctx` is saved and restored around `draw`.
  - `CoordMapper` handles the `object-fit: cover` crop. Use `toScreen(x,y)` with `scale` for lengths and `dpr` for constant line widths, or call `applyTransform(ctx)` and draw in source pixels.
- `R` must be structured-cloneable (plain objects, typed arrays, `ImageData`…, no classes with methods).
- Registration: add the entry to the `algorithms` array in `src/algorithms/registry.ts`. Array order is dropdown order, and the first entry is the default.
- Parameters (opt-in):
  - Declare `params?: ParamSpec[]` on the entry (`{ type: 'range', min, max, step, default }` or `{ type: 'toggle', default }`). The UI shows a `⚙` button and panel only for algorithms that have params.
  - The processor implements `setParams?(values)`. The worker calls it after `init`, before the first `process`, then on every change, always with the full set of values. Read the values with `typeof` guards.
  - Values are validated against the specs (ranges are clamped) and saved per algorithm in `localStorage['oncoco.params.<id>']` (`AlgoHost.setParam`).
  - Params reach the processor only, not the renderer: encode display options in the result (see Canny's overlay toggle).
  - Other tunables stay module-level `const`s in the processor (see `houghCircles.processor.ts`).
- Perf: no algorithm-side reporting is required. The worker measures the `process` duration (`proc`) and the loop measures capture→result (`rtt`), as 30-frame moving averages (`src/core/perf.ts`). Optional `stageTimings?()` returns per-stage ms of the last `process` (insertion order = display order), shown as extra lines in the perf panel.
- References:
  - Pixel output: `src/algorithms/sobel.ts` + `sobel.processor.ts`. Returns a new `ImageData`, transfers its buffer, and draws via an offscreen canvas and `applyTransform`.
  - Vector output: `src/algorithms/houghCircles.ts` + `houghCircles.processor.ts`. Returns `Circle[]` and draws with `toScreen`/`scale`/`dpr`.
  - Baseline: `src/algorithms/passthrough.ts` (`input: 'none'`, inline object processor).
  - Params + stage timings: `src/algorithms/canny.ts` + `canny.processor.ts` (640 px, σ/low/high sliders, overlay toggle).
  - OpenCV.js: `src/algorithms/houghCirclesOpencv.ts` + `houghCirclesOpencv.processor.ts` (480 px, `cv.HoughCircles`, 6 sliders, `backend: 'wasm'`).
  - OpenCV.js contours: `src/algorithms/ellipseFit.ts` + `ellipseFit.processor.ts` (Canny → `findContours` → `fitEllipse`, `MatVector`, per-contour `get(i)` deleted in `finally`).

## 5. Adding a new algorithm: checklist
1. `src/algorithms/<camelName>.processor.ts`: export `class <Pascal>Processor implements Processor<R>`, and export the result type (`R`) from this file.
   - With ImageData input, call `assertImageData(frame, ID)` first.
   - Keep work buffers in fields and reallocate them only when the size changes (`Buffers.ensure(w, h)`). Allocate a new object for anything you transfer.
2. `src/algorithms/<camelName>.ts`: a `class <Pascal>Renderer implements Renderer<R>` plus `export const <camelName>: AlgorithmEntry<R>`. Use `import type` for the processor's result type so its code stays out of the main bundle.
3. Add the entry to `src/algorithms/registry.ts`.
4. Reuse `src/algorithms/lib/imageOps.ts`, don't duplicate it:
   - `toGray` (RGBA → `Uint8Array`, BT.601 integer)
   - `boxBlur3`
   - `gaussianBlur` (separable, σ, needs the `tmp` buffer)
   - `sobel` (writes `gx`, `gy`, `mag`)
   - `Buffers` (`gray`/`blur`/`gx`/`gy`/`mag`)
   - `assertImageData`
   - Put new generic ops here.
5. Don't touch the DOM at module top level in entry files: `registry.ts` is imported by the worker too. Create DOM objects only inside the renderer.
6. Heavy assets (models/WASM): load them in `init`, passing `signal` to `fetch` and reporting through `onProgress`. The README has a streaming-fetch example built on `import.meta.env.BASE_URL`.
7. OpenCV-based processors: `await loadOpenCV(ctx)` from `src/algorithms/lib/opencv.ts` in `init` (worker-only; memoized, so the ~10 MB runtime downloads once per worker and is never unloaded). Use `import type { Mat } from '@techstark/opencv-js'`, never a value import (it would bundle the whole library).
   - No leaks: keep every `cv.Mat` in a field, created once and reused as an output (OpenCV reallocates in place). Reallocate input Mats only on size change, deleting the old one. `delete()` them all in `dispose`. Wrap any per-frame temporary in `try/finally { m.delete() }`.
   - Fill an input Mat with `mat.data.set(imageData.data)`. `data` is a fresh heap view: never cache it across frames.
   - Gotchas: the typings describe the full C++ API, but not everything is bound (`Mat.release` isn't, so use `create(0, 0, type)`). `HoughCircles` leaves its output untouched when nothing is found.
8. Run `npm run build`, which includes the strict `tsc`. Then test on a real device over HTTPS.

## 6. Constraints & conventions
- Language: code comments in english; fix french comments into english when encountering. UI strings and `index.html` `lang` stay French.
- Resolution:
  - Camera requests ideal width 1280.
  - Processing width is set per algorithm (`sobel` 320, `canny` 640, `houghCircles` 240, `houghCirclesOpencv` 480, `ellipseFit` 480).
  - The core sets **no global cap**, and `videoFrame` input is never downscaled.
  - Overlay DPR is capped at 2.
- **No target FPS is defined.** The loop runs at camera rate (rVFC) or display rate (rAF) and skips frames while busy.
- Targets: iOS Safari 26+ and Android Chrome. **No WebGPU or `navigator.gpu` code exists yet**; the only WASM is OpenCV.js (single-threaded, wasm embedded in the script). The planned policy is WebGPU first with a WASM fallback, chosen by feature-detecting `navigator.gpu`, with the chosen value reported in `backend`. WebNN is not a target.
- GitHub Pages cannot set COOP/COEP, and **no cross-origin-isolation service-worker workaround exists**. `SharedArrayBuffer` is therefore unavailable, so use single-threaded WASM builds.
- The service worker is generated by `vite-plugin-pwa` with `autoUpdate` and precaches only `**/*.{js,css,html,svg,png,webmanifest}`, with `globIgnores: ['**/opencv-*.js']`. Model, `.wasm` and OpenCV.js files are *not* precached.
- Memory (iOS): prefer small quantized models. Never commit weights over 100 MB; host them outside the repo. There is no `public/models/` directory yet.
- Code style:
  - TypeScript ESM, strict `tsconfig` (`noUncheckedIndexedAccess`, so use `arr[i]!` in hot loops; `verbatimModuleSyntax`, so use `import type`; `erasableSyntaxOnly`, so no enums or parameter properties).
  - 2-space indent, single quotes, semicolons, trailing commas.
  - **No formatter or linter is configured.**

## 7. Testing & validation
- No automated tests and no test framework. The only gate is `tsc` (run by `build` and `typecheck`; it passes at this commit). CI deploys without a separate check step.
- Manual validation means the perf overlay (`⏱`: FPS, `proc`, `rtt`, `drop`, `src`, `back`) on real devices, using `passthrough` as the overhead baseline.

## 8. Open questions
- The `t` passed to `process` has two time bases: `mediaTime*1000` (stream time, ms) with rVFC versus `performance.now()` with rAF. Same for the `VideoFrame` timestamp.
- With `input: 'videoFrame'` and no `VideoFrame` support, `FrameSource` silently falls back to an ImageData. Processors must handle both, and none does yet because the path is unused and untested.
- `maxInputWidth` is ignored for `videoFrame` input, so the full camera resolution goes to the worker.
- Workbox `globPatterns` excludes `.wasm`/`.onnx` and has no runtime caching, so model assets won't work offline. Is that intended?
- Model hosting location for weights over 100 MB (Release assets, CDN, HF Hub?) is undecided, as are CORS and offline caching for it.
- OpenCV.js isn't precached and has no runtime caching either, so OpenCV algorithms don't work offline. It's delivered as a Vite `?url` asset from `node_modules` (`assets/opencv-<hash>.js`).
- `HoughCirclesProcessor.dispose()` doesn't reset `edges`, `magHist` or `sectors` (minor, harmless).

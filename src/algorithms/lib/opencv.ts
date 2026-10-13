/// OpenCV.js runtime loader (worker only). Import it from processors, never from entry files.
import type { CV } from '@techstark/opencv-js';
// Hashed asset URL: the 10 MB script is fetched on demand, never bundled nor precached.
// To use a custom build (see scripts/opencv/README.md), point this import at it.
import opencvUrl from '@techstark/opencv-js/dist/opencv.js?url';
import type { InitContext } from '../types';

export type OpenCV = CV;

/** Shared across processors and algorithm switches: an Emscripten heap can't be freed anyway. */
let runtime: { promise: Promise<OpenCV>; signal: AbortSignal | null } | null = null;

interface EmscriptenModule {
  Mat?: unknown;
  then?: unknown;
  onRuntimeInitialized?: () => void;
}

/**
 * Loads OpenCV.js once per worker, reporting download progress.
 * A failed or aborted load is forgotten, so the next selection retries.
 */
export function loadOpenCV(ctx: InitContext): Promise<OpenCV> {
  // A pending load whose caller switched away may not have rejected yet: don't reuse it.
  if (runtime && !runtime.signal?.aborted) return runtime.promise;
  const entry: NonNullable<typeof runtime> = {
    signal: ctx.signal,
    promise: load(ctx).then(
      (cv) => {
        entry.signal = null; // loaded: later aborts of the first caller no longer matter
        return cv;
      },
      (err: unknown) => {
        if (runtime === entry) runtime = null;
        throw err;
      },
    ),
  };
  runtime = entry;
  return entry.promise;
}

async function load({ signal, onProgress }: InitContext): Promise<OpenCV> {
  const src = await fetchText(opencvUrl, signal, onProgress);
  signal.throwIfAborted();
  onProgress(null, 'Initialisation d’OpenCV…');

  // Module workers have no `importScripts`, and the UMD wrapper needs `this` to be the global
  // object: run it as a sloppy-mode function, which sets `globalThis.cv`.
  new Function(src).call(globalThis);
  // Typed loosely until the runtime is up: `Mat` and friends only exist after init.
  const mod = (globalThis as { cv?: EmscriptenModule }).cv;
  if (!mod) throw new Error('OpenCV.js n’a pas défini `cv`');
  // Wasm instantiation is async, so the callback can't have fired yet when `Mat` is missing.
  if (!mod.Mat) {
    await new Promise<void>((resolve) => {
      mod.onRuntimeInitialized = resolve;
    });
  }
  // The Emscripten module is a thenable that resolves to itself: resolving a promise with it
  // would loop forever.
  delete mod.then;
  return mod as unknown as OpenCV;
}

async function fetchText(
  url: string,
  signal: AbortSignal,
  onProgress: InitContext['onProgress'],
): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Téléchargement d’OpenCV impossible (HTTP ${res.status})`);
  // Content-Length is the compressed size when the server gzips: clamp the ratio.
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const mb = (loaded / 1e6).toFixed(1);
    onProgress(total ? Math.min(1, loaded / total) : null, `Téléchargement d’OpenCV… ${mb} Mo`);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

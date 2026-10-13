import type { Mat } from '@techstark/opencv-js';
import { assertImageData } from './lib/imageOps';
import { loadOpenCV, type OpenCV } from './lib/opencv';
import type { FrameInput, InitContext, ParamValues, Processor } from './types';

const ID = 'hough-circles-opencv';

export interface CvCirclesResult {
  /** (x, y, r) triplets, in source pixels. */
  circles: Float32Array;
}

/** Caps what is sent and drawn when a low accumulator threshold floods the output. */
const MAX_CIRCLES = 64;
const BLUR_KSIZE = 5;

/**
 * Circles via `cv.HoughCircles` (HOUGH_GRADIENT) on a median-blurred grayscale frame.
 *
 * Mat lifecycle: every Mat is a field, reused across frames. OpenCV reallocates output buffers
 * in place when needed, so `process` allocates no Mat. All of them are deleted in `dispose`.
 */
export class HoughCirclesOpencvProcessor implements Processor<CvCirclesResult> {
  private dp = 1.2;
  private minDist = 40;
  private param1 = 100;
  private param2 = 30;
  private minRadius = 10;
  private maxRadius = 120;

  private cv: OpenCV | null = null;
  private rgba: Mat | null = null;
  private gray: Mat | null = null;
  private blurred: Mat | null = null;
  private circles: Mat | null = null;
  private timings: Record<string, number> = {};

  async init(ctx: InitContext): Promise<void> {
    const cv = await loadOpenCV(ctx);
    this.cv = cv;
    this.gray = new cv.Mat();
    this.blurred = new cv.Mat();
    this.circles = new cv.Mat();
  }

  setParams(values: Readonly<ParamValues>): void {
    const { dp, minDist, param1, param2, minRadius, maxRadius } = values;
    if (typeof dp === 'number') this.dp = dp;
    if (typeof minDist === 'number') this.minDist = minDist;
    if (typeof param1 === 'number') this.param1 = param1;
    if (typeof param2 === 'number') this.param2 = param2;
    if (typeof minRadius === 'number') this.minRadius = minRadius;
    if (typeof maxRadius === 'number') this.maxRadius = maxRadius;
  }

  process(frame: FrameInput): CvCirclesResult {
    assertImageData(frame, ID);
    const { cv, gray, blurred, circles } = this;
    if (!cv || !gray || !blurred || !circles) throw new Error(`${ID} : processeur non initialisé`);
    const { width: w, height: h } = frame;
    if (!this.rgba || this.rgba.cols !== w || this.rgba.rows !== h) {
      this.rgba?.delete();
      this.rgba = new cv.Mat(h, w, cv.CV_8UC4);
    }

    const t: Record<string, number> = {};
    let t0 = performance.now();
    const lap = (name: string) => {
      const now = performance.now();
      t[name] = now - t0;
      t0 = now;
    };

    // `data` is a fresh view on the wasm heap: never cache it, heap growth detaches it.
    this.rgba.data.set(frame.data);
    cv.cvtColor(this.rgba, gray, cv.COLOR_RGBA2GRAY);
    lap('gris');
    cv.medianBlur(gray, blurred, BLUR_KSIZE);
    lap('flou');
    // 0 means "no limit" for maxRadius; otherwise keep it above minRadius.
    const maxRadius = this.maxRadius > 0 ? Math.max(this.maxRadius, this.minRadius) : 0;
    // HoughCircles leaves its output untouched when nothing is found: empty it first, or the
    // previous frame's circles would be reported again. (`release` isn't bound in opencv.js.)
    circles.create(0, 0, cv.CV_32FC3);
    cv.HoughCircles(
      blurred,
      circles,
      cv.HOUGH_GRADIENT,
      this.dp,
      this.minDist,
      this.param1,
      this.param2,
      this.minRadius,
      maxRadius,
    );
    lap('hough');

    // Output is a 1×N CV_32FC3 Mat (empty when nothing is found). Copy out of the heap.
    const n = Math.min(circles.cols, MAX_CIRCLES);
    const out = circles.data32F.slice(0, n * 3);
    this.timings = t;
    return { circles: out };
  }

  transferables(result: CvCirclesResult): Transferable[] {
    return [result.circles.buffer];
  }

  stageTimings(): Record<string, number> {
    return this.timings;
  }

  dispose(): void {
    for (const m of [this.rgba, this.gray, this.blurred, this.circles]) m?.delete();
    this.rgba = this.gray = this.blurred = this.circles = null;
    this.cv = null;
  }
}

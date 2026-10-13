import type { Mat, MatVector } from '@techstark/opencv-js';
import { assertImageData } from './lib/imageOps';
import { loadOpenCV, type OpenCV } from './lib/opencv';
import type { FrameInput, InitContext, ParamValues, Processor } from './types';

const ID = 'ellipse-fit';

export interface EllipseFitResult {
  /** (cx, cy, rx, ry, angle in radians, fit error as a fraction of the minor semi-axis) tuples, in source pixels. */
  ellipses: Float32Array;
  /** Fit error threshold (fraction), for the renderer's quality color scale. */
  maxError: number;
}

/** Floats per ellipse in `EllipseFitResult.ellipses` (mirrored in the renderer). */
const ELLIPSE_STRIDE = 6;

const BLUR_KSIZE = 5;
/** Dilations of the Canny edges, closing 1 px gaps so a cap rim yields one closed contour. 0 disables it. */
const DILATE_ITERATIONS = 1;
/** Caps what is sent and drawn, keeping the best fits. */
const MAX_ELLIPSES = 64;
/** `fitEllipse` needs at least 5 points. */
const MIN_POINTS = 5;

/**
 * Ellipses via `cv.fitEllipse` on the external contours of a Canny edge map, filtered by
 * contour area/length, axis ratio and mean distance of the contour points to the fitted ellipse.
 *
 * Mat lifecycle: every Mat is a field, reused across frames (see HoughCirclesOpencvProcessor).
 * Only the per-contour views returned by `contours.get(i)` are temporaries, deleted right away.
 */
export class EllipseFitProcessor implements Processor<EllipseFitResult> {
  private cannyLow = 50;
  private cannyHigh = 150;
  private minArea = 300;
  private minLength = 60;
  private minRatio = 0.3;
  /** Fraction (the slider is in %). */
  private maxError = 0.08;

  private cv: OpenCV | null = null;
  private rgba: Mat | null = null;
  private gray: Mat | null = null;
  private blurred: Mat | null = null;
  private edges: Mat | null = null;
  private kernel: Mat | null = null;
  private hierarchy: Mat | null = null;
  private contours: MatVector | null = null;
  private timings: Record<string, number> = {};

  async init(ctx: InitContext): Promise<void> {
    const cv = await loadOpenCV(ctx);
    this.cv = cv;
    this.gray = new cv.Mat();
    this.blurred = new cv.Mat();
    this.edges = new cv.Mat();
    this.kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    this.hierarchy = new cv.Mat();
    this.contours = new cv.MatVector();
  }

  setParams(values: Readonly<ParamValues>): void {
    const { cannyLow, cannyHigh, minArea, minLength, minRatio, maxError } = values;
    if (typeof cannyLow === 'number') this.cannyLow = cannyLow;
    if (typeof cannyHigh === 'number') this.cannyHigh = cannyHigh;
    if (typeof minArea === 'number') this.minArea = minArea;
    if (typeof minLength === 'number') this.minLength = minLength;
    if (typeof minRatio === 'number') this.minRatio = minRatio;
    if (typeof maxError === 'number') this.maxError = maxError / 100;
  }

  process(frame: FrameInput): EllipseFitResult {
    assertImageData(frame, ID);
    const { cv, gray, blurred, edges, kernel, hierarchy, contours } = this;
    if (!cv || !gray || !blurred || !edges || !kernel || !hierarchy || !contours) {
      throw new Error(`${ID} : processeur non initialisé`);
    }
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
    cv.GaussianBlur(gray, blurred, new cv.Size(BLUR_KSIZE, BLUR_KSIZE), 0);
    lap('flou');
    cv.Canny(blurred, edges, this.cannyLow, Math.max(this.cannyLow, this.cannyHigh));
    if (DILATE_ITERATIONS > 0) cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), DILATE_ITERATIONS);
    lap('canny');
    // NONE keeps every boundary point: the fit error is measured on all of them.
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
    lap('contours');

    const maxAxis = 2 * Math.max(w, h);
    const found: number[][] = [];
    const n = contours.size();
    for (let i = 0; i < n; i++) {
      const c = contours.get(i);
      try {
        // Cheapest checks first.
        if (c.rows < MIN_POINTS) continue;
        if (cv.contourArea(c) < this.minArea) continue;
        if (cv.arcLength(c, true) < this.minLength) continue;

        const { center, size, angle } = cv.fitEllipse(c);
        const rx = size.width / 2;
        const ry = size.height / 2;
        const a = Math.max(rx, ry);
        const b = Math.min(rx, ry);
        if (!(b > 0) || !Number.isFinite(a) || a > maxAxis) continue;
        if (b / a < this.minRatio) continue;

        const theta = (angle * Math.PI) / 180;
        const err = fitError(c.data32S, center.x, center.y, rx, ry, theta) / b;
        if (!(err <= this.maxError)) continue;
        found.push([center.x, center.y, rx, ry, theta, err]);
      } finally {
        c.delete();
      }
    }

    found.sort((p, q) => p[5]! - q[5]!);
    const kept = Math.min(found.length, MAX_ELLIPSES);
    const out = new Float32Array(kept * ELLIPSE_STRIDE);
    for (let k = 0; k < kept; k++) out.set(found[k]!, k * ELLIPSE_STRIDE);
    lap('ellipses');
    this.timings = t;
    return { ellipses: out, maxError: this.maxError };
  }

  transferables(result: EllipseFitResult): Transferable[] {
    return [result.ellipses.buffer];
  }

  stageTimings(): Record<string, number> {
    return this.timings;
  }

  dispose(): void {
    for (const m of [this.rgba, this.gray, this.blurred, this.edges, this.kernel, this.hierarchy]) m?.delete();
    this.contours?.delete();
    this.rgba = this.gray = this.blurred = this.edges = this.kernel = this.hierarchy = null;
    this.contours = null;
    this.cv = null;
  }
}

/**
 * Mean approximate distance (px) from the (x, y) pairs in `pts` to the ellipse boundary.
 * Each point p is scaled radially onto the ellipse: with r its normalized radius in the
 * ellipse frame, the distance along the ray from the center is |p − c|·|1 − 1/r|.
 */
function fitError(pts: Int32Array, cx: number, cy: number, rx: number, ry: number, theta: number): number {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const count = pts.length / 2;
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const dx = pts[2 * k]! - cx;
    const dy = pts[2 * k + 1]! - cy;
    // Rotate into the ellipse frame (OpenCV's angle is the rotation of the `width` axis).
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    const r = Math.sqrt((u / rx) ** 2 + (v / ry) ** 2);
    if (r > 0) sum += Math.hypot(dx, dy) * Math.abs(1 - 1 / r);
    // r == 0 (point at the center): the distance is ~min axis, an outlier counted as such.
    else sum += Math.min(rx, ry);
  }
  return count > 0 ? sum / count : Infinity;
}

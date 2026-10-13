import { assertImageData, gaussianBlur, otsuThreshold, splitRGB } from './lib/imageOps';
import type { FrameInput, ParamValues, Processor } from './types';

const ID = 'color-segmentation';

/** Hue bins: 2° each (OpenCV convention, hue fits in a byte). */
export const HUE_BINS = 180;
/** Side of the central square ROI, as a fraction of min(w, h). */
const ROI_FRAC = 0.1;
const ROI_MIN = 5;
/** Half-width (bins) of the circular box filter applied to the ROI histogram. */
const HIST_SMOOTH = 2;
/** Alpha of the mask tint. */
const MASK_ALPHA = 150;

export interface ColorSegResult {
  /** RGBA: mask pixels tinted (complement of the dominant hue), others transparent. */
  mask: ImageData;
  /** Raw hue histogram of the chromatic ROI pixels (`HUE_BINS` bins of 2°). */
  hist: Uint32Array;
  /** Dominant hue in degrees, or -1 when the ROI has no chromatic pixel. */
  hue: number;
  /** Hue tolerance ±Δ, in degrees. */
  delta: number;
  /** ROI in source pixels. */
  roi: { x: number; y: number; w: number; h: number };
  /** Otsu V threshold applied, or -1 when disabled / not applicable. */
  otsu: number;
}

/**
 * Color segmentation driven by a central reticle:
 * 1. per-channel Gaussian blur (σ);
 * 2. RGB → HSV (H in 2° bins, S and V in 0..255);
 * 3. hue histogram of the chromatic pixels of the central ROI → dominant hue;
 * 4. mask: circular hue distance ≤ Δ, S ≥ sMin, V ≥ vMin;
 * 5. optional cleanup: Otsu on the V histogram of the masked pixels, the darker
 *    class (shadows, dark look-alikes) is dropped.
 */
export class ColorSegmentationProcessor implements Processor<ColorSegResult> {
  private sigma = 1;
  private delta = 15;
  private sMin = 60;
  private vMin = 40;
  private otsu = true;

  private r = new Uint8Array(0);
  private g = new Uint8Array(0);
  private b = new Uint8Array(0);
  private tmp = new Float32Array(0);
  private hue = new Uint8Array(0);
  private sat = new Uint8Array(0);
  private val = new Uint8Array(0);
  private mask = new Uint8Array(0);
  private readonly vHist = new Uint32Array(256);
  private timings: Record<string, number> = {};

  async init(): Promise<void> {}

  setParams(values: Readonly<ParamValues>): void {
    const { sigma, delta, sMin, vMin, otsu } = values;
    if (typeof sigma === 'number') this.sigma = sigma;
    if (typeof delta === 'number') this.delta = delta;
    if (typeof sMin === 'number') this.sMin = sMin;
    if (typeof vMin === 'number') this.vMin = vMin;
    if (typeof otsu === 'boolean') this.otsu = otsu;
  }

  private ensure(n: number): void {
    if (this.r.length === n) return;
    this.r = new Uint8Array(n);
    this.g = new Uint8Array(n);
    this.b = new Uint8Array(n);
    this.tmp = new Float32Array(n);
    this.hue = new Uint8Array(n);
    this.sat = new Uint8Array(n);
    this.val = new Uint8Array(n);
    this.mask = new Uint8Array(n);
  }

  process(frame: FrameInput): ColorSegResult {
    assertImageData(frame, ID);
    const { width: w, height: h } = frame;
    this.ensure(w * h);

    const t: Record<string, number> = {};
    let t0 = performance.now();
    const lap = (name: string) => {
      const now = performance.now();
      t[name] = now - t0;
      t0 = now;
    };

    // Blur in place: `gaussianBlur` reads `src` only in its first pass (into `tmp`).
    splitRGB(frame, this.r, this.g, this.b);
    gaussianBlur(this.r, this.r, w, h, this.sigma, this.tmp);
    gaussianBlur(this.g, this.g, w, h, this.sigma, this.tmp);
    gaussianBlur(this.b, this.b, w, h, this.sigma, this.tmp);
    lap('flou');
    this.toHsv();
    lap('hsv');
    const side = Math.min(w, h, Math.max(ROI_MIN, Math.round(ROI_FRAC * Math.min(w, h))));
    const roi = { x: (w - side) >> 1, y: (h - side) >> 1, w: side, h: side };
    const hist = this.roiHistogram(w, roi);
    const bin = dominantBin(hist);
    lap('roi');
    const count = bin < 0 ? 0 : this.buildMask(bin);
    lap('masque');
    const otsu = this.otsu && count > 0 ? this.otsuCleanup(count) : -1;
    lap('otsu');
    const mask = this.render(w, h, bin);
    lap('sortie');

    this.timings = t;
    return { mask, hist, hue: bin < 0 ? -1 : bin * 2, delta: this.delta, roi, otsu };
  }

  /** Integer RGB → HSV. H in [0, 180) (2° bins), S and V in [0, 255]. */
  private toHsv(): void {
    const { r, g, b, hue, sat, val } = this;
    for (let p = 0; p < r.length; p++) {
      const R = r[p]!, G = g[p]!, B = b[p]!;
      const max = R > G ? (R > B ? R : B) : G > B ? G : B;
      const min = R < G ? (R < B ? R : B) : G < B ? G : B;
      const d = max - min;
      val[p] = max;
      if (d === 0) {
        sat[p] = 0;
        hue[p] = 0;
        continue;
      }
      sat[p] = (255 * d) / max; // Uint8Array truncates
      // 60° per sector = 30 bins.
      let hh: number;
      if (max === R) hh = (30 * (G - B)) / d;
      else if (max === G) hh = 60 + (30 * (B - R)) / d;
      else hh = 120 + (30 * (R - G)) / d;
      hh = Math.round(hh);
      if (hh < 0) hh += HUE_BINS;
      else if (hh >= HUE_BINS) hh -= HUE_BINS;
      hue[p] = hh;
    }
  }

  /** Hue histogram of ROI pixels passing S/V (hue is meaningless otherwise). New array: transferred. */
  private roiHistogram(w: number, roi: ColorSegResult['roi']): Uint32Array {
    const { hue, sat, val, sMin, vMin } = this;
    const hist = new Uint32Array(HUE_BINS);
    for (let y = roi.y; y < roi.y + roi.h; y++) {
      for (let x = roi.x, i = y * w + roi.x; x < roi.x + roi.w; x++, i++) {
        if (sat[i]! >= sMin && val[i]! >= vMin) hist[hue[i]!]!++;
      }
    }
    return hist;
  }

  /** Writes `mask` and the V histogram of masked pixels. Returns the masked count. */
  private buildMask(bin: number): number {
    const { hue, sat, val, mask, vHist, sMin, vMin } = this;
    const tol = this.delta / 2; // degrees → bins
    let count = 0;
    vHist.fill(0);
    for (let p = 0; p < mask.length; p++) {
      let d = Math.abs(hue[p]! - bin);
      if (d > HUE_BINS / 2) d = HUE_BINS - d;
      const v = val[p]!;
      if (d <= tol && sat[p]! >= sMin && v >= vMin) {
        mask[p] = 1;
        vHist[v]!++;
        count++;
      } else {
        mask[p] = 0;
      }
    }
    return count;
  }

  /** Drops the darker Otsu class of the masked pixels. Returns the threshold, or -1 if V is uniform. */
  private otsuCleanup(count: number): number {
    const { mask, val, vHist } = this;
    let levels = 0;
    for (let i = 0; i < 256 && levels < 2; i++) if (vHist[i]! > 0) levels++;
    if (levels < 2) return -1;
    const th = otsuThreshold(vHist, count);
    for (let p = 0; p < mask.length; p++) if (val[p]! <= th) mask[p] = 0;
    return th;
  }

  private render(w: number, h: number, bin: number): ImageData {
    // New output every frame: its buffer is transferred to the main thread.
    const out = new ImageData(w, h);
    if (bin < 0) {
      this.mask.fill(0);
      return out;
    }
    const d = out.data;
    const [cr, cg, cb] = hueToRgb(bin * 2 + 180);
    const mask = this.mask;
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (mask[p] === 1) {
        d[i] = cr;
        d[i + 1] = cg;
        d[i + 2] = cb;
        d[i + 3] = MASK_ALPHA;
      }
    }
    return out;
  }

  transferables(result: ColorSegResult): Transferable[] {
    return [result.mask.data.buffer, result.hist.buffer];
  }

  stageTimings(): Record<string, number> {
    return this.timings;
  }

  dispose(): void {
    this.ensure(0);
    this.vHist.fill(0);
  }
}

/** Argmax of the circularly smoothed histogram, or -1 if it is empty. */
function dominantBin(hist: Uint32Array): number {
  let best = -1;
  let bestSum = 0;
  for (let k = 0; k < HUE_BINS; k++) {
    let s = 0;
    for (let j = -HIST_SMOOTH; j <= HIST_SMOOTH; j++) s += hist[(k + j + HUE_BINS) % HUE_BINS]!;
    if (s > bestSum) {
      bestSum = s;
      best = k;
    }
  }
  return best;
}

/** Fully saturated, full value RGB for a hue in degrees. */
function hueToRgb(deg: number): [number, number, number] {
  const h = (((deg % 360) + 360) % 360) / 60;
  const x = Math.round(255 * (1 - Math.abs((h % 2) - 1)));
  switch (Math.floor(h)) {
    case 0: return [255, x, 0];
    case 1: return [x, 255, 0];
    case 2: return [0, 255, x];
    case 3: return [0, x, 255];
    case 4: return [x, 0, 255];
    default: return [255, 0, x];
  }
}

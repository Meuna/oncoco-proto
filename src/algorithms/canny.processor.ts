import { assertImageData, Buffers, gaussianBlur, sobel, toGray } from './lib/imageOps';
import type { FrameInput, ParamValues, Processor } from './types';

const ID = 'canny';

const TAN_22_5 = Math.SQRT2 - 1;
const TAN_67_5 = Math.SQRT2 + 1;

const WEAK = 1;
const STRONG = 2;

/**
 * Canny edge detector:
 * 1. grayscale, Gaussian blur (σ);
 * 2. Sobel gradient;
 * 3. non-maximum suppression along the gradient direction, quantized to 4 sectors,
 *    with double thresholding in the same pass;
 * 4. hysteresis: weak edges are kept only when 8-connected to a strong one.
 * Output: white edges on an opaque black background, or transparent in overlay mode.
 */
export class CannyProcessor implements Processor<ImageData> {
  private sigma = 1.4;
  private low = 50;
  private high = 100;
  private overlay = false;

  private buf = new Buffers();
  /** 0 = none, WEAK, STRONG. */
  private state = new Uint8Array(0);
  private stack = new Int32Array(0);
  private timings: Record<string, number> = {};

  async init(): Promise<void> {}

  setParams(values: Readonly<ParamValues>): void {
    const { sigma, low, high, overlay } = values;
    if (typeof sigma === 'number') this.sigma = sigma;
    if (typeof low === 'number') this.low = low;
    if (typeof high === 'number') this.high = high;
    if (typeof overlay === 'boolean') this.overlay = overlay;
  }

  process(frame: FrameInput): ImageData {
    assertImageData(frame, ID);
    const { width: w, height: h } = frame;
    const b = this.buf;
    b.ensure(w, h);
    if (this.state.length !== w * h) {
      this.state = new Uint8Array(w * h);
      this.stack = new Int32Array(w * h);
    }

    const t: Record<string, number> = {};
    let t0 = performance.now();
    const lap = (name: string) => {
      const now = performance.now();
      t[name] = now - t0;
      t0 = now;
    };

    toGray(frame, b.gray);
    lap('gris');
    gaussianBlur(b.gray, b.blur, w, h, this.sigma, b.tmp);
    lap('flou');
    sobel(b.blur, w, h, b.gx, b.gy, b.mag);
    lap('sobel');
    const strongCount = this.suppressAndClassify(w, h);
    lap('nms');
    this.hysteresis(w, strongCount);
    lap('hyst');
    const out = this.render(w, h);
    lap('sortie');

    this.timings = t;
    return out;
  }

  /** NMS + double threshold. Writes `state` and pushes strong pixels on `stack`. */
  private suppressAndClassify(w: number, h: number): number {
    const { gx, gy, mag } = this.buf;
    const state = this.state;
    const stack = this.stack;
    // Hysteresis is meaningless with low > high: clamp low.
    const high = this.high;
    const low = Math.min(this.low, high);
    let sp = 0;

    state.fill(0);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const m = mag[i]!;
        if (m < low || m === 0) continue;

        const dx = gx[i]!;
        const dy = gy[i]!;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        // Offset of the neighbor along the gradient (the other one is at -off).
        let off: number;
        if (ay <= TAN_22_5 * ax) off = 1; // horizontal gradient
        else if (ay > TAN_67_5 * ax) off = w; // vertical gradient
        else off = dx * dy > 0 ? w + 1 : w - 1; // diagonal (y points down)

        // `>=` on one side, `>` on the other: plateaus keep a single pixel.
        if (m < mag[i - off]! || m <= mag[i + off]!) continue;

        if (m >= high) {
          state[i] = STRONG;
          stack[sp++] = i;
        } else {
          state[i] = WEAK;
        }
      }
    }
    return sp;
  }

  /** Promotes weak pixels 8-connected to strong ones (border pixels are always 0). */
  private hysteresis(w: number, strongCount: number): void {
    const state = this.state;
    const stack = this.stack;
    let sp = strongCount;
    while (sp > 0) {
      const i = stack[--sp]!;
      for (let dy = -w; dy <= w; dy += w) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy + dx;
          if (state[j] === WEAK) {
            state[j] = STRONG;
            stack[sp++] = j;
          }
        }
      }
    }
  }

  private render(w: number, h: number): ImageData {
    // New output every frame: its buffer is transferred to the main thread.
    const out = new ImageData(w, h);
    const d = out.data;
    const state = this.state;
    const bgAlpha = this.overlay ? 0 : 255;
    for (let p = 0, i = 0; p < state.length; p++, i += 4) {
      if (state[p] === STRONG) {
        d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 255;
      } else {
        d[i + 3] = bgAlpha;
      }
    }
    return out;
  }

  transferables(result: ImageData): Transferable[] {
    return [result.data.buffer];
  }

  stageTimings(): Record<string, number> {
    return this.timings;
  }

  dispose(): void {
    this.buf = new Buffers();
    this.state = new Uint8Array(0);
    this.stack = new Int32Array(0);
  }
}

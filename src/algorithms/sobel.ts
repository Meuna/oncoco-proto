import { assertImageData, Buffers, sobel as sobelOp, toGray } from './lib/imageOps';
import type { AlgorithmEntry, CoordMapper, FrameInput, VisionAlgorithm } from './types';

const ID = 'sobel';
const LABEL = 'Niveaux de gris + Sobel';
const NOISE_FLOOR = 40;

/** Contours de Sobel rendus en cyan semi-transparent par-dessus la vidéo. */
class Sobel implements VisionAlgorithm<ImageData> {
  id = ID;
  label = LABEL;
  maxInputWidth = 320;
  backend = 'js-cpu';

  private buf = new Buffers();
  private out: ImageData | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  async init(): Promise<void> {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  process(frame: FrameInput): ImageData {
    assertImageData(frame, ID);
    const { width: w, height: h } = frame;
    const b = this.buf;
    b.ensure(w, h);
    if (!this.out || this.out.width !== w || this.out.height !== h) this.out = new ImageData(w, h);

    toGray(frame, b.gray);
    sobelOp(b.gray, w, h, b.gx, b.gy, b.mag);

    const d = this.out.data;
    for (let p = 0, i = 0; p < b.mag.length; p++, i += 4) {
      const m = b.mag[p]!;
      d[i] = 0;
      d[i + 1] = 229;
      d[i + 2] = 255;
      d[i + 3] = m < NOISE_FLOOR ? 0 : Math.min(255, (m - NOISE_FLOOR) * 1.5);
    }
    return this.out;
  }

  draw(result: ImageData, ctx: CanvasRenderingContext2D, map: CoordMapper): void {
    if (!this.canvas || !this.ctx) return;
    if (this.canvas.width !== result.width || this.canvas.height !== result.height) {
      this.canvas.width = result.width;
      this.canvas.height = result.height;
    }
    this.ctx.putImageData(result, 0, 0);
    map.applyTransform(ctx);
    ctx.globalAlpha = 0.85;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0);
  }

  dispose(): void {
    this.canvas = this.ctx = this.out = null;
    this.buf = new Buffers();
  }
}

export const sobel: AlgorithmEntry = { id: ID, label: LABEL, create: () => new Sobel() };

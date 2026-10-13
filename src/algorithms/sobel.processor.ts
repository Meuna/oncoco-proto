import { assertImageData, Buffers, sobel, toGray } from './lib/imageOps';
import type { FrameInput, Processor } from './types';

const NOISE_FLOOR = 40;

/** Contours de Sobel encodés en cyan, alpha selon la magnitude. */
export class SobelProcessor implements Processor<ImageData> {
  private buf = new Buffers();

  async init(): Promise<void> {}

  process(frame: FrameInput): ImageData {
    assertImageData(frame, 'sobel');
    const { width: w, height: h } = frame;
    const b = this.buf;
    b.ensure(w, h);
    // Nouvelle sortie à chaque frame : son buffer est transféré au thread principal.
    const out = new ImageData(w, h);

    toGray(frame, b.gray);
    sobel(b.gray, w, h, b.gx, b.gy, b.mag);

    const d = out.data;
    for (let p = 0, i = 0; p < b.mag.length; p++, i += 4) {
      const m = b.mag[p]!;
      d[i] = 0;
      d[i + 1] = 229;
      d[i + 2] = 255;
      d[i + 3] = m < NOISE_FLOOR ? 0 : Math.min(255, (m - NOISE_FLOOR) * 1.5);
    }
    return out;
  }

  transferables(result: ImageData): Transferable[] {
    return [result.data.buffer];
  }

  dispose(): void {
    this.buf = new Buffers();
  }
}

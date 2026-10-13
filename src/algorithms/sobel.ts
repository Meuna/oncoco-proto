import type { AlgorithmEntry, CoordMapper, Renderer } from './types';

/** Contours de Sobel rendus en cyan semi-transparent par-dessus la vidéo. */
class SobelRenderer implements Renderer<ImageData> {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  draw(result: ImageData, ctx: CanvasRenderingContext2D, map: CoordMapper): void {
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
}

export const sobel: AlgorithmEntry<ImageData> = {
  id: 'sobel',
  label: 'Niveaux de gris + Sobel',
  maxInputWidth: 320,
  backend: 'js-cpu',
  createProcessor: async () => new (await import('./sobel.processor')).SobelProcessor(),
  createRenderer: () => new SobelRenderer(),
};

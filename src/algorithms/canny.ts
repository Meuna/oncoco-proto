import type { AlgorithmEntry, CoordMapper, Renderer } from './types';

/** Canny edges (white on black, or over the video), drawn without smoothing. */
class CannyRenderer implements Renderer<ImageData> {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  draw(result: ImageData, ctx: CanvasRenderingContext2D, map: CoordMapper): void {
    if (this.canvas.width !== result.width || this.canvas.height !== result.height) {
      this.canvas.width = result.width;
      this.canvas.height = result.height;
    }
    this.ctx.putImageData(result, 0, 0);
    map.applyTransform(ctx);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, 0, 0);
  }
}

export const canny: AlgorithmEntry<ImageData> = {
  id: 'canny',
  label: 'Contours de Canny',
  maxInputWidth: 640,
  backend: 'js-cpu',
  params: [
    { key: 'sigma', label: 'σ flou', type: 'range', min: 0, max: 4, step: 0.1, default: 1.4 },
    { key: 'low', label: 'Seuil bas', type: 'range', min: 0, max: 500, step: 1, default: 50 },
    { key: 'high', label: 'Seuil haut', type: 'range', min: 0, max: 500, step: 1, default: 100 },
    { key: 'overlay', label: 'Superposer à la vidéo', type: 'toggle', default: false },
  ],
  createProcessor: async () => new (await import('./canny.processor')).CannyProcessor(),
  createRenderer: () => new CannyRenderer(),
};

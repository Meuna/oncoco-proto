import type { ColorSegResult } from './colorSegmentation.processor';
import type { AlgorithmEntry, CoordMapper, Renderer } from './types';

/** Histogram widget size and margin, in CSS pixels. */
const WIDGET_W = 180;
const WIDGET_H = 72;
const WIDGET_MARGIN = 8;
const TEXT_H = 16;

/** Tinted mask over the video, ROI reticle, and hue histogram widget (top-right). */
class ColorSegmentationRenderer implements Renderer<ColorSegResult> {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  draw(result: ColorSegResult, ctx: CanvasRenderingContext2D, map: CoordMapper): void {
    const { mask, roi } = result;
    if (this.canvas.width !== mask.width || this.canvas.height !== mask.height) {
      this.canvas.width = mask.width;
      this.canvas.height = mask.height;
    }
    this.ctx.putImageData(mask, 0, 0);
    map.applyTransform(ctx);
    ctx.imageSmoothingEnabled = true; // soft mask edges once upscaled
    ctx.drawImage(this.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Reticle.
    const a = map.toScreen(roi.x, roi.y);
    const b = map.toScreen(roi.x + roi.w, roi.y + roi.h);
    ctx.lineWidth = 2 * map.dpr;
    ctx.strokeStyle = '#fff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3 * map.dpr;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.shadowBlur = 0;

    this.drawHistogram(result, ctx, map.dpr);
  }

  private drawHistogram(result: ColorSegResult, ctx: CanvasRenderingContext2D, dpr: number): void {
    const { hist, hue, delta, otsu } = result;
    const bins = hist.length;
    const w = WIDGET_W * dpr;
    const h = WIDGET_H * dpr;
    const pad = 6 * dpr;
    const x0 = ctx.canvas.width - w - WIDGET_MARGIN * dpr;
    const y0 = WIDGET_MARGIN * dpr;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x0, y0, w, h);

    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const label = hue < 0 ? 'H —' : `H ${hue}°` + (otsu >= 0 ? ` · Otsu ${otsu}` : '');
    ctx.fillText(label, x0 + pad, y0 + (pad + TEXT_H * dpr) / 2);

    // Plot area: x is the hue in degrees, [0, 360).
    const px = x0 + pad;
    const py = y0 + pad + TEXT_H * dpr;
    const pw = w - 2 * pad;
    const ph = h - 2 * pad - TEXT_H * dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();

    if (hue >= 0) {
      // ±Δ band, wrapping around 0°/360°.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      for (const shift of [-360, 0, 360]) {
        const lo = hue - delta + shift;
        ctx.fillRect(px + (lo / 360) * pw, py, ((2 * delta) / 360) * pw, ph);
      }
    }

    let max = 0;
    for (let k = 0; k < bins; k++) if (hist[k]! > max) max = hist[k]!;
    if (max > 0) {
      const bw = pw / bins;
      for (let k = 0; k < bins; k++) {
        const v = hist[k]!;
        if (v === 0) continue;
        const bh = (v / max) * ph;
        ctx.fillStyle = `hsl(${(k * 360) / bins} 100% 50%)`;
        // Slight overlap avoids hairline gaps between bars.
        ctx.fillRect(px + k * bw, py + ph - bh, bw + 0.5, bh);
      }
    }

    if (hue >= 0) {
      const mx = px + (hue / 360) * pw;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(mx, py);
      ctx.lineTo(mx, py + ph);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export const colorSegmentation: AlgorithmEntry<ColorSegResult> = {
  id: 'color-segmentation',
  label: 'Segmentation couleur',
  maxInputWidth: 320,
  backend: 'js-cpu',
  params: [
    { key: 'sigma', label: 'σ flou', type: 'range', min: 0, max: 4, step: 0.1, default: 1 },
    { key: 'delta', label: 'Δ teinte (°)', type: 'range', min: 1, max: 90, step: 1, default: 15 },
    { key: 'sMin', label: 'Saturation min', type: 'range', min: 0, max: 255, step: 1, default: 60 },
    { key: 'vMin', label: 'Luminosité min', type: 'range', min: 0, max: 255, step: 1, default: 40 },
    { key: 'otsu', label: 'Nettoyage Otsu (V)', type: 'toggle', default: true },
  ],
  createProcessor: async () =>
    new (await import('./colorSegmentation.processor')).ColorSegmentationProcessor(),
  createRenderer: () => new ColorSegmentationRenderer(),
};

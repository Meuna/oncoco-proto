import type { EllipseFitResult } from './ellipseFit.processor';
import type { AlgorithmEntry, CoordMapper, Renderer } from './types';

/** Same as `ELLIPSE_STRIDE` in the processor (a value import would pull its code into the main bundle). */
const STRIDE = 6;
/** Count badge margin and padding, in CSS pixels. */
const BADGE_MARGIN = 8;
const BADGE_PAD = 6;

/** Fitted ellipses over the video, green (tight fit) to red (at the error threshold), plus a count badge. */
class EllipseFitRenderer implements Renderer<EllipseFitResult> {
  draw({ ellipses, maxError }: EllipseFitResult, ctx: CanvasRenderingContext2D, map: CoordMapper): void {
    const dpr = map.dpr;
    const lw = 3 * dpr;
    ctx.lineWidth = lw;
    const count = ellipses.length / STRIDE;
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      const p = map.toScreen(ellipses[o]!, ellipses[o + 1]!);
      const rx = ellipses[o + 2]! * map.scale;
      const ry = ellipses[o + 3]! * map.scale;
      const err = ellipses[o + 5]!;
      const q = maxError > 0 ? Math.min(1, Math.max(0, 1 - err / maxError)) : 1;
      ctx.strokeStyle = `hsl(${Math.round(q * 120)} 100% 50%)`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, ry, ellipses[o + 4]!, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, lw, 0, Math.PI * 2);
      ctx.fill();
    }

    const label = `${count} ellipse${count > 1 ? 's' : ''}`;
    ctx.font = `${13 * dpr}px ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const pad = BADGE_PAD * dpr;
    const w = ctx.measureText(label).width + pad * 2;
    const h = 13 * dpr + pad * 2;
    const x = ctx.canvas.width - w - BADGE_MARGIN * dpr;
    const y = BADGE_MARGIN * dpr;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + pad, y + h / 2);
  }
}

export const ellipseFit: AlgorithmEntry<EllipseFitResult> = {
  id: 'ellipse-fit',
  label: 'Ajustement d’ellipses (OpenCV)',
  maxInputWidth: 480,
  backend: 'wasm',
  // Pixel values are in the 480 px processing frame.
  params: [
    { key: 'cannyLow', label: 'Seuil Canny bas', type: 'range', min: 0, max: 500, step: 1, default: 50 },
    { key: 'cannyHigh', label: 'Seuil Canny haut', type: 'range', min: 0, max: 500, step: 1, default: 150 },
    { key: 'minArea', label: 'Aire min. (px²)', type: 'range', min: 0, max: 20000, step: 50, default: 300 },
    { key: 'minLength', label: 'Longueur min. contour (px)', type: 'range', min: 10, max: 1500, step: 5, default: 60 },
    { key: 'minRatio', label: 'Rapport axes min. (petit/grand)', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.3 },
    { key: 'maxError', label: 'Erreur d’ajustement max. (%)', type: 'range', min: 1, max: 30, step: 0.5, default: 8 },
  ],
  createProcessor: async () => new (await import('./ellipseFit.processor')).EllipseFitProcessor(),
  createRenderer: () => new EllipseFitRenderer(),
};

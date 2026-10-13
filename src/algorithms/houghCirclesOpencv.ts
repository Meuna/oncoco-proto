import type { CvCirclesResult } from './houghCirclesOpencv.processor';
import type { AlgorithmEntry, CoordMapper, Renderer } from './types';

/** Count badge margin and padding, in CSS pixels. */
const BADGE_MARGIN = 8;
const BADGE_PAD = 6;

/** Detected circles over the video, plus a count badge (top-right). */
class HoughCirclesOpencvRenderer implements Renderer<CvCirclesResult> {
  draw({ circles }: CvCirclesResult, ctx: CanvasRenderingContext2D, map: CoordMapper): void {
    const dpr = map.dpr;
    const lw = 3 * dpr;
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'hsl(190 100% 55%)';
    ctx.fillStyle = ctx.strokeStyle;
    const count = circles.length / 3;
    for (let i = 0; i < count; i++) {
      const p = map.toScreen(circles[i * 3]!, circles[i * 3 + 1]!);
      const r = circles[i * 3 + 2]! * map.scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, lw, 0, Math.PI * 2);
      ctx.fill();
    }

    const label = `${count} cercle${count > 1 ? 's' : ''}`;
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

export const houghCirclesOpencv: AlgorithmEntry<CvCirclesResult> = {
  id: 'hough-circles-opencv',
  label: 'Cercles de Hough (OpenCV)',
  maxInputWidth: 480,
  backend: 'wasm',
  // Pixel values are in the 480 px processing frame.
  params: [
    { key: 'dp', label: 'dp (résolution accu.)', type: 'range', min: 1, max: 3, step: 0.1, default: 1.2 },
    { key: 'minDist', label: 'Distance min. centres', type: 'range', min: 1, max: 300, step: 1, default: 40 },
    { key: 'param1', label: 'param1 (seuil Canny)', type: 'range', min: 10, max: 300, step: 1, default: 100 },
    { key: 'param2', label: 'param2 (seuil accu.)', type: 'range', min: 5, max: 150, step: 1, default: 30 },
    { key: 'minRadius', label: 'Rayon min.', type: 'range', min: 0, max: 240, step: 1, default: 10 },
    { key: 'maxRadius', label: 'Rayon max. (0 = illimité)', type: 'range', min: 0, max: 240, step: 1, default: 120 },
  ],
  createProcessor: async () => new (await import('./houghCirclesOpencv.processor')).HoughCirclesOpencvProcessor(),
  createRenderer: () => new HoughCirclesOpencvRenderer(),
};

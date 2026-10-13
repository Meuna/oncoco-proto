import type { Circle } from './houghCircles.processor';
import type { AlgorithmEntry, CoordMapper, Renderer } from './types';

class HoughCirclesRenderer implements Renderer<Circle[]> {
  draw(circles: Circle[], ctx: CanvasRenderingContext2D, map: CoordMapper): void {
    const lw = 3 * map.dpr;
    ctx.lineWidth = lw;
    ctx.font = `${12 * map.dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    for (const c of circles) {
      const p = map.toScreen(c.x, c.y);
      const r = c.r * map.scale;
      const hue = 120 * c.score; // rouge → vert selon le score
      ctx.strokeStyle = `hsl(${hue} 100% 55%)`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, lw, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(c.score.toFixed(2), p.x, p.y - r - lw * 2);
    }
  }
}

export const houghCircles: AlgorithmEntry<Circle[]> = {
  id: 'hough-circles',
  label: 'Cercles (Hough simplifié)',
  maxInputWidth: 240,
  backend: 'js-cpu',
  createProcessor: async () => new (await import('./houghCircles.processor')).HoughCirclesProcessor(),
  createRenderer: () => new HoughCirclesRenderer(),
};

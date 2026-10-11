import type { CoordMapper } from '../algorithms/types';

/**
 * Construit le mapper pour une frame source `srcW×srcH` issue d'une vidéo `videoW×videoH`
 * affichée en `object-fit: cover` dans un canvas `canvasW×canvasH` (pixels backing).
 */
export function createCoordMapper(
  srcW: number,
  srcH: number,
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
  dpr: number,
): CoordMapper {
  const cover = Math.max(canvasW / videoW, canvasH / videoH);
  const offsetX = (canvasW - videoW * cover) / 2;
  const offsetY = (canvasH - videoH * cover) / 2;
  const scaleX = (cover * videoW) / srcW;
  const scaleY = (cover * videoH) / srcH;

  return {
    srcWidth: srcW,
    srcHeight: srcH,
    scaleX,
    scaleY,
    scale: (scaleX + scaleY) / 2,
    dpr,
    toScreen: (x, y) => ({ x: offsetX + x * scaleX, y: offsetY + y * scaleY }),
    applyTransform: (ctx) => ctx.setTransform(scaleX, 0, 0, scaleY, offsetX, offsetY),
  };
}

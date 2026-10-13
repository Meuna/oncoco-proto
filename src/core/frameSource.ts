import type { AlgorithmEntry, FrameInput } from '../algorithms/types';

export interface GrabbedFrame {
  frame: FrameInput;
  width: number;
  height: number;
  /** Objets cédés au worker avec la frame (pas de copie). */
  transfer: Transferable[];
  /** À appeler après l'envoi : libère la frame si elle n'a pas pu être transférée. */
  release(): void;
}

const noop = () => {};

/** Convertit l'image courante de la vidéo dans le format demandé par l'algorithme. */
export class FrameSource {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  grab(video: HTMLVideoElement, algo: AlgorithmEntry, t: number): GrabbedFrame {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (algo.input === 'none') {
      return { frame: null, width: vw, height: vh, transfer: [], release: noop };
    }

    if (algo.input === 'videoFrame' && typeof VideoFrame !== 'undefined') {
      const frame = new VideoFrame(video, { timestamp: Math.round(t * 1000) });
      return {
        frame,
        width: frame.displayWidth,
        height: frame.displayHeight,
        transfer: [frame],
        // Sans effet si la frame a été transférée (elle est déjà fermée de ce côté).
        release: () => frame.close(),
      };
    }

    const w = Math.min(vw, algo.maxInputWidth ?? vw);
    const h = Math.round((vh * w) / vw);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    const frame = this.ctx.getImageData(0, 0, w, h);
    return { frame, width: w, height: h, transfer: [frame.data.buffer], release: noop };
  }
}

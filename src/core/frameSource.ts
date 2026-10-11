import type { FrameInput, VisionAlgorithm } from '../algorithms/types';

export interface GrabbedFrame {
  frame: FrameInput;
  width: number;
  height: number;
  release(): void;
}

const noop = () => {};

/** Convertit l'image courante de la vidéo dans le format demandé par l'algorithme. */
export class FrameSource {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  grab(video: HTMLVideoElement, algo: VisionAlgorithm<unknown>, t: number): GrabbedFrame {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (algo.input === 'video') {
      return { frame: video, width: vw, height: vh, release: noop };
    }

    if (algo.input === 'videoFrame' && typeof VideoFrame !== 'undefined') {
      const frame = new VideoFrame(video, { timestamp: Math.round(t * 1000) });
      return {
        frame,
        width: frame.displayWidth,
        height: frame.displayHeight,
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
    return { frame: this.ctx.getImageData(0, 0, w, h), width: w, height: h, release: noop };
  }
}

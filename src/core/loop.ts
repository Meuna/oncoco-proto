import type { VisionAlgorithm } from '../algorithms/types';
import type { AlgoHost } from './algoHost';
import { createCoordMapper } from './coords';
import { FrameSource } from './frameSource';
import type { PerfStats } from './perf';

const MAX_DPR = 2;

export const hasVideoFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

/**
 * Boucle de traitement : une frame à la fois, les frames arrivant pendant
 * un traitement en cours sont sautées.
 */
export class FrameLoop {
  private running = false;
  private handle = 0;
  private inflight: Promise<void> | null = null;
  private loggedErrorGen = -1;
  private readonly source = new FrameSource();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly host: AlgoHost;
  private readonly perf: PerfStats;

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement, host: AlgoHost, perf: PerfStats) {
    this.video = video;
    this.canvas = canvas;
    this.host = host;
    this.perf = perf;
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resizeCanvas()).observe(canvas);
    this.resizeCanvas();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (hasVideoFrameCallback) this.video.cancelVideoFrameCallback(this.handle);
    else cancelAnimationFrame(this.handle);
  }

  /** Résout quand aucun traitement n'est en cours. */
  waitIdle(): Promise<void> {
    return this.inflight ?? Promise.resolve();
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private schedule(): void {
    if (hasVideoFrameCallback) {
      this.handle = this.video.requestVideoFrameCallback((now, meta) =>
        this.tick(now, meta.mediaTime * 1000),
      );
    } else {
      this.handle = requestAnimationFrame((now) => this.tick(now, now));
    }
  }

  private tick(now: number, t: number): void {
    if (!this.running) return;
    this.schedule();
    this.perf.loopFrame(now);

    const algo = this.host.current;
    if (!algo || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (this.inflight) {
      this.perf.dropped++;
      return;
    }
    this.inflight = this.run(algo, this.host.generation, t).finally(() => {
      this.inflight = null;
    });
  }

  private async run(algo: VisionAlgorithm<unknown>, gen: number, t: number): Promise<void> {
    const grabbed = this.source.grab(this.video, algo, t);
    const t0 = performance.now();
    let result: unknown;
    try {
      result = await algo.process(grabbed.frame, t);
    } catch (err) {
      if (this.loggedErrorGen !== gen) {
        this.loggedErrorGen = gen;
        console.error(`[${algo.id}] process a échoué`, err);
      }
      return;
    } finally {
      grabbed.release();
    }
    const dt = performance.now() - t0;
    if (gen !== this.host.generation) return;

    this.perf.processed(dt, grabbed.width, grabbed.height);
    this.clear();
    const map = createCoordMapper(
      grabbed.width,
      grabbed.height,
      this.video.videoWidth,
      this.video.videoHeight,
      this.canvas.width,
      this.canvas.height,
      this.dpr(),
    );
    this.ctx.save();
    try {
      algo.draw(result, this.ctx, map);
    } finally {
      this.ctx.restore();
    }
  }

  private dpr(): number {
    return Math.min(window.devicePixelRatio || 1, MAX_DPR);
  }

  private resizeCanvas(): void {
    const dpr = this.dpr();
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
}

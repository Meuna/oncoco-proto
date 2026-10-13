import type { ActiveAlgorithm, AlgoHost } from './algoHost';
import { createCoordMapper } from './coords';
import { FrameSource } from './frameSource';
import type { PerfStats } from './perf';

const MAX_DPR = 2;

export const hasVideoFrameCallback = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

/**
 * Processing loop: one frame at a time is sent to the worker; frames arriving
 * while one is being processed are skipped. Drawing stays on the main thread.
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

  private async run(algo: ActiveAlgorithm, gen: number, t: number): Promise<void> {
    const t0 = performance.now();
    let reply;
    let grabbed;
    try {
      grabbed = this.source.grab(this.video, algo.entry, t);
      try {
        reply = await this.host.process(gen, grabbed.frame, t, grabbed.transfer);
      } finally {
        grabbed.release();
      }
    } catch (err) {
      if (gen === this.host.generation && this.loggedErrorGen !== gen) {
        this.loggedErrorGen = gen;
        console.error(`[${algo.entry.id}] process failed`, err);
      }
      return;
    }
    const roundTrip = performance.now() - t0;
    if (gen !== this.host.generation) return;

    this.perf.processed(reply.ms, roundTrip, grabbed.width, grabbed.height, reply.stages);
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
      algo.renderer.draw(reply.result, this.ctx, map);
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

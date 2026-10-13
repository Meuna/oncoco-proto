const WINDOW = 30;

export class PerfStats {
  /** Results processed and drawn per second. */
  fps = 0;
  /** Frames seen by the loop per second (camera with rVFC, display with rAF). */
  loopFps = 0;
  /** Moving average of the process time (in the worker) over the last WINDOW frames. */
  processMs = 0;
  /** Same, from frame capture to result reception (capture + transfers + waiting). */
  roundTripMs = 0;
  dropped = 0;
  inputWidth = 0;
  inputHeight = 0;

  private readonly process = new MovingAverage();
  private readonly roundTrip = new MovingAverage();
  /** Per-stage moving averages, in the order reported by the processor. */
  private readonly stages = new Map<string, { avg: MovingAverage; ms: number }>();

  private windowStart = performance.now();
  private processedInWindow = 0;
  private loopInWindow = 0;

  loopFrame(now: number): void {
    this.loopInWindow++;
    const elapsed = now - this.windowStart;
    if (elapsed >= 1000) {
      this.fps = (this.processedInWindow * 1000) / elapsed;
      this.loopFps = (this.loopInWindow * 1000) / elapsed;
      this.processedInWindow = 0;
      this.loopInWindow = 0;
      this.windowStart = now;
    }
  }

  processed(
    ms: number,
    roundTripMs: number,
    inputWidth: number,
    inputHeight: number,
    stages?: Record<string, number>,
  ): void {
    this.processedInWindow++;
    this.inputWidth = inputWidth;
    this.inputHeight = inputHeight;
    this.processMs = this.process.add(ms);
    this.roundTripMs = this.roundTrip.add(roundTripMs);
    if (stages) {
      for (const [name, v] of Object.entries(stages)) {
        let s = this.stages.get(name);
        if (!s) this.stages.set(name, (s = { avg: new MovingAverage(), ms: 0 }));
        s.ms = s.avg.add(v);
      }
    }
  }

  /** Averaged per-stage durations, `[name, ms]`. */
  get stageMs(): [string, number][] {
    return [...this.stages].map(([name, s]) => [name, s.ms]);
  }

  /** Resets the algorithm-specific measurements (on algorithm switch). */
  resetAlgo(): void {
    this.process.reset();
    this.roundTrip.reset();
    this.stages.clear();
    this.processMs = this.roundTripMs = this.fps = 0;
    this.dropped = 0;
    this.inputWidth = this.inputHeight = 0;
    this.processedInWindow = 0;
  }
}

class MovingAverage {
  private readonly samples = new Float64Array(WINDOW);
  private count = 0;
  private index = 0;
  private sum = 0;

  /** Adds a sample and returns the new average. */
  add(v: number): number {
    this.sum += v - (this.count === WINDOW ? this.samples[this.index]! : 0);
    this.samples[this.index] = v;
    this.index = (this.index + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
    return this.sum / this.count;
  }

  reset(): void {
    this.samples.fill(0);
    this.count = this.index = this.sum = 0;
  }
}

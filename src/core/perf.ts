const WINDOW = 30;

export class PerfStats {
  /** Résultats traités et dessinés par seconde. */
  fps = 0;
  /** Frames vues par la boucle par seconde (caméra si rVFC, affichage si rAF). */
  loopFps = 0;
  /** Moyenne glissante du temps de process sur les WINDOW dernières frames. */
  processMs = 0;
  dropped = 0;
  inputWidth = 0;
  inputHeight = 0;

  private readonly samples = new Float64Array(WINDOW);
  private sampleCount = 0;
  private sampleIndex = 0;
  private sampleSum = 0;

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

  processed(ms: number, inputWidth: number, inputHeight: number): void {
    this.processedInWindow++;
    this.inputWidth = inputWidth;
    this.inputHeight = inputHeight;
    this.sampleSum += ms - (this.sampleCount === WINDOW ? this.samples[this.sampleIndex]! : 0);
    this.samples[this.sampleIndex] = ms;
    this.sampleIndex = (this.sampleIndex + 1) % WINDOW;
    if (this.sampleCount < WINDOW) this.sampleCount++;
    this.processMs = this.sampleSum / this.sampleCount;
  }

  /** Remet à zéro les mesures propres à l'algorithme (au changement d'algo). */
  resetAlgo(): void {
    this.samples.fill(0);
    this.sampleCount = this.sampleIndex = this.sampleSum = 0;
    this.processMs = this.fps = 0;
    this.dropped = 0;
    this.inputWidth = this.inputHeight = 0;
    this.processedInWindow = 0;
  }
}

const WINDOW = 30;

export class PerfStats {
  /** Résultats traités et dessinés par seconde. */
  fps = 0;
  /** Frames vues par la boucle par seconde (caméra si rVFC, affichage si rAF). */
  loopFps = 0;
  /** Moyenne glissante du temps de process (dans le worker) sur les WINDOW dernières frames. */
  processMs = 0;
  /** Idem, de la capture de la frame à la réception du résultat (capture + transferts + attente). */
  roundTripMs = 0;
  dropped = 0;
  inputWidth = 0;
  inputHeight = 0;

  private readonly process = new MovingAverage();
  private readonly roundTrip = new MovingAverage();

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

  processed(ms: number, roundTripMs: number, inputWidth: number, inputHeight: number): void {
    this.processedInWindow++;
    this.inputWidth = inputWidth;
    this.inputHeight = inputHeight;
    this.processMs = this.process.add(ms);
    this.roundTripMs = this.roundTrip.add(roundTripMs);
  }

  /** Remet à zéro les mesures propres à l'algorithme (au changement d'algo). */
  resetAlgo(): void {
    this.process.reset();
    this.roundTrip.reset();
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

  /** Ajoute un échantillon et renvoie la nouvelle moyenne. */
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

import type { FrameInput, ParamValues } from '../algorithms/types';
import type { FromWorker, ToWorker } from './workerProtocol';

export interface ProcessReply {
  result: unknown;
  /** Duration of `process` in the worker (excluding transfers). */
  ms: number;
  /** Per-stage durations reported by the processor, if any. */
  stages?: Record<string, number>;
}

interface PendingLoad {
  gen: number;
  resolve(): void;
  reject(err: Error): void;
  onProgress(progress: number | null, message?: string): void;
}

interface PendingProcess {
  resolve(reply: ProcessReply): void;
  reject(err: Error): void;
}

/** Main-thread side of the compute worker: requests → promises. */
export class WorkerClient {
  private readonly worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  private pendingLoad: PendingLoad | null = null;
  private readonly pending = new Map<number, PendingProcess>();
  private seq = 0;
  /** Fatal error (e.g. worker module failed to load): every request fails. */
  private fatal: Error | null = null;

  constructor() {
    this.worker.addEventListener('message', (e: MessageEvent<FromWorker>) => this.onMessage(e.data));
    this.worker.addEventListener('error', (e) => {
      e.preventDefault();
      this.fail(new Error(`Le worker de calcul a échoué${e.message ? ` : ${e.message}` : ''}`));
    });
  }

  /** Replaces the worker's algorithm. A previous unfinished load is rejected. */
  load(id: string, gen: number, params: ParamValues, onProgress: PendingLoad['onProgress']): Promise<void> {
    this.pendingLoad?.reject(new Error('Chargement remplacé'));
    this.pendingLoad = null;
    if (this.fatal) return Promise.reject(this.fatal);
    return new Promise((resolve, reject) => {
      this.pendingLoad = { gen, resolve, reject, onProgress };
      this.post({ type: 'load', gen, id, params });
    });
  }

  /** Updates the parameters of generation `gen` (ignored by the worker if stale). */
  setParams(gen: number, values: ParamValues): void {
    if (this.fatal) return;
    this.post({ type: 'setParams', gen, values });
  }

  /** Objects in `transfer` (ImageData buffer, VideoFrame…) are handed over to the worker. */
  process(gen: number, frame: FrameInput, t: number, transfer: Transferable[]): Promise<ProcessReply> {
    if (this.fatal) return Promise.reject(this.fatal);
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      try {
        this.post({ type: 'process', seq, gen, frame, t }, transfer);
      } catch (err) {
        this.pending.delete(seq);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'progress':
      case 'ready':
      case 'loadError': {
        const load = this.pendingLoad;
        if (!load || load.gen !== msg.gen) return;
        if (msg.type === 'progress') {
          load.onProgress(msg.progress, msg.message);
          return;
        }
        this.pendingLoad = null;
        if (msg.type === 'ready') load.resolve();
        else load.reject(new Error(msg.message));
        return;
      }
      case 'result':
      case 'processError': {
        const p = this.pending.get(msg.seq);
        if (!p) return;
        this.pending.delete(msg.seq);
        if (msg.type === 'result') p.resolve({ result: msg.result, ms: msg.ms, stages: msg.stages });
        else p.reject(new Error(msg.message));
        return;
      }
    }
  }

  private fail(err: Error): void {
    this.fatal = err;
    this.pendingLoad?.reject(err);
    this.pendingLoad = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

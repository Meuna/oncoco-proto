/// Compute worker: runs the `Processor` side of algorithms.
import { algorithms } from './algorithms/registry';
import type { ParamValues, Processor } from './algorithms/types';
import { errorMessage, type FromWorker, type ToWorker } from './core/workerProtocol';

let active: { gen: number; processor: Processor<unknown> } | null = null;
let latestGen = 0;
/** Parameter values of `latestGen`, applied to the processor once it is ready. */
let params: ParamValues = {};
let abort: AbortController | null = null;
/** Pending processing: never dispose a processor mid-computation. */
let busy: Promise<void> = Promise.resolve();

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer });
}

self.addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'load') void load(msg.gen, msg.id, msg.params);
  else if (msg.type === 'setParams') setParams(msg.gen, msg.values);
  else busy = process(msg);
});

function setParams(gen: number, values: ParamValues): void {
  if (gen !== latestGen) return;
  params = values;
  if (active?.gen === gen) safeSetParams(active.processor);
}

async function load(gen: number, id: string, initialParams: ParamValues): Promise<void> {
  latestGen = gen;
  params = initialParams;
  const isStale = () => gen !== latestGen;

  abort?.abort();
  const ctrl = new AbortController();
  abort = ctrl;

  const previous = active;
  active = null;
  if (previous) {
    await busy;
    safeDispose(previous.processor);
  }
  if (isStale()) return;

  let processor: Processor<unknown> | null = null;
  try {
    const entry = algorithms.find((e) => e.id === id);
    if (!entry) throw new Error(`Algorithme inconnu : ${id}`);
    processor = await entry.createProcessor();
    if (isStale()) return;
    await processor.init({
      signal: ctrl.signal,
      onProgress: (progress, message) => {
        if (!isStale()) post({ type: 'progress', gen, progress, message });
      },
    });
    if (isStale()) return;
    // Latest values, including any `setParams` received during loading.
    processor.setParams?.(params);
    active = { gen, processor };
    processor = null; // ownership transferred
    post({ type: 'ready', gen });
  } catch (err) {
    if (isStale()) return;
    console.error(err);
    post({ type: 'loadError', gen, message: errorMessage(err) });
  } finally {
    if (processor) safeDispose(processor);
  }
}

async function process(msg: Extract<ToWorker, { type: 'process' }>): Promise<void> {
  const { seq, gen, frame, t } = msg;
  try {
    if (!active || active.gen !== gen) throw new Error('Algorithme non chargé');
    const { processor } = active;
    const t0 = performance.now();
    const result = await processor.process(frame, t);
    const ms = performance.now() - t0;
    const stages = processor.stageTimings?.();
    post({ type: 'result', seq, result, ms, stages }, processor.transferables?.(result));
  } catch (err) {
    post({ type: 'processError', seq, message: errorMessage(err) });
  } finally {
    if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) frame.close();
  }
}

function safeSetParams(processor: Processor<unknown>): void {
  try {
    processor.setParams?.(params);
  } catch (err) {
    console.error(err);
  }
}

function safeDispose(processor: Processor<unknown>): void {
  try {
    processor.dispose();
  } catch (err) {
    console.error(err);
  }
}

/// Worker de calcul : exécute la partie `Processor` des algorithmes.
import { algorithms } from './algorithms/registry';
import type { Processor } from './algorithms/types';
import { errorMessage, type FromWorker, type ToWorker } from './core/workerProtocol';

let active: { gen: number; processor: Processor<unknown> } | null = null;
let latestGen = 0;
let abort: AbortController | null = null;
/** Traitement en cours : on ne dispose pas un processor en plein calcul. */
let busy: Promise<void> = Promise.resolve();

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer });
}

self.addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'load') void load(msg.gen, msg.id);
  else busy = process(msg);
});

async function load(gen: number, id: string): Promise<void> {
  latestGen = gen;
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
    active = { gen, processor };
    processor = null; // possession transférée
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
    post({ type: 'result', seq, result, ms }, processor.transferables?.(result));
  } catch (err) {
    post({ type: 'processError', seq, message: errorMessage(err) });
  } finally {
    if (typeof VideoFrame !== 'undefined' && frame instanceof VideoFrame) frame.close();
  }
}

function safeDispose(processor: Processor<unknown>): void {
  try {
    processor.dispose();
  } catch (err) {
    console.error(err);
  }
}

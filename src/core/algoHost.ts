import type {
  AlgorithmEntry,
  FrameInput,
  ParamSpec,
  ParamValue,
  ParamValues,
  Renderer,
} from '../algorithms/types';
import { WorkerClient, type ProcessReply } from './workerClient';
import { errorMessage } from './workerProtocol';

const STORAGE_KEY = 'oncoco.algo';
const PARAMS_KEY_PREFIX = 'oncoco.params.';

export interface LoadingState {
  label: string;
  progress: number | null;
  message?: string;
}

export interface AlgoHostOptions {
  onLoading(state: LoadingState | null): void;
  onError(message: string): void;
  onChange(algo: ActiveAlgorithm | null): void;
}

/** Ready algorithm: processor initialized in the worker, renderer on the main thread. */
export interface ActiveAlgorithm {
  entry: AlgorithmEntry;
  renderer: Renderer<unknown>;
}

/** Manages the active algorithm and hot switching. Computation is delegated to a worker. */
export class AlgoHost {
  current: ActiveAlgorithm | null = null;
  /** Incremented on every switch: lets stale results/loads be ignored. */
  generation = 0;
  /** Parameter values of the algorithm being loaded or active. */
  params: ParamValues = {};

  private readonly worker = new WorkerClient();
  private readonly entries: readonly AlgorithmEntry[];
  private readonly opts: AlgoHostOptions;
  private paramsEntry: AlgorithmEntry | null = null;

  constructor(entries: readonly AlgorithmEntry[], opts: AlgoHostOptions) {
    this.entries = entries;
    this.opts = opts;
  }

  /** Saved algorithm if it still exists, otherwise the first one of the registry. */
  initialId(): string | undefined {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage unavailable (private browsing, etc.)
    }
    return this.entries.find((e) => e.id === saved)?.id ?? this.entries[0]?.id;
  }

  async switchTo(id: string): Promise<void> {
    const gen = ++this.generation;
    const isStale = () => gen !== this.generation;

    // A pending `process` for the old algorithm is ignored (stale generation);
    // the worker waits for it to finish before disposing the processor.
    const previous = this.current;
    this.current = null;
    this.opts.onChange(null);
    if (previous) safeDispose(previous.renderer);

    const entry = this.entries.find((e) => e.id === id);
    if (!entry) {
      this.opts.onError(`Algorithme inconnu : ${id}`);
      return;
    }

    this.paramsEntry = entry;
    this.params = loadParams(entry);
    this.opts.onLoading({ label: entry.label, progress: null });
    try {
      await this.worker.load(id, gen, { ...this.params }, (progress, message) => {
        if (!isStale()) this.opts.onLoading({ label: entry.label, progress, message });
      });
      if (isStale()) return;

      this.current = { entry, renderer: entry.createRenderer() };
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignored
      }
      this.opts.onLoading(null);
      this.opts.onChange(this.current);
    } catch (err) {
      if (isStale()) return;
      console.error(err);
      this.opts.onLoading(null);
      this.opts.onError(`Échec d'initialisation de « ${entry.label} » : ${errorMessage(err)}`);
    }
  }

  /** Changes one parameter of the current algorithm, saves it and forwards it to the worker. */
  setParam(key: string, value: ParamValue): void {
    const entry = this.paramsEntry;
    const spec = entry?.params?.find((p) => p.key === key);
    if (!entry || !spec) return;
    const v = sanitize(spec, value);
    if (v === undefined) return;
    this.params = { ...this.params, [key]: v };
    try {
      localStorage.setItem(PARAMS_KEY_PREFIX + entry.id, JSON.stringify(this.params));
    } catch {
      // ignored
    }
    this.worker.setParams(this.generation, { ...this.params });
  }

  /** Processes a frame in the worker with the algorithm of generation `gen`. */
  process(gen: number, frame: FrameInput, t: number, transfer: Transferable[]): Promise<ProcessReply> {
    return this.worker.process(gen, frame, t, transfer);
  }
}

/** Spec defaults, overridden by valid saved values. */
function loadParams(entry: AlgorithmEntry): ParamValues {
  const values: ParamValues = {};
  if (!entry.params) return values;
  let saved: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(PARAMS_KEY_PREFIX + entry.id);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    // storage unavailable or corrupted value: defaults
  }
  for (const spec of entry.params) {
    values[spec.key] = sanitize(spec, saved[spec.key]) ?? spec.default;
  }
  return values;
}

/** Valid value for `spec` (ranges are clamped), or `undefined`. */
function sanitize(spec: ParamSpec, value: unknown): ParamValue | undefined {
  if (spec.type === 'toggle') return typeof value === 'boolean' ? value : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(spec.max, Math.max(spec.min, value));
}

function safeDispose(renderer: Renderer<unknown>): void {
  try {
    renderer.dispose?.();
  } catch (err) {
    console.error(err);
  }
}

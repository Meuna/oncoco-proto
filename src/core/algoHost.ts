import type { AlgorithmEntry, VisionAlgorithm } from '../algorithms/types';

const STORAGE_KEY = 'oncoco.algo';

export interface LoadingState {
  label: string;
  progress: number | null;
  message?: string;
}

export interface AlgoHostOptions {
  /** Résout quand aucun `process` n'est en cours (évite de disposer un algo en plein calcul). */
  waitIdle(): Promise<void>;
  onLoading(state: LoadingState | null): void;
  onError(message: string): void;
  onChange(algo: VisionAlgorithm<unknown> | null): void;
}

/** Gère l'algorithme actif et le changement à chaud. */
export class AlgoHost {
  current: VisionAlgorithm<unknown> | null = null;
  /** Incrémenté à chaque changement : permet d'ignorer les résultats/chargements périmés. */
  generation = 0;

  private abort: AbortController | null = null;
  private readonly entries: readonly AlgorithmEntry[];
  private readonly opts: AlgoHostOptions;

  constructor(entries: readonly AlgorithmEntry[], opts: AlgoHostOptions) {
    this.entries = entries;
    this.opts = opts;
  }

  /** Algorithme mémorisé s'il existe toujours, sinon le premier du registre. */
  initialId(): string | undefined {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // stockage indisponible (navigation privée, etc.)
    }
    return this.entries.find((e) => e.id === saved)?.id ?? this.entries[0]?.id;
  }

  async switchTo(id: string): Promise<void> {
    const gen = ++this.generation;
    const isStale = () => gen !== this.generation;

    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;

    const previous = this.current;
    this.current = null;
    this.opts.onChange(null);
    if (previous) {
      await this.opts.waitIdle();
      safeDispose(previous);
    }
    if (isStale()) return;

    const entry = this.entries.find((e) => e.id === id);
    if (!entry) {
      this.opts.onError(`Algorithme inconnu : ${id}`);
      return;
    }

    this.opts.onLoading({ label: entry.label, progress: null });
    let algo: VisionAlgorithm<unknown> | null = null;
    try {
      algo = await entry.create();
      if (isStale()) return;
      await algo.init({
        signal: abort.signal,
        onProgress: (progress, message) => {
          if (!isStale()) this.opts.onLoading({ label: entry.label, progress, message });
        },
      });
      if (isStale()) return;

      this.current = algo;
      algo = null; // possession transférée
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignoré
      }
      this.opts.onLoading(null);
      this.opts.onChange(this.current);
    } catch (err) {
      if (isStale()) return;
      console.error(err);
      this.opts.onLoading(null);
      this.opts.onError(`Échec d'initialisation de « ${entry.label} » : ${errorMessage(err)}`);
    } finally {
      if (algo) safeDispose(algo);
    }
  }
}

function safeDispose(algo: VisionAlgorithm<unknown>): void {
  try {
    algo.dispose();
  } catch (err) {
    console.error(err);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

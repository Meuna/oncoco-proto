import type { AlgorithmEntry, FrameInput, Renderer } from '../algorithms/types';
import { WorkerClient, type ProcessReply } from './workerClient';
import { errorMessage } from './workerProtocol';

const STORAGE_KEY = 'oncoco.algo';

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

/** Algorithme prêt : processor initialisé dans le worker, renderer sur le thread principal. */
export interface ActiveAlgorithm {
  entry: AlgorithmEntry;
  renderer: Renderer<unknown>;
}

/** Gère l'algorithme actif et le changement à chaud. Le calcul est délégué à un worker. */
export class AlgoHost {
  current: ActiveAlgorithm | null = null;
  /** Incrémenté à chaque changement : permet d'ignorer les résultats/chargements périmés. */
  generation = 0;

  private readonly worker = new WorkerClient();
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

    // Un éventuel `process` en cours pour l'ancien algo est ignoré (génération périmée) ;
    // le worker attend sa fin avant de disposer le processor.
    const previous = this.current;
    this.current = null;
    this.opts.onChange(null);
    if (previous) safeDispose(previous.renderer);

    const entry = this.entries.find((e) => e.id === id);
    if (!entry) {
      this.opts.onError(`Algorithme inconnu : ${id}`);
      return;
    }

    this.opts.onLoading({ label: entry.label, progress: null });
    try {
      await this.worker.load(id, gen, (progress, message) => {
        if (!isStale()) this.opts.onLoading({ label: entry.label, progress, message });
      });
      if (isStale()) return;

      this.current = { entry, renderer: entry.createRenderer() };
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
    }
  }

  /** Traite une frame dans le worker avec l'algorithme de la génération `gen`. */
  process(gen: number, frame: FrameInput, t: number, transfer: Transferable[]): Promise<ProcessReply> {
    return this.worker.process(gen, frame, t, transfer);
  }
}

function safeDispose(renderer: Renderer<unknown>): void {
  try {
    renderer.dispose?.();
  } catch (err) {
    console.error(err);
  }
}

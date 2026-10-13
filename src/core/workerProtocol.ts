import type { FrameInput } from '../algorithms/types';

/** Messages thread principal → worker. */
export type ToWorker =
  /** Dispose le processor courant puis charge `id`. Annule un chargement en cours. */
  | { type: 'load'; gen: number; id: string }
  | { type: 'process'; seq: number; gen: number; frame: FrameInput; t: number };

/** Messages worker → thread principal. Chaque `process` reçoit exactement une réponse. */
export type FromWorker =
  | { type: 'progress'; gen: number; progress: number | null; message?: string }
  | { type: 'ready'; gen: number }
  | { type: 'loadError'; gen: number; message: string }
  /** `ms` : durée de `process` mesurée dans le worker. */
  | { type: 'result'; seq: number; result: unknown; ms: number }
  | { type: 'processError'; seq: number; message: string };

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import type { FrameInput, ParamValues } from '../algorithms/types';

/** Messages main thread → worker. */
export type ToWorker =
  /** Disposes the current processor then loads `id`. Cancels a pending load. */
  | { type: 'load'; gen: number; id: string; params: ParamValues }
  /** Replaces the parameter values of generation `gen`. */
  | { type: 'setParams'; gen: number; values: ParamValues }
  | { type: 'process'; seq: number; gen: number; frame: FrameInput; t: number };

/** Messages worker → main thread. Each `process` gets exactly one reply. */
export type FromWorker =
  | { type: 'progress'; gen: number; progress: number | null; message?: string }
  | { type: 'ready'; gen: number }
  | { type: 'loadError'; gen: number; message: string }
  /** `ms`: duration of `process` measured in the worker. `stages`: per-stage durations, if reported. */
  | { type: 'result'; seq: number; result: unknown; ms: number; stages?: Record<string, number> }
  | { type: 'processError'; seq: number; message: string };

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

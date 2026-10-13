/** Input formats a processor can receive (`null` when `input: 'none'`). */
export type FrameInput = ImageData | VideoFrame | null;

/**
 * Maps coordinates of the input (space of the frame passed to `process`)
 * to overlay canvas pixels, accounting for the `object-fit: cover` crop.
 */
export interface CoordMapper {
  /** Size of the frame passed to `process` (possibly downscaled). */
  readonly srcWidth: number;
  readonly srcHeight: number;
  /** Canvas pixels per source pixel, per axis (equal up to rounding). */
  readonly scaleX: number;
  readonly scaleY: number;
  /** Mean of scaleX/scaleY: converts lengths (radii, thicknesses). */
  readonly scale: number;
  /** Canvas pixels / CSS pixels ratio: for line widths that stay constant on screen. */
  readonly dpr: number;
  toScreen(x: number, y: number): { x: number; y: number };
  /** Applies the transform to the context: you can then draw in source coordinates. */
  applyTransform(ctx: CanvasRenderingContext2D): void;
}

export interface InitContext {
  /** Aborted if the user switches algorithm during loading. */
  signal: AbortSignal;
  /** Loading progress: `p` in [0, 1], or `null` when indeterminate. */
  onProgress(p: number | null, message?: string): void;
}

export type ParamValue = number | boolean;
export type ParamValues = Record<string, ParamValue>;

/** A user-tunable parameter, rendered as a control in the params panel. */
export type ParamSpec =
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'toggle'; default: boolean };

/** Compute side, runs in the worker. */
export interface Processor<R> {
  init(ctx: InitContext): Promise<void>;
  process(frame: FrameInput, t: number): Promise<R> | R;
  /**
   * Result objects to transfer (without copy) to the main thread.
   * They become unusable in the worker afterwards: don't reuse them across frames.
   */
  transferables?(result: R): Transferable[];
  /**
   * Current values of the entry's `params`. Called after `init`, before the first
   * `process`, then on every change.
   */
  setParams?(values: Readonly<ParamValues>): void;
  /**
   * Per-stage durations (ms) of the last `process`. Insertion order is display order
   * in the perf overlay.
   */
  stageTimings?(): Record<string, number>;
  dispose(): void;
}

/** Drawing side, runs on the main thread. */
export interface Renderer<R> {
  draw(result: R, ctx: CanvasRenderingContext2D, map: CoordMapper): void;
  dispose?(): void;
}

export interface AlgorithmEntry<R = unknown> {
  id: string;
  label: string;
  /** Input format sent to the worker. Default: 'imageData'. 'none': no frame. */
  input?: 'imageData' | 'videoFrame' | 'none';
  /** Max width of the provided ImageData (downscaled by the core, aspect ratio kept). */
  maxInputWidth?: number;
  /** Execution backend shown in the perf overlay (e.g. 'js-cpu', 'wasm', 'webgpu'). */
  backend?: string;
  /** Tunable parameters exposed in the UI, passed to `Processor.setParams`. */
  params?: readonly ParamSpec[];
  /**
   * Called in the worker only. Prefer a dynamic `import()`: the compute code is then
   * loaded by the worker only, on demand.
   */
  createProcessor(): Processor<R> | Promise<Processor<R>>;
  /** Called on the main thread, once the processor is ready. */
  createRenderer(): Renderer<R>;
}

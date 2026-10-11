/** Formats d'entrée qu'un algorithme peut recevoir. */
export type FrameInput = ImageData | VideoFrame | HTMLVideoElement;

/**
 * Projection des coordonnées de l'entrée (espace de la frame passée à `process`)
 * vers les pixels du canvas overlay, en tenant compte du recadrage `object-fit: cover`.
 */
export interface CoordMapper {
  /** Dimensions de la frame passée à `process` (éventuellement réduite). */
  readonly srcWidth: number;
  readonly srcHeight: number;
  /** Pixels canvas par pixel source, par axe (égaux à l'arrondi près). */
  readonly scaleX: number;
  readonly scaleY: number;
  /** Moyenne de scaleX/scaleY : pour convertir des longueurs (rayons, épaisseurs). */
  readonly scale: number;
  /** Ratio pixels canvas / pixels CSS : pour des épaisseurs de trait constantes à l'écran. */
  readonly dpr: number;
  toScreen(x: number, y: number): { x: number; y: number };
  /** Applique la transformation au contexte : on peut ensuite dessiner en coordonnées source. */
  applyTransform(ctx: CanvasRenderingContext2D): void;
}

export interface InitContext {
  /** Annulé si l'utilisateur change d'algorithme pendant le chargement. */
  signal: AbortSignal;
  /** Progression du chargement : `p` dans [0, 1], ou `null` si indéterminée. */
  onProgress(p: number | null, message?: string): void;
}

export interface VisionAlgorithm<R> {
  id: string;
  label: string;
  /** Format d'entrée souhaité. Défaut : 'imageData'. */
  input?: 'imageData' | 'videoFrame' | 'video';
  /** Largeur max de l'ImageData fournie (réduction côté cœur, ratio conservé). */
  maxInputWidth?: number;
  /** Backend d'exécution affiché dans l'overlay perf (ex. 'js-cpu', 'wasm', 'webgpu'). */
  backend?: string;
  init(ctx?: InitContext): Promise<void>;
  process(frame: FrameInput, t: number): Promise<R> | R;
  draw(result: R, ctx: CanvasRenderingContext2D, map: CoordMapper): void;
  dispose(): void;
}

export interface AlgorithmEntry {
  id: string;
  label: string;
  /** Peut être asynchrone pour charger le module à la demande (`import()`). */
  create(): VisionAlgorithm<unknown> | Promise<VisionAlgorithm<unknown>>;
}

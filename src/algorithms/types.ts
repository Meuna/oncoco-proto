/** Formats d'entrée qu'un processor peut recevoir (`null` si `input: 'none'`). */
export type FrameInput = ImageData | VideoFrame | null;

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

/** Partie calcul, exécutée dans le worker. */
export interface Processor<R> {
  init(ctx: InitContext): Promise<void>;
  process(frame: FrameInput, t: number): Promise<R> | R;
  /**
   * Objets du résultat à transférer (sans copie) vers le thread principal.
   * Ils sont inutilisables dans le worker ensuite : ne pas les réutiliser d'une frame à l'autre.
   */
  transferables?(result: R): Transferable[];
  dispose(): void;
}

/** Partie dessin, exécutée sur le thread principal. */
export interface Renderer<R> {
  draw(result: R, ctx: CanvasRenderingContext2D, map: CoordMapper): void;
  dispose?(): void;
}

export interface AlgorithmEntry<R = unknown> {
  id: string;
  label: string;
  /** Format d'entrée envoyé au worker. Défaut : 'imageData'. 'none' : aucune frame. */
  input?: 'imageData' | 'videoFrame' | 'none';
  /** Largeur max de l'ImageData fournie (réduction côté cœur, ratio conservé). */
  maxInputWidth?: number;
  /** Backend d'exécution affiché dans l'overlay perf (ex. 'js-cpu', 'wasm', 'webgpu'). */
  backend?: string;
  /**
   * Appelé dans le worker uniquement. Préférer un `import()` dynamique : le code de calcul
   * n'est alors chargé que par le worker, à la demande.
   */
  createProcessor(): Processor<R> | Promise<Processor<R>>;
  /** Appelé sur le thread principal, une fois le processor prêt. */
  createRenderer(): Renderer<R>;
}

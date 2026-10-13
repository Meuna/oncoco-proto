import { assertImageData, boxBlur3, Buffers, sobel, toGray } from './lib/imageOps';
import type { FrameInput, Processor } from './types';

const ID = 'hough-circles';

export interface Circle {
  x: number;
  y: number;
  r: number;
  /** Fraction des secteurs angulaires couverts par des contours cohérents, dans [0, 1]. */
  score: number;
}

const MAX_EDGES = 8000;
const MAX_CANDIDATES = 24;
const MAX_CIRCLES = 5;
const EDGE_PERCENTILE = 0.9;
const MIN_EDGE_MAG = 60;
const MIN_SCORE = 0.7;
const SECTORS = 36;
const RADIUS_TOLERANCE = 1.5;
/** Cosinus minimal entre gradient et direction radiale pour qu'un contour soutienne un cercle. */
const RADIAL_COS = 0.9;

/**
 * Détection de cercles par transformée de Hough à gradient (à la manière de
 * HOUGH_GRADIENT d'OpenCV, en très simplifié) :
 * 1. contours : Sobel sur image floutée, seuil au percentile de magnitude ;
 * 2. vote des centres le long de la direction du gradient (2D, sans dimension rayon) ;
 * 3. pour chaque centre candidat, histogramme des distances aux contours radiaux → rayon ;
 * 4. score = couverture angulaire du cercle, puis suppression des doublons.
 */
export class HoughCirclesProcessor implements Processor<Circle[]> {
  private buf = new Buffers();
  private acc = new Uint16Array(0);
  private edges = new Int32Array(MAX_EDGES);
  private hist = new Float32Array(0);
  private magHist = new Uint32Array(1500);
  private sectors = new Uint8Array(SECTORS);

  async init(): Promise<void> {}

  process(frame: FrameInput): Circle[] {
    assertImageData(frame, ID);
    const { width: w, height: h } = frame;
    const b = this.buf;
    b.ensure(w, h);
    if (this.acc.length !== w * h) this.acc = new Uint16Array(w * h);

    const rMin = Math.max(6, Math.round(Math.min(w, h) * 0.04));
    const rMax = Math.round(Math.min(w, h) * 0.45);
    if (this.hist.length < rMax + 2) this.hist = new Float32Array(rMax + 2);

    toGray(frame, b.gray);
    boxBlur3(b.gray, b.blur, w, h);
    sobel(b.blur, w, h, b.gx, b.gy, b.mag);

    const edgeCount = this.collectEdges(w, h);
    if (edgeCount === 0) return [];

    this.voteCenters(edgeCount, w, h, rMin, rMax);
    const candidates = this.findPeaks(w, h, rMin);

    const circles: Circle[] = [];
    for (const c of candidates) {
      const circle = this.estimateRadius(c.x, c.y, edgeCount, w, rMin, rMax);
      if (circle && circle.score >= MIN_SCORE) circles.push(circle);
    }
    return suppressDuplicates(circles);
  }

  /** Seuil adaptatif au percentile, sous-échantillonnage si trop de points. */
  private collectEdges(w: number, h: number): number {
    const { mag } = this.buf;
    const hist = this.magHist;
    hist.fill(0);
    const top = hist.length - 1;
    for (let i = 0; i < mag.length; i++) hist[Math.min(top, mag[i]! | 0)]!++;

    let target = mag.length * EDGE_PERCENTILE;
    let thr = 0;
    while (thr < top && target > 0) target -= hist[thr++]!;
    thr = Math.max(thr, MIN_EDGE_MAG);

    let total = 0;
    for (let v = thr; v <= top; v++) total += hist[v]!;
    const stride = Math.max(1, Math.ceil(total / MAX_EDGES));

    let n = 0;
    let seen = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mag[i]! < thr) continue;
        if (seen++ % stride !== 0 || n >= MAX_EDGES) continue;
        this.edges[n++] = i;
      }
    }
    return n;
  }

  private voteCenters(edgeCount: number, w: number, h: number, rMin: number, rMax: number): void {
    const { gx, gy, mag } = this.buf;
    const acc = this.acc;
    acc.fill(0);
    for (let k = 0; k < edgeCount; k++) {
      const i = this.edges[k]!;
      const x = i % w;
      const y = (i / w) | 0;
      const m = mag[i]!;
      const dx = gx[i]! / m;
      const dy = gy[i]! / m;
      // Le centre peut être de part et d'autre du contour (objet clair ou sombre).
      for (const s of [1, -1]) {
        for (let r = rMin; r <= rMax; r++) {
          const cx = Math.round(x + s * r * dx);
          const cy = Math.round(y + s * r * dy);
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
          const j = cy * w + cx;
          if (acc[j]! < 0xffff) acc[j]!++;
        }
      }
    }
  }

  /** Maxima locaux (fenêtre 5×5) de l'accumulateur, triés par votes. */
  private findPeaks(w: number, h: number, rMin: number): { x: number; y: number; votes: number }[] {
    const acc = this.acc;
    const minVotes = Math.max(12, Math.round(Math.PI * rMin * 0.5));
    const peaks: { x: number; y: number; votes: number }[] = [];
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const v = acc[y * w + x]!;
        if (v < minVotes) continue;
        let isMax = true;
        for (let oy = -2; oy <= 2 && isMax; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const n = acc[(y + oy) * w + x + ox]!;
            // Départage des plateaux : strictement supérieur aux voisins « précédents ».
            if (n > v || (n === v && (oy < 0 || (oy === 0 && ox < 0)))) {
              isMax = false;
              break;
            }
          }
        }
        if (isMax) peaks.push({ x, y, votes: v });
      }
    }
    peaks.sort((a, b) => b.votes - a.votes);
    return peaks.slice(0, MAX_CANDIDATES);
  }

  private estimateRadius(
    cx: number,
    cy: number,
    edgeCount: number,
    w: number,
    rMin: number,
    rMax: number,
  ): Circle | null {
    const { gx, gy, mag } = this.buf;
    const hist = this.hist;
    hist.fill(0);
    for (let k = 0; k < edgeCount; k++) {
      const i = this.edges[k]!;
      const ex = (i % w) - cx;
      const ey = ((i / w) | 0) - cy;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < rMin || d > rMax) continue;
      const cos = Math.abs((ex * gx[i]! + ey * gy[i]!) / (d * mag[i]!));
      if (cos >= RADIAL_COS) hist[Math.round(d)]!++;
    }

    // Rayon : pic du support radial normalisé par la circonférence.
    let bestR = 0;
    let bestRatio = 0;
    for (let r = rMin; r <= rMax; r++) {
      const ratio = (hist[r - 1]! + hist[r]! + hist[r + 1]!) / r;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestR = r;
      }
    }
    if (bestR === 0) return null;

    // Score : fraction des secteurs angulaires contenant un contour radial à ce rayon.
    // Un arc tangent ou un segment ne couvre qu'une petite partie du cercle.
    const sectors = this.sectors;
    sectors.fill(0);
    for (let k = 0; k < edgeCount; k++) {
      const i = this.edges[k]!;
      const ex = (i % w) - cx;
      const ey = ((i / w) | 0) - cy;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (Math.abs(d - bestR) > RADIUS_TOLERANCE) continue;
      const cos = Math.abs((ex * gx[i]! + ey * gy[i]!) / (d * mag[i]!));
      if (cos < RADIAL_COS) continue;
      const a = Math.atan2(ey, ex) + Math.PI;
      sectors[Math.min(SECTORS - 1, ((a / (2 * Math.PI)) * SECTORS) | 0)] = 1;
    }
    let covered = 0;
    for (let s = 0; s < SECTORS; s++) covered += sectors[s]!;
    return { x: cx, y: cy, r: bestR, score: covered / SECTORS };
  }

  dispose(): void {
    this.buf = new Buffers();
    this.acc = new Uint16Array(0);
    this.hist = new Float32Array(0);
  }
}

/** Garde le meilleur cercle quand plusieurs se recouvrent fortement. */
function suppressDuplicates(circles: Circle[]): Circle[] {
  circles.sort((a, b) => b.score - a.score);
  const kept: Circle[] = [];
  for (const c of circles) {
    const dup = kept.some(
      (k) => Math.hypot(k.x - c.x, k.y - c.y) < Math.min(k.r, c.r) * 0.5 && Math.abs(k.r - c.r) < Math.max(k.r, c.r) * 0.3,
    );
    if (!dup) kept.push(c);
    if (kept.length >= MAX_CIRCLES) break;
  }
  return kept;
}

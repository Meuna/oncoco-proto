import { houghCircles } from './houghCircles';
import { passthrough } from './passthrough';
import { sobel } from './sobel';
import type { AlgorithmEntry } from './types';

/**
 * Algorithmes proposés dans l'UI, dans l'ordre d'affichage.
 * Le premier est sélectionné par défaut. Seul ce fichier connaît les algos concrets.
 */
export const algorithms: readonly AlgorithmEntry[] = [passthrough, sobel, houghCircles];

import { canny } from './canny';
import { houghCircles } from './houghCircles';
import { passthrough } from './passthrough';
import { sobel } from './sobel';
import type { AlgorithmEntry } from './types';

/**
 * Algorithms offered in the UI, in display order.
 * The first one is selected by default. Only this file knows the concrete algorithms.
 */
export const algorithms: readonly AlgorithmEntry[] = [passthrough, sobel, canny, houghCircles];

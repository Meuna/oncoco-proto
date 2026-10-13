import type { AlgorithmEntry } from './types';

/** Aucun traitement ni copie de pixels : mesure le coût de la boucle et de l'aller-retour worker. */
export const passthrough: AlgorithmEntry<null> = {
  id: 'passthrough',
  label: 'Passthrough (référence)',
  input: 'none',
  backend: 'none',
  createProcessor: () => ({ init: async () => {}, process: () => null, dispose: () => {} }),
  createRenderer: () => ({ draw: () => {} }),
};

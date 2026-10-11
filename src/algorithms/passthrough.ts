import type { AlgorithmEntry, VisionAlgorithm } from './types';

const ID = 'passthrough';
const LABEL = 'Passthrough (référence)';

/** Aucun traitement ni copie de pixels : mesure le coût de la boucle seule. */
class Passthrough implements VisionAlgorithm<null> {
  id = ID;
  label = LABEL;
  input = 'video' as const;
  backend = 'none';

  async init(): Promise<void> {}

  process(): null {
    return null;
  }

  draw(): void {}

  dispose(): void {}
}

export const passthrough: AlgorithmEntry = { id: ID, label: LABEL, create: () => new Passthrough() };

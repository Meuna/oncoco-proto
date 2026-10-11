import type { LoadingState } from '../core/algoHost';

export interface AlgoOption {
  id: string;
  label: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function createUI(root: HTMLElement, options: readonly AlgoOption[]) {
  const video = el('video', { id: 'video', muted: true, autoplay: true, playsInline: true });
  // Attributs explicites : requis par Safari iOS pour la lecture inline sans geste.
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');

  const canvas = el('canvas', { id: 'overlay' });

  const startButton = el('button', { className: 'primary', type: 'button' }, ['Démarrer la caméra']);
  const startMessage = el('p', { className: 'start-message' });
  const startScreen = el('div', { id: 'start-screen' }, [
    el('h1', {}, ['oncoco proto']),
    startMessage,
    startButton,
  ]);

  const select = el(
    'select',
    { id: 'algo-select', ariaLabel: 'Algorithme' },
    options.map((o) => el('option', { value: o.id }, [o.label])),
  );
  const perfToggle = el('button', { type: 'button', className: 'icon', title: 'Overlay perf' }, ['⏱']);
  const toolbar = el('div', { id: 'toolbar' }, [select, perfToggle]);

  const perfPanel = el('pre', { id: 'perf' });

  const loaderText = el('span');
  const loaderBar = el('progress', { max: 1 });
  const loader = el('div', { id: 'loader', hidden: true }, [el('span', { className: 'spinner' }), loaderText, loaderBar]);

  const toast = el('div', { id: 'toast', hidden: true, role: 'alert' });
  let toastTimer = 0;

  root.append(video, canvas, perfPanel, toolbar, loader, toast, startScreen);

  return {
    video,
    canvas,
    select,
    perfToggle,
    perfPanel,
    startButton,

    showStart(message = '', buttonLabel = 'Démarrer la caméra') {
      startMessage.textContent = message;
      startButton.textContent = buttonLabel;
      startButton.disabled = false;
      startScreen.hidden = false;
    },

    hideStart() {
      startScreen.hidden = true;
    },

    setStarting(starting: boolean) {
      startButton.disabled = starting;
      if (starting) startMessage.textContent = 'Ouverture de la caméra…';
    },

    setLoading(state: LoadingState | null) {
      loader.hidden = state === null;
      if (!state) return;
      const pct = state.progress === null ? '' : ` ${Math.round(state.progress * 100)} %`;
      loaderText.textContent = `${state.message ?? `Chargement de ${state.label}`}${pct}`;
      // Une <progress> sans valeur est indéterminée.
      if (state.progress === null) loaderBar.removeAttribute('value');
      else loaderBar.value = state.progress;
    },

    showError(message: string) {
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => (toast.hidden = true), 6000);
    },

    togglePerf(): boolean {
      perfPanel.hidden = !perfPanel.hidden;
      perfToggle.classList.toggle('off', perfPanel.hidden);
      return !perfPanel.hidden;
    },
  };
}

export type UI = ReturnType<typeof createUI>;

import type { ParamSpec, ParamValue, ParamValues } from '../algorithms/types';
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
  // Explicit attributes: required by iOS Safari for inline playback without a gesture.
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
  const paramsToggle = el('button', { type: 'button', className: 'icon off', title: 'Paramètres', hidden: true }, ['⚙']);
  const perfToggle = el('button', { type: 'button', className: 'icon', title: 'Overlay perf' }, ['⏱']);
  const toolbar = el('div', { id: 'toolbar' }, [select, paramsToggle, perfToggle]);

  const paramsPanel = el('div', { id: 'params', hidden: true });
  paramsToggle.addEventListener('click', () => {
    paramsPanel.hidden = !paramsPanel.hidden;
    paramsToggle.classList.toggle('off', paramsPanel.hidden);
  });

  const perfPanel = el('pre', { id: 'perf' });

  const loaderText = el('span');
  const loaderBar = el('progress', { max: 1 });
  const loader = el('div', { id: 'loader', hidden: true }, [el('span', { className: 'spinner' }), loaderText, loaderBar]);

  const toast = el('div', { id: 'toast', hidden: true, role: 'alert' });
  let toastTimer = 0;

  root.append(video, canvas, perfPanel, paramsPanel, toolbar, loader, toast, startScreen);

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
      // A <progress> without a value is indeterminate.
      if (state.progress === null) loaderBar.removeAttribute('value');
      else loaderBar.value = state.progress;
    },

    showError(message: string) {
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => (toast.hidden = true), 6000);
    },

    /** Rebuilds the params panel; hides it and its button when `specs` is empty. */
    setParams(
      specs: readonly ParamSpec[] | null | undefined,
      values: Readonly<ParamValues>,
      onChange: (key: string, value: ParamValue) => void,
    ) {
      paramsPanel.replaceChildren(...(specs ?? []).map((spec) => paramControl(spec, values, onChange)));
      const has = paramsPanel.childElementCount > 0;
      paramsToggle.hidden = !has;
      if (!has) paramsPanel.hidden = true;
    },

    togglePerf(): boolean {
      perfPanel.hidden = !perfPanel.hidden;
      perfToggle.classList.toggle('off', perfPanel.hidden);
      return !perfPanel.hidden;
    },
  };
}

function paramControl(
  spec: ParamSpec,
  values: Readonly<ParamValues>,
  onChange: (key: string, value: ParamValue) => void,
): HTMLElement {
  const value = values[spec.key] ?? spec.default;
  if (spec.type === 'toggle') {
    const input = el('input', { type: 'checkbox', checked: value === true });
    input.addEventListener('change', () => onChange(spec.key, input.checked));
    return el('label', { className: 'param toggle' }, [input, el('span', {}, [spec.label])]);
  }
  const input = el('input', {
    type: 'range',
    min: String(spec.min),
    max: String(spec.max),
    step: String(spec.step),
    value: String(value),
  });
  const decimals = (String(spec.step).split('.')[1] ?? '').length;
  const output = el('output', {}, [Number(value).toFixed(decimals)]);
  input.addEventListener('input', () => {
    const v = input.valueAsNumber;
    output.textContent = v.toFixed(decimals);
    onChange(spec.key, v);
  });
  return el('label', { className: 'param range' }, [el('span', {}, [spec.label]), output, input]);
}

export type UI = ReturnType<typeof createUI>;

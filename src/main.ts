import './style.css';
import { algorithms } from './algorithms/registry';
import { AlgoHost } from './core/algoHost';
import { CameraError, startCamera, stopStream } from './core/camera';
import { FrameLoop, hasVideoFrameCallback } from './core/loop';
import { PerfStats } from './core/perf';
import { createUI } from './ui/dom';

const ui = createUI(document.querySelector<HTMLDivElement>('#app')!, algorithms);
const perf = new PerfStats();

// `loop` is created right after: callbacks are only called from the first switchTo.
let loop: FrameLoop;
const host = new AlgoHost(algorithms, {
  onLoading: (state) => ui.setLoading(state),
  onError: (message) => ui.showError(message),
  onChange: (algo) => {
    perf.resetAlgo();
    loop.clear();
    if (algo) ui.select.value = algo.entry.id;
    ui.setParams(algo?.entry.params, host.params, (key, value) => host.setParam(key, value));
  },
});
loop = new FrameLoop(ui.video, ui.canvas, host, perf);

let stream: MediaStream | null = null;

async function onStart(): Promise<void> {
  ui.setStarting(true);
  try {
    stream = await startCamera(ui.video);
  } catch (err) {
    const message = err instanceof CameraError ? err.message : String(err);
    ui.showStart(message, 'Réessayer');
    return;
  }
  for (const track of stream.getVideoTracks()) {
    // iOS stops the camera when the app goes to the background.
    track.addEventListener('ended', onCameraLost, { once: true });
  }
  ui.hideStart();
  loop.start();
}

function onCameraLost(): void {
  loop.stop();
  loop.clear();
  if (stream) stopStream(stream);
  stream = null;
  ui.video.srcObject = null;
  ui.showStart('La caméra a été interrompue.', 'Relancer la caméra');
}

ui.startButton.addEventListener('click', () => void onStart());

ui.select.addEventListener('change', () => void host.switchTo(ui.select.value));

ui.perfToggle.addEventListener('click', () => ui.togglePerf());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !stream) return;
  if (stream.getVideoTracks().every((t) => t.readyState === 'ended')) onCameraLost();
});

window.addEventListener('pagehide', () => {
  if (stream) stopStream(stream);
});

setInterval(() => {
  if (ui.perfPanel.hidden) return;
  const algo = host.current;
  const v = ui.video;
  const src = v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '—';
  const input =
    perf.inputWidth && (perf.inputWidth !== v.videoWidth || perf.inputHeight !== v.videoHeight)
      ? ` → ${perf.inputWidth}×${perf.inputHeight}`
      : '';
  ui.perfPanel.textContent = [
    `FPS   ${perf.fps.toFixed(1)} (${hasVideoFrameCallback ? 'cam' : 'raf'} ${perf.loopFps.toFixed(1)})`,
    `proc  ${perf.processMs.toFixed(1)} ms (worker, moy. 30)`,
    `rtt   ${perf.roundTripMs.toFixed(1)} ms`,
    `drop  ${perf.dropped}`,
    `src   ${src}${input}`,
    `back  ${algo ? (algo.entry.backend ?? '?') : '—'}`,
    ...perf.stageMs.map(([name, ms]) => `  ${name.padEnd(6)} ${ms.toFixed(1)} ms`),
  ].join('\n');
}, 250);

// Load the algorithm right away: its assets load while the user grants
// camera access.
const initialId = host.initialId();
if (initialId) {
  ui.select.value = initialId;
  void host.switchTo(initialId);
}
ui.showStart();

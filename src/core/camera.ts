export type CameraErrorKind =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-camera'
  | 'in-use'
  | 'unknown';

const MESSAGES: Record<CameraErrorKind, string> = {
  'insecure-context':
    'Contexte non sécurisé : la caméra exige HTTPS (ou localhost). Voir le README pour tester sur mobile.',
  unsupported: "Ce navigateur n'expose pas l'API caméra (getUserMedia).",
  'permission-denied':
    "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur puis réessayez.",
  'no-camera': 'Aucune caméra compatible détectée.',
  'in-use': 'La caméra est indisponible (utilisée par une autre application ?).',
  unknown: "Impossible d'accéder à la caméra.",
};

export class CameraError extends Error {
  readonly kind: CameraErrorKind;

  constructor(kind: CameraErrorKind, detail?: string) {
    super(detail ? `${MESSAGES[kind]} (${detail})` : MESSAGES[kind]);
    this.name = 'CameraError';
    this.kind = kind;
  }
}

function toCameraError(err: unknown): CameraError {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new CameraError('permission-denied');
      case 'NotFoundError':
      case 'OverconstrainedError':
        return new CameraError('no-camera');
      case 'NotReadableError':
      case 'AbortError':
        return new CameraError('in-use');
    }
    return new CameraError('unknown', `${err.name}: ${err.message}`);
  }
  return new CameraError('unknown', String(err));
}

/** Doit être appelé depuis un geste utilisateur (exigence iOS). */
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!window.isSecureContext) throw new CameraError('insecure-context');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    throw toCameraError(err);
  }

  video.srcObject = stream;
  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve) =>
        video.addEventListener('loadedmetadata', () => resolve(), { once: true }),
      );
    }
    await video.play();
  } catch (err) {
    stopStream(stream);
    video.srcObject = null;
    throw toCameraError(err);
  }
  return stream;
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

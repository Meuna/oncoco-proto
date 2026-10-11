/** Opérations image de base, en JS pur, sur buffers préalloués. */

/** Luminance entière (BT.601 approx.) : RGBA → niveaux de gris. */
export function toGray(img: ImageData, out: Uint8Array): void {
  const d = img.data;
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (77 * d[i]! + 150 * d[i + 1]! + 29 * d[i + 2]!) >> 8;
  }
}

/** Flou boîte 3×3 (les bords sont recopiés). */
export function boxBlur3(src: Uint8Array, dst: Uint8Array, w: number, h: number): void {
  dst.set(src);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      dst[i] =
        (src[i - w - 1]! + src[i - w]! + src[i - w + 1]! +
          src[i - 1]! + src[i]! + src[i + 1]! +
          src[i + w - 1]! + src[i + w]! + src[i + w + 1]!) / 9;
    }
  }
}

/**
 * Gradient de Sobel. Écrit gx, gy et la magnitude euclidienne (bords à 0).
 * Magnitude max théorique ≈ 1442 pour une entrée 8 bits.
 */
export function sobel(
  gray: Uint8Array,
  w: number,
  h: number,
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
): void {
  mag.fill(0);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1]!, t = gray[i - w]!, tr = gray[i - w + 1]!;
      const l = gray[i - 1]!, r = gray[i + 1]!;
      const bl = gray[i + w - 1]!, b = gray[i + w]!, br = gray[i + w + 1]!;
      const dx = tr + 2 * r + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);
      gx[i] = dx;
      gy[i] = dy;
      mag[i] = Math.sqrt(dx * dx + dy * dy);
    }
  }
}

/** Buffers de travail redimensionnés seulement quand la taille change. */
export class Buffers {
  width = 0;
  height = 0;
  gray = new Uint8Array(0);
  blur = new Uint8Array(0);
  gx = new Float32Array(0);
  gy = new Float32Array(0);
  mag = new Float32Array(0);

  ensure(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    const n = w * h;
    this.width = w;
    this.height = h;
    this.gray = new Uint8Array(n);
    this.blur = new Uint8Array(n);
    this.gx = new Float32Array(n);
    this.gy = new Float32Array(n);
    this.mag = new Float32Array(n);
  }
}

export function assertImageData(frame: unknown, algoId: string): asserts frame is ImageData {
  if (!(frame instanceof ImageData)) throw new Error(`${algoId} attend une ImageData`);
}

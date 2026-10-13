/** Basic image operations, in plain JS, on preallocated buffers. */

/** Integer luminance (approx. BT.601): RGBA → grayscale. */
export function toGray(img: ImageData, out: Uint8Array): void {
  const d = img.data;
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (77 * d[i]! + 150 * d[i + 1]! + 29 * d[i + 2]!) >> 8;
  }
}

/** Deinterleaves RGBA into three channel planes (alpha is dropped). */
export function splitRGB(img: ImageData, r: Uint8Array, g: Uint8Array, b: Uint8Array): void {
  const d = img.data;
  for (let i = 0, p = 0; p < r.length; i += 4, p++) {
    r[p] = d[i]!;
    g[p] = d[i + 1]!;
    b[p] = d[i + 2]!;
  }
}

/** 3×3 box blur (borders are copied). */
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

/** Below this sigma the kernel is (almost) a Dirac: the blur is a plain copy. */
const MIN_SIGMA = 0.3;
let kernelSigma = -1;
let kernel = new Float32Array(0);

/** Normalized 1D Gaussian kernel of radius ceil(3σ), cached for the last sigma. */
function gaussianKernel(sigma: number): Float32Array {
  if (sigma === kernelSigma) return kernel;
  const r = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * r + 1);
  const s2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / s2);
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum;
  kernelSigma = sigma;
  kernel = k;
  return k;
}

/**
 * Separable Gaussian blur (clamped borders). `tmp` holds the horizontal pass
 * and must have `w * h` elements.
 */
export function gaussianBlur(
  src: Uint8Array,
  dst: Uint8Array,
  w: number,
  h: number,
  sigma: number,
  tmp: Float32Array,
): void {
  if (!(sigma >= MIN_SIGMA)) {
    dst.set(src);
    return;
  }
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) >> 1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      if (x >= r && x < w - r) {
        for (let j = -r, base = row + x; j <= r; j++) acc += k[j + r]! * src[base + j]!;
      } else {
        for (let j = -r; j <= r; j++) {
          const xx = x + j < 0 ? 0 : x + j >= w ? w - 1 : x + j;
          acc += k[j + r]! * src[row + xx]!;
        }
      }
      tmp[row + x] = acc;
    }
  }

  for (let y = 0; y < h; y++) {
    const inside = y >= r && y < h - r;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      if (inside) {
        for (let j = -r, i = (y - r) * w + x; j <= r; j++, i += w) acc += k[j + r]! * tmp[i]!;
      } else {
        for (let j = -r; j <= r; j++) {
          const yy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j;
          acc += k[j + r]! * tmp[yy * w + x]!;
        }
      }
      dst[y * w + x] = acc + 0.5; // Uint8Array truncates: round
    }
  }
}

/**
 * Sobel gradient. Writes gx, gy and the Euclidean magnitude (0 on borders).
 * Theoretical max magnitude ≈ 1442 for an 8-bit input.
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

/**
 * Otsu threshold of a 256-bin histogram (`total` = sum of the bins): the level `t`
 * maximizing the between-class variance of {≤ t} vs {> t}.
 */
export function otsuThreshold(hist: ArrayLike<number>, total: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!;
  let w0 = 0;
  let sum0 = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    w0 += hist[t]!;
    if (w0 === 0) continue;
    const w1 = total - w0;
    if (w1 === 0) break;
    sum0 += t * hist[t]!;
    const m0 = sum0 / w0;
    const m1 = (sumAll - sum0) / w1;
    const v = w0 * w1 * (m0 - m1) * (m0 - m1);
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

/** Work buffers, reallocated only when the size changes. */
export class Buffers {
  width = 0;
  height = 0;
  gray = new Uint8Array(0);
  blur = new Uint8Array(0);
  /** Float scratch buffer (e.g. horizontal pass of `gaussianBlur`). */
  tmp = new Float32Array(0);
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
    this.tmp = new Float32Array(n);
    this.gx = new Float32Array(n);
    this.gy = new Float32Array(n);
    this.mag = new Float32Array(n);
  }
}

export function assertImageData(frame: unknown, algoId: string): asserts frame is ImageData {
  if (!(frame instanceof ImageData)) throw new Error(`${algoId} attend une ImageData`);
}

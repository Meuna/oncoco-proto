// Génère des icônes PNG placeholder (fond sombre + anneau) sans dépendance.
// Usage : node scripts/gen-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** @param {number} size @param {number} ringScale rayon relatif de l'anneau (zone sûre maskable) */
function icon(size, ringScale) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const c = size / 2;
  const r = size * ringScale;
  const w = size * 0.05;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filtre none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const ring = Math.abs(d - r) < w;
      const dot = d < size * 0.06;
      const [R, G, B] = ring || dot ? [0, 229, 255] : [17, 17, 17];
      const i = row + 1 + x * 3;
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = B;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), icon(192, 0.32));
writeFileSync(new URL('icon-512.png', out), icon(512, 0.32));
writeFileSync(new URL('icon-512-maskable.png', out), icon(512, 0.24));
writeFileSync(new URL('apple-touch-icon.png', out), icon(180, 0.3));
console.log('icons written to public/icons/');

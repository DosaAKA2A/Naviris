// Genera build/icon.png (256x256): disco casi negro con el anillo y núcleo
// de Cobalt en gradiente de paleta suave con grano. Sin dependencias externas.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const cx = SIZE / 2, cy = SIZE / 2;

// Paleta suave del logo (la misma del conic-gradient de la interfaz)
const STOPS = [
  [185, 170, 230], // lavanda
  [157, 195, 230], // azul niebla
  [164, 217, 194], // menta
  [230, 214, 164], // arena
  [230, 169, 180], // rosa
  [185, 170, 230]  // cierra el ciclo
];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function paletteAt(t) {
  const seg = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(seg));
  const f = seg - i;
  return [
    lerp(STOPS[i][0], STOPS[i + 1][0], f),
    lerp(STOPS[i][1], STOPS[i + 1][1], f),
    lerp(STOPS[i][2], STOPS[i + 1][2], f)
  ];
}

const px = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    const ang = (Math.atan2(dy, dx) / (2 * Math.PI) + 0.5) % 1;

    let r = 0, g = 0, b = 0, a = 0;

    // Disco de fondo casi negro
    const disc = 1 - smooth(119, 123, d);
    if (disc > 0) {
      r = 12; g = 12; b = 14; a = 255 * disc;
    }

    // Anillo con gradiente de paleta (65%–88% del radio del logo original)
    const ring = smooth(72, 78, d) * (1 - smooth(98, 104, d));
    // Núcleo (hasta ~32%)
    const core = 1 - smooth(32, 38, d);
    const t = Math.max(ring, core);
    if (t > 0) {
      const [pr, pg, pb] = paletteAt(ang);
      // Grano: ruido por píxel sutil
      const n = (Math.random() - 0.5) * 22;
      r = lerp(r, Math.min(255, Math.max(0, pr + n)), t);
      g = lerp(g, Math.min(255, Math.max(0, pg + n)), t);
      b = lerp(b, Math.min(255, Math.max(0, pb + n)), t);
      a = Math.max(a, 255 * t);
    }

    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
}

// ---- Codificación PNG ----
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filtro none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, png);
console.log('Icono generado:', out, png.length, 'bytes');

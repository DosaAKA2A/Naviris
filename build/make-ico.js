// Genera build/icon.ico (multi-resolución) a partir de build/icon.png, para que
// el instalador NSIS y el ejecutable muestren el logo de Cobalt.
// Se ejecuta con Electron: los .ico con PNG embebido los soporta Windows Vista+.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const src = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  const sizes = [256, 128, 64, 48, 32, 16];
  const imgs = sizes.map((s) => ({ s, buf: src.resize({ width: s, height: s, quality: 'best' }).toPNG() }));

  const count = imgs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo = icono
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const data = [];
  imgs.forEach((im, i) => {
    const b = i * 16;
    const dim = im.s >= 256 ? 0 : im.s; // 0 significa 256 en el formato ICO
    entries.writeUInt8(dim, b + 0);
    entries.writeUInt8(dim, b + 1);
    entries.writeUInt8(0, b + 2);   // paleta
    entries.writeUInt8(0, b + 3);   // reservado
    entries.writeUInt16LE(1, b + 4);  // planos
    entries.writeUInt16LE(32, b + 6); // bits por píxel
    entries.writeUInt32LE(im.buf.length, b + 8);
    entries.writeUInt32LE(offset, b + 12);
    offset += im.buf.length;
    data.push(im.buf);
  });

  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, entries, ...data]));
  console.log('icon.ico generado con tamaños:', sizes.join(', '));
  app.exit(0);
});

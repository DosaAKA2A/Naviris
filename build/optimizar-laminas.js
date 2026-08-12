// Reduce las láminas de los temas (src/temas/<tema>/1..3.jpg) al tamaño que de
// verdad se usa. Estaban a 2560x2560 y se ven en widgets de ~300px: cada una
// costaba 26 MB de RAM ya decodificada, así que las tres visibles a la vez se
// comían ~64 MB para nada. A 1024 sobra incluso en pantalla HiDPI y con el
// widget en su talla más grande.
// Se ejecuta con Electron porque nativeImage rasteriza y reencoda sin traer
// ninguna dependencia nueva al proyecto.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const LADO = 1024, CALIDAD = 84;

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const raiz = path.join(__dirname, '..', 'src', 'temas');
  let antes = 0, despues = 0;
  for (const tema of fs.readdirSync(raiz)) {
    const dir = path.join(raiz, tema);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const nombre of fs.readdirSync(dir)) {
      if (!/\.jpe?g$/i.test(nombre)) continue;
      const f = path.join(dir, nombre);
      const img = nativeImage.createFromPath(f);
      const { width, height } = img.getSize();
      const pesoAntes = fs.statSync(f).size;
      antes += pesoAntes;
      if (Math.max(width, height) <= LADO) { despues += pesoAntes; continue; }
      const escala = LADO / Math.max(width, height);
      const chico = img.resize({
        width: Math.round(width * escala), height: Math.round(height * escala), quality: 'best'
      });
      fs.writeFileSync(f, chico.toJPEG(CALIDAD));
      const pesoDespues = fs.statSync(f).size;
      despues += pesoDespues;
      console.log(`${tema}/${nombre}: ${width}x${height} -> ${chico.getSize().width}x${chico.getSize().height}` +
        `  ${(pesoAntes / 1024 | 0)} KB -> ${(pesoDespues / 1024 | 0)} KB`);
    }
  }
  console.log(`\nEn disco: ${(antes / 1048576).toFixed(1)} MB -> ${(despues / 1048576).toFixed(1)} MB`);
  app.exit(0);
});

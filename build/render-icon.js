// Renderiza el icono de la app: el isotipo de Iris en BLANCO, sin placa ni borde
// y llenando casi todo el cuadro (Dosa, 2026-11-17, variante «F»). Antes iba
// pequeño, en degradado pastel y sobre una placa negra que se fundía con la
// barra de tareas oscura: a 24-32 px solo quedaba una raya.
//
// Cada tamaño del .ico se dibuja a su medida (no se reduce el de 256): en los
// pequeños el aro se engorda con un trazo del mismo blanco para que no se
// quede en una línea de un píxel. Deja build/icon.png (256) y
// build/icon-sizes/<n>.png, que make-ico.js junta en icon.ico.
// Se ejecuta con Electron (offscreen) porque rasteriza SVG con fidelidad.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const IRIS_D = 'M1.08,582.41L0,302.19C-.65,131.46,130.07-1.65,303,.02l306.38,2.95c152.34,1.47,267.72,141.24,266.88,290.55l-1.72,307.39c-.86,154.14-136.95,274.21-288.33,273.92l-299.69-.58C128.09,873.93,1.69,742.98,1.08,582.41ZM670.98,820.63c85.92-7.81,145.77-71.41,151.41-157.79,5.07-77.74-16.57-152.57-53.84-222.68-82.97-156.09-213.93-281-375.71-352.86-56.61-25.15-115.91-37.9-176.04-34.9C124.83,56.97,57.47,124.72,53.55,217.62c-11.51,273.02,343.75,627.9,617.43,603.01Z';
const TAMANOS = [256, 128, 64, 48, 40, 32, 24, 20, 16];

// Grosor extra del aro (en unidades del dibujo, 876 de ancho) según el tamaño final
const grosor = (px) => (px <= 32 ? 90 : 40);

// SVG de un tamaño: el logo ocupa el 89 % del cuadro. El trazo crece hacia fuera
// la mitad de su grosor, así que el viewBox se amplía para que quepa.
function svg(px) {
  const extra = grosor(px);
  const lado = 228 / 256 * px, off = (px - lado) / 2, vb = 876.27 + extra;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
    `<svg x="${off}" y="${off}" width="${lado}" height="${lado}" viewBox="${-extra / 2} ${-extra / 2} ${vb} ${vb}">` +
    `<path d="${IRIS_D}" fill="#fff" fill-rule="evenodd" stroke="#fff" stroke-width="${extra}" stroke-linejoin="round"/></svg></svg>`;
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const carpeta = path.join(__dirname, 'icon-sizes');
  fs.mkdirSync(carpeta, { recursive: true });
  // Una sola página rasteriza cada SVG en un canvas de su tamaño exacto
  const win = new BrowserWindow({ width: 300, height: 300, show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,<!DOCTYPE html><html><body></body></html>');
  for (const px of TAMANOS) {
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${px};
        c.getContext('2d').drawImage(img, 0, 0, ${px}, ${px}); ok(c.toDataURL('image/png')); };
      img.onerror = () => mal(new Error('svg'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg(px))});
    })`);
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(carpeta, px + '.png'), png);
    if (px === 256) fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
  }
  console.log('Icono generado (blanco, sin placa):', TAMANOS.join(', '));
  app.exit(0);
});

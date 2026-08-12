// Genera las TRES láminas del tema Cartel (src/temas/cartel/1..3.jpg), las que
// llenan los widgets de imagen del hub. Se dibujan aquí en vez de usar fotos
// porque el tema es de dos tintas: una foto cualquiera rompería la paleta.
// Lenguaje: el de las referencias de Dosa (GAME OVER / PSEUDO-LIVING SYSTEMS /
// NM0::redux) — rojo y negro, masas angulares con las esquinas cortadas que se
// entrelazan, tramas diagonales, corchetes de encuadre y códigos monoespaciados.
// Se ejecuta con Electron (offscreen), igual que render-icon.js.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 1200, H = 900;
const ROJO = '#e8202a', ROJO_VIVO = '#ff2f3a', ROJO_HONDO = '#a5111a', NEGRO = '#0b0b0d';

// Chaflán: el corte de esquina que define el tema
const corte = (px) => `polygon(0 0, calc(100% - ${px}px) 0, 100% ${px}px, 100% 100%, ${px}px 100%, 0 calc(100% - ${px}px))`;
const trama = (c) => `repeating-linear-gradient(45deg, ${c} 0 3px, transparent 3px 8px)`;

const marco = (c) => `
  <div class="marco">
    <span style="border-color:${c}"></span><span style="border-color:${c}"></span>
    <span style="border-color:${c}"></span><span style="border-color:${c}"></span>
  </div>`;

const hoja = (fondo, tinta, cuerpo) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${fondo};
    font-family:"Geist Mono",Consolas,ui-monospace,monospace;color:${tinta}}
  .marco span{position:absolute;width:30px;height:30px;border:2px solid;opacity:.9}
  .marco span:nth-child(1){left:34px;top:34px;border-right:0;border-bottom:0}
  .marco span:nth-child(2){right:34px;top:34px;border-left:0;border-bottom:0}
  .marco span:nth-child(3){left:34px;bottom:34px;border-right:0;border-top:0}
  .marco span:nth-child(4){right:34px;bottom:34px;border-left:0;border-top:0}
  .cod{position:absolute;font-size:15px;letter-spacing:4px}
  .masa{position:absolute}
</style></head><body>${cuerpo}${marco(tinta)}</body></html>`;

// 1 · MASAS ENTRELAZADAS: bloques negros con la esquina cortada que se solapan
const uno = hoja(
  `radial-gradient(130% 100% at 78% 0%, ${ROJO_VIVO} 0%, ${ROJO} 45%, ${ROJO_HONDO} 100%)`, NEGRO, `
  <div class="masa" style="left:150px;top:170px;width:430px;height:300px;background:${NEGRO};clip-path:${corte(56)}"></div>
  <div class="masa" style="left:430px;top:330px;width:520px;height:250px;background:${NEGRO};clip-path:${corte(46)}"></div>
  <div class="masa" style="left:640px;top:150px;width:180px;height:180px;background:${NEGRO};clip-path:${corte(34)}"></div>
  <div class="masa" style="left:250px;top:540px;width:250px;height:120px;background:${NEGRO};clip-path:${corte(28)}"></div>
  <div class="masa" style="left:170px;top:200px;width:170px;height:26px;background:${trama(ROJO)}"></div>
  <div class="masa" style="left:660px;top:600px;width:220px;height:26px;background:${trama(NEGRO)}"></div>
  <div class="masa" style="left:0;top:706px;width:100%;height:2px;background:${NEGRO}"></div>
  <div class="cod" style="left:78px;bottom:64px">NAVIRIS / / / /</div>
  <div class="cod" style="right:78px;bottom:64px">0-1</div>`);

// 2 · EL CORTE: una diagonal ancha partiendo la lámina, con trama y tics
const dos = hoja(NEGRO, ROJO, `
  <div class="masa" style="left:-60px;top:-120px;width:900px;height:1300px;background:${ROJO};
       transform:rotate(28deg);transform-origin:top left"></div>
  <div class="masa" style="left:520px;top:120px;width:300px;height:26px;background:${trama(NEGRO)};transform:rotate(28deg)"></div>
  <div class="masa" style="left:150px;top:520px;width:220px;height:220px;background:${NEGRO};clip-path:${corte(44)}"></div>
  <div class="masa" style="right:120px;top:240px;width:150px;height:150px;background:${ROJO};clip-path:${corte(30)}"></div>
  <div class="masa" style="right:120px;top:430px;width:150px;height:8px;background:${ROJO}"></div>
  <div class="masa" style="right:120px;top:456px;width:96px;height:8px;background:${ROJO}"></div>
  <div class="masa" style="right:120px;top:482px;width:52px;height:8px;background:${ROJO}"></div>
  <div class="cod" style="left:78px;bottom:64px">0,1 PSEUDO-SYS</div>
  <div class="cod" style="right:78px;bottom:64px">0-2</div>`);

// 3 · LA REJILLA: retícula de módulos, unos macizos y otros vacíos
let modulos = '';
const filas = 5, cols = 7, celda = 118, gap = 12;
const llenos = new Set([1, 2, 4, 8, 9, 11, 15, 16, 20, 22, 23, 24, 27, 30, 31, 33]);
for (let r = 0; r < filas; r++) {
  for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const x = 150 + c * (celda + gap), y = 150 + r * (celda + gap);
    if (llenos.has(i)) {
      modulos += `<div class="masa" style="left:${x}px;top:${y}px;width:${celda}px;height:${celda}px;background:${NEGRO};clip-path:${corte(24)}"></div>`;
    } else if (i % 5 === 0) {
      modulos += `<div class="masa" style="left:${x}px;top:${y}px;width:${celda}px;height:${celda}px;background:${trama(NEGRO)};clip-path:${corte(24)}"></div>`;
    } else {
      modulos += `<div class="masa" style="left:${x + 46}px;top:${y + 46}px;width:22px;height:22px;border:2px solid ${NEGRO}"></div>`;
    }
  }
}
const tres = hoja(`linear-gradient(135deg, ${ROJO_VIVO} 0%, ${ROJO_HONDO} 100%)`, NEGRO,
  modulos + `
  <div class="cod" style="left:78px;bottom:64px">[ 17-07-05 ]</div>
  <div class="cod" style="right:78px;bottom:64px">0-3</div>`);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const destino = path.join(__dirname, '..', 'src', 'temas', 'cartel');
  fs.mkdirSync(destino, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, webPreferences: { offscreen: true } });
  const laminas = [uno, dos, tres];
  for (let i = 0; i < laminas.length; i++) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(laminas[i]));
    await new Promise((r) => setTimeout(r, 450));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(destino, `${i + 1}.jpg`), img.toJPEG(92));
    console.log(`lámina ${i + 1} lista`);
  }
  console.log('Láminas del tema Cartel generadas en src/temas/cartel/');
  app.exit(0);
});

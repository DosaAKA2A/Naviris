// Genera las TRES imágenes de tema del tema Cartel (src/temas/cartel/1..3.jpg),
// las que llenan los widgets de imagen del hub. Se dibujan aquí en vez de usar
// fotos porque el tema es de dos tintas y una foto cualquiera rompería la
// paleta: son composiciones en el mismo lenguaje que el cartel — rojo, hueso,
// rejilla, marcas de registro y códigos monoespaciados.
// Se ejecuta con Electron (offscreen) por el mismo motivo que render-icon.js:
// hace falta un motor que rasterice bien.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 1200, H = 900;
const ROJO_A = '#f2141f', ROJO_B = '#d90a17', ROJO_C = '#8f040e';
const HUESO = '#e9e4d9';

const base = (cuerpo, fondo) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${fondo};
    font-family:"Geist Mono",Consolas,ui-monospace,monospace;color:${HUESO}}
  .marco{position:absolute;inset:34px;pointer-events:none}
  .marco span{position:absolute;width:26px;height:26px;border:1.5px solid ${HUESO};opacity:.55}
  .marco span:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}
  .marco span:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
  .marco span:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}
  .marco span:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
  .cod{position:absolute;font-size:15px;letter-spacing:3px;opacity:.75}
  .barra{position:absolute;background:${HUESO}}
</style></head><body>${cuerpo}
  <div class="marco"><span></span><span></span><span></span><span></span></div>
</body></html>`;

// 1 · La masa: bloques macizos sobre rejilla, como el cuerpo del cartel
const uno = base(`
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;
       grid-template-columns:repeat(4,84px);grid-auto-rows:84px;gap:14px">
    <div class="barra" style="grid-column:1/4;height:84px;position:static"></div>
    <div class="barra" style="position:static;opacity:.35"></div>
    <div class="barra" style="position:static;opacity:.35"></div>
    <div class="barra" style="grid-column:2/5;height:84px;position:static"></div>
    <div class="barra" style="grid-column:1/3;height:84px;position:static"></div>
    <div class="barra" style="position:static;opacity:.35"></div>
    <div class="barra" style="position:static"></div>
  </div>
  <div class="cod" style="left:44px;bottom:44px">17-07-05////</div>
  <div class="cod" style="right:44px;bottom:44px">0-1</div>`,
  `radial-gradient(130% 100% at 78% 0%, ${ROJO_A} 0%, ${ROJO_B} 45%, ${ROJO_C} 100%)`);

// 2 · El vacío: una sola diagonal y mucho aire (el respiro del cartel)
const dos = base(`
  <div class="barra" style="left:-10%;top:52%;width:120%;height:2px;transform:rotate(-14deg);opacity:.9"></div>
  <div class="barra" style="left:-10%;top:56%;width:120%;height:12px;transform:rotate(-14deg)"></div>
  <div class="barra" style="left:-10%;top:62%;width:120%;height:2px;transform:rotate(-14deg);opacity:.45"></div>
  <div style="position:absolute;left:78px;top:96px;font-size:120px;font-weight:700;letter-spacing:-4px;line-height:.9">0—5</div>
  <div class="cod" style="left:82px;top:250px">NAVIRIS / CARTEL</div>
  <div class="cod" style="right:44px;bottom:44px">0-2</div>`,
  `linear-gradient(135deg, ${ROJO_A} 0%, ${ROJO_C} 100%)`);

// 3 · Invertida: hueso de fondo y el rojo como tinta, para que las tres no
//     canten igual cuando caen juntas en el hub
const tres = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${HUESO};
    font-family:"Geist Mono",Consolas,ui-monospace,monospace;color:${ROJO_B}}
  .marco{position:absolute;inset:34px}
  .marco span{position:absolute;width:26px;height:26px;border:1.5px solid ${ROJO_B};opacity:.6}
  .marco span:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}
  .marco span:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
  .marco span:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}
  .marco span:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
</style></head><body>
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;height:520px;
       border:18px solid ${ROJO_B};border-radius:50%;
       clip-path:polygon(0 0,100% 0,100% 62%,0 62%)"></div>
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;height:18px;background:${ROJO_B}"></div>
  <div style="position:absolute;left:60px;bottom:56px;font-size:15px;letter-spacing:3px">FUTURE / / / /</div>
  <div style="position:absolute;right:60px;bottom:56px;font-size:15px;letter-spacing:3px">0-3</div>
  <div class="marco"><span></span><span></span><span></span><span></span></div>
</body></html>`;

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
  console.log('Imágenes del tema Cartel generadas en src/temas/cartel/');
  app.exit(0);
});

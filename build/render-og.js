// Genera la imagen de PREVISUALIZACIÓN de enlace (assets/og.png, 1200x630):
// la tarjeta que sale al pegar naviris.site en Discord, WhatsApp, X o Slack.
//
// Rehecha 2026-08-13: la primera versión llevaba un mosaico abstracto y quedaba
// plana — una tarjeta de enlace tiene medio segundo para convencer, así que
// ahora enseña EL NAVEGADOR DE VERDAD (la misma captura del hero de la web)
// dentro de un marco inclinado, con la marca a la izquierda.
//
// Se ejecuta con Electron (offscreen) igual que render-icon.js. La página se
// escribe a disco en vez de cargarse como data: URL porque necesita leer la
// captura del propio repositorio.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const IRIS_D = 'M1.08,582.41L0,302.19C-.65,131.46,130.07-1.65,303,.02l306.38,2.95c152.34,1.47,267.72,141.24,266.88,290.55l-1.72,307.39c-.86,154.14-136.95,274.21-288.33,273.92l-299.69-.58C128.09,873.93,1.69,742.98,1.08,582.41ZM670.98,820.63c85.92-7.81,145.77-71.41,151.41-157.79,5.07-77.74-16.57-152.57-53.84-222.68-82.97-156.09-213.93-281-375.71-352.86-56.61-25.15-115.91-37.9-176.04-34.9C124.83,56.97,57.47,124.72,53.55,217.62c-11.51,273.02,343.75,627.9,617.43,603.01Z';
const W = 1200, H = 630;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#08080a;
    font-family:Inter,'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;color:#ececef}
  /* Resplandor iris detrás del navegador: da profundidad sin tapar nada */
  .aura{position:absolute;right:-140px;top:-120px;width:820px;height:820px;border-radius:50%;
    background:conic-gradient(from 210deg,#b9aae6,#9dc3e6,#a4d9c2,#e6d6a4,#e6a9b4,#b9aae6);
    filter:blur(170px);opacity:.34}
  .grano{position:absolute;inset:0;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")}
  /* El navegador, inclinado y saliéndose por la derecha */
  .marco{position:absolute;right:-96px;top:104px;width:760px;border-radius:16px;overflow:hidden;
    border:1px solid #26262c;background:#0a0a0c;
    transform:perspective(1600px) rotateY(-16deg) rotateX(6deg) rotate(-2deg);
    box-shadow:0 60px 110px rgba(0,0,0,.7),0 2px 0 rgba(255,255,255,.05)}
  .marco img{display:block;width:100%;height:auto}
  .caja{position:absolute;left:74px;top:0;height:100%;display:flex;flex-direction:column;justify-content:center;gap:24px;z-index:2}
  .marca{display:flex;align-items:center;gap:22px}
  .nombre{font-size:70px;font-weight:800;letter-spacing:-2px}
  .lema{font-size:27px;font-weight:500;color:#c3c5cc;max-width:470px;line-height:1.34;
    text-shadow:0 2px 18px rgba(0,0,0,.85)}
  .chips{display:flex;gap:9px}
  .chip{font-family:'Geist Mono',ui-monospace,Consolas,monospace;font-size:14px;letter-spacing:.1em;
    color:#c9cbd2;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);
    border-radius:999px;padding:7px 15px}
  .sitio{position:absolute;left:74px;bottom:52px;font-family:'Geist Mono',ui-monospace,Consolas,monospace;
    font-size:16px;letter-spacing:.14em;color:#7f818a;z-index:2}
  /* Velo a la izquierda: el texto siempre legible por encima de la captura */
  .velo{position:absolute;inset:0;z-index:1;
    background:linear-gradient(90deg,#08080a 34%,rgba(8,8,10,.86) 47%,rgba(8,8,10,0) 66%)}
</style></head><body>
  <div class="aura"></div>
  <div class="marco"><img src="../assets/captura-hub.jpg" /></div>
  <div class="velo"></div>
  <div class="grano"></div>
  <div class="caja">
    <div class="marca">
      <svg width="96" height="96" viewBox="0 0 876.27 874.83">
        <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#b9aae6"/><stop offset="50%" stop-color="#a4d9c2"/><stop offset="100%" stop-color="#e6a9b4"/>
        </linearGradient></defs>
        <path fill="url(#g)" fill-rule="evenodd" d="${IRIS_D}"/>
      </svg>
      <div class="nombre">Naviris</div>
    </div>
    <div class="lema">Descargas, adblock, drops de Twitch y watch parties. Sin instalar una sola extensión.</div>
    <div class="chips"><span class="chip">WINDOWS</span><span class="chip">ANDROID</span><span class="chip">GRATIS</span></div>
  </div>
  <div class="sitio">naviris.site</div>
</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const tmp = path.join(__dirname, '.og-temp.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 900));
  const img = await win.webContents.capturePage();
  const destino = path.join(__dirname, '..', 'assets', 'og.png');
  fs.writeFileSync(destino, img.toPNG());
  fs.unlinkSync(tmp);
  console.log('Imagen de enlace generada:', destino, (fs.statSync(destino).size / 1024 | 0) + ' KB');
  app.exit(0);
});

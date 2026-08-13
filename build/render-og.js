// Genera la imagen de PREVISUALIZACIÓN de enlace (assets/og.png, 1200x630).
// Es la que sale al pegar naviris.site en Discord, WhatsApp, X o Slack: sin
// ella, el enlace aparece pelado. Se dibuja con el isotipo real de Iris y la
// tipografía de la marca.
// Se ejecuta con Electron (offscreen), igual que render-icon.js.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const IRIS_D = 'M1.08,582.41L0,302.19C-.65,131.46,130.07-1.65,303,.02l306.38,2.95c152.34,1.47,267.72,141.24,266.88,290.55l-1.72,307.39c-.86,154.14-136.95,274.21-288.33,273.92l-299.69-.58C128.09,873.93,1.69,742.98,1.08,582.41ZM670.98,820.63c85.92-7.81,145.77-71.41,151.41-157.79,5.07-77.74-16.57-152.57-53.84-222.68-82.97-156.09-213.93-281-375.71-352.86-56.61-25.15-115.91-37.9-176.04-34.9C124.83,56.97,57.47,124.72,53.55,217.62c-11.51,273.02,343.75,627.9,617.43,603.01Z';

const W = 1200, H = 630;
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Inter; src: local('Inter'), local('Segoe UI Variable Display'), local('Segoe UI'); }
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#08080a;
    font-family:Inter,'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;color:#ececef}
  .aura{position:absolute;left:-120px;top:-160px;width:760px;height:760px;border-radius:50%;
    background:conic-gradient(from 200deg,#b9aae6,#9dc3e6,#a4d9c2,#e6d6a4,#e6a9b4,#b9aae6);
    filter:blur(150px);opacity:.30}
  .grano{position:absolute;inset:0;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")}
  .caja{position:absolute;left:88px;top:0;height:100%;display:flex;flex-direction:column;justify-content:center;gap:26px}
  .marca{display:flex;align-items:center;gap:26px}
  .nombre{font-size:76px;font-weight:800;letter-spacing:-2px}
  .lema{font-size:31px;font-weight:500;color:#b7b9c0;max-width:760px;line-height:1.32}
  .pie{display:flex;align-items:center;gap:14px;font-size:19px;color:#8b8d94;
    font-family:'Geist Mono',ui-monospace,Consolas,monospace;letter-spacing:.12em}
  .punto{width:6px;height:6px;border-radius:50%;background:#8b8d94}
  .canto{position:absolute;right:0;top:0;bottom:0;width:6px;
    background:linear-gradient(180deg,#b9aae6,#9dc3e6,#a4d9c2,#e6d6a4,#e6a9b4)}
  /* Insinuacion del hub a la derecha: la mitad derecha vacia dejaba la tarjeta
     con pinta de plantilla. Son las tarjetas del bento, no una captura. */
  .bento{position:absolute;right:-40px;top:96px;width:520px;display:grid;
    grid-template-columns:repeat(3,1fr);grid-auto-rows:118px;gap:18px;transform:rotate(-8deg)}
  .t{border-radius:26px;background:#141418;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
  .t.ancha{grid-column:span 2}
  .t.iris{background:linear-gradient(140deg,#b9aae6,#a4d9c2 55%,#e6a9b4)}
  .t.linea{background:#141418;position:relative;overflow:hidden}
  .t.linea::after{content:'';position:absolute;left:18px;right:18px;top:26px;height:8px;border-radius:8px;
    background:rgba(255,255,255,.10);box-shadow:0 22px 0 rgba(255,255,255,.07),0 44px 0 rgba(255,255,255,.05)}
</style></head><body>
  <div class="aura"></div>
  <div class="bento">
    <div class="t ancha linea"></div><div class="t iris"></div>
    <div class="t"></div><div class="t ancha linea"></div>
    <div class="t ancha iris" style="opacity:.55"></div><div class="t"></div>
  </div>
  <div class="grano"></div><div class="canto"></div>
  <div class="caja">
    <div class="marca">
      <svg width="108" height="108" viewBox="0 0 876.27 874.83">
        <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#b9aae6"/><stop offset="50%" stop-color="#a4d9c2"/><stop offset="100%" stop-color="#e6a9b4"/>
        </linearGradient></defs>
        <path fill="url(#g)" fill-rule="evenodd" d="${IRIS_D}"/>
      </svg>
      <div class="nombre">Naviris</div>
    </div>
    <div class="lema">El navegador que trae las herramientas dentro: descargas, adblock, drops de Twitch y watch parties. Sin extensiones.</div>
    <div class="pie"><span>WINDOWS</span><span class="punto"></span><span>ANDROID</span><span class="punto"></span><span>GRATIS</span></div>
  </div>
</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  const destino = path.join(__dirname, '..', 'assets', 'og.png');
  fs.writeFileSync(destino, img.toPNG());
  console.log('Imagen de enlace generada:', destino, (fs.statSync(destino).size / 1024 | 0) + ' KB');
  app.exit(0);
});

// Renderiza el icono de la app (256x256) usando el isotipo real de Iris con
// gradiente de paleta y grano, sobre disco oscuro. Se ejecuta con Electron
// (offscreen) porque necesita un motor que rasterice SVG con fidelidad.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const IRIS_D = 'M1.08,582.41L0,302.19C-.65,131.46,130.07-1.65,303,.02l306.38,2.95c152.34,1.47,267.72,141.24,266.88,290.55l-1.72,307.39c-.86,154.14-136.95,274.21-288.33,273.92l-299.69-.58C128.09,873.93,1.69,742.98,1.08,582.41ZM670.98,820.63c85.92-7.81,145.77-71.41,151.41-157.79,5.07-77.74-16.57-152.57-53.84-222.68-82.97-156.09-213.93-281-375.71-352.86-56.61-25.15-115.91-37.9-176.04-34.9C124.83,56.97,57.47,124.72,53.55,217.62c-11.51,273.02,343.75,627.9,617.43,603.01Z';

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:256px;height:256px;background:transparent;overflow:hidden}
  .disc{position:absolute;inset:8px;border-radius:56px;background:radial-gradient(ellipse at 50% 32%,#17171c 0%,#0b0b0d 78%);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
  .logo{position:absolute;left:50%;top:50%;width:150px;height:150px;transform:translate(-50%,-50%)}
</style></head><body>
  <div class="disc"></div>
  <svg class="logo" viewBox="0 0 876.27 874.83">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#b9aae6"/><stop offset="50%" stop-color="#a4d9c2"/><stop offset="100%" stop-color="#e6a9b4"/>
    </linearGradient></defs>
    <path fill="url(#g)" fill-rule="evenodd" d="${IRIS_D}"/>
  </svg>
</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.toPNG());
  console.log('Icono generado con el isotipo de Iris.');
  app.exit(0);
});

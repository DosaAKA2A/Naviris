// Descarga yt-dlp.exe, ffmpeg.exe y deno.exe a resources/bin (no se versionan en git).
// Uso: npm run fetch-bin   (necesario antes de compilar tras clonar el repo)
// Deno: desde yt-dlp 2026.08 YouTube solo da sus formatos resolviendo retos en
// JavaScript, y yt-dlp necesita un motor de JS externo para eso (EJS,
// https://github.com/yt-dlp/yt-dlp/wiki/EJS). Deno es el que yt-dlp activa por
// defecto y es un único .exe; sin él el Rat Tool no baja nada de YouTube. Si ya
// tenías yt-dlp y ffmpeg, volver a lanzarlo baja solo Deno.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'resources', 'bin');
fs.mkdirSync(BIN, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => https.get(u, { headers: { 'User-Agent': 'cobalt' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + u));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
    get(url);
  });
}

(async () => {
  const ytDlp = path.join(BIN, 'yt-dlp.exe');
  if (!fs.existsSync(ytDlp)) {
    console.log('Descargando yt-dlp…');
    await download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', ytDlp);
  }
  const ffmpeg = path.join(BIN, 'ffmpeg.exe');
  if (!fs.existsSync(ffmpeg)) {
    console.log('Descargando ffmpeg…');
    const zip = path.join(BIN, 'ffmpeg.zip');
    await download('https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip', zip);
    // Extrae solo bin/ffmpeg.exe con PowerShell/tar (Windows 10+ trae tar/Expand-Archive)
    const tmp = path.join(BIN, '_ff');
    execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}'"`);
    const found = execSync(`powershell -NoProfile -Command "(Get-ChildItem -Recurse '${tmp}' -Filter ffmpeg.exe | Select-Object -First 1).FullName"`).toString().trim();
    fs.copyFileSync(found, ffmpeg);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  }
  const deno = path.join(BIN, 'deno.exe');
  if (!fs.existsSync(deno)) {
    console.log('Descargando deno…');
    const zip = path.join(BIN, 'deno.zip');
    await download('https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip', zip);
    // El zip trae un único deno.exe en la raíz
    const tmp = path.join(BIN, '_deno');
    execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}'"`);
    fs.copyFileSync(path.join(tmp, 'deno.exe'), deno);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  }
  console.log('Binarios listos en resources/bin');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });

// Descarga yt-dlp.exe, ffmpeg.exe y deno.exe a resources/bin (no se versionan en git).
// Uso: npm run fetch-bin   (necesario antes de compilar tras clonar el repo)
// Deno: desde yt-dlp 2026.08 YouTube solo da sus formatos resolviendo retos en
// JavaScript, y yt-dlp necesita un motor de JS externo para eso (EJS,
// https://github.com/yt-dlp/yt-dlp/wiki/EJS). Deno es el que yt-dlp activa por
// defecto y es un único .exe; sin él el Rat Tool no baja nada de YouTube.
// Baja lo que falta y, además, yt-dlp si el que hay es anterior a la versión
// mínima del Rat Tool. Mismas direcciones y huellas SHA-256 que la app
// (src/rat.js → BINARIOS): un archivo que no coincide no se queda.
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const rat = require('../src/rat');

const BIN = path.join(__dirname, '..', 'resources', 'bin');
fs.mkdirSync(BIN, { recursive: true });

// GET con redirecciones; `soloRedireccion` devuelve la primera Location sin seguirla
function pide(url, { aArchivo, soloRedireccion } = {}) {
  return new Promise((resolve, reject) => {
    const get = (u) => https.get(u, { headers: { 'User-Agent': 'naviris-fetch-bin' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (soloRedireccion) return resolve(res.headers.location);
        return get(new URL(res.headers.location, u).href);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + u)); }
      if (aArchivo) {
        const file = fs.createWriteStream(aArchivo);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(aArchivo)));
        file.on('error', reject);
      } else {
        let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(t));
      }
    }).on('error', reject);
    get(url);
  });
}
const huella = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function compruebaHuella(f, esperada) {
  if (!esperada || huella(f) !== esperada) { fs.rmSync(f, { force: true }); throw new Error('huella SHA-256 distinta en ' + path.basename(f)); }
}
const ps = (orden) => execFileSync('powershell.exe', ['-NoProfile', '-Command', orden]).toString().trim();
function extrae(zip, nombre, destino) {
  const tmp = path.join(BIN, '_' + path.basename(zip, '.zip'));
  try {
    ps(`Expand-Archive -Force -LiteralPath ${rat.literalPs(zip)} -DestinationPath ${rat.literalPs(tmp)}`);
    const found = ps(`(Get-ChildItem -Recurse -LiteralPath ${rat.literalPs(tmp)} -Filter ${nombre} | Select-Object -First 1).FullName`);
    if (!found) throw new Error(nombre + ' no está en el zip');
    fs.copyFileSync(found, destino);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  }
}
const versionDe = (exe) => { try { return execFileSync(exe, ['--version']).toString().trim().split(/\r?\n/)[0]; } catch { return null; } };

(async () => {
  const ytDlp = path.join(BIN, 'yt-dlp.exe');
  const actual = fs.existsSync(ytDlp) ? versionDe(ytDlp) : null;
  if (!rat.esVersionYtDlp(actual) || rat.comparaVersiones(actual, rat.VERSION_MINIMA_YTDLP) < 0) {
    const v = rat.versionDeRedireccion(await pide(rat.BINARIOS.ytdlp.ultima, { soloRedireccion: true }));
    if (!rat.esVersionYtDlp(v)) throw new Error('no se pudo leer la última versión de yt-dlp');
    console.log(`Descargando yt-dlp ${v}${actual ? ' (había ' + actual + ')' : ''}…`);
    const sumas = await pide(rat.BINARIOS.ytdlp.sumas(v));
    const nuevo = path.join(BIN, 'yt-dlp-nuevo.exe');
    await pide(rat.BINARIOS.ytdlp.url(v), { aArchivo: nuevo });
    compruebaHuella(nuevo, rat.huellaEnSumas(sumas, 'yt-dlp.exe'));
    fs.renameSync(nuevo, ytDlp);
  }
  const ffmpeg = path.join(BIN, 'ffmpeg.exe');
  if (!fs.existsSync(ffmpeg)) {
    console.log('Descargando ffmpeg…');
    const zip = path.join(BIN, 'ffmpeg.zip');
    await pide(rat.BINARIOS.ffmpeg.url, { aArchivo: zip });
    compruebaHuella(zip, rat.BINARIOS.ffmpeg.sha256);
    extrae(zip, 'ffmpeg.exe', ffmpeg);
  }
  const deno = path.join(BIN, 'deno.exe');
  if (!fs.existsSync(deno)) {
    console.log('Descargando deno…');
    const zip = path.join(BIN, 'deno.zip');
    const sumas = await pide(rat.BINARIOS.deno.sumas);
    await pide(rat.BINARIOS.deno.url, { aArchivo: zip });
    compruebaHuella(zip, rat.huellaEnSumas(sumas, 'deno-x86_64-pc-windows-msvc.zip'));
    extrae(zip, 'deno.exe', deno);
  }
  console.log('Binarios listos en resources/bin');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });

// Rat Tool de verdad: baja un clip corto de cada plataforma con resources/bin y
// los MISMOS argumentos y lector que usa la app (src/rat.js), en una carpeta
// temporal que se borra al terminar. Necesita red; para saltarlo:
//   set NAVIRIS_SIN_RED=1   (o no tener los binarios: npm run fetch-bin)
// npm run test:e2e
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const rat = require('../../src/rat');

const BIN = path.join(__dirname, '..', '..', 'resources', 'bin');
const exe = (n) => path.join(BIN, n);
const faltan = ['yt-dlp.exe', 'ffmpeg.exe', 'deno.exe'].filter((b) => !fs.existsSync(exe(b)));
const SALTAR = process.env.NAVIRIS_SIN_RED === '1' ? 'NAVIRIS_SIN_RED=1' : (faltan.length ? 'faltan ' + faltan.join(', ') + ' (npm run fetch-bin)' : false);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
// Carpeta con apóstrofo, tilde y % a propósito: así se prueban también las rutas
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), "naviris-rat-e2e O'Ñ 100% "));
const DESTINO = path.join(RAIZ, 'Descargas');
fs.mkdirSync(DESTINO);
test.after(() => fs.rmSync(RAIZ, { recursive: true, force: true }));

// Lanza yt-dlp como ytDownload (main.js) y mueve el resultado a DESTINO.
// `extra`: opciones solo de la prueba (tramo corto de un video largo).
function descarga({ url, mode = 'video', quality = '', extra = [] }) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(RAIZ, 'trabajo-'));
    const args = rat.argsDescarga({ url, mode, quality, dir, ffmpeg: exe('ffmpeg.exe'), deno: exe('deno.exe'), ua: UA, cookies: null });
    const fin = args.splice(-2); // '--', url
    args.push('--print', 'after_move:[fmt] %(format_id)s|%(format_note)s', ...extra, ...fin);
    const r = { archivo: null, finales: [], destinos: [], progreso: [], errores: [], formato: null };
    const alEvento = (e) => {
      if (e.tipo === 'archivo') r.archivo = e.ruta;
      else if (e.tipo === 'final') r.finales.push(e.ruta);
      else if (e.tipo === 'progreso') r.progreso.push(e.percent);
      else if (e.tipo === 'error') r.errores.push(e.texto);
    };
    const lo = rat.creaLector(alEvento), le = rat.creaLector(alEvento);
    const p = spawn(exe('yt-dlp.exe'), args, { windowsHide: true });
    let crudo = '';
    p.stdout.on('data', (b) => { crudo += b.toString('utf8'); lo.escribe(b); });
    p.stderr.on('data', (b) => le.escribe(b));
    p.on('close', (code) => {
      lo.cierra(); le.cierra();
      r.code = code;
      r.formato = (crudo.match(/^\[fmt\] (.+)$/m) || [])[1] || null;
      for (const f of r.finales.filter((x) => fs.existsSync(x))) {
        r.destino = path.join(DESTINO, path.basename(f));
        fs.rmSync(r.destino, { force: true });
        fs.renameSync(f, r.destino);
        r.destinos.push(r.destino);
      }
      r.restos = fs.readdirSync(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve(r);
    });
  });
}
// Pistas del archivo según ffmpeg
function pistas(f) {
  const out = spawnSync(exe('ffmpeg.exe'), ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr;
  return { video: /Stream #.*: Video: (?!mjpeg|png)/.test(out), audio: /Stream #.*: Audio:/.test(out), texto: out };
}
function bajado(r, ext) {
  assert.equal(r.code, 0, 'yt-dlp terminó con error: ' + r.errores.join(' / '));
  assert.ok(r.destino && fs.existsSync(r.destino), 'no llegó el archivo final');
  assert.equal(path.extname(r.destino), ext);
  assert.ok(fs.statSync(r.destino).size > 10000, 'archivo demasiado pequeño');
  assert.equal(path.basename(r.archivo).replace(/\.[^.]+$/, ''), path.basename(r.destino).replace(/\.[^.]+$/, ''), 'el nombre anunciado no es el final');
  assert.deepEqual(r.restos, [], 'quedaron restos en la carpeta temporal');
  return pistas(r.destino);
}

const opt = { skip: SALTAR, timeout: 240000 };

test('YouTube: video normal en MP4 con video y audio, H.264', opt, async () => {
  const r = await descarga({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', quality: '240' });
  const p = bajado(r, '.mp4');
  assert.ok(p.video && p.audio, p.texto);
  assert.match(p.texto, /Video: h264/);
  assert.ok(r.progreso.length && r.progreso.at(-1) === 100);
});

test('YouTube: Short a 360p (lado corto)', opt, async () => {
  const r = await descarga({ url: 'https://www.youtube.com/shorts/pxqy51-bq5c', quality: '360' });
  const p = bajado(r, '.mp4');
  assert.ok(p.video && p.audio);
  assert.match(p.texto, /, 360x640/);
});

test('YouTube: video largo (1 h), tramo de 5 s, título con emoji', opt, async () => {
  const r = await descarga({ url: 'https://www.youtube.com/watch?v=lTRiuFIWV54', quality: '144', extra: ['--download-sections', '*0-5'] });
  bajado(r, '.mp4');
  assert.match(path.basename(r.destino), /📚/);
});

test('YouTube: solo audio en MP3', opt, async () => {
  const r = await descarga({ url: 'https://youtu.be/jNQXAC9IVRw', mode: 'audio' });
  const p = bajado(r, '.mp3');
  assert.ok(p.audio && !p.video);
});

test('YouTube Music: MP3', opt, async () => {
  const r = await descarga({ url: 'https://music.youtube.com/watch?v=jNQXAC9IVRw', mode: 'audio' });
  assert.ok(bajado(r, '.mp3').audio);
});

test('YouTube: video dentro de una lista baja solo ese video; la lista suelta se rechaza', opt, async () => {
  assert.equal(rat.esLista('https://www.youtube.com/playlist?list=PLM6OA8eOe83s'), true);
  const r = await descarga({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLM6OA8eOe83s', quality: '144' });
  bajado(r, '.mp4');
  assert.match(path.basename(r.destino), /\[jNQXAC9IVRw\]/);
});

test('Instagram: reel público sin sesión', opt, async () => {
  const r = await descarga({ url: 'https://www.instagram.com/reel/Chunk8-jurw/' });
  assert.ok(bajado(r, '.mp4').video);
});

test('X: tuit con dos videos (llegan los dos) y un MP3', opt, async () => {
  const r = await descarga({ url: 'https://x.com/primevideouk/status/1578401165338976258' });
  const p = bajado(r, '.mp4');
  assert.ok(p.video && p.audio);
  assert.equal(r.destinos.length, 2);
  const a = await descarga({ url: 'https://twitter.com/liberdalau/status/1623739803874349067', mode: 'audio' });
  assert.ok(bajado(a, '.mp3').audio);
});

test('TikTok: sin marca de agua, y el MP3 después no borra el MP4', opt, async () => {
  const url = 'https://www.tiktok.com/@pokemonlife22/video/7059698374567611694';
  const r = await descarga({ url });
  const p = bajado(r, '.mp4');
  assert.ok(p.video && p.audio);
  assert.doesNotMatch(r.formato || '', /download|watermark/i, 'eligió el formato con marca de agua: ' + r.formato);
  const a = await descarga({ url, mode: 'audio' });
  assert.ok(bajado(a, '.mp3').audio);
  assert.ok(fs.existsSync(r.destino), 'el MP3 se llevó por delante el MP4');
});

test('Twitch: clip', opt, async () => {
  const r = await descarga({ url: 'https://www.twitch.tv/twitch/clip/BadCoweringGoshawkHeyGuys', quality: '360' });
  assert.ok(bajado(r, '.mp4').video);
});

test('Twitch: VOD (tramo de 5 s)', opt, async () => {
  const r = await descarga({ url: 'https://www.twitch.tv/videos/2915087502', quality: '160', extra: ['--download-sections', '*0-5'] });
  assert.ok(bajado(r, '.mp4').video);
});

test('Facebook: video público', opt, async () => {
  const r = await descarga({ url: 'https://www.facebook.com/video.php?v=274175099429670', quality: '360' });
  assert.ok(bajado(r, '.mp4').video);
});

test('Vimeo: enlace vimeo.com sin sesión (va por el reproductor)', opt, async () => {
  const r = await descarga({ url: 'https://vimeo.com/98044508', quality: '240' });
  assert.ok(bajado(r, '.mp4').video);
});

test('Dailymotion: la calidad más baja', opt, async () => {
  const r = await descarga({ url: 'https://www.dailymotion.com/video/x5kesuj', quality: '240' });
  const p = bajado(r, '.mp4');
  assert.match(p.texto, /512x288/, 'no respetó la calidad pedida');
});

test('Reddit sin sesión: falla y el mensaje pide iniciar sesión en Reddit', opt, async () => {
  const url = 'https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/';
  const r = await descarga({ url });
  assert.notEqual(r.code, 0);
  assert.deepEqual(r.restos, []);
  assert.match(rat.errorDeYtDlp(r.errores.at(-1), url), /Inicia sesión en Reddit en Naviris/);
});

test('calidades reales de un video de YouTube (con Deno salen hasta 1080p)', opt, async () => {
  const p = spawnSync(exe('yt-dlp.exe'), rat.argsFormatos({ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', deno: exe('deno.exe'), ua: UA }), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const q = rat.calidades(JSON.parse(p.stdout));
  assert.ok(q.includes(1080) && q.includes(720) && q.includes(360), q.join(','));
  assert.deepEqual(q, [...q].sort((a, b) => b - a));
});

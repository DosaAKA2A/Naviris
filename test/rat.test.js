// Pruebas unitarias del Rat Tool (src/rat.js): sin red ni Electron.
// npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const rat = require('../src/rat');

const id = (u) => rat.plataforma(u)?.id || null;

test('detecta la plataforma por dominio, con subdominios y sin dejarse engañar', () => {
  const casos = {
    'https://www.youtube.com/watch?v=jNQXAC9IVRw': 'youtube',
    'https://m.youtube.com/watch?v=jNQXAC9IVRw': 'youtube',
    'https://music.youtube.com/watch?v=jNQXAC9IVRw': 'youtube',
    'https://youtu.be/jNQXAC9IVRw?si=x': 'youtube',
    'https://www.instagram.com/reel/Chunk8-jurw/': 'instagram',
    'https://x.com/a/status/1': 'x',
    'https://mobile.twitter.com/a/status/1': 'x',
    'https://www.tiktok.com/@a/video/1': 'tiktok',
    'https://vm.tiktok.com/ZMabc/': 'tiktok',
    'https://www.twitch.tv/videos/1': 'twitch',
    'https://clips.twitch.tv/Slug': 'twitch',
    'https://www.facebook.com/watch/?v=1': 'facebook',
    'https://fb.watch/abc/': 'facebook',
    'https://vimeo.com/76979871': 'vimeo',
    'https://www.reddit.com/r/a/comments/abc/x/': 'reddit',
    'https://v.redd.it/abc': 'reddit',
    'https://www.dailymotion.com/video/x5kesuj': 'dailymotion',
    'https://dai.ly/x5kesuj': 'dailymotion',
    // dominios parecidos que NO son la plataforma
    'https://notyoutube.com/watch?v=1': null,
    'https://youtube.com.evil.example/watch?v=1': null,
    'https://example.com/x.com/status/1': null,
    'ftp://youtube.com/watch?v=1': null,
    'no es una url': null,
    '': null
  };
  for (const [u, esperado] of Object.entries(casos)) assert.equal(id(u), esperado, u);
});

test('la lista de plataformas es la que promete el README', () => {
  assert.deepEqual(rat.PLATAFORMAS.map((p) => p.nombre),
    ['YouTube', 'Instagram', 'X', 'TikTok', 'Twitch', 'Facebook', 'Vimeo', 'Reddit', 'Dailymotion']);
  for (const p of rat.PLATAFORMAS) assert.ok(p.id && p.dominios.length && typeof p.video === 'function', p.nombre);
});

test('distingue un video concreto del feed, un perfil o un canal', () => {
  const si = [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://www.youtube.com/shorts/pxqy51-bq5c', 'https://youtu.be/jNQXAC9IVRw',
    'https://www.youtube.com/live/abcdefghijk', 'https://music.youtube.com/watch?v=jNQXAC9IVRw&list=RDAMVM1',
    'https://www.instagram.com/reel/Chunk8-jurw/', 'https://www.instagram.com/p/BQ0eAlwhDrw/', 'https://www.instagram.com/reels/abc/',
    'https://www.instagram.com/usuario/reel/abc/',
    'https://x.com/primevideouk/status/1578401165338976258', 'https://twitter.com/a/status/1/video/1',
    'https://www.tiktok.com/@pokemonlife22/video/7059698374567611694', 'https://vm.tiktok.com/ZMabc/', 'https://www.tiktok.com/t/ZTabc/',
    'https://www.twitch.tv/videos/2915087502', 'https://www.twitch.tv/twitch/clip/BadCoweringGoshawkHeyGuys', 'https://clips.twitch.tv/Slug',
    'https://www.facebook.com/video.php?v=274175099429670', 'https://www.facebook.com/radiokicksfm/videos/3676516585958356/',
    'https://www.facebook.com/watch/?v=1', 'https://www.facebook.com/reel/123', 'https://fb.watch/abc/',
    'https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871', 'https://vimeo.com/channels/staffpicks/76979871',
    'https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/', 'https://v.redd.it/zv89llsvexdz',
    'https://www.dailymotion.com/video/x5kesuj', 'https://dai.ly/x5kesuj',
    'https://otro-sitio.example/video/123'
  ];
  const no = [
    'https://www.youtube.com/', 'https://www.youtube.com/@YouTube', 'https://www.youtube.com/playlist?list=PLM6OA8eOe83s',
    'https://www.instagram.com/', 'https://www.instagram.com/instagram/', 'https://x.com/home', 'https://x.com/primevideouk',
    'https://www.tiktok.com/foryou', 'https://www.tiktok.com/@pokemonlife22', 'https://www.twitch.tv/twitch',
    'https://www.facebook.com/', 'https://vimeo.com/', 'https://www.reddit.com/r/videos/', 'https://www.dailymotion.com/',
    'https://otro-sitio.example/', 'nada'
  ];
  for (const u of si) assert.equal(rat.esVideo(u), true, u);
  for (const u of no) assert.equal(rat.esVideo(u), false, u);
});

test('reconoce las listas sueltas de YouTube, pero no un video dentro de una lista', () => {
  assert.equal(rat.esLista('https://www.youtube.com/playlist?list=PLM6OA8eOe83s'), true);
  assert.equal(rat.esLista('https://music.youtube.com/playlist?list=OLAK5uy_x'), true);
  assert.equal(rat.esLista('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLM6OA8eOe83s'), false);
  assert.equal(rat.esLista('https://www.youtube.com/watch?v=jNQXAC9IVRw'), false);
  assert.equal(rat.esLista('https://example.com/playlist?list=1'), false);
});

test('vimeo.com pasa al reproductor incrustado (sin sesión el otro pide iniciarla)', () => {
  assert.equal(rat.urlParaYtDlp('https://vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871');
  assert.equal(rat.urlParaYtDlp('https://vimeo.com/channels/staffpicks/76979871'), 'https://player.vimeo.com/video/76979871');
  assert.equal(rat.urlParaYtDlp('https://vimeo.com/76979871/a1b2c3d4e5'), 'https://player.vimeo.com/video/76979871?h=a1b2c3d4e5');
  assert.equal(rat.urlParaYtDlp('https://player.vimeo.com/video/76979871'), 'https://player.vimeo.com/video/76979871');
  assert.equal(rat.urlParaYtDlp('https://www.youtube.com/watch?v=jNQXAC9IVRw'), 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
});

const BASE = { dir: 'C:\\Users\\Dosa\\AppData\\Local\\Temp\\naviris-rat-ab12', ffmpeg: 'C:\\bin\\ffmpeg.exe', deno: 'C:\\bin\\deno.exe', ua: 'Mozilla/5.0 X' };
const valorDe = (args, opcion) => args[args.indexOf(opcion) + 1];
const todos = (args, opcion) => args.flatMap((a, i) => (a === opcion ? [args[i + 1]] : []));

test('argumentos de video: mejor calidad, H.264 preferido, MP4 y la URL al final tras "--"', () => {
  const a = rat.argsDescarga({ ...BASE, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', mode: 'video', quality: '' });
  assert.equal(valorDe(a, '-f'), 'bv*+ba/b');
  assert.equal(valorDe(a, '-S'), 'res,fps,vcodec:h264,acodec:aac,ext:mp4:m4a');
  assert.equal(valorDe(a, '--merge-output-format'), 'mp4');
  assert.equal(valorDe(a, '--remux-video'), 'mp4');
  assert.equal(valorDe(a, '--encoding'), 'utf-8');
  assert.equal(valorDe(a, '-P'), BASE.dir);
  assert.equal(valorDe(a, '-o'), '%(title).120s [%(id)s].%(ext)s');
  assert.equal(valorDe(a, '--js-runtimes'), 'deno:C:\\bin\\deno.exe');
  assert.equal(valorDe(a, '--ffmpeg-location'), BASE.ffmpeg);
  assert.equal(valorDe(a, '--user-agent'), BASE.ua);
  assert.ok(a.includes('--no-playlist') && a.includes('--no-part') && a.includes('--newline') && a.includes('-q') && a.includes('--progress'));
  assert.deepEqual(todos(a, '--print'), ['before_dl:[rat] archivo %(filename)s', 'after_move:[rat] final %(filepath)s']);
  assert.deepEqual(a.slice(-2), ['--', 'https://www.youtube.com/watch?v=jNQXAC9IVRw']);
  assert.ok(!a.includes('--cookies'));
});

test('argumentos con calidad elegida: la más cercana por debajo (lado corto)', () => {
  const a = rat.argsDescarga({ ...BASE, url: 'https://www.youtube.com/shorts/pxqy51-bq5c', mode: 'video', quality: '720' });
  assert.equal(valorDe(a, '-S'), 'res:720,fps,vcodec:h264,acodec:aac,ext:mp4:m4a');
  for (const q of ['', '0', 'abc', undefined, '-5']) {
    assert.match(valorDe(rat.argsDescarga({ ...BASE, url: 'https://x.com/a/status/1', mode: 'video', quality: q }), '-S'), /^res,/, String(q));
  }
});

test('argumentos de audio: MP3 a la mejor calidad', () => {
  const a = rat.argsDescarga({ ...BASE, url: 'https://music.youtube.com/watch?v=jNQXAC9IVRw', mode: 'audio' });
  assert.equal(valorDe(a, '-f'), 'ba/b');
  assert.ok(a.includes('-x'));
  assert.equal(valorDe(a, '--audio-format'), 'mp3');
  assert.equal(valorDe(a, '--audio-quality'), '0');
  assert.ok(!a.includes('--merge-output-format') && !a.includes('-S'));
});

test('TikTok: archivo único y nunca el formato con marca de agua', () => {
  const a = rat.argsDescarga({ ...BASE, url: 'https://www.tiktok.com/@a/video/1', mode: 'video', quality: '' });
  assert.equal(valorDe(a, '-f'), 'b[format_note!*=?watermark]/b');
  const audio = rat.argsDescarga({ ...BASE, url: 'https://www.tiktok.com/@a/video/1', mode: 'audio' });
  assert.equal(valorDe(audio, '-f'), 'ba/b');
});

test('sin Deno no se pasa --js-runtimes; con cookies se pasa --cookies', () => {
  const a = rat.argsDescarga({ ...BASE, deno: null, cookies: 'C:\\Temp\\naviris-cookies-1.txt', url: 'https://www.instagram.com/reel/a/', mode: 'video' });
  assert.ok(!a.includes('--js-runtimes'));
  assert.equal(valorDe(a, '--cookies'), 'C:\\Temp\\naviris-cookies-1.txt');
});

test('rutas con apóstrofo, tildes, espacios y % van tal cual (sin shell ni plantilla)', () => {
  const dir = "C:\\Users\\O'Brien Núñez\\AppData\\Local\\Temp\\naviris-rat-100% ñ";
  const a = rat.argsDescarga({ ...BASE, dir, ffmpeg: "C:\\Users\\O'Brien Núñez\\bin\\ffmpeg.exe", url: 'https://youtu.be/jNQXAC9IVRw', mode: 'audio' });
  assert.equal(valorDe(a, '-P'), dir);
  assert.equal(valorDe(a, '--ffmpeg-location'), "C:\\Users\\O'Brien Núñez\\bin\\ffmpeg.exe");
  // una URL que empieza por "-" no puede colarse como opción
  const b = rat.argsDescarga({ ...BASE, url: '--exec=calc', mode: 'video' });
  assert.deepEqual(b.slice(-2), ['--', '--exec=calc']);
});

test('argumentos para leer formatos', () => {
  const a = rat.argsFormatos({ url: 'https://vimeo.com/76979871', deno: 'C:\\bin\\deno.exe', ua: 'UA', cookies: null });
  assert.ok(a.includes('--dump-single-json') && a.includes('--no-playlist'));
  assert.deepEqual(a.slice(-2), ['--', 'https://player.vimeo.com/video/76979871']);
});

test('calidades: lado corto, sin audio ni storyboards, de mayor a menor', () => {
  const info = { formats: [
    { format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none', width: 320, height: 180 },
    { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2' },
    { format_id: '160', vcodec: 'avc1', width: 144, height: 256 },
    { format_id: '134', vcodec: 'avc1', width: 360, height: 640 },
    { format_id: '136', vcodec: 'avc1', width: 720, height: 1280 },
    { format_id: '137', vcodec: 'avc1', width: 1080, height: 1920 },
    { format_id: '248', vcodec: 'vp9', width: 1080, height: 1920 },
    { format_id: 'h', vcodec: 'avc1', width: 1920, height: 1080 },
    { format_id: 'solo-alto', vcodec: 'avc1', height: 480 },
    { format_id: 'pequeño', vcodec: 'avc1', width: 100, height: 80 },
    { format_id: 'desconocido', url: 'x' }
  ] };
  assert.deepEqual(rat.calidades(info), [1080, 720, 480, 360, 144]);
  assert.deepEqual(rat.calidades({}), []);
  assert.deepEqual(rat.calidades(null), []);
});

test('lee el progreso, el nombre y la ruta final de la salida de yt-dlp', () => {
  assert.deepEqual(rat.leeLinea('[download]  45.2% of   10.00MiB at  1.00MiB/s ETA 00:05'), { tipo: 'progreso', percent: 45.2, total: 10485760 });
  assert.deepEqual(rat.leeLinea('[download]  12.0% of ~  5.50MiB at  1.00MiB/s ETA 00:10 (frag 3/25)'), { tipo: 'progreso', percent: 12, total: 5767168 });
  assert.deepEqual(rat.leeLinea('[download] 100% of  512.00KiB in 00:00:01 at 400.00KiB/s\r'), { tipo: 'progreso', percent: 100, total: 524288 });
  assert.deepEqual(rat.leeLinea('[download]   3.1% of 1.20GiB at 5MiB/s'), { tipo: 'progreso', percent: 3.1, total: 1288490189 });
  assert.deepEqual(rat.leeLinea('[download]  50.0% of Unknown total size'), { tipo: 'progreso', percent: 50 });
  assert.deepEqual(rat.leeLinea('[rat] archivo C:\\Temp\\naviris-rat-1\\Me at the zoo [jNQXAC9IVRw].mp4'), { tipo: 'archivo', ruta: 'C:\\Temp\\naviris-rat-1\\Me at the zoo [jNQXAC9IVRw].mp4' });
  assert.deepEqual(rat.leeLinea('[rat] final C:\\Temp\\x\\1 A.M Study Session 📚 [lofi] [id].mp3\r'), { tipo: 'final', ruta: 'C:\\Temp\\x\\1 A.M Study Session 📚 [lofi] [id].mp3' });
  assert.deepEqual(rat.leeLinea('ERROR: [youtube] abc: Video unavailable'), { tipo: 'error', texto: '[youtube] abc: Video unavailable' });
  assert.equal(rat.leeLinea('[youtube] Extracting URL: https://…'), null);
  assert.equal(rat.leeLinea('WARNING: algo'), null);
  assert.equal(rat.leeLinea(''), null);
});

test('el lector junta líneas y letras UTF-8 partidas entre trozos', () => {
  const eventos = [];
  const l = rat.creaLector((e) => eventos.push(e));
  const linea = Buffer.from("[rat] final C:\\Users\\O'Brien\\ñandú 📚.mp4\n[download]  10.0% of 1.00MiB\n", 'utf8');
  // corta dentro de la "ñ" y dentro del emoji, y deja la última línea sin \n
  const corte1 = linea.indexOf(Buffer.from('ñ')) + 1, corte2 = linea.indexOf(Buffer.from('📚')) + 2;
  l.escribe(linea.subarray(0, corte1)); l.escribe(linea.subarray(corte1, corte2)); l.escribe(linea.subarray(corte2));
  l.escribe(Buffer.from('ERROR: sin salto final', 'utf8'));
  assert.equal(eventos.length, 2);
  l.cierra();
  assert.deepEqual(eventos, [
    { tipo: 'final', ruta: "C:\\Users\\O'Brien\\ñandú 📚.mp4" },
    { tipo: 'progreso', percent: 10, total: 1048576 },
    { tipo: 'error', texto: 'sin salto final' }
  ]);
});

test('los errores de yt-dlp se traducen y dicen qué hacer', () => {
  const yt = 'https://www.youtube.com/watch?v=x';
  const ig = 'https://www.instagram.com/reel/a/';
  const casos = [
    ['Unsupported URL: https://example.com', yt, /no es compatible/],
    ['[youtube] x: Sign in to confirm you’re not a bot', yt, /Inicia sesión en YouTube/],
    ['[youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.', yt, /restricción de edad.*YouTube/],
    ['[Instagram] a: Requested content is not available, rate-limit reached or login required', ig, /Inicia sesión en Instagram/],
    ['[Reddit] 6rrwyj: Account authentication is required. Use --cookies-from-browser', 'https://www.reddit.com/r/a/comments/b/', /Inicia sesión en Reddit/],
    ['[vimeo] 1: The web client only works when logged-in.', 'https://vimeo.com/1', /Inicia sesión en Vimeo/],
    ['This format is DRM protected; Try selecting another format', 'https://vimeo.com/1', /DRM/],
    ['[youtube] x: Requested format is not available', yt, /Máxima calidad/],
    ['[TikTok] 1: Your IP address is blocked from accessing this post', 'https://www.tiktok.com/@a/video/1', /tu conexión o tu país/],
    ['[youtube] x: Video unavailable. This video has been removed', yt, /no está disponible/],
    ['[generic] x: No video formats found!', 'https://example.com/v', /Abre el video concreto/],
    ['[facebook] 1: Cannot parse data; please report this issue on https://github.com/yt-dlp/yt-dlp/issues', 'https://www.facebook.com/watch/?v=1', /^Facebook cambió.*actualizando/],
    ['unable to download video data: HTTP Error 403: Forbidden', yt, /rechazó la descarga/],
    ['HTTP Error 429: Too Many Requests', yt, /^YouTube está frenando/],
    ['Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>', yt, /Revisa tu conexión/],
    ['[Errno 28] No space left on device', yt, /espacio en el disco/],
    ["EPERM: operation not permitted, rename 'a' -> 'b'", yt, /No se pudo guardar en Descargas/],
    ['Postprocessing: ffprobe and ffmpeg not found', yt, /Reinicia Naviris/],
    ['This live event will begin in 3 hours', yt, /aún no ha empezado/],
    ['', yt, /^No se pudo descargar\. Vuelve a intentarlo/],
    [undefined, null, /^No se pudo descargar/]
  ];
  for (const [texto, url, rx] of casos) assert.match(rat.errorDeYtDlp(texto, url), rx, String(texto));
  // Ningún mensaje acaba en punto ni enseña la URL o el inglés original
  for (const [texto, url] of casos) {
    const m = rat.errorDeYtDlp(texto, url);
    assert.ok(!/\.$/.test(m) && !/https?:|ERROR|yt-dlp/.test(m), m);
  }
});

test('qué errores fuerzan actualizar yt-dlp', () => {
  assert.equal(rat.pideActualizar('[youtube] x: Unable to extract initial player response'), true);
  assert.equal(rat.pideActualizar('Cannot parse data; please report this issue'), true);
  assert.equal(rat.pideActualizar('HTTP Error 403: Forbidden'), true);
  assert.equal(rat.pideActualizar('Video unavailable'), false);
  assert.equal(rat.pideActualizar('Private video'), false);
  assert.equal(rat.pideActualizar(''), false);
});

test('cookies: solo las del sitio del enlace, en formato Netscape', () => {
  assert.deepEqual(rat.dominiosCookies('https://www.instagram.com/reel/a/'), ['instagram.com']);
  assert.deepEqual(rat.dominiosCookies('https://x.com/a/status/1').sort(), ['twitter.com', 'x.com']);
  assert.deepEqual(rat.dominiosCookies('https://mobile.twitter.com/a/status/1').sort(), ['twitter.com', 'x.com']);
  assert.deepEqual(rat.dominiosCookies('https://youtu.be/abc').sort(), ['youtu.be', 'youtube.com']);
  assert.deepEqual(rat.dominiosCookies('https://music.youtube.com/watch?v=1'), ['youtube.com']);
  assert.deepEqual(rat.dominiosCookies('https://www.bbc.co.uk/news/av/1'), ['bbc.co.uk']);
  assert.deepEqual(rat.dominiosCookies('https://videos.elcomercio.com.pe/v/1'), ['elcomercio.com.pe']);
  assert.deepEqual(rat.dominiosCookies('mal'), []);
  const txt = rat.ficheroCookies([
    { domain: '.instagram.com', path: '/', secure: true, httpOnly: true, expirationDate: 1893456000.7, name: 'sessionid', value: 'abc' },
    { domain: 'www.instagram.com', hostOnly: true, path: '/', secure: false, httpOnly: false, name: 'csrftoken', value: 'x\ty' },
    { domain: 'instagram.com', hostOnly: false, secure: true, name: 'mid', value: 'm' }
  ]);
  assert.equal(txt, [
    '# Netscape HTTP Cookie File',
    '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tabc',
    'www.instagram.com\tFALSE\t/\tFALSE\t0\tcsrftoken\tx y',
    '.instagram.com\tTRUE\t/\tTRUE\t0\tmid\tm'
  ].join('\n') + '\n');
});

test('versiones de yt-dlp: comparar, validar y leer la de la redirección', () => {
  assert.equal(rat.comparaVersiones('2026.10.26', '2026.08.19'), 1);
  assert.equal(rat.comparaVersiones('2026.08.19', '2026.10.26'), -1);
  assert.equal(rat.comparaVersiones('2026.10.26', '2026.10.26'), 0);
  assert.equal(rat.comparaVersiones('2026.10.26.1', '2026.10.26'), 1);
  assert.equal(rat.comparaVersiones('2026.10.9', '2026.10.26'), -1);
  assert.equal(rat.esVersionYtDlp('2026.10.26'), true);
  assert.equal(rat.esVersionYtDlp('2026.10.26.233402\n'), true);
  for (const v of [null, '', 'Traceback (most recent call last)', '1.2.3']) assert.equal(rat.esVersionYtDlp(v), false, String(v));
  assert.equal(rat.versionDeRedireccion('https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26'), '2026.10.26');
  assert.equal(rat.versionDeRedireccion('https://github.com/denoland/deno/releases/tag/v2.9.8'), '2.9.8');
  assert.equal(rat.versionDeRedireccion('https://github.com/login'), null);
  assert.ok(rat.esVersionYtDlp(rat.VERSION_MINIMA_YTDLP));
});

test('huellas: lista de yt-dlp y archivo .sha256sum de Deno (formato PowerShell)', () => {
  const h = 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d';
  const sumas = `0000000000000000000000000000000000000000000000000000000000000000  yt-dlp\n${h}  yt-dlp.exe\n1111111111111111111111111111111111111111111111111111111111111111  yt-dlp_x86.exe\n`;
  assert.equal(rat.huellaEnSumas(sumas, 'yt-dlp.exe'), h);
  assert.equal(rat.huellaEnSumas(sumas.replace('  yt-dlp.exe', ' *yt-dlp.exe'), 'yt-dlp.exe'), h);
  assert.equal(rat.huellaEnSumas(sumas, 'nada.exe'), null);
  const deno = '\r\nAlgorithm : SHA256\r\nHash      : CBA84B26E0DF5AE7F74FC66B86A95B866872A86292EBD84FA1E959927EDD93BF\r\nPath      : C:\\a\\deno\\deno-x86_64-pc-windows-msvc.zip\r\n';
  assert.equal(rat.huellaEnSumas(deno, 'deno-x86_64-pc-windows-msvc.zip'), 'cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf');
  assert.equal(rat.huellaEnSumas('', 'x'), null);
  assert.match(rat.BINARIOS.ffmpeg.sha256, /^[0-9a-f]{64}$/);
});

test('cuándo se revisa yt-dlp', () => {
  const DIA = 86400000, ahora = 10 * DIA;
  const base = { version: '2099.01.01', revisadoEn: ahora - 1000, ahora, cadaMs: DIA, forzar: false };
  assert.equal(rat.tocaRevisar(base), false);                                   // al día y revisado hace nada
  assert.equal(rat.tocaRevisar({ ...base, revisadoEn: ahora - DIA }), true);     // pasó el plazo
  assert.equal(rat.tocaRevisar({ ...base, revisadoEn: undefined }), true);       // nunca revisado
  assert.equal(rat.tocaRevisar({ ...base, forzar: true }), true);               // tras un error de motor viejo
  assert.equal(rat.tocaRevisar({ ...base, version: '2026.08.19' }), true);       // por debajo de la mínima
  assert.equal(rat.tocaRevisar({ ...base, version: null }), true);               // no arranca
});

test('literal de PowerShell: dobla las comillas, también las tipográficas', () => {
  assert.equal(rat.literalPs("C:\\Users\\O'Brien\\bin.zip"), "'C:\\Users\\O''Brien\\bin.zip'");
  assert.equal(rat.literalPs('C:\\Users\\José ‘Pepe’\\x'), "'C:\\Users\\José ‘‘Pepe’’\\x'");
  assert.equal(rat.literalPs('C:\\Ñandú 100% $env:x'), "'C:\\Ñandú 100% $env:x'");
});

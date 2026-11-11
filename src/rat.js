/* Rat Tool: la parte que no depende de Electron. La usan el proceso principal
   (main.js: argumentos de yt-dlp, lectura de su salida, errores, binarios), el
   panel (renderer/herramientas.js, como <script>: qué plataforma es y si el enlace es de un
   video) y build/fetch-bin.js. Así se prueba con node:test sin abrir la app
   (test/rat.test.js) y las reglas no se repiten en tres sitios. */
(function (raiz) {
  'use strict';

  /* ---------- Plataformas ----------
     Las que promete el README y el panel. `video` dice si el enlace es de un
     video concreto (y no del feed, un perfil o un canal): el panel avisa con
     "Abre un video concreto" y, si no lo es, mira el portapapeles. */
  const PLATAFORMAS = [
    { id: 'youtube', nombre: 'YouTube', marca: 'youtube', dominios: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
      video: (u) => u.hostname.endsWith('youtu.be') ? /^\/[\w-]{6,}/.test(u.pathname)
        : (u.pathname === '/watch' && u.searchParams.has('v')) || /^\/(shorts|live|embed|v)\/[\w-]{6,}/.test(u.pathname) },
    { id: 'instagram', nombre: 'Instagram', marca: 'instagram', dominios: ['instagram.com'],
      video: (u) => /^\/(?:[\w.]+\/)?(p|reels?|tv)\/[\w-]+/.test(u.pathname) },
    { id: 'x', nombre: 'X', marca: 'x', dominios: ['x.com', 'twitter.com'],
      video: (u) => /\/status(?:es)?\/\d+/.test(u.pathname) },
    // vm.tiktok.com/XXXX y tiktok.com/t/XXXX son enlaces cortos de compartir
    { id: 'tiktok', nombre: 'TikTok', marca: null, dominios: ['tiktok.com'],
      video: (u) => /\/(video|photo)\/\d+/.test(u.pathname) || /^(vm|vt)\./.test(u.hostname) || /^\/t\/\w+/.test(u.pathname) },
    // Un canal (twitch.tv/nombre) es el directo: no se ofrece, no acabaría nunca
    { id: 'twitch', nombre: 'Twitch', marca: 'twitch', dominios: ['twitch.tv'],
      video: (u) => /^clips\./.test(u.hostname) || /^\/videos\/\d+/.test(u.pathname) || /\/clip\/[\w-]+/.test(u.pathname) },
    { id: 'facebook', nombre: 'Facebook', marca: null, dominios: ['facebook.com', 'fb.watch'],
      video: (u) => u.hostname.endsWith('fb.watch') || /\/(videos|reel|watch)\b|\/video\.php|\/share\/[rv]\//.test(u.pathname) },
    { id: 'vimeo', nombre: 'Vimeo', marca: null, dominios: ['vimeo.com'],
      video: (u) => /^\/(?:video\/)?\d+|\/\d+(?:\/|$)/.test(u.pathname) },
    { id: 'reddit', nombre: 'Reddit', marca: 'reddit', dominios: ['reddit.com', 'redd.it'],
      video: (u) => u.hostname.endsWith('redd.it') || /\/comments\/\w+/.test(u.pathname) },
    { id: 'dailymotion', nombre: 'Dailymotion', marca: null, dominios: ['dailymotion.com', 'dai.ly'],
      video: (u) => u.hostname.endsWith('dai.ly') || /\/video\/\w+/.test(u.pathname) || /[?&]video=\w+/.test(u.search) }
  ];
  // Para sitios que no están en la lista (yt-dlp sabe de cientos): la forma
  // típica de un enlace de video.
  const RX_VIDEO_GENERICO = /\/(watch|shorts|video|videos|status|reel|reels|clip|p|tv|embed)(\/|\?|$)/i;

  const urlDe = (s) => { try { const u = new URL(String(s || '').trim()); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
  const enDominio = (host, d) => host === d || host.endsWith('.' + d);

  function plataforma(url) {
    const u = urlDe(url); if (!u) return null;
    const host = u.hostname.toLowerCase();
    return PLATAFORMAS.find((p) => p.dominios.some((d) => enDominio(host, d))) || null;
  }
  function esVideo(url) {
    const u = urlDe(url); if (!u) return false;
    const p = plataforma(url);
    return p ? p.video(u) : RX_VIDEO_GENERICO.test(u.pathname + u.search);
  }
  // Lista de YouTube sin video elegido (playlist?list=…). Con un video dentro
  // (watch?v=…&list=…) se baja solo ese gracias a --no-playlist.
  function esLista(url) {
    const u = urlDe(url); if (!u) return false;
    return plataforma(url)?.id === 'youtube' && u.searchParams.has('list') && !esVideo(url);
  }
  /* Canal de Twitch (twitch.tv/<canal>): lo que se bajaría es su directo, que
     no acaba nunca. Se rechaza antes de lanzar yt-dlp. Los directos de otras
     plataformas solo se saben al extraer (is_live): ver argsDescarga. */
  const RUTAS_TWITCH = /^(directory|videos|settings|downloads|search|subscriptions|inventory|drops|wallet|friends|messages|login|signup|turbo|prime|jobs|p|u)$/i;
  function esDirecto(url) {
    const u = urlDe(url); if (!u || plataforma(url)?.id !== 'twitch' || esVideo(url)) return false;
    const m = u.pathname.match(/^\/(\w{2,25})\/?$/);
    return !!m && !RUTAS_TWITCH.test(m[1]);
  }
  const mensajeDirecto = (url) => (plataforma(url)?.id === 'twitch'
    ? 'Los directos no se descargan. Cuando acabe, descarga el video desde la pestaña Videos del canal'
    : 'Los directos no se descargan. Cuando acabe, descarga el video ya publicado');

  /* ---------- Argumentos de yt-dlp ---------- */

  /* vimeo.com/<id> solo funciona con sesión en yt-dlp ("The web client only
     works when logged-in"); el reproductor incrustado (player.vimeo.com) da el
     mismo video sin ella. Los enlaces privados llevan un hash (vimeo.com/<id>/<h>)
     que el reproductor pide como ?h=. */
  function urlParaYtDlp(url) {
    const u = urlDe(url); if (!u) return url;
    if (plataforma(url)?.id === 'vimeo' && !/^player\./.test(u.hostname)) {
      const m = u.pathname.match(/(?:^|\/)(\d+)(?:\/([0-9a-f]{6,}))?\/?$/);
      if (m) return 'https://player.vimeo.com/video/' + m[1] + (m[2] ? '?h=' + m[2] : '');
    }
    return url;
  }

  /* Qué formato de video se pide (-f), por orden, con la calidad elegida N
     contada por el lado corto (un Short de 1080x1920 es 1080p, como en el
     selector):
     1. H.264 + AAC; 2. H.264 + el mejor audio. Con N, solo H.264 de lado corto
        <= N (aspect_ratio dice cuál es el corto). H.264 se abre en cualquier
        reproductor, editor o móvil; si en esa calidad YouTube solo da VP9/AV1
        (por encima de 1080p), sale el H.264 más alto por debajo.
     3. Si no hay ningún H.264 así, lo que haya (VP9, AV1…), lo más cercano a N.
     TikTok: archivo único (sin unir video y audio) y nunca el formato
     "download", que es el que lleva la marca de agua. TikTok llama "h264" al
     códec; el resto, "avc1". */
  const H264 = "[vcodec~='^(avc|h264)']";
  function formatoVideo(quality, tiktok) {
    const n = parseInt(quality, 10);
    const lados = n > 0 ? [`[aspect_ratio>=1][height<=${n}]`, `[aspect_ratio<1][width<=${n}]`] : [''];
    if (tiktok) {
      const sinMarca = 'b[format_note!*=?watermark]';
      return [...lados.map((l) => sinMarca + H264 + l), sinMarca, 'b'].join('/');
    }
    return [...lados.map((l) => `bv*${H264}${l}+ba[acodec^=mp4a]`), ...lados.map((l) => `bv*${H264}${l}+ba`), 'bv*+ba', 'b'].join('/');
  }
  // Orden dentro de cada opción (-S): la mayor resolución, o la más cercana por
  // debajo de N; luego fps, y audio AAC y contenedor MP4 para no recomprimir.
  function ordenFormatos(quality) {
    const n = parseInt(quality, 10);
    return [(n > 0 ? 'res:' + n : 'res'), 'fps', 'acodec:aac', 'ext:mp4:m4a'].join(',');
  }

  // Lo que yt-dlp imprime para Naviris (con -q solo sale esto, el progreso y los errores)
  const MARCA = '[rat]';
  const PLANTILLA = '%(title).120s [%(id)s].%(ext)s';

  /* opts: { url, mode: 'video'|'audio', quality, dir, ffmpeg, deno, ua, cookies }
     deno y cookies son opcionales (ruta o null).
     · dir: carpeta temporal y vacía, propia de cada descarga. yt-dlp baja, une y
       convierte ahí, y main.js mueve a Descargas solo el archivo terminado.
       Probado con la versión anterior, que escribía directo en Descargas:
       bajar el MP3 de un video cuyo MP4 ya estaba allí fallaba con "HTTP Error
       416" (reanudaba sobre el MP4) o, peor, cogía ese MP4 como descargado, lo
       convertía y lo BORRABA. Y con --no-part lo que quedaba a medias en
       Descargas ya llevaba el nombre final.
     · --encoding utf-8: sin él yt-dlp escribe la tubería en la página de códigos
       de Windows y las rutas con tildes o emojis llegaban rotas (el panel no
       podía abrir el archivo; probado con "ñandú" y "📚").
     · --print: el nombre al empezar y la ruta final al terminar, en líneas
       propias, en vez de adivinarlos de los mensajes de cada paso; y si es un
       directo (pre_process sale antes del filtro).
     · --match-filter !is_live: un directo no se graba (no acabaría nunca). yt-dlp
       lo salta sin error y "[rat] estado is_live" dice por qué no hay archivo.
     · --no-playlist: un enlace de video dentro de una lista baja solo ese video.
     · --: la URL nunca se lee como una opción. */
  function argsDescarga(opts) {
    const { mode, quality, dir, ffmpeg, deno, ua, cookies } = opts;
    const url = urlParaYtDlp(opts.url);
    const comunes = ['--no-playlist', '-q', '--progress', '--newline', '--no-part', '--encoding', 'utf-8',
      '--match-filter', '!is_live', '--print', 'pre_process:' + MARCA + ' estado %(live_status)s',
      '--print', 'before_dl:' + MARCA + ' archivo %(filename)s', '--print', 'after_move:' + MARCA + ' final %(filepath)s',
      '--ffmpeg-location', ffmpeg];
    // --js-runtimes: sin Deno YouTube solo deja formatos sueltos o ninguno (EJS).
    if (deno) comunes.push('--js-runtimes', 'deno:' + deno);
    comunes.push('-P', dir, '-o', PLANTILLA, '--user-agent', ua);
    if (cookies) comunes.push('--cookies', cookies);
    if (mode === 'audio') return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0', ...comunes, '--', url];
    return ['-f', formatoVideo(quality, plataforma(url)?.id === 'tiktok'), '-S', ordenFormatos(quality),
      '--merge-output-format', 'mp4', '--remux-video', 'mp4', ...comunes, '--', url];
  }

  function argsFormatos({ url, deno, ua, cookies }) {
    const a = ['--no-playlist', '--no-warnings', '--dump-single-json', '--encoding', 'utf-8'];
    if (deno) a.push('--js-runtimes', 'deno:' + deno);
    a.push('--user-agent', ua);
    if (cookies) a.push('--cookies', cookies);
    a.push('--', urlParaYtDlp(url));
    return a;
  }

  // Calidades para el selector a partir del JSON de yt-dlp: el lado corto de
  // cada formato con video (los "storyboard" de YouTube son imágenes, fuera).
  // Un directo no ofrece ninguna: no se descarga.
  function calidades(info) {
    const set = new Set();
    if (info && info.is_live) return [];
    for (const f of (info && info.formats) || []) {
      if (!f.vcodec || f.vcodec === 'none' || f.ext === 'mhtml') continue;
      const lado = Math.min(f.width || Infinity, f.height || Infinity);
      if (Number.isFinite(lado) && lado >= 144) set.add(lado);
    }
    return [...set].sort((a, b) => b - a);
  }

  /* ---------- Sesión ----------
     A YouTube no se le pasan de entrada las cookies: yt-dlp avisa de que usar
     la cuenta puede hacer que YouTube la marque, y casi nada las necesita. Solo
     si yt-dlp dice que hace falta iniciar sesión (edad, "Sign in to confirm",
     privado, solo miembros) se reintenta UNA vez con ellas. Al resto de
     plataformas se les pasan siempre (Instagram, X o Reddit no dan nada sin). */
  const cookiesDeEntrada = (url) => plataforma(url)?.id !== 'youtube';
  const PIDE_SESION = /Sign in to confirm|confirm your age|age[- ]restricted|inappropriate for some users|Private video|members[- ]only|Join this channel|login required|requires authentication|use --cookies/i;
  const reintentaConCookies = (texto, url) => plataforma(url)?.id === 'youtube' && PIDE_SESION.test(String(texto || ''));

  /* ---------- Lectura de la salida ----------
     Una línea por evento (--newline). Los trozos que llegan por la tubería
     pueden cortar una línea, o una letra UTF-8, por la mitad: se decodifica en
     modo continuo y se procesa por líneas completas. */
  const MULT = { B: 1, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
  function leeLinea(linea) {
    const l = linea.replace(/\r$/, '');
    let m;
    if ((m = l.match(/^\[rat\] (archivo|final) (.+)$/))) return { tipo: m[1], ruta: m[2].trim() };
    if ((m = l.match(/^\[rat\] estado (\S+)/))) return { tipo: 'estado', valor: m[1] };
    if ((m = l.match(/^\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+)\s*(B|KiB|MiB|GiB|TiB))?/))) {
      const r = { tipo: 'progreso', percent: Math.min(100, parseFloat(m[1])) };
      if (m[2]) r.total = Math.round(parseFloat(m[2]) * MULT[m[3]]);
      return r;
    }
    if ((m = l.match(/^ERROR:\s*(.+)$/))) return { tipo: 'error', texto: m[1].trim() };
    return null;
  }
  function creaLector(alEvento) {
    const dec = new TextDecoder('utf-8');
    let resto = '';
    const procesa = (txt) => {
      const partes = (resto + txt).split('\n');
      resto = partes.pop();
      for (const p of partes) { const e = leeLinea(p); if (e) alEvento(e); }
    };
    return {
      escribe: (trozo) => procesa(typeof trozo === 'string' ? trozo : dec.decode(trozo, { stream: true })),
      cierra() { procesa(dec.decode()); if (resto) { const e = leeLinea(resto); resto = ''; if (e) alEvento(e); } }
    };
  }

  /* ---------- Errores ----------
     Los de yt-dlp llegan en inglés y con la URL dentro; el panel enseña esto
     (el original va a la consola del main). Cada uno dice qué hacer. */
  const MOTOR_VIEJO = /Unable to extract|Cannot parse data|please report this issue|Signature extraction failed|nsig extraction|Some formats are missing|Failed to extract any player response/i;
  function errorDeYtDlp(texto, url) {
    const t = String(texto || '');
    const sitio = plataforma(url)?.nombre || 'el sitio';
    if (/Unsupported URL/i.test(t)) return 'Este sitio no es compatible con el Rat Tool';
    if (/age[- ]restricted|confirm your age|inappropriate for some users/i.test(t)) return 'El video tiene restricción de edad. Inicia sesión en ' + sitio + ' en Naviris y vuelve a intentarlo';
    if (/Sign in to confirm|not a bot/i.test(t)) return 'YouTube pide verificar que no eres un bot. Inicia sesión en YouTube en Naviris y vuelve a intentarlo';
    if (/DRM/i.test(t)) return 'El video está protegido contra copia (DRM) y no se puede descargar';
    if (/not currently live/i.test(t)) return mensajeDirecto(url);
    if (/live event will begin|Premieres in|is_upcoming|not started yet/i.test(t)) return 'El directo o estreno aún no ha empezado. Inténtalo cuando acabe';
    if (/Private video|login required|requires authentication|Account authentication is required|registered users|log in|logged-in|cookies/i.test(t)) return 'El video es privado o pide iniciar sesión. Inicia sesión en ' + sitio + ' en Naviris y vuelve a intentarlo';
    if (/Requested format is not available/i.test(t)) return 'Esa calidad no está disponible. Elige Máxima calidad y vuelve a intentarlo';
    if (/IP address is blocked|blocked from accessing|geo.?restrict|not available in your country/i.test(t)) return 'El video no está disponible desde tu conexión o tu país';
    if (/No space left|not enough space/i.test(t)) return 'No queda espacio en el disco. Libera espacio y vuelve a intentarlo';
    if (/Permission denied|unable to open for writing|Errno 13|EPERM|EACCES|EBUSY|operation not permitted/i.test(t)) return 'No se pudo guardar en Descargas. Revisa que la carpeta exista y que tengas permiso';
    if (/ffmpeg|ffprobe|Postprocessing|Conversion failed/i.test(t)) return 'No se pudo convertir el archivo. Reinicia Naviris para reparar el motor de descargas';
    if (MOTOR_VIEJO.test(t)) return sitio.charAt(0).toUpperCase() + sitio.slice(1) + ' cambió y el motor de descargas se está actualizando. Vuelve a intentarlo en un minuto';
    if (/Video unavailable|not available|has been removed|does not exist|deleted/i.test(t)) return 'El video no está disponible: puede que lo hayan borrado o sea privado';
    if (/No video formats found|no video in this|There's no video|No media found/i.test(t)) return 'No se encontró ningún video en esa página. Abre el video concreto y vuelve a intentarlo';
    if (/HTTP Error 429|Too Many Requests|rate.?limit/i.test(t)) return sitio.charAt(0).toUpperCase() + sitio.slice(1) + ' está frenando las descargas. Espera unos minutos y vuelve a intentarlo';
    if (/HTTP Error 403|Forbidden/i.test(t)) return 'El sitio rechazó la descarga. Vuelve a intentarlo en unos minutos';
    if (/HTTP Error 404/i.test(t)) return 'No se encontró el video. Revisa el enlace';
    if (/Unable to download webpage|timed out|getaddrinfo|Connection|network|Errno 110|Errno 11001|SSL/i.test(t)) return 'No se pudo conectar con el sitio. Revisa tu conexión y vuelve a intentarlo';
    return 'No se pudo descargar. Vuelve a intentarlo; si sigue fallando, reinicia Naviris';
  }
  // ¿El fallo huele a yt-dlp desfasado? Entonces se fuerza la actualización.
  const pideActualizar = (texto) => MOTOR_VIEJO.test(String(texto || '')) || /HTTP Error 403/i.test(String(texto || ''));

  /* ---------- Cookies (formato Netscape para --cookies) ----------
     Solo las del sitio del enlace. El dominio "raíz" son las dos últimas
     etiquetas, o tres en los dominios tipo .co.uk / .com.pe, para no pasarle a
     yt-dlp las cookies de todo .co.uk. x.com y twitter.com comparten sesión. */
  function dominiosCookies(url) {
    const u = urlDe(url); if (!u) return [];
    const et = u.hostname.toLowerCase().split('.');
    const n = et.length >= 3 && et[et.length - 1].length === 2 && /^(co|com|org|net|gob|gov|ac|edu|ne|or)$/.test(et[et.length - 2]) ? 3 : 2;
    const set = new Set([et.slice(-n).join('.')]);
    const p = plataforma(url);
    if (p && p.id === 'x') { set.add('x.com'); set.add('twitter.com'); }
    if (p && p.id === 'youtube') set.add('youtube.com');
    return [...set];
  }
  function lineaCookie(c) {
    const dom = c.domain.startsWith('.') ? c.domain : (c.hostOnly ? c.domain : '.' + c.domain);
    const exp = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    const limpia = (s) => String(s == null ? '' : s).replace(/[\t\r\n]/g, ' ');
    return [(c.httpOnly ? '#HttpOnly_' : '') + dom, dom.startsWith('.') ? 'TRUE' : 'FALSE', limpia(c.path || '/'),
      c.secure ? 'TRUE' : 'FALSE', exp, limpia(c.name), limpia(c.value)].join('\t');
  }
  const ficheroCookies = (cookies) => ['# Netscape HTTP Cookie File', ...cookies.map(lineaCookie)].join('\n') + '\n';

  /* ---------- Binarios ----------
     yt-dlp: el último publicado, comprobado contra el SHA2-256SUMS de su
     versión. Por debajo de VERSION_MINIMA se actualiza sí o sí (no espera a la
     revisión diaria): es la primera que pasó todas las pruebas de
     test/e2e. Deno: el último, con su .sha256sum. ffmpeg: versión fija con su
     huella (la de la página de GitHub), cambia poco y no rompe. */
  const VERSION_MINIMA_YTDLP = '2026.10.26';
  const BINARIOS = {
    ytdlp: {
      ultima: 'https://github.com/yt-dlp/yt-dlp/releases/latest',
      url: (v) => `https://github.com/yt-dlp/yt-dlp/releases/download/${v}/yt-dlp.exe`,
      sumas: (v) => `https://github.com/yt-dlp/yt-dlp/releases/download/${v}/SHA2-256SUMS`
    },
    ffmpeg: {
      url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
      sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
    },
    deno: {
      url: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip',
      sumas: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip.sha256sum'
    }
  };
  // "2026.10.26" o "2026.10.26.1" (las de arreglo urgente llevan un cuarto número)
  function comparaVersiones(a, b) {
    const pa = String(a || '').trim().split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '').trim().split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  const esVersionYtDlp = (v) => /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(String(v || '').trim());
  // La versión sale de la redirección de releases/latest → …/releases/tag/<versión>
  const versionDeRedireccion = (loc) => { const m = String(loc || '').match(/\/releases\/tag\/v?([\w.]+)\/?$/); return m ? m[1] : null; };
  // Huella de un archivo dentro de una lista de sumas: "<hex>  nombre", "<hex> *nombre"
  // o el formato de PowerShell de Deno ("Hash      : <HEX>"), que no lleva nombre.
  function huellaEnSumas(texto, nombre) {
    const t = String(texto || '');
    for (const l of t.split(/\r?\n/)) {
      const m = l.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
      if (m && m[2].trim() === nombre) return m[1].toLowerCase();
    }
    const ps = t.match(/Hash\s*:\s*([0-9a-fA-F]{64})/);
    if (ps) return ps[1].toLowerCase();
    const solo = t.trim().match(/^([0-9a-fA-F]{64})$/);
    return solo ? solo[1].toLowerCase() : null;
  }
  /* ¿Toca revisar yt-dlp? Siempre si no arranca o está por debajo de la mínima;
     si no, como mucho cada `cadaMs` y solo si la última revisión salió bien
     (si falló, se reintenta la próxima vez que se abra el Rat Tool). Forzada
     (tras un error de motor viejo) como mucho una vez por hora (`forzadaEn`):
     varias descargas fallando seguidas no disparan una revisión cada una. */
  const ESPERA_FORZADA_MS = 60 * 60 * 1000;
  function tocaRevisar({ version, revisadoEn, ahora, cadaMs, forzar, forzadaEn }) {
    if (!esVersionYtDlp(version)) return true;
    if (forzar && ahora - (forzadaEn || 0) >= ESPERA_FORZADA_MS) return true;
    if (comparaVersiones(version, VERSION_MINIMA_YTDLP) < 0) return true;
    return ahora - (revisadoEn || 0) >= cadaMs;
  }

  /* Restos de descargas cortadas (Naviris cerrado a mitad): las carpetas
     temporales del Rat Tool y los archivos de cookies que no llegaron a
     borrarse. Solo los nombres exactos que crea main.js y con más de una hora,
     para no tocar nunca una descarga en marcha ni nada ajeno.
     entradas: [{ nombre, carpeta: bool, mtimeMs }] de la carpeta temporal. */
  const PREFIJO_TEMPORAL = 'naviris-rat-descarga-';
  const RX_RESTO_CARPETA = /^naviris-rat-descarga-[A-Za-z0-9]{6}$/;
  const RX_RESTO_COOKIES = /^naviris-cookies-\d+-[a-z0-9]{1,8}\.txt$/;
  // ¿Esa ruta de Windows cae dentro de la carpeta? Sin .. de por medio.
  function dentroDeCarpeta(carpeta, ruta) {
    const limpia = (p) => String(p).replace(/\//g, '\\').toLowerCase();
    const r = limpia(ruta);
    return r.startsWith(limpia(carpeta).replace(/\\+$/, '') + '\\') && !r.split('\\').includes('..');
  }

  const restosTemporales = (entradas, ahora) => entradas.filter((e) => ahora - e.mtimeMs > 60 * 60 * 1000
    && (e.carpeta ? RX_RESTO_CARPETA.test(e.nombre) : RX_RESTO_COOKIES.test(e.nombre))).map((e) => e.nombre);

  // Texto dentro de un literal '...' de PowerShell. PowerShell también cierra el
  // literal con las comillas tipográficas (‘ ’ ‚ ‛), así que se doblan todas:
  // una ruta como C:\Users\O'Brien rompía la orden.
  const literalPs = (s) => "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q) + "'";

  const api = {
    PLATAFORMAS, plataforma, esVideo, esLista, esDirecto, mensajeDirecto, urlParaYtDlp, formatoVideo, ordenFormatos,
    argsDescarga, argsFormatos, calidades, leeLinea, creaLector, errorDeYtDlp, pideActualizar,
    dominiosCookies, ficheroCookies, cookiesDeEntrada, reintentaConCookies, PREFIJO_TEMPORAL, restosTemporales, dentroDeCarpeta,
    VERSION_MINIMA_YTDLP, BINARIOS, comparaVersiones, esVersionYtDlp, versionDeRedireccion, huellaEnSumas, tocaRevisar,
    literalPs
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.ratTool = api;
})(typeof window !== 'undefined' ? window : globalThis);

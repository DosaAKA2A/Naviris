const { app, BrowserWindow, ipcMain, shell, nativeTheme, session, net, clipboard, safeStorage, dialog, components, protocol, Menu, screen, webContents, webFrameMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const braveAdblock = require('./adblock');
const { conservaCookiesDeSesion } = require('./sesiones');
const { migraPerfil, migraCarpetaV1, migraNombre, PART_NAVIRIS } = require('./migraciones');
const emergentes = require('./emergentes'); // ventanas emergentes solo con gesto (se prueba en test/)
const rat = require('./rat'); // Rat Tool: argumentos de yt-dlp, errores, binarios (se prueba en test/)
const atajos = require('./atajos');             // tabla única de atajos (también la lee el renderer)
const { crearFreno } = require('./freno-recargas');
const { aplicacionPara } = require('./externos');
const abrirDesdeFuera = require('./abrir-desde-fuera'); // enlaces y archivos que llegan de Windows (se prueba en test/)

// Los addons de herramienta se sirven por un esquema propio en vez de ejecutarse
// con new Function(): la CSP de la interfaz privilegiada NO lleva 'unsafe-eval'
// (a propósito, ver SEGURIDAD.md) y eso hacía que ningún addon llegara a cargar.
// Con esquema propio la CSP sigue estricta y además solo se puede cargar código
// de addons instalados y activos: un XSS no puede inventarse un script.
// registerSchemesAsPrivileged tiene que ir ANTES de que la app esté lista.
const ADDON_SCHEME = 'naviris-addon';
protocol.registerSchemesAsPrivileged([
  { scheme: ADDON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  /* Sustitutos del bloqueador (`$redirect=`), ver adblock.js. Los pide la
     PÁGINA (un <script>, un fetch, un vídeo), así que el esquema necesita lo
     que tendría la URL original: secure (si no, la web https lo bloquea por
     contenido mixto), fetch y CORS, streaming para los sustitutos de vídeo y
     audio, y bypassCSP. Este último es el que importa: medido en Electron 42,
     una web con `script-src` por host rechaza el sustituto si el esquema no se
     salta la CSP, y el script falla igual que si se hubiera cancelado. Es lo
     mismo que consiguen los recursos de una extensión como uBlock. Lo único
     que sirve este esquema son esos recursos fijos, sin nada de la persona. */
  { scheme: braveAdblock.ESQUEMA_SUSTITUTOS, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } }
]);

// El perfil de la v1, con el nombre viejo, pasa a ser el de Naviris (ver migraciones.js).
try { migraCarpetaV1(app.getPath('appData')); } catch (e) { console.log('[Naviris] No se pudo migrar el perfil:', e.message); }

// ---------- Rutas de binarios (yt-dlp / ffmpeg / deno) ----------
// Desde v2.2.3 los binarios NO van en el instalador (~100 MB menos): se
// descargan a userData/bin la primera vez que se usa el Rat Tool. Las
// instalaciones antiguas que ya los traían en resources/bin los siguen usando.
// deno.exe vive en la misma carpeta que yt-dlp.exe (ver ensureBins): así una
// instalación antigua lo recibe junto a su yt-dlp y no queda repartido.
function binDir() {
  if (!app.isPackaged) return path.join(__dirname, '..', 'resources', 'bin');
  const legacy = path.join(process.resourcesPath, 'bin');
  if (fs.existsSync(path.join(legacy, 'yt-dlp.exe'))) return legacy;
  return path.join(app.getPath('userData'), 'bin');
}
const ytDlpPath = () => path.join(binDir(), 'yt-dlp.exe');
const ffmpegPath = () => path.join(binDir(), 'ffmpeg.exe');
const denoPath = () => path.join(binDir(), 'deno.exe');
// Deno para los retos JS de YouTube (ver ensureBins). yt-dlp ya mira si hay un
// deno.exe junto a él, pero se le pasa la ruta completa para no depender de esa
// búsqueda ni del PATH del usuario.
const denoSiHay = () => (fs.existsSync(denoPath()) ? denoPath() : null);

/* Descargas de los binarios, con lo que faltaba para fiarse de ellas:
   · se escribe en "<destino>.descarga" y solo se renombra al final: antes un
     corte a medias dejaba un yt-dlp.exe truncado que ensureBins daba por bueno
     (existía) y el Rat Tool no volvía a funcionar;
   · si en 60 s no llega nada se aborta (net.request no tiene plazo propio);
   · se comprueba el tamaño y, quien llama, la huella SHA-256 publicada. */
function downloadTo(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.descarga';
    const req = net.request(url);
    let plazo = null, acabado = false;
    const fin = (err) => {
      if (acabado) return; acabado = true; clearTimeout(plazo);
      if (err) { try { req.abort(); } catch { /* ya cerrada */ } fs.rmSync(tmp, { force: true }); reject(err); return; }
      try { fs.renameSync(tmp, dest); resolve(); } catch (e) { fs.rmSync(tmp, { force: true }); reject(e); }
    };
    const vigila = () => { clearTimeout(plazo); plazo = setTimeout(() => fin(new Error('la descarga se quedó parada')), 60000); };
    vigila();
    req.on('response', (res) => {
      if (res.statusCode !== 200) { fin(new Error('HTTP ' + res.statusCode)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const file = fs.createWriteStream(tmp);
      file.on('error', fin);
      res.on('data', (c) => { vigila(); got += c.length; file.write(c); if (total && onProgress) onProgress(got / total); });
      res.on('end', () => file.end(() => fin(total && got !== total ? new Error('descarga incompleta') : null)));
      res.on('error', fin);
    });
    req.on('error', fin);
    req.end();
  });
}
// Texto corto (listas de huellas). Con `sinRedireccion` devuelve a dónde
// redirige: así se sabe la última versión de yt-dlp sin bajar nada.
function pideTexto(url, { sinRedireccion = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: sinRedireccion ? 'manual' : 'follow' });
    const plazo = setTimeout(() => { try { req.abort(); } catch { /* nada */ } reject(new Error('sin respuesta')); }, 30000);
    // Solo con 'manual': si se escucha 'redirect', Electron no sigue la redirección
    if (sinRedireccion) req.on('redirect', (_status, _metodo, destino) => { clearTimeout(plazo); try { req.abort(); } catch { /* nada */ } resolve(destino); });
    req.on('response', (res) => {
      if (res.statusCode !== 200) { clearTimeout(plazo); reject(new Error('HTTP ' + res.statusCode)); return; }
      let txt = '';
      res.on('data', (c) => { txt += c.toString('utf8'); });
      res.on('end', () => { clearTimeout(plazo); resolve(txt); });
      res.on('error', (e) => { clearTimeout(plazo); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(plazo); reject(e); });
    req.end();
  });
}
// Al panel solo cuando cambia el número (llegan cientos de trozos por segundo)
const avisaPorcentaje = (meta, pct) => { const n = Math.round(pct); if (n !== meta.percent) { meta.percent = n; broadcast('download:update', meta); } };
// Tres intentos, con 2 y 6 s de espera: GitHub corta a veces a mitad.
async function conReintentos(fn) {
  let ultimo;
  for (const espera of [0, 2000, 6000]) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    try { return await fn(); } catch (e) { ultimo = e; console.log('[Naviris] Motor de descargas, reintento:', e.message); }
  }
  throw ultimo;
}
const huellaDe = (f) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(f).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
// Un archivo sin huella publicada o que no coincide no se queda
async function compruebaHuella(f, esperada) {
  const motivo = !esperada ? 'no se encontró la huella publicada'
    : (await huellaDe(f)) !== esperada ? 'el archivo descargado no coincide con la huella publicada' : null;
  if (motivo) { fs.rmSync(f, { force: true }); throw new Error(motivo); }
}
// Lanza el binario con --version (o -version) para saber que arranca. Devuelve
// la primera línea, o null si no arranca o tarda más de 20 s.
function versionDe(exe, arg = '--version') {
  return new Promise((resolve) => {
    let out = '', p;
    try { p = spawn(exe, [arg], { windowsHide: true }); } catch { resolve(null); return; }
    const plazo = setTimeout(() => { try { p.kill(); } catch { /* ya acabó */ } resolve(null); }, 20000);
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('error', () => { clearTimeout(plazo); resolve(null); });
    p.on('close', (code) => { clearTimeout(plazo); resolve(code === 0 ? (out.trim().split(/\r?\n/)[0] || null) : null); });
  });
}
// Sin bloquear el proceso principal: con execSync todas las ventanas se
// quedaban congeladas mientras se extraían los ~115 MB de ffmpeg.
function descomprime(zip, destino) {
  return new Promise((resolve, reject) => {
    require('child_process').execFile('powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath ${rat.literalPs(zip)} -DestinationPath ${rat.literalPs(destino)}`],
      { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
}
const buscaEn = (d, nombre) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, f.name);
    if (f.isDirectory()) { const r = buscaEn(fp, nombre); if (r) return r; }
    else if (f.name.toLowerCase() === nombre) return fp;
  }
  return null;
};
// Cada binario se prepara en un nombre provisional, se comprueba que arranca y
// solo entonces sustituye al bueno (renombrar en la misma carpeta es atómico).
async function colocaBinario(provisional, nombre, argVersion) {
  if (!(await versionDe(provisional, argVersion))) { fs.rmSync(provisional, { force: true }); throw new Error(nombre + ' no arranca'); }
  fs.renameSync(provisional, path.join(binDir(), nombre));
}
async function instalaYtDlp(version, onProgress) {
  ytDlpVersion = null;
  const B = rat.BINARIOS.ytdlp;
  const nuevo = path.join(binDir(), 'yt-dlp-nuevo.exe');
  try {
    const sumas = await pideTexto(B.sumas(version));
    await downloadTo(B.url(version), nuevo, onProgress);
    await compruebaHuella(nuevo, rat.huellaEnSumas(sumas, 'yt-dlp.exe'));
    await colocaBinario(nuevo, 'yt-dlp.exe');
  } finally {
    fs.rmSync(nuevo, { force: true }); // si algo falló a medias
  }
}
async function instalaDesdeZip(nombre, url, huella, argVersion, onProgress) {
  const dir = binDir();
  const base = nombre.replace(/\.exe$/, '');
  const zip = path.join(dir, base + '.zip');
  const tmp = path.join(dir, '_' + base);
  const provisional = path.join(dir, base + '-nuevo.exe');
  try {
    await downloadTo(url, zip, onProgress);
    await compruebaHuella(zip, await huella());
    fs.rmSync(tmp, { recursive: true, force: true });
    await descomprime(zip, tmp);
    const found = buscaEn(tmp, nombre);
    if (!found) throw new Error(nombre + ' no está en el zip');
    fs.copyFileSync(found, provisional);
    await colocaBinario(provisional, nombre, argVersion);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    fs.rmSync(provisional, { force: true });
  }
}
const versionPublicadaYtDlp = async () => {
  const v = rat.versionDeRedireccion(await pideTexto(rat.BINARIOS.ytdlp.ultima, { sinRedireccion: true }));
  if (!rat.esVersionYtDlp(v)) throw new Error('no se pudo leer la última versión de yt-dlp');
  return v;
};
const INSTALADORES = {
  'yt-dlp.exe': async (p) => instalaYtDlp(await conReintentos(versionPublicadaYtDlp), p),
  'ffmpeg.exe': (p) => instalaDesdeZip('ffmpeg.exe', rat.BINARIOS.ffmpeg.url, async () => rat.BINARIOS.ffmpeg.sha256, '-version', p),
  'deno.exe': (p) => instalaDesdeZip('deno.exe', rat.BINARIOS.deno.url,
    async () => rat.huellaEnSumas(await pideTexto(rat.BINARIOS.deno.sumas), 'deno-x86_64-pc-windows-msvc.zip'), '--version', p)
};

/* yt-dlp envejece mal: YouTube, Instagram y X cambian cada pocas semanas y una
   copia de dos meses (la de Dosa era del 2026-07-04 en septiembre) deja de
   sacar formatos o de entrar. Antes se lanzaba `yt-dlp -U` cada tres días y
   se apuntaba como revisado aunque fallara (sin red, carpeta sin permiso…),
   así que un fallo dejaba yt-dlp viejo otros tres días, y nada comprobaba que
   el binario siguiera arrancando. Ahora (rat.tocaRevisar):
   · se mira la versión instalada; si no arranca o es anterior a
     rat.VERSION_MINIMA_YTDLP, se actualiza ya;
   · si no, una vez al día se pregunta a GitHub cuál es la última (una
     redirección, sin descargar nada) y solo se baja si hay una nueva;
   · la nueva se comprueba con la huella de su SHA2-256SUMS y arrancándola
     antes de sustituir a la vieja, con reintentos;
   · solo se apunta como revisado si salió bien; si no, se reintenta la
     próxima vez que se abra el Rat Tool;
   · si una descarga falla con un error típico de yt-dlp desfasado
     (rat.pideActualizar), se fuerza la revisión en ese momento.
   La descarga ESPERA a la actualización: sustituir yt-dlp.exe mientras se
   lanza otra cosa arranca un binario a medias ("Error -3 while decompressing
   data", visto en la prueba). Con descargas en marcha no se actualiza. */
const YTDLP_REVISION_MS = 24 * 60 * 60 * 1000;
let ytDlpUpdate = null;
let ytDlpVersion = null; // la instalada; se pregunta al binario una vez por sesión
let ytDlpForzadaEn = 0;  // última revisión forzada por un error (tope: una por hora)
function actualizaYtDlp({ forzar = false } = {}) {
  if (ytDlpUpdate) return ytDlpUpdate;
  if (!fs.existsSync(ytDlpPath()) || ytJobs.size) return Promise.resolve();
  ytDlpUpdate = (async () => {
    const version = ytDlpVersion || (ytDlpVersion = await versionDe(ytDlpPath()));
    if (!rat.tocaRevisar({ version, revisadoEn: settings.ytDlpRevisado, ahora: Date.now(), cadaMs: YTDLP_REVISION_MS, forzar, forzadaEn: ytDlpForzadaEn })) return;
    if (forzar) ytDlpForzadaEn = Date.now();
    let meta = null;
    try {
      const publicada = await conReintentos(versionPublicadaYtDlp);
      if (!rat.esVersionYtDlp(version) || rat.comparaVersiones(version, publicada) < 0) {
        meta = { id: 'naviris-bins', name: 'Actualizando el motor de descargas', percent: 0, state: 'progressing', kind: 'video' };
        broadcast('download:new', meta);
        await conReintentos(() => instalaYtDlp(publicada, (p) => avisaPorcentaje(meta, p * 95)));
        ytDlpVersion = publicada;
        meta.percent = 100; meta.state = 'completed'; broadcast('download:update', meta);
      }
      settings.ytDlpRevisado = Date.now(); saveSettings(settings);
    } catch (e) {
      console.log('[Naviris] No se pudo actualizar yt-dlp:', e.message);
      if (meta) {
        meta.state = 'failed';
        meta.error = 'No se pudo actualizar el motor de descargas. Revisa tu conexión y vuelve a abrir el Rat Tool';
        broadcast('download:update', meta);
      }
    }
  })().finally(() => { ytDlpUpdate = null; });
  return ytDlpUpdate;
}

/* Cookies de la sesión para yt-dlp, en formato Netscape. Instagram no suelta
   nada sin sesión, Reddit ya no da ni los videos públicos sin ella y X esconde
   los "sensibles" o de cuentas privadas: por línea de comandos "no se puede
   descargar" cuando en el navegador se está viendo. Se pasan SOLO las del
   dominio del enlace (rat.dominiosCookies) en un archivo temporal que se borra
   al terminar. */
async function cookiesParaYtDlp(url) {
  const cookies = [];
  try {
    const ses = session.fromPartition(PART_NORMAL);
    for (const d of rat.dominiosCookies(url)) cookies.push(...await ses.cookies.get({ domain: d }).catch(() => []));
  } catch { return null; }
  if (!cookies.length) return null;
  try {
    const f = path.join(app.getPath('temp'), 'naviris-cookies-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.txt');
    fs.writeFileSync(f, rat.ficheroCookies(cookies), 'utf8');
    return f;
  } catch { return null; }
}
const borraCookies = (f) => { if (f) { try { fs.rmSync(f, { force: true }); } catch { /* nada */ } } };

/* Binarios del Rat Tool: yt-dlp (el descargador), ffmpeg (une vídeo y audio y
   saca el mp3) y Deno. Deno hace falta desde que YouTube resuelve los enlaces de
   los formatos con retos en JavaScript: yt-dlp 2026.08 ya no los descifra solo y
   pide un motor de JS externo (https://github.com/yt-dlp/yt-dlp/wiki/EJS). Se usa
   Deno porque es el único que yt-dlp activa por defecto, es un solo .exe sin
   instalador, y los scripts que resuelven los retos ya vienen dentro de
   yt-dlp.exe (no hace falta --remote-components). Probado: con
   --js-runtimes deno:<ruta> desaparece el aviso y salen todos los formatos hasta
   1080p y más. Las instalaciones que ya tenían yt-dlp y ffmpeg bajan solo Deno
   (~42 MB en zip): la lista `missing` decide qué se descarga. Las direcciones y
   huellas están en rat.BINARIOS. */
let binsPromise = null;
function ensureBins() {
  const missing = ['yt-dlp.exe', 'ffmpeg.exe', 'deno.exe'].filter((b) => !fs.existsSync(path.join(binDir(), b)));
  if (!missing.length) return actualizaYtDlp().then(() => true);
  if (binsPromise) return binsPromise;
  binsPromise = (async () => {
    fs.mkdirSync(binDir(), { recursive: true });
    // Aparece como una descarga normal en el panel, con su progreso
    // Si solo falta Deno (instalaciones de antes de este cambio) el nombre lo
    // dice, para que no parezca que se vuelve a bajar todo el motor.
    const soloDeno = missing.length === 1 && missing[0] === 'deno.exe';
    const meta = {
      id: 'naviris-bins',
      name: soloDeno ? 'Motor de descargas de Naviris: componente para YouTube' : 'Motor de descargas de Naviris (solo la primera vez)',
      percent: 0, state: 'progressing', kind: 'video'
    };
    broadcast('download:new', meta);
    // El progreso se reparte entre lo que falta según su tamaño aproximado
    // (yt-dlp ~24 MB, ffmpeg ~115 MB en zip, Deno ~43 MB en zip), dejando un 5 %
    // para descomprimir: cada tramo empieza donde acabó el anterior.
    const PESO = { 'yt-dlp.exe': 24, 'ffmpeg.exe': 115, 'deno.exe': 43 };
    const pesoTotal = missing.reduce((a, b) => a + PESO[b], 0);
    let base = 0;
    try {
      for (const bin of missing) {
        const ini = base, ancho = 95 * PESO[bin] / pesoTotal;
        base += ancho;
        await conReintentos(() => INSTALADORES[bin]((p) => avisaPorcentaje(meta, ini + p * ancho)));
      }
      meta.percent = 100; meta.state = 'completed'; broadcast('download:update', meta);
      // yt-dlp recién bajado es el último; si ya estaba, se revisa ahora
      if (missing.includes('yt-dlp.exe')) { settings.ytDlpRevisado = Date.now(); saveSettings(settings); } else await actualizaYtDlp();
      return true;
    } catch (e) {
      console.log('[Naviris] No se pudo preparar el motor de descargas:', e.message);
      meta.state = 'failed';
      meta.error = 'No se pudo preparar el motor de descargas (' + e.message + '). Revisa tu conexión y vuelve a abrir el Rat Tool';
      broadcast('download:update', meta);
      return false;
    } finally {
      binsPromise = null; // permite reintentar
    }
  })();
  return binsPromise;
}

// ---------- Ajustes persistentes ----------
const settingsPath = () => path.join(app.getPath('userData'), ARCHIVOS + 'settings.json');

const DEFAULT_SETTINGS = {
  hardwareAcceleration: true,
  powerSaver: true,
  adblockEnabled: true,
  adblockWhitelist: [],
  agentMode: false,
  updatesAuto: true,        // las actualizaciones se bajan solas; apagado = avisa y el usuario decide
  smartSearch: true,        // autocompletado inteligente de la barra
  buscador: 'google',       // motor de la barra: google | duckduckgo | bing | brave (src/buscadores.js)
  preguntarDescargas: false, // true = cada descarga pregunta dónde guardarse
  xRevealSensitive: false,  // mostrar contenido sensible en X/Twitter
  moovinPase: '',             // pase de la biblioteca privada de iris.it.com/moovin
  atajos: true,             // atajos de teclado (Ctrl+T, Ctrl+W…); F11 y F12 no se tocan
  mouseNav: true,           // botones laterales del ratón para atrás/adelante
  blockPasskeys: true,      // las webs no ven passkey de plataforma (preload); si una insiste, Windows Hello real
  restoreSession: true,     // reabre las pestañas de la sesión anterior al iniciar
  lightMode: false,         // tema claro de la interfaz
  sonidos: true,            // sonidos de Naviris: arranque, descarga terminada o fallida y recordatorios (src/sonidos.js)
  devUpdates: null,         // canal de actualizaciones: null = según la versión instalada; true/false = elección del usuario
  permissions: {},          // decisiones de permisos por sitio: "origin|tipo" -> allow|block
  addons: {}                // addons instalados: id -> { name, version, kind, matches, enabled, ... }
};

// Claves de acceso (blockPasskeys). Hasta 2.8.1-dev.10 esto registraba un
// autenticador VIRTUAL por el depurador interno (método de Playwright) para
// que WebAuthn no invocara Windows Hello. Ese autenticador falso es justo lo
// que rompía Outlook: cuando la cuenta tiene una passkey, Microsoft llama a
// navigator.credentials.get() diga lo que diga isUVPAA, el autenticador
// falso responde sin la credencial y la página se queda en "No pudimos
// iniciar su sesión… clave de acceso". Con el modo agente (que no registra
// el falso) Outlook ENTRABA: el gesto real de Windows Hello sí funciona
// (Dosa, 2026-09-19). Así que ya no se registra nada: el ajuste se cumple
// desde el preload, que dice a las webs que no hay autenticador de
// plataforma ni relleno automático de passkeys (no las ofrecen por defecto),
// y si una web insiste, sale el Windows Hello de verdad, que funciona.
function suppressWebAuthn() { /* ver arriba: el bloqueo vive en webview-preload */ }

// X/Twitter: el muro de verificación de edad ("contenido no apto para menores") lo
// desactiva ahora el PRELOAD de la webview (webview-preload.js), que fija el
// interruptor rweb_age_assurance_flow_enabled en el __INITIAL_STATE__ con
// contextBridge.executeInMainWorld. Antes se hacía desde aquí con el depurador
// interno de Electron, pero eso obligaba a saltárselo con el Modo agente encendido
// (el depurador es del agente externo) y el muro reaparecía: v2.7.3-dev.9. El
// preload no depende del depurador, así que funciona también en Modo agente. Aquí
// solo queda el canal síncrono que le dice al preload si el ajuste está activo (ver
// 'x:age-gate-on') y el viejo X_REVEAL de dom-ready para las imágenes borrosas
// clásicas (sensitiveMediaWarning), que es otro muro distinto.

// ---------- Scripts inyectados en las páginas ----------
// El bloqueo de anuncios de YouTube (pruning de la respuesta del player) lo hace el
// preload en document_start (webview-preload.js), que es lo robusto y a tiempo. Aquí,
// en dom-ready, solo queda un RESPALDO DE UI ligero: cerrar el aviso anti-adblock y
// pulsar 'saltar' si algún anuncio se colara. Sin hooks (los hacía el preload) ni seek.
// El aviso anti-bloqueador (ytd-enforcement-message-view-model) llega de DOS formas
// y solo una se cierra:
// - En un DIÁLOGO (tp-yt-paper-dialog) encima del video, que lo pausa. Es un aviso
//   previo: quitar el diálogo y darle al play deja todo como estaba. Esa sí.
// - DENTRO del reproductor, a las cuentas que YouTube ya marcó por usar bloqueador:
//   el player responde ERROR + errorScreen y el aviso se pinta en #error-screen
//   (yt-playability-error-supported-renderers), en el hueco del video. Debajo no
//   hay video que recuperar. Antes se borraba igual (enf.remove(), 6 ms después de
//   aparecer) y quedaba una caja NEGRA sin controles, sin mensaje y sin sonido
//   (Dosa, 2026-10-07). Además YouTube comprueba si ese componente falta o está
//   oculto, así que borrarlo empeoraba la marca de la cuenta. Esta variante NO se
//   toca: la trata el preload (un reintento y, si vuelve, se deja a la vista y la
//   interfaz ofrece la lista blanca).
// Sin marca global para no repetirse (antes había una en window, legible por
// YouTube): dom-ready llega una sola vez por documento. El observador va con
// freno: sin él corrían cinco querySelector en cada mutación de YouTube, que
// son miles por minuto con el vídeo puesto.
const YT_ADSKIP = `(function(){
  var pendiente=0;
  function tidy(){
    try{
      ['.ytp-ad-skip-button','.ytp-ad-skip-button-modern','.ytp-skip-ad-button','.ytp-ad-overlay-close-button'].forEach(function(s){ var b=document.querySelector(s); if(b) b.click(); });
      var enf=document.querySelector('tp-yt-paper-dialog ytd-enforcement-message-view-model');
      if(enf){ enf.closest('tp-yt-paper-dialog').remove(); document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function(b){ b.remove(); }); document.documentElement.style.overflow=''; var v=document.querySelector('video'); if(v&&v.paused){ try{v.play();}catch(e){} } }
    }catch(e){}
  }
  setInterval(tidy,700);
  try{ new MutationObserver(function(){ if(pendiente)return; pendiente=setTimeout(function(){ pendiente=0; tidy(); },250); }).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
})();`;
// OJO con lo que se oculta: aquí estaban .ytp-ad-module y .video-ads, que son el
// módulo de anuncios DENTRO del reproductor. Ocultarlos no impide que el anuncio se
// reproduzca: solo lo hace invisible. Cuando el pruning fallaba, el resultado era un
// vídeo en negro 20-30 s que el usuario no entendía y, peor, el botón de saltar vive
// ahí dentro, así que tampoco podía saltarlo a mano. Se quedan fuera a propósito: si
// un anuncio se cuela, es preferible verlo y poder saltarlo. Lo que sigue oculto son
// los anuncios de la interfaz (feed, sidebar, banners), que no bloquean nada.
// Tampoco va aquí NUNCA el aviso anti-bloqueador ni nada que lo contenga (#player,
// #error-screen…): YouTube mira si ese componente está en display:none, igual que
// si falta (ver YT_ADSKIP). Repasado el 2026-10-07: ninguna de estas reglas lo toca.
const YT_ADCSS = '#masthead-ad,ytd-ad-slot-renderer,ytd-promoted-video-renderer,ytd-display-ad-renderer,ytd-companion-slot-renderer,#player-ads,ytd-in-feed-ad-layout-renderer,ytd-ads-engagement-panel-content-renderer,#related ytd-ad-slot-renderer{display:none!important}';
// Revela contenido sensible en X/Twitter
const X_REVEAL = `(function(){
  if(window.__navX)return; window.__navX=1;
  function reveal(){
    try{
      document.querySelectorAll('[data-testid="sensitiveMediaWarning"]').forEach(function(w){ var b=w.querySelector('[role="button"]'); if(b) b.click(); });
      document.querySelectorAll('div[style*="blur"]').forEach(function(d){ d.style.filter='none'; d.style.backdropFilter='none'; });
    }catch(e){}
  }
  setInterval(reveal,700);
  try{ new MutationObserver(reveal).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
})();`;
// Twitch: oculta anuncios de banner/display. NO silencia el vídeo (el silencio es
// decisión del usuario). Los anuncios incrustados en el stream no se pueden quitar
// sin un proxy del m3u8, así que esto no rompe la reproducción.
const TWITCH_ADHIDE = `(function(){
  if(window.__navTwAd)return; window.__navTwAd=1;
  var s=document.createElement('style');
  s.textContent='[data-test-selector="sad-overlay"],.video-player__ad-info-container,[data-a-target="advertising-billboard"],div[aria-label="Advertisement"]{display:none!important}';
  document.documentElement.appendChild(s);
})();`;

function loadSettings() {
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
    // El pase de la biblioteca se guardaba con el nombre anterior del sitio.
    // Se pasa al nuevo para no obligar a escribirlo otra vez.
    if (s.cinePase && !s.moovinPase) s.moovinPase = s.cinePase;
    delete s.cinePase;
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/* Escritura a prueba de cortes: se escribe al lado y se renombra encima. Con
   writeFileSync directo, un cierre forzado o un apagón a mitad dejaba el JSON
   cortado; al arrancar no se podía leer y se volvía a los valores de fábrica:
   se perdían los ajustes (con la sal de los espacios protegidos) o, en el
   siguiente guardado, la lista entera de contraseñas. */
function escribeSeguro(ruta, texto) {
  const tmp = ruta + '.tmp';
  try {
    fs.writeFileSync(tmp, texto, 'utf8');
    fs.renameSync(tmp, ruta);
  } catch {
    // El renombrado falla si otro programa tiene el archivo abierto (un antivirus): se escribe como antes.
    try { fs.rmSync(tmp, { force: true }); } catch { /* nada */ }
    fs.writeFileSync(ruta, texto, 'utf8');
  }
}

function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    escribeSeguro(settingsPath(), JSON.stringify(s, null, 2));
  } catch (e) {
    console.error('No se pudieron guardar los ajustes:', e);
  }
}

// Perfil alternativo por CLI (dev/pruebas): --user-data-dir=<carpeta> corre una
// segunda instancia totalmente aislada sin tocar el perfil real del usuario.
// Electron NO honra ese switch de Chromium por sí solo; hay que redirigir userData.
// Solo cuenta si va antes de --single-argument: lo de detrás es un enlace, no una opción.
const perfilCli = abrirDesdeFuera.opcionesPropias(process.argv, process.defaultApp).find((a) => a.startsWith('--user-data-dir='));
if (perfilCli) app.setPath('userData', perfilCli.slice('--user-data-dir='.length));

/* UNA SOLA INSTANCIA POR PERFIL (2026-11-04). Abrir Naviris otra vez, o un
   enlace o un archivo desde fuera, lleva a la ventana que ya está abierta y
   abre ahí una pestaña, en vez de arrancar otro Naviris sobre el mismo perfil.
   La cerradura es de la carpeta de userData (medido): las instancias con
   --user-data-dir propio (las pruebas, los agentes) siguen arrancando a la vez.
   Lo que hay que abrir viaja ya interpretado por la instancia que lo recibió,
   que es la que conoce su carpeta de trabajo: el argv que Electron entrega en
   'second-instance' llega reordenado y con opciones que añade Chromium.
   Esta instancia sobra: no se ejecuta nada más de este archivo. */
const DESTINOS_AL_ARRANCAR = abrirDesdeFuera.destinosDeArgumentos(process.argv, { defaultApp: process.defaultApp });
if (!app.requestSingleInstanceLock({ destinos: DESTINOS_AL_ARRANCAR })) {
  app.quit();
  return;
}

/* Los nombres del perfil: naviris-*.json y la sesión persist:naviris. Los de
   antes (con el nombre viejo del navegador) se copian aquí, antes de leer los
   ajustes y de que Chromium abra la sesión. Si algo no se pudo copiar, este
   arranque sigue con lo viejo y se reintenta en el siguiente (migraNombre). */
const nombres = migraNombre(app.getPath('userData'), (m) => console.log('[Naviris] Cambio de nombre:', m));
const ARCHIVOS = nombres.archivos;
const PART_NORMAL = nombres.particion;
const PART_PRIVATE = 'naviris-private'; // sin "persist:" → solo en memoria

let settings = loadSettings();

// Arreglos de una sola vez sobre el perfil (ver migraciones.js). Aquí, antes de
// que Chromium abra sus bases de datos; si fallan, se reintentan al volver a abrir.
try {
  const borradas = migraPerfil(settings, app.getPath('userData'));
  if (borradas) {
    saveSettings(settings);
    if (borradas.length) console.log(`[Naviris] ${borradas.length} cookies de iframes mal convertidas borradas:`, borradas.map((c) => c.nombre + ' ' + c.host).join(', '));
  }
} catch (e) { console.log('[Naviris] Migración del perfil pendiente:', e.message); }

// Tras una ACTUALIZACIÓN (cambia la versión), forzamos el Modo agente a OFF. Motivo:
// cuando la app se reinicia sola durante el update, el puerto CDP a veces no llega a
// enlazarse (solapamiento con el proceso viejo que aún se cierra). Al obligar a
// reactivarlo a mano se hace un reinicio LIMPIO, que sí abre el puerto de forma fiable.
if (settings.appVersion !== app.getVersion()) {
  if (settings.agentMode) settings.agentMode = false;
  settings.appVersion = app.getVersion();
  saveSettings(settings);
}

if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();

// ---------- Modo agente: Chrome DevTools Protocol en localhost ----------
// NAVIRIS_CDP_PORT solo sirve para las builds de prueba: con el Naviris del
// usuario en modo agente ocupando el 9223, otra instancia no podía escuchar.
if (settings.agentMode) app.commandLine.appendSwitch('remote-debugging-port', process.env.NAVIRIS_CDP_PORT || '9223');

// ---------- Rendimiento y seguridad ----------
// (Se quitó renderer-process-limit: limitaba procesos y debilitaba el aislamiento
//  de sitios. El ahorro de memoria lo cubre el sueño de pestañas.)
// HttpsUpgrades: sube automáticamente las navegaciones http:// a https:// con
//  reintento si el sitio no soporta https. Aislamiento estricto de sitios activo por defecto.
// MemoryPurgeOnFreeze: purga la memoria de renderers congelados (menos RAM retenida)
// FluentScrollbar+FluentOverlayScrollbar: scrollbars finos estilo Windows 11 que se
//  ocultan solos y se adaptan al tema de la página, en la UI y en todas las webs
//  (los sitios con scrollbar propio por CSS conservan el suyo).
app.commandLine.appendSwitch('enable-features', 'BackForwardCache,ReduceUserAgent,HttpsUpgrades,MemoryPurgeOnFreeze,FluentScrollbar,FluentOverlayScrollbar');
// FedCm: Chromium en Electron expone la API FedCM pero sin la interfaz del diálogo,
//  así que navigator.credentials.get({identity}) ("Iniciar sesión con Google" en
//  webs de terceros) fallaba siempre con "Error retrieving a token". Apagada, los
//  proveedores caen al flujo de ventana emergente/redirección, que sí funciona.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,FedCm');
// AutoLoot: evita que Chromium suspenda el vídeo/temporizadores de pestañas en segundo
// plano, para que el tiempo de drops siga contando aunque la pestaña no esté visible.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------- Bloqueador de anuncios ----------
const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.com', 'google-analytics.com', 'googletagservices.com',
  '2mdn.net', 'adnxs.com', 'adsafeprotected.com', 'amazon-adsystem.com',
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'pubmatic.com',
  'rubiconproject.com', 'openx.net', 'scorecardresearch.com', 'quantserve.com',
  'zedo.com', 'popads.net', 'propellerads.com', 'adroll.com', 'moatads.com',
  'adform.net', 'smartadserver.com', 'teads.tv', 'exoclick.com',
  'juicyads.com', 'trafficjunky.net', 'doubleverify.com', 'adcolony.com',
  'unityads.unity3d.com', 'applovin.com', 'mopub.com', 'inmobi.com',
  'yieldmo.com', 'sharethrough.com', 'undertone.com', 'mgid.com',
  'revcontent.com', 'bidswitch.net', 'casalemedia.com', 'contextweb.com',
  'lijit.com', 'sonobi.com', 'gumgum.com', 'onetag.com', 'adsrvr.org',
  'hotjar.com', 'mouseflow.com', 'crazyegg.com'
];

let blockedCount = 0;
const hostMatches = (host, domain) => host === domain || host.endsWith('.' + domain);

function isWhitelisted(referrer) {
  if (!referrer) return false;
  try {
    const host = new URL(referrer).hostname;
    return settings.adblockWhitelist.some((d) => hostMatches(host, d));
  } catch { return false; }
}

// La página de la pestaña que hace la petición; el referrer solo si no hay pestaña (service workers).
function paginaDe(details) {
  try { if (details.webContents && !details.webContents.isDestroyed()) return details.webContents.getURL() || details.referrer || ''; } catch { /* nada */ }
  return details.referrer || '';
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

// ---------- Descargas ----------
let downloadSeq = 0;
const downloads = new Map(); // id → { item, meta, ses }

/* «Guardar el destino como…» y «Guardar la imagen como…» (2026-11-03) guardaban
   directo en Descargas, sin preguntar, a pesar de los puntos suspensivos. Se
   apunta la dirección y, cuando llega su will-download, se abre el diálogo de
   Guardar en vez de fijar la ruta. El ajuste «Preguntar dónde guardar» hace lo
   mismo con todas. */
const preguntaDonde = new Map();   // url -> ts de la petición
function descargaPreguntando(contents, url) {
  for (const [u, ts] of preguntaDonde) if (Date.now() - ts > 60000) preguntaDonde.delete(u);   // las que nunca llegaron
  preguntaDonde.set(url, Date.now());
  contents.downloadURL(url);
}
function debePreguntar(item) {
  if (settings.preguntarDescargas) return true;
  let cadena = [];
  try { cadena = item.getURLChain(); } catch { /* nada */ }
  const url = [item.getURL(), ...cadena].find((u) => preguntaDonde.has(u));
  if (!url) return false;
  const ts = preguntaDonde.get(url);
  preguntaDonde.delete(url);
  return Date.now() - ts < 60000;
}

function registerDownloadItem(item, sourceUrl, enHistorial = true, ses = null) {
  const dir = app.getPath('downloads');
  let name = item.getFilename() || 'descarga';
  let candidate = path.join(dir, name);
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  // Tampoco vale el nombre de otra descarga que siga en marcha: su archivo aún
  // no existe y las dos acababan escribiendo en el mismo (se perdía la primera).
  const ocupado = (p) => fs.existsSync(p) || [...downloads.values()].some((d) => d.item && (d.meta.state === 'progressing' || d.meta.state === 'interrupted') && d.meta.path.toLowerCase() === p.toLowerCase());
  for (let i = 1; ocupado(candidate); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  if (debePreguntar(item)) item.setSaveDialogOptions({ defaultPath: candidate });
  else item.setSavePath(candidate);

  const id = 'dl' + (++downloadSeq);
  const meta = {
    id,
    name: path.basename(candidate),
    path: candidate,
    total: item.getTotalBytes(),
    received: 0,
    state: 'progressing',
    paused: false,
    kind: 'file',
    source: sourceUrl || item.getURL()
  };
  downloads.set(id, { item, meta, ses });
  broadcast('download:new', meta);
  // Con el diálogo de Guardar, la ruta buena llega después de elegirla.
  const rutaElegida = () => {
    const p = item.getSavePath();
    if (p && p !== meta.path) { meta.path = p; meta.name = path.basename(p); }
  };

  item.on('updated', (_e, state) => {
    rutaElegida();
    meta.paused = item.isPaused();
    meta.received = item.getReceivedBytes();
    meta.total = item.getTotalBytes();
    meta.state = state === 'interrupted' ? 'interrupted' : 'progressing';
    broadcast('download:update', meta);
  });
  item.once('done', (_e, state) => {
    meta.state = state; // completed | cancelled | interrupted
    meta.paused = false;
    rutaElegida();
    meta.received = item.getReceivedBytes();
    if (state === 'completed' && enHistorial) recordDlHistory(meta.path);
    broadcast('download:update', meta);
  });
  return meta;
}

/* Historial persistente de lo descargado DESDE Naviris: la página de descargas
   lista esto, no la carpeta entera del sistema (ahí hay archivos de cualquier
   origen y no son asunto del navegador). */
const dlHistoryPath = () => path.join(app.getPath('userData'), 'naviris-downloads.json');
let dlHistory = null;
function loadDlHistory() {
  if (!dlHistory) { try { dlHistory = JSON.parse(fs.readFileSync(dlHistoryPath(), 'utf8')); } catch { dlHistory = []; } }
  return dlHistory;
}
function recordDlHistory(p) {
  if (!p) return;
  dlHistory = [{ path: p, time: Date.now() }, ...loadDlHistory().filter((x) => x.path !== p)].slice(0, 2000);
  try { escribeSeguro(dlHistoryPath(), JSON.stringify(dlHistory)); } catch {}
}

// Rutas de anuncios de YouTube que se cortan mientras el motor no está listo
// (con motor decide él, ver onBeforeRequest). Solo anuncios/telemetría puros:
// NO van rutas del reproductor (/youtubei/v1/player, /get_midroll_info,
// videoplayback…), que hacían que el vídeo no cargara o disparaban el anti-adblock.
const YT_AD_PATHS = ['/pagead/', '/api/stats/ads', '/ptracking'];

/* ===== Identidad del navegador, en un solo sitio =====
   El UA string y los client hints tienen que contar la MISMA historia; si no,
   Cloudflare (y cualquier antifraude) lo lee como cliente falseado. Se calcula
   una vez y de aquí beben las cabeceras (main) y navigator.userAgentData (que
   fija el preload en cada web). */
const UA_BRUTO = app.userAgentFallback.replace(/\s(?:Naviris|Electron)\/\S+/g, '');
const VERSION_COMPLETA = (UA_BRUTO.match(/Chrome\/([\d.]+)/) || [, '0.0.0.0'])[1];
const VERSION_MAYOR = VERSION_COMPLETA.split('.')[0];
// Chrome recorta la versión del UA a MAJOR.0.0.0 desde la "UA reduction"; dejar
// la versión completa aquí es en sí mismo una señal de cliente no estándar.
const UA_LIMPIO = UA_BRUTO.replace(/Chrome\/[\d.]+/, 'Chrome/' + VERSION_MAYOR + '.0.0.0');
/* El mismo UA para TODOS los marcos, no solo para el principal (2026-10-05).
   ses.setUserAgent (en setupSession) solo llega al marco principal de cada
   pestaña. Los iframes de OTRO sitio, que Chromium pone en su propio proceso,
   y los workers que lanzan, seguían con el UA por defecto de Electron
   ("Naviris/x Chrome/148.0.7778.271 Electron/42.5.2"). Medido en el reto de
   Cloudflare: la página decía Chrome/148.0.0.0 y su iframe de
   challenges.cloudflare.com decía Electron, o sea dos navegadores distintos
   en la misma verificación. Con el UA por defecto igualado aquí, antes de que
   exista ninguna ventana, cada marco y cada worker cuentan lo mismo.
   Resultado, con perfil nuevo y rondas intercaladas: antes el reto de página
   completa se quedaba en "Un momento…" pidiendo la casilla (zona-leros.com y
   scrapingcourse.com, 4 de 4); con esta línea pasa solo en 1,5-1,8 s (3 de 3). */
app.userAgentFallback = UA_LIMPIO;
const MARCA_RELLENO = 'Not/A)Brand';   // el mismo que ya usa Chromium aquí
const UA_CH = {
  versionCompleta: VERSION_COMPLETA,
  versionMayor: VERSION_MAYOR,
  marcas: `"${MARCA_RELLENO}";v="99", "Chromium";v="${VERSION_MAYOR}", "Google Chrome";v="${VERSION_MAYOR}"`,
  marcasCompletas: `"${MARCA_RELLENO}";v="99.0.0.0", "Chromium";v="${VERSION_COMPLETA}", "Google Chrome";v="${VERSION_COMPLETA}"`,
  // Lo que consume el preload para rehacer navigator.userAgentData.
  lista: [
    { brand: MARCA_RELLENO, version: '99' },
    { brand: 'Chromium', version: VERSION_MAYOR },
    { brand: 'Google Chrome', version: VERSION_MAYOR }
  ],
  listaCompleta: [
    { brand: MARCA_RELLENO, version: '99.0.0.0' },
    { brand: 'Chromium', version: VERSION_COMPLETA },
    { brand: 'Google Chrome', version: VERSION_COMPLETA }
  ],
  // El valor de la cabecera lleva la plataforma entrecomillada.
  plataforma: process.platform === 'win32' ? '"Windows"'
    : process.platform === 'darwin' ? '"macOS"' : '"Linux"'
};

/* Accept-Language con la MISMA forma que la de Chrome: el idioma completo y
   detrás el idioma a secas con q=0.9 ("es-ES,es;q=0.9").
   Si no se le pasa nada, Electron manda el locale pelado ("es"), y eso además
   arrastraba a navigator.language mientras navigator.languages sí decía
   "es-ES,es": dos APIs del mismo navegador contando cosas distintas.
   Medido contra Chrome 151 en la misma máquina el 2026-08-24. */
let IDIOMAS = null;
function idiomasAceptados() {
  if (IDIOMAS) return IDIOMAS;
  // app.getLocale() devuelve el idioma PELADO ("es") en este Windows, y Chrome
  // manda siempre la variante regional. La lista buena es la del sistema:
  // getPreferredSystemLanguages() devuelve ["es-ES"].
  let lista = [];
  try { lista = (app.getPreferredSystemLanguages() || []).slice(); } catch { /* nada */ }
  if (!lista.length) lista = [app.getLocale() || 'en-US'];
  const salida = [];
  for (const idioma of lista) {
    if (!salida.includes(idioma)) salida.push(idioma);
    const base = idioma.split('-')[0];
    if (base && !salida.includes(base)) salida.push(base);
  }
  // El primero va sin q y los demás bajan de una décima en una décima, como Chrome.
  IDIOMAS = salida.map((l, i) => (i === 0 ? l : `${l};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}`)).join(',');
  return IDIOMAS;
}
// La lista pelada, para que el preload deje navigator.language y .languages
// diciendo lo mismo que la cabecera.
function idiomasLista() {
  return idiomasAceptados().split(',').map((t) => t.split(';')[0]);
}

/* Lo que el preload de cada web necesita de main al arrancar, en UNA sola
   llamada síncrona (NAV-IB-18). Antes eran trece (client hints, idiomas, diez
   permisos y passkeys), y cada sendSync frena la carga de la página mientras
   main responde.
   - hints: para rehacer navigator.userAgentData (ver UA_CH).
   - idiomas: la lista pelada (idiomasLista).
   - passkeys: con el ajuste puesto, la página no ve autenticador de plataforma.
   - permisos: el estado REAL de cada permiso para el sitio que pregunta:
     'allow', 'block' o 'prompt' si aún no se ha decidido. Hace falta porque
     setPermissionCheckHandler de Electron solo sabe decir sí o no, y al
     responder "no" a algo que en realidad está SIN decidir, la página leía
     Notification.permission === 'denied'. Eso no es solo una huella rara:
     muchas webs ni siquiera piden el permiso si lo ven denegado, así que el
     diálogo de Naviris no llegaba a salir nunca y la persona no podía conceder
     notificaciones aunque quisiera. El preload usa esto para contar la verdad.
   - scriptlets: los `##+js(...)` de las listas para ESTE documento, ya listos
     para ejecutarse en el mundo principal (braveAdblock.arranqueDe). Van
     aquí y no en dom-ready porque json-prune, set o trusted-replace-xhr-response
     tienen que estar puestos ANTES de que corra el primer script de la página,
     como los pone uBlock (document_start): en dom-ready YouTube ya había leído
     su respuesta del reproductor con los anuncios dentro. Respeta el
     interruptor del adblock y la lista blanca, igual que el resto del bloqueo.
     La URL es la del marco que pregunta según main, no la que diga la página.
   - bloqueo: si el bloqueador actúa en este documento (interruptor y lista
     blanca). Lo usa el bloque de YouTube del preload; antes lo preguntaba con
     otra llamada síncrona ('yt-adblock-on') en cada documento de YouTube.
   - genericos: si el preload tiene que juntar clases e ids para el ocultado
     genérico ('adblock:genericos', más abajo). */
ipcMain.on('preload:arranque', (e, permisos) => {
  let origen = '';
  let url = '';
  try { url = e.senderFrame.url || ''; origen = originOf(url); } catch { /* nada */ }
  const estados = {};
  for (const permiso of Array.isArray(permisos) ? permisos : []) {
    if (typeof permiso !== 'string') continue;
    const guardado = origen ? settings.permissions[origen + '|' + permiso] : undefined;
    estados[permiso] = guardado === 'allow' ? 'allow' : guardado === 'block' ? 'block' : 'prompt';
  }
  const bloqueo = !!settings.adblockEnabled && /^https?:/i.test(url) && !isWhitelisted(url);
  const { scriptlets, genericos } = bloqueo ? braveAdblock.arranqueDe(url) : { scriptlets: '', genericos: false };
  e.returnValue = { hints: UA_CH, idiomas: idiomasLista(), passkeys: !!settings.blockPasskeys, permisos: estados, bloqueo, scriptlets, genericos };
});

/* Ocultado genérico por clase e id (ver genericosPara en adblock.js). El
   preload manda las clases e ids NUEVOS que ve en la página, en tandas, y
   recibe los selectores que las listas mandan ocultar. La URL y el permiso
   salen de main (el marco que pregunta), no de lo que diga la página, y se
   acota lo que puede llegar: es una petición de una web. */
ipcMain.handle('adblock:genericos', (e, clases, ids) => {
  let url = '';
  try { url = e.senderFrame.url || ''; } catch { /* nada */ }
  if (!settings.adblockEnabled || !/^https?:/i.test(url) || isWhitelisted(url)) return [];
  const limpia = (a) => (Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && x.length && x.length < 200).slice(0, 5000);
  return braveAdblock.genericosPara(url, limpia(clases), limpia(ids));
});

/* Dominios de verificación anti-robot. NO se bloquean nunca: bloquearlos no
   quita publicidad, solo hace que el sitio pida el captcha una y otra vez.
   Ver el comentario largo dentro de onBeforeRequest. */
const ES_VERIFICACION = /^https?:\/\/([^/]*\.)?(awswaf\.com|challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\.net)(\/|$|:)/i;

/* Antes de salir, cada sesión vuelca y conserva sus cookies (ver setupSession).
   Un solo before-quit las espera TODAS: con uno por sesión, la primera en
   acabar (la privada, casi vacía) llamaba a app.quit() y la app se cerraba sin
   esperar a la normal. Medido: de 167 cookies de sesión volvían 3. El tope
   evita que una cookie atascada deje la app sin cerrar. */
const alSalir = [];
let saliendo = false;
app.on('before-quit', (e) => {
  if (saliendo) return;                            // segunda pasada: dejar salir
  e.preventDefault();                              // el guardado es asíncrono
  saliendo = true;
  const tareas = Promise.all(alSalir.map((f) => f().catch(() => {})));
  Promise.race([tareas, new Promise((r) => setTimeout(r, 8000))]).finally(() => app.quit());
});

function setupSession(ses) {
  // UA de Chrome puro para navegar: el UA por defecto lleva los tokens
  // "Naviris/x" y "Electron/x", y los sitios que husmean el navegador no lo
  // reconocen: Spotify, por ejemplo, servía su reproductor degradado de móvil
  // (barra de pestañas abajo, sin sidebar). Quitando esos tokens queda el UA
  // estándar de Chrome y sirven la web de escritorio completa.
  //
  // Pero quitar esos tokens A MEDIAS era PEOR que no tocar nada: el UA decía
  // "Chrome" mientras los client hints (Sec-CH-UA y navigator.userAgentData)
  // seguían diciendo solo "Chromium", sin la marca "Google Chrome" que manda
  // Chrome de verdad. Cloudflare compara ambos canales, veía la contradicción y
  // clasificaba a Naviris como cliente automatizado: el Turnstile de cualquier
  // web se quedaba dando vueltas en "Un momento…" para siempre y NO había forma
  // de pasar una verificación. Comprobado contra un Chrome real en la misma
  // máquina: manda tres marcas (Not·A·Brand, Google Chrome, Chromium) y la
  // versión RECORTADA a MAJOR.0.0.0 en el UA. Aquí se iguala ese formato, en los
  // dos canales, para que la identidad sea coherente. Ver `uaCH` más abajo.
  ses.setUserAgent(UA_LIMPIO, idiomasAceptados());
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    /* OJO, aquí estuvo el fallo que dejó a Naviris sin pasar NINGÚN Turnstile
       hasta el 2026-08-24: este manejador RECORRÍA las cabeceras existentes y
       solo reescribía la que encontrara. Pero Electron no genera ni una sola
       client hint por su cuenta, así que no encontraba nada y la rama no
       entraba jamás. Resultado medido contra un Chrome real: Naviris mandaba
       11 cabeceras al navegar y Chrome 14; faltaban las tres de client hints.
       Un User-Agent que dice "Chrome/148" sin ninguna Sec-CH-UA no es un
       Chrome, y eso se ve desde el servidor sin ejecutar una línea de JS: por
       eso no lo cazó nada de lo que se midió en agosto, que era todo JS, TLS y
       DOM. Ahora se AÑADEN siempre, existan o no. */
    const orig = details.requestHeaders;
    const h = {};
    // Chrome las coloca justo antes de Upgrade-Insecure-Requests (o del UA en
    // las peticiones que no son de navegación). El orden de las cabeceras
    // también se mira, así que se reconstruye el objeto respetando ese hueco.
    let puestas = false;
    const ponHints = () => {
      if (puestas) return;
      puestas = true;
      h['sec-ch-ua'] = UA_CH.marcas;
      h['sec-ch-ua-mobile'] = '?0';
      h['sec-ch-ua-platform'] = UA_CH.plataforma;
    };
    for (const k of Object.keys(orig)) {
      // Puede llegar con cualquier combinación de mayúsculas según el origen.
      if (/^sec-ch-ua(-mobile|-platform)?$/i.test(k)) continue;   // se rehacen abajo
      if (/^(upgrade-insecure-requests|user-agent)$/i.test(k)) ponHints();
      if (/^sec-ch-ua-full-version-list$/i.test(k)) h[k] = UA_CH.marcasCompletas;
      else if (/^sec-ch-ua-full-version$/i.test(k)) h[k] = '"' + UA_CH.versionCompleta + '"';
      // El segundo argumento de setUserAgent NO llega a las peticiones del
      // webview (medido: seguía saliendo "es" pelado), así que la cabecera se
      // fija aquí, que es donde se puede garantizar.
      else if (/^accept-language$/i.test(k)) h[k] = idiomasAceptados();
      else h[k] = orig[k];
    }
    ponHints();   // por si la petición no llevaba ni UIR ni User-Agent
    callback({ requestHeaders: h });
  });
  // Los sustitutos de `$redirect=` (ver onBeforeRequest y adblock.js). Con el
  // origen de vuelta en CORS y credenciales permitidas: tras la redirección el
  // origen pasa a 'null' y hay peticiones que viajan con credenciales; con un
  // '*' a secas el fetch/XHR fallaría y la web vería el hueco. El contenido son
  // recursos fijos (noop.js, un gif de 1x1...), nada que proteger.
  try {
    ses.protocol.handle(braveAdblock.ESQUEMA_SUSTITUTOS, (req) => {
      const s = braveAdblock.sustituto(req.url);
      if (!s) return new Response('', { status: 404 });
      const origen = req.headers.get('origin');
      const cabeceras = { 'content-type': s.mime, 'access-control-allow-origin': origen || '*' };
      if (origen) cabeceras['access-control-allow-credentials'] = 'true';
      return new Response(s.cuerpo, { headers: cabeceras });
    });
  } catch (e) { console.log('[Naviris] Sin esquema de sustitutos en esta sesión:', e.message); }
  ses.webRequest.onBeforeRequest((details, callback) => {
    // La lista blanca (y Spotify, abajo) miran la PÁGINA de la pestaña, no el
    // referrer: con "no-referrer", o desde un iframe de terceros, el referrer
    // no es el sitio y se seguía bloqueando en un sitio que el usuario permitió.
    const pagina = paginaDe(details);
    if (!settings.adblockEnabled || details.resourceType === 'mainFrame' || isWhitelisted(pagina)) {
      return callback({});
    }
    const u = details.url;
    let hostPagina = '';
    try { hostPagina = new URL(pagina).hostname; } catch { /* sin página válida */ }
    // No romper Spotify: su reproductor exige que el hueco publicitario cargue
    // (metadatos y audio del anuncio); si el motor le corta esas peticiones se
    // queda esperando una respuesta que nunca llega y se congela TODO el player
    // al tocar anuncio. Mismo criterio que con YouTube: por red no se le
    // bloquea nada, el anuncio se quita en cliente (el addon Blockify lo salta
    // o lo silencia).
    if (hostMatches(hostPagina, 'spotify.com')) return callback({});
    /* EL INICIO DE SESIÓN DE GOOGLE no se toca por red (2026-10-11). Usuarios
       sin poder entrar en YouTube. Medido con perfil nuevo en la página de
       accounts.google.com: Naviris cortaba accounts.google.com/generate_204
       (la regla genérica `/generate_204?$image` de EasyPrivacy) y Brave, con
       las mismas listas, no. Ahí no hay publicidad que quitar: lo que viaja es
       la propia comprobación del inicio de sesión, igual que en las
       verificaciones de ES_VERIFICACION, y Google ya rechaza a los navegadores
       que no le parecen normales ("este navegador no es seguro"). Cualquier
       diferencia con Brave en esa página es una papeleta más. */
    if (hostPagina === 'accounts.google.com' || hostPagina === 'accounts.youtube.com') return callback({});
    // Lo que necesita el reproductor de YouTube no pasa por el motor: el vídeo de
    // googlevideo, y youtube.com/generate_204, /api/stats/qoe|watchtime|atr y
    // /youtubei/. Bloquearlos rompe la reproducción —sobre todo Shorts— y provoca
    // cargas lentas por reintentos. Los anuncios de YouTube se quitan en la
    // respuesta del reproductor (los scriptlets de las listas), no cortando red.
    // `[/.]` y no `(^|\.)`: se mira la URL entera, y en https://youtube.com/…
    // (sin www) lo que va delante del dominio es una barra.
    if (/\.googlevideo\.com\//i.test(u) || /[/.]youtube(-nocookie)?\.com\/(generate_204|api\/stats\/(qoe|watchtime|atr|playback)|youtubei\/)/i.test(u)) {
      return callback({});
    }
    /* VERIFICACIONES DE "no soy un robot". Nunca se bloquean, aunque las listas
       lo pidan y aunque sus rutas se llamen /telemetry o /report.

       El caso que lo destapó (2026-08-30): Dosa se comía el captcha de las
       imágenes CADA VEZ que entraba a IMDb, y en Opera GX no. Medido: en una
       sola carga de IMDb, las listas de Brave tumbaban OCHO peticiones a
       `*.token.awswaf.com`. Ese dominio no es un rastreador: es de donde el
       navegador recoge el TOKEN que demuestra que ya pasó la verificación del
       WAF de Amazon. Sin token no hay prueba de nada, así que el sitio vuelve
       a preguntar — y no se acaba nunca, porque la respuesta tampoco llega.

       Dejarlos pasar no abre la mano con la publicidad: lo que viaja por aquí
       es la propia verificación, no un identificador para seguirte por la web.
       Bloquearlos no protege de nada y rompe el sitio entero. */
    if (ES_VERIFICACION.test(u)) return callback({});
    /* Motor de Brave (adblock-rust + listas de Brave). Decide también las
       rutas de anuncios de YouTube (YT_AD_PATHS): corta lo que las listas
       bloquean, con su SUSTITUTO si lo traen, y deja pasar lo que exceptúan con
       `@@`. '/pagead/' casa también con googlesyndication.com/pagead/js/adsbygoogle.js,
       y para ese script hay decenas de reglas `$redirect=noopjs` en las webs que
       comprueban si cargó: cortarlo a pelo es justo lo que les delata el
       bloqueador. Si el motor aún no está listo, decide el respaldo de abajo. */
    const brave = braveAdblock.check(details, pagina);
    if (brave !== null) {
      if (brave.bloquear) {
        blockedCount++;
        /* Con `$redirect=` la regla no quiere un hueco sino un SUSTITUTO: se
           redirige a él en vez de cancelar. Es lo que hacen Brave y uBlock, y
           lo que evita que la web note el bloqueo: YouTube pide
           doubleclick.net/instream/ad_status.js y mira si quedó puesto
           `google_ad_status`; cancelado, la carga falla y lo toma por
           bloqueador (a un usuario le paró la reproducción con su cuenta).
           La redirección va al esquema propio de los sustitutos y no a un
           data: URL, que Electron no sigue (ver adblock.js). */
        if (brave.sustituto) return callback({ redirectURL: brave.sustituto });
        return callback({ cancel: true });
      }
      // `$removeparam`: la misma petición sin los parámetros de rastreo.
      if (brave.reescrita && brave.reescrita !== u) return callback({ redirectURL: brave.reescrita });
      return callback({});
    }
    // Respaldo sin motor (primer arranque, antes de tener listas): rutas de
    // anuncios de YouTube y dominios de publicidad conocidos, a ciegas.
    if (YT_AD_PATHS.some((p) => u.includes(p))) {
      blockedCount++;
      return callback({ cancel: true });
    }
    try {
      const host = new URL(u).hostname;
      if (AD_HOSTS.some((d) => hostMatches(host, d))) {
        blockedCount++;
        return callback({ cancel: true });
      }
    } catch { /* URL no válida */ }
    callback({});
  });

  // Un solo onHeadersReceived (Electron solo admite uno por sesión): (a) relaja el CSP
  // de YouTube para que el bloqueador de anuncios inyectado en document_start pueda
  // correr, y (b) abre CORS para las APIs públicas que declaren los addons.
  // (Vacío desde que se descatalogó Valve Rat Tool, que usaba api.skinport.com;
  // se conserva el mecanismo para futuros addons.)
  const CORS_OPEN = [];
  /* Escucha TODAS las respuestas, no solo las de CORS_OPEN, porque hace falta ver
     el 405 del muro del WAF (abajo). Lo que se toca sigue siendo exactamente lo
     mismo que antes: si el host no está en CORS_OPEN, la respuesta sale intacta.
     YouTube ya NO necesita que le borremos la CSP —se hacía porque el pruning se
     inyectaba con un <script> inline, y desde que va por
     contextBridge.executeInMainWorld le da igual—, así que cae en ese camino de
     no tocar nada junto con el resto de la web. */
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
    let host = ''; try { host = new URL(details.url).hostname; } catch { /* nada */ }
    // El muro del WAF se caza aquí porque es donde llegan las cabeceras de la
    // respuesta; quién lo desactiva es rompeBucleWaf, más abajo.
    if (details.statusCode === 405 && details.resourceType === 'mainFrame'
        && details.webContentsId && esMuroWaf(details)) {
      rompeBucleWaf(details).catch(() => { /* nada */ });
    }
    if (!CORS_OPEN.some((d) => hostMatches(host, d))) return cb({});
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (/^access-control-allow-(origin|methods|headers)$/i.test(k)) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    cb({ responseHeaders: headers });
  });

  /* ===== EL MURO DE "CONFIRME QUE ES HUMANO" QUE NO SE ACABABA NUNCA =====
     (2026-09-01) A Dosa le salía el captcha de las imágenes de Amazon CADA vez
     que entraba a IMDb. En Chrome no le salía, y en una ventana PRIVADA de
     Naviris tampoco: eso descarta de golpe la IP y el navegador, y deja al
     PERFIL como único sospechoso.

     Medido por CDP con la cabecera `x-amzn-waf-action`, que en cada carga dice
     si el WAF de Amazon manda el reto silencioso o el muro visual. Veredicto
     binario, sin gastar un solo captcha:

         con  aws-waf-token guardado  ->  405  captcha
         sin  aws-waf-token           ->  202  challenge  y entra sola

     Y por qué no se acababa nunca: en el localStorage de IMDb la marca
     `awswaf_captcha_solve_timestamp` seguía clavada dos días atrás aunque el
     captcha se acabara de resolver. Resolver el muro NO deja un token
     verificado — deja uno que, al presentarlo, vuelve a disparar el muro. Como
     la cookie dura cuatro días, el bucle se hereda días enteros: resolverlo era
     justo lo que condenaba a la siguiente vez.

     Aquí se rompe. Si una navegación principal vuelve 405 con
     `x-amzn-waf-action: captcha` y HABÍA un token guardado, se tira ese token y
     se recarga una vez: el intento siguiente sale de un reto limpio y pasa.

     BORRAR LA COOKIE Y RECARGAR NO BASTA, y costó dos intentos descubrirlo: la
     respuesta del muro trae su propio Set-Cookie con un token igual de inútil, y
     Chromium lo guarda DESPUÉS de que corran los manejadores de webRequest. O
     sea que el borrado llegaba siempre antes que la reposición y la recarga se
     volvía a llevar el token (medido: dos cargas seguidas, las dos con token).
     Filtrar ese Set-Cookie de la respuesta tampoco vale: igual que la cabecera
     Cookie no se ve en onBeforeSendHeaders, Chromium se guarda las de cookies
     aparte y lo que se devuelva aquí no las toca.

     Por eso la limpieza va por EVENTO, no por orden: se abre una ventana corta
     en la que cualquier token que aparezca para ese sitio se borra según nace,
     y la recarga se lanza al cerrarla. Así da igual quién llegue primero. La
     ventana se cierra antes de recargar a propósito: el token bueno que emita
     el reto limpio tiene que poder guardarse.

     Tres cautelas, porque esto corre solo:
     - Se borra SOLO la cookie del token. La sesión de Amazon vive en
       `session-token` y no se toca, así que esto no desloguea de nada. Es justo
       lo que `site:clear` no puede hacer, porque ese borra el dominio entero.
     - Si el muro sale SIN token guardado, no se hace nada: es un muro legítimo
       y recargar sería ponerse a dar vueltas contra el sitio.
     - Un reintento por sitio cada quince minutos como mucho. */
  const WAF_TOKEN = 'aws-waf-token';
  const WAF_ESPERA = 15 * 60 * 1000;
  const WAF_VENTANA = 400;     // ms purgando lo que reponga el muro
  const wafUltimo = new Map(); // host -> ts del último reintento
  const wafPurga = new Set();  // hosts en plena limpieza
  function esMuroWaf(details) {
    const h = details.responseHeaders || {};
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() !== 'x-amzn-waf-action') continue;
      return String([].concat(h[k])[0] || '').trim().toLowerCase() === 'captcha';
    }
    return false;
  }
  const urlDeCookie = (c) => (c.secure ? 'https://' : 'http://') + (c.domain || '').replace(/^\./, '') + (c.path || '/');
  ses.cookies.on('changed', (_e, cookie, _causa, borrada) => {
    if (borrada || cookie.name !== WAF_TOKEN || !wafPurga.size) return;
    const dominio = (cookie.domain || '').replace(/^\./, '');
    for (const host of wafPurga) {
      if (!hostMatches(host, dominio)) continue;
      ses.cookies.remove(urlDeCookie(cookie), cookie.name).catch(() => { /* ya no estaba */ });
      return;
    }
  });
  async function rompeBucleWaf(details) {
    let host = '';
    try { host = new URL(details.url).hostname; } catch { return; }
    const ahora = Date.now();
    if (wafPurga.has(host) || ahora - (wafUltimo.get(host) || 0) < WAF_ESPERA) return;
    const tokens = await ses.cookies.get({ domain: host, name: WAF_TOKEN });
    if (!tokens.length) return; // muro legítimo: no hay nada viciado que tirar
    wafUltimo.set(host, ahora);
    wafPurga.add(host);
    for (const c of tokens) await ses.cookies.remove(urlDeCookie(c), c.name).catch(() => { /* ya no estaba */ });
    const wc = webContents.fromId(details.webContentsId);
    setTimeout(() => {
      wafPurga.delete(host);   // ANTES de recargar: el token bueno debe poder entrar
      if (wc && !wc.isDestroyed()) wc.reload();
    }, WAF_VENTANA);
  }

  // Lo bajado en la sesión privada (en memoria) no entra en el historial de descargas.
  ses.on('will-download', (_e, item) => registerDownloadItem(item, undefined, ses.isPersistent(), ses));
  /* SESIONES QUE NO SE PIERDEN (2026-08-13). Chromium guarda las cookies en
     memoria y las vuelca al disco cuando le parece: si el proceso muere de
     golpe (cierre forzado, cuelgue, corte de luz) se pierde lo escrito desde
     el ultimo volcado — y eso se ve como "me ha cerrado la sesion" en sitios
     donde acababas de entrar. Se fuerza el volcado cada pocos minutos y al
     salir, que es barato y evita justo ese susto. */
  const vuelca = () => { try { ses.cookies.flushStore(); } catch { /* nada */ } };
  setInterval(vuelca, 3 * 60 * 1000);

  /* Sesiones que sobreviven al cierre: ver sesiones.js. Solo con "Continuar
     donde lo dejaste", que es su significado. */
  async function conservaSesiones() {
    if (settings.restoreSession === false) return;
    const n = await conservaCookiesDeSesion(ses.cookies);
    if (n) console.log(`[Naviris] ${n} cookies de sesión conservadas para el próximo arranque`);
  }
  // Lo espera el único before-quit (ver alSalir). La privada vive en memoria:
  // convertir sus cookies no serviría de nada.
  alSalir.push(async () => { vuelca(); if (ses.isPersistent()) await conservaSesiones(); });
  ses.cookies.on('changed', (() => {
    let t = null;
    return () => { clearTimeout(t); t = setTimeout(vuelca, 20000); };   // agrupado: no en cada cookie
  })());
  setupPermissions(ses);
}

// ---------- Gestión de permisos por sitio ----------
// Permisos que se conceden sin preguntar (poco sensibles)
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'idle-detection', 'background-sync', 'wake-lock']);
// Permisos sensibles que SIEMPRE preguntamos si no hay decisión guardada
const SENSITIVE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'hid', 'serial', 'usb', 'bluetooth']);
let permSeq = 0;
const permPending = new Map();

function originOf(url) { try { return new URL(url).origin; } catch { return ''; } }

function setupPermissions(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf(details.requestingUrl || (wc && wc.getURL && wc.getURL()) || '');
    if (!origin) return callback(false);
    if (permission === 'openExternal') return pideAbrirFuera(wc, details && details.externalURL, callback);
    if (AUTO_ALLOW.has(permission)) return callback(true);
    const key = origin + '|' + permission;
    const saved = settings.permissions[key];
    if (saved === 'allow') return callback(true);
    if (saved === 'block') return callback(false);
    if (!SENSITIVE.has(permission)) return callback(false); // desconocido/no listado → denegar por seguridad
    // Preguntar al usuario
    const id = 'perm' + (++permSeq);
    permPending.set(id, { callback, key });
    // Si la pestaña se cierra sin contestar, la petición no se queda colgada.
    wc?.once('destroyed', () => { const p = permPending.get(id); if (p) { permPending.delete(id); p.callback(false); } });
    const mediaTypes = (details && details.mediaTypes) || [];
    // Solo a la ventana de la pestaña que pregunta: antes salía en todas, también
    // en las normales cuando preguntaba una web abierta en la ventana privada.
    const host = wc && wc.hostWebContents;
    if (host && !host.isDestroyed()) host.send('perm:ask', { id, origin, permission, mediaTypes });
    else broadcast('perm:ask', { id, origin, permission, mediaTypes });
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    return settings.permissions[originOf(requestingOrigin) + '|' + permission] === 'allow';
  });
}

ipcMain.on('perm:respond', soloUI((_e, r) => {
  const { id, decision, remember } = r || {};
  const pend = permPending.get(id);
  if (!pend) return;
  permPending.delete(id);
  const allow = decision === 'allow';
  if (remember) { settings.permissions[pend.key] = allow ? 'allow' : 'block'; saveSettings(settings); }
  pend.callback(allow);
}));
ipcMain.handle('perm:list', soloUI(() => settings.permissions));
ipcMain.handle('perm:remove', soloUI((_e, key) => { delete settings.permissions[key]; saveSettings(settings); return settings.permissions; }));
ipcMain.handle('perm:clear', soloUI(() => { settings.permissions = {}; saveSettings(settings); return settings.permissions; }));
ipcMain.handle('sec:status', () => ({
  sandbox: true,                                                   // sandbox activado en cada webview
  siteIsolation: !app.commandLine.hasSwitch('disable-site-isolation-trials'), // Chromium: por defecto activo
  httpsUpgrades: true                                             // auto-subida http→https
}));

// ---------- yt-dlp: vídeo y audio (mp3) ----------
const ytJobs = new Map(); // id → child process

// Mueve el archivo terminado de la carpeta temporal a Descargas, sustituyendo
// uno igual si ya estaba (es la misma descarga repetida). Si la temporal está
// en otro disco, renombrar no vale: se copia.
function mueveADescargas(origen, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const destino = path.join(outDir, path.basename(origen));
  fs.rmSync(destino, { force: true });
  try { fs.renameSync(origen, destino); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(origen, destino); fs.rmSync(origen, { force: true });
  }
  return destino;
}
const borraCarpeta = (d) => fs.rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }, () => { /* lo que quede, lo limpia Windows */ });
// Al arrancar: lo que dejaron descargas cortadas al cerrar Naviris a mitad
// (carpetas temporales y cookies). Solo nombres propios del Rat Tool y con más
// de una hora (rat.restosTemporales); en segundo plano, sin frenar el arranque.
function limpiaRestosRat() {
  const tmp = app.getPath('temp');
  fs.readdir(tmp, { withFileTypes: true }, (err, entradas) => {
    if (err) return;
    const candidatas = [];
    for (const e of entradas) {
      if (!/^naviris-(rat-descarga|cookies)-/.test(e.name)) continue;
      try { candidatas.push({ nombre: e.name, carpeta: e.isDirectory(), mtimeMs: fs.statSync(path.join(tmp, e.name)).mtimeMs }); } catch { /* ya no está */ }
    }
    for (const n of rat.restosTemporales(candidatas, Date.now())) borraCarpeta(path.join(tmp, n));
  });
}

async function ytDownload({ url, mode, quality }) {
  const id = 'yt' + (++downloadSeq);
  const outDir = app.getPath('downloads');
  const meta = {
    id, name: 'Obteniendo información…', path: outDir, total: 0, received: 0,
    percent: 0, state: 'progressing', kind: mode === 'audio' ? 'audio' : 'video', source: url
  };
  downloads.set(id, { meta });
  broadcast('download:new', meta);
  const falla = (error) => { meta.state = 'interrupted'; meta.error = error; meta.name = 'Error: ' + error; broadcast('download:update', meta); return id; };

  if (!fs.existsSync(ytDlpPath()) || !fs.existsSync(ffmpegPath())) return falla('El motor de descargas no está instalado. Revisa tu conexión y vuelve a abrir el Rat Tool');
  // Con --no-playlist una lista suelta (playlist?list=…) se bajaba entera en
  // una sola fila del panel, sin nombre ni progreso reales.
  if (rat.esLista(url)) return falla('Es una lista de reproducción. Abre uno de sus videos y descárgalo desde ahí');
  // Un canal de Twitch es su directo: no acabaría nunca (rat.esDirecto)
  if (rat.esDirecto(url)) return falla(rat.mensajeDirecto(url));

  // Carpeta propia de esta descarga (ver rat.argsDescarga)
  let dir;
  try { dir = fs.mkdtempSync(path.join(app.getPath('temp'), rat.PREFIJO_TEMPORAL)); } catch { return falla('No se pudo preparar la descarga. Revisa el espacio libre en el disco'); }

  // Con la sesión del navegador y su mismo user agent: lo que se ve en la
  // pestaña se puede bajar (Instagram, X, Reddit). A YouTube, solo en el
  // reintento, si pide iniciar sesión (rat.cookiesDeEntrada / reintentaConCookies).
  // reintento: true en la segunda (y última) vuelta, la de las cookies
  const lanza = (cookies, reintento) => {
    const args = rat.argsDescarga({ url, mode, quality, dir, ffmpeg: ffmpegPath(), deno: denoSiHay(), ua: UA_LIMPIO, cookies });
    const child = spawn(ytDlpPath(), args, { windowsHide: true });
    ytJobs.set(id, child);

    // Un tuit o un carrusel con varios videos son varias descargas en una: se
    // mueven todas (antes caían todas en Descargas y así sigue siendo).
    let lastPct = 0, lastError = '', directo = false;
    const finales = [];
    const alEvento = (e) => {
      if (e.tipo === 'archivo') {
        // El nombre con el que acabará (el MP3 o el MP4 ya unido)
        meta.name = path.basename(e.ruta).replace(/\.[^.\\/]+$/, '') + (mode === 'audio' ? '.mp3' : '.mp4');
        broadcast('download:update', meta);
      } else if (e.tipo === 'final') {
        finales.push(e.ruta);
      } else if (e.tipo === 'estado') {
        if (e.valor === 'is_live') directo = true;
      } else if (e.tipo === 'progreso') {
        meta.percent = e.percent;
        if (e.total) { meta.total = e.total; meta.received = Math.round(e.total * e.percent / 100); }
        if (Math.abs(meta.percent - lastPct) >= 1) { lastPct = meta.percent; broadcast('download:update', meta); }
      } else if (e.tipo === 'error') lastError = e.texto;
    };
    const lectorOut = rat.creaLector(alEvento), lectorErr = rat.creaLector(alEvento);
    child.stdout.on('data', lectorOut.escribe);
    child.stderr.on('data', lectorErr.escribe);
    child.on('error', (e) => { lastError = e.message; });
    child.on('close', (code) => {
      lectorOut.cierra(); lectorErr.cierra();
      borraCookies(cookies);
      ytJobs.delete(id);
      // Cancelada por el usuario: el código de salida del proceso matado no es un
      // error, y lo que quedó a medias está en la carpeta temporal.
      if (meta.state === 'cancelled') { borraCarpeta(dir); return; }
      try {
        for (const f of finales.filter((x) => fs.existsSync(x))) {
          meta.path = mueveADescargas(f, outDir);
          meta.name = path.basename(meta.path);
          recordDlHistory(meta.path);
        }
        if (code === 0 && meta.path !== outDir) {
          meta.state = 'completed'; meta.percent = 100;
          if (!meta.total) { try { meta.total = meta.received = fs.statSync(meta.path).size; } catch { /* nada */ } }
        }
      } catch (e) {
        lastError = e.message;
      }
      const termina = () => {
        if (meta.state === 'cancelled') { borraCarpeta(dir); return; }
        if (meta.state !== 'completed') {
          console.log('[Naviris] yt-dlp:', code, lastError);
          meta.state = 'interrupted';
          // yt-dlp salta los directos sin error (--match-filter !is_live)
          meta.error = directo && !finales.length ? rat.mensajeDirecto(url) : rat.errorDeYtDlp(lastError, url);
          if (meta.name === 'Obteniendo información…') meta.name = 'Error: ' + meta.error;
          // yt-dlp desfasado: se actualiza ya, sin esperar a la revisión diaria
          if (rat.pideActualizar(lastError)) actualizaYtDlp({ forzar: true });
        }
        borraCarpeta(dir);
        broadcast('download:update', meta);
      };
      // Un solo reintento, y solo si hay sesión que no se pasó la primera vez
      if (meta.state !== 'completed' && !reintento && !rat.cookiesDeEntrada(url) && rat.reintentaConCookies(lastError, url)) {
        cookiesParaYtDlp(url).then((c) => {
          if (!c || meta.state === 'cancelled') { borraCookies(c); termina(); return; }
          console.log('[Naviris] yt-dlp pide sesión, se reintenta con las cookies:', lastError);
          lanza(c, true);
        });
        return;
      }
      termina();
    });
  };
  lanza(rat.cookiesDeEntrada(url) ? await cookiesParaYtDlp(url) : null, false);
  return id;
}

/* ---------- Ventana de arranque ----------
   PETICIÓN DE DOSA (2026-08-17): el arranque es una ventana propia y pequeña
   con el logo, y la principal no se muestra hasta que su interfaz está montada.

   REHECHO EL 2026-11-03 ("todavía no me convence, se puede ver más
   profesional", y con sonido). Medido en este equipo, la interfaz queda
   montada a ~0,5 s del arranque, pero el anillo con sus cinco etapas obligaba
   a esperar 1,6 s más: la ventana salía a ~2,3 s. Ahora el splash dura lo que
   dura su animación (SPLASH_MINIMO) y no más; si el arranque se alarga, sigue
   en pantalla y enseña la etapa en curso. Ver splash.html para las tres
   direcciones y src/sonidos.js para el sonido. */
// CAMBIAR DE SPLASH = cambiar esta línea: 'apertura' | 'firma' | 'icono'
const SPLASH_VARIANTE = 'apertura';
/* Cómo se abre la lente en 'apertura' (splash.js): 'clasica' (escalado rígido)
   o las líquidas 'gota' | 'muelle' | 'menisco' | 'marea'. Las otras variantes no la usan. */
const SPLASH_LENTE = 'muelle';
// Tamaño de cada una: la tarjeta más el margen de su sombra (la ventana es transparente)
const SPLASH_TAMANO = { apertura: [288, 288], firma: [460, 220], icono: [240, 300] };
const SPLASH_MINIMO = 1050; // ms en pantalla: la animación entera (~0,9 s) y un respiro
const SPLASH_SALIDA = 200;  // el fundido de salida de splash.html (.sale)
// Tope de seguridad tras ocultarse, por si el audio nunca avisa de que acabó (el de arranque dura < 3 s)
const SPLASH_TOPE_SONIDO = 4000;
let splashWin = null;
let splashPct = 0;          // último hito, por si el splash aún no ha cargado
let splashDesde = 0;        // cuándo empezó su animación: el mínimo en pantalla cuenta desde ahí
let splashSonando = true;   // hasta que splash.js avisa de que su sonido acabó (o de que no hay)
let splashOculto = false;   // ya hizo su salida: solo espera a que acabe el sonido para cerrarse
let splashAnda = Promise.resolve(); // se cumple cuando arranca la animación del splash

function crearSplash() {
  const [width, height] = SPLASH_TAMANO[SPLASH_VARIANTE];
  splashWin = new BrowserWindow({
    width, height, resizable: false, movable: true,
    /* Sin mostrar hasta tener contenido: antes salía a los ~0,2 s como un
       cuadrado vacío y el logo llegaba ~0,25 s después. */
    show: false,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    center: true, alwaysOnTop: true, skipTaskbar: false,
    maximizable: false, minimizable: false, fullscreenable: false,
    title: 'Naviris',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true, nodeIntegration: false,
      /* PARTICIÓN PROPIA Y EN MEMORIA. Esta ventana se crea ANTES de que
         castlabs registre el CDM de Widevine, y la sesión por defecto es
         justo donde se registra: con su propia partición no la toca ni de
         lado, así que el DRM de la ventana principal queda intacto. */
      partition: 'naviris-splash'
    }
  });
  splashWin.loadFile(path.join(__dirname, 'splash.html'), {
    query: { v: SPLASH_VARIANTE, lente: SPLASH_LENTE, tema: settings.lightMode ? 'claro' : 'oscuro', sonido: settings.sonidos === false ? '0' : '1' }
  });
  splashWin.once('ready-to-show', () => {
    if (!splashWin || splashWin.isDestroyed()) return;
    splashDesde = Date.now();
    splashWin.show();
  });
  /* La animación arranca con el sonido, y el audio puede tardar en empezar
     (splash.js espera hasta 260 ms): el mínimo se cuenta desde que arranca de
     verdad, para que la ventana nunca corte la animación a medias. */
  let anda;
  splashAnda = new Promise((r) => { anda = r; });
  ipcMain.once('splash:anda', () => { splashDesde = Date.now(); anda(); });
  // Cerrar la ventana corta su audio: se cierra cuando el sonido termina, no antes
  ipcMain.once('splash:fin', () => {
    splashSonando = false;
    if (splashOculto && splashWin && !splashWin.isDestroyed()) splashWin.close();
  });
  // El hito que ya se hubiera cumplido antes de que la página existiera
  splashWin.webContents.once('did-finish-load', () => splashProgreso(splashPct));
  splashWin.on('closed', () => { splashWin = null; });
}

function splashProgreso(pct) {
  splashPct = Math.max(splashPct, pct);
  if (!splashWin || splashWin.isDestroyed()) return;
  try { splashWin.webContents.send('splash:progreso', splashPct); } catch {}
}

/* El relevo: se enseña la ventana ya montada y, a la vez, el splash (que está
   encima) se funde y se va, así que se ve una sola transición y nunca el
   escritorio entre las dos. Tras el fundido la ventana se OCULTA, y se cierra
   cuando el sonido de arranque termina su cola (splash:fin) o, como mucho,
   SPLASH_TOPE_SONIDO después. */
async function cerrarSplash(win) {
  /* En un equipo rápido la interfaz puede estar lista ANTES de que el splash
     empiece su animación (medido: ui:listo a 0,28 s y splash a 0,35 s). Se
     espera a que empiece, para que el arranque se vea siempre entero; con
     tope, por si el splash fallara. */
  await Promise.race([splashAnda, new Promise((r) => setTimeout(r, 1500))]);
  const espera = splashDesde ? Math.max(0, SPLASH_MINIMO - (Date.now() - splashDesde)) : 0;
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus(); }
    if (!splashWin || splashWin.isDestroyed()) return;
    const sw = splashWin;
    try { sw.webContents.send('splash:sale'); } catch {}
    setTimeout(() => {
      if (sw.isDestroyed()) return;
      sw.hide();
      splashOculto = true;
      if (!splashSonando) sw.close();
      else setTimeout(() => { if (!sw.isDestroyed()) sw.close(); }, SPLASH_TOPE_SONIDO);
    }, SPLASH_SALIDA);
  }, espera);
}

// La ventana principal que está esperando a que su interfaz termine de montarse
let ventanaEsperandoUI = null;
const uiMontada = new Set();   // ids de las ventanas cuya interfaz ya avisó con 'ui:listo'
const normales = new Set();    // ventanas no privadas, de la menos a la más reciente en usarse
// Lo que hay que abrir en la primera ventana; deja de usarse (null) en cuanto existe.
let paraLaPrimera = [...DESTINOS_AL_ARRANCAR];

/* Lo que llega de fuera (enlaces, archivos) se abre en pestañas nuevas de la
   última ventana normal que se usó, como en Chrome; nunca en una privada. Si
   solo hay privadas, en una ventana normal nueva. */
function abreDestinos(destinos) {
  if (!destinos.length) return;
  const win = [...normales].pop();
  if (!win) {
    const nueva = ventanaConUrl(destinos[0], false);
    if (nueva) urlPendiente.get(nueva.id).push(...destinos.slice(1).map((url) => ({ url, contenedor: null })));
    return;
  }
  if (uiMontada.has(win.id)) for (const url of destinos) win.webContents.send('tab:open-url', { url, background: false });
  else urlPendiente.set(win.id, [...(urlPendiente.get(win.id) || []), ...destinos.map((url) => ({ url, contenedor: null }))]);
  // Durante el splash la ventana aún no se ve: se enseñará ella sola al montarse.
  if (win.isVisible()) { if (win.isMinimized()) win.restore(); win.focus(); }
}

app.on('second-instance', (_e, _argv, _cwd, datos) => {
  // Solo direcciones web y de archivo, aunque las mande otra instancia de Naviris.
  const destinos = (Array.isArray(datos && datos.destinos) ? datos.destinos : [])
    .filter((u) => typeof u === 'string' && /^(https?|file):/i.test(u));
  // Esta instancia ya se está cerrando: se relanza al acabar con lo que traía la otra.
  if (saliendo) { app.relaunch({ args: abrirDesdeFuera.argumentosParaRelanzar(process.argv, process.defaultApp, destinos) }); return; }
  // Aún arrancando (el splash, Widevine): la primera ventana lo abrirá al montarse.
  if (paraLaPrimera) { paraLaPrimera.push(...destinos.filter((u) => !paraLaPrimera.includes(u))); return; }
  if (destinos.length) { abreDestinos(destinos); return; }
  // Abrir Naviris sin nada que abrir trae al frente la ventana que ya está
  // abierta; si solo quedan privadas, abre una normal.
  const win = [...normales].pop();
  if (!win) createWindow();
  else if (win.isVisible()) { if (win.isMinimized()) win.restore(); win.focus(); }
});
// El renderer avisa cuando la interfaz ya está en pantalla (pestañas, hub y
// tema aplicados). Es el único hito que sabe de verdad que "ya se puede ver".
ipcMain.on('ui:listo', (e) => {
  // La ventana que acaba de montarse puede traer una pestaña sacada de otra
  // o lo que llegó de fuera mientras arrancaba.
  const suya = BrowserWindow.fromWebContents(e.sender);
  if (suya) {
    uiMontada.add(suya.id);
    for (const { url, contenedor } of urlPendiente.get(suya.id) || []) e.sender.send('tab:open-url', { url, background: false, contenedor });
    urlPendiente.delete(suya.id);
  }
  const win = ventanaEsperandoUI;
  if (!win) return;
  ventanaEsperandoUI = null;
  cerrarSplash(win);
});

// ---------- Ventanas ----------
// Las únicas sesiones en las que puede vivir una web dentro de Naviris.
const esParticionDeNaviris = (p) => p === PART_NORMAL || p === PART_PRIVATE || /^persist:(cont|esp)-[a-z0-9]{1,24}$/.test(String(p || ''));

function createWindow(isPrivate = false, conSplash = false, sacada = false) {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 560,
    frame: false, show: false, backgroundColor: '#0a0a0c',
    title: isPrivate ? 'Naviris — Privado' : 'Naviris',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, contextIsolation: true, nodeIntegration: false, spellcheck: false
    }
  });
  // Sandbox + aislamiento en cada webview (contenido de sitios) + preload de contraseñas
  win.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    // Un <webview> sin partición de Naviris caería en la sesión por defecto (la de
    // la interfaz), sin bloqueador ni control de permisos: no se monta.
    if (!esParticionDeNaviris(params.partition)) { e.preventDefault(); return; }
    // Las webs nunca se cargan sin la política del mismo origen, diga lo que diga el elemento.
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.sandbox = true;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    // Corrector ortográfico (2026-11-03). La ventana de la interfaz se crea con
    // spellcheck:false y el webview lo heredaba: en ninguna web salía la línea
    // roja ni las sugerencias del clic derecho. Las webs lo llevan encendido,
    // como en Chrome; la interfaz sigue sin él.
    webPreferences.spellcheck = true;
    webPreferences.preload = path.join(__dirname, 'webview-preload.js');
    /* Pestañas de fondo dormidas para el pintado, como en Chrome (2026-11-03).
       Con backgroundThrottling a false (lo que había, por el AutoClaim) Electron no
       deja que el webview se marque nunca como oculto: las pestañas de detrás y las
       que tapa el hub seguían pintando a la frecuencia de la pantalla y se llevaban
       la mayor parte de la CPU y la GPU con varias abiertas. Con el freno, la que no
       se ve deja de pintar y sus temporizadores van a uno por segundo; el sonido, el
       video con sonido y las llamadas siguen, y al volver se ve al instante. Las de
       AutoClaim se lo quitan ellas mismas ('wv:sin-freno'). */
    webPreferences.backgroundThrottling = true;
    /* NADA DE alert/confirm/prompt EN LAS WEBS (2026-08-13). Esos diálogos son
       modales NATIVOS colgados de nuestra ventana: mientras uno está abierto,
       la ventana entera deja de aceptar clics. Y en una ventana sin marco como
       la de Naviris el modal a veces ni se dibuja donde debería, así que el
       navegador simplemente parecía congelado — el fallo que reportó Dosa al
       abrir enlaces desde X, que suelen acabar en páginas basura que abusan de
       alert(). Con esto la web se queda sin ellos: alert no hace nada, confirm
       devuelve false y prompt null.
       Desde 2026-11-03 los tres vuelven, pero como diálogo PROPIO dentro de la
       pestaña (ver 'wv:dialogo' más abajo y webview-preload.js): solo espera
       la página que preguntó; el navegador y las demás pestañas siguen
       respondiendo. disableDialogs se queda para que el modal nativo no
       vuelva a salir por ningún otro camino. */
    webPreferences.disableDialogs = true;
    // Pestaña que despierta con su atrás y adelante guardados (ver 'wv:historial'):
    // el webview nace sin cargar la URL y restaura su historial al montarse.
    const pend = historialPendiente.get(win.webContents.id);
    const i = pend ? pend.findIndex((h) => h.url === urlNormal(params.src) && Date.now() - h.ts < 10000) : -1;
    if (i >= 0) {
      historialAlCrear = pend.splice(i, 1)[0];
      params.src = '';
      setImmediate(() => { historialAlCrear = null; });   // solo vale para el webview que se crea ahora
    }
  });
  // sacada=1: la ventana nace de sacar una pestaña y no debe restaurar la sesión
  // (NAV-IA-09); el renderer la reconoce por la URL, igual que private=1.
  const query = {};
  if (isPrivate) query.private = '1';
  if (sacada) query.sacada = '1';
  if (!isPrivate && PART_NORMAL !== PART_NAVIRIS) query.particion = PART_NORMAL;
  win.loadFile(path.join(__dirname, 'index.html'), Object.keys(query).length ? { query } : undefined);
  // La interfaz no navega nunca: ni un <meta refresh> inyectado ni un enlace o
  // archivo soltado sobre ella pueden cambiar index.html por otra página (que
  // heredaría window.navirisApp).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Ni abre ventanas sueltas: una dirección web se abre en una pestaña de esta ventana.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) win.webContents.send('tab:open-url', { url, background: false });
    return { action: 'deny' };
  });
  // Si se cae el proceso de la interfaz, la ventana se quedaba muerta. Se recarga
  // (las pestañas vuelven con la sesión); si se cae otra vez enseguida, no se insiste.
  let ultimaCaida = 0;
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit' || win.isDestroyed() || Date.now() - ultimaCaida < 30000) return;
    ultimaCaida = Date.now();
    win.webContents.reload();
  });
  /* CON SPLASH la ventana NO se muestra al estar pintada, sino cuando su
     interfaz avisa de que está montada ('ui:listo' desde el renderer). Si se
     mostrara antes se vería el esqueleto vacío detrás del cuadrado, que es
     justo lo que se quiere evitar.
     RED DE SEGURIDAD: si el renderer nunca avisa (un error de JS al arrancar
     dejaría la ventana invisible para siempre), a los 8 s se muestra igual. */
  if (conSplash) {
    ventanaEsperandoUI = win;
    win.webContents.once('did-finish-load', () => splashProgreso(85));
    setTimeout(() => { if (ventanaEsperandoUI === win) { ventanaEsperandoUI = null; cerrarSplash(win); } }, 8000);
  } else {
    win.once('ready-to-show', () => win.show());
  }
  const id = win.id;
  win.once('closed', () => { uiMontada.delete(id); urlPendiente.delete(id); normales.delete(win); });
  if (!isPrivate) { normales.add(win); win.on('focus', () => { normales.delete(win); normales.add(win); }); }
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  // Botones laterales del ratón (4 y 5). En Windows llegan como WM_APPCOMMAND ->
  // evento 'app-command' de la ventana, NO como 'mouseup' con button 3/4 (por
  // eso el toggle sobre mouseup no hacía nada). Se toma el control aquí:
  // preventDefault SIEMPRE para que Chromium no navegue por su cuenta, y solo se
  // reenvía a la interfaz si el ajuste está activo.
  win.on('app-command', (e, cmd) => {
    if (cmd !== 'browser-backward' && cmd !== 'browser-forward') return;
    e.preventDefault();
    if (settings.mouseNav === false) return;
    win.webContents.send('ui:shortcut', cmd === 'browser-backward' ? 'back' : 'forward');
  });
  // Clic derecho en la zona de arrastre de la barra (el "caption" de la ventana
  // sin marco): a la página no le llega ningún contextmenu — el sistema se queda
  // el evento y Windows mostraría su menú de ventana (Restaurar/Mover/Cerrar).
  // Se intercepta y se le pasan las coordenadas a la interfaz, que enseña su
  // menú de barra (nueva pestaña, reabrir cerrada...), como Chrome u Opera.
  win.on('system-context-menu', (e) => {
    e.preventDefault();
    // El point del evento llega desviado con varios monitores; el cursor es
    // exactamente donde se hizo el clic y viene en los mismos DIPs que
    // getContentBounds, así que el menú cae justo bajo el puntero.
    const p = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    win.webContents.send('ui:tabstrip-menu', { x: p.x - b.x, y: p.y - b.y });
  });
  return win;
}

/* ---------- Menú contextual de las páginas ----------
   Un <webview> de Electron no trae ninguno: el clic derecho en una página no
   hacía absolutamente nada. El menú es sensible a lo que hay debajo:
   selección, campo de texto, enlace, imagen y —lo que pidió Dosa— vídeo, donde
   ofrece bajarlo con el Rat Tool.

   Naviris 3: lo arma el main (es quien sabe qué hay bajo el ratón y quien
   ejecuta cada acción), pero lo PINTA la interfaz con el estilo de Naviris
   (propuesta aprobada el 2026-11-03), encima de la página. Solo viajan el
   texto, el icono, el atajo y si está activo; al elegir, la interfaz devuelve
   el número y aquí se ejecuta el click de siempre. Una ventana sin interfaz
   de Naviris (las ventanitas de inicio de sesión) sigue con el Menu nativo. */
const menusAbiertos = new Map();   // id del webContents de la interfaz -> { id, clicks, antes }
let ultimoMenu = 0;
const TECLAS_VISIBLES = { Left: '←', Right: '→', Shift: 'Mayús', Super: 'Win' };
const teclaVisible = (a) => (a ? a.split('+').map((k) => TECLAS_VISIBLES[k] || k).join('+') : '');
// `donde` dice dónde abrirlo: { wc, x, y } en una página o { x, y } en la interfaz.
// `antes` corre antes de la acción elegida (devolverle el foco a la página).
function muestraMenu(host, items, donde, antes) {
  if (!host || host.isDestroyed()) {
    Menu.buildFromTemplate(items.map(({ icon, ...resto }) => resto)).popup();
    return;
  }
  const id = ++ultimoMenu, clicks = [];
  const lista = items.map((it) => {
    if (it.type === 'separator') return { sep: true };
    clicks.push(it.click);
    return { n: clicks.length - 1, label: it.label, icon: it.icon || '', kbd: teclaVisible(it.accelerator), disabled: it.enabled === false };
  });
  menusAbiertos.set(host.id, { id, clicks, antes });
  host.send('ctx:menu', { id, items: lista, ...donde });
}
ipcMain.on('ctx:elige', soloUI((e, id, n) => {
  const m = menusAbiertos.get(e.sender.id);
  if (!m || m.id !== id || typeof m.clicks[n] !== 'function') return;
  menusAbiertos.delete(e.sender.id);
  // La pestaña puede haberse cerrado con el menú abierto: sin cuadros de error.
  try { m.antes?.(); m.clicks[n](); } catch (err) { console.warn('[Naviris] acción del menú:', err.message); }
}));

const puedeAtras = (c) => { try { return c.navigationHistory ? c.navigationHistory.canGoBack() : c.canGoBack(); } catch { return false; } };
const puedeAdelante = (c) => { try { return c.navigationHistory ? c.navigationHistory.canGoForward() : c.canGoForward(); } catch { return false; } };
const irAtras = (c) => { try { c.navigationHistory ? c.navigationHistory.goBack() : c.goBack(); } catch { /* nada */ } };
const irAdelante = (c) => { try { c.navigationHistory ? c.navigationHistory.goForward() : c.goForward(); } catch { /* nada */ } };

async function guardarComo(contents, pdf) {
  const nombre = (() => {
    try {
      const u = new URL(contents.getURL());
      const base = (u.pathname.split('/').pop() || u.hostname).replace(/[^\w.-]+/g, '-');
      return (base || 'pagina').replace(/\.(html?|php|aspx?)$/i, '') + (pdf ? '.pdf' : '.html');
    } catch { return pdf ? 'pagina.pdf' : 'pagina.html'; }
  })();
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('downloads'), nombre)
  });
  if (canceled || !filePath) return;
  try {
    if (pdf) fs.writeFileSync(filePath, await contents.printToPDF({ printBackground: true }));
    else await contents.savePage(filePath, 'HTMLComplete');
  } catch (e) {
    dialog.showErrorBox('No se pudo guardar', String(e.message || e));
  }
}

// Ctrl+S desde la interfaz: el mismo «Guardar la página como…» del clic derecho.
ipcMain.on('tab:guardar', soloUI((e, id) => {
  const wc = webContents.fromId(Number(id));
  if (wc && !wc.isDestroyed() && wc.getType() === 'webview' && wc.hostWebContents?.id === e.sender.id) guardarComo(wc, false);
}));

function menuContextual(contents) {
  contents.on('context-menu', (_e, p) => {
    const host = contents.hostWebContents;
    const aRenderer = (tipo, datos) => host?.send('ctx:accion', { tipo, datos });
    const items = [];
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };

    if (p.selectionText && !p.isEditable) {
      const limpio = p.selectionText.trim().replace(/\s+/g, ' ');
      const corto = limpio.length > 24 ? limpio.slice(0, 24).trimEnd() + '…' : limpio;
      items.push({ label: 'Copiar', icon: 'copy', accelerator: 'Ctrl+C', click: () => contents.copy() });
      items.push({ label: 'Buscar "' + corto + '" en una pestaña nueva', icon: 'magnifying-glass', click: () => aRenderer('buscar', p.selectionText.trim()) });
      sep();
    }
    if (p.isEditable) {
      // Corrector: sugerencias para la palabra subrayada, como en Chrome.
      if (p.misspelledWord) {
        const sugerencias = (p.dictionarySuggestions || []).slice(0, 5);
        for (const s of sugerencias) items.push({ label: s, icon: 'spell-check', click: () => contents.replaceMisspelling(s) });
        if (!sugerencias.length) items.push({ label: 'Sin sugerencias', icon: 'spell-check', enabled: false });
        items.push({ label: 'Añadir al diccionario', icon: 'book-plus', click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
        sep();
      }
      const f = p.editFlags || {};
      items.push({ label: 'Deshacer', icon: 'undo-2', accelerator: 'Ctrl+Z', enabled: f.canUndo !== false, click: () => contents.undo() });
      items.push({ label: 'Rehacer', icon: 'redo-2', accelerator: 'Ctrl+Y', enabled: f.canRedo !== false, click: () => contents.redo() });
      sep();
      items.push({ label: 'Cortar', icon: 'scissors', accelerator: 'Ctrl+X', enabled: f.canCut !== false && !!p.selectionText, click: () => contents.cut() });
      items.push({ label: 'Copiar', icon: 'copy', accelerator: 'Ctrl+C', enabled: f.canCopy !== false && !!p.selectionText, click: () => contents.copy() });
      items.push({ label: 'Pegar', icon: 'clipboard', accelerator: 'Ctrl+V', enabled: f.canPaste !== false, click: () => contents.paste() });
      // Solo donde hay formato que perder (contenteditable): en un campo de texto plano es lo mismo que Pegar.
      if (f.canEditRichly) items.push({ label: 'Pegar como texto sin formato', icon: 'clipboard', accelerator: 'Ctrl+Shift+V', enabled: f.canPaste !== false, click: () => contents.pasteAndMatchStyle() });
      items.push({ label: 'Eliminar', icon: 'trash', enabled: f.canDelete !== false && !!p.selectionText, click: () => contents.delete() });
      sep();
      items.push({ label: 'Seleccionar todo', icon: 'text-cursor', accelerator: 'Ctrl+A', enabled: f.canSelectAll !== false, click: () => contents.selectAll() });
      items.push({ label: 'Emojis', icon: 'smile', accelerator: 'Super+.', click: () => app.showEmojiPanel() });
      sep();
    }
    if (p.linkURL) {
      const web = /^https?:/i.test(p.linkURL);
      const privada = host ? esVentanaPrivada(host) : false;
      items.push({ label: 'Abrir el enlace en una pestaña nueva', icon: 'plus', click: () => host?.send('tab:open-url', { url: p.linkURL, background: true, origen: contents.id }) });
      if (web) {
        items.push({ label: 'Abrir el enlace en una ventana nueva', icon: 'app-window', click: () => ventanaConUrl(p.linkURL, privada) });
        if (!privada) items.push({ label: 'Abrir el enlace en una ventana privada', icon: 'venetian-mask', click: () => ventanaConUrl(p.linkURL, true) });
      }
      sep();
      items.push({ label: 'Copiar el enlace', icon: 'link', click: () => clipboard.writeText(p.linkURL) });
      const texto = (p.linkText || '').trim();
      if (texto) items.push({ label: 'Copiar el texto del enlace', icon: 'copy', click: () => clipboard.writeText(texto) });
      if (web) items.push({ label: 'Guardar el destino como…', icon: 'download', click: () => descargaPreguntando(contents, p.linkURL) });
      sep();
    }
    if (p.mediaType === 'image' && p.srcURL) {
      // Se sube la imagen a Lens (ver el handler lens:buscar). Las blob: se
      // quedan fuera: viven solo dentro de la página y aquí no se pueden leer.
      if (/^(https?|data):/i.test(p.srcURL)) {
        items.push({
          label: 'Buscar la imagen con Google Lens', icon: 'scan-search',
          click: () => aRenderer('lens', { src: p.srcURL, pagina: contents.getURL() })
        });
      }
      items.push({ label: 'Copiar la imagen', icon: 'copy', click: () => contents.copyImageAt(p.x, p.y) });
      items.push({ label: 'Copiar la dirección de la imagen', icon: 'link', click: () => clipboard.writeText(p.srcURL) });
      items.push({ label: 'Guardar la imagen como…', icon: 'download', click: () => descargaPreguntando(contents, p.srcURL) });
      sep();
    }
    if (p.mediaType === 'video' || p.mediaType === 'audio') {
      const esVideo = p.mediaType === 'video';
      items.push({
        label: 'Descargar ' + (esVideo ? 'el video' : 'el audio') + ' con Rat Tool', icon: 'mouse',
        click: () => aRenderer('rat', { pagina: contents.getURL(), src: p.srcURL || '' })
      });
      if (esVideo) {
        items.push({ label: 'Ver en miniatura', icon: 'pip', accelerator: 'Alt+P', click: () => aRenderer('pip') });
      }
      if (p.srcURL && /^https?:/.test(p.srcURL)) {
        items.push({ label: 'Copiar la dirección ' + (esVideo ? 'del video' : 'del audio'), icon: 'link', click: () => clipboard.writeText(p.srcURL) });
      }
      sep();
    }

    items.push({ label: 'Atrás', icon: 'arrow-left', accelerator: 'Alt+Left', enabled: puedeAtras(contents), click: () => irAtras(contents) });
    items.push({ label: 'Adelante', icon: 'arrow-right', accelerator: 'Alt+Right', enabled: puedeAdelante(contents), click: () => irAdelante(contents) });
    items.push({ label: 'Recargar', icon: 'arrow-path', accelerator: 'F5', click: () => { navegacionDelUsuario(contents); contents.reload(); } });
    sep();
    items.push({ label: 'Añadir al acceso rápido', icon: 'square-plus', click: () => aRenderer('acceso', { url: contents.getURL(), titulo: contents.getTitle() }) });
    items.push({ label: 'Añadir a marcadores', icon: 'bookmark-add', accelerator: 'Ctrl+D', click: () => aRenderer('marcador', { url: contents.getURL(), titulo: contents.getTitle() }) });
    sep();
    items.push({ label: 'Pantalla completa', icon: 'arrows-pointing-out', accelerator: 'F11', click: () => aRenderer('pantalla-completa') });
    items.push({ label: 'Copiar la dirección de la página', icon: 'link', click: () => clipboard.writeText(contents.getURL()) });
    sep();
    // Con el atajo que hace lo mismo desde el teclado (los tres existen desde la parte «huecos»).
    items.push({ label: 'Guardar la página como…', icon: 'download', accelerator: 'Ctrl+S', click: () => guardarComo(contents, false) });
    items.push({ label: 'Guardar como PDF…', icon: 'file-text', click: () => guardarComo(contents, true) });
    items.push({ label: 'Imprimir…', icon: 'printer', accelerator: 'Ctrl+P', click: () => contents.print() });
    sep();
    items.push({ label: 'Código fuente de la página', icon: 'code', accelerator: 'Ctrl+U', click: () => host?.send('tab:open-url', { url: 'view-source:' + contents.getURL(), background: false }) });
    items.push({ label: 'Inspeccionar', icon: 'scan-search', accelerator: 'Ctrl+Shift+I', click: () => contents.inspectElement(p.x, p.y) });

    // Al elegir, el foco vuelve a la página (lo tenía el menú para el teclado).
    muestraMenu(host, items, { wc: contents.id, x: p.x, y: p.y, teclado: p.menuSourceType === 'keyboard' }, () => { if (!contents.isDestroyed()) contents.focus(); });
  });
}

/* Atajos con el foco DENTRO de la página: cuando el usuario ha hecho clic en la
   web, las teclas van al webview y el listener del renderer no las ve nunca (de
   ahí el "F5 funciona a veces sí y a veces no"). Aquí se cortan las RESERVADAS
   antes de que lleguen a la página y se reenvían a la interfaz; las demás las
   ve primero la web y, si no las usa, el webview se las pasa a la interfaz
   (ver src/atajos.js). Con los atajos desactivados solo quedan F11 y F12. */
function atajosDeWebview(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const cmd = atajos.comandoDe(input, { soloReservados: true, activos: settings.atajos !== false });
    if (!cmd) return;
    event.preventDefault();
    contents.hostWebContents?.send('ui:shortcut', cmd);
  });

  /* Ctrl+rueda = zoom, como en Chrome (2026-09-26, Dosa: "el control + scroll
     no permite hacer zoom in ni zoom out"). Medido antes del cambio: Ctrl+rueda
     real sobre una web no hacía NADA, ni zoom ni scroll. Chromium ya resuelve
     el gesto: si la página no se queda la rueda con Ctrl (Google Maps, Figma
     y compañía sí lo hacen, y ahí manda la web), la marca como zoom de página,
     no la desplaza y se la pasa al navegador, que en Electron llega como
     'zoom-changed' ('in'/'out')... y nadie lo escuchaba.
     Se usa este evento y no un listener de 'wheel' en webview-preload porque
     el preload tendría que llamar a preventDefault antes que la página: le
     robaría Ctrl+rueda a las webs que lo usan para lo suyo y dispararía el
     zoom por cada evento suelto de un touchpad de precisión; aquí llega un
     aviso por cada "muesca" ya acumulada. Va con el id del webContents para
     que el renderer haga zoom en la web que hay BAJO EL RATÓN (la otra mitad
     de la pantalla dividida, por ejemplo) y no en otra. No depende de
     settings.atajos: es un gesto de ratón, no un atajo de teclado. */
  contents.on('zoom-changed', (_e, dir) => {
    contents.hostWebContents?.send('ui:shortcut', (dir === 'in' ? 'rueda-in:' : 'rueda-out:') + contents.id);
  });

  /* F5 que no recargaba (2026-09-26, Dosa: "el F5 no reinicia o relodea la
     página"). Medido con F5 real y el foco dentro de la web: el main SÍ
     reenvía 'reload' y el renderer SÍ llama a wv.reload(), pero la página no
     se recargaba si tenía un 'beforeunload' registrado (editores, chats,
     formularios, reproductores… en cuanto has interactuado con ellos). Chrome
     pregunta "¿Volver a cargar el sitio?"; Electron, si nadie atiende
     'will-prevent-unload', CANCELA la navegación en silencio: ni recarga ni
     aviso. Pasaba igual con el botón de recargar, Atrás/Adelante o al escribir
     otra dirección en esa pestaña. Se hace lo de Chrome: preguntar, y si el
     usuario acepta, la navegación se repite sin pasar por el beforeunload.

     EL AVISO NO PUEDE SER SÍNCRONO (2026-11-03). Con showMessageBoxSync el
     proceso principal se quedaba parado mientras el aviso estuviera abierto, y
     por él pasan las peticiones de TODAS las pestañas (onBeforeRequest y
     compañía) y todo el IPC de la interfaz. Medido con una página con
     beforeunload y F5: la interfaz no contestaba ni a pedir la versión y otra
     pestaña no podía cargar nada, en todas las ventanas, hasta cerrar el aviso.
     Solo pasa en webs con las que ya has interactuado (sin gesto del usuario
     no hay beforeunload), por eso salía con el uso real y nunca en las pruebas
     con un perfil recién creado.
     Ahora la navegación se cancela, el aviso se abre sin bloquear y, si se
     acepta, se repite: la dirección que falló (escribir una URL, un marcador,
     atrás o adelante dejan un did-fail-load con ella) o, si no hubo ninguna,
     la recarga. Esa repetición ya no vuelve a preguntar. */
  let saltaAviso = false;     // la navegación que se repite tras aceptar
  let avisoAbierto = false;
  contents.on('did-start-navigation', (_e, _url, enDocumento, principal) => { if (principal && !enDocumento) saltaAviso = false; });
  contents.on('will-prevent-unload', (event) => {
    if (saltaAviso) { saltaAviso = false; event.preventDefault(); return; }
    if (avisoAbierto) return;
    avisoAbierto = true;
    let fallida = null;
    const alFallar = (_e, codigo, _desc, url, principal) => { if (principal && codigo === -3) fallida = url; };
    contents.on('did-fail-load', alFallar);
    const win = contents.hostWebContents ? BrowserWindow.fromWebContents(contents.hostWebContents) : null;
    const opciones = {
      type: 'question',
      buttons: ['Salir de la página', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Naviris',
      message: '¿Recargar o salir de esta página?',
      detail: 'Es posible que no se guarden los cambios que hayas hecho.'
    };
    (win ? dialog.showMessageBox(win, opciones) : dialog.showMessageBox(opciones)).then(({ response }) => {
      avisoAbierto = false;
      if (contents.isDestroyed()) return;
      contents.removeListener('did-fail-load', alFallar);
      if (response !== 0) return;
      saltaAviso = true;
      navegacionDelUsuario(contents);   // la pidió la persona: el freno no la cuenta
      if (fallida && fallida !== contents.getURL()) contents.loadURL(fallida).catch(() => {});
      else contents.reload();
    }).catch(() => { avisoAbierto = false; });
  });
}

/* Scrollbar propio para las webs (2026-08-13, peticion de Dosa: seguian
   saliendo barras por defecto en varias paginas). Gris translucido para que
   valga en claro y en oscuro, y sin flechas. Desde Chromium 121, una web que
   declara scrollbar-color (YouTube) anula los ::-webkit-scrollbar y vuelve la
   barra del sistema: por eso se fuerza a auto. scrollbar-width no se toca, para
   no destapar las barras que las webs ocultan a propósito (NAV-VIVO-11). */
const SCROLLBAR_CSS = `
  ::-webkit-scrollbar { width: 11px !important; height: 11px !important; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent !important; }
  ::-webkit-scrollbar-thumb {
    background: rgba(128,128,132,.42) !important;
    border: 3px solid transparent !important;
    border-radius: 999px !important;
    background-clip: content-box !important;
  }
  ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,132,.62) !important; background-clip: content-box !important; }
  ::-webkit-scrollbar-button { display: none !important; width: 0 !important; height: 0 !important; }
  *, *::before, *::after { scrollbar-color: auto !important; }
`;

/* La marca del foco de serie (2026-08-29, peticion de Dosa: "que sea muchisimo
   mas imperceptible, que no sea de un color, solo blanco, nada mas, o gris").
   El anillo que pinta Chromium por su cuenta es grueso y tirando a dorado, y
   sobre un fondo negro -el reproductor de MOOVIN- canta mas que el propio
   control. Aqui se cambia por una linea gris de 1 px, del mismo gris del
   scrollbar por la misma razon: vale igual en claro y en oscuro.

   Va con :where(), que no suma especificidad: asi le gana al estilo de serie
   del navegador (basta con ser CSS de autor) pero PIERDE contra cualquier
   regla de la propia web. Una pagina que se haya disenado su foco se lo
   queda. */
const FOCO_CSS = `
  :where(:focus-visible) {
    outline: 1px solid rgba(128,128,132,.9);
    outline-offset: 2px;
  }
`;

/* Atrás y adelante de una pestaña dormida (NAV-VIVO-07). Dormir quita el
   webview para soltar su proceso, y el nuevo nacía sin historial. Ahora, antes
   de dormir, la interfaz pide las entradas del webview ('wv:historial'); al
   despertar las deja apuntadas ('wv:historial-pendiente') y will-attach-webview
   hace que el webview nuevo las restaure en vez de cargar la URL a pelo. */
const historialPendiente = new Map();   // id de la interfaz -> [{ url, entries, index, ts }]
let historialAlCrear = null;            // el del webview que se está creando ahora mismo
const urlNormal = (u) => { try { return new URL(u).href; } catch { return String(u || ''); } };
// Son síncronos y returnValue se asigna UNA sola vez: la primera asignación ya contesta.
function historialDe(e, id) {
  if (!esUI(e)) return null;
  try {
    const wc = webContents.fromId(Number(id));
    if (!wc || wc.getType() !== 'webview' || wc.hostWebContents?.id !== e.sender.id) return null;
    return { entries: wc.navigationHistory.getAllEntries(), index: wc.navigationHistory.getActiveIndex() };
  } catch { return null; }   // ya cerrado
}
function apuntaHistorial(e, url, h) {
  if (!esUI(e) || typeof url !== 'string' || !h || !Array.isArray(h.entries)) return false;
  const valida = (x) => x && typeof x.url === 'string' && typeof x.title === 'string' && (x.pageState == null || typeof x.pageState === 'string');
  if (!h.entries.length || h.entries.length > 50 || !h.entries.every(valida)) return false;
  if (!Number.isInteger(h.index) || h.index < 0 || h.index >= h.entries.length) return false;
  const id = e.sender.id;
  if (!historialPendiente.has(id)) e.sender.once('destroyed', () => historialPendiente.delete(id));
  // Lo que no llegó a usarse en 10 s (un webview que no se montó) se descarta.
  const lista = (historialPendiente.get(id) || []).filter((p) => Date.now() - p.ts < 10000);
  lista.push({ url: urlNormal(url), entries: h.entries, index: h.index, ts: Date.now() });
  historialPendiente.set(id, lista);
  return true;
}
ipcMain.on('wv:historial', (e, id) => { e.returnValue = historialDe(e, id); });
ipcMain.on('wv:historial-pendiente', (e, url, h) => { e.returnValue = apuntaHistorial(e, url, h); });
// El AutoClaim de Twitch (la pestaña que farmea y el webview que reclama) tiene que
// seguir contando aunque no se vea: el preload de esa página pide quitarle el freno
// de fondo mientras está encendido (ver backgroundThrottling en will-attach-webview).
ipcMain.on('wv:sin-freno', (e, on) => {
  if (e.sender.getType() === 'webview' && e.senderFrame === e.sender.mainFrame) e.sender.setBackgroundThrottling(!on);
});

/* ===== FRENO CONTRA LOS BUCLES DE RECARGAS =====
   La cuenta vive en freno-recargas.js (con sus pruebas). Aquí solo se engancha
   a cada pestaña: lo que el freno corta se para con stop() y, al pasarse del
   tope, la interfaz avisa con «Reintentar». Las navegaciones que pide el
   usuario llegan antes por 'tab:nav-usuario' y no cuentan. */
const frenos = new Map(); // id del webContents -> { freno, contents }
function frenoDeRecargas(contents) {
  const freno = crearFreno();
  const para = () => setImmediate(() => { if (!contents.isDestroyed()) contents.stop(); });
  contents.on('did-start-navigation', (_e, url, enDocumento, principal) => {
    if (!principal || enDocumento) return;
    const r = freno.navega(url, Date.now());
    if (r === 'sigue') return;
    para();
    if (r !== 'frena') return;
    let k = url; try { const u = new URL(url); k = u.origin + u.pathname; } catch { /* nada */ }
    console.log('[Naviris] Bucle de recargas detenido en', k);
    contents.hostWebContents?.send('tab:bucle', { wc: contents.id, url: k });
  });
  const id = contents.id;
  frenos.set(id, { freno, contents });
  contents.once('destroyed', () => frenos.delete(id));
}
const navegacionDelUsuario = (contents) => frenos.get(contents.id)?.freno.usuario(Date.now());
ipcMain.on('tab:reintenta-bucle', (e, id) => {
  if (!esUI(e)) return;
  const f = frenos.get(id);
  if (!f || f.contents.isDestroyed()) return;
  f.freno.reintenta();
  navegacionDelUsuario(f.contents);
  f.contents.reload();
});
// Síncrono a propósito: la interfaz lo manda justo antes de reload()/src y
// tiene que estar apuntado cuando main vea esa navegación.
ipcMain.on('tab:nav-usuario', (e, id) => {
  e.returnValue = true;
  if (!esUI(e)) return;
  const f = frenos.get(Number(id));
  if (f && !f.contents.isDestroyed() && f.contents.hostWebContents?.id === e.sender.id) navegacionDelUsuario(f.contents);
});

/* ===== ALERT, CONFIRM Y PROMPT DENTRO DE LA PESTAÑA (2026-11-03) =====
   Los modales nativos colgaban la ventana entera (ver disableDialogs). Ahora
   webview-preload.js cambia window.alert/confirm/prompt de la página por unos
   que preguntan aquí con una llamada SÍNCRONA: así la página espera la
   respuesta como con los de verdad (confirm devuelve lo que elijas), pero lo
   único que se para es el proceso de ESA página. La interfaz pinta el diálogo
   encima de su pestaña, sin tapar el resto del navegador, y el proceso
   principal sigue libre porque la respuesta se da cuando llega, sin esperar.
   Se cierra solo si la pestaña se cierra o navega a otra página. Con «No dejar
   que esta página muestre más avisos», el resto de avisos de ese documento
   contestan al momento sin preguntar (alert nada, confirm false, prompt null).
   Lo mismo sirve para preguntar antes de abrir un mailto: o un magnet: con una
   aplicación del equipo (ver 'openExternal' en los permisos). */
const dialogos = new Map();     // id -> { host, fin }
const silenciadas = new Set();  // webContents cuyo documento ya no puede preguntar
let dialogoSeq = 0;
function preguntaEnPestana(wc, datos) {
  return new Promise((resuelve) => {
    const host = wc.hostWebContents;
    if (!host || host.isDestroyed()) { resuelve({ ok: false }); return; }
    const id = 'dlg' + (++dialogoSeq);
    let hecho = false;
    const alNavegar = (_e, _url, enDocumento, principal) => { if (principal && !enDocumento) fin({ ok: false }); };
    const alCerrar = () => fin({ ok: false });
    function fin(r) {
      if (hecho) return;
      hecho = true;
      dialogos.delete(id);
      if (!wc.isDestroyed()) { wc.removeListener('did-start-navigation', alNavegar); wc.removeListener('destroyed', alCerrar); }
      if (!host.isDestroyed()) host.send('tab:dialogo-fin', id);
      resuelve(r);
    }
    wc.on('did-start-navigation', alNavegar);
    wc.once('destroyed', alCerrar);
    dialogos.set(id, { host, fin, wcId: wc.id });
    host.send('tab:dialogo', { id, wc: wc.id, origen: originOf(wc.getURL()), ...datos });
  });
}
function silencia(wc) {
  if (silenciadas.has(wc.id)) return;
  const id = wc.id;
  silenciadas.add(id);
  // Vale para el documento: al cargar otra página (o recargar) vuelve a poder preguntar.
  wc.once('did-navigate', () => silenciadas.delete(id));
  wc.once('destroyed', () => silenciadas.delete(id));
}
ipcMain.on('wv:dialogo', (e, d) => {
  const wc = e.sender;
  const tipo = d && d.tipo;
  if (wc.getType() !== 'webview' || !['alert', 'confirm', 'prompt'].includes(tipo) || silenciadas.has(wc.id)) { e.returnValue = { ok: false }; return; }
  const texto = String(d.texto ?? '').slice(0, 3000);
  const valor = tipo === 'prompt' ? String(d.valor ?? '').slice(0, 3000) : undefined;
  preguntaEnPestana(wc, { tipo, texto, valor }).then((r) => {
    if (r.silenciar && !wc.isDestroyed()) silencia(wc);
    try { e.returnValue = { ok: !!r.ok, valor: typeof r.valor === 'string' ? r.valor : null }; } catch { /* la página ya no está */ }
  });
});
ipcMain.on('tab:dialogo-respuesta', (e, r) => {
  const d = r && dialogos.get(r.id);
  if (!d || d.host !== e.sender || !esUI(e)) return;
  d.fin({ ok: !!r.ok, valor: typeof r.valor === 'string' ? r.valor.slice(0, 10000) : null, silenciar: !!r.silenciar });
});
// mailto:, tel:, magnet:… (ver externos.js). Solo desde una pestaña y solo los esquemas de la lista.
function pideAbrirFuera(wc, url, callback) {
  const aplicacion = aplicacionPara(url);
  if (!aplicacion || !wc || wc.isDestroyed() || wc.getType() !== 'webview') { callback(false); return; }
  preguntaEnPestana(wc, { tipo: 'externo', texto: url, aplicacion }).then((r) => callback(!!r.ok));
}

/* ===== MENÚ DE LOS CAMPOS DE LA INTERFAZ (2026-11-03) =====
   El clic derecho en la barra de direcciones, en buscar en la página o en
   cualquier campo de Naviris no sacaba nada: ni Copiar ni Pegar. Lo pide el
   renderer (sabe si es la barra, si hay selección y dónde se hizo el clic) y
   se pinta como el de las páginas (muestraMenu). En la barra se añade «Pegar e
   ir» o «Pegar y buscar» según lo que haya en el portapapeles, como en
   Chrome. Las acciones van sobre el campo con el foco: la interfaz se lo
   devuelve antes de pedir la acción. */
const pareceDireccion = (t) => !/\s/.test(t) && (/^[a-z][a-z0-9+.-]*:/i.test(t) || /^[^/?#]+\.[^/?#]+/.test(t) || /^localhost(?=[:/?#]|$)/i.test(t));
ipcMain.on('ui:menu-campo', soloUI((e, d = {}) => {
  const wc = e.sender;
  const conSeleccion = !!d.seleccion;
  const items = [
    { label: 'Deshacer', icon: 'undo-2', accelerator: 'Ctrl+Z', click: () => wc.undo() },
    { label: 'Rehacer', icon: 'redo-2', accelerator: 'Ctrl+Y', click: () => wc.redo() },
    { type: 'separator' },
    { label: 'Cortar', icon: 'scissors', accelerator: 'Ctrl+X', enabled: conSeleccion, click: () => wc.cut() },
    { label: 'Copiar', icon: 'copy', accelerator: 'Ctrl+C', enabled: conSeleccion, click: () => wc.copy() },
    { label: 'Pegar', icon: 'clipboard', accelerator: 'Ctrl+V', click: () => wc.paste() }
  ];
  if (d.urlbar) {
    let texto = '';
    try { texto = clipboard.readText().trim(); } catch { /* nada */ }
    if (texto && texto.length <= 2000) {
      items.push({ label: pareceDireccion(texto) ? 'Pegar e ir' : 'Pegar y buscar', icon: pareceDireccion(texto) ? 'arrow-right' : 'magnifying-glass', click: () => wc.send('ui:pegar-e-ir', texto) });
    }
  }
  items.push(
    { label: 'Eliminar', icon: 'trash', enabled: conSeleccion, click: () => wc.delete() },
    { type: 'separator' },
    { label: 'Seleccionar todo', icon: 'text-cursor', accelerator: 'Ctrl+A', enabled: !d.vacio, click: () => wc.selectAll() }
  );
  muestraMenu(wc, items, { x: Number(d.x) || 0, y: Number(d.y) || 0, teclado: !!d.teclado });
}));

/* ===== VENTANAS EMERGENTES CON window.opener (2026-11-03) =====
   Todo window.open acababa en una pestaña nueva abierta desde la interfaz, sin
   relación con la página que la pidió: window.open devolvía null y la página
   nueva no tenía window.opener. Así se rompen los inicios de sesión en
   ventanita («Iniciar sesión con Google», Twitch, Discord, PayPal...): la
   ventana de login termina mandando el resultado con window.opener.postMessage
   y la web de origen se queda esperando para siempre. Medido con una página de
   prueba: el padre veía null y la hija «opener: no». Con una cuenta se pasa por
   ahí a menudo; con un perfil de pruebas recién creado, nunca.
   Las que piden ventana (disposition 'new-window': window.open con tamaño o
   características) se abren como ventana de verdad, con su opener y en la
   misma sesión (cookies del contenedor o de la privada incluidas); about:blank
   también, porque muchas abren la ventana vacía y la dirigen después. Los
   enlaces y el window.open sin características siguen yendo a una pestaña.
   La ventana lleva el mismo preload y las mismas restricciones que una
   pestaña, y sus propias emergentes siguen esta misma regla.
   Sin un gesto reciente de la persona no se abre nada (ver src/emergentes.js);
   `pestana` es el id del webview de la pestaña de la que sale todo, para el aviso.
   Lo bloqueado queda en `emergPendientes` para abrirlo si se permite el sitio. */
const emergPendientes = emergentes.creaPendientes();
function ventanasDe(contents, host, pestana = contents.id) {
  const gestos = emergentes.creaGestos();
  // 'input-event' no ve lo que cae en un iframe de otro sitio (medido): el ratón y
  // el teclado de todos los marcos llegan por los 'before-…'; los toques, por el primero.
  const apunta = (_e, ev) => gestos.apunta(ev);
  contents.on('input-event', apunta);
  contents.on('before-mouse-event', apunta);
  contents.on('before-input-event', apunta);
  const id = contents.id;
  contents.on('did-navigate', () => emergPendientes.olvida(id));
  contents.once('destroyed', () => emergPendientes.olvida(id));
  contents.setWindowOpenHandler((detalles) => {
    const { url, disposition } = detalles;
    const sitio = contents.getURL();
    if (settings.permissions[emergentes.clavePermiso(sitio)] !== 'allow' && !gestos.gasta()) {
      let origen = ''; try { origen = new URL(sitio).origin; } catch { /* nada */ }
      if (origen && host && !host.isDestroyed()) {
        emergPendientes.apunta(pestana, id, origen, detalles);
        host.send('tab:emergente-bloqueada', { wc: pestana, origen });
      }
      return { action: 'deny' };
    }
    const web = /^https?:/i.test(url);
    if (disposition === 'new-window' && (web || url === 'about:blank')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: '#ffffff',
          webPreferences: {
            preload: path.join(__dirname, 'webview-preload.js'),
            sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
            webSecurity: true, allowRunningInsecureContent: false, disableDialogs: true
          }
        }
      };
    }
    // clic central / "abrir en pestaña nueva" => segundo plano; el resto en primer plano
    // `origen` es el webContents que abrio el enlace: con eso la pestaña
    // nueva se coloca justo detras de la suya y no al final de la barra.
    if (web && host && !host.isDestroyed()) host.send('tab:open-url', { url, background: disposition === 'background-tab', origen: contents.id });
    return { action: 'deny' };
  });
  contents.on('did-create-window', (win) => {
    win.removeMenu();
    ventanasDe(win.webContents, host, pestana);
  });
}
/* «Permitir» en el aviso de la barra: ese sitio abre emergentes sin gesto, y
   lo que se le bloqueó en esa pestaña (`wc`, el id de su webview) se abre ya,
   en orden, repitiendo su window.open en la página que lo pidió (ver
   codigoAbrir). El mundo aislado es uno propio, no el del preload (999). */
const MUNDO_EMERGENTES = 1031;
ipcMain.on('emergentes:permitir', soloUI((_e, origen, wc) => {
  const clave = emergentes.clavePermiso(origen);
  if (!clave) return;
  settings.permissions[clave] = 'allow';
  saveSettings(settings);
  for (const p of emergPendientes.saca(Number(wc), origen)) {
    const desde = webContents.fromId(p.desde);
    if (desde && !desde.isDestroyed()) desde.executeJavaScriptInIsolatedWorld(MUNDO_EMERGENTES, [{ code: emergentes.codigoAbrir(p) }], true).catch(() => {});
  }
}));

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    frenoDeRecargas(contents);
    // Pestaña que despierta: restaura su historial (ver historialPendiente). Si no
    // se puede, carga su URL como antes, para no dejarla en blanco.
    if (historialAlCrear) {
      const h = historialAlCrear; historialAlCrear = null;
      contents.once('did-attach', () => {
        const aPelo = () => { if (!contents.isDestroyed() && !contents.getURL()) contents.loadURL(h.url).catch(() => {}); };
        try { contents.navigationHistory.restore({ entries: h.entries, index: h.index }).catch(aPelo); } catch { aPelo(); }
      });
    }
    suppressWebAuthn(contents);
    atajosDeWebview(contents);
    // Página que no contesta (un bucle de JavaScript): la interfaz ofrece cerrarla.
    // Con un diálogo suyo abierto no cuenta: está esperando la respuesta, no colgada.
    contents.on('unresponsive', () => {
      if ([...dialogos.values()].some((d) => d.wcId === contents.id)) return;
      contents.hostWebContents?.send('tab:colgada', { wc: contents.id, colgada: true });
    });
    contents.on('responsive', () => contents.hostWebContents?.send('tab:colgada', { wc: contents.id, colgada: false }));
    menuContextual(contents);
    ventanasDe(contents, contents.hostWebContents);
    /* Scriptlets de las listas en los IFRAMES (2026-11-03). El preload solo corre
       en el marco principal, así que los `##+js(...)` nunca llegaban a un iframe:
       los anuncios en iframe, los reproductores incrustados (el de YouTube) y los
       avisos anti-bloqueador que viven en uno se quedaban sin ellos. Se ponen en
       cuanto se confirma la navegación del iframe, con la URL del iframe (como
       Brave) y la lista blanca de la pestaña (como la red). Los avisos de cookies
       NO se tocan: la lista que los cerraba ya no se baja (LISTAS_FUERA en
       adblock.js). */
    contents.on('did-frame-navigate', (_e, url, _codigo, _estado, principal, proceso, ruta) => {
      if (principal || !settings.adblockEnabled || !/^https?:/i.test(url) || isWhitelisted(contents.getURL())) return;
      const { scriptlets } = braveAdblock.arranqueDe(url);
      if (!scriptlets) return;
      try { webFrameMain.fromId(proceso, ruta)?.executeJavaScript(scriptlets).catch(() => {}); } catch { /* el marco ya no está */ }
    });
    // Inyecta el saltador de anuncios de YouTube y el revelado de X
    contents.on('dom-ready', () => {
      // Scrollbar de Naviris en TODAS las paginas. El Fluent de Chromium solo
      // aplica donde el sitio no trae el suyo, y muchos lo traen: se veian
      // barras gruesas ajenas a la estetica. Este es fino, redondeado y
      // TRASLUCIDO EN GRIS, que es lo unico que funciona igual sobre fondo
      // claro y oscuro sin adivinar el tema de cada web. Va con !important
      // porque compite con el CSS del sitio.
      contents.insertCSS(SCROLLBAR_CSS).catch(() => {});
      contents.insertCSS(FOCO_CSS).catch(() => {});
      let host = '';
      try { host = new URL(contents.getURL()).hostname; } catch { return; }
      // El interruptor del bloqueador Y la lista blanca, como en la red y en el preload.
      const bloquea = settings.adblockEnabled && !isWhitelisted(contents.getURL());
      // Ocultado cosmético de las listas de Brave. Los scriptlets de esas listas
      // NO van aquí: los pone el preload al empezar el documento (ver
      // 'preload:arranque'). Aquí llegaban tarde, y dejarlos TAMBIÉN aquí los
      // pondría dos veces en cada documento: varios parchean JSON.stringify y,
      // encadenados, multiplican las llamadas (es lo que dejó a Ghostery con la
      // CPU al 80-90 % en YouTube). Una sola inyección por documento.
      if (bloquea) {
        const cos = braveAdblock.cosmeticsFor(contents.getURL());
        if (cos && cos.css) contents.insertCSS(cos.css).catch(() => {});
      }
      // Antes esto miraba solo el interruptor: con youtube.com en la lista blanca se
      // seguían inyectando el respaldo y el CSS, y el respaldo seguía borrando el
      // aviso anti-bloqueador justo a quien había decidido permitir los anuncios.
      if (bloquea && /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) {
        contents.executeJavaScript(YT_ADSKIP, true).catch(() => {});
        contents.insertCSS(YT_ADCSS).catch(() => {});
      }
      if (settings.xRevealSensitive && /(^|\.)(twitter\.com|x\.com)$/.test(host)) {
        contents.executeJavaScript(X_REVEAL, true).catch(() => {});
      }
      if (settings.adblockEnabled && /(^|\.)twitch\.tv$/.test(host)) {
        contents.executeJavaScript(TWITCH_ADHIDE, true).catch(() => {});
      }
      // Addons de contenido: se inyectan en los sitios que declaran en "matches"
      for (const [aid, meta] of Object.entries(settings.addons || {})) {
        if (!meta.enabled || meta.kind !== 'content' || !addonCode[aid]) continue;
        if ((meta.matches || []).some((m) => host === m || host.endsWith('.' + m))) {
          contents.executeJavaScript(addonCode[aid], true).catch(() => {});
        }
      }
      // Twitch: el auto-reclamo vive ahora en webview-preload.js (puede avisar a la UI)
    });
  }
});

// ---------- IPC ----------
const winOf = (e) => BrowserWindow.fromWebContents(e.sender);

// Defensa en profundidad: los canales sensibles solo se atienden si quien llama
// es la INTERFAZ de Naviris (index.html cargado por file://), nunca un webview
// con una web dentro. Hoy las webs ya no pueden hablar por IPC (sandbox +
// contextIsolation + sin nodeIntegration), pero si un fallo futuro filtrara
// ipcRenderer a una página, esto impide que pida contraseñas o tarjetas.
const uiPath = path.join(__dirname, 'index.html');
function esUI(e) {
  try {
    const wc = e.sender;
    if (wc.getType() === 'webview') return false;                 // contenido de un sitio: nunca
    const u = new URL(wc.getURL());
    return u.protocol === 'file:' && decodeURIComponent(u.pathname).replace(/^\//, '').replace(/\//g, path.sep).toLowerCase() === uiPath.toLowerCase();
  } catch { return false; }
}
// Envuelve un handler para que solo responda a la interfaz. Es una función
// declarada (no const) porque los permisos, más arriba, ya la usan al cargar.
function soloUI(fn) {
  return (e, ...args) => {
    if (!esUI(e)) { console.warn('[Naviris] IPC sensible rechazado desde', (() => { try { return e.sender.getURL(); } catch { return 'origen desconocido'; } })()); return { ok: false, error: 'origen no autorizado' }; }
    return fn(e, ...args);
  };
}

ipcMain.on('win:minimize', (e) => winOf(e)?.minimize());
ipcMain.on('win:maximize', (e) => { const w = winOf(e); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.on('win:close', (e) => winOf(e)?.close());
// F11: pantalla completa de la VENTANA (distinto del fullscreen del vídeo)
ipcMain.on('win:fullscreen', (e) => { const w = winOf(e); if (w) w.setFullScreen(!w.isFullScreen()); });
ipcMain.on('win:new-private', () => createWindow(true));
/* Sacar una pestaña de la barra abre una ventana nueva con esa direccion.
   La ventana tarda en montar su interfaz, asi que la URL se guarda y se le
   manda cuando ella avisa de que ya esta lista ('ui:listo'). Con url null la
   ventana abre el hub (Ctrl+N). Nace como «sacada»: no restaura ni pisa la
   sesión de la principal. */
const urlPendiente = new Map();   // id de ventana -> [{ url, contenedor }] que tiene que abrir al montarse
function ventanaConUrl(url, privada, contenedor = null) {
  const win = createWindow(privada, false, true);
  if (!win) return null;
  urlPendiente.set(win.id, [{ url, contenedor }]);
  return win;
}
const esVentanaPrivada = (wc) => { try { return new URL(wc.getURL()).searchParams.get('private') === '1'; } catch { return false; } };
ipcMain.on('win:sacar-pestana', (e, url, contenedor) => {
  if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
  // La pestaña sale con su contenedor (su id; la ventana nueva lo busca en los ajustes).
  if (typeof contenedor !== 'string' || !/^[a-z0-9]{1,24}$/.test(contenedor)) contenedor = null;
  // Si sale de una ventana privada, la nueva tambien lo es: no se saca una
  // pestaña privada a una ventana normal, que dejaria rastro.
  ventanaConUrl(url, esVentanaPrivada(e.sender), contenedor);
});
// Ctrl+N y «Nueva ventana» del menú: una ventana normal con el hub, como Chrome
// (también desde una privada).
ipcMain.on('win:nueva', soloUI(() => ventanaConUrl(null, false)));

ipcMain.handle('settings:get', soloUI(() => settings));
// ---------- Información del sitio (popover del candado) ----------
// Solo las dos particiones reales de Naviris: nada de leer cookies de otros perfiles
const PARTICIONES_VALIDAS = new Set([PART_NORMAL, PART_PRIVATE]);
/* ===== Contenedores =====
   Un contenedor es una sesión con su propio bote de cookies: sirve para tener
   dos cuentas del mismo sitio abiertas a la vez sin que se pisen. La lista vive
   en los ajustes para que sobreviva al reinicio, y cada partición se prepara
   igual que la normal antes de usarse. */
const preparadas = new Set();
function contenedoresGuardados() { return (settings.contenedores || []).map((c) => c.particion); }
function preparaContenedor(particion) {
  if (!/^persist:(cont|esp)-/.test(particion)) return null;
  PARTICIONES_VALIDAS.add(particion);
  const ses = session.fromPartition(particion);
  if (!preparadas.has(particion)) {
    preparadas.add(particion);
    setupSession(ses);
    setupPermissions(ses);
  }
  return ses;
}
ipcMain.handle('cont:prepara', soloUI((_e, particion) => {
  if (typeof particion !== 'string' || !/^persist:(cont|esp)-[a-z0-9]{1,24}$/.test(particion)) return { ok: false };
  preparaContenedor(particion);
  return { ok: true };
}));
/* ===== Espacios protegidos =====
   Un espacio protegido es PERMANENTE: su sesión, su historial y sus marcadores
   siguen ahí al cerrar Naviris y al reiniciar el equipo. Para entrar pide un
   código, una vez por sesión de Naviris, y el mismo código hace falta para
   borrarlo (que se lleva todo por delante).

   QUÉ PROTEGE Y QUÉ NO, dicho claro:
   - Su historial y sus marcadores se guardan CIFRADOS con una clave derivada
     del código (scrypt + AES-256-GCM). Sin el código no se pueden leer, ni
     desde otro programa ni sacando el disco. Perder el código es perderlos:
     no hay puerta de atrás, y eso es justo lo que lo hace valer.
   - Sus cookies y sesiones las guarda Chromium en su partición, SIN cifrar,
     igual que hace Chrome con todo. O sea: el código impide entrar desde la
     interfaz, no protege ese trozo contra alguien que se lleve el disco.
     Prometer lo contrario sería mentir.

   El código nunca se guarda: se guarda la sal, y comprobarlo es intentar
   descifrar. Si el descifrado cuadra (GCM lleva su propia comprobación), el
   código era el bueno. */
const clavesEnMemoria = new Map();   // id -> clave derivada; al cerrar, se olvida
const DIR_ESP = () => path.join(app.getPath('userData'), 'espacios');
const archivoEsp = (id) => path.join(DIR_ESP(), id + '.dat');

function derivaClave(codigo, salBase64) {
  return crypto.scryptSync(String(codigo), Buffer.from(salBase64, 'base64'), 32, { N: 16384, r: 8, p: 1 });
}
function cifra(clave, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), datos: datos.toString('base64') });
}
function descifra(clave, texto) {
  const j = JSON.parse(texto);
  const d = crypto.createDecipheriv('aes-256-gcm', clave, Buffer.from(j.iv, 'base64'));
  d.setAuthTag(Buffer.from(j.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(j.datos, 'base64')), d.final()]).toString('utf8'));
}
function escribeEsp(id, clave, obj) {
  fs.mkdirSync(DIR_ESP(), { recursive: true });
  escribeSeguro(archivoEsp(id), cifra(clave, obj));
}
// El id acaba en un nombre de archivo (archivoEsp): solo el formato que genera la interfaz.
const espacioDe = (id) => (typeof id === 'string' && /^[a-z0-9]{1,24}$/.test(id) ? (settings.espacios || []).find((e) => e.id === id) : undefined);

ipcMain.handle('esp:bloquea', soloUI((_e, { id, clave } = {}) => {
  const esp = espacioDe(id);
  if (!esp) return { ok: false, error: 'Ese espacio ya no existe' };
  if (esp.bloqueado) return { ok: false, error: 'Ese espacio ya está protegido' };
  if (!clave || String(clave).length < 4) return { ok: false, error: 'La contraseña necesita al menos 4 caracteres' };
  esp.sal = crypto.randomBytes(16).toString('base64');
  esp.bloqueado = true;
  esp.particion = esp.particion || ('persist:esp-' + id);
  const derivada = derivaClave(clave, esp.sal);
  clavesEnMemoria.set(id, derivada);
  escribeEsp(id, derivada, { historial: [], marcadores: [] });
  preparaContenedor(esp.particion);
  saveSettings(settings);
  // Se devuelve el espacio ENTERO: el renderer tiene su propia copia de la
  // lista y, si no se la lleva, el siguiente guardado borraria la sal y el
  // espacio quedaria imposible de abrir tras reiniciar.
  return { ok: true, espacio: JSON.parse(JSON.stringify(esp)) };
}));

ipcMain.handle('esp:desbloquea', soloUI((_e, { id, clave } = {}) => {
  const esp = espacioDe(id);
  if (!esp || !esp.bloqueado) return { ok: true, datos: null };
  const derivada = derivaClave(clave, esp.sal || '');
  let datos;
  try { datos = descifra(derivada, fs.readFileSync(archivoEsp(id), 'utf8')); }
  catch { return { ok: false, error: 'Contraseña incorrecta' }; }
  clavesEnMemoria.set(id, derivada);
  preparaContenedor(esp.particion);
  return { ok: true, datos };
}));

// Historial y marcadores del espacio: solo con la clave ya en memoria.
ipcMain.handle('esp:datos', soloUI((_e, id) => {
  const clave = clavesEnMemoria.get(id);
  if (!clave) return { ok: false, error: 'bloqueado' };
  try { return { ok: true, datos: descifra(clave, fs.readFileSync(archivoEsp(id), 'utf8')) }; }
  catch { return { ok: true, datos: { historial: [], marcadores: [] } }; }
}));
ipcMain.handle('esp:guarda', soloUI((_e, { id, datos } = {}) => {
  const clave = clavesEnMemoria.get(id);
  if (!clave) return { ok: false, error: 'bloqueado' };
  try { escribeEsp(id, clave, datos || {}); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
}));

ipcMain.handle('esp:desbloqueados', soloUI(() => [...clavesEnMemoria.keys()]));

/* Borrar un espacio protegido exige el MISMO código y se lleva TODO: su
   historial y marcadores cifrados, y las cookies y la caché de su partición. */
ipcMain.handle('esp:borra', soloUI(async (_e, { id, clave } = {}) => {
  const esp = espacioDe(id);
  if (!esp) return { ok: true };
  if (esp.bloqueado) {
    const derivada = derivaClave(clave, esp.sal || '');
    try { descifra(derivada, fs.readFileSync(archivoEsp(id), 'utf8')); }
    catch { return { ok: false, error: 'Contraseña incorrecta' }; }
    try { fs.unlinkSync(archivoEsp(id)); } catch { /* ya no estaba */ }
  }
  // Solo la partición propia del espacio, nunca la normal ni la de un contenedor.
  if (/^persist:esp-/.test(esp.particion || '')) { try { await session.fromPartition(esp.particion).clearStorageData(); } catch { /* nada */ } }
  settings.espacios = (settings.espacios || []).filter((e) => e.id !== id);
  saveSettings(settings);
  clavesEnMemoria.delete(id);
  return { ok: true };
}));

ipcMain.handle('site:data', soloUI(async (_e, { url, partition }) => {
  try {
    if (!PARTICIONES_VALIDAS.has(partition)) return { ok: false };
    const host = new URL(url).hostname.replace(/^www\./, '');
    const cookies = await session.fromPartition(partition).cookies.get({ domain: host });
    return { ok: true, cookies: cookies.length };
  } catch { return { ok: false }; }
}));
// ¿Hay sesión de Spotify iniciada? Se mira la cookie de login real (sp_dc) en
// la partición normal — las cookies de consentimiento no cuentan. Lo usa el
// dock de Spotify del sidebar para mostrarse solo a quien tiene cuenta.
// Bandeja de Gmail para el widget de correo: el feed atom nativo de Gmail
// responde con las cookies de la sesión del usuario. Se pide desde MAIN con la
// sesión de la partición normal — sin CORS ni CSP del renderer de por medio.
ipcMain.handle('gmail:feed', soloUI(async () => {
  try {
    const ses = session.fromPartition(PART_NORMAL);
    const r = await ses.fetch('https://mail.google.com/mail/feed/atom', { credentials: 'include' });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, xml: await r.text() };
  } catch (e) { return { ok: false, error: String(e && e.message) }; }
}));
/* ---------- Google Lens (2026-08-12) ----------
   Aquí SOLO se consiguen los bytes de la imagen; la subida la hace el
   renderer desde una página de Google (ver buscarConLens en renderer/buscar.js).

   Por qué así, que costó averiguarlo:
   · Pasarle la URL a Lens (lens.google.com/uploadbyurl) YA NO FUNCIONA:
     responde "no hay ninguna imagen en la URL" hasta con imágenes públicas.
     Comprobado también en Chrome, no es cosa de Naviris. Chrome y Opera GX
     suben los bytes, no la dirección.
   · Subirlos desde el proceso principal tampoco vale: sin un origen real,
     Chromium trata la petición como de otro sitio, no manda las cookies de
     Google y Lens contesta con consent.google.com; y poner Origin a mano la
     tumba directamente (ERR_FAILED, es cabecera prohibida).
   Bajar la imagen sí tiene que ser aquí: con la sesión del navegador van las
   cookies del sitio y el referer, así funcionan también las imágenes que solo
   se sirven con sesión iniciada, y no hay CORS que valga. */
ipcMain.handle('lens:imagen', soloUI(async (_e, { src, pagina } = {}) => {
  try {
    if (!src) return { ok: false, error: 'sin imagen' };
    let bytes, tipo = 'image/jpeg';
    if (/^data:/i.test(src)) {
      const m = src.match(/^data:([^;,]+)?[^,]*,(.*)$/s);
      if (!m) return { ok: false, error: 'imagen ilegible' };
      tipo = m[1] || tipo;
      bytes = Buffer.from(decodeURIComponent(m[2]), /;base64/i.test(src) ? 'base64' : 'utf8');
    } else {
      const ses = session.fromPartition(PART_NORMAL);
      const pide = (headers) => ses.fetch(src, { credentials: 'include', headers });
      let img;
      try { img = await pide(pagina ? { Referer: pagina } : {}); }
      catch { img = await pide({}); }   // algunos sitios rechazan el referer
      if (!img.ok) return { ok: false, error: 'no se pudo descargar la imagen' };
      tipo = (img.headers.get('content-type') || tipo).split(';')[0].trim();
      bytes = Buffer.from(await img.arrayBuffer());
    }
    if (!bytes || !bytes.length) return { ok: false, error: 'la imagen vino vacía' };
    if (!/^image\//i.test(tipo)) return { ok: false, error: 'el enlace no devolvió una imagen' };
    return { ok: true, b64: bytes.toString('base64'), tipo };
  } catch (e) { return { ok: false, error: String(e && e.message) }; }
}));
// Memoria de un proceso en KB: la PRIVADA, la que enseña el administrador de
// tareas. workingSetSize cuenta también las páginas compartidas en cada proceso
// y el total salía unas cuatro veces más alto (NAV-VIVO-08). Fuera de Windows
// no hay privateBytes y se usa el working set.
const memKb = (p) => (p.memory && (p.memory.privateBytes ?? p.memory.workingSetSize)) || 0;
// Métricas para el widget Monitor: memoria del sistema + CPU/RAM de Naviris
// (app.getAppMetrics agrega todos los procesos del navegador).
ipcMain.handle('sys:stats', soloUI(async () => {
  try {
    const mem = process.getSystemMemoryInfo();               // KB
    const mets = app.getAppMetrics();
    let cpu = 0, rssKb = 0;
    for (const p of mets) { cpu += (p.cpu && p.cpu.percentCPUUsage) || 0; rssKb += memKb(p); }
    cpu = Math.round(cpu * 10) / 10; // un decimal: redondear a entero daba siempre 0
    return {
      ramTotal: mem.total, ramLibre: mem.free,
      ramUso: Math.round((1 - mem.free / mem.total) * 100),
      appMb: Math.round(rssKb / 1024), appCpu: cpu,
      procesos: mets.length
    };
  } catch { return null; }
}));
/* Rendimiento POR PESTAÑA. app.getAppMetrics() da CPU y memoria por PROCESO;
   aquí se cruza con el proceso de cada webview para poder decir qué pestaña
   gasta qué. OJO: Chromium mete varias pestañas del MISMO sitio en un solo
   proceso, así que un pid puede servir a varias — se marca `comparten` para no
   sumar la misma memoria dos veces y quedar como un contador que miente. */
ipcMain.handle('perf:tabs', soloUI(async (_e, lista) => {
  try {
    const mets = app.getAppMetrics();
    const porPid = new Map(mets.map((p) => [p.pid, p]));
    const cuantasPorPid = new Map();
    const filas = (lista || []).map((t) => {
      let pid = null;
      try { pid = webContents.fromId(t.wcId)?.getOSProcessId() ?? null; } catch { /* dormida o ya cerrada */ }
      if (pid) cuantasPorPid.set(pid, (cuantasPorPid.get(pid) || 0) + 1);
      const m = pid ? porPid.get(pid) : null;
      return {
        id: t.id,
        pid,
        mb: m ? Math.round(memKb(m) / 1024) : null,
        cpu: m ? Math.round((m.cpu && m.cpu.percentCPUUsage || 0) * 10) / 10 : null
      };
    });
    for (const f of filas) f.comparten = f.pid ? (cuantasPorPid.get(f.pid) || 1) : 1;
    // Todo lo que no es una pestaña: la propia interfaz, la GPU, la red, utilidades.
    const dePestanas = new Set(filas.map((f) => f.pid).filter(Boolean));
    const resto = mets.filter((p) => !dePestanas.has(p.pid));
    const suma = (arr, f) => Math.round(arr.reduce((s, p) => s + f(p), 0));
    return {
      filas,
      restoMb: suma(resto, (p) => memKb(p) / 1024),
      restoCpu: Math.round(resto.reduce((s, p) => s + (p.cpu && p.cpu.percentCPUUsage || 0), 0) * 10) / 10,
      totalMb: suma(mets, (p) => memKb(p) / 1024),
      totalCpu: Math.round(mets.reduce((s, p) => s + (p.cpu && p.cpu.percentCPUUsage || 0), 0) * 10) / 10,
      procesos: mets.length
    };
  } catch { return null; }
}));
/* Lo que copia un gestor de contraseñas (Bitwarden, KeePass, 1Password) lleva
   la marca de Windows para que ningún historial lo guarde: el widget
   Portapapeles tampoco lo ve. */
function copiaExcluida() {
  if (process.platform !== 'win32') return false;
  try {
    if (clipboard.has('ExcludeClipboardContentFromMonitorProcessing')) return true;
    if (clipboard.has('CanIncludeInClipboardHistory')) {
      const b = clipboard.readBuffer('CanIncludeInClipboardHistory');
      return b.length >= 4 && b.readUInt32LE(0) === 0;
    }
  } catch { /* formato ilegible: se trata como una copia normal */ }
  return false;
}
ipcMain.handle('clip:read', soloUI(async () => { try { return copiaExcluida() ? '' : (clipboard.readText() || ''); } catch { return ''; } }));
ipcMain.handle('clip:write', soloUI(async (_e, t) => { try { clipboard.writeText(String(t || '')); return true; } catch { return false; } }));
ipcMain.handle('spotify:logged', soloUI(async () => {
  try {
    const cookies = await session.fromPartition(PART_NORMAL).cookies.get({ domain: '.spotify.com', name: 'sp_dc' });
    return cookies.length > 0;
  } catch { return false; }
}));
ipcMain.handle('site:clear', soloUI(async (_e, { url, partition }) => {
  try {
    if (!PARTICIONES_VALIDAS.has(partition)) return { ok: false };
    const u = new URL(url); const host = u.hostname.replace(/^www\./, '');
    const ses = session.fromPartition(partition);
    const cookies = await ses.cookies.get({ domain: host });
    for (const c of cookies) {
      const cu = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + (c.path || '/');
      await ses.cookies.remove(cu, c.name).catch(() => {});
    }
    await ses.clearStorageData({ origin: u.origin }).catch(() => {});
    return { ok: true, cleared: cookies.length };
  } catch { return { ok: false }; }
}));

/* ===== BORRAR DATOS DE NAVEGACIÓN (2026-11-03) =====
   Antes solo había «borrar las cookies de este sitio» y «borrar el historial».
   Aquí: cookies y datos de los sitios (almacenamiento, service workers y
   contraseñas HTTP en caché) y la caché de archivos, en la sesión normal y en
   la de cada contenedor; desde una ventana privada, solo en la privada. Los
   espacios protegidos no se tocan: se borran con su contraseña al borrar el
   espacio. Electron no deja borrar cookies ni caché por fechas, así que eso
   es siempre todo; el periodo lo aplica la interfaz al historial. */
ipcMain.handle('datos:borra', soloUI(async (e, { cookies, cache } = {}) => {
  const particiones = esVentanaPrivada(e.sender) ? [PART_PRIVATE] : [PART_NORMAL, ...contenedoresGuardados()];
  for (const p of particiones) {
    const ses = session.fromPartition(p);
    if (cookies) {
      await ses.clearStorageData().catch(() => {});
      await ses.clearAuthCache().catch(() => {});
    }
    if (cache) {
      await ses.clearCache().catch(() => {});
      await ses.clearCodeCaches({}).catch(() => {});
    }
  }
  return { ok: true };
}));

ipcMain.handle('settings:set', soloUI((_e, patch) => {
  settings = { ...settings, ...patch }; saveSettings(settings);
  // Cambiar el modo claro retematiza también las webs abiertas (prefers-color-scheme)
  if ('lightMode' in patch) nativeTheme.themeSource = settings.lightMode ? 'light' : 'dark';
  // Al volver a automático no se espera al reloj de 2 h: se mira ya, y si hay
  // versión nueva se baja sola como en cualquier arranque.
  if ('updatesAuto' in patch && settings.updatesAuto && app.isPackaged) { chequeoSilencioso = true; autoUpdater.checkForUpdates().catch(() => {}); }
  // El muro de edad de X no necesita nada aquí: el renderer recarga la pestaña de X
  // al mover el ajuste y el preload consulta 'x:age-gate-on' en cada carga.
  return settings;
}));
// Lo pregunta el preload de la webview en document_start, antes de parchear el muro
// de edad de X. Síncrono porque a esas alturas no da tiempo a un ida y vuelta
// asíncrono; solo devuelve un booleano, sin datos sensibles.
ipcMain.on('x:age-gate-on', (e) => { e.returnValue = !!settings.xRevealSensitive; });
/* PUENTE, A QUITAR. Desde 2.7.10-dev.4 el preload YA NO PIDE ni el pase ni la
   clave de la app: MOOVIN entra por el vinculo de mas abajo. Estos dos
   manejadores se quedan solo por si hay que volver atras deprisa, y se van
   -- junto con src/app-key.js y el secreto NAVIRIS_KEY del worker de MOOVIN --
   cuando esta version lleve un tiempo publicada. Ver
   moovin/worker/VINCULO-NAVIRIS.md en el repo Iris. */
// Pase de la biblioteca de MOOVIN (moovin.live, y iris.it.com/moovin mientras
// siga vivo), privada. Naviris lo recuerda a nivel de navegador para que ahí no
// aparezca la pantalla del pase. A diferencia de los dos de arriba esto SÍ es un
// secreto, y el preload corre en todos los sitios: solo se entrega y solo se
// acepta desde esos dos dominios. Tampoco entra en la sincronización de la
// cuenta: no sale de este equipo.
const esMoovin = (e) => {
  try {
    const h = new URL(e.senderFrame.url).hostname;
    return /(^|\.)moovin\.live$/.test(h) || /(^|\.)iris\.it\.com$/.test(h);
  } catch { return false; }
};
ipcMain.on('moovin:pase', (e) => { e.returnValue = esMoovin(e) ? (settings.moovinPase || '') : ''; });
ipcMain.on('moovin:pase-set', (e, v) => {
  if (!esMoovin(e) || typeof v !== 'string' || !v.trim() || v.length > 64) return;
  settings = { ...settings, moovinPase: v.trim() };
  saveSettings(settings);
});
/* Clave propia de la app, para que MOOVIN se abra solo desde Naviris sin que
   nadie escriba nada. Vive en src/app-key.js, que NO se versiona (main es
   público y Pages lo sirve entero); en el CI lo escribe el secret
   NAVIRIS_MOOVIN_KEY. Si el archivo no está, esto devuelve cadena vacía y se
   pide el pase como en cualquier otro navegador: no se rompe nada.
   OJO con lo que esto es y lo que no: la clave viaja dentro de un instalador
   público y un .asar se abre con un descompresor, así que frena a quien
   tropiece con la URL, no a quien se lo proponga. Va aparte del pase para
   poder rotarla sin dejar fuera a quien entra por navegador. */
let CLAVE_APP = '';
try { CLAVE_APP = String(require('./app-key') || '').trim(); } catch { /* sin clave: se pide el pase */ }
ipcMain.on('moovin:clave-app', (e) => { e.returnValue = esMoovin(e) ? CLAVE_APP : ''; });

/* IDENTIDAD PARA MOOVIN. Sustituye a las dos credenciales de arriba: en vez
   de abrirle la biblioteca a cualquiera que use Naviris, MOOVIN entra a la
   cuenta que este ATADA a esta cuenta de Naviris.

   El token de la cuenta vive en el hub (localStorage del renderer). Se copia
   aqui EN MEMORIA -- nunca a settings ni a disco -- porque quien tiene que
   hablar con el worker es el main: asi el token no entra jamas en el mundo
   de la pagina de MOOVIN, que solo recibe la prueba ya firmada y con dos
   minutos de vida.

   La prueba la firma el worker de Naviris con un secreto que NO viaja en el
   instalador. Ese es el punto de todo esto. */
const ACC_API = 'https://naviris-account.studio-iris2026.workers.dev';
let TOKEN_CUENTA = '';
ipcMain.on('cuenta:token', (_e, v) => {
  TOKEN_CUENTA = (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) ? v : '';
});
ipcMain.handle('moovin:identidad', async (e) => {
  if (!esMoovin(e) || !TOKEN_CUENTA) return '';
  try {
    const r = await fetch(ACC_API + '/moovin/identidad', {
      method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN_CUENTA }
    });
    if (!r.ok) return '';
    const j = await r.json();
    return String((j && j.prueba) || '');
  } catch { return ''; }
});
// Con app.quit() y no app.exit(): exit se saltaba el before-quit y el reinicio
// de Ajustes (aceleración por hardware, modo agente) perdía las cookies de sesión.
ipcMain.on('app:restart', () => { app.relaunch(); app.quit(); });
ipcMain.handle('app:version', () => app.getVersion());
/* Navegador predeterminado. Windows 10 y 11 no dejan que un programa se ponga
   solo: el instalador (build/installer.nsh) registra Naviris como navegador y
   aquí se abre su página de Configuración, donde lo elige la persona.
   «registrado»: solo la versión instalada está en el registro (ni la portable
   ni «npm start»). «predeterminado»: lo que Windows abre de verdad con un
   enlace, leído de su asociación (respeta la elección del usuario). */
const esLaApp = (ruta) => !!ruta && path.resolve(ruta).toLowerCase() === path.resolve(process.execPath).toLowerCase();
ipcMain.handle('navegador:estado', soloUI(async () => {
  const registrado = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
  let predeterminado = false;
  try {
    const [https, http] = await Promise.all([app.getApplicationInfoForProtocol('https://'), app.getApplicationInfoForProtocol('http://')]);
    predeterminado = esLaApp(https.path) && esLaApp(http.path);
  } catch { /* sin asociación para ese esquema */ }
  return { registrado, predeterminado };
}));
// La página de Naviris dentro de Aplicaciones predeterminadas (Windows 11; en
// Windows 10 se queda en la lista general). El nombre es el de RegisteredApplications.
ipcMain.handle('navegador:hacer-predeterminado', soloUI(() => shell.openExternal('ms-settings:defaultapps?registeredAppUser=Naviris').then(() => true, () => false)));
ipcMain.handle('gpu:status', () => app.getGPUFeatureStatus());
ipcMain.handle('clipboard:read', soloUI(() => { try { return clipboard.readText(); } catch { return ''; } }));

// ---------- Gestor de contraseñas (safeStorage/DPAPI + Windows Hello) ----------
const pwPath = () => path.join(app.getPath('userData'), ARCHIVOS + 'passwords.json');
function loadPasswords() { try { return JSON.parse(fs.readFileSync(pwPath(), 'utf8')); } catch { return []; } }
function savePasswords(list) { try { escribeSeguro(pwPath(), JSON.stringify(list)); } catch (e) { console.error('pw save', e); } }
let pwSeq = Date.now();

// Verifica identidad con Windows Hello (PIN/biometría). Devuelve true si "Verified".
// El cuadro se pide ANCLADO a la ventana de Naviris (IUserConsentVerifierInterop,
// RequestVerificationForWindowAsync con su HWND): con RequestVerificationAsync a
// secas, desde un proceso que no es UWP, el cuadro salía como ventana suelta y
// se quedaba DETRÁS de Naviris — "se abre pero no se antepone" (Dosa,
// 2026-09-19). Anclado es ventana hija (owner = Naviris) y sale delante.
// Verificado por user32: la ventana "Seguridad de Windows" (clase Credential
// Dialog Xaml Host) lleva owner = el HWND de Naviris. Si no hay ventana o el
// interop falla, se cae al método suelto de antes.
function hwndDeNaviris() {
  try {
    const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    if (!w) return '0';
    const b = w.getNativeWindowHandle();
    return String(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0));
  } catch { return '0'; }
}
function verifyWindowsHello(reason) {
  return new Promise((resolve) => {
    // El motivo lleva el sitio de la contraseña (puede venir de un CSV importado):
    // va como literal escapado, nunca pegado a mano entre comillas.
    const msg = rat.literalPs(reason || 'Naviris te pide verificar tu identidad');
    const hwnd = hwndDeNaviris();
    const script = `
[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
public interface IUserConsentVerifierInterop {
  [return: MarshalAs(UnmanagedType.IInspectable)]
  object RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, [In] ref Guid riid);
}
public static class HelloInterop {
  [DllImport("combase.dll", CharSet = CharSet.Unicode)] static extern int WindowsCreateString(string s, int len, out IntPtr hstring);
  [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr hstring);
  [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
  public static object Pedir(IntPtr hwnd, string mensaje, Guid riidOp) {
    IntPtr h; WindowsCreateString("Windows.Security.Credentials.UI.UserConsentVerifier", 51, out h);
    Guid iid = typeof(IUserConsentVerifierInterop).GUID;
    IntPtr f; int hr = RoGetActivationFactory(h, ref iid, out f);
    WindowsDeleteString(h);
    if (hr != 0) throw new COMException("RoGetActivationFactory", hr);
    var interop = (IUserConsentVerifierInterop)Marshal.GetObjectForIUnknown(f);
    Marshal.Release(f);
    return interop.RequestVerificationForWindowAsync(hwnd, mensaje, ref riidOp);
  }
}
'@
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
$op = $null
if (${hwnd} -ne 0) {
  try {
    $riid = [Windows.Security.Credentials.UI.UserConsentVerifier].GetMethod('RequestVerificationAsync').ReturnType.GUID
    $op = [HelloInterop]::Pedir([IntPtr]${hwnd}, ${msg}, $riid)
  } catch { $op = $null }
}
if ($op -eq $null) { $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync(${msg}) }
$task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))
$task.Wait()
[Console]::Out.Write('RESULT=' + $task.Result)`;
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    let out = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true });
    ps.stdout.on('data', (d) => { out += d.toString(); });
    ps.on('close', () => resolve(/RESULT=Verified/.test(out)));
    ps.on('error', () => resolve(false));
  });
}

function normHost(s) {
  let h = String(s || '');
  try { h = new URL(/^https?:\/\//.test(h) ? h : 'https://' + h).hostname; } catch { /* nada */ }
  return h.toLowerCase().replace(/^www\./, '');
}
// Sufijos públicos de dos etiquetas más comunes: nadie "posee" bbc.co.uk como
// co.uk, así que jamás pueden actuar de dominio padre para emparejar.
const SUFIJOS_PUBLICOS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in',
  'co.za', 'co.nz', 'co.il', 'co.th', 'com.br', 'com.ar', 'com.mx', 'com.au', 'com.tr', 'com.cn',
  'com.es', 'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.py', 'com.ec', 'com.bo', 'com.do',
  'com.gt', 'com.pa', 'com.sv', 'com.hn', 'com.ni', 'com.pr', 'com.tw', 'com.hk', 'com.sg',
  'com.my', 'com.ph', 'com.vn', 'com.pk', 'com.sa', 'com.eg', 'com.ng', 'com.pl', 'com.ua',
  'com.ru', 'org.br', 'net.br', 'gov.br', 'edu.br', 'org.au', 'net.au', 'gov.au', 'edu.au'
]);
const esSufijoPublico = (h) => SUFIJOS_PUBLICOS.has(h) || h.split('.').length < 2;
// ¿La credencial guardada para `saved` vale en la página `current`?
// Coincidencia EXACTA de host, o que uno sea subdominio del otro (bbc.co.uk
// vale en login.bbc.co.uk). ANTES esto reducía el host a sus dos últimas
// etiquetas: bbc.co.uk y evil.co.uk quedaban ambos en "co.uk", así que un
// dominio recién registrado bajo un sufijo de dos partes recibía la oferta de
// autorrellenar credenciales de OTRO sitio. Sin la lista de sufijos públicos
// entera, exigir el host completo como sufijo es la regla segura.
function sameSite(saved, current) {
  const a = normHost(saved), b = normHost(current);
  if (!a || !b) return false;
  if (a === b) return true;
  if (esSufijoPublico(a) || esSufijoPublico(b)) return false;
  return b.endsWith('.' + a) || a.endsWith('.' + b);
}

ipcMain.handle('pw:available', soloUI(async () => ({ encryption: safeStorage.isEncryptionAvailable() })));
ipcMain.handle('pw:list', soloUI(() => loadPasswords().map((e) => ({ id: e.id, site: e.site, username: e.username }))));
// Credenciales guardadas para un sitio (sin exponer la contraseña; el revelado exige Windows Hello)
ipcMain.handle('pw:for-host', soloUI((_e, host) => {
  return loadPasswords().filter((e) => sameSite(e.site, host)).map((e) => ({ id: e.id, site: e.site, username: e.username }));
}));
ipcMain.handle('pw:add', soloUI((_e, { site, username, password }) => {
  if (!site || !password || !safeStorage.isEncryptionAvailable()) return { ok: false };
  const list = loadPasswords();
  const enc = safeStorage.encryptString(String(password)).toString('base64');
  const user = String(username || '');
  // Si ya existe una credencial para el mismo dominio + usuario, actualiza la contraseña
  const existing = list.find((e) => e.username === user && normHost(e.site) === normHost(site));
  if (existing) { existing.enc = enc; existing.site = String(site); }
  else list.push({ id: 'pw' + (++pwSeq), site: String(site), username: user, enc });
  savePasswords(list);
  return { ok: true, updated: !!existing };
}));
ipcMain.handle('pw:delete', soloUI((_e, id) => { savePasswords(loadPasswords().filter((e) => e.id !== id)); return { ok: true }; }));

// Importa contraseñas desde el CSV que exportan Chrome/Brave/Opera/Edge
// (Configuración → Contraseñas → Exportar). Es la vía universal: las versiones
// recientes de Chromium cifran las contraseñas con "app-bound encryption" y no
// se pueden leer directamente de su base de datos fuera del navegador.
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; } if (c === '\r' && text[i + 1] === '\n') i++; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
ipcMain.handle('pw:import-csv', soloUI(async (e) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Cifrado no disponible' };
  const r = await dialog.showOpenDialog(winOf(e), {
    title: 'Importar contraseñas exportadas (CSV)',
    filters: [{ name: 'CSV de contraseñas', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    const rows = parseCsv(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (!rows.length) return { ok: false, error: 'CSV vacío' };
    // Cabecera de Chromium: name,url,username,password,note
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const iUrl = head.indexOf('url'), iUser = head.indexOf('username'), iPass = head.indexOf('password');
    if (iUrl < 0 || iPass < 0) return { ok: false, error: 'No parece un CSV de contraseñas de navegador' };
    const list = loadPasswords();
    let added = 0, updated = 0;
    for (let i = 1; i < rows.length; i++) {
      const site = (rows[i][iUrl] || '').trim();
      const password = rows[i][iPass] || '';
      if (!site || !password) continue;
      const user = (iUser >= 0 ? rows[i][iUser] : '') || '';
      const enc = safeStorage.encryptString(String(password)).toString('base64');
      const existing = list.find((x) => x.username === user && normHost(x.site) === normHost(site));
      if (existing) { existing.enc = enc; updated++; }
      else { list.push({ id: 'pw' + (++pwSeq), site, username: user, enc }); added++; }
    }
    savePasswords(list);
    return { ok: true, added, updated };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
}));
ipcMain.handle('pw:reveal', soloUI(async (_e, id) => {
  const entry = loadPasswords().find((e) => e.id === id);
  if (!entry) return { ok: false, error: 'no encontrada' };
  const verified = await verifyWindowsHello('Naviris: verifica tu identidad para ver la contraseña de ' + entry.site);
  if (!verified) return { ok: false, error: 'verificacion cancelada' };
  try { return { ok: true, password: safeStorage.decryptString(Buffer.from(entry.enc, 'base64')) }; }
  catch { return { ok: false, error: 'no se pudo descifrar' }; }
}));

// ---------- Gestor de tarjetas (como Opera/Brave: safeStorage + Windows Hello) ----------
// El número viaja y se guarda cifrado; en claro solo quedan marca, últimos 4 y
// caducidad para pintar la lista. El CVC NO se guarda nunca (como Chrome):
// autorrellenamos número/titular/caducidad y el CVC lo teclea el usuario.
const cardsPath = () => path.join(app.getPath('userData'), ARCHIVOS + 'cards.json');
function loadCards() { try { return JSON.parse(fs.readFileSync(cardsPath(), 'utf8')); } catch { return []; } }
function saveCards(list) { try { escribeSeguro(cardsPath(), JSON.stringify(list)); } catch (e) { console.error('cards save', e); } }
let cardSeq = Date.now();

function cardBrand(num) {
  if (/^4/.test(num)) return 'Visa';
  if (/^(5[1-5]|22[2-9]|2[3-6]|27[01]|2720)/.test(num)) return 'Mastercard';
  if (/^3[47]/.test(num)) return 'American Express';
  if (/^(6011|65|64[4-9])/.test(num)) return 'Discover';
  if (/^(30[0-5]|36|38)/.test(num)) return 'Diners';
  if (/^35/.test(num)) return 'JCB';
  return 'Tarjeta';
}
function luhnOk(num) {
  let sum = 0, dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = +num[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

ipcMain.handle('cards:list', soloUI(() => loadCards().map((c) => ({ id: c.id, brand: c.brand, last4: c.last4, holder: c.holder, expMonth: c.expMonth, expYear: c.expYear }))));
ipcMain.handle('cards:add', soloUI((_e, { number, holder, expMonth, expYear }) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Cifrado no disponible' };
  const num = String(number || '').replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(num)) return { ok: false, error: 'Número no válido' };
  if (!luhnOk(num)) return { ok: false, error: 'El número no supera la comprobación (revísalo)' };
  const m = parseInt(expMonth, 10), y = parseInt(expYear, 10);
  if (!(m >= 1 && m <= 12) || !(y >= 2020 && y <= 2100)) return { ok: false, error: 'Caducidad no válida' };
  const list = loadCards();
  const last4 = num.slice(-4);
  const enc = safeStorage.encryptString(num).toString('base64');
  // Misma tarjeta (mismos últimos 4 y marca): se actualiza en vez de duplicar
  const existing = list.find((c) => c.last4 === last4 && c.brand === cardBrand(num));
  if (existing) { existing.enc = enc; existing.holder = String(holder || ''); existing.expMonth = m; existing.expYear = y; }
  else list.push({ id: 'card' + (++cardSeq), brand: cardBrand(num), last4, holder: String(holder || ''), expMonth: m, expYear: y, enc });
  saveCards(list);
  return { ok: true, updated: !!existing };
}));
ipcMain.handle('cards:delete', soloUI((_e, id) => { saveCards(loadCards().filter((c) => c.id !== id)); return { ok: true }; }));
// Ver el número completo o autorrellenar exige Windows Hello, como las contraseñas
async function revealCard(id, reason) {
  const c = loadCards().find((x) => x.id === id);
  if (!c) return { ok: false, error: 'no encontrada' };
  const verified = await verifyWindowsHello(reason);
  if (!verified) return { ok: false, error: 'verificacion cancelada' };
  try { return { ok: true, number: safeStorage.decryptString(Buffer.from(c.enc, 'base64')), holder: c.holder, expMonth: c.expMonth, expYear: c.expYear }; }
  catch { return { ok: false, error: 'no se pudo descifrar' }; }
}
ipcMain.handle('cards:reveal', soloUI((_e, id) => revealCard(id, 'Naviris: verifica tu identidad para ver la tarjeta')));
ipcMain.handle('cards:fill', soloUI((_e, id) => revealCard(id, 'Naviris: verifica tu identidad para autorrellenar la tarjeta')));

/* ---------- Códigos de verificación en dos pasos (TOTP) ----------
   Mismo trato que las contraseñas y las tarjetas: el secreto se guarda cifrado
   con DPAPI (safeStorage) y ver los códigos exige Windows Hello.

   TOTP es el estándar abierto RFC 6238, el mismo que usan Google Authenticator
   o Authy: del secreto compartido y el reloj (en tramos de 30 s) sale un HMAC
   del que se recortan 6 dígitos. No hay nada propietario.

   OJO CON EL SECRETO: no es "la contraseña de un sitio", es la semilla que
   genera TODOS los códigos futuros. Quien la tenga entra siempre. Por eso no
   se devuelve nunca al renderer salvo en `totp:reveal`, que pide Hello, y por
   eso los códigos solo salen con la caja desbloqueada. */
const totpPath = () => path.join(app.getPath('userData'), ARCHIVOS + 'totp.json');
function loadTotp() { try { return JSON.parse(fs.readFileSync(totpPath(), 'utf8')); } catch { return []; } }
function saveTotp(list) { try { escribeSeguro(totpPath(), JSON.stringify(list)); } catch (e) { console.error('totp save', e); } }

// Base32 de RFC 4648 sin padding, que es como viajan los secretos TOTP.
function base32ADatos(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const limpio = String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0, valor = 0;
  const out = [];
  for (const ch of limpio) {
    const i = A.indexOf(ch);
    if (i === -1) throw new Error('secreto no válido');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  if (!out.length) throw new Error('secreto vacío');
  return Buffer.from(out);
}

function codigoTotp(secreto, { digits = 6, period = 30, algorithm = 'sha1' } = {}, cuando) {
  const clave = base32ADatos(secreto);
  const contador = Math.floor((cuando == null ? Date.now() : cuando) / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(contador / 0x100000000), 0);
  buf.writeUInt32BE(contador >>> 0, 4);
  const h = crypto.createHmac(algorithm, clave).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const num = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(num % Math.pow(10, digits)).padStart(digits, '0');
}

/* Acepta tanto una URI otpauth:// (la del QR) como el secreto pelado. */
function parseaOtp(entrada) {
  const txt = String(entrada || '').trim();
  if (/^otpauth:\/\//i.test(txt)) {
    const u = new URL(txt);
    if (!/^totp$/i.test(u.hostname)) throw new Error('solo se admiten códigos por tiempo (TOTP)');
    const etiqueta = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const corte = etiqueta.indexOf(':');
    const q = u.searchParams;
    return {
      secret: (q.get('secret') || '').replace(/\s/g, ''),
      issuer: q.get('issuer') || (corte > 0 ? etiqueta.slice(0, corte) : ''),
      label: corte > 0 ? etiqueta.slice(corte + 1).trim() : etiqueta,
      digits: Math.min(10, Math.max(6, parseInt(q.get('digits') || '6', 10) || 6)),
      period: Math.min(120, Math.max(15, parseInt(q.get('period') || '30', 10) || 30)),
      algorithm: (q.get('algorithm') || 'SHA1').toLowerCase().replace('-', '')
    };
  }
  return { secret: txt.replace(/\s/g, ''), issuer: '', label: '', digits: 6, period: 30, algorithm: 'sha1' };
}

/* La caja se abre con Hello y se queda abierta un rato: pedir la huella cada
   30 segundos, que es lo que dura un código, no lo usaría nadie. */
const TOTP_ABIERTA_MS = 5 * 60 * 1000;
let totpAbiertaHasta = 0;
const totpAbierta = () => Date.now() < totpAbiertaHasta;

ipcMain.handle('totp:available', soloUI(() => ({
  encryption: safeStorage.isEncryptionAvailable(),
  unlocked: totpAbierta(),
  count: loadTotp().length
})));
ipcMain.handle('totp:unlock', soloUI(async () => {
  if (!loadTotp().length) { totpAbiertaHasta = Date.now() + TOTP_ABIERTA_MS; return { ok: true }; }
  const ok = await verifyWindowsHello('Naviris: verifica tu identidad para ver tus códigos');
  if (!ok) return { ok: false, error: 'verificacion cancelada' };
  totpAbiertaHasta = Date.now() + TOTP_ABIERTA_MS;
  return { ok: true, hasta: totpAbiertaHasta };
}));
ipcMain.handle('totp:lock', soloUI(() => { totpAbiertaHasta = 0; return { ok: true }; }));
ipcMain.handle('totp:list', soloUI(() => loadTotp().map((e) => ({
  id: e.id, issuer: e.issuer, label: e.label, digits: e.digits, period: e.period
}))));
ipcMain.handle('totp:add', soloUI((_e, { entrada, issuer, label } = {}) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'El cifrado del sistema no está disponible' };
  let d;
  try { d = parseaOtp(entrada); } catch (err) { return { ok: false, error: err.message }; }
  if (!d.secret) return { ok: false, error: 'Falta el secreto' };
  // Se genera un código antes de guardar: si el secreto está mal, se ve ahora y
  // no dentro de un mes cuando haga falta entrar en la cuenta.
  try { codigoTotp(d.secret, d); } catch { return { ok: false, error: 'Ese secreto no es válido' }; }
  const list = loadTotp();
  const ent = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    issuer: String(issuer || d.issuer || '').slice(0, 60).trim() || 'Cuenta',
    label: String(label || d.label || '').slice(0, 80).trim(),
    digits: d.digits, period: d.period, algorithm: d.algorithm,
    enc: safeStorage.encryptString(d.secret).toString('base64'),
    created: Date.now()
  };
  list.push(ent);
  saveTotp(list);
  totpAbiertaHasta = Date.now() + TOTP_ABIERTA_MS;  // recién añadida, se puede ver
  return { ok: true, id: ent.id, issuer: ent.issuer, label: ent.label };
}));
ipcMain.handle('totp:delete', soloUI(async (_e, id) => {
  const ok = await verifyWindowsHello('Naviris: verifica tu identidad para borrar un código');
  if (!ok) return { ok: false, error: 'verificacion cancelada' };
  saveTotp(loadTotp().filter((e) => e.id !== id));
  return { ok: true };
}));
ipcMain.handle('totp:codes', soloUI(() => {
  if (!totpAbierta()) return { ok: false, locked: true };
  const ahora = Date.now();
  const items = loadTotp().map((e) => {
    let code = '------';
    try { code = codigoTotp(safeStorage.decryptString(Buffer.from(e.enc, 'base64')), e, ahora); }
    catch { code = 'error'; }
    const per = e.period || 30;
    return { id: e.id, issuer: e.issuer, label: e.label, code, restan: per - Math.floor(ahora / 1000) % per, period: per };
  });
  return { ok: true, items, hasta: totpAbiertaHasta };
}));
// El secreto en claro solo por aquí, y siempre con Hello: sirve para pasar la
// cuenta a otro dispositivo o guardarla en la copia de seguridad.
ipcMain.handle('totp:reveal', soloUI(async (_e, id) => {
  const e = loadTotp().find((x) => x.id === id);
  if (!e) return { ok: false, error: 'no existe' };
  const ok = await verifyWindowsHello('Naviris: verifica tu identidad para ver el secreto');
  if (!ok) return { ok: false, error: 'verificacion cancelada' };
  try {
    const sec = safeStorage.decryptString(Buffer.from(e.enc, 'base64'));
    const etiqueta = encodeURIComponent((e.issuer ? e.issuer + ':' : '') + (e.label || ''));
    const uri = `otpauth://totp/${etiqueta}?secret=${sec}&issuer=${encodeURIComponent(e.issuer || '')}&digits=${e.digits}&period=${e.period}&algorithm=${(e.algorithm || 'sha1').toUpperCase()}`;
    return { ok: true, secret: sec, uri };
  } catch { return { ok: false, error: 'no se pudo descifrar' }; }
}));

ipcMain.handle('adblock:get', () => ({ enabled: settings.adblockEnabled, whitelist: settings.adblockWhitelist, blocked: blockedCount, brave: braveAdblock.status() }));
ipcMain.handle('adblock:set-enabled', soloUI((_e, enabled) => { settings.adblockEnabled = !!enabled; saveSettings(settings); return settings.adblockEnabled; }));
ipcMain.handle('adblock:whitelist', soloUI((_e, { action, domain } = {}) => {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (action === 'add' && d && !settings.adblockWhitelist.includes(d)) settings.adblockWhitelist.push(d);
  if (action === 'remove') settings.adblockWhitelist = settings.adblockWhitelist.filter((x) => x !== d);
  saveSettings(settings);
  return settings.adblockWhitelist;
}));

// Descargas
ipcMain.on('download:url', soloUI((_e, d) => {
  const { url, isPrivate } = d || {};
  if (typeof url !== 'string' || !/^https?:/.test(url)) return;
  session.fromPartition(isPrivate ? PART_PRIVATE : PART_NORMAL).downloadURL(url);
}));
// La URL acaba en la línea de órdenes de yt-dlp: solo direcciones web, nunca
// algo que empiece por "-" y se lea como una opción.
ipcMain.handle('yt:download', soloUI(async (_e, opts) => {
  if (!opts || typeof opts.url !== 'string' || !/^https?:\/\//i.test(opts.url)) return null;
  await ensureBins();
  return ytDownload(opts);
}));
// Siempre disponible: si faltan los binarios se descargan solos al abrir el
// Rat Tool (ensureBins muestra el progreso en el panel de descargas)
ipcMain.handle('yt:available', () => { ensureBins(); return true; });

// ---------- Importar marcadores de otros navegadores ----------
// Chromium guarda un JSON "Bookmarks"; Firefox comprime su backup en .jsonlz4 (LZ4 + cabecera Mozilla).
// Cada navegador Chromium tiene una carpeta "User Data" con perfiles (Default,
// Profile 1…). Se busca el archivo (Bookmarks / Login Data) en cualquiera de ellos.
const IMPORT_BROWSERS = {
  chrome:  { label: 'Chrome',   type: 'chromium', base: 'LOCALAPPDATA', userData: ['Google', 'Chrome', 'User Data'] },
  brave:   { label: 'Brave',    type: 'chromium', base: 'LOCALAPPDATA', userData: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  edge:    { label: 'Edge',     type: 'chromium', base: 'LOCALAPPDATA', userData: ['Microsoft', 'Edge', 'User Data'] },
  opera:   { label: 'Opera',    type: 'chromium', base: 'APPDATA', userData: ['Opera Software', 'Opera Stable'], flat: true },
  operagx: { label: 'Opera GX', type: 'chromium', base: 'APPDATA', userData: ['Opera Software', 'Opera GX Stable'], flat: true },
  firefox: { label: 'Firefox',  type: 'firefox' }
};
// Devuelve el primer perfil que contiene `file` (Default, Profile N, o la raíz
// en Opera que no usa subcarpetas de perfil). null si el navegador no lo tiene.
function chromiumFile(b, file) {
  const root = process.env[b.base]; if (!root) return null;
  const ud = path.join(root, ...b.userData);
  if (!fs.existsSync(ud)) return null;
  const candidates = b.flat ? [ud] : [];
  if (!b.flat) {
    try {
      const profiles = ['Default', ...fs.readdirSync(ud).filter((d) => /^Profile /.test(d))];
      for (const p of profiles) candidates.push(path.join(ud, p));
    } catch { /* nada */ }
    candidates.push(ud); // por si el archivo cuelga directo de User Data
  }
  for (const dir of candidates) { const f = path.join(dir, file); if (fs.existsSync(f)) return f; }
  return null;
}
function importPath(b) {
  if (!b) return null;
  if (b.type === 'firefox') return firefoxLatestBackup();
  return chromiumFile(b, 'Bookmarks');
}
// Descompresor LZ4 en bloque (sin dependencias) para leer los backups de Firefox
function lz4DecompressBlock(input, outLen) {
  const out = Buffer.allocUnsafe(outLen); let ip = 0, op = 0;
  while (ip < input.length) {
    const token = input[ip++];
    let litLen = token >> 4;
    if (litLen === 15) { let b; do { b = input[ip++]; litLen += b; } while (b === 255); }
    for (let i = 0; i < litLen; i++) out[op++] = input[ip++];
    if (ip >= input.length) break;
    const offset = input[ip++] | (input[ip++] << 8);
    let matchLen = (token & 15) + 4;
    if ((token & 15) === 15) { let b; do { b = input[ip++]; matchLen += b; } while (b === 255); }
    let mp = op - offset;
    for (let i = 0; i < matchLen; i++) out[op++] = out[mp++];
  }
  return out.subarray(0, op);
}
function decodeMozLz4(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 8) !== 'mozLz40\0') return null;
  return lz4DecompressBlock(buf.subarray(12), buf.readUInt32LE(8));
}
function firefoxLatestBackup() {
  const base = path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles');
  if (!fs.existsSync(base)) return null;
  let best = null, bestTime = 0;
  for (const prof of fs.readdirSync(base)) {
    const bb = path.join(base, prof, 'bookmarkbackups');
    if (!fs.existsSync(bb)) continue;
    for (const f of fs.readdirSync(bb)) {
      if (!f.endsWith('.jsonlz4')) continue;
      const full = path.join(bb, f);
      try { const t = fs.statSync(full).mtimeMs; if (t > bestTime) { bestTime = t; best = full; } } catch { /* nada */ }
    }
  }
  return best;
}
function flattenChromium(node, out) {
  if (!node) return;
  if (node.type === 'url' && node.url && /^https?:/.test(node.url)) out.push({ title: node.name || node.url, url: node.url });
  if (Array.isArray(node.children)) node.children.forEach((c) => flattenChromium(c, out));
}
function flattenFirefox(node, out) {
  if (!node) return;
  if (node.uri && /^https?:/.test(node.uri)) out.push({ title: node.title || node.uri, url: node.uri });
  if (Array.isArray(node.children)) node.children.forEach((c) => flattenFirefox(c, out));
}
ipcMain.handle('import:available', () => {
  const avail = {};
  Object.keys(IMPORT_BROWSERS).forEach((k) => { const p = importPath(IMPORT_BROWSERS[k]); avail[k] = { label: IMPORT_BROWSERS[k].label, present: !!(p && fs.existsSync(p)) }; });
  return avail;
});
ipcMain.handle('import:bookmarks', soloUI((_e, key) => {
  try {
    const b = IMPORT_BROWSERS[key]; const p = importPath(b);
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'no encontrado' };
    const out = [];
    if (b.type === 'firefox') {
      const json = decodeMozLz4(fs.readFileSync(p));
      if (!json) return { ok: false, error: 'backup ilegible' };
      flattenFirefox(JSON.parse(json.toString('utf8')), out);
    } else {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      Object.values(data.roots || {}).forEach((root) => flattenChromium(root, out));
    }
    return { ok: true, items: out, label: b.label };
  } catch (e) { return { ok: false, error: e.message }; }
}));

// Calidades disponibles (1080, 720, …) para el selector: el lado corto de cada
// formato, como las nombra YouTube (un Short de 1080x1920 es 1080p).
ipcMain.handle('yt:formats', soloUI(async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || rat.esLista(url) || rat.esDirecto(url) || !fs.existsSync(ytDlpPath())) return [];
  // Mismas cookies, user agent y Deno que la descarga: si no, Instagram y X no
  // enseñan calidades para un vídeo que luego sí bajaría, y YouTube sin Deno no
  // enseña 1080p. YouTube, sin cookies salvo que pida sesión (un reintento).
  const lee = (cookies) => new Promise((resolve) => {
    const child = spawn(ytDlpPath(), rat.argsFormatos({ url, deno: denoSiHay(), ua: UA_LIMPIO, cookies }), { windowsHide: true });
    let out = '', err = '';
    const fin = (r) => { clearTimeout(timer); borraCookies(cookies); resolve(r); };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ya acabó */ } fin({ calidades: [], err }); }, 30000);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', () => fin({ calidades: [], err }));
    child.on('close', () => { try { fin({ calidades: rat.calidades(JSON.parse(out)), err }); } catch { fin({ calidades: [], err }); } });
  });
  const r = await lee(rat.cookiesDeEntrada(url) ? await cookiesParaYtDlp(url) : null);
  if (r.calidades.length || rat.cookiesDeEntrada(url) || !rat.reintentaConCookies(r.err, url)) return r.calidades;
  const cookies = await cookiesParaYtDlp(url);
  return cookies ? (await lee(cookies)).calidades : [];
}));
/* Pausar, reanudar y reintentar (2026-11-03). Solo las descargas del navegador:
   las del Rat Tool son yt-dlp y no se pueden pausar. Reintentar una que falló
   o se canceló la pide de nuevo en su misma sesión (contenedor o privada). */
ipcMain.on('download:pause', soloUI((_e, id) => {
  const d = downloads.get(id);
  if (!d?.item || d.meta.state !== 'progressing') return;
  try { d.item.pause(); } catch { /* ya terminó */ }
  d.meta.paused = true; broadcast('download:update', d.meta);
}));
ipcMain.on('download:resume', soloUI((_e, id) => {
  const d = downloads.get(id);
  if (!d?.item || d.meta.state !== 'progressing') return;
  try { if (d.item.canResume()) d.item.resume(); } catch { /* ya terminó */ }
  d.meta.paused = false; broadcast('download:update', d.meta);
}));
ipcMain.on('download:retry', soloUI((_e, id) => {
  const d = downloads.get(id);
  if (!d?.item || !d.ses || !/^https?:/i.test(d.meta.source || '') || d.meta.state === 'progressing' || d.meta.state === 'completed') return;
  downloads.delete(id);
  try { d.ses.downloadURL(d.meta.source); } catch { /* sesión cerrada */ }
}));
ipcMain.on('download:cancel', (_e, id) => {
  const d = downloads.get(id);
  if (d?.item) { try { d.item.cancel(); } catch { /* nada */ } }
  if (ytJobs.has(id)) {
    const child = ytJobs.get(id);
    // yt-dlp lanza ffmpeg como subproceso; en Windows kill() no mata el árbol,
    // así que se usa taskkill /T (árbol) /F (forzado) por PID.
    try {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    } catch { try { child.kill(); } catch { /* nada */ } }
    ytJobs.delete(id);
    if (d) { d.meta.state = 'cancelled'; broadcast('download:update', d.meta); }
  }
});
// Abrir un archivo lo ejecuta si es un programa: solo a petición de la interfaz.
ipcMain.on('download:open', soloUI((_e, id) => { const d = downloads.get(id); if (d) shell.openPath(d.meta.path); }));
ipcMain.on('download:reveal', (_e, id) => { const d = downloads.get(id); if (d) shell.showItemInFolder(d.meta.path); });
ipcMain.handle('download:path', (_e, id) => { const d = downloads.get(id); return d ? d.meta.path : null; });
ipcMain.on('download:clear', () => { for (const [id, d] of downloads) if (d.meta.state !== 'progressing') downloads.delete(id); });

/* Página de descargas: SOLO lo descargado desde Naviris (historial propio),
   comprobando que el archivo siga existiendo en disco. */
ipcMain.handle('downloads:files', async () => {
  const out = [];
  for (const h of loadDlHistory()) {
    try {
      const st = await fs.promises.stat(h.path);
      if (st.isFile()) out.push({ name: path.basename(h.path), path: h.path, size: st.size, mtime: h.time || st.mtimeMs });
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
});
// Solo se aceptan nombres simples que queden DENTRO de la carpeta de descargas
function downloadsFilePath(name) {
  const dir = app.getPath('downloads');
  const p = path.join(dir, String(name));
  return path.dirname(p) === dir ? p : null;
}
ipcMain.on('downloads:open-file', soloUI((_e, name) => { const p = downloadsFilePath(name); if (p) shell.openPath(p); }));
ipcMain.on('downloads:reveal-file', (_e, name) => { const p = downloadsFilePath(name); if (p) shell.showItemInFolder(p); });
ipcMain.on('downloads:open-folder', () => shell.openPath(app.getPath('downloads')));

// Favicon como dataURL
/* `iconUrl` es el que declara la propia pagina (page-favicon-updated). Se
   prueba PRIMERO porque es el bueno: el servicio de Google devuelve lo que
   tiene cacheado, que para sitios poco populares es un icono generico o de
   16 px, y ahi es donde se veian pixelados. */
ipcMain.handle('favicon:fetch', async (_e, pageUrl, iconUrl) => {
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch { return null; }
  /* El content-type lo decide el SITIO y acaba dentro de un data: que la
     interfaz pinta. Sin lista blanca, un `Content-Type: image/png" onerror="…`
     sale del atributo y se convierte en marcado dentro del renderer, que es
     quien tiene el IPC. Y sin tope, un "icono" de varios MB se guarda en
     base64 en localStorage. */
  const TIPOS_OK = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']);
  const TOPE_ICONO = 512 * 1024;
  const tryFetch = async (url) => {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error('http ' + res.status);
    const type = (res.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
    if (!TIPOS_OK.has(type)) throw new Error('tipo no permitido: ' + type);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 50) throw new Error('vacío');
    if (buf.length > TOPE_ICONO) throw new Error('icono demasiado grande');
    return `data:${type};base64,${buf.toString('base64')}`;
  };
  if (iconUrl && /^https?:/i.test(iconUrl)) {
    try { return await tryFetch(iconUrl); } catch { /* a por el siguiente */ }
  }
  try { return await tryFetch(`https://www.google.com/s2/favicons?sz=128&domain=${host}`); }
  catch {
    try { return await tryFetch(`https://${host}/favicon.ico`); }
    catch { return null; }
  }
});

// ---------- Addons (catálogo remoto en naviris.site, independiente de las releases) ----------
const ADDONS_BASE = 'https://naviris.site/addons/';
const addonsDir = () => path.join(app.getPath('userData'), 'addons');
const addonFile = (id) => path.join(addonsDir(), id + '.js');
let addonCode = {}; // id -> código en memoria (addons de contenido activados)

function loadAddonCode() {
  addonCode = {};
  for (const [id, meta] of Object.entries(settings.addons || {})) {
    if (!meta.enabled) continue;
    try { addonCode[id] = fs.readFileSync(addonFile(id), 'utf8'); } catch { /* archivo perdido: se reinstala desde la página */ }
  }
}
loadAddonCode();

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    let data = '';
    req.on('response', (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

ipcMain.handle('addons:catalog', async () => {
  try {
    const raw = await fetchText(ADDONS_BASE + 'catalog.json?t=' + Date.now());
    const cat = JSON.parse(raw);
    return { ok: true, addons: Array.isArray(cat.addons) ? cat.addons : [] };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
});

ipcMain.handle('addons:list', () => settings.addons || {});

ipcMain.handle('addons:install', soloUI(async (_e, meta) => {
  try {
    if (!meta || !/^[a-z0-9-]{1,60}$/.test(meta.id || '')) throw new Error('Addon inválido');
    const entry = String(meta.entry || '');
    if (!entry.startsWith(ADDONS_BASE)) throw new Error('Origen no permitido');
    const code = await fetchText(entry + '?t=' + Date.now());
    fs.mkdirSync(addonsDir(), { recursive: true });
    fs.writeFileSync(addonFile(meta.id), code, 'utf8');
    settings.addons = {
      ...(settings.addons || {}),
      [meta.id]: {
        id: meta.id, name: meta.name || meta.id, version: meta.version || '0',
        description: meta.description || '', kind: meta.kind === 'tool' ? 'tool' : 'content',
        matches: Array.isArray(meta.matches) ? meta.matches : [], icon: meta.icon || 'puzzle-piece',
        enabled: true
      }
    };
    saveSettings(settings); loadAddonCode();
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e.message || e) }; }
}));

ipcMain.handle('addons:uninstall', soloUI((_e, id) => {
  // El id acaba en una ruta (addonFile): el mismo formato que al instalar.
  if (!/^[a-z0-9-]{1,60}$/.test(String(id || ''))) return { ok: false };
  try { fs.rmSync(addonFile(id), { force: true }); } catch { /* nada */ }
  const rest = { ...(settings.addons || {}) }; delete rest[id];
  settings.addons = rest; saveSettings(settings); loadAddonCode();
  return { ok: true };
}));

ipcMain.handle('addons:toggle', soloUI((_e, { id, on } = {}) => {
  if (/^[a-z0-9-]{1,60}$/.test(String(id || '')) && settings.addons && Object.hasOwn(settings.addons, id)) { settings.addons[id].enabled = !!on; saveSettings(settings); loadAddonCode(); }
  return settings.addons || {};
}));

// Guardado de imágenes generado por addons (p. ej. capturas largas)
/* Fondo del hub elegido por el usuario: se COPIA a userData a resolución
   completa y el hub apunta al archivo. Antes se reescalaba a 1920 px y se
   pasaba a JPEG 82 para meterlo en localStorage — un 4K perdía la mitad de
   resolución (lo notó Dosa el 2026-08-11). El archivo solo se lee. */
/* Elegir fondo con el diálogo del SISTEMA. El <input type="file"> daba
   problemas: si elegías el mismo archivo dos veces no disparaba 'change' y el
   panel se quedaba colgado (2026-08-11). */
ipcMain.handle('hub:pick-wallpaper', async (e) => {
  try {
    const r = await dialog.showOpenDialog(winOf(e), {
      title: 'Elegir fondo del hub',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }]
    });
    if (r.canceled || !r.filePaths?.length) return { ok: false, canceled: true };
    return await guardarFondo(r.filePaths[0]);
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});
async function guardarFondo(origen) {
  if (!origen || !fs.existsSync(origen)) return { ok: false, message: 'No se encontró la imagen' };
  const dir = path.join(app.getPath('userData'), 'fondos');
  fs.mkdirSync(dir, { recursive: true });
  for (const viejo of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, viejo)); } catch { /* en uso */ } }
  const destino = path.join(dir, 'hub-' + Date.now() + path.extname(origen).toLowerCase());
  fs.copyFileSync(origen, destino);
  return { ok: true, url: 'file:///' + destino.replace(/\\/g, '/') };
}
ipcMain.handle('file:save-png', async (e, { dataUrl, suggestedName }) => {
  try {
    const r = await dialog.showSaveDialog(winOf(e), {
      defaultPath: path.join(app.getPath('downloads'), suggestedName || 'captura.png'),
      filters: [{ name: 'Imagen PNG', extensions: ['png'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    return { ok: true, path: r.filePath };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});


// ---------- Actualización automática (GitHub Releases) ----------
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
// Canal DEV: las versiones con sufijo "-dev" (p. ej. 2.6.0-dev.1) siguen su PROPIO
// canal (dev.yml) y solo reciben otras DEV. La versión estable (sin sufijo) sigue el
// canal por defecto (latest.yml). El ajuste "Actualizaciones dev" (devUpdates) deja
// que cualquier instalación se apunte al canal dev — o que una -dev vuelva a la
// estable, lo que exige permitir el "downgrade" (2.6.0-dev.1 → 2.5.10).
function applyUpdateChannel() {
  const isDevBuild = /-dev/i.test(app.getVersion());
  const wantDev = (typeof settings.devUpdates === 'boolean') ? settings.devUpdates : isDevBuild;
  autoUpdater.channel = wantDev ? 'dev' : 'latest';
  autoUpdater.allowPrerelease = wantDev;
  autoUpdater.allowDowngrade = !wantDev && isDevBuild;
}
applyUpdateChannel();
// Traduce cualquier error del updater a un mensaje CORTO y genérico. NUNCA expone rutas
// locales, el nombre de usuario ni stack traces (electron-updater los vuelca crudos, y
// eso filtraba datos como C:\Users\<usuario>\...). Solo se muestra este texto seguro.
function friendlyUpdateError(err) {
  const raw = String((err && err.message) || err || '');
  if (/50\d|gateway|time-?out|etimedout|enotfound|econnreset|econnrefused|getaddrinfo|network|socket|dns/i.test(raw)) return 'No se pudo conectar con el servidor de actualizaciones. Reinténtalo más tarde.';
  if (/404|cannot find|not found|artifact|latest\.yml/i.test(raw)) return 'La nueva versión aún se está publicando. Reinténtalo en unos minutos.';
  if (/sha512|checksum|integrity|signature/i.test(raw)) return 'La descarga de la actualización no coincide. Reinténtalo.';
  return 'No se pudo comprobar la actualización. Reinténtalo más tarde.';
}
/* ACTUALIZACIÓN AUTOMÁTICA DE LAS DOS LÍNEAS (Dosa, 2026-08-13 y 2026-08-18).
   Cada instalación sigue SU canal y se actualiza sola dentro de él: la estable
   recibe estables y NavirisDev recibe devs (quién apunta a qué lo decide
   applyUpdateChannel). Al detectar versión nueva se descarga en silencio y se
   instala al CERRAR el navegador — sin instalador a la vista y sin cortar la
   sesión de trabajo; si el navegador sigue abierto, se avisa con una
   notificación cuando ya está lista.

   Antes NavirisDev quedaba fuera y solo se actualizaba desde el selector del
   menú. Consecuencia real (2026-08-18): se publicó un arreglo en dev y ningún
   usuario de dev lo recibió — se quedaron con el fallo instalado esperando un
   gesto manual que nadie sabía que había que hacer. Regla de Dosa: quien usa
   dev recibe dev en automático, quien usa estable recibe estable, y la única
   interfaz de actualización es la notificación en tiempo real. */
let chequeoSilencioso = false;   // el arranque o el reloj, no una elección del usuario
let bajandoSolo = false;         // evita relanzar la descarga en cada aviso
/* Descargar sin preguntar solo si el usuario no lo ha apagado en Ajustes. Con
   el ajuste en manual el reloj sigue MIRANDO (para poder avisar de que hay
   versión nueva), pero no baja nada: el menú enseña "Actualizar a la X" y ahí
   decide él. */
function actualizacionSolaPermitida() {
  return app.isPackaged && settings.updatesAuto !== false;
}
autoUpdater.on('checking-for-update', () => broadcast('update:status', { state: 'checking' }));
autoUpdater.on('update-available', (info) => {
  const sola = chequeoSilencioso && actualizacionSolaPermitida();
  broadcast('update:status', { state: 'available', version: info.version, auto: sola });
  if (sola && !bajandoSolo) {
    bajandoSolo = true;
    // Si falla (sin red, release a medio publicar) no se avisa de nada: se
    // reintenta en el siguiente arranque. Un error de algo que el usuario no
    // ha pedido no debe interrumpirle.
    autoUpdater.downloadUpdate().catch(() => { bajandoSolo = false; });
  }
});
autoUpdater.on('update-not-available', (info) => broadcast('update:status', { state: 'latest', version: info.version }));
// Con una lista para instalar ya no se comprueba más: instalará al cerrar.
let updYaLista = false;
autoUpdater.on('update-downloaded', () => { updYaLista = true; });
autoUpdater.on('download-progress', (p) => broadcast('update:status', { state: 'downloading', percent: Math.round(p.percent), auto: bajandoSolo }));
autoUpdater.on('update-downloaded', (info) => broadcast('update:status', { state: 'downloaded', version: info.version, auto: bajandoSolo }));
autoUpdater.on('error', (err) => broadcast('update:status', { state: 'error', message: friendlyUpdateError(err), auto: bajandoSolo }));

/* LAS DOS LÍNEAS NO SE CRUZAN (regla de Dosa).
   Quien usa dev recibe dev; quien usa estable recibe estable. Hubo un intento
   (2026-08-24) de que una instalación dev saltara a la estable cuando esta era
   más nueva, con la idea de que "todos tengan la última". Fue un error: en dev
   te aparecía una notificación de una versión estable que no tiene nada que ver
   con lo que estás probando. Se quitó. Si hace falta que quien está en dev
   reciba algo, se publica en DEV. */

/* Comparador de versiones propio (2.7.5-dev.3 → [2,7,5,0,3]). El cuarto número
   pone la estable por delante de sus propias dev: 2.7.5 gana a 2.7.5-dev.9. */
function trozosVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z]+\.?(\d+))?$/.exec(String(v || ''));
  if (!m) return null;
  const pre = m[4] !== undefined;
  return [+m[1], +m[2], +m[3], pre ? 0 : 1, pre ? +m[4] : 0];
}
function esMasNueva(a, b) {
  const x = trozosVersion(a), y = trozosVersion(b);
  if (!x) return false;
  if (!y) return true;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
// Lo último que el selector le enseñó al usuario, con su tag, para instalar
// EXACTAMENTE eso y no lo que el actualizador decida por su cuenta.
let lineasVistas = { stable: null, dev: null };
// Las DOS líneas oficiales (Naviris estable y NavirisDev) tal y como están
// publicadas ahora mismo, para que el usuario elija desde cualquier versión.
ipcMain.handle('update:channels', async () => {
  try {
    const cab = { headers: { 'User-Agent': 'Naviris', Accept: 'application/vnd.github+json' } };
    const sirve = (r, dev) => {
      if (!r || r.draft) return null;
      const names = (r.assets || []).map((a) => a.name);
      if (!names.some((n) => /Setup.*\.exe$/i.test(n))) return null;
      if (!names.includes(dev ? 'dev.yml' : 'latest.yml')) return null; // sin feed, el updater no podría instalarla
      return { version: String(r.tag_name || '').replace(/^v/, ''), tag: String(r.tag_name || '') };
    };
    /* LA ESTABLE, POR SU PROPIO ENDPOINT (2026-08-13). Antes se pedía la LISTA
       y se buscaba dentro, pero la API pagina de 30 en 30 y con tantas
       versiones de desarrollo por medio la estable había caído al puesto 47:
       el selector decía "no publicada" teniéndola delante, y desde una
       instalación estable no había forma de reinstalar su propia línea.
       /releases/latest devuelve justo la última NO prerelease. */
    const [rEst, rLista] = await Promise.all([
      fetch('https://api.github.com/repos/DosaAKA2A/Naviris/releases/latest', cab),
      fetch('https://api.github.com/repos/DosaAKA2A/Naviris/releases?per_page=30', cab)
    ]);
    const estable = rEst.ok ? sirve(await rEst.json(), false) : null;
    /* LA DEV, POR VERSIÓN MÁS ALTA, NUNCA POR ORDEN DE LISTA (2026-08-13).
       La lista de releases de GitHub NO viene ordenada por fecha: con la 2.7.4
       recién publicada, la API devolvía la dev.11 y la dev.10 por DEBAJO de la
       dev.2, así que "la primera prerelease" era la dev.9 — el selector ofrecía
       una dev vieja y las dos últimas no había forma de bajarlas. */
    let dev = null;
    if (rLista.ok) {
      for (const r of await rLista.json()) {
        if (!r.prerelease) continue;
        const c = sirve(r, true);
        if (c && (!dev || esMasNueva(c.version, dev.version))) dev = c;
      }
    }
    if (!estable && !dev) throw new Error('GitHub no devolvió ninguna versión instalable');
    lineasVistas = { stable: estable, dev };
    return { ok: true, current: app.getVersion(), stable: estable, dev };
  } catch (e) { return { ok: false, message: friendlyUpdateError(e) }; }
});
// El usuario eligió LÍNEA explícitamente: se apunta el feed a esa línea y se
// permite bajar de versión (volver de NavirisDev a la estable es un downgrade).
ipcMain.handle('update:choose', async (_e, line) => {
  if (!app.isPackaged) return { state: 'dev' };
  chequeoSilencioso = false;
  const dev = line === 'dev';
  autoUpdater.channel = dev ? 'dev' : 'latest';
  autoUpdater.allowPrerelease = dev;
  /* SE INSTALA LO QUE SE ENSEÑÓ, NO LO QUE EL ACTUALIZADOR ENCUENTRE. Con el
     proveedor de GitHub, electron-updater vuelve a buscar por su cuenta cuál
     es la última release (por el feed atom) y esa búsqueda puede no coincidir
     con la versión que el selector acaba de mostrar. Apuntando el feed a la
     carpeta de descargas de ESE tag, lo que se baja es esa versión y ninguna
     otra: si el botón dice 2.7.5-dev.1, se instala 2.7.5-dev.1. */
  const elegida = lineasVistas[dev ? 'dev' : 'stable'];
  if (elegida && elegida.tag) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://github.com/DosaAKA2A/Naviris/releases/download/' + encodeURIComponent(elegida.tag) + '/',
      channel: dev ? 'dev' : 'latest'
    });
  }
  autoUpdater.allowDowngrade = true; // va DESPUÉS: el setter de channel lo toca
  try { await autoUpdater.checkForUpdates(); return { state: 'checking' }; }
  catch (e) { return { state: 'error', message: friendlyUpdateError(e) }; }
});
/* DESCARGA COMPLETA, NUNCA DIFERENCIAL. electron-updater intenta bajar solo
   los trozos que cambian comparando blockmaps; entre líneas distintas (de la
   estable a NavirisDev) esa comparación no tiene sentido y se queda colgada a
   medias — el sintoma que reporto el amigo de Dosa: "descargando 12%" y de ahi
   no pasa. Bajar los 86 MB enteros tarda un poco mas y termina siempre. */
autoUpdater.disableDifferentialDownload = true;
ipcMain.handle('update:download', async () => { try { await autoUpdater.downloadUpdate(); return { ok: true }; } catch (e) { return { ok: false, message: friendlyUpdateError(e) }; } });
/* INSTALACIÓN SIN INSTALADOR (petición de Dosa, 2026-08-17: "que se instale
   automáticamente al abrir pero sin abrir un instalador; eso provoca que mis
   usuarios pierdan interés en las actualizaciones").

   Dos piezas, y las dos hacen falta:
   - `oneClick: true` en package.json — el asistente con "Siguiente" y elección
     de carpeta desaparece; el instalador es una barra sin botones. Como es por
     usuario (perMachine: false) tampoco pide permisos de administrador.
   - los dos true de aquí: `isSilent` (no enseñar ni esa barra) e
     `isForceRunAfter` (volver a abrir Naviris al terminar). Sin el primero se
     seguiría viendo una ventana, que es justo lo que molestaba.

   PRECIO, sabido y aceptado: quien ya tenga Naviris instalado hará UNA última
   transición con el asistente actual (el instalador viejo es el que corre esa
   vez); a partir de ahí todas son silenciosas. Y las instalaciones nuevas ya no
   pueden elegir carpeta: eso es exactamente lo que se cambia por no tener
   ventana. */
ipcMain.on('update:install', () => autoUpdater.quitAndInstall(true, true));

/* ---------- Novedades tras actualizar ----------
   La otra mitad de la experiencia tipo Opera GX: si te actualizas sin enterarte,
   al abrir tienes que VER qué cambió. Se compara la versión guardada con la que
   está corriendo; si no coinciden, la próxima interfaz que arranque enseña el
   panel. La versión se apunta aquí mismo, así el panel sale UNA sola vez aunque
   se abran varias ventanas. */
let novedadesPendientes = null;
function revisaVersionInstalada() {
  const actual = app.getVersion();
  const previa = settings.versionVista;
  // Solo en la versión instalada, y nunca en el primer arranque de todos (ahí
  // no hay "novedades": es una instalación nueva, no una actualización).
  if (app.isPackaged && previa && previa !== actual) novedadesPendientes = { version: actual, anterior: previa };
  if (previa !== actual) { settings.versionVista = actual; saveSettings(settings); }
}
/* Las notas salen de la release de GitHub, que ya se generan solas al publicar
   (generate_release_notes en build/publish-release.js). Si no se pueden traer
   (sin red, release recién publicada), el panel se enseña igual con la versión:
   enterarte de que Naviris cambió es lo importante, el detalle es un extra. */
ipcMain.handle('update:novedades', async () => {
  const pend = novedadesPendientes;
  if (!pend) return null;
  novedadesPendientes = null; // una vez por arranque
  let notas = '';
  try {
    const r = await fetch('https://api.github.com/repos/DosaAKA2A/Naviris/releases/tags/v' + encodeURIComponent(pend.version),
      { headers: { 'User-Agent': 'Naviris', Accept: 'application/vnd.github+json' } });
    if (r.ok) notas = String((await r.json()).body || '');
  } catch {}
  return { version: pend.version, anterior: pend.anterior, notas };
});

// El tema del navegador se propaga a las webs: con modo claro activo, las
// páginas que respetan prefers-color-scheme (YouTube, Outlook…) también
// renderizan en claro. nativeTheme afecta a TODOS los webContents, webviews incluidos.
nativeTheme.themeSource = settings.lightMode ? 'light' : 'dark';

app.whenReady().then(async () => {
  // Lo PRIMERO que ocurre: el cuadrado ya está en pantalla mientras el resto
  // del arranque (que es lo que tarda) sigue su curso por detrás.
  crearSplash();
  splashProgreso(12);
  // Widevine (castlabs ECS): descargar/registrar el CDM antes de crear ventanas,
  // para poder reproducir vídeo DRM (Crunchyroll, Netflix, etc.). Con Electron
  // estándar `components` no existe; el guard evita romper ese caso.
  // Es el tramo más lento del arranque (la primera vez incluso descarga el CDM).
  try { if (components && components.whenReady) await components.whenReady(); }
  catch (e) { console.log('[Naviris] Widevine no disponible:', e && e.message); }
  splashProgreso(48);
  // Comprobación silenciosa al arrancar (solo en versión instalada): cada
  // línea baja la suya y se instala al cerrar. Y MIENTRAS el navegador siga
  // abierto se vuelve a mirar cada 2 horas: antes solo se miraba al arrancar,
  // y quien no cierra nunca el navegador no se enteraba de nada — publicamos
  // un arreglo y los usuarios con la sesión abierta se quedaron con el fallo
  // (2026-08-18). Al encontrarla, la notificación de "lista" sale en vivo.
  if (app.isPackaged) {
    const mira = () => { if (updYaLista) return; chequeoSilencioso = true; autoUpdater.checkForUpdates().catch(() => {}); };
    mira();
    setInterval(mira, 2 * 3600 * 1000);
  }
  // ¿Se actualizó desde la última vez? Entonces la interfaz enseñará qué cambió.
  revisaVersionInstalada();
  limpiaRestosRat();
  braveAdblock.init();
  splashProgreso(62);
  // naviris-addon://tool/<id>.js — el código de un addon INSTALADO Y ACTIVO.
  // El id se valida contra la lista de instalados y se limita a [a-z0-9-], así
  // que no hay forma de salirse de la carpeta de addons ni de cargar otra cosa.
  protocol.handle(ADDON_SCHEME, async (req) => {
    try {
      const id = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, '')).replace(/\.js$/, '');
      if (!/^[a-z0-9-]+$/.test(id)) return new Response('', { status: 400 });
      const meta = settings.addons && settings.addons[id];
      if (!meta || !meta.enabled) return new Response('', { status: 404 });
      const code = await fs.promises.readFile(addonFile(id), 'utf8');
      return new Response(code, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
    } catch { return new Response('', { status: 404 }); }
  });
  setupSession(session.fromPartition(PART_NORMAL));
  setupSession(session.fromPartition(PART_PRIVATE));
  // Contenedores: cada uno es una sesión aparte, así que necesita EXACTAMENTE la
  // misma preparación que la normal (identidad, cabeceras, adblock, permisos).
  // Si no, un contenedor navegaría con otra identidad y otras reglas, que es el
  // tipo de incoherencia que ya costó las verificaciones de Cloudflare.
  for (const p of contenedoresGuardados()) preparaContenedor(p);
  for (const e of (settings.espacios || [])) if (e.particion) preparaContenedor(e.particion);
  splashProgreso(74);
  /* Sin el menú de aplicación por defecto de Electron (2026-11-03). Estaba vivo
     aunque oculto (File/Edit/View/Window) y sus aceleradores actuaban cuando la
     interfaz no se quedaba la tecla: Ctrl+M minimizaba, Ctrl+R recargaba la
     INTERFAZ entera y Ctrl+Mayús+I le abría DevTools. Los atajos de Naviris
     están todos en atajos.js; en Windows copiar y pegar en los campos no
     dependen del menú. */
  Menu.setApplicationMenu(null);
  const principal = createWindow(false, true); // la primera ventana es la que releva al splash
  // Lo que traía el arranque (o llegó mientras): pestañas nuevas detrás de la sesión restaurada.
  if (paraLaPrimera.length) urlPendiente.set(principal.id, paraLaPrimera.map((url) => ({ url, contenedor: null })));
  paraLaPrimera = null;
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const { app, BrowserWindow, ipcMain, shell, nativeTheme, session, net, clipboard, safeStorage, dialog, components, protocol, Menu, screen, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const braveAdblock = require('./adblock');

const PART_NORMAL = 'persist:cobalt';
const PART_PRIVATE = 'cobalt-private'; // sin "persist:" → solo en memoria

// Los addons de herramienta se sirven por un esquema propio en vez de ejecutarse
// con new Function(): la CSP de la interfaz privilegiada NO lleva 'unsafe-eval'
// (a propósito, ver SEGURIDAD.md) y eso hacía que ningún addon llegara a cargar.
// Con esquema propio la CSP sigue estricta y además solo se puede cargar código
// de addons instalados y activos: un XSS no puede inventarse un script.
// registerSchemesAsPrivileged tiene que ir ANTES de que la app esté lista.
const ADDON_SCHEME = 'naviris-addon';
protocol.registerSchemesAsPrivileged([
  { scheme: ADDON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Migración de perfil: el rebrand Cobalt→Naviris cambia la carpeta de userData,
// así que si existe el perfil antiguo y no el nuevo, se renombra para conservar
// sesiones, contraseñas y ajustes de los usuarios existentes.
try {
  const oldProfile = path.join(app.getPath('appData'), 'Cobalt');
  const newProfile = path.join(app.getPath('appData'), 'Naviris');
  if (fs.existsSync(oldProfile) && !fs.existsSync(newProfile)) fs.renameSync(oldProfile, newProfile);
} catch (e) { console.log('[Naviris] No se pudo migrar el perfil:', e.message); }

// ---------- Rutas de binarios (yt-dlp / ffmpeg) ----------
// Desde v2.2.3 los binarios NO van en el instalador (~100 MB menos): se
// descargan a userData/bin la primera vez que se usa el Rat Tool. Las
// instalaciones antiguas que ya los traían en resources/bin los siguen usando.
function binDir() {
  if (!app.isPackaged) return path.join(__dirname, '..', 'resources', 'bin');
  const legacy = path.join(process.resourcesPath, 'bin');
  if (fs.existsSync(path.join(legacy, 'yt-dlp.exe'))) return legacy;
  return path.join(app.getPath('userData'), 'bin');
}
const ytDlpPath = () => path.join(binDir(), 'yt-dlp.exe');
const ffmpegPath = () => path.join(binDir(), 'ffmpeg.exe');

const BIN_YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const BIN_FFMPEG_URL = 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip';

function downloadTo(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    req.on('response', (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (c) => { got += c.length; file.write(c); if (total && onProgress) onProgress(got / total); });
      res.on('end', () => file.end(() => resolve()));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

let binsPromise = null;
function ensureBins() {
  const missing = ['yt-dlp.exe', 'ffmpeg.exe'].filter((b) => !fs.existsSync(path.join(binDir(), b)));
  if (!missing.length) return Promise.resolve(true);
  if (binsPromise) return binsPromise;
  binsPromise = (async () => {
    const dir = binDir();
    fs.mkdirSync(dir, { recursive: true });
    // Aparece como una descarga normal en el panel, con su progreso
    const meta = { id: 'naviris-bins', name: 'Motor de descargas de Naviris (solo la primera vez)', percent: 0, state: 'progressing', kind: 'video' };
    broadcast('download:new', meta);
    try {
      if (missing.includes('yt-dlp.exe')) {
        await downloadTo(BIN_YTDLP_URL, path.join(dir, 'yt-dlp.exe'), (p) => { meta.percent = Math.round(p * 25); broadcast('download:update', meta); });
      }
      if (missing.includes('ffmpeg.exe')) {
        const zip = path.join(dir, 'ffmpeg.zip');
        await downloadTo(BIN_FFMPEG_URL, zip, (p) => { meta.percent = 25 + Math.round(p * 70); broadcast('download:update', meta); });
        const tmp = path.join(dir, '_ff');
        require('child_process').execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${tmp}'"`, { windowsHide: true });
        const findFf = (d) => {
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const fp = path.join(d, f.name);
            if (f.isDirectory()) { const r = findFf(fp); if (r) return r; }
            else if (f.name === 'ffmpeg.exe') return fp;
          }
          return null;
        };
        const found = findFf(tmp);
        if (!found) throw new Error('ffmpeg no encontrado en el zip');
        fs.copyFileSync(found, path.join(dir, 'ffmpeg.exe'));
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(zip, { force: true });
      }
      meta.percent = 100; meta.state = 'completed'; broadcast('download:update', meta);
      return true;
    } catch (e) {
      meta.state = 'failed'; meta.error = 'No se pudo preparar el motor de descargas: ' + e.message;
      broadcast('download:update', meta);
      binsPromise = null; // permite reintentar
      return false;
    }
  })();
  return binsPromise;
}

// ---------- Ajustes persistentes ----------
const settingsPath = () => path.join(app.getPath('userData'), 'cobalt-settings.json');

const DEFAULT_SETTINGS = {
  hardwareAcceleration: true,
  powerSaver: true,
  adblockEnabled: true,
  adblockWhitelist: [],
  agentMode: false,
  smartSearch: true,        // autocompletado inteligente de la barra
  xRevealSensitive: false,  // mostrar contenido sensible en X/Twitter
  moovinPase: '',             // pase de la biblioteca privada de iris.it.com/moovin
  atajos: true,             // atajos de teclado (Ctrl+T, Ctrl+W…); F11 y F12 no se tocan
  mouseNav: true,           // botones laterales del ratón para atrás/adelante
  blockPasskeys: true,      // evita el prompt de Windows Hello (claves de acceso)
  restoreSession: true,     // reabre las pestañas de la sesión anterior al iniciar
  lightMode: false,         // tema claro de la interfaz
  devUpdates: null,         // canal de actualizaciones: null = según la versión instalada; true/false = elección del usuario
  permissions: {},          // decisiones de permisos por sitio: "origin|tipo" -> allow|block
  addons: {}                // addons instalados: id -> { name, version, kind, matches, enabled, ... }
};

// Registra un autenticador virtual (vía CDP interno) para que las peticiones
// WebAuthn no invoquen Windows Hello. Método estándar de Playwright/Puppeteer.
function suppressWebAuthn(contents) {
  // Con el modo agente activo, el depurador lo usa el agente externo: no atacamos aquí.
  if (!settings.blockPasskeys || settings.agentMode) return;
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
  } catch { return; }
  contents.debugger.sendCommand('WebAuthn.enable')
    .then(() => contents.debugger.sendCommand('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
    }))
    .then((r) => console.log('[Naviris] Autenticador virtual registrado (Windows Hello desactivado):', r && r.authenticatorId))
    .catch((e) => console.log('[Naviris] WebAuthn suppress error:', e.message));
}

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
const YT_ADSKIP = `(function(){
  if(window.__cobaltYTtidy)return; window.__cobaltYTtidy=1;
  function tidy(){
    try{
      ['.ytp-ad-skip-button','.ytp-ad-skip-button-modern','.ytp-skip-ad-button','.ytp-ad-overlay-close-button'].forEach(function(s){ var b=document.querySelector(s); if(b) b.click(); });
      var enf=document.querySelector('ytd-enforcement-message-view-model');
      if(enf){ var dlg=enf.closest('tp-yt-paper-dialog'); if(dlg) dlg.remove(); else enf.remove(); document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function(b){ b.remove(); }); document.documentElement.style.overflow=''; var v=document.querySelector('video'); if(v&&v.paused){ try{v.play();}catch(e){} } }
    }catch(e){}
  }
  setInterval(tidy,700);
  try{ new MutationObserver(tidy).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
})();`;
// OJO con lo que se oculta: aquí estaban .ytp-ad-module y .video-ads, que son el
// módulo de anuncios DENTRO del reproductor. Ocultarlos no impide que el anuncio se
// reproduzca: solo lo hace invisible. Cuando el pruning fallaba, el resultado era un
// vídeo en negro 20-30 s que el usuario no entendía y, peor, el botón de saltar vive
// ahí dentro, así que tampoco podía saltarlo a mano. Se quedan fuera a propósito: si
// un anuncio se cuela, es preferible verlo y poder saltarlo. Lo que sigue oculto son
// los anuncios de la interfaz (feed, sidebar, banners), que no bloquean nada.
const YT_ADCSS = '#masthead-ad,ytd-ad-slot-renderer,ytd-promoted-video-renderer,ytd-display-ad-renderer,ytd-companion-slot-renderer,#player-ads,ytd-in-feed-ad-layout-renderer,ytd-ads-engagement-panel-content-renderer,#related ytd-ad-slot-renderer{display:none!important}';
// Revela contenido sensible en X/Twitter
const X_REVEAL = `(function(){
  if(window.__cobaltX)return; window.__cobaltX=1;
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
  if(window.__cobaltTwAd)return; window.__cobaltTwAd=1;
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

function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {
    console.error('No se pudieron guardar los ajustes:', e);
  }
}

// Perfil alternativo por CLI (dev/pruebas): --user-data-dir=<carpeta> corre una
// segunda instancia totalmente aislada sin tocar el perfil real del usuario.
// Electron NO honra ese switch de Chromium por sí solo; hay que redirigir userData.
const perfilCli = process.argv.find((a) => a.startsWith('--user-data-dir='));
if (perfilCli) app.setPath('userData', perfilCli.slice('--user-data-dir='.length));

let settings = loadSettings();

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
if (settings.agentMode) app.commandLine.appendSwitch('remote-debugging-port', '9223');

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
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
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

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

// ---------- Descargas ----------
let downloadSeq = 0;
const downloads = new Map(); // id → { item, meta }

function registerDownloadItem(item, sourceUrl) {
  const dir = app.getPath('downloads');
  let name = item.getFilename() || 'descarga';
  let candidate = path.join(dir, name);
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  item.setSavePath(candidate);

  const id = 'dl' + (++downloadSeq);
  const meta = {
    id,
    name: path.basename(candidate),
    path: candidate,
    total: item.getTotalBytes(),
    received: 0,
    state: 'progressing',
    kind: 'file',
    source: sourceUrl || item.getURL()
  };
  downloads.set(id, { item, meta });
  broadcast('download:new', meta);

  item.on('updated', (_e, state) => {
    meta.received = item.getReceivedBytes();
    meta.total = item.getTotalBytes();
    meta.state = state === 'interrupted' ? 'interrupted' : 'progressing';
    broadcast('download:update', meta);
  });
  item.once('done', (_e, state) => {
    meta.state = state; // completed | cancelled | interrupted
    meta.received = item.getReceivedBytes();
    if (state === 'completed') recordDlHistory(meta.path);
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
  try { fs.writeFileSync(dlHistoryPath(), JSON.stringify(dlHistory), 'utf8'); } catch {}
}

// Solo anuncios/telemetría puros. NO se tocan rutas del reproductor
// (/youtubei/v1/player, /get_midroll_info, videoplayback…): bloquearlas hacía
// que el vídeo no cargara o disparaba el anti-adblock. El salto real es en cliente.
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
ipcMain.on('ua:hints', (e) => { e.returnValue = UA_CH; });

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
ipcMain.on('ua:idiomas', (e) => { e.returnValue = idiomasLista(); });

/* Estado REAL de un permiso para el sitio que pregunta: 'allow', 'block' o
   'prompt' si aún no se ha decidido.
   Hace falta porque setPermissionCheckHandler de Electron solo sabe decir sí o
   no, y al responder "no" a algo que en realidad está SIN decidir, la página
   leía Notification.permission === 'denied'. Eso no es solo una huella rara:
   muchas webs ni siquiera piden el permiso si lo ven denegado, así que el
   diálogo de Naviris no llegaba a salir nunca y la persona no podía conceder
   notificaciones aunque quisiera. El preload usa esto para contar la verdad. */
ipcMain.on('perm:estado', (e, permiso) => {
  let origen = '';
  try { origen = originOf(e.senderFrame.url); } catch { /* nada */ }
  const guardado = origen ? settings.permissions[origen + '|' + permiso] : undefined;
  e.returnValue = guardado === 'allow' ? 'allow' : guardado === 'block' ? 'block' : 'prompt';
});

/* Dominios de verificación anti-robot. NO se bloquean nunca: bloquearlos no
   quita publicidad, solo hace que el sitio pida el captcha una y otra vez.
   Ver el comentario largo dentro de onBeforeRequest. */
const ES_VERIFICACION = /^https?:\/\/([^/]*\.)?(awswaf\.com|challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\.net)(\/|$|:)/i;

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
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (!settings.adblockEnabled || details.resourceType === 'mainFrame' || isWhitelisted(details.referrer)) {
      return callback({});
    }
    const u = details.url;
    // No romper Spotify: su reproductor exige que el hueco publicitario cargue
    // (metadatos y audio del anuncio); si el motor le corta esas peticiones se
    // queda esperando una respuesta que nunca llega y se congela TODO el player
    // al tocar anuncio. Mismo criterio que con YouTube: por red no se le
    // bloquea nada, el anuncio se quita en cliente (el addon Blockify lo salta
    // o lo silencia).
    try {
      const refHost = new URL(details.referrer || '').hostname;
      if (hostMatches(refHost, 'spotify.com') || hostMatches(refHost, 'open.spotify.com')) return callback({});
    } catch { /* sin referrer válido */ }
    // (el vídeo de googlevideo, y youtube.com/generate_204, /api/stats/qoe|watchtime|atr,
    // /youtubei/). Bloquearlos rompe la reproducción —sobre todo Shorts— y provoca
    // cargas lentas por reintentos. Los anuncios de YouTube se quitan con el pruning del
    // player (webview-preload.js), no bloqueando red. Verificado: era lo que rompía Shorts.
    if (/\.googlevideo\.com\//i.test(u) || /(^|\.)youtube(-nocookie)?\.com\/(generate_204|api\/stats\/(qoe|watchtime|atr|playback)|youtubei\/)/i.test(u)) {
      return callback({});
    }
    // Rutas de anuncios/seguimiento de YouTube (no toca 'videoplayback', así que no ralentiza)
    if (YT_AD_PATHS.some((p) => u.includes(p))) { blockedCount++; return callback({ cancel: true }); }
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
    // Motor de Brave (adblock-rust + listas de Brave). Si aún no está listo,
    // decide el fallback clásico por dominios.
    const brave = braveAdblock.shouldBlock(details);
    if (brave !== null) {
      if (brave) { blockedCount++; return callback({ cancel: true }); }
      return callback({});
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
  const HDR_URLS = [...CORS_OPEN.map((h) => 'https://' + h + '/*'), 'https://*.youtube.com/*', 'https://*.youtube-nocookie.com/*'];
  ses.webRequest.onHeadersReceived({ urls: HDR_URLS }, (details, cb) => {
    let host = ''; try { host = new URL(details.url).hostname; } catch { /* nada */ }
    // YouTube ya NO necesita que le borremos la CSP. Se hacía porque el pruning se
    // inyectaba con un <script> inline, que la CSP con nonce rechazaba; desde que va
    // por contextBridge.executeInMainWorld (webview-preload.js) la CSP le da igual.
    // Borrarla dejaba a todo YouTube sin su política de seguridad mientras el
    // adblock estuviera activo, que es un precio alto por un truco de inyección.
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return cb({});
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (/^access-control-allow-(origin|methods|headers)$/i.test(k)) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    cb({ responseHeaders: headers });
  });

  ses.on('will-download', (_e, item) => registerDownloadItem(item));
  /* SESIONES QUE NO SE PIERDEN (2026-08-13). Chromium guarda las cookies en
     memoria y las vuelca al disco cuando le parece: si el proceso muere de
     golpe (cierre forzado, cuelgue, corte de luz) se pierde lo escrito desde
     el ultimo volcado — y eso se ve como "me ha cerrado la sesion" en sitios
     donde acababas de entrar. Se fuerza el volcado cada pocos minutos y al
     salir, que es barato y evita justo ese susto. */
  const vuelca = () => { try { ses.cookies.flushStore(); } catch { /* nada */ } };
  setInterval(vuelca, 3 * 60 * 1000);

  /* ===== SESIONES QUE SOBREVIVEN AL CIERRE (2026-08-13) =====
     A Dosa se le cerraba la sesión de Spotify al cerrar Naviris, y SOLO la de
     Spotify. Comprobado en disco con la app cerrada: faltaba sp_dc, mientras
     las de X y YouTube seguían ahí. La explicación: sp_dc es una cookie DE
     SESIÓN (sin fecha de caducidad), y esas Chromium las tira al salir. Las de
     X y YouTube son persistentes, por eso aguantaban.

     Chrome no las tira si tienes activado "Continuar donde lo dejaste": ese
     ajuste conserva las cookies de sesión entre arranques. Electron no trae
     ese comportamiento, así que se implementa aquí — y se hace SOLO si el
     ajuste equivalente de Naviris está activo, porque es su significado: si
     pides continuar donde lo dejaste, la sesión de tus webs forma parte de
     eso. Con el ajuste apagado, cerrar sigue cerrando sesiones.

     Cómo: al salir, las cookies marcadas como de sesión se vuelven a escribir
     con caducidad de 30 días. Es lo mismo que hace Chrome de facto. */
  const DIAS_SESION = 30;
  let conservando = false;
  async function conservaSesiones() {
    if (settings.restoreSession === false) return;
    const todas = await ses.cookies.get({});
    const caduca = Math.floor(Date.now() / 1000) + DIAS_SESION * 24 * 60 * 60;
    let n = 0;
    for (const c of todas) {
      if (!c.session) continue;                    // las persistentes ya aguantan
      const host = (c.domain || '').replace(/^\./, '');
      if (!host) continue;
      const url = (c.secure ? 'https://' : 'http://') + host + (c.path || '/');
      try {
        await ses.cookies.set({
          url, name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
          expirationDate: caduca
        });
        n++;
      } catch { /* alguna cookie rara se resistirá; no vale la pena romper el cierre */ }
    }
    try { await ses.cookies.flushStore(); } catch { /* nada */ }
    if (n) console.log(`[Naviris] ${n} cookies de sesión conservadas para el próximo arranque`);
  }
  app.on('before-quit', (e) => {
    vuelca();
    if (conservando) return;                       // segunda pasada: dejar salir
    e.preventDefault();                            // el guardado es asíncrono
    conservando = true;
    conservaSesiones().catch(() => {}).finally(() => app.quit());
  });
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
    if (AUTO_ALLOW.has(permission)) return callback(true);
    const key = origin + '|' + permission;
    const saved = settings.permissions[key];
    if (saved === 'allow') return callback(true);
    if (saved === 'block') return callback(false);
    if (!SENSITIVE.has(permission)) return callback(false); // desconocido/no listado → denegar por seguridad
    // Preguntar al usuario
    const id = 'perm' + (++permSeq);
    permPending.set(id, { callback, key });
    const mediaTypes = (details && details.mediaTypes) || [];
    broadcast('perm:ask', { id, origin, permission, mediaTypes });
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true;
    return settings.permissions[originOf(requestingOrigin) + '|' + permission] === 'allow';
  });
}

ipcMain.on('perm:respond', (_e, { id, decision, remember }) => {
  const pend = permPending.get(id);
  if (!pend) return;
  permPending.delete(id);
  const allow = decision === 'allow';
  if (remember) { settings.permissions[pend.key] = allow ? 'allow' : 'block'; saveSettings(settings); }
  pend.callback(allow);
});
ipcMain.handle('perm:list', () => settings.permissions);
ipcMain.handle('perm:remove', (_e, key) => { delete settings.permissions[key]; saveSettings(settings); return settings.permissions; });
ipcMain.handle('perm:clear', () => { settings.permissions = {}; saveSettings(settings); return settings.permissions; });
ipcMain.handle('sec:status', () => ({
  sandbox: true,                                                   // sandbox activado en cada webview
  siteIsolation: !app.commandLine.hasSwitch('disable-site-isolation-trials'), // Chromium: por defecto activo
  httpsUpgrades: true                                             // auto-subida http→https
}));

// ---------- yt-dlp: vídeo y audio (mp3) ----------
const ytJobs = new Map(); // id → child process

function ytDownload({ url, mode, quality }) {
  const id = 'yt' + (++downloadSeq);
  const outDir = app.getPath('downloads');
  const meta = {
    id, name: 'Obteniendo información…', path: outDir, total: 0, received: 0,
    percent: 0, state: 'progressing', kind: mode === 'audio' ? 'audio' : 'video', source: url
  };
  downloads.set(id, { meta });
  broadcast('download:new', meta);

  if (!fs.existsSync(ytDlpPath())) {
    meta.state = 'interrupted';
    meta.name = 'yt-dlp no encontrado';
    broadcast('download:update', meta);
    return id;
  }

  const outTmpl = path.join(outDir, '%(title).120s [%(id)s].%(ext)s');
  const common = ['--no-playlist', '--newline', '--no-part', '--ffmpeg-location', ffmpegPath(), '-o', outTmpl];
  const isTikTok = /tiktok\.com/.test(url);
  let args;
  if (mode === 'audio') {
    args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', ...common, url];
  } else if (isTikTok) {
    // TikTok = archivo único sin marca de agua (play_addr); sin merge para evitar errores
    args = ['-f', 'b', '--force-overwrites', ...common, url];
  } else {
    // Vídeo: por defecto la máxima calidad; si se pide una resolución, se limita a
    // esa altura (p. ej. 720 => hasta 720p). Mejor vídeo + mejor audio, contenedor mp4.
    const h = parseInt(quality, 10);
    const sel = h > 0 ? `bv*[height<=${h}]+ba/b[height<=${h}]/b` : 'bv*+ba/b';
    args = ['-f', sel, '-S', 'res,fps,ext:mp4:m4a', '--merge-output-format', 'mp4', ...common, url];
  }

  const child = spawn(ytDlpPath(), args, { windowsHide: true });
  ytJobs.set(id, child);

  let lastPct = 0, lastError = '';
  const setFile = (p) => { const full = p.trim().replace(/^"|"$/g, ''); meta.path = full; meta.name = path.basename(full); };
  const handle = (buf) => {
    const text = buf.toString();
    const dest = text.match(/(?:\[download\]|\[ExtractAudio\])\s+Destination:\s*(.+)/);
    if (dest) setFile(dest[1]);
    const merge = text.match(/Merging formats into "(.+?)"/);
    if (merge) setFile(merge[1]);
    const dl = text.match(/\[download\]\s+([\d.]+)%/);
    if (dl) {
      meta.percent = parseFloat(dl[1]);
      const size = text.match(/of\s+~?\s*([\d.]+)(K|M|G)iB/);
      if (size) {
        const mult = { K: 1024, M: 1048576, G: 1073741824 }[size[2]];
        meta.total = Math.round(parseFloat(size[1]) * mult);
        meta.received = Math.round(meta.total * meta.percent / 100);
      }
      if (Math.abs(meta.percent - lastPct) >= 1) { lastPct = meta.percent; broadcast('download:update', meta); }
    }
    if (/\[ExtractAudio\]|\[Merger\]/.test(text)) { meta.name = meta.name.replace(/\.(webm|m4a|mp4)$/, mode === 'audio' ? '.mp3' : '.mp4'); broadcast('download:update', meta); }
    const err = text.match(/ERROR:\s*(.+)/);
    if (err) lastError = err[1].trim();
  };
  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
  child.on('error', (e) => { lastError = e.message; });
  child.on('close', (code) => {
    ytJobs.delete(id);
    meta.state = code === 0 ? 'completed' : 'interrupted';
    meta.percent = code === 0 ? 100 : meta.percent;
    if (code !== 0) { meta.error = lastError || 'yt-dlp terminó con código ' + code; if (meta.name === 'Obteniendo información…') meta.name = 'Error: ' + (lastError || 'no se pudo descargar').slice(0, 80); }
    if (code === 0 && meta.path) {
      // Tras ExtractAudio/Merger el nombre cambia de extensión pero meta.path no
      const fin = path.join(path.dirname(meta.path), meta.name);
      recordDlHistory(fs.existsSync(fin) ? fin : meta.path);
    }
    broadcast('download:update', meta);
  });
  return id;
}

/* ---------- Ventana de arranque ----------
   PETICIÓN DE DOSA (2026-08-17): "la ventana de Naviris al cargar sigue siendo
   muy grande, debe ser solo un cuadrado con el logo y una pequeña barra de carga
   que se aprecia de inicio a fin".

   La placa cuadrada ya existía, pero vivía DENTRO de la ventana principal, que
   se abre a 1280×800: lo que se veía era una ventana enorme con una plaquita
   flotando en medio. Ahora el arranque es una ventana propia de 300×300 y la
   principal no se muestra hasta que su interfaz está montada.

   La barra avanza con hitos REALES del arranque (no por animación), y el splash
   se queda un mínimo en pantalla para que se recorra entera aunque el equipo
   arranque en frío o en caliente. */
let splashWin = null;
let splashPct = 0;          // último tramo, por si el splash aún no ha cargado
let splashDesde = 0;        // cuándo se mostró: sirve para el mínimo en pantalla
const SPLASH_MINIMO = 1250; // ms que la barra necesita para leerse de inicio a fin

function crearSplash() {
  splashWin = new BrowserWindow({
    width: 300, height: 300, resizable: false, movable: true,
    frame: false, transparent: false, backgroundColor: '#08080a',
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
  splashWin.loadFile(path.join(__dirname, 'splash.html'));
  splashWin.once('ready-to-show', () => {
    if (!splashWin || splashWin.isDestroyed()) return;
    splashDesde = Date.now();
    splashWin.show();
  });
  // El tramo que ya se hubiera cumplido antes de que la página existiera
  splashWin.webContents.once('did-finish-load', () => splashProgreso(splashPct));
  splashWin.on('closed', () => { splashWin = null; });
}

function splashProgreso(pct) {
  splashPct = Math.max(splashPct, pct);
  if (!splashWin || splashWin.isDestroyed()) return;
  try { splashWin.webContents.send('splash:progreso', { pct: splashPct, version: app.getVersion() }); } catch {}
}

// Cierra el arranque y enseña la ventana ya montada. El relevo se hace en este
// orden (primero mostrar, luego cerrar) para que no se vea el escritorio entre
// una y otra.
function cerrarSplash(win) {
  const espera = Math.max(0, SPLASH_MINIMO - (Date.now() - splashDesde));
  setTimeout(() => {
    splashProgreso(100);
    // Lo justo para que el último tramo de la barra se vea llegar al final
    setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus(); }
      if (splashWin && !splashWin.isDestroyed()) splashWin.close();
    }, 260);
  }, espera);
}

// La ventana principal que está esperando a que su interfaz termine de montarse
let ventanaEsperandoUI = null;
// El renderer avisa cuando la interfaz ya está en pantalla (pestañas, hub y
// tema aplicados). Es el único hito que sabe de verdad que "ya se puede ver".
ipcMain.on('ui:listo', (e) => {
  // La ventana que acaba de montarse puede traer una pestaña sacada de otra.
  const suya = BrowserWindow.fromWebContents(e.sender);
  if (suya && urlPendiente.has(suya.id)) {
    const url = urlPendiente.get(suya.id);
    urlPendiente.delete(suya.id);
    e.sender.send('tab:open-url', { url, background: false });
  }
  const win = ventanaEsperandoUI;
  if (!win) return;
  ventanaEsperandoUI = null;
  cerrarSplash(win);
});

// ---------- Ventanas ----------
function createWindow(isPrivate = false, conSplash = false) {
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
  win.webContents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.sandbox = true;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.preload = path.join(__dirname, 'webview-preload.js');
    webPreferences.backgroundThrottling = false; // AutoLoot: NO frenar timers/vídeo en segundo plano (el tiempo de drops debe seguir contando)
    /* NADA DE alert/confirm/prompt EN LAS WEBS (2026-08-13). Esos diálogos son
       modales NATIVOS colgados de nuestra ventana: mientras uno está abierto,
       la ventana entera deja de aceptar clics. Y en una ventana sin marco como
       la de Naviris el modal a veces ni se dibuja donde debería, así que el
       navegador simplemente parecía congelado — el fallo que reportó Dosa al
       abrir enlaces desde X, que suelen acabar en páginas basura que abusan de
       alert(). Con esto la web se queda sin ellos: alert no hace nada, confirm
       devuelve false y prompt null.
       PRECIO: una web legítima que pregunte "¿seguro que quieres borrar?" se
       comporta como si dijeras que no, y al cerrar una pestaña ya no salta el
       aviso de "puede que los cambios no se guarden". A cambio, ninguna página
       puede volver a bloquear el navegador. */
    webPreferences.disableDialogs = true;
  });
  win.loadFile(path.join(__dirname, 'index.html'), isPrivate ? { query: { private: '1' } } : undefined);
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

// Atajos con el foco DENTRO de la página: cuando el usuario ha hecho clic en la
// web, las teclas van al webview y el listener del renderer no las ve nunca (de
// ahí el "F5 funciona a veces sí y a veces no"). Aquí se interceptan antes de
// que lleguen a la página y se reenvían a la interfaz.
const ATAJOS_UI = [
  { k: 'F5', mod: (i) => !i.control && !i.shift, cmd: 'reload' },
  { k: 'F5', mod: (i) => i.shift || i.control, cmd: 'reload-hard' },
  { k: 'r', mod: (i) => i.control && !i.shift, cmd: 'reload' },
  { k: 'r', mod: (i) => i.control && i.shift, cmd: 'reload-hard' },
  { k: 'F11', mod: () => true, cmd: 'fullscreen' },
  { k: 'F6', mod: () => true, cmd: 'focus-url' },
  { k: 'l', mod: (i) => i.control, cmd: 'focus-url' },
  { k: 't', mod: (i) => i.control && !i.shift, cmd: 'new-tab' },
  { k: 't', mod: (i) => i.control && i.shift, cmd: 'reopen-tab' },
  { k: 'w', mod: (i) => i.control && !i.shift, cmd: 'close-tab' },
  { k: 'p', mod: (i) => i.alt && !i.control, cmd: 'pip' },
  // Reservado para los addons (ver naviris.onAtajo en el renderer). Sin esto un
  // atajo de addon solo respondería con el foco en la interfaz, nunca leyendo
  // una página, que es justo cuando hace falta.
  { k: 's', mod: (i) => i.alt && !i.control && !i.shift, cmd: 'addon-s' },
  // Buscar en la pagina. Tiene que estar AQUI y no solo en el renderer: con el
  // foco dentro de una web las teclas no llegan a la ventana de Naviris, y
  // leyendo una pagina es justo cuando se usa Ctrl+F.
  { k: 'f', mod: (i) => i.control && !i.shift && !i.alt, cmd: 'find' },
  { k: 'F3', mod: () => true, cmd: 'find' },
  { k: 'j', mod: (i) => i.control, cmd: 'downloads' },
  { k: 'h', mod: (i) => i.control, cmd: 'history' },
  { k: 'd', mod: (i) => i.control && !i.shift, cmd: 'bookmark' },
  { k: 'ArrowLeft', mod: (i) => i.alt, cmd: 'back' },
  { k: 'ArrowRight', mod: (i) => i.alt, cmd: 'forward' },
  { k: 'Tab', mod: (i) => i.control && !i.shift, cmd: 'next-tab' },
  { k: 'Tab', mod: (i) => i.control && i.shift, cmd: 'prev-tab' },
  { k: '+', mod: (i) => i.control, cmd: 'zoom-in' },
  { k: '=', mod: (i) => i.control, cmd: 'zoom-in' },
  { k: '-', mod: (i) => i.control, cmd: 'zoom-out' },
  { k: '0', mod: (i) => i.control, cmd: 'zoom-reset' },
  { k: 'F12', mod: () => true, cmd: 'devtools' }
];
/* ---------- Menú contextual de las páginas ----------
   Un <webview> de Electron no trae ninguno: hasta ahora el clic derecho en una
   página no hacía absolutamente nada. Se arma con el Menu nativo porque se
   encarga solo del teclado, de cerrarse al perder el foco y del tema del
   sistema; replicarlo en HTML sobre el webview era mucho más código y peor.
   El menú es sensible a lo que hay debajo: selección, campo de texto, enlace,
   imagen y —lo que pidió Dosa— vídeo, donde ofrece bajarlo con el Rat Tool. */

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

function menuContextual(contents) {
  contents.on('context-menu', (_e, p) => {
    const host = contents.hostWebContents;
    const aRenderer = (tipo, datos) => host?.send('ctx:accion', { tipo, datos });
    const items = [];
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };

    if (p.selectionText && !p.isEditable) {
      const corto = p.selectionText.trim().replace(/\s+/g, ' ').slice(0, 24);
      items.push({ label: 'Copiar', accelerator: 'Ctrl+C', click: () => contents.copy() });
      items.push({ label: 'Buscar "' + corto + '" en una pestaña nueva', click: () => aRenderer('buscar', p.selectionText.trim()) });
      sep();
    }
    if (p.isEditable) {
      items.push({ label: 'Cortar', accelerator: 'Ctrl+X', enabled: !!p.selectionText, click: () => contents.cut() });
      items.push({ label: 'Copiar', accelerator: 'Ctrl+C', enabled: !!p.selectionText, click: () => contents.copy() });
      items.push({ label: 'Pegar', accelerator: 'Ctrl+V', enabled: p.editFlags?.canPaste !== false, click: () => contents.paste() });
      items.push({ label: 'Seleccionar todo', accelerator: 'Ctrl+A', click: () => contents.selectAll() });
      sep();
    }
    if (p.linkURL) {
      items.push({ label: 'Abrir el enlace en una pestaña nueva', click: () => host?.send('tab:open-url', { url: p.linkURL, background: true, origen: contents.id }) });
      items.push({ label: 'Copiar el enlace', click: () => clipboard.writeText(p.linkURL) });
      items.push({ label: 'Guardar el destino como…', click: () => contents.downloadURL(p.linkURL) });
      sep();
    }
    if (p.mediaType === 'image' && p.srcURL) {
      // Se sube la imagen a Lens (ver el handler lens:buscar). Las blob: se
      // quedan fuera: viven solo dentro de la página y aquí no se pueden leer.
      if (/^(https?|data):/i.test(p.srcURL)) {
        items.push({
          label: 'Buscar la imagen con Google Lens',
          click: () => aRenderer('lens', { src: p.srcURL, pagina: contents.getURL() })
        });
      }
      items.push({ label: 'Copiar la imagen', click: () => contents.copyImageAt(p.x, p.y) });
      items.push({ label: 'Copiar la dirección de la imagen', click: () => clipboard.writeText(p.srcURL) });
      items.push({ label: 'Guardar la imagen como…', click: () => contents.downloadURL(p.srcURL) });
      sep();
    }
    if (p.mediaType === 'video' || p.mediaType === 'audio') {
      const esVideo = p.mediaType === 'video';
      items.push({
        label: 'Descargar ' + (esVideo ? 'el vídeo' : 'el audio') + ' con Rat Tool',
        click: () => aRenderer('rat', { pagina: contents.getURL(), src: p.srcURL || '' })
      });
      if (esVideo) {
        items.push({ label: 'Ver en miniatura', accelerator: 'Alt+P', click: () => aRenderer('pip') });
      }
      if (p.srcURL && /^https?:/.test(p.srcURL)) {
        items.push({ label: 'Copiar la dirección ' + (esVideo ? 'del vídeo' : 'del audio'), click: () => clipboard.writeText(p.srcURL) });
      }
      sep();
    }

    items.push({ label: 'Atrás', accelerator: 'Alt+Left', enabled: puedeAtras(contents), click: () => irAtras(contents) });
    items.push({ label: 'Adelante', accelerator: 'Alt+Right', enabled: puedeAdelante(contents), click: () => irAdelante(contents) });
    items.push({ label: 'Recargar', accelerator: 'F5', click: () => contents.reload() });
    sep();
    items.push({ label: 'Añadir al acceso rápido', click: () => aRenderer('acceso', { url: contents.getURL(), titulo: contents.getTitle() }) });
    items.push({ label: 'Añadir a marcadores', accelerator: 'Ctrl+D', click: () => aRenderer('marcador', { url: contents.getURL(), titulo: contents.getTitle() }) });
    sep();
    items.push({ label: 'Pantalla completa', accelerator: 'F11', click: () => aRenderer('pantalla-completa') });
    items.push({ label: 'Copiar la dirección de la página', click: () => clipboard.writeText(contents.getURL()) });
    sep();
    items.push({ label: 'Guardar la página como…', accelerator: 'Ctrl+S', click: () => guardarComo(contents, false) });
    items.push({ label: 'Guardar como PDF…', click: () => guardarComo(contents, true) });
    items.push({ label: 'Imprimir…', accelerator: 'Ctrl+P', click: () => contents.print() });
    sep();
    items.push({ label: 'Código fuente de la página', accelerator: 'Ctrl+U', click: () => host?.send('tab:open-url', { url: 'view-source:' + contents.getURL(), background: false }) });
    items.push({ label: 'Inspeccionar', accelerator: 'Ctrl+Mayús+C', click: () => contents.inspectElement(p.x, p.y) });

    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(host) || undefined });
  });
}

function atajosDeWebview(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const tecla = input.key;
    for (const a of ATAJOS_UI) {
      if (tecla !== a.k && tecla.toLowerCase() !== a.k.toLowerCase()) continue;
      if (!a.mod(input)) continue;
      event.preventDefault();
      contents.hostWebContents?.send('ui:shortcut', a.cmd);
      return;
    }
    // Ctrl+1..9 para saltar de pestaña
    if (input.control && !input.shift && /^[1-9]$/.test(tecla)) {
      event.preventDefault();
      contents.hostWebContents?.send('ui:shortcut', 'tab-' + tecla);
    }
  });
}

/* Scrollbar propio para las webs (2026-08-13, peticion de Dosa: seguian
   saliendo barras por defecto en varias paginas). Gris translucido para que
   valga en claro y en oscuro, y sin flechas. */
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

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    suppressWebAuthn(contents);
    atajosDeWebview(contents);
    menuContextual(contents);
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        // clic central / "abrir en pestaña nueva" => segundo plano; el resto en primer plano
        // `origen` es el webContents que abrio el enlace: con eso la pestaña
        // nueva se coloca justo detras de la suya y no al final de la barra.
        contents.hostWebContents?.send('tab:open-url', { url, background: disposition === 'background-tab', origen: contents.id });
      }
      return { action: 'deny' };
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
      // Ocultado cosmético + scriptlets de las listas de Brave (como uBlock/Brave)
      if (settings.adblockEnabled && !isWhitelisted(contents.getURL())) {
        const cos = braveAdblock.cosmeticsFor(contents.getURL());
        if (cos) {
          if (cos.css) contents.insertCSS(cos.css).catch(() => {});
          if (cos.script) contents.executeJavaScript(cos.script, true).catch(() => {});
        }
      }
      if (settings.adblockEnabled && /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) {
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
// Envuelve un handler para que solo responda a la interfaz
const soloUI = (fn) => (e, ...args) => {
  if (!esUI(e)) { console.warn('[Naviris] IPC sensible rechazado desde', (() => { try { return e.sender.getURL(); } catch { return 'origen desconocido'; } })()); return { ok: false, error: 'origen no autorizado' }; }
  return fn(e, ...args);
};

ipcMain.on('win:minimize', (e) => winOf(e)?.minimize());
ipcMain.on('win:maximize', (e) => { const w = winOf(e); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.on('win:close', (e) => winOf(e)?.close());
// F11: pantalla completa de la VENTANA (distinto del fullscreen del vídeo)
ipcMain.on('win:fullscreen', (e) => { const w = winOf(e); if (w) w.setFullScreen(!w.isFullScreen()); });
ipcMain.on('win:new-private', () => createWindow(true));
/* Sacar una pestaña de la barra abre una ventana nueva con esa direccion.
   La ventana tarda en montar su interfaz, asi que la URL se guarda y se le
   manda cuando ella avisa de que ya esta lista ('ui:listo'). */
const urlPendiente = new Map();   // id de ventana -> url que tiene que abrir
ipcMain.on('win:sacar-pestana', (e, url) => {
  if (typeof url !== 'string' || !/^https?:/i.test(url)) return;
  // Si sale de una ventana privada, la nueva tambien lo es: no se saca una
  // pestaña privada a una ventana normal, que dejaria rastro.
  const dueno = BrowserWindow.fromWebContents(e.sender);
  let privada = false;
  try { privada = new URL(dueno.webContents.getURL()).searchParams.get('private') === '1'; } catch { /* nada */ }
  const win = createWindow(privada);
  if (win) urlPendiente.set(win.id, url);
});

ipcMain.handle('settings:get', () => settings);
// ---------- Información del sitio (popover del candado) ----------
// Solo las dos particiones reales de Naviris: nada de leer cookies de otros perfiles
const PARTICIONES_VALIDAS = new Set(['persist:cobalt', 'cobalt-private']);
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
  fs.writeFileSync(archivoEsp(id), cifra(clave, obj), 'utf8');
}
const espacioDe = (id) => (settings.espacios || []).find((e) => e.id === id);

ipcMain.handle('esp:bloquea', soloUI((_e, { id, clave } = {}) => {
  const esp = espacioDe(id);
  if (!esp) return { ok: false, error: 'Ese espacio ya no existe' };
  if (esp.bloqueado) return { ok: false, error: 'Ese espacio ya está protegido' };
  if (!clave || String(clave).length < 4) return { ok: false, error: 'El código necesita al menos 4 caracteres' };
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
  catch { return { ok: false, error: 'Código incorrecto' }; }
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
    catch { return { ok: false, error: 'Código incorrecto' }; }
    try { fs.unlinkSync(archivoEsp(id)); } catch { /* ya no estaba */ }
  }
  if (esp.particion) { try { await session.fromPartition(esp.particion).clearStorageData(); } catch { /* nada */ } }
  settings.espacios = (settings.espacios || []).filter((e) => e.id !== id);
  saveSettings(settings);
  clavesEnMemoria.delete(id);
  return { ok: true };
}));

ipcMain.handle('cont:borra', soloUI(async (_e, particion) => {
  if (!PARTICIONES_VALIDAS.has(particion) || !/^persist:(cont|esp)-/.test(particion)) return { ok: false };
  try { await session.fromPartition(particion).clearStorageData(); } catch { /* nada */ }
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
    const ses = session.fromPartition('persist:cobalt');
    const r = await ses.fetch('https://mail.google.com/mail/feed/atom', { credentials: 'include' });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, xml: await r.text() };
  } catch (e) { return { ok: false, error: String(e && e.message) }; }
}));
/* ---------- Google Lens (2026-08-12) ----------
   Aquí SOLO se consiguen los bytes de la imagen; la subida la hace el
   renderer desde una página de Google (ver buscarConLens en renderer.js).

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
      const ses = session.fromPartition('persist:cobalt');
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
// Métricas para el widget Monitor: memoria del sistema + CPU/RAM de Naviris
// (app.getAppMetrics agrega todos los procesos del navegador).
ipcMain.handle('sys:stats', soloUI(async () => {
  try {
    const mem = process.getSystemMemoryInfo();               // KB
    const mets = app.getAppMetrics();
    let cpu = 0, rssKb = 0;
    for (const p of mets) { cpu += (p.cpu && p.cpu.percentCPUUsage) || 0; rssKb += (p.memory && p.memory.workingSetSize) || 0; }
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
        mb: m ? Math.round((m.memory && m.memory.workingSetSize || 0) / 1024) : null,
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
      restoMb: suma(resto, (p) => (p.memory && p.memory.workingSetSize || 0) / 1024),
      restoCpu: Math.round(resto.reduce((s, p) => s + (p.cpu && p.cpu.percentCPUUsage || 0), 0) * 10) / 10,
      totalMb: suma(mets, (p) => (p.memory && p.memory.workingSetSize || 0) / 1024),
      totalCpu: Math.round(mets.reduce((s, p) => s + (p.cpu && p.cpu.percentCPUUsage || 0), 0) * 10) / 10,
      procesos: mets.length
    };
  } catch { return null; }
}));
ipcMain.handle('clip:read', soloUI(async () => { try { return clipboard.readText() || ''; } catch { return ''; } }));
ipcMain.handle('clip:write', soloUI(async (_e, t) => { try { clipboard.writeText(String(t || '')); return true; } catch { return false; } }));
ipcMain.handle('spotify:logged', soloUI(async () => {
  try {
    const cookies = await session.fromPartition('persist:cobalt').cookies.get({ domain: '.spotify.com', name: 'sp_dc' });
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

ipcMain.handle('settings:set', soloUI((_e, patch) => {
  settings = { ...settings, ...patch }; saveSettings(settings);
  // Cambiar el modo claro retematiza también las webs abiertas (prefers-color-scheme)
  if ('lightMode' in patch) nativeTheme.themeSource = settings.lightMode ? 'light' : 'dark';
  // El muro de edad de X no necesita nada aquí: el renderer recarga la pestaña de X
  // al mover el ajuste y el preload consulta 'x:age-gate-on' en cada carga.
  return settings;
}));
// Lo pregunta el preload de la webview en document_start, antes de parchear el muro
// de edad de X. Síncrono porque a esas alturas no da tiempo a un ida y vuelta
// asíncrono; solo devuelve un booleano, sin datos sensibles.
ipcMain.on('x:age-gate-on', (e) => { e.returnValue = !!settings.xRevealSensitive; });
// Lo pregunta el preload antes de parchear el player de YouTube. Respeta el
// interruptor del adblock Y la lista blanca: antes el bloque de YouTube del preload
// no miraba ninguno de los dos, así que meter youtube.com en la lista blanca porque
// se te rompía el vídeo no servía absolutamente de nada.
ipcMain.on('yt-adblock-on', (e, url) => {
  e.returnValue = !!settings.adblockEnabled && !isWhitelisted(url || '');
});
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
ipcMain.on('app:restart', () => { app.relaunch(); app.exit(0); });
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('gpu:status', () => app.getGPUFeatureStatus());
ipcMain.on('shell:open-external', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
ipcMain.handle('clipboard:read', () => { try { return clipboard.readText(); } catch { return ''; } });

// ---------- Gestor de contraseñas (safeStorage/DPAPI + Windows Hello) ----------
const pwPath = () => path.join(app.getPath('userData'), 'cobalt-passwords.json');
function loadPasswords() { try { return JSON.parse(fs.readFileSync(pwPath(), 'utf8')); } catch { return []; } }
function savePasswords(list) { try { fs.writeFileSync(pwPath(), JSON.stringify(list), 'utf8'); } catch (e) { console.error('pw save', e); } }
let pwSeq = Date.now();

// Verifica identidad con Windows Hello (PIN/biometría). Devuelve true si "Verified".
function verifyWindowsHello(reason) {
  return new Promise((resolve) => {
    const msg = String(reason || 'Naviris te pide verificar tu identidad').replace(/'/g, ' ');
    const script = `
[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${msg}')
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
const cardsPath = () => path.join(app.getPath('userData'), 'cobalt-cards.json');
function loadCards() { try { return JSON.parse(fs.readFileSync(cardsPath(), 'utf8')); } catch { return []; } }
function saveCards(list) { try { fs.writeFileSync(cardsPath(), JSON.stringify(list), 'utf8'); } catch (e) { console.error('cards save', e); } }
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
const totpPath = () => path.join(app.getPath('userData'), 'cobalt-totp.json');
function loadTotp() { try { return JSON.parse(fs.readFileSync(totpPath(), 'utf8')); } catch { return []; } }
function saveTotp(list) { try { fs.writeFileSync(totpPath(), JSON.stringify(list), 'utf8'); } catch (e) { console.error('totp save', e); } }

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
ipcMain.handle('adblock:set-enabled', (_e, enabled) => { settings.adblockEnabled = !!enabled; saveSettings(settings); return settings.adblockEnabled; });
ipcMain.handle('adblock:whitelist', (_e, { action, domain }) => {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  if (action === 'add' && d && !settings.adblockWhitelist.includes(d)) settings.adblockWhitelist.push(d);
  if (action === 'remove') settings.adblockWhitelist = settings.adblockWhitelist.filter((x) => x !== d);
  saveSettings(settings);
  return settings.adblockWhitelist;
});

// Descargas
ipcMain.on('download:url', (_e, { url, isPrivate }) => {
  if (!/^https?:/.test(url)) return;
  session.fromPartition(isPrivate ? PART_PRIVATE : PART_NORMAL).downloadURL(url);
});
ipcMain.handle('yt:download', async (_e, opts) => { await ensureBins(); return ytDownload(opts); });
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
ipcMain.handle('import:bookmarks', (_e, key) => {
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
});

// Lista las alturas de vídeo disponibles (1080, 720, …) para el selector de calidad
ipcMain.handle('yt:formats', (_e, url) => new Promise((resolve) => {
  if (!/^https?:/.test(url) || !fs.existsSync(ytDlpPath())) return resolve([]);
  const child = spawn(ytDlpPath(), ['--no-playlist', '--no-warnings', '--dump-single-json', url], { windowsHide: true });
  let out = ''; const timer = setTimeout(() => { try { child.kill(); } catch {} resolve([]); }, 20000);
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.on('error', () => { clearTimeout(timer); resolve([]); });
  child.on('close', () => {
    clearTimeout(timer);
    try {
      const info = JSON.parse(out);
      const heights = new Set();
      (info.formats || []).forEach((f) => { if (f.height && (f.vcodec !== 'none' || f.acodec === 'none')) heights.add(f.height); });
      resolve([...heights].filter((h) => h >= 144).sort((a, b) => b - a));
    } catch { resolve([]); }
  });
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
ipcMain.on('download:open', (_e, id) => { const d = downloads.get(id); if (d) shell.openPath(d.meta.path); });
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
ipcMain.on('downloads:open-file', (_e, name) => { const p = downloadsFilePath(name); if (p) shell.openPath(p); });
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
  const tryFetch = async (url) => {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error('http ' + res.status);
    const type = res.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 50) throw new Error('vacío');
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
  try { fs.rmSync(addonFile(id), { force: true }); } catch { /* nada */ }
  const rest = { ...(settings.addons || {}) }; delete rest[id];
  settings.addons = rest; saveSettings(settings); loadAddonCode();
  return { ok: true };
}));

ipcMain.handle('addons:toggle', soloUI((_e, { id, on }) => {
  if (settings.addons && settings.addons[id]) { settings.addons[id].enabled = !!on; saveSettings(settings); loadAddonCode(); }
  return settings.addons || {};
}));

ipcMain.handle('addons:code', soloUI((_e, id) => {
  if (!settings.addons || !settings.addons[id] || !settings.addons[id].enabled) return null;
  try { return fs.readFileSync(addonFile(id), 'utf8'); } catch { return null; }
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
ipcMain.handle('hub:set-wallpaper', async (e, origen) => {
  try {
    if (!origen || !fs.existsSync(origen)) return { ok: false, message: 'No se encontró la imagen' };
    const dir = path.join(app.getPath('userData'), 'fondos');
    fs.mkdirSync(dir, { recursive: true });
    // Nombre único: al cambiar de fondo, el anterior se retira
    for (const viejo of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, viejo)); } catch { /* en uso */ } }
    const destino = path.join(dir, 'hub-' + Date.now() + path.extname(origen).toLowerCase());
    fs.copyFileSync(origen, destino);
    return { ok: true, url: 'file:///' + destino.replace(/\\/g, '/') };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
});
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
function actualizacionSolaPermitida() {
  return app.isPackaged;
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

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { state: 'dev' };
  chequeoSilencioso = false; // lo pide el usuario: nada se baja sin que lo mande
  applyUpdateChannel(); // el ajuste puede haber cambiado sin reiniciar
  // Una comprobación normal vuelve a mirar TODAS las releases: si antes se
  // eligió una línea, el feed quedó clavado en aquel tag y aquí no vale.
  autoUpdater.setFeedURL({ provider: 'github', owner: 'DosaAKA2A', repo: 'Naviris', releaseType: 'prerelease' });
  try { await autoUpdater.checkForUpdates(); return { state: 'checking' }; }
  catch (e) { return { state: 'error', message: friendlyUpdateError(e) }; }
});
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
  createWindow(false, true); // la primera ventana es la que releva al splash
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

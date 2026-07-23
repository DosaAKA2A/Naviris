const { app, BrowserWindow, ipcMain, shell, nativeTheme, session, net, clipboard, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const braveAdblock = require('./adblock');

const PART_NORMAL = 'persist:cobalt';
const PART_PRIVATE = 'cobalt-private'; // sin "persist:" → solo en memoria

// Migración de perfil: el rebrand Cobalt→Naviris cambia la carpeta de userData,
// así que si existe el perfil antiguo y no el nuevo, se renombra para conservar
// sesiones, contraseñas y ajustes de los usuarios existentes.
try {
  const oldProfile = path.join(app.getPath('appData'), 'Cobalt');
  const newProfile = path.join(app.getPath('appData'), 'Naviris');
  if (fs.existsSync(oldProfile) && !fs.existsSync(newProfile)) fs.renameSync(oldProfile, newProfile);
} catch (e) { console.log('[Naviris] No se pudo migrar el perfil:', e.message); }

// ---------- Rutas de binarios (yt-dlp / ffmpeg) ----------
function binDir() {
  // Empaquetado: resources/bin (via extraResources). Desarrollo: ./resources/bin
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', 'resources', 'bin');
}
const ytDlpPath = () => path.join(binDir(), 'yt-dlp.exe');
const ffmpegPath = () => path.join(binDir(), 'ffmpeg.exe');

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
  blockPasskeys: true,      // evita el prompt de Windows Hello (claves de acceso)
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

// ---------- Scripts inyectados en las páginas ----------
// Salta anuncios de YouTube sin bloquear el vídeo (rápido, self-sostenido en SPA)
const YT_ADSKIP = `(function(){
  if(window.__cobaltYT)return; window.__cobaltYT=1;
  function skip(){
    try{
      var p=document.querySelector('.html5-video-player');
      var v=document.querySelector('video');
      if(p&&p.classList.contains('ad-showing')&&v){ v.muted=true; if(isFinite(v.duration)&&v.duration>0){ try{v.currentTime=v.duration;}catch(e){} } }
      ['.ytp-ad-skip-button','.ytp-ad-skip-button-modern','.ytp-skip-ad-button','.ytp-ad-overlay-close-button'].forEach(function(s){ var b=document.querySelector(s); if(b) b.click(); });
      // Cierra el aviso anti-adblock para que el vídeo siga reproduciéndose
      var enf=document.querySelector('ytd-enforcement-message-view-model');
      if(enf){ var dlg=enf.closest('tp-yt-paper-dialog'); if(dlg) dlg.remove(); else enf.remove(); document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function(b){ b.remove(); }); document.documentElement.style.overflow=''; if(v&&v.paused){ try{v.play();}catch(e){} } }
    }catch(e){}
  }
  setInterval(skip,300);
  // Observer con freno: YouTube muta el DOM sin parar y reaccionar a cada
  // cambio disparaba CPU/memoria del renderer. El interval ya cubre el resto.
  try{ new MutationObserver(function(){ if(window.__cbYTd)return; window.__cbYTd=1; setTimeout(function(){ window.__cbYTd=0; skip(); },500); }).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
})();`;
const YT_ADCSS = '#masthead-ad,ytd-ad-slot-renderer,ytd-promoted-video-renderer,ytd-display-ad-renderer,ytd-companion-slot-renderer,#player-ads,.ytp-ad-module,.video-ads,ytd-in-feed-ad-layout-renderer,ytd-ads-engagement-panel-content-renderer,#related ytd-ad-slot-renderer{display:none!important}';
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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
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

let settings = loadSettings();

if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();

// ---------- Modo agente: Chrome DevTools Protocol en localhost ----------
if (settings.agentMode) app.commandLine.appendSwitch('remote-debugging-port', '9223');

// ---------- Rendimiento y seguridad ----------
// (Se quitó renderer-process-limit: limitaba procesos y debilitaba el aislamiento
//  de sitios. El ahorro de memoria lo cubre el sueño de pestañas.)
// HttpsUpgrades: sube automáticamente las navegaciones http:// a https:// con
//  reintento si el sitio no soporta https. Aislamiento estricto de sitios activo por defecto.
// MemoryPurgeOnFreeze: purga la memoria de renderers congelados (menos RAM retenida)
app.commandLine.appendSwitch('enable-features', 'BackForwardCache,ReduceUserAgent,HttpsUpgrades,MemoryPurgeOnFreeze');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

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
    broadcast('download:update', meta);
  });
  return meta;
}

// Solo anuncios/telemetría puros. NO se tocan rutas del reproductor
// (/youtubei/v1/player, /get_midroll_info, videoplayback…): bloquearlas hacía
// que el vídeo no cargara o disparaba el anti-adblock. El salto real es en cliente.
const YT_AD_PATHS = ['/pagead/', '/api/stats/ads', '/ptracking'];

function setupSession(ses) {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (!settings.adblockEnabled || details.resourceType === 'mainFrame' || isWhitelisted(details.referrer)) {
      return callback({});
    }
    const u = details.url;
    // Rutas de anuncios/seguimiento de YouTube (no toca 'videoplayback', así que no ralentiza)
    if (YT_AD_PATHS.some((p) => u.includes(p))) { blockedCount++; return callback({ cancel: true }); }
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

  // Abre CORS SOLO para las APIs públicas de precios que usan los addons
  // (p. ej. Valve Rat Tool compara mercados desde páginas de Steam)
  const CORS_OPEN = ['prices.csgotrader.app', 'api.skinport.com', 'api.dmarket.com'];
  ses.webRequest.onHeadersReceived({ urls: CORS_OPEN.map((h) => 'https://' + h + '/*') }, (details, cb) => {
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (/^access-control-allow-(origin|methods|headers)$/i.test(k)) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    cb({ responseHeaders: headers });
  });

  ses.on('will-download', (_e, item) => registerDownloadItem(item));
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
    broadcast('download:update', meta);
  });
  return id;
}

// ---------- Ventanas ----------
function createWindow(isPrivate = false) {
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
    webPreferences.backgroundThrottling = true; // baja CPU/timers en pestañas de fondo
  });
  win.loadFile(path.join(__dirname, 'index.html'), isPrivate ? { query: { private: '1' } } : undefined);
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  return win;
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    suppressWebAuthn(contents);
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        // clic central / "abrir en pestaña nueva" => segundo plano; el resto en primer plano
        contents.hostWebContents?.send('tab:open-url', { url, background: disposition === 'background-tab' });
      }
      return { action: 'deny' };
    });
    // Inyecta el saltador de anuncios de YouTube y el revelado de X
    contents.on('dom-ready', () => {
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

ipcMain.on('win:minimize', (e) => winOf(e)?.minimize());
ipcMain.on('win:maximize', (e) => { const w = winOf(e); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.on('win:close', (e) => winOf(e)?.close());
ipcMain.on('win:new-private', () => createWindow(true));

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => { settings = { ...settings, ...patch }; saveSettings(settings); return settings; });
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

// Reduce un sitio/URL a su dominio base para emparejar credenciales entre subdominios
function hostKey(s) {
  let h = String(s || '');
  try { h = new URL(/^https?:\/\//.test(h) ? h : 'https://' + h).hostname; } catch { /* nada */ }
  h = h.toLowerCase().replace(/^www\./, '');
  const p = h.split('.');
  return p.length > 2 ? p.slice(-2).join('.') : h;
}

ipcMain.handle('pw:available', async () => ({ encryption: safeStorage.isEncryptionAvailable() }));
ipcMain.handle('pw:list', () => loadPasswords().map((e) => ({ id: e.id, site: e.site, username: e.username })));
// Credenciales guardadas para un sitio (sin exponer la contraseña; el revelado exige Windows Hello)
ipcMain.handle('pw:for-host', (_e, host) => {
  const k = hostKey(host);
  return loadPasswords().filter((e) => hostKey(e.site) === k).map((e) => ({ id: e.id, site: e.site, username: e.username }));
});
ipcMain.handle('pw:add', (_e, { site, username, password }) => {
  if (!site || !password || !safeStorage.isEncryptionAvailable()) return { ok: false };
  const list = loadPasswords();
  const enc = safeStorage.encryptString(String(password)).toString('base64');
  const user = String(username || '');
  // Si ya existe una credencial para el mismo dominio + usuario, actualiza la contraseña
  const existing = list.find((e) => e.username === user && hostKey(e.site) === hostKey(site));
  if (existing) { existing.enc = enc; existing.site = String(site); }
  else list.push({ id: 'pw' + (++pwSeq), site: String(site), username: user, enc });
  savePasswords(list);
  return { ok: true, updated: !!existing };
});
ipcMain.handle('pw:delete', (_e, id) => { savePasswords(loadPasswords().filter((e) => e.id !== id)); return { ok: true }; });
ipcMain.handle('pw:reveal', async (_e, id) => {
  const entry = loadPasswords().find((e) => e.id === id);
  if (!entry) return { ok: false, error: 'no encontrada' };
  const verified = await verifyWindowsHello('Naviris: verifica tu identidad para ver la contraseña de ' + entry.site);
  if (!verified) return { ok: false, error: 'verificacion cancelada' };
  try { return { ok: true, password: safeStorage.decryptString(Buffer.from(entry.enc, 'base64')) }; }
  catch { return { ok: false, error: 'no se pudo descifrar' }; }
});

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
ipcMain.handle('yt:download', (_e, opts) => ytDownload(opts));
ipcMain.handle('yt:available', () => fs.existsSync(ytDlpPath()) && fs.existsSync(ffmpegPath()));

// ---------- Importar marcadores de otros navegadores ----------
// Chromium guarda un JSON "Bookmarks"; Firefox comprime su backup en .jsonlz4 (LZ4 + cabecera Mozilla).
const IMPORT_BROWSERS = {
  chrome:  { label: 'Chrome',   type: 'chromium', base: 'LOCALAPPDATA', parts: ['Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'] },
  brave:   { label: 'Brave',    type: 'chromium', base: 'LOCALAPPDATA', parts: ['BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Bookmarks'] },
  edge:    { label: 'Edge',     type: 'chromium', base: 'LOCALAPPDATA', parts: ['Microsoft', 'Edge', 'User Data', 'Default', 'Bookmarks'] },
  operagx: { label: 'Opera GX', type: 'chromium', base: 'APPDATA', parts: ['Opera Software', 'Opera GX Stable', 'Bookmarks'] },
  firefox: { label: 'Firefox',  type: 'firefox' }
};
function importPath(b) {
  if (!b) return null;
  if (b.type === 'firefox') return firefoxLatestBackup();
  const root = process.env[b.base]; if (!root) return null;
  return path.join(root, ...b.parts);
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
  if (d?.item) d.item.cancel();
  if (ytJobs.has(id)) { try { ytJobs.get(id).kill(); } catch {} }
});
ipcMain.on('download:open', (_e, id) => { const d = downloads.get(id); if (d) shell.openPath(d.meta.path); });
ipcMain.on('download:reveal', (_e, id) => { const d = downloads.get(id); if (d) shell.showItemInFolder(d.meta.path); });
ipcMain.handle('download:path', (_e, id) => { const d = downloads.get(id); return d ? d.meta.path : null; });
ipcMain.on('download:clear', () => { for (const [id, d] of downloads) if (d.meta.state !== 'progressing') downloads.delete(id); });

// Favicon como dataURL
ipcMain.handle('favicon:fetch', async (_e, pageUrl) => {
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

ipcMain.handle('addons:install', async (_e, meta) => {
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
});

ipcMain.handle('addons:uninstall', (_e, id) => {
  try { fs.rmSync(addonFile(id), { force: true }); } catch { /* nada */ }
  const rest = { ...(settings.addons || {}) }; delete rest[id];
  settings.addons = rest; saveSettings(settings); loadAddonCode();
  return { ok: true };
});

ipcMain.handle('addons:toggle', (_e, { id, on }) => {
  if (settings.addons && settings.addons[id]) { settings.addons[id].enabled = !!on; saveSettings(settings); loadAddonCode(); }
  return settings.addons || {};
});

ipcMain.handle('addons:code', (_e, id) => {
  if (!settings.addons || !settings.addons[id] || !settings.addons[id].enabled) return null;
  try { return fs.readFileSync(addonFile(id), 'utf8'); } catch { return null; }
});

// Guardado de imágenes generado por addons (p. ej. capturas largas)
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
autoUpdater.on('checking-for-update', () => broadcast('update:status', { state: 'checking' }));
autoUpdater.on('update-available', (info) => broadcast('update:status', { state: 'available', version: info.version }));
autoUpdater.on('update-not-available', (info) => broadcast('update:status', { state: 'latest', version: info.version }));
autoUpdater.on('download-progress', (p) => broadcast('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) => broadcast('update:status', { state: 'downloaded', version: info.version }));
autoUpdater.on('error', (err) => broadcast('update:status', { state: 'error', message: String(err && err.message || err) }));

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { state: 'dev' };
  try { await autoUpdater.checkForUpdates(); return { state: 'checking' }; }
  catch (e) { return { state: 'error', message: String(e.message || e) }; }
});
ipcMain.handle('update:download', async () => { try { await autoUpdater.downloadUpdate(); return { ok: true }; } catch (e) { return { ok: false, message: String(e.message || e) }; } });
ipcMain.on('update:install', () => autoUpdater.quitAndInstall());

nativeTheme.themeSource = 'dark';

app.whenReady().then(() => {
  // Comprobación silenciosa al arrancar (solo en versión instalada)
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
  braveAdblock.init();
  setupSession(session.fromPartition(PART_NORMAL));
  setupSession(session.fromPartition(PART_PRIVATE));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

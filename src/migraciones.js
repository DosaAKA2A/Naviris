/* ===== MIGRACIONES DE PERFIL QUE CORREN UNA SOLA VEZ =====
   Cada una se apunta en settings.migraciones al terminar bien; si falla (el
   perfil abierto por otra instancia, por ejemplo) se reintenta en el siguiente
   arranque. Corren ANTES de que Chromium abra sus bases de datos. */
const fs = require('fs');
const path = require('path');

/* COOKIES DE IFRAMES MAL CONVERTIDAS (2026-11-03). Hasta la 3.0.0-dev.1, al
   cerrar Naviris la conversión de cookies de sesión (ver sesiones.js) también
   reescribía las particionadas (CHIPS) de los iframes como cookies normales de
   su sitio, con 30 días de vida: la YSC de un video de YouTube incrustado en
   otra web acababa siendo la YSC de youtube.com. Esto borra esas cookies de los
   perfiles viejos, una vez.

   En disco no queda rastro de cuáles vinieron de un iframe, así que el criterio
   es estrecho a propósito (antes borrar de menos que de más). Se borra una
   cookie solo si cumple TODO:
   - no está particionada (top_frame_site_key vacío);
   - es persistente y su vida es exactamente la de la conversión: caduca 30 días
     después de crearse (con una hora de margen);
   - SameSite=None y Secure, lo único que puede tener una particionada;
   - su host tiene cookies particionadas guardadas, o sea, es un sitio que se
     incrusta como iframe en otras webs (youtube.com sí; twitch.tv no);
   - su nombre no es de sesión iniciada (NOMBRES_DE_SESION).
   Lo que se pierde en el peor caso es una cookie que nació como cookie de
   sesión de ese sitio, lo mismo que tira cualquier navegador al cerrar. */
const NOMBRES_DE_SESION = /psid|^(sid|hsid|ssid|apisid|sapisid|lsid|osid|nid|login_info|sp_dc|sp_key|twid|ct0)$|auth|token|login|sess|pass|jwt|csrf|xsrf|account|user/i;
const MICROS_DIA = 24 * 60 * 60 * 1e6;

function cookiesDeIframesConvertidas(db) {
  return db.prepare(`
    SELECT c.rowid AS id, c.host_key AS host, c.name AS nombre FROM cookies c
    WHERE c.top_frame_site_key = '' AND c.is_persistent = 1 AND c.samesite = 0 AND c.is_secure = 1
      AND ABS((c.expires_utc - c.creation_utc) - 30 * ${MICROS_DIA}) < ${MICROS_DIA / 24}
      AND EXISTS (SELECT 1 FROM cookies p WHERE p.top_frame_site_key != '' AND p.host_key = c.host_key)
  `).all().filter((c) => !NOMBRES_DE_SESION.test(c.nombre));
}

// Limpia la base de cookies de una sesión. Devuelve las borradas (host y nombre).
function limpiaCookiesDeIframes(archivo) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(archivo);
  try {
    const malas = cookiesDeIframesConvertidas(db);
    const borra = db.prepare('DELETE FROM cookies WHERE rowid = ?');
    db.exec('BEGIN');
    for (const c of malas) borra.run(c.id);
    db.exec('COMMIT');
    return malas.map(({ host, nombre }) => ({ host, nombre }));
  } finally { db.close(); }
}

// Todas las sesiones persistentes del perfil: la normal, contenedores y espacios.
function basesDeCookies(userData) {
  const dir = path.join(userData, 'Partitions');
  let nombres = [];
  try { nombres = fs.readdirSync(dir); } catch { return []; }
  return nombres.map((n) => path.join(dir, n, 'Network', 'Cookies')).filter((f) => fs.existsSync(f));
}

function migraPerfil(settings, userData) {
  const hechas = settings.migraciones || {};
  if (hechas.cookiesParticionadas) return null;
  const borradas = [];
  for (const f of basesDeCookies(userData)) borradas.push(...limpiaCookiesDeIframes(f));
  settings.migraciones = { ...hechas, cookiesParticionadas: true };
  return borradas;
}

/* ===== EL NOMBRE VIEJO DEL NAVEGADOR (2026-11-03) =====
   Naviris se llamó "Cobalt" y, hasta la 3.0, lo seguía llevando por dentro: la
   carpeta del perfil de la v1, la sesión de las webs (persist:cobalt), los
   archivos del perfil (cobalt-*.json) y las claves de la interfaz (cobalt.*,
   ver migra-claves.js). Este es el único sitio del escritorio que lo nombra:
   lo justo para pasar lo de cada persona a los nombres nuevos sin perder nada.

   Lo viejo se COPIA y se deja donde estaba. Desde la rama dev se puede volver
   a la 2.x cambiando de canal en Ajustes (ahí se permite bajar de versión), y
   la 2.x solo sabe leer los nombres viejos: así se encuentra lo que tenía.
   Cuando ya nadie pueda volver a una 2.x, se puede borrar. */
const VIEJO = 'cobalt';
const PART_NAVIRIS = 'persist:naviris';
const PART_VIEJA = 'persist:' + VIEJO;

// La v1 guardaba el perfil en %APPDATA%\Cobalt: se renombra si aún no hay uno de Naviris.
function migraCarpetaV1(appData) {
  const vieja = path.join(appData, 'Cobalt');
  const nueva = path.join(appData, 'Naviris');
  if (fs.existsSync(vieja) && !fs.existsSync(nueva)) fs.renameSync(vieja, nueva);
}

// cobalt-settings.json, cobalt-passwords.json… → naviris-*.json. Cada copia se
// escribe al lado y se renombra al final: un corte a medias no deja un JSON a
// medio escribir con el nombre bueno. Y van todas o ninguna: si una falla, se
// quitan las ya copiadas y Naviris sigue con los nombres viejos esta vez; si
// no, al reintentar se saltaría una copia que ya no estaría al día.
function migraArchivos(userData) {
  let nombres = [];
  try { nombres = fs.readdirSync(userData); } catch { return []; }
  const copiados = [];
  try {
    for (const n of nombres) {
      const m = /^cobalt-(.+\.json)$/.exec(n);
      if (!m) continue;
      const nuevo = path.join(userData, 'naviris-' + m[1]);
      if (fs.existsSync(nuevo)) continue;
      fs.copyFileSync(path.join(userData, n), nuevo + '.migrando');
      fs.renameSync(nuevo + '.migrando', nuevo);
      copiados.push(nuevo);
    }
  } catch (e) {
    for (const f of copiados) { try { fs.rmSync(f, { force: true }); } catch { /* nada */ } }
    throw e;
  }
  return copiados.map((f) => path.basename(f));
}

/* La sesión de las webs: Partitions\cobalt → Partitions\naviris. Ahí están las
   cookies (las sesiones iniciadas), el localStorage, IndexedDB, los service
   workers y las licencias de Widevine (CdmStorage.db) de cada web.

   Medido con el perfil real de Dosa (1,2 GB): el 95 % son cachés (la HTTP, la
   de código, la de GPU y la CacheStorage de los service workers). Copiarlas
   alargaba el primer arranque varios segundos, así que esas carpetas se MUEVEN
   (un renombrado, instantáneo) y se copia todo lo demás (unos 60 MB). La copia
   vieja queda sin cachés, que es lo único que una web vuelve a descargar.

   Las cachés se mueven ANTES de copiar nada: si otra instancia tiene abierta la
   sesión vieja, Windows no deja moverlas, y eso avisa sin haber copiado a
   medias una base de datos en uso. Todo se arma en "naviris.migrando" y solo al
   final se renombra a "naviris": hasta entonces Naviris sigue con la sesión
   vieja y, si algo falla, se deshace (las cachés vuelven a su sitio) y se
   reintenta en el siguiente arranque. Devuelve la partición que hay que usar.

   ES ASÍNCRONA (P2 de la auditoría de seguridad, 2026-11-11). Lo que tarda es
   el número de archivos, no los GB: medido en el NVMe de Dosa, 20.000 archivos
   pequeños eran 16-18 s con la copia síncrona, antes de que existiera ninguna
   ventana, y parecía que Naviris no arrancaba. Ahora main.js la lanza con el
   splash ya en pantalla («Actualizando tu perfil») y sin bloquear el proceso
   principal. Se copian COPIAS_A_LA_VEZ archivos a la vez: medido con esos
   20.000 archivos, 5,0 s frente a 9,6-12 s de cpSync y 16-19 s de
   fs.promises.cp, que copia de uno en uno. */
const CACHES = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', path.join('Service Worker', 'CacheStorage')];
const COPIAS_A_LA_VEZ = 4; // los hilos de disco de libuv: más no acelera (medido con 16)

// Copia el árbol `de` en `a` (que ya existe), sin lo que diga `fuera(rutaRelativa)`.
async function copiaArbol(de, a, fuera) {
  const entradas = await fs.promises.readdir(de, { recursive: true, withFileTypes: true });
  const archivos = [];
  for (const e of entradas) {
    const rel = path.relative(de, path.join(e.parentPath, e.name));
    if (fuera(rel)) continue;
    if (e.isDirectory()) await fs.promises.mkdir(path.join(a, rel), { recursive: true });
    else archivos.push(rel);
  }
  let siguiente = 0;
  const copia = async () => {
    while (siguiente < archivos.length) {
      const rel = archivos[siguiente++];
      await fs.promises.copyFile(path.join(de, rel), path.join(a, rel));
    }
  };
  await Promise.all(Array.from({ length: COPIAS_A_LA_VEZ }, copia));
}

const rutasDeSesion = (userData) => {
  const dir = path.join(userData, 'Partitions');
  return { vieja: path.join(dir, VIEJO), nueva: path.join(dir, 'naviris') };
};

// ¿Hay sesión vieja por pasar? Es lo que decide si el splash avisa (main.js).
function sesionPendiente(userData) {
  const { vieja, nueva } = rutasDeSesion(userData);
  return !fs.existsSync(nueva) && fs.existsSync(vieja);
}

async function migraParticion(userData) {
  if (!sesionPendiente(userData)) return PART_NAVIRIS;
  const { vieja, nueva } = rutasDeSesion(userData);
  const obra = nueva + '.migrando';
  await fs.promises.rm(obra, { recursive: true, force: true });   // resto de un intento cortado
  const movidas = [];
  try {
    fs.mkdirSync(path.join(obra, 'Service Worker'), { recursive: true });
    for (const c of CACHES) {
      if (!fs.existsSync(path.join(vieja, c))) continue;
      fs.renameSync(path.join(vieja, c), path.join(obra, c));
      movidas.push(c);
    }
    const esCache = (rel) => CACHES.some((c) => rel === c || rel.startsWith(c + path.sep));
    await copiaArbol(vieja, obra, esCache);
    fs.renameSync(obra, nueva);
    return PART_NAVIRIS;
  } catch (e) {
    for (const c of movidas) { try { fs.renameSync(path.join(obra, c), path.join(vieja, c)); } catch { /* se queda sin esa caché */ } }
    try { await fs.promises.rm(obra, { recursive: true, force: true }); } catch { /* se limpia en el siguiente intento */ }
    throw e;
  }
}

// Los archivos del perfil, antes de leer los ajustes (síncrono: son unos pocos
// JSON). Lo que no se pudo pasar se sigue usando con el nombre viejo: nada se
// pierde y se vuelve a intentar al abrir otra vez.
function migraNombre(userData, log = () => {}) {
  try {
    const copiados = migraArchivos(userData);
    if (copiados.length) log('archivos del perfil copiados: ' + copiados.join(', '));
    return { archivos: 'naviris-' };
  } catch (e) {
    log('los archivos del perfil siguen con el nombre viejo hasta el próximo arranque: ' + e.message);
    return { archivos: VIEJO + '-' };
  }
}

// La sesión de las webs, ya con la app lista y antes de abrirla. Devuelve con
// qué partición arrancar: la vieja si no se pudo pasar (se reintenta al abrir otra vez).
async function migraSesion(userData, log = () => {}) {
  try {
    return await migraParticion(userData);
  } catch (e) {
    log('la sesión de las webs sigue en la vieja hasta el próximo arranque: ' + e.message);
    return PART_VIEJA;
  }
}

module.exports = { migraPerfil, limpiaCookiesDeIframes, NOMBRES_DE_SESION, migraCarpetaV1, migraArchivos, migraParticion, sesionPendiente, migraNombre, migraSesion, PART_NAVIRIS };

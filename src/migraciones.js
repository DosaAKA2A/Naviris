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

module.exports = { migraPerfil, limpiaCookiesDeIframes, NOMBRES_DE_SESION };

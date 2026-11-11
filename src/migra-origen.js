/* ===== LO QUE GUARDABA LA INTERFAZ EN file:// (2026-11-11) =====
   Desde que la interfaz se sirve por naviris://app (ver protocolo.js), su
   localStorage es otro: el de file:// se queda donde estaba, con marcadores,
   historial, widgets, cuenta y ajustes. La interfaz no tiene IndexedDB ni otro
   almacenamiento por origen (comprobado en el código y en el perfil de Dosa).

   Esto lee del disco el de file:// (leveldb.js) para que la interfaz lo copie a
   su origen nuevo en el primer arranque (migraOrigen en migra-claves.js). Lo
   viejo no se toca: la 2.x lo sigue leyendo si alguien vuelve a ella.

   Las imágenes que eligió la persona estaban guardadas como file:///…, y una
   página naviris:// no puede cargar file:. Al copiarlas se cambian por su
   dirección naviris://app/datos/…: el fondo del hub ya vivía en el perfil
   (fondos/), y la de un widget, que podía estar en cualquier carpeta, se copia
   al perfil (imagenes/). Solo en esas claves: en el historial o la sesión, un
   file:/// es una página abierta y se queda igual. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { leeBase } = require('./leveldb');
const { IMAGENES, urlDeDatos } = require('./protocolo');

const ORIGEN_VIEJO = 'file://';
const CLAVES_CON_IMAGEN = /^(naviris|cobalt)\.(hubBg(\..+)?|widgets(\..+)?)$/;

// Chromium guarda claves y valores con un byte delante: 1 = latin1, 0 = UTF-16.
function texto(b) {
  if (b.length && b[0] === 1) return b.toString('latin1', 1);
  if (b.length && b[0] === 0 && b.length % 2 === 1) return b.toString('utf16le', 1);
  throw new Error('valor de localStorage con un formato desconocido');
}

// Las claves del localStorage de un origen: { clave: valor }.
function clavesDeOrigen(dirBase, origen) {
  const prefijo = '_' + origen + '\x00';
  const out = {};
  if (!fs.existsSync(dirBase)) return out;
  for (const [k, v] of leeBase(dirBase)) {
    if (k.startsWith(prefijo)) out[texto(Buffer.from(k.slice(prefijo.length), 'latin1'))] = texto(v);
  }
  return out;
}

// Copia una imagen al perfil con un nombre sacado de su contenido (elegir la misma dos veces no la duplica).
function copiaImagen(origen, userData) {
  const ext = path.extname(origen).toLowerCase();
  if (!IMAGENES.has(ext)) return null;
  const datos = fs.readFileSync(origen);
  const nombre = crypto.createHash('sha256').update(datos).digest('hex').slice(0, 20) + ext;
  const dir = path.join(userData, 'imagenes');
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, nombre);
  if (!fs.existsSync(destino)) {
    fs.writeFileSync(destino + '.copiando', datos);
    fs.renameSync(destino + '.copiando', destino);
  }
  return urlDeDatos('imagenes', nombre);
}

// file:///C:/... (tal cual lo escribía la interfaz, sin codificar) -> naviris://app/datos/..., o null si no existe.
function imagenNueva(direccion, userData) {
  const cruda = direccion.slice('file:///'.length);
  let otra = cruda; try { otra = decodeURIComponent(cruda); } catch { /* se queda la cruda */ }
  const ruta = [cruda, otra].map((r) => path.normalize(r.replace(/\//g, path.sep))).find((r) => { try { return fs.statSync(r).isFile(); } catch { return false; } });
  if (!ruta) return null;
  if (path.dirname(ruta).toLowerCase() === path.join(userData, 'fondos').toLowerCase()) return urlDeDatos('fondos', path.basename(ruta));
  return copiaImagen(ruta, userData);
}

/* Lo que la interfaz tenía en file://, listo para su origen nuevo. Las imágenes
   que no se encuentren se dejan como estaban (tampoco se veían). */
function almacenViejo(userData) {
  const claves = clavesDeOrigen(path.join(userData, 'Local Storage', 'leveldb'), ORIGEN_VIEJO);
  for (const [k, v] of Object.entries(claves)) {
    if (!CLAVES_CON_IMAGEN.test(k)) continue;
    claves[k] = v.replace(/file:\/\/\/[^"\\]+/g, (d) => {
      try { return imagenNueva(d, userData) || d; } catch { return d; }
    });
  }
  return { claves };
}

module.exports = { almacenViejo, clavesDeOrigen, copiaImagen, ORIGEN_VIEJO };

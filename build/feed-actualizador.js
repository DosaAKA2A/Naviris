/* El feed del actualizador (latest.yml / dev.yml) y sus comprobaciones.
 *
 * Lo usan build/publish-release.js, al generar y subir el feed, y
 * test/actualizador.test.js, que lo pasa por el mismo electron-updater que
 * llevan las instalaciones. Aquí está todo lo que tiene que cuadrar para que
 * una instalación se actualice bien:
 *   - cada línea escribe SOLO su feed: una versión -dev va a dev.yml y nunca a
 *     latest.yml (si no, las instalaciones estables recibirían una dev);
 *   - el feed dice la versión que se publica, y su sha512, tamaño y nombre son
 *     los del instalador que se sube de verdad (el actualizador rechaza la
 *     descarga si el sha512 no coincide);
 *   - la release de GitHub va marcada como prerelease si y solo si es -dev: la
 *     estable la encuentra el actualizador por /releases/latest, que ignora las
 *     prerelease. Una dev sin marcar pasaría a ser «la última estable» y todas
 *     las instalaciones estables fallarían al no encontrar su latest.yml. */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const yaml = require('js-yaml');

// La misma regla que aplica la app al buscar (y al leer la firma del feed)
const { esDev, feedDe } = require('../src/canal-actualizaciones');

// Nombres que deja electron-builder en dist/ y con los que se suben (GitHub cambia los espacios por guiones).
function nombres(version) {
  const setup = `Naviris Setup ${version}.exe`;
  const portable = `Naviris ${version}.exe`;
  return {
    setup, portable, blockmap: `${setup}.blockmap`,
    subido: { setup: setup.replace(/ /g, '-'), portable: portable.replace(/ /g, '-'), blockmap: `${setup}.blockmap`.replace(/ /g, '-') }
  };
}

const sha512 = (archivo) => crypto.createHash('sha512').update(fs.readFileSync(archivo)).digest('base64');

function generaFeed(version, setupPath, fecha = new Date()) {
  const hash = sha512(setupPath);
  const size = fs.statSync(setupPath).size;
  const url = nombres(version).subido.setup;
  return `version: ${version}\nfiles:\n  - url: ${url}\n    sha512: ${hash}\n    size: ${size}\npath: ${url}\nsha512: ${hash}\nreleaseDate: '${fecha.toISOString()}'\n`;
}

/* Lo que no cuadra entre un feed y el instalador que anuncia. Lista vacía = bien.
   `nombreFeed` es el archivo en el que va (o se ha servido) el feed. */
function compruebaFeed(texto, { version, setupPath, nombreFeed }) {
  const mal = [];
  let f;
  try { f = yaml.load(texto); } catch (e) { return ['el feed no es YAML válido: ' + e.message]; }
  if (!f || typeof f !== 'object') return ['el feed está vacío'];
  if (nombreFeed && nombreFeed !== feedDe(version)) mal.push(`la ${version} no puede ir en ${nombreFeed}: su feed es ${feedDe(version)}`);
  if (String(f.version) !== version) mal.push(`el feed dice ${f.version} y se publica ${version}`);
  const esperado = nombres(version).subido.setup;
  const archivo = Array.isArray(f.files) && f.files.length === 1 ? f.files[0] : null;
  if (!archivo) { mal.push('el feed debe anunciar un solo instalador'); return mal; }
  if (archivo.url !== esperado) mal.push(`el feed apunta a ${archivo.url} y el instalador se sube como ${esperado}`);
  if (f.path !== archivo.url) mal.push('path y files[0].url no coinciden');
  if (setupPath) {
    const hash = sha512(setupPath);
    if (archivo.sha512 !== hash || f.sha512 !== hash) mal.push('el sha512 del feed no es el del instalador');
    if (archivo.size !== fs.statSync(setupPath).size) mal.push('el tamaño del feed no es el del instalador');
  }
  return mal;
}

// La release de GitHub: prerelease si y solo si la versión es -dev (ver arriba).
function compruebaRelease(release, version) {
  if (!!release.prerelease === esDev(version)) return [];
  return [esDev(version)
    ? `la release ${release.tag_name} no está marcada como prerelease: las instalaciones estables la tomarían por la última y no encontrarían latest.yml`
    : `la release ${release.tag_name} está marcada como prerelease: las instalaciones estables no la verían`];
}

module.exports = { esDev, feedDe, nombres, sha512, generaFeed, compruebaFeed, compruebaRelease };

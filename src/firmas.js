/* Firmas propias de Naviris (Ed25519, node:crypto).
 *
 * Dos cosas que la app baja de la red y ejecuta se comprueban contra la clave
 * pública de firma-publica.pem antes de usarlas:
 *   - el feed del actualizador (latest.yml / dev.yml): lo firma
 *     build/publish-release.js y sube la firma como <feed>.sig en la misma
 *     release. Sin firma válida no se descarga ni se instala nada;
 *   - el catálogo de addons (addons/catalog.json + catalog.json.sig en
 *     naviris.site), que lleva la huella sha256 del código de cada addon. Sin
 *     firma válida, o si el código bajado no tiene esa huella, no se instala.
 * La clave privada vive fuera del repo (build/firma.js). Las versiones 2.x leen
 * el mismo catálogo e ignoran la huella y el .sig: no se rompen. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { feedDe } = require('./canal-actualizaciones');

const RUTA_CLAVE_PUBLICA = path.join(__dirname, 'firma-publica.pem');
let clavePublica = null;
const publica = () => clavePublica || (clavePublica = crypto.createPublicKey(fs.readFileSync(RUTA_CLAVE_PUBLICA)));

// Cada firma dice para qué es: una firma de catálogo no vale como firma de feed ni al revés.
const CONTEXTO = { feed: 'naviris-feed-1\n', catalogo: 'naviris-catalogo-1\n' };
const aBuffer = (d) => (Buffer.isBuffer(d) ? d : Buffer.from(String(d), 'utf8'));
function mensaje(tipo, datos) {
  if (!Object.hasOwn(CONTEXTO, tipo)) throw new Error('tipo de firma desconocido: ' + tipo);
  return Buffer.concat([Buffer.from(CONTEXTO[tipo]), aBuffer(datos)]);
}

// Firma en base64 (una línea): es lo que va en los .sig.
const firma = (tipo, datos, clavePrivada) => crypto.sign(null, mensaje(tipo, datos), clavePrivada).toString('base64');

function verifica(tipo, datos, firmaB64, clave = publica()) {
  const f = String(firmaB64 || '').trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(f)) return false;   // 64 bytes de Ed25519
  try { return crypto.verify(null, mensaje(tipo, datos), clave, Buffer.from(f, 'base64')); } catch { return false; }
}

/* El catálogo y los addons son texto del repo: git en Windows los deja con CRLF
   en la copia de trabajo y el repo (y naviris.site) los sirve con LF. Se firman
   y se comprueban siempre en LF, así cuadran lo lea quien lo lea. */
const enLF = (datos) => Buffer.from(aBuffer(datos).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
const huella = (codigo) => crypto.createHash('sha256').update(enLF(codigo)).digest('hex');

/* ---------- Catálogo de addons ---------- */
const TEXTO_CATALOGO = 'No se pudo verificar el catálogo de addons, así que no se instala nada. Inténtalo más tarde.';
const TEXTO_ADDON = 'El código del addon no coincide con el catálogo verificado, así que no se instaló. Inténtalo más tarde.';

// La lista de addons de un catálogo firmado. Lanza con un texto para el usuario si la firma no vale.
function leeCatalogo(bytes, firmaB64, clave) {
  const texto = enLF(bytes);
  if (!verifica('catalogo', texto, firmaB64, clave)) throw new Error(TEXTO_CATALOGO);
  const cat = JSON.parse(texto.toString('utf8'));
  return Array.isArray(cat && cat.addons) ? cat.addons : [];
}

// El código que se instala (en LF), si tiene la huella que dice su entrada del catálogo firmado.
function compruebaAddon(entrada, bytes) {
  const esperada = String((entrada && entrada.sha256) || '');
  if (!/^[0-9a-f]{64}$/.test(esperada) || huella(bytes) !== esperada) throw new Error(TEXTO_ADDON);
  return enLF(bytes).toString('utf8');
}

/* ---------- Feed del actualizador ---------- */
const RELEASES = 'https://github.com/DosaAKA2A/Naviris/releases/download/';

/* Motivo por el que NO se puede descargar `info` (lo que electron-updater leyó
   del feed y va a bajar), o null si el feed firmado anuncia exactamente eso.
   electron-updater ya comprueba que el instalador tiene el sha512 de `info`;
   aquí se comprueba que `info` es lo que se firmó: versión, nombre, sha512 y
   tamaño de cada archivo. */
function compruebaFeedFirmado(bytes, firmaB64, info, clave) {
  if (!String(firmaB64 || '').trim()) return 'el feed no tiene firma';
  if (!verifica('feed', bytes, firmaB64, clave)) return 'la firma del feed no es válida';
  let f;
  try { f = require('js-yaml').load(aBuffer(bytes).toString('utf8')); } catch { return 'el feed firmado no se puede leer'; }
  if (!f || typeof f !== 'object' || !info) return 'el feed firmado está vacío';
  if (String(f.version) !== String(info.version)) return `el feed firmado es de la ${f.version} y se iba a bajar la ${info.version}`;
  const firmados = Array.isArray(f.files) ? f.files : [];
  const aBajar = Array.isArray(info.files) ? info.files : [];
  if (!aBajar.length || firmados.length !== aBajar.length) return 'los archivos no coinciden con el feed firmado';
  for (let i = 0; i < aBajar.length; i++) {
    const a = firmados[i], b = aBajar[i];
    if (!a || !b || a.url !== b.url || a.sha512 !== b.sha512 || Number(a.size) !== Number(b.size)) return 'los archivos no coinciden con el feed firmado';
  }
  if ((info.sha512 && info.sha512 !== f.sha512) || (info.path && info.path !== f.path)) return 'los archivos no coinciden con el feed firmado';
  return null;
}

/* Baja el feed de la versión de `info` y su firma de la release de GitHub
   (v<versión>/<feed>.yml y .sig) y lo comprueba. Devuelve el motivo para no
   descargar o null; si la red falla, lanza (es un error normal, se reintenta). */
async function compruebaActualizacion(info, { pide = fetch, clave } = {}) {
  const version = String((info && info.version) || '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) return 'versión no válida';
  const url = RELEASES + 'v' + version + '/' + feedDe(version);
  const [rFeed, rFirma] = await Promise.all([pide(url), pide(url + '.sig')]);
  for (const r of [rFeed, rFirma]) if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status);
  if (rFirma.status === 404) return 'el feed no tiene firma';
  if (rFeed.status === 404) return 'no se encuentra el feed';
  return compruebaFeedFirmado(Buffer.from(await rFeed.arrayBuffer()), await rFirma.text(), info, clave);
}

module.exports = { RUTA_CLAVE_PUBLICA, RELEASES, firma, verifica, enLF, huella, leeCatalogo, compruebaAddon, compruebaFeedFirmado, compruebaActualizacion };

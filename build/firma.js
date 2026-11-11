#!/usr/bin/env node
/* La clave de firma de Naviris y lo que se firma con ella (ver src/firmas.js).
 *
 * La clave PRIVADA vive FUERA del repo, en ~/.naviris-firma/privada.pem, y no
 * se copia ni se imprime nunca. La pública va en src/firma-publica.pem, que
 * viaja dentro de la app. Si la privada se pierde, las instalaciones 3.x no
 * aceptarán ninguna actualización ni addon nuevos firmados con otra: hay que
 * guardarla con copia de seguridad.
 *
 * USO:  node build/firma.js clave    crea el par la primera vez (si ya existe, no toca nada)
 *       node build/firma.js addons   (npm run firma:addons) recalcula la huella de cada
 *                                    addon en addons/catalog.json y firma el catálogo
 * El feed del actualizador lo firma build/publish-release.js con firmaFeed(). */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const firmas = require('../src/firmas');

const RUTA_PRIVADA = path.join(os.homedir(), '.naviris-firma', 'privada.pem');
const ADDONS = path.join(__dirname, '..', 'addons');
const CATALOGO = path.join(ADDONS, 'catalog.json');

// La pública en PEM (de la propia pública o derivada de la privada)
const pemPublica = (clave) => (clave.type === 'public' ? clave : crypto.createPublicKey(clave)).export({ type: 'spki', format: 'pem' });

/* La privada, comprobando que es la pareja de la pública que lleva la app:
   firmar con otra dejaría a todas las instalaciones sin actualizaciones. */
function clavePrivada() {
  if (!fs.existsSync(RUTA_PRIVADA)) {
    throw new Error(`No está la clave privada de firma (${RUTA_PRIVADA}). Restáurala desde la copia de seguridad; sin ella no se puede firmar.`);
  }
  const privada = crypto.createPrivateKey(fs.readFileSync(RUTA_PRIVADA));
  if (pemPublica(privada) !== fs.readFileSync(firmas.RUTA_CLAVE_PUBLICA, 'utf8').replace(/\r\n/g, '\n')) {
    throw new Error(`La clave de ${RUTA_PRIVADA} no es la pareja de src/firma-publica.pem: no se firma nada con ella.`);
  }
  return privada;
}

function creaClave() {
  if (fs.existsSync(RUTA_PRIVADA)) { clavePrivada(); console.log('La clave de firma ya existe y es la pareja de src/firma-publica.pem. No se toca.'); return; }
  if (fs.existsSync(firmas.RUTA_CLAVE_PUBLICA)) {
    throw new Error('src/firma-publica.pem ya existe pero falta la privada: restaura la copia de seguridad. Crear otra dejaría a las instalaciones 3.x sin actualizaciones.');
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publica = pemPublica(publicKey), privada = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.mkdirSync(path.dirname(RUTA_PRIVADA), { recursive: true });
  fs.writeFileSync(RUTA_PRIVADA, privada, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(firmas.RUTA_CLAVE_PUBLICA, publica);
  console.log(`Clave creada. Privada: ${RUTA_PRIVADA} (haz copia de seguridad). Pública: src/firma-publica.pem`);
}

const firmaFeed = (texto, privada = clavePrivada()) => firmas.firma('feed', texto, privada);

// Huella de cada addon (el archivo de addons/ con el nombre de su `entry`) y firma del catálogo.
function firmaAddons(privada = clavePrivada()) {
  const cat = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'));
  for (const a of cat.addons) {
    const archivo = path.join(ADDONS, path.basename(new URL(a.entry).pathname));
    a.sha256 = firmas.huella(fs.readFileSync(archivo));
    console.log(` ${a.id} ${a.version}  ${a.sha256}`);
  }
  const texto = JSON.stringify(cat, null, 2) + '\n';
  fs.writeFileSync(CATALOGO, texto);
  fs.writeFileSync(CATALOGO + '.sig', firmas.firma('catalogo', firmas.enLF(texto), privada) + '\n');
  console.log(`Catálogo firmado: addons/catalog.json y addons/catalog.json.sig (${cat.addons.length} addons)`);
}

if (require.main === module) {
  try {
    const orden = process.argv[2];
    if (orden === 'clave') creaClave();
    else if (orden === 'addons') firmaAddons();
    else { console.error('Uso: node build/firma.js clave | addons'); process.exit(1); }
  } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { RUTA_PRIVADA, clavePrivada, firmaFeed, firmaAddons };

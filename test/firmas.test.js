// Firmas propias (src/firmas.js): el feed del actualizador y el catálogo de addons
// solo se aceptan con la firma Ed25519 de Naviris, y el código de un addon solo si
// tiene la huella del catálogo firmado. Las pruebas firman con una clave de usar y
// tirar; la real (fuera del repo) solo se usa para comprobar el catálogo del repo
// con su pública. Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const firmas = require('../src/firmas');

const RAIZ = path.join(__dirname, '..');
const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync('ed25519');
const otra = crypto.generateKeyPairSync('ed25519');

const SHA = crypto.createHash('sha512').update('instalador').digest('base64');
const FEED = `version: 3.0.1\nfiles:\n  - url: Naviris-Setup-3.0.1.exe\n    sha512: ${SHA}\n    size: 90000000\npath: Naviris-Setup-3.0.1.exe\nsha512: ${SHA}\nreleaseDate: '2026-11-11T00:00:00.000Z'\n`;
// Lo que electron-updater sacaría de ese feed (los campos que usa para descargar)
const infoDe = (texto) => yaml.load(texto);

test('firma y verificación: vale con su clave, no con otra, y una firma de catálogo no vale como de feed', () => {
  const f = firmas.firma('feed', FEED, priv);
  assert.equal(firmas.verifica('feed', FEED, f, pub), true);
  assert.equal(firmas.verifica('feed', FEED, f, otra.publicKey), false);
  assert.equal(firmas.verifica('catalogo', FEED, f, pub), false);
  assert.equal(firmas.verifica('feed', FEED, f + '\n', pub), true, 'el salto de línea del .sig no estorba');
  assert.equal(firmas.verifica('feed', FEED, 'basura', pub), false);
  assert.equal(firmas.verifica('feed', FEED, '', pub), false);
  assert.throws(() => firmas.firma('otra-cosa', FEED, priv), /desconocido/);
});

test('feed bueno: firmado y anunciando lo mismo que se va a bajar', () => {
  assert.equal(firmas.compruebaFeedFirmado(Buffer.from(FEED), firmas.firma('feed', FEED, priv), infoDe(FEED), pub), null);
});

test('feed manipulado, firma ausente, firma ajena o feed firmado que no es el que se va a bajar: no se descarga', () => {
  const f = firmas.firma('feed', FEED, priv);
  const malo = FEED.replace(/sha512: \S+/g, 'sha512: ' + crypto.createHash('sha512').update('otro').digest('base64'));
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(malo), f, infoDe(malo), pub), /firma del feed no es válida/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), '', infoDe(FEED), pub), /no tiene firma/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), firmas.firma('feed', FEED, otra.privateKey), infoDe(FEED), pub), /no es válida/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), firmas.firma('catalogo', FEED, priv), infoDe(FEED), pub), /no es válida/);
  // Feed firmado de verdad, pero electron-updater leyó otro (otro sha512, otra versión, otro archivo, otro tamaño)
  const info = infoDe(FEED);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), f, { ...info, sha512: 'X', files: [{ ...info.files[0], sha512: 'X' }] }, pub), /no coinciden/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), f, { ...info, version: '3.0.2' }, pub), /es de la 3\.0\.1 y se iba a bajar la 3\.0\.2/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), f, { ...info, files: [{ ...info.files[0], url: 'otro.exe' }] }, pub), /no coinciden/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), f, { ...info, files: [{ ...info.files[0], size: 1 }] }, pub), /no coinciden/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), f, { ...info, files: [...info.files, info.files[0]] }, pub), /no coinciden/);
  assert.match(firmas.compruebaFeedFirmado(Buffer.from(FEED), f, null, pub), /vacío/);
});

test('compruebaActualizacion baja <feed>.yml y .sig de la release de esa versión; sin firma no deja, sin red lanza', async () => {
  const sirve = (tabla) => async (url) => {
    const r = tabla[url];
    return r === undefined ? new Response('no', { status: 404 }) : (r instanceof Response ? r : new Response(r));
  };
  const base = firmas.RELEASES + 'v3.0.1/latest.yml';
  const f = firmas.firma('feed', FEED, priv);
  assert.equal(await firmas.compruebaActualizacion(infoDe(FEED), { pide: sirve({ [base]: FEED, [base + '.sig']: f }), clave: pub }), null);
  assert.match(await firmas.compruebaActualizacion(infoDe(FEED), { pide: sirve({ [base]: FEED }), clave: pub }), /no tiene firma/);
  assert.match(await firmas.compruebaActualizacion(infoDe(FEED), { pide: sirve({ [base + '.sig']: f }), clave: pub }), /no se encuentra el feed/);
  // Una dev lee dev.yml de su propia release
  const dev = FEED.replace(/3\.0\.1/g, '3.1.0-dev.2');
  const baseDev = firmas.RELEASES + 'v3.1.0-dev.2/dev.yml';
  assert.equal(await firmas.compruebaActualizacion(infoDe(dev), { pide: sirve({ [baseDev]: dev, [baseDev + '.sig']: firmas.firma('feed', dev, priv) }), clave: pub }), null);
  await assert.rejects(firmas.compruebaActualizacion(infoDe(FEED), { pide: sirve({ [base]: new Response('', { status: 502 }), [base + '.sig']: f }), clave: pub }), /HTTP 502/);
  assert.match(await firmas.compruebaActualizacion({ version: '../../x' }, { pide: sirve({}), clave: pub }), /versión no válida/);
});

const CATALOGO = JSON.stringify({ addons: [{ id: 'demo', name: 'Demo', version: '1.0.0', kind: 'tool', entry: 'https://naviris.site/addons/demo.js', sha256: firmas.huella('console.log(1);\n') }] }, null, 2) + '\n';

test('catálogo: firmado vale (también leído con CRLF); manipulado o sin firma no', () => {
  const f = firmas.firma('catalogo', CATALOGO, priv);
  assert.equal(firmas.leeCatalogo(Buffer.from(CATALOGO), f, pub)[0].id, 'demo');
  assert.equal(firmas.leeCatalogo(Buffer.from(CATALOGO.replace(/\n/g, '\r\n')), f, pub).length, 1);
  assert.throws(() => firmas.leeCatalogo(Buffer.from(CATALOGO.replace('1.0.0', '1.0.1')), f, pub), /No se pudo verificar el catálogo/);
  assert.throws(() => firmas.leeCatalogo(Buffer.from(CATALOGO.replace(/"sha256": "\w+"/, '"sha256": "' + 'a'.repeat(64) + '"')), f, pub), /No se pudo verificar/);
  assert.throws(() => firmas.leeCatalogo(Buffer.from(CATALOGO), null, pub), /No se pudo verificar/);
  assert.throws(() => firmas.leeCatalogo(Buffer.from(CATALOGO), firmas.firma('feed', CATALOGO, priv), pub), /No se pudo verificar/);
});

test('addon: solo se instala el código con la huella del catálogo (en LF), nunca otro', () => {
  const entrada = JSON.parse(CATALOGO).addons[0];
  assert.equal(firmas.compruebaAddon(entrada, Buffer.from('console.log(1);\n')), 'console.log(1);\n');
  assert.equal(firmas.compruebaAddon(entrada, Buffer.from('console.log(1);\r\n')), 'console.log(1);\n', 'el mismo código con CRLF se acepta y se guarda en LF');
  assert.throws(() => firmas.compruebaAddon(entrada, Buffer.from('console.log(2);\n')), /no coincide con el catálogo/);
  assert.throws(() => firmas.compruebaAddon({ ...entrada, sha256: undefined }, Buffer.from('console.log(1);\n')), /no coincide/);
  assert.throws(() => firmas.compruebaAddon({ ...entrada, sha256: entrada.sha256.toUpperCase() }, Buffer.from('console.log(1);\n')), /no coincide/);
});

test('el catálogo del repo está firmado con la clave de la app y cada huella es la del addon del repo (si cambias un addon: npm run firma:addons)', () => {
  const crudo = fs.readFileSync(path.join(RAIZ, 'addons', 'catalog.json'));
  const addons = firmas.leeCatalogo(crudo, fs.readFileSync(path.join(RAIZ, 'addons', 'catalog.json.sig'), 'utf8'));
  assert.ok(addons.length > 0);
  for (const a of addons) {
    const archivo = path.join(RAIZ, 'addons', path.basename(new URL(a.entry).pathname));
    assert.doesNotThrow(() => firmas.compruebaAddon(a, fs.readFileSync(archivo)), `${a.id}: su huella no es la de ${path.basename(archivo)}`);
  }
  // Sigue siendo el catálogo que leen las 2.x: mismos campos de siempre, la huella es un campo más
  for (const a of addons) for (const k of ['id', 'name', 'version', 'kind', 'entry']) assert.ok(a[k], `${a.id} sin ${k}`);
  assert.match(fs.readFileSync(firmas.RUTA_CLAVE_PUBLICA, 'utf8'), /^-----BEGIN PUBLIC KEY-----/);
});

test('main.js no descarga ni instala sin pasar por la firma', () => {
  const main = fs.readFileSync(path.join(RAIZ, 'src', 'main.js'), 'utf8');
  // electron-updater solo descarga desde descargaVerificada, después de comprobar el feed firmado
  const descargas = [...main.matchAll(/autoUpdater\.downloadUpdate\(\)/g)].map((m) => m.index);
  assert.equal(descargas.length, 1);
  const dv = main.indexOf('async function descargaVerificada()');
  assert.ok(dv > 0 && descargas[0] > dv && descargas[0] > main.indexOf('firmas.compruebaActualizacion(info', dv));
  assert.equal(main.match(/autoUpdater\.autoDownload = (\w+)/)[1], 'false');
  // Los addons: catálogo verificado y huella del código antes de escribirlo
  const inst = main.slice(main.indexOf("ipcMain.handle('addons:install'"), main.indexOf("ipcMain.handle('addons:uninstall'"));
  assert.ok(inst.indexOf('catalogoVerificado()') > 0 && inst.indexOf('firmas.compruebaAddon(') > inst.indexOf('catalogoVerificado()'));
  assert.ok(inst.indexOf('firmas.compruebaAddon(') < inst.indexOf('fs.writeFileSync('));
  assert.doesNotMatch(inst, /pedido\.(entry|name|version|sha256)/, 'de lo que manda la interfaz solo cuenta el id');
});

test('el publicador firma cada feed y sube la firma antes que el feed', () => {
  const pub = fs.readFileSync(path.join(RAIZ, 'build', 'publish-release.js'), 'utf8');
  assert.match(pub, /firmaFeed\(yml, clave\)/);
  assert.match(pub, /\[\{ file: p \+ '\.sig', name: c \+ '\.sig' \}, \{ file: p, name: c \}\]/);
  assert.match(pub, /firmas\.verifica\('feed', servido/);
});

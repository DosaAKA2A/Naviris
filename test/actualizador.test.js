// El actualizador, de punta a punta y sin salir a internet: los feeds que genera
// build/publish-release.js (build/feed-actualizador.js) se sirven desde un GitHub
// de mentira en 127.0.0.1 y los lee el MISMO electron-updater que llevan las
// instalaciones (GitHubProvider), con el canal que aplica main.js
// (src/canal-actualizaciones.js). Comprueba que el feed cuadra con el instalador
// (versión, sha512, tamaño y nombre) y que las líneas no se cruzan: una estable
// nunca recibe una dev, y una dev recibe la dev nueva aunque haya estables por medio.
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { HttpExecutor } = require('builder-util-runtime');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
const { AppUpdater } = require('electron-updater/out/AppUpdater');
// El semver que usa electron-updater (no el de la raíz): compara con instanceof
const semver = require(require.resolve('semver', { paths: [require.resolve('electron-updater')] }));
const feed = require('../build/feed-actualizador');
const { canalDeActualizacion } = require('../src/canal-actualizaciones');
const firmas = require('../src/firmas');

// Clave de usar y tirar para firmar los feeds de prueba, como hace build/publish-release.js con la real
const { publicKey: clavePub, privateKey: clavePriv } = crypto.generateKeyPairSync('ed25519');

const OWNER = 'DosaAKA2A', REPO = 'Naviris';
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-test-actualizador-'));
test.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));

// Un "instalador" por versión (bytes al azar) y su feed, tal como los dejaría el publicador.
function publica(version, { prerelease = feed.esDev(version), feedComo = feed.feedDe(version) } = {}) {
  const setupPath = path.join(carpeta, feed.nombres(version).setup);
  fs.writeFileSync(setupPath, crypto.randomBytes(4096 + Math.floor(Math.random() * 4096)));
  const texto = feed.generaFeed(version, setupPath);
  return { tag: 'v' + version, version, prerelease, setupPath, feeds: { [feedComo]: texto, [feedComo + '.sig']: firmas.firma('feed', texto, clavePriv) } };
}

/* GitHub de mentira con lo justo que pide electron-updater: el atom de releases
   (de la más nueva a la más vieja, como GitHub), /releases/latest (la última NO
   prerelease, como la API) y las descargas de cada tag. */
async function githubFalso(releases) {
  const base = `/${OWNER}/${REPO}/releases`;
  const servidor = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const envia = (codigo, cuerpo, tipo = 'text/plain') => { res.writeHead(codigo, { 'Content-Type': tipo }); res.end(cuerpo); };
    if (url === base + '.atom') {
      const entradas = releases.map((r) => `<entry><id>tag:github.com,2008:Repository/1/${r.tag}</id><updated>2026-11-11T00:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com${base}/tag/${r.tag}"/><title>${r.tag}</title><content type="html">notas de ${r.tag}</content></entry>`);
      return envia(200, `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entradas.join('')}</feed>`, 'application/atom+xml');
    }
    if (url === `/api/v3/repos/${OWNER}/${REPO}/releases/latest`) {
      const r = releases.find((x) => !x.prerelease);
      return r ? envia(200, JSON.stringify({ tag_name: r.tag }), 'application/json') : envia(404, '{}');
    }
    const m = new RegExp(`^${base}/download/([^/]+)/(.+)$`).exec(url);
    const r = m && releases.find((x) => x.tag === m[1]);
    if (r && r.feeds[m[2]]) return envia(200, r.feeds[m[2]]);
    if (r && m[2] === feed.nombres(r.version).subido.setup) return envia(200, fs.readFileSync(r.setupPath), 'application/octet-stream');
    envia(404, 'no está');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return { host: `127.0.0.1:${servidor.address().port}`, cierra: () => new Promise((r) => servidor.close(r)) };
}

class Ejecutor extends HttpExecutor {
  createRequest(opciones, alResponder) { return http.request({ ...opciones, agent: false }, alResponder); }
}

/* Lo que vería una instalación de `instalada` (con el ajuste devUpdates) al
   buscar actualizaciones: la versión que le ofrece el feed, si se instalaría y
   de dónde bajaría el instalador. */
async function mira(gh, instalada, devUpdates) {
  const canal = canalDeActualizacion(instalada, devUpdates);
  const updater = { ...canal, currentVersion: semver.parse(instalada), fullChangelog: false };
  const proveedor = new GitHubProvider({ provider: 'github', owner: OWNER, repo: REPO, host: gh.host, protocol: 'http' }, updater,
    { executor: new Ejecutor(), isUseMultipleRangeRequest: false, platform: 'win32' });
  const info = await proveedor.getLatestVersion();
  const instala = await AppUpdater.prototype.isUpdateAvailable.call({ ...updater, isUpdateSupported: () => true, isUserWithinRollout: () => true }, info);
  return { info, instala, archivo: proveedor.resolveFiles(info)[0] };
}

test('cada versión va a su feed: -dev a dev.yml y la estable a latest.yml', () => {
  assert.equal(feed.feedDe('3.0.0-dev.1'), 'dev.yml');
  assert.equal(feed.feedDe('2.8.1-dev.14'), 'dev.yml');
  assert.equal(feed.feedDe('2.8.1'), 'latest.yml');
  assert.equal(feed.feedDe('3.0.0'), 'latest.yml');
  // La versión que se compila ahora mismo también
  const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(feed.feedDe(version), /-dev/.test(version) ? 'dev.yml' : 'latest.yml');
});

test('el feed generado cuadra con el instalador: versión, sha512, tamaño y nombre subido', () => {
  const r = publica('3.0.0-dev.1');
  const texto = r.feeds['dev.yml'];
  assert.deepEqual(feed.compruebaFeed(texto, { version: '3.0.0-dev.1', setupPath: r.setupPath, nombreFeed: 'dev.yml' }), []);
  assert.match(texto, /^version: 3\.0\.0-dev\.1$/m);
  assert.match(texto, /url: Naviris-Setup-3\.0\.0-dev\.1\.exe$/m);
  assert.match(texto, new RegExp(`size: ${fs.statSync(r.setupPath).size}$`, 'm'));
});

test('la comprobación del feed caza cada descuadre', () => {
  const r = publica('2.8.1');
  const bien = r.feeds['latest.yml'];
  const opciones = { version: '2.8.1', setupPath: r.setupPath, nombreFeed: 'latest.yml' };
  const errores = (texto, o = opciones) => feed.compruebaFeed(texto, o).join(' | ');
  assert.match(errores(bien.replace('version: 2.8.1', 'version: 2.8.0')), /dice 2\.8\.0/);
  assert.match(errores(bien.replace(/sha512: \S+/g, 'sha512: AAAA')), /sha512/);
  assert.match(errores(bien.replace(/size: \d+/, 'size: 1')), /tamaño/);
  assert.match(errores(bien.replace(/Naviris-Setup-2\.8\.1\.exe/g, 'Naviris Setup 2.8.1.exe')), /se sube como Naviris-Setup-2\.8\.1\.exe/);
  assert.match(errores(bien, { ...opciones, nombreFeed: 'dev.yml' }), /no puede ir en dev\.yml/);
  const dev = publica('3.0.0-dev.1');
  assert.match(errores(dev.feeds['dev.yml'], { version: '3.0.0-dev.1', setupPath: dev.setupPath, nombreFeed: 'latest.yml' }), /no puede ir en latest\.yml/);
  fs.appendFileSync(r.setupPath, 'x');   // el instalador cambió después de generar el feed
  assert.match(errores(bien), /sha512.*tamaño/);
});

test('la release tiene que ir marcada como prerelease si y solo si es dev', () => {
  assert.deepEqual(feed.compruebaRelease({ tag_name: 'v3.0.0-dev.1', prerelease: true }, '3.0.0-dev.1'), []);
  assert.deepEqual(feed.compruebaRelease({ tag_name: 'v2.8.1', prerelease: false }, '2.8.1'), []);
  assert.match(feed.compruebaRelease({ tag_name: 'v3.0.0-dev.1', prerelease: false }, '3.0.0-dev.1')[0], /estables la tomarían/);
  assert.match(feed.compruebaRelease({ tag_name: 'v2.8.1', prerelease: true }, '2.8.1')[0], /no la verían/);
});

test('el canal que aplica main.js: estable escucha latest.yml, dev escucha dev.yml, y el ajuste manda', () => {
  assert.deepEqual(canalDeActualizacion('2.8.1'), { channel: 'latest', allowPrerelease: false, allowDowngrade: false });
  assert.deepEqual(canalDeActualizacion('3.0.0-dev.1'), { channel: 'dev', allowPrerelease: true, allowDowngrade: false });
  assert.deepEqual(canalDeActualizacion('2.8.1', true), { channel: 'dev', allowPrerelease: true, allowDowngrade: false });
  assert.deepEqual(canalDeActualizacion('3.0.0-dev.1', false), { channel: 'latest', allowPrerelease: false, allowDowngrade: true });
});

test('con el electron-updater real: la estable no ve la dev nueva y la dev sí, y lo que baja es el instalador anunciado', async () => {
  // Como hoy en GitHub: la 3.0 dev arriba del todo, luego la estable y las dev de la 2.8.1
  const releases = [publica('3.0.0-dev.1'), publica('2.8.1'), publica('2.8.1-dev.14'), publica('2.8.0')];
  const gh = await githubFalso(releases);
  try {
    const estable = await mira(gh, '2.8.0');
    assert.equal(estable.info.version, '2.8.1', 'la 2.8.0 debe recibir la 2.8.1, no la 3.0 dev');
    assert.equal(estable.instala, true);
    assert.equal((await mira(gh, '2.8.1')).instala, false, 'la 2.8.1 ya está al día: la dev nueva no cuenta');

    const dev = await mira(gh, '2.8.1-dev.14');
    assert.equal(dev.info.version, '3.0.0-dev.1');
    assert.equal(dev.instala, true);
    assert.equal((await mira(gh, '2.8.1', true)).info.version, '3.0.0-dev.1', 'una estable apuntada a dev en Ajustes recibe la dev');
    assert.equal((await mira(gh, '3.0.0-dev.1', false)).info.version, '2.8.1', 'una dev que vuelve a la estable recibe la estable');

    // Lo que bajaría la dev: la ruta del instalador subido y con el sha512 que anuncia el feed
    assert.equal(dev.archivo.url.pathname, `/${OWNER}/${REPO}/releases/download/v3.0.0-dev.1/Naviris-Setup-3.0.0-dev.1.exe`);
    const bajado = Buffer.from(await (await fetch(dev.archivo.url)).arrayBuffer());
    assert.equal(crypto.createHash('sha512').update(bajado).digest('base64'), dev.info.sha512);
    assert.equal(bajado.length, dev.archivo.info.size);
  } finally { await gh.cierra(); }
});

test('con el electron-updater real: una dev sin marcar como prerelease rompe la estable (por eso el publicador la rechaza)', async () => {
  const releases = [publica('3.0.0-dev.1', { prerelease: false }), publica('2.8.1')];
  const gh = await githubFalso(releases);
  try {
    // La estable no recibe la dev (no hay latest.yml en ese tag), pero se queda sin actualizaciones
    await assert.rejects(mira(gh, '2.8.0'), /Cannot find latest\.yml/);
    assert.match(feed.compruebaRelease({ tag_name: 'v3.0.0-dev.1', prerelease: false }, '3.0.0-dev.1')[0], /prerelease/);
  } finally { await gh.cierra(); }
});

test('con el electron-updater real: si una dev escribiera latest.yml, las estables la instalarían (por eso cada línea escribe solo su feed)', async () => {
  // Lo que pasaría con una dev publicada como estable y con latest.yml: exactamente lo que el publicador impide
  const releases = [publica('3.0.0-dev.1', { prerelease: false, feedComo: 'latest.yml' }), publica('2.8.1')];
  const gh = await githubFalso(releases);
  try {
    const r = await mira(gh, '2.8.1');
    assert.equal(r.info.version, '3.0.0-dev.1');
    assert.equal(r.instala, true);
    // El publicador nunca genera eso: la dev va a dev.yml y la comprobación del feed lo rechazaría
    assert.equal(feed.feedDe('3.0.0-dev.1'), 'dev.yml');
    assert.notDeepEqual(feed.compruebaFeed(releases[0].feeds['latest.yml'], { version: '3.0.0-dev.1', nombreFeed: 'latest.yml' }), []);
  } finally { await gh.cierra(); }
});

test('con el electron-updater real: lo que va a bajar pasa la firma; con el feed o la firma tocados, o sin firma, no', async () => {
  const releases = [publica('3.0.0-dev.2'), publica('2.8.1')];
  const gh = await githubFalso(releases);
  // La app pide a github.com; aquí se redirige al GitHub de mentira
  const pide = (url) => fetch(url.replace('https://github.com/', `http://${gh.host}/`));
  try {
    const dev = await mira(gh, '3.0.0-dev.1');
    assert.equal(dev.info.version, '3.0.0-dev.2');
    assert.equal(await firmas.compruebaActualizacion(dev.info, { pide, clave: clavePub }), null);
    const estable = await mira(gh, '2.8.0');
    assert.equal(await firmas.compruebaActualizacion(estable.info, { pide, clave: clavePub }), null);

    // Alguien con acceso a la release cambia el instalador y su sha512 en el feed: la firma ya no vale
    const r = releases[0];
    const original = r.feeds['dev.yml'];
    fs.writeFileSync(r.setupPath, crypto.randomBytes(5000));
    r.feeds['dev.yml'] = feed.generaFeed(r.version, r.setupPath);
    const tocado = await mira(gh, '3.0.0-dev.1');
    assert.notEqual(tocado.info.sha512, dev.info.sha512);
    assert.match(await firmas.compruebaActualizacion(tocado.info, { pide, clave: clavePub }), /firma del feed no es válida/);
    // …y si además firma él (con otra clave), tampoco
    r.feeds['dev.yml.sig'] = firmas.firma('feed', r.feeds['dev.yml'], crypto.generateKeyPairSync('ed25519').privateKey);
    assert.match(await firmas.compruebaActualizacion(tocado.info, { pide, clave: clavePub }), /no es válida/);
    // Si deja el feed firmado original pero electron-updater leyera otro, tampoco
    r.feeds['dev.yml'] = original; r.feeds['dev.yml.sig'] = firmas.firma('feed', original, clavePriv);
    assert.match(await firmas.compruebaActualizacion(tocado.info, { pide, clave: clavePub }), /no coinciden/);
    // Sin firma (una release vieja, o quitada): no
    delete r.feeds['dev.yml.sig'];
    assert.match(await firmas.compruebaActualizacion(dev.info, { pide, clave: clavePub }), /no tiene firma/);
  } finally { await gh.cierra(); }
});

test('el publicador usa el feed comprobado, corre las pruebas antes y solo se salta con la variable documentada', () => {
  const pub = fs.readFileSync(path.join(__dirname, '..', 'build', 'publish-release.js'), 'utf8');
  assert.match(pub, /require\('\.\/feed-actualizador'\)/);
  assert.match(pub, /feed\.compruebaFeed\(yml/);
  assert.match(pub, /feed\.compruebaRelease\(rel, VER\)/);
  // La puerta va antes de tocar nada (ni token, ni dist/, ni GitHub)
  const puerta = pub.indexOf('if (!pasaLasPruebas()) process.exit(1);');
  assert.ok(puerta > 0 && puerta < pub.indexOf("if (!TOKEN)") && puerta < pub.indexOf('generaFeed('));
  assert.deepEqual([...new Set(pub.match(/NAVIRIS_[A-Z_]+/g))], ['NAVIRIS_PUBLICAR_SIN_PRUEBAS']);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8'), /NAVIRIS_PUBLICAR_SIN_PRUEBAS/);
});

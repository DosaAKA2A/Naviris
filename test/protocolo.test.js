// La interfaz por naviris://app (src/protocolo.js): qué archivos sirve y cuáles nunca.
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { archivoDe, manejador, url, urlDeDatos, esInterfaz, ESQUEMA, PRIVILEGIOS } = require('../src/protocolo');

const SRC = path.join(__dirname, '..', 'src');
const temporales = [];
test.after(() => { for (const d of temporales) fs.rmSync(d, { recursive: true, force: true }); });

// Una carpeta de app y una de perfil de mentira, más un secreto fuera de las dos.
function montaje() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-test-protocolo-'));
  temporales.push(raiz);
  const app = path.join(raiz, 'app'), datos = path.join(raiz, 'perfil'), fuera = path.join(raiz, 'fuera');
  const escribe = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  escribe(path.join(app, 'index.html'), '<!doctype html><title>Naviris</title>');
  escribe(path.join(app, 'main.js'), 'proceso principal');
  escribe(path.join(app, 'app-key.js'), 'module.exports = "clave secreta"');
  escribe(path.join(app, 'renderer', 'nucleo.js'), 'const x = 1;');
  escribe(path.join(app, 'sonidos', 'aire', 'aviso.ogg'), 'OggS');
  escribe(path.join(datos, 'fondos', 'hub-1.jpg'), 'jpg del fondo');
  escribe(path.join(datos, 'naviris-passwords.json'), '[]');
  escribe(path.join(fuera, 'secreto.js'), 'SECRETO');
  return { app, datos, fuera };
}

test('sirve lo que carga la interfaz', () => {
  const dirs = { app: 'C:\\App\\src', datos: 'C:\\Perfil' };
  for (const [u, ruta] of [
    ['naviris://app/index.html', 'C:\\App\\src\\index.html'],
    ['naviris://app/index.html?private=1&sacada=1', 'C:\\App\\src\\index.html'],
    ['naviris://app/renderer/nucleo.js', 'C:\\App\\src\\renderer\\nucleo.js'],
    ['naviris://app/sonidos/aire/aviso.ogg', 'C:\\App\\src\\sonidos\\aire\\aviso.ogg'],
    ['naviris://app/temas/oscuro/1.jpg', 'C:\\App\\src\\temas\\oscuro\\1.jpg'],
    ['naviris://app/fonts/inter-var.woff2', 'C:\\App\\src\\fonts\\inter-var.woff2'],
    ['naviris://app/datos/fondos/hub-1.jpg', 'C:\\Perfil\\fondos\\hub-1.jpg'],
    ['naviris://app/datos/imagenes/ab12.png', 'C:\\Perfil\\imagenes\\ab12.png'],
    ['naviris://app/datos/imagenes/mi%20foto.webp', 'C:\\Perfil\\imagenes\\mi foto.webp']
  ]) assert.equal(archivoDe(u, dirs)?.ruta, path.normalize(ruta), u);
});

test('nunca sirve nada fuera de la lista, ni saliéndose de la carpeta', () => {
  const dirs = { app: 'C:\\App\\src', datos: 'C:\\Perfil' };
  for (const u of [
    // del proceso principal o que no carga la interfaz
    'naviris://app/main.js', 'naviris://app/app-key.js', 'naviris://app/preload.js', 'naviris://app/migraciones.js',
    'naviris://app/fonts/LICENSE-Inter.txt', 'naviris://app/', 'naviris://app/renderer',
    // salirse de la carpeta, de todas las formas
    'naviris://app/../main.js', 'naviris://app/renderer/../../package.json', 'naviris://app/%2e%2e/package.json',
    'naviris://app/renderer/%2e%2e%2f..%2fpackage.json', 'naviris://app/renderer%2f..%2fmain.js', 'naviris://app/renderer%5c..%5cmain.js',
    'naviris://app/renderer/..%5c..%5cmain.js', 'naviris://app/renderer/C:%5cWindows%5cwin.ini', 'naviris://app/renderer/C:/Windows/win.ini',
    'naviris://app/renderer/nucleo.js%00.png', 'naviris://app/renderer//nucleo.js', 'naviris://app/renderer/./nucleo.js',
    'naviris://app/renderer/%ZZ.js', 'naviris://app/renderer/.oculto.js', 'naviris://app/renderer/nucleo.js%20',
    // perfil: solo imágenes, solo esas dos carpetas y sin subcarpetas
    'naviris://app/datos/naviris-passwords.json', 'naviris://app/datos/fondos/x.html', 'naviris://app/datos/fondos/x.js',
    'naviris://app/datos/Network/Cookies', 'naviris://app/datos/fondos/a/b.jpg', 'naviris://app/datos/fondos/..%2fnaviris-passwords.json',
    'naviris://app/datos/fondos/%2e%2e', 'naviris://app/datos/Local%20Storage/x.png',
    // otro host, usuario, puerto u otro esquema
    'naviris://otra/index.html', 'naviris://APP/index.html', 'naviris://x@app/index.html', 'naviris://app:80/index.html',
    'file:///C:/App/src/index.html', 'naviris-addon://tool/index.html', 'https://app/index.html', 'no es url'
  ]) {
    const a = archivoDe(u, dirs);
    // `..` resuelto por el parser puede quedar en una ruta permitida, pero nunca fuera de la carpeta.
    if (a) assert.ok(a.ruta.startsWith('C:\\App\\src\\') && !/main\.js|package\.json/.test(a.ruta) && a.ruta === path.normalize(a.ruta), u + ' -> ' + a.ruta);
  }
  for (const u of ['naviris://app/main.js', 'naviris://app/app-key.js', 'naviris://app/renderer%2f..%2fmain.js', 'naviris://app/renderer%5c..%5cmain.js',
    'naviris://app/datos/naviris-passwords.json', 'naviris://app/renderer/C:%5cWindows%5cwin.ini', 'naviris://app/renderer/nucleo.js%00.png']) {
    assert.equal(archivoDe(u, dirs), null, u);
  }
});

test('el manejador responde 200 con su tipo, y 404 a todo lo demás', async () => {
  const dirs = montaje();
  const pide = manejador(dirs);
  const r = await pide(new Request('naviris://app/index.html?private=1'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await r.text(), '<!doctype html><title>Naviris</title>');
  assert.equal((await pide(new Request('naviris://app/sonidos/aire/aviso.ogg'))).headers.get('content-type'), 'audio/ogg');
  assert.equal(await (await pide(new Request('naviris://app/datos/fondos/hub-1.jpg'))).text(), 'jpg del fondo');
  for (const u of ['naviris://app/main.js', 'naviris://app/app-key.js', 'naviris://app/renderer/no-existe.js', 'naviris://app/datos/naviris-passwords.json',
    'naviris://app/renderer%2f..%2fmain.js', 'naviris://app/datos/fondos/..%2fnaviris-passwords.json']) {
    const x = await pide(new Request(u));
    assert.equal(x.status, 404, u);
    assert.equal(await x.text(), '', u);
  }
  assert.equal((await pide(new Request('naviris://app/index.html', { method: 'POST', body: 'x' }))).status, 405);
  const cabeza = await pide(new Request('naviris://app/index.html', { method: 'HEAD' }));
  assert.equal(cabeza.status, 200);
  assert.equal(await cabeza.text(), '');
});

test('un enlace dentro de la carpeta que apunta fuera no sirve el archivo de fuera', async () => {
  const dirs = montaje();
  // Una unión de carpetas de Windows (no pide permisos de administrador): renderer/fuera -> la carpeta del secreto.
  fs.symlinkSync(dirs.fuera, path.join(dirs.app, 'renderer', 'fuera'), 'junction');
  const r = await manejador(dirs)(new Request('naviris://app/renderer/fuera/secreto.js'));
  assert.equal(r.status, 404);
});

test('index.html y splash.html solo cargan cosas que el protocolo sirve y existen', () => {
  const dirs = { app: SRC, datos: os.tmpdir() };
  for (const pagina of ['index.html', 'splash.html']) {
    const html = fs.readFileSync(path.join(SRC, pagina), 'utf8');
    const pedidos = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(pedidos.length > 2, pagina);
    for (const p of pedidos) {
      const a = archivoDe(new URL(p, url(pagina)).href, dirs);
      assert.ok(a, `${pagina} pide ${p} y el protocolo no lo sirve (añádelo a ARCHIVOS_APP o CARPETAS_APP)`);
      assert.ok(fs.existsSync(a.ruta), `${pagina} pide ${p}, que no existe`);
    }
  }
  // Las fuentes del CSS y los sonidos también.
  assert.ok(fs.existsSync(archivoDe(new URL('fonts/inter-var.woff2', url('index.html')).href, dirs).ruta));
});

test('direcciones de la interfaz', () => {
  assert.equal(url('index.html'), 'naviris://app/index.html');
  assert.equal(url('index.html', {}), 'naviris://app/index.html');
  assert.equal(url('index.html', { private: '1', sacada: '1' }), 'naviris://app/index.html?private=1&sacada=1');
  assert.equal(urlDeDatos('fondos', 'hub 1.jpg'), 'naviris://app/datos/fondos/hub%201.jpg');
  assert.equal(esInterfaz('naviris://app/index.html?private=1'), true);
  for (const u of ['naviris://app/splash.html', 'file:///C:/x/src/index.html', 'naviris://otra/index.html', 'https://app/index.html', '', null]) assert.equal(esInterfaz(u), false, String(u));
  assert.equal(ESQUEMA, 'naviris');
  assert.deepEqual(PRIVILEGIOS, { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true });
});

test('el esquema solo existe en la sesión de la interfaz y en la del splash', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  const sitios = [...main.matchAll(/^.*protocol\.handle\(protocolo\.ESQUEMA.*$/gm)].map((m) => m[0].trim());
  assert.deepEqual(sitios, [
    'protocol.handle(protocolo.ESQUEMA, sirveApp);',
    'session.fromPartition(PART_SPLASH).protocol.handle(protocolo.ESQUEMA, sirveApp);'
  ]);
  // Ninguna página de la app se carga ya por file://
  assert.doesNotMatch(main, /loadFile\(/);
});

// Enlaces y archivos que llegan a Naviris por la línea de comandos (src/abrir-desde-fuera.js).
// npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ARG_UNICO, destinosDeArgumentos, opcionesPropias, argumentosParaRelanzar } = require('../src/abrir-desde-fuera');

const EXE = 'C:\\Users\\x\\AppData\\Local\\Programs\\Naviris\\Naviris.exe';
const nada = () => false;

test('sin argumentos o solo con opciones no abre nada', () => {
  assert.deepEqual(destinosDeArgumentos([EXE], { existe: nada }), []);
  assert.deepEqual(destinosDeArgumentos([EXE, '--updated', '--user-data-dir=C:/p'], { existe: nada }), []);
});

test('un enlace web (como lo manda Windows con --single-argument)', () => {
  assert.deepEqual(destinosDeArgumentos([EXE, ARG_UNICO, 'https://example.com/a?b=1#c'], { existe: nada }), ['https://example.com/a?b=1#c']);
  assert.deepEqual(destinosDeArgumentos([EXE, 'http://example.com'], { existe: nada }), ['http://example.com/']);
});

test('lo que va detrás de --single-argument es un solo destino, aunque parezca una opción', () => {
  // Node parte la línea por los espacios; Chromium no (medido): se vuelve a juntar.
  const argv = [EXE, ARG_UNICO, 'https://a.com/x', '--remote-debugging-port=9555', 'b'];
  assert.deepEqual(destinosDeArgumentos(argv, { existe: nada }), ['https://a.com/x%20--remote-debugging-port=9555%20b']);
  assert.deepEqual(opcionesPropias(argv), []);
  // Las opciones de antes sí son de quien arrancó Naviris.
  assert.deepEqual(opcionesPropias([EXE, '--user-data-dir=C:/p', ARG_UNICO, '--user-data-dir=C:/malo']), ['--user-data-dir=C:/p']);
});

test('una ruta con espacios que Windows no entrecomilla (--single-argument %1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-args-'));
  try {
    const pdf = path.join(dir, 'Mi informe #1.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4');
    const partes = pdf.split(' ');
    assert.deepEqual(destinosDeArgumentos([EXE, ARG_UNICO, ...partes]), [pathToFileURL(pdf).href]);
    assert.match(pathToFileURL(pdf).href, /^file:\/\/\/.*Mi%20informe%20%231\.pdf$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rutas desde una consola: relativas a su carpeta, solo archivos que existen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-args-'));
  try {
    fs.writeFileSync(path.join(dir, 'pagina.html'), '<p>hola</p>');
    fs.mkdirSync(path.join(dir, 'carpeta'));
    const r = destinosDeArgumentos([EXE, 'pagina.html', 'carpeta', 'no-existe.pdf', 'hola'], { cwd: dir });
    assert.deepEqual(r, [pathToFileURL(path.join(dir, 'pagina.html')).href]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('en desarrollo («electron .») la carpeta de la app no es un destino', () => {
  const argv = ['electron.exe', '.', '--remote-debugging-port=9414', 'https://example.com/'];
  assert.deepEqual(destinosDeArgumentos(argv, { defaultApp: true, existe: () => true }), ['https://example.com/']);
});

test('solo http, https y file; varios a la vez, sin repetir', () => {
  const argv = [EXE, 'https://a.com/', 'javascript:alert(1)', 'mailto:x@y.z', 'naviris-addon://tool/x.js', 'file:///C:/x/y.html', 'https://a.com/', 'https://'];
  assert.deepEqual(destinosDeArgumentos(argv, { existe: nada }), ['https://a.com/', 'file:///C:/x/y.html']);
});

test('relanzar al cerrar: mismas opciones (y carpeta en desarrollo) más lo que traía la otra', () => {
  assert.deepEqual(
    argumentosParaRelanzar(['electron.exe', '.', '--user-data-dir=C:/p', 'https://viejo.com/'], true, ['https://nuevo.com/']),
    ['.', '--user-data-dir=C:/p', 'https://nuevo.com/']);
  assert.deepEqual(argumentosParaRelanzar([EXE, ARG_UNICO, 'https://viejo.com/'], false, ['file:///C:/a.pdf']), ['file:///C:/a.pdf']);
});

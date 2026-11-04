// Descarga de los binarios (src/descarga-binarios.js): termina siempre, sin excepciones sueltas.
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { creaDownloadTo } = require('../src/descarga-binarios');

// net.request de mentira: `guion(req)` decide qué pasa después de req.end().
function pidePara(guion) {
  return () => {
    const req = new EventEmitter();
    req.abortada = false;
    req.abort = () => { req.abortada = true; };
    req.end = () => setImmediate(() => guion(req));
    pidePara.ultima = req;
    return req;
  };
}
function respuesta(req, statusCode, cabeceras = {}) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = cabeceras;
  req.emit('response', res);
  return res;
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let dir;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-descarga-')); });
test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
// Un EBUSY como el del antivirus. Windows no siempre lo da a voluntad: se simula.
const ocupado = (t) => t.mock.method(fs, 'rmSync', () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); });

test('una descarga buena acaba con el archivo en su sitio y sin temporal', async () => {
  const dest = path.join(dir, 'yt-dlp.exe');
  const progreso = [];
  const baja = creaDownloadTo(pidePara((req) => {
    const res = respuesta(req, 200, { 'content-length': '4' });
    res.emit('data', Buffer.from('ab')); res.emit('data', Buffer.from('cd')); res.emit('end');
  }));
  await baja('u', dest, (p) => progreso.push(p));
  assert.equal(fs.readFileSync(dest, 'utf8'), 'abcd');
  assert.equal(fs.existsSync(dest + '.descarga'), false);
  assert.deepEqual(progreso, [0.5, 1]);
});

test('un error de red rechaza y no deja temporal: el archivo estaba cerrado al borrarlo', async (t) => {
  const dest = path.join(dir, 'x.exe');
  const abrir = fs.createWriteStream;
  let stream = null;
  t.mock.method(fs, 'createWriteStream', (...a) => { stream = abrir(...a); return stream; });
  const baja = creaDownloadTo(pidePara((req) => {
    const res = respuesta(req, 200);
    res.emit('data', Buffer.from('medio'));
    setTimeout(() => res.emit('error', new Error('corte')), 20);
  }));
  await assert.rejects(baja('u', dest), /corte/);
  assert.equal(stream.closed, true, 'cerrado antes de terminar');
  assert.equal(pidePara.ultima.abortada, true);
  assert.equal(fs.existsSync(dest + '.descarga'), false);
  assert.equal(fs.existsSync(dest), false);
});

test('si no se puede borrar el temporal rechaza igual, con el error de verdad y sin lanzar', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dest = path.join(dir, 'x.exe');
  ocupado(t);
  const baja = creaDownloadTo(pidePara((req) => {
    const res = respuesta(req, 200);
    res.emit('data', Buffer.from('medio'));
    setTimeout(() => res.emit('error', new Error('corte')), 20);
  }));
  await assert.rejects(baja('u', dest), /corte/);
  t.mock.restoreAll();
});

test('el plazo vencido (corre en un temporizador) rechaza aunque el borrado falle', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dest = path.join(dir, 'x.exe');
  ocupado(t);
  const baja = creaDownloadTo(pidePara((req) => { respuesta(req, 200).emit('data', Buffer.from('algo')); }), 50);
  let suelta = null;
  const alSoltar = (e) => { suelta = e; };
  process.once('uncaughtException', alSoltar);
  await assert.rejects(baja('u', dest), /parada/);
  await espera(20);
  process.removeListener('uncaughtException', alSoltar);
  assert.equal(suelta, null, 'ninguna excepción suelta');
  t.mock.restoreAll();
});

test('si falla el renombrado y también el borrado, rechaza con el del renombrado', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dest = path.join(dir, 'x.exe');
  ocupado(t);
  t.mock.method(fs, 'renameSync', () => { throw new Error('EPERM rename'); });
  const baja = creaDownloadTo(pidePara((req) => { const res = respuesta(req, 200); res.emit('data', Buffer.from('a')); res.emit('end'); }));
  await assert.rejects(baja('u', dest), /EPERM rename/);
  t.mock.restoreAll();
});

test('el stream se cierra también si falla al escribir o si la descarga viene corta', async () => {
  // Destino en una carpeta que no existe: el stream da error al abrir.
  const baja = creaDownloadTo(pidePara((req) => { respuesta(req, 200).emit('data', Buffer.from('a')); }));
  await assert.rejects(baja('u', path.join(dir, 'no', 'existe.exe')), /ENOENT/);
  const dest = path.join(dir, 'corta.exe');
  const baja2 = creaDownloadTo(pidePara((req) => {
    const res = respuesta(req, 200, { 'content-length': '10' });
    res.emit('data', Buffer.from('abc')); res.emit('end');
  }));
  await assert.rejects(baja2('u', dest), /incompleta/);
  assert.equal(fs.existsSync(dest + '.descarga'), false);
  assert.equal(fs.existsSync(dest), false);
});

test('un HTTP que no es 200 rechaza sin crear nada', async () => {
  const dest = path.join(dir, 'x.exe');
  await assert.rejects(creaDownloadTo(pidePara((req) => { respuesta(req, 404); }))('u', dest), /HTTP 404/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('tras terminar, los datos que aún lleguen no escriben ni rearman el plazo', async () => {
  const dest = path.join(dir, 'x.exe');
  let res;
  const baja = creaDownloadTo(pidePara((req) => { res = respuesta(req, 200); res.emit('data', Buffer.from('a')); setTimeout(() => res.emit('error', new Error('corte')), 10); }), 40);
  await assert.rejects(baja('u', dest), /corte/);
  res.emit('data', Buffer.from('tarde'));
  res.emit('end');
  await espera(60);
  assert.equal(fs.existsSync(dest + '.descarga'), false);
});

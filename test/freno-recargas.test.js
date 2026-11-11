// Freno de bucles de recargas (src/freno-recargas.js).
// npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearFreno, claveDe, MAX, PAUSA } = require('../src/freno-recargas');

const URL_ = 'https://www.youtube.com/';

test('una web que se recarga sola se frena al pasar del tope y sigue cortada', () => {
  const f = crearFreno();
  let t = 1000;
  for (let i = 0; i < MAX; i++) assert.equal(f.navega(URL_, t += 200), 'sigue');
  assert.equal(f.navega(URL_, t += 200), 'frena');
  assert.equal(f.navega(URL_, t += 200), 'corta');
  assert.equal(f.navega(URL_ + '?themeRefresh=1', t += 200), 'corta');   // misma ruta, otra query
  // pasada la pausa vuelve a cargar
  assert.equal(f.navega(URL_, t + PAUSA + 1), 'sigue');
});

test('las recargas del usuario no cuentan: siete F5 seguidos recargan los siete', () => {
  const f = crearFreno();
  let t = 1000;
  for (let i = 0; i < 7; i++) {
    t += 500;
    f.usuario(t);
    assert.equal(f.navega(URL_, t + 5), 'sigue', 'F5 nº ' + (i + 1));
  }
});

test('un F5 del usuario quita el freno puesto', () => {
  const f = crearFreno();
  let t = 1000;
  for (let i = 0; i <= MAX; i++) f.navega(URL_, t += 100);
  assert.equal(f.navega(URL_, t += 100), 'corta');
  f.usuario(t += 100);
  assert.equal(f.navega(URL_, t + 5), 'sigue');
});

test('tras un F5, un bucle de la página se vuelve a frenar (no reabre el bucle)', () => {
  const f = crearFreno();
  let t = 1000;
  f.usuario(t);
  assert.equal(f.navega(URL_, t + 5), 'sigue');
  const r = [];
  for (let i = 0; i <= MAX; i++) r.push(f.navega(URL_, t += 200));
  assert.equal(r[MAX], 'frena');
  assert.ok(r.slice(0, MAX).every((x) => x === 'sigue'));
});

test('el pase vale para UNA navegación y caduca', () => {
  const f = crearFreno({ pase: 3000 });
  f.usuario(1000);
  assert.equal(f.navega(URL_, 1001), 'sigue');
  // la siguiente ya cuenta como de la página
  let t = 1001;
  for (let i = 0; i < MAX; i++) assert.equal(f.navega(URL_, t += 100), 'sigue');
  assert.equal(f.navega(URL_, t += 100), 'frena');
  // un pase caducado no sirve
  const g = crearFreno({ pase: 3000 });
  g.usuario(0);
  for (let i = 0; i <= MAX; i++) g.navega(URL_, 5000 + i);
  assert.equal(g.navega(URL_, 5100), 'corta');
});

test('lo que no es http(s) ni tiene ruta válida no cuenta', () => {
  const f = crearFreno();
  for (let i = 0; i < 20; i++) assert.equal(f.navega('about:blank', i), 'sigue');
  assert.equal(claveDe('file:///C:/x.html'), null);
  assert.equal(claveDe('https://a.com/b?c=1#d'), 'https://a.com/b');
});

test('cambiar de página reinicia la cuenta', () => {
  const f = crearFreno();
  let t = 0;
  for (let i = 0; i < MAX; i++) f.navega(URL_, t += 100);
  assert.equal(f.navega('https://example.com/', t += 100), 'sigue');
  assert.equal(f.navega(URL_, t += 100), 'sigue');
});

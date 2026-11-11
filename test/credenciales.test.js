// A qué páginas se ofrece una contraseña guardada (src/credenciales.js, auditoría #9):
// por sitio y por esquema, y la migración de las guardadas sin esquema.
// Se ejecuta con: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/credenciales');

test('una capturada en https no sale ni se rellena en http del mismo host', () => {
  const e = { site: 'banco.com', esquema: 'https' };
  assert.equal(c.valeEn(e, 'banco.com', 'https'), true);
  assert.equal(c.valeEn(e, 'banco.com', 'http'), false);
  assert.equal(c.valeEn(e, 'login.banco.com', 'http'), false);
});

test('una capturada en http vale en http y en https (la web pasó a https)', () => {
  const e = { site: 'viejo.com', esquema: 'http' };
  assert.equal(c.valeEn(e, 'viejo.com', 'http'), true);
  assert.equal(c.valeEn(e, 'viejo.com', 'https'), true);
});

test('el sitio sigue mandando: otro dominio nunca', () => {
  assert.equal(c.valeEn({ site: 'bbc.co.uk', esquema: 'https' }, 'evil.co.uk', 'https'), false);
  assert.equal(c.valeEn({ site: 'bbc.co.uk', esquema: 'https' }, 'login.bbc.co.uk', 'https'), true);
  assert.equal(c.valeEn({ site: 'a.com', esquema: 'http' }, 'b.com', 'http'), false);
});

test('las guardadas sin esquema: https, salvo en el equipo o la red de casa', () => {
  assert.equal(c.esquemaDe({ site: 'github.com' }), 'https');
  assert.equal(c.esquemaDe({ site: 'www.github.com' }), 'https');
  for (const h of ['192.168.1.1', '10.0.0.138', '172.16.0.1', '172.31.255.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', 'localhost', 'router', 'nas.local', 'fritz.box.lan', 'casa.home', 'equipo.internal', '[::1]', '[fd12:3456::1]', '[fe80::1]']) {
    assert.equal(c.esquemaDe({ site: h }), 'http', h);
  }
  for (const h of ['172.32.0.1', '8.8.8.8', '192.169.0.1', 'local.com', 'lan.example.org', '[2001:db8::1]']) {
    assert.equal(c.esquemaDe({ site: h }), 'https', h);
  }
  // El router de siempre se sigue ofreciendo por http.
  assert.equal(c.valeEn({ site: '192.168.1.1' }, '192.168.1.1', 'http'), true);
  assert.equal(c.valeEn({ site: 'github.com' }, 'github.com', 'http'), false);
});

test('las del CSV de otro navegador llevan la dirección entera: manda su esquema', () => {
  assert.equal(c.esquemaDe({ site: 'http://intranet.empresa.com/login' }), 'http');
  assert.equal(c.esquemaDe({ site: 'https://accounts.google.com/signin' }), 'https');
  assert.equal(c.esquemaDe({ site: 'https://192.168.1.1/' }), 'https');
  // Uno ya puesto gana a todo.
  assert.equal(c.esquemaDe({ site: 'https://x.com', esquema: 'http' }), 'http');
});

test('la migración solo añade el esquema, una vez, sin perder nada', () => {
  const lista = [
    { id: 'pw1', site: 'github.com', username: 'ana', enc: 'AAA' },
    { id: 'pw2', site: '192.168.1.1', username: 'admin', enc: 'BBB' },
    { id: 'pw3', site: 'http://intranet.test/x', username: '', enc: 'CCC' },
    { id: 'pw4', site: 'banco.com', username: 'ana', enc: 'DDD', esquema: 'https' }
  ];
  const copia = JSON.parse(JSON.stringify(lista));
  assert.equal(c.migra(lista), 3);
  assert.deepEqual(lista.map((e) => e.esquema), ['https', 'http', 'http', 'https']);
  lista.forEach((e, i) => { const { esquema, ...resto } = e; const { esquema: _, ...antes } = copia[i]; assert.deepEqual(resto, antes); });
  assert.equal(c.migra(lista), 0, 'ya migradas');
});

test('al guardar: la de https no la pisa una escrita en http; la de http pasa a https', () => {
  const lista = [{ id: 'a', site: 'web.com', username: 'ana', esquema: 'https' }];
  assert.equal(c.existente(lista, 'web.com', 'ana', 'http'), null, 'en http se guarda aparte');
  assert.equal(c.existente(lista, 'web.com', 'ana', 'https').id, 'a');
  const vieja = [{ id: 'b', site: 'web.com', username: 'ana', esquema: 'http' }];
  assert.equal(c.existente(vieja, 'web.com', 'ana', 'https').id, 'b', 'la de http se actualiza al guardarla en https');
  const dos = [{ id: 'h', site: 'web.com', username: 'ana', esquema: 'http' }, { id: 's', site: 'web.com', username: 'ana', esquema: 'https' }];
  assert.equal(c.existente(dos, 'web.com', 'ana', 'https').id, 's', 'primero la de su mismo esquema');
  assert.equal(c.existente(lista, 'web.com', 'otro', 'https'), null, 'otro usuario');
});

test('en la página, primero las de su mismo esquema', () => {
  const lista = [{ id: 'h', site: 'web.com', esquema: 'http' }, { id: 's', site: 'web.com', esquema: 'https' }, { id: 'x', site: 'otra.com', esquema: 'http' }];
  assert.deepEqual(c.paraLaPagina(lista, 'web.com', 'https').map((e) => e.id), ['s', 'h']);
  assert.deepEqual(c.paraLaPagina(lista, 'web.com', 'http').map((e) => e.id), ['h']);
});

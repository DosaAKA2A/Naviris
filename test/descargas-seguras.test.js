// Descargas que una web hace sola (src/descargas-seguras.js, auditoría #8):
// qué tipos no se guardan sin preguntar y cuándo hace falta el permiso de
// descargar varios archivos. Lo de la app de verdad está en test/e2e/endurece.e2e.js.
// Se ejecuta con: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { esPeligrosa, extension, creaLimitador, clavePermiso, PERMISO } = require('../src/descargas-seguras');

test('los tipos del encargo y los de Chrome son peligrosos', () => {
  for (const ext of ['exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jse', 'hta', 'scr', 'com', 'pif', 'lnk', 'reg', 'jar', 'msix', 'appx',
    'msixbundle', 'appxbundle', 'appinstaller', 'cpl', 'dll', 'wsf', 'vbe', 'chm', 'iso', 'vhd', 'vhdx', 'img', 'url', 'scf', 'settingcontent-ms']) {
    assert.equal(esPeligrosa('archivo.' + ext), true, ext);
    assert.equal(esPeligrosa('ARCHIVO.' + ext.toUpperCase()), true, ext + ' en mayúsculas');
  }
});

test('lo normal no lo es', () => {
  for (const n of ['foto.jpg', 'informe.pdf', 'video.mp4', 'datos.csv', 'notas.txt', 'paquete.zip', 'pagina.html', 'sin-extension', '.exe', 'exe']) {
    assert.equal(esPeligrosa(n), false, n);
  }
});

test('la extensión se mira como la ve Windows', () => {
  assert.equal(extension('x.exe. '), 'exe');
  assert.equal(extension('x.exe...'), 'exe');
  assert.equal(esPeligrosa('factura.pdf.exe'), true);
  assert.equal(esPeligrosa('instalar.exe.txt'), false);
});

test('la primera descarga sin gesto vale; la segunda pide permiso', () => {
  const l = creaLimitador();
  assert.equal(l.cuenta(1, 'https://a.test', false), false);
  assert.equal(l.cuenta(1, 'https://a.test', false), true);
  assert.equal(l.cuenta(1, 'https://a.test', false), true);
});

test('un gesto vuelve a dar una libre, y con gesto nunca se pregunta', () => {
  const l = creaLimitador();
  l.cuenta(1, 'https://a.test', false);
  assert.equal(l.cuenta(1, 'https://a.test', true), false, 'con gesto');
  assert.equal(l.cuenta(1, 'https://a.test', false), true, 'la siguiente sin gesto ya pide');
  assert.equal(l.cuenta(1, 'https://a.test', true), false);
  assert.equal(l.cuenta(1, 'https://a.test', true), false, 'dos clics, dos descargas');
});

test('cada pestaña y cada sitio llevan su cuenta', () => {
  const l = creaLimitador();
  l.cuenta(1, 'https://a.test', false);
  assert.equal(l.cuenta(2, 'https://a.test', false), false, 'otra pestaña');
  assert.equal(l.cuenta(1, 'https://b.test', false), false, 'la pestaña navegó a otro sitio');
  assert.equal(l.cuenta(1, 'https://b.test', false), true);
});

test('el permiso se guarda como los demás: origen|automatic-downloads', () => {
  assert.equal(PERMISO, 'automatic-downloads');
  assert.equal(clavePermiso('https://a.test'), 'https://a.test|automatic-downloads');
});

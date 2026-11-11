// Lo que puede cargar una página file:// en una pestaña (src/archivos-locales.js).
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { corta, carpetaDe, dentroDe } = require('../src/archivos-locales');

const CARPETA = 'file:///C:/Users/Ana/Downloads/';
const PAGINA = CARPETA + 'factura.html';
const pestana = () => ({ isDestroyed: () => false, getType: () => 'webview' });
const ventanita = () => ({ isDestroyed: () => false, getType: () => 'window' });
const abierta = () => {
  const wc = pestana();
  assert.equal(corta({ url: PAGINA, resourceType: 'mainFrame', webContents: wc }), false);
  return wc;
};

test('un archivo se abre en una pestaña, pero no en una ventanita ni sin dueño', () => {
  assert.equal(corta({ url: PAGINA, resourceType: 'mainFrame', webContents: pestana() }), false);
  assert.equal(corta({ url: PAGINA, resourceType: 'mainFrame', webContents: ventanita() }), true);
  assert.equal(corta({ url: PAGINA, resourceType: 'mainFrame' }), true);
  assert.equal(corta({ url: PAGINA, resourceType: 'mainFrame', webContents: { isDestroyed: () => true, getType: () => 'webview' } }), true);
});

test('las webs no se tocan', () => {
  for (const webContents of [pestana(), ventanita(), undefined]) {
    assert.equal(corta({ url: 'https://example.com/', resourceType: 'mainFrame', webContents }), false);
    assert.equal(corta({ url: 'https://example.com/a.js', resourceType: 'xhr', webContents }), false);
  }
  const wc = abierta();
  assert.equal(corta({ url: 'https://example.com/a.png', resourceType: 'image', webContents: wc }), false);
  assert.equal(corta({ url: 'data:text/plain,x', resourceType: 'xhr', webContents: wc }), false);
});

test('la página carga imágenes, audio, video, fuentes, estilos y scripts de su carpeta', () => {
  const wc = abierta();
  for (const resourceType of ['image', 'media', 'font', 'stylesheet', 'script']) {
    assert.equal(corta({ url: CARPETA + 'foto.png', resourceType, webContents: wc }), false, resourceType);
    assert.equal(corta({ url: CARPETA + 'factura_files/foto%20con%20espacios.png', resourceType, webContents: wc }), false, resourceType);
  }
});

test('fetch, XHR, iframes, <object> y lo demás nunca, ni de su carpeta', () => {
  const wc = abierta();
  for (const resourceType of ['xhr', 'subFrame', 'object', 'other', 'ping', 'cspReport', 'webSocket', undefined]) {
    assert.equal(corta({ url: CARPETA + 'secreto.txt', resourceType, webContents: wc }), true, String(resourceType));
    assert.equal(corta({ url: 'file:///C:/Windows/win.ini', resourceType, webContents: wc }), true, String(resourceType));
  }
});

test('fuera de su carpeta no se carga nada, por mucho que se disfrace la ruta', () => {
  const wc = abierta();
  for (const url of [
    'file:///C:/Users/Ana/Pictures/dni.png',
    'file:///C:/Users/Ana/Downloads/../Pictures/dni.png',
    'file:///C:/Users/Ana/Downloads/%2e%2e/Pictures/dni.png',
    'file:///C:/Users/Ana/Downloads/..%5cPictures%5cdni.png',
    'file:///C:/Users/Ana/Downloads-otra/dni.png',
    'file:///D:/Users/Ana/Downloads/dni.png',
    'file://servidor/compartida/Users/Ana/Downloads/dni.png',
    'file://127.0.0.1/C$/Users/Ana/Downloads/dni.png',
    'file:///C:/Users/Ana/Downloads/%zz.png'
  ]) assert.equal(corta({ url, resourceType: 'image', webContents: wc }), true, url);
});

test('mayúsculas de la ruta y barras: la misma carpeta sigue siendo la misma', () => {
  assert.equal(carpetaDe(PAGINA), '|c:\\users\\ana\\downloads\\');
  assert.equal(dentroDe('file:///c:/USERS/ana/downloads/a.png', carpetaDe(PAGINA)), true);
  assert.equal(dentroDe('file:///C:/a.png', undefined), false);
  assert.equal(carpetaDe('file://servidor/comp/x/a.html'), 'servidor|\\comp\\x\\');
  assert.equal(dentroDe('file://servidor/comp/x/b.png', carpetaDe('file://servidor/comp/x/a.html')), true);
});

test('cuenta la carpeta del documento pedido: history.pushState no la cambia', () => {
  const wc = abierta();
  wc.getURL = () => 'file:///C:/Users/Ana/Pictures/falsa.html';   // lo que deja pushState
  assert.equal(corta({ url: 'file:///C:/Users/Ana/Pictures/dni.png', resourceType: 'image', webContents: wc }), true);
});

test('sin documento local en esa pestaña no hay carpeta: una web o quien no tiene pestaña no cargan archivos', () => {
  const wc = pestana();
  assert.equal(corta({ url: 'https://example.com/', resourceType: 'mainFrame', webContents: wc }), false);
  assert.equal(corta({ url: CARPETA + 'foto.png', resourceType: 'image', webContents: wc }), true);
  assert.equal(corta({ url: CARPETA + 'foto.png', resourceType: 'image' }), true, 'un service worker');
  const yaWeb = abierta();
  assert.equal(corta({ url: 'https://example.com/', resourceType: 'mainFrame', webContents: yaWeb }), false);
  assert.equal(corta({ url: CARPETA + 'foto.png', resourceType: 'image', webContents: yaWeb }), true, 'al navegar a una web se olvida');
});

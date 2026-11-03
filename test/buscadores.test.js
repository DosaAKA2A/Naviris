// Motor de búsqueda elegible (src/buscadores.js) y lista de aplicaciones externas (src/externos.js).
// npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('../src/buscadores');
const { aplicacionPara, esquemaDe } = require('../src/externos');

test('Google por defecto y los cuatro de la lista', () => {
  assert.equal(b.POR_DEFECTO, 'google');
  assert.deepEqual(Object.keys(b.BUSCADORES), ['google', 'duckduckgo', 'bing', 'brave']);
  assert.equal(b.urlDeBusqueda(undefined, 'hola mundo'), 'https://www.google.com/search?q=hola%20mundo');
  assert.equal(b.urlDeBusqueda('desconocido', 'x'), 'https://www.google.com/search?q=x');
});

test('cada buscador arma su dirección y reconoce sus búsquedas', () => {
  assert.equal(b.urlDeBusqueda('duckduckgo', 'café & té'), 'https://duckduckgo.com/?q=caf%C3%A9%20%26%20t%C3%A9');
  assert.equal(b.urlDeBusqueda('bing', 'a'), 'https://www.bing.com/search?q=a');
  assert.equal(b.urlDeBusqueda('brave', 'a'), 'https://search.brave.com/search?q=a');
  assert.ok(b.esBusqueda('bing', b.urlDeBusqueda('bing', 'a')));
  assert.ok(!b.esBusqueda('google', b.urlDeBusqueda('bing', 'a')));
  assert.ok(!b.esBusqueda('google', 'https://example.com'));
});

test('mailto, tel y magnet se ofrecen; file, javascript y los de Windows peligrosos no', () => {
  assert.equal(aplicacionPara('mailto:a@b.com'), 'tu aplicación de correo');
  assert.equal(aplicacionPara('TEL:+34600000000'), 'la aplicación de llamadas');
  assert.ok(aplicacionPara('magnet:?xt=urn:btih:abc'));
  for (const u of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'data:text/html,x', 'ms-msdt:/id', 'search-ms:query=x', 'ms-officecmd:x', 'vbscript:x', 'https://a.com', '']) {
    assert.equal(aplicacionPara(u), null, u);
  }
  assert.equal(aplicacionPara('mailto:' + 'a'.repeat(3000)), null);   // sin direcciones gigantes
  assert.equal(esquemaDe('Magnet:?x'), 'magnet');
});

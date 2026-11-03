// Generación de los recursos del bloqueador (src/adblock-recursos.js) con un
// uBlock y un Brave de mentira servidos desde memoria. Sin red: npm test
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generarRecursos, BRAVE_URL, UBO_RAIZ, PERMISO_CONFIANZA } = require('../src/adblock-recursos');

const BRAVE = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({
  name: 'brave-' + i + '.js', aliases: [], kind: { mime: 'application/javascript' }, content: Buffer.from('/* ' + i + ' */').toString('base64')
})));

// scriptlets.js importa un módulo con una función de apoyo y otro con el
// resto, con las formas de import/export que usa uBlock.
function modulosUbo({ cuantos = 55, extra = '' } = {}) {
  return {
    'js/resources/scriptlets.js': [
      "import { safeSelf } from './safe-self.js';",
      "import * as varios from './varios.js';",
      'export const builtinScriptlets = [];',
      "builtinScriptlets.push({ name: 'safe-self.fn', fn: safeSelf });",
      'function plantilla(a) {\n  const s = safeSelf();\n  return a;\n}',
      `for (let i = 0; i < ${cuantos}; i++) builtinScriptlets.push({ name: 'uno-' + i + '.js', aliases: ['u' + i + '.js'], fn: plantilla, dependencies: ['safe-self.fn'] });`,
      "builtinScriptlets.push({ name: 'trusted-algo.js', fn: varios.confiado, requiresTrust: true, world: 'ISOLATED' });",
      extra
    ].join('\n'),
    'js/resources/safe-self.js': 'export function safeSelf() {\n  return {};\n}',
    'js/resources/varios.js': 'function confiado(x) {\n  return x;\n}\nexport { confiado };'
  };
}

const SUSTITUTOS = 'export default new Map([\n' + [
  ...Array.from({ length: 21 }, (_, i) => `['s${i}.js', { alias: 's${i}' }]`),
  "['1x1.gif', { alias: ['1x1-transparent.gif'] }]",
  "['click2load.html', { params: ['url'] }]"
].join(',\n') + '\n]);';

function bajador(modulos) {
  const pedidas = [];
  const fn = async (url) => {
    pedidas.push(url);
    if (url === BRAVE_URL) return Buffer.from(BRAVE);
    const ruta = url.slice(UBO_RAIZ.length);
    if (ruta === 'js/redirect-resources.js') return Buffer.from(SUSTITUTOS);
    if (modulos[ruta] !== undefined) return Buffer.from(modulos[ruta]);
    if (ruta.startsWith('web_accessible_resources/')) {
      const nombre = decodeURIComponent(ruta.slice('web_accessible_resources/'.length));
      return Buffer.from(nombre.endsWith('.gif') ? 'GIF89a' : '(function(){})();\r\n');
    }
    throw new Error('HTTP 404 ' + url);
  };
  fn.pedidas = pedidas;
  return fn;
}

test('arma scriptlets, funciones de apoyo, sustitutos y los de Brave', async () => {
  const { recursos, resumen } = await generarRecursos(bajador(modulosUbo()));
  assert.equal(resumen.scriptlets, 56);
  assert.equal(resumen.funciones, 1);
  assert.equal(resumen.confianza, 1);
  assert.equal(resumen.aislados, 1);
  assert.equal(resumen.sustitutos, 22, 'click2load.html (con params) se salta');
  assert.equal(resumen.brave, 5);
  assert.equal(recursos.length, 56 + 1 + 22 + 5);

  const uno = recursos.find((r) => r.name === 'uno-0.js');
  assert.deepEqual(uno.aliases, ['u0.js']);
  assert.deepEqual(uno.dependencies, ['safe-self.fn']);
  // El texto de la función llega intacto: es lo que se inyecta en la página.
  assert.equal(Buffer.from(uno.content, 'base64').toString(), 'function plantilla(a) {\n  const s = safeSelf();\n  return a;\n}');
  assert.equal(recursos.find((r) => r.name === 'safe-self.fn').kind.mime, 'fn/javascript');

  const confiado = recursos.find((r) => r.name === 'trusted-algo.js');
  assert.equal(confiado.permission, PERMISO_CONFIANZA);
  assert.equal(uno.permission, undefined);

  const gif = recursos.find((r) => r.name === '1x1.gif');
  assert.equal(gif.kind.mime, 'image/gif');
  assert.deepEqual(gif.aliases, ['1x1-transparent.gif']);
  // Los sustitutos de texto, sin retornos de carro (como el ensamblador de adblock-rust).
  assert.equal(Buffer.from(recursos.find((r) => r.name === 's0.js').content, 'base64').toString(), '(function(){})();\n');
});

test('un nombre repetido se queda con el primero y se avisa', async () => {
  const m = modulosUbo({ extra: "builtinScriptlets.push({ name: 's0.js', fn: plantilla });" });
  const { recursos, resumen } = await generarRecursos(bajador(m));
  assert.ok(resumen.choques.some((c) => c.startsWith('sustituto:s0.js')));
  assert.equal(recursos.filter((r) => r.name === 's0.js').length, 1);
});

test('rechaza imports fuera de uBlock', async () => {
  const m = modulosUbo();
  m['js/resources/scriptlets.js'] = "import { x } from '../../../fuera.js';\n" + m['js/resources/scriptlets.js'];
  await assert.rejects(generarRecursos(bajador(m)), /fuera de uBlock/);
});

test('el código de uBlock corre aislado: sin eval ni acceso al proceso', async () => {
  const m = modulosUbo({ extra: "const p = (function () { return this; }).constructor.constructor('return process')();" });
  await assert.rejects(generarRecursos(bajador(m)), /Code generation from strings disallowed|EvalError/);
});

test('falla si llegan muy pocos scriptlets (mejor viejos que a medias)', async () => {
  await assert.rejects(generarRecursos(bajador(modulosUbo({ cuantos: 10 }))), /muy pocos scriptlets/);
});

test('una dependencia que no existe se detecta antes de inyectar nada', async () => {
  const m = modulosUbo({ extra: "builtinScriptlets.push({ name: 'roto.js', fn: plantilla, dependencies: ['no-existe.fn'] });" });
  await assert.rejects(generarRecursos(bajador(m)), /dependencia que falta en roto\.js/);
});

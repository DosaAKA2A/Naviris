// Cada canal de IPC del proceso principal o es solo de la interfaz (soloUI) o
// está en la lista corta de los que usan las páginas (webview-preload) y el
// arranque, y que se defienden solos. Un canal nuevo sin soloUI hace fallar esto:
// un renderer de una web comprometido (o su caché de preload envenenada,
// GHSA-qmv3-fv6v-rmhq) puede mandar cualquier mensaje.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const PRELOAD_WEB = fs.readFileSync(path.join(__dirname, '..', 'src', 'webview-preload.js'), 'utf8');

// Los que llegan desde una web (y miran ellos mismos quién pregunta) o desde la
// interfaz pero comprobando esUI por dentro (son síncronos y tienen que contestar).
const DE_LAS_PAGINAS = new Set([
  'preload:arranque', 'adblock:genericos', 'wv:dialogo', 'wv:sin-freno', 'x:age-gate-on',
  'moovin:pase', 'moovin:pase-set', 'moovin:clave-app', 'moovin:identidad'
]);
const MIRAN_ESUI = new Set(['wv:historial', 'wv:historial-pendiente', 'tab:reintenta-bucle', 'tab:nav-usuario', 'tab:dialogo-respuesta', 'ui:almacen-viejo', 'ui:almacen-migrado']);
// Los del aviso de una ventanita (dialogo.html): solo contestan a la capa que main creó para ese aviso.
const DE_LA_CAPA = new Set(['ventanita:dialogo-datos', 'ventanita:dialogo-respuesta']);

const canales = [...MAIN.matchAll(/ipcMain\.(on|handle)\('([^']+)',\s*(soloUI\()?/g)].map((m) => ({ canal: m[2], solo: !!m[3] }));

test('todos los canales de la interfaz van con soloUI', () => {
  assert.ok(canales.length > 80, 'se encontraron ' + canales.length + ' canales');
  const sueltos = canales.filter((c) => !c.solo && !DE_LAS_PAGINAS.has(c.canal) && !MIRAN_ESUI.has(c.canal) && !DE_LA_CAPA.has(c.canal)).map((c) => c.canal);
  assert.deepEqual(sueltos, []);
});

test('los del aviso de una ventanita solo atienden a su capa', () => {
  for (const canal of DE_LA_CAPA) {
    const i = MAIN.indexOf(`ipcMain.on('${canal}'`);
    assert.ok(i >= 0, canal);
    assert.match(MAIN.slice(i, i + 200), /const a = avisosVentanita\.get\(e\.sender\.id\);/, canal);
  }
  // Y lo que pide el preload de la capa es justo eso.
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'dialogo-preload.js'), 'utf8');
  const pedidos = new Set([...preload.matchAll(/ipcRenderer\.(?:send|sendSync|invoke)\('([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...pedidos].sort(), [...DE_LA_CAPA].sort());
});

test('los que miran esUI por dentro lo hacen de verdad', () => {
  for (const canal of MIRAN_ESUI) {
    const i = MAIN.indexOf(`ipcMain.on('${canal}'`);
    assert.ok(i >= 0, canal);
    const cuerpo = MAIN.slice(i, i + 300);
    // wv:historial y wv:historial-pendiente delegan en una función que lo mira al empezar.
    const delegado = /(historialDe|apuntaHistorial)\(/.exec(cuerpo);
    const donde = delegado ? MAIN.slice(MAIN.indexOf('function ' + delegado[1] + '('), MAIN.indexOf('function ' + delegado[1] + '(') + 200) : cuerpo;
    assert.match(donde, /esUI\(e\)/, canal);
  }
});

test('lo que pide el preload de las webs es justo la lista de las páginas', () => {
  const pedidos = new Set([...PRELOAD_WEB.matchAll(/ipcRenderer\.(?:send|sendSync|invoke)\('([^']+)'/g)].map((m) => m[1]));
  for (const p of pedidos) assert.ok(DE_LAS_PAGINAS.has(p), p + ' lo pide una web y no está en la lista');
});

test('MOOVIN solo por https y solo en moovin.live', () => {
  const linea = /const enMoovin = (.+);/.exec(PRELOAD_WEB)[1];
  const enMoovin = (url) => { const location = new URL(url); return Function('location', 'return ' + linea)(location); };
  assert.equal(enMoovin('https://moovin.live/'), true);
  assert.equal(enMoovin('https://www.moovin.live/peli'), true);
  assert.equal(enMoovin('http://moovin.live/'), false);
  assert.equal(enMoovin('https://iris.it.com/moovin/'), false);
  assert.equal(enMoovin('https://moovin.live.evil.com/'), false);
  assert.match(MAIN, /u\.protocol === 'https:' && \/\(\^\|\\\.\)moovin\\\.live\$\/\.test\(u\.hostname\)/);
  assert.doesNotMatch(MAIN.slice(MAIN.indexOf('const esMoovin')), /iris\\\.it\\\.com/);
});

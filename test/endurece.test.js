// Parte «endurece» de Naviris 3 (2026-11-11), lo que se prueba sin Electron:
// · iris.it.com fuera de la app y del addon, y la migración de los accesos (#14);
// · el texto del modo agente dice lo que hace (#11);
// · el menú solo abre enlaces web (#10) y el de las ventanitas existe (Menor 4);
// · el aviso de las ventanitas lo sirve naviris://app y los pasos del zoom.
// Lo de la app de verdad está en test/e2e/endurece.e2e.js.
// Se ejecuta con: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migraClaves, quitaIrisDeFabrica } = require('../src/migra-claves');
const { archivoDe, url } = require('../src/protocolo');
const { siguienteZoom } = require('../src/atajos');

const RAIZ = path.join(__dirname, '..');
const lee = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

// localStorage de mentira
function almacen(datos = {}) {
  const m = new Map(Object.entries(datos));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, m };
}

test('iris.it.com ya no está en el código de la app ni en el addon de Watch Party', () => {
  const archivos = [];
  const recorre = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) recorre(f); else if (/\.(js|html|css|json)$/.test(f)) archivos.push(f); } };
  recorre(path.join(RAIZ, 'src'));
  recorre(path.join(RAIZ, 'addons'));
  for (const f of archivos) {
    const rel = path.relative(RAIZ, f).replace(/\\/g, '/');
    // Solo quedan comentarios que explican por qué salió, y la migración que quita el acceso viejo.
    const codigo = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    const quedan = codigo.match(/iris\\?\.it\\?\.com/g) || [];
    if (rel === 'src/migra-claves.js') assert.equal(quedan.length, 1, rel);
    else assert.deepEqual(quedan, [], rel);
  }
  assert.doesNotMatch(lee('src', 'icons.js'), /irisFlat/);
});

test('el addon de Watch Party ya no lleva a nadie a iris.it.com', () => {
  const addon = lee('addons', 'watch-party.js');
  const trozo = (nombre) => { const i = addon.indexOf('function ' + nombre + '('); const fin = /\r?\n {2}\}\r?\n/.exec(addon.slice(i)); return addon.slice(i, i + fin.index + fin[0].length); };
  const { siteOf, epIdOf, urlSegura } = Function(trozo('siteOf') + trozo('epIdOf') + trozo('urlSegura') + 'return { siteOf, epIdOf, urlSegura };')();
  assert.equal(siteOf('https://iris.it.com/moovin/'), null);
  assert.equal(urlSegura('https://iris.it.com/moovin/?v=peli'), false);
  assert.equal(epIdOf('https://iris.it.com/moovin/?v=peli'), null);
  assert.equal(siteOf('https://moovin.live/'), 'iris');
  assert.equal(urlSegura('https://moovin.live/?v=peli'), true);
  assert.equal(urlSegura('http://moovin.live/?v=peli'), false);
  assert.equal(epIdOf('https://moovin.live/?v=peli'), 'iris:peli');
  assert.equal(epIdOf('https://moovin.live/'), 'iris:moovin');
});

test('migración: se quita solo el acceso de fábrica a iris.it.com, una vez', () => {
  const propios = [{ name: 'YouTube', url: 'https://www.youtube.com' }, { name: 'IRIS', url: 'https://iris.it.com' },
    { name: 'Mi IRIS', url: 'https://iris.it.com' }, { name: 'IRIS', url: 'https://iris.it.com/moovin' }, { name: 'Banco', url: 'https://banco.com' }];
  const ls = almacen({ 'naviris.clavesMigradas': '1', 'naviris.dials': JSON.stringify(propios) });
  assert.equal(quitaIrisDeFabrica(ls), 1);
  assert.deepEqual(JSON.parse(ls.getItem('naviris.dials')), propios.filter((_, i) => i !== 1), 'los que puso la persona se quedan');
  // Si vuelve a ponerlo a mano, ya no se toca.
  ls.setItem('naviris.dials', JSON.stringify([{ name: 'IRIS', url: 'https://iris.it.com' }]));
  assert.equal(quitaIrisDeFabrica(ls), 0);
  assert.equal(JSON.parse(ls.getItem('naviris.dials')).length, 1);
});

test('migración: sin accesos guardados no escribe nada, y espera a las claves viejas', () => {
  const vacio = almacen({ 'naviris.clavesMigradas': '1' });
  assert.equal(quitaIrisDeFabrica(vacio), 0);
  assert.equal(vacio.getItem('naviris.dials'), null);
  // Perfil de la 2.x: los accesos llegan en cobalt.dials. Primero se copian y luego se quita el de fábrica.
  const viejo = almacen({ 'cobalt.dials': JSON.stringify([{ name: 'IRIS', url: 'https://iris.it.com' }, { name: 'X', url: 'https://x.com' }]) });
  assert.equal(quitaIrisDeFabrica(viejo), 0, 'antes de copiar las claves no hace nada');
  assert.equal(viejo.getItem('naviris.irisFuera'), null);
  migraClaves(viejo);
  assert.equal(quitaIrisDeFabrica(viejo), 1);
  assert.deepEqual(JSON.parse(viejo.getItem('naviris.dials')), [{ name: 'X', url: 'https://x.com' }]);
  assert.match(viejo.getItem('cobalt.dials'), /iris\.it\.com/, 'lo de la 2.x no se toca');
  // Ilegible: no se toca.
  const roto = almacen({ 'naviris.clavesMigradas': '1', 'naviris.dials': '{roto' });
  assert.equal(quitaIrisDeFabrica(roto), 0);
  assert.equal(roto.getItem('naviris.dials'), '{roto');
});

test('el modo agente dice que cualquier programa del equipo controla el navegador', () => {
  const html = lee('src', 'index.html');
  const ajuste = /<span>Modo agente \(CDP\)<br \/><small>([^<]+)<\/small>/.exec(html)[1];
  assert.match(ajuste, /cualquier programa de tu equipo puede controlar Naviris/);
  assert.match(ajuste, /Mientras esté encendido/);
  assert.doesNotMatch(ajuste, /Claude/);
  assert.match(/id="agent-badge"[^>]*title="([^"]+)"/.exec(html)[1], /cualquier programa de tu equipo/);
});

test('el menú de un enlace solo abre direcciones web; de lo demás, solo copiarlo', () => {
  const main = lee('src', 'main.js');
  const i = main.indexOf('    if (p.linkURL) {');
  const bloque = main.slice(i, main.indexOf("    if (p.mediaType === 'image'", i));
  const abre = bloque.indexOf("if (web) {");
  assert.ok(abre > 0 && abre < bloque.indexOf("'Abrir el enlace en una pestaña nueva'"), 'pestaña nueva dentro de if (web)');
  assert.ok(abre < bloque.indexOf("'Abrir el enlace en una ventana nueva'"));
  // Fuera de if (web) solo queda «Copiar el enlace».
  const sueltas = [...bloque.matchAll(/^ {6}(?:if \(([^)]*)\) )?items\.push\(\{ label: '([^']+)'/gm)].filter((m) => !/web/.test(m[1] || '')).map((m) => m[2]);
  assert.deepEqual(sueltas, ['Copiar el enlace']);
});

test('las ventanitas llevan menú, atajos y avisos', () => {
  const main = lee('src', 'main.js');
  assert.match(main, /ventanasDe\(win\.webContents, host, pestana\);\s*comoPestana\(win, host, pestana\);/);
  const cuerpo = main.slice(main.indexOf('function comoPestana('), main.indexOf('function comoPestana(') + 900);
  assert.match(cuerpo, /menuContextual\(contents, host, win\)/);
  assert.match(cuerpo, /before-input-event/);
  assert.match(main, /const preguntaPara = \(wc\) => wc\.getType\(\) === 'webview' \? preguntaEnPestana : ventanitas\.has\(wc\.id\) \? preguntaEnVentanita : null;/);
});

test('naviris://app sirve el aviso de las ventanitas y lo que pide existe', () => {
  const dirs = { app: path.join(RAIZ, 'src'), datos: os.tmpdir() };
  const html = lee('src', 'dialogo.html');
  const pedidos = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pedidos, ['dialogo.js']);
  for (const p of ['dialogo.html', ...pedidos, 'fonts/inter-var.woff2']) {
    const a = archivoDe(new URL(p, url('dialogo.html')).href, dirs);
    assert.ok(a && fs.existsSync(a.ruta), p);
  }
  // Sin scripts en línea ni red: solo su script.
  assert.match(html, /default-src 'none'; script-src 'self';/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)/);
});

test('los pasos del zoom son los de Chrome, en las pestañas y en las ventanitas', () => {
  assert.equal(siguienteZoom(1, 1), 1.1);
  assert.equal(siguienteZoom(1, -1), 0.9);
  assert.equal(siguienteZoom(1.3, 1), 1.5);
  assert.equal(siguienteZoom(5, 1), 5);
  assert.equal(siguienteZoom(0.25, -1), 0.25);
  assert.equal(siguienteZoom(2.5, 0), 1);
  assert.match(lee('src', 'renderer', 'barra-direcciones.js'), /window\.naviAtajos\.siguienteZoom\(actual, delta\)/);
});

// La interfaz son varios <script> clásicos en src/renderer/ que comparten el ámbito global.
// Si falta uno en index.html, se repite un nombre o el orden se rompe, la app no arranca:
// aquí se ve sin abrirla.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const DIR = path.join(SRC, 'renderer');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const enDisco = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
const cargados = [...html.matchAll(/<script src="renderer\/([^"]+)"( defer)?><\/script>/g)];
const lista = cargados.map((m) => m[1]);
const lee = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

test('index.html carga todos los módulos, una vez cada uno y sin renderer.js', () => {
  assert.deepEqual([...lista].sort(), [...enDisco].sort());
  assert.equal(new Set(lista).size, lista.length);
  assert.doesNotMatch(html, /src="renderer\.js"/);
  assert.equal(fs.existsSync(path.join(SRC, 'renderer.js')), false);
});

test('los módulos van con defer y después de los scripts de los que dependen', () => {
  assert.ok(cargados.every((m) => m[2] === ' defer'), 'todos con defer');
  assert.equal(lista[0], 'nucleo.js', 'el núcleo es el primero');
  const pos = (s) => html.indexOf(`<script src="${s}"`);
  for (const previo of ['icons.js', 'brands.js', 'sonidos.js', 'rat.js', 'hub-escala.js', 'atajos.js', 'buscadores.js', 'migra-claves.js']) {
    assert.ok(pos(previo) >= 0 && pos(previo) < pos('renderer/nucleo.js'), previo);
  }
});

test('todos los módulos compilan como script clásico', () => {
  for (const f of enDisco) assert.doesNotThrow(() => new vm.Script(lee(f), { filename: f }), f);
});

test('ningún nombre de primer nivel se declara dos veces entre módulos', () => {
  const visto = new Map();
  for (const f of enDisco) {
    for (const m of lee(f).matchAll(/^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.equal(visto.get(m[1]), undefined, `${m[1]} está en ${visto.get(m[1])} y en ${f}`);
      visto.set(m[1], f);
    }
  }
  assert.ok(visto.size > 500, 'se han leído los módulos');
});

test('los addons se cargan al final: su API puede llamar a cualquier módulo', () => {
  assert.match(lee('addons.js'), /^const naviris = \{/m);
  assert.doesNotMatch(lee('addons.js'), /^loadToolAddons\(\);/m);
  assert.match(lee('arranque.js'), /^loadToolAddons\(\);/m);
  assert.ok(lista.indexOf('arranque.js') >= lista.length - 2, 'arranque.js va casi el último');
});

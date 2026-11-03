// Comprobaciones estáticas del arranque y los sonidos (sin abrir la app).
// node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const lee = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const main = lee('main.js'), html = lee('splash.html'), js = lee('splash.js'), sonidos = lee('sonidos.js');

const SONIDOS = ['arranque', 'descarga', 'error', 'aviso'];
const PALETAS = fs.readdirSync(path.join(SRC, 'sonidos'));

test('la variante elegida en main.js existe en las tres piezas del splash', () => {
  const elegida = main.match(/\nconst SPLASH_VARIANTE = '([a-z]+)';/)[1];
  const tamanos = Object.keys(eval('(' + main.match(/const SPLASH_TAMANO = (\{[^}]+\});/)[1] + ')'));
  const enJs = eval(js.match(/const VARIANTE = (\[[^\]]+\])/)[1]);
  assert.ok(tamanos.includes(elegida));
  assert.deepStrictEqual([...tamanos].sort(), [...enJs].sort());
  for (const v of tamanos) assert.ok(html.includes(`[data-v="${v}"] .tarjeta`), 'falta el CSS de ' + v);
});

test('la paleta elegida existe y cada paleta trae los cuatro sonidos en Ogg Opus', () => {
  const elegida = sonidos.match(/const PALETA = '([a-z]+)';/)[1];
  assert.ok(PALETAS.includes(elegida));
  assert.deepStrictEqual([...PALETAS].sort(), ['aire', 'cristal', 'grafito']);
  for (const p of PALETAS) for (const s of SONIDOS) {
    const b = fs.readFileSync(path.join(SRC, 'sonidos', p, s + '.ogg'));
    assert.strictEqual(b.subarray(0, 4).toString(), 'OggS', `${p}/${s}`);
    assert.ok(b.includes(Buffer.from('OpusHead')), `${p}/${s} no es Opus`);
    assert.ok(b.length < 40000, `${p}/${s} pesa demasiado`);
  }
});

test('los sonidos que se piden desde la interfaz son los que hay', () => {
  const pedidos = new Set();
  for (const f of ['renderer.js', 'splash.js']) for (const m of lee(f).matchAll(/(?:suena|navSonido)\('([a-z]+)'\)/g)) pedidos.add(m[1]);
  for (const m of lee('renderer.js').matchAll(/'(descarga|error)'/g)) pedidos.add(m[1]);
  assert.deepStrictEqual([...pedidos].sort(), [...SONIDOS].sort());
});

test('el splash puede cargar su sonido y los sonidos vienen activados de fábrica', () => {
  assert.match(html, /media-src 'self'/);
  assert.match(main, /\n\s+sonidos: true,/);
  assert.match(lee('index.html'), /id="opt-sonidos"/);
  assert.match(lee('index.html'), /<script src="sonidos.js"><\/script>/);
});

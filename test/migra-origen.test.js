// Lo que la interfaz guardaba en file:// pasa a naviris://app: lector de LevelDB (src/leveldb.js),
// lectura del origen viejo (src/migra-origen.js) y copia en la interfaz (migraOrigen en src/migra-claves.js).
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { leeBase, snappy, crc32c } = require('../src/leveldb');
const { almacenViejo, clavesDeOrigen, copiaImagen } = require('../src/migra-origen');
const { migraOrigen, migraClaves } = require('../src/migra-claves');

// Base generada por Chromium (Electron 42): dos sesiones con file:// y una página de otro origen
// (navx://otra). Hay una tabla .ldb comprimida con Snappy y un registro .log con lo último.
const FIXTURA = path.join(__dirname, 'ayudas', 'localstorage-file');

const temporales = [];
const carpeta = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-test-origen-')); temporales.push(d); return d; };
test.after(() => { for (const d of temporales) fs.rmSync(d, { recursive: true, force: true }); });

// ---------- Una base LevelDB mínima escrita a mano (registro sin comprimir) ----------
const varint = (n) => { const b = []; while (n >= 128) { b.push((n % 128) | 128); n = Math.floor(n / 128); } b.push(n); return Buffer.from(b); };
const conLargo = (b) => Buffer.concat([varint(b.length), b]);
const mascara = (c) => ((((c >>> 15) | (c << 17)) >>> 0) + 0xa282ead8) >>> 0;
function registro(datos, tipo = 1) {
  const cab = Buffer.alloc(7);
  cab.writeUInt16LE(datos.length, 4); cab[6] = tipo;
  cab.writeUInt32LE(mascara(crc32c(Buffer.from([tipo]), datos)), 0);
  return Buffer.concat([cab, datos]);
}
// Clave y valor como los guarda Chromium: '_' + origen + '\0' + formato + texto (1 latin1, 0 UTF-16).
const codifica = (t) => /^[\x00-\xff]*$/.test(t) ? Buffer.concat([Buffer.from([1]), Buffer.from(t, 'latin1')]) : Buffer.concat([Buffer.from([0]), Buffer.from(t, 'utf16le')]);
const claveLS = (origen, k) => Buffer.concat([Buffer.from('_' + origen + '\x00', 'latin1'), codifica(k)]);
function lote(seq, escrituras) {
  const cab = Buffer.alloc(12);
  cab.writeUIntLE(seq, 0, 6); cab.writeUInt32LE(escrituras.length, 8);
  return Buffer.concat([cab, ...escrituras.map(([k, v]) => v == null ? Buffer.concat([Buffer.from([0]), conLargo(k)]) : Buffer.concat([Buffer.from([1]), conLargo(k), conLargo(v)]))]);
}
// `lotes`: [[ [clave Buffer, valor Buffer|null], ... ], ...]
function baseSintetica(dir, lotes, { extra = Buffer.alloc(0) } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CURRENT'), 'MANIFEST-000002\n');
  const edicion = Buffer.concat([varint(1), conLargo(Buffer.from('leveldb.BytewiseComparator')), varint(2), varint(3), varint(3), varint(4), varint(4), varint(0)]);
  fs.writeFileSync(path.join(dir, 'MANIFEST-000002'), registro(edicion));
  let seq = 1;
  const regs = lotes.map((l) => { const r = registro(lote(seq, l)); seq += l.length; return r; });
  fs.writeFileSync(path.join(dir, '000003.log'), Buffer.concat([...regs, extra]));
}
const ls = (origen, pares) => pares.map(([k, v]) => [claveLS(origen, k), v == null ? null : codifica(v)]);

// localStorage de mentira con tope, como el de Chromium.
function almacen(inicial = {}, tope = Infinity) {
  const m = new Map(Object.entries(inicial));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > tope) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    todo: () => Object.fromEntries(m)
  };
}

test('lee la base que escribió Chromium: lo último gana, lo borrado no está y otro origen no se mezcla', () => {
  const c = clavesDeOrigen(FIXTURA, 'file://');
  assert.deepEqual(Object.keys(c).sort(), ['cobalt.tema', 'naviris.a', 'naviris.emoji', 'naviris.history', 'naviris.tarde']);
  assert.equal(c['naviris.a'], 'nuevo');                       // reescrita en la segunda sesión (en el .log)
  assert.equal(c['naviris.tarde'], 'en el registro');
  assert.equal(c['naviris.emoji'], JSON.stringify('ñandú 😀 — 中文'));   // UTF-16
  assert.equal(c['cobalt.tema'], '"oscuro"');
  const historial = JSON.parse(c['naviris.history']);          // en la tabla, comprimida
  assert.equal(historial.length, 2500);
  assert.deepEqual(historial[2499], { url: 'https://ejemplo.com/pagina/2499', title: 'Página 2499' });
  assert.deepEqual(clavesDeOrigen(FIXTURA, 'navx://otra'), { ajena: 'de otro origen' });
  // Las claves internas de Chromium (VERSION, META:…) no son de ningún origen.
  assert.ok([...leeBase(FIXTURA).keys()].some((k) => k === 'VERSION'));
});

test('Snappy: literales y copias que se solapan', () => {
  // "abcabcabcabcX": literal "abc", copia de 9 a distancia 3 (se solapa), literal "X".
  const comprimido = Buffer.from([13, 2 << 2, 0x61, 0x62, 0x63, ((9 - 4) << 2) | 1, 3, 0, 0x58]);
  assert.equal(snappy(comprimido).toString(), 'abcabcabcabcX');
  assert.throws(() => snappy(Buffer.from([20, 2 << 2, 0x61, 0x62, 0x63])), /largo distinto/);
  assert.throws(() => snappy(Buffer.from([10, ((9 - 4) << 2) | 1, 3])), /copia fuera/);
});

test('base escrita a mano: varios lotes, borrados y UTF-16', () => {
  const dir = path.join(carpeta(), 'leveldb');
  baseSintetica(dir, [
    ls('file://', [['naviris.a', 'uno'], ['naviris.b', 'dos'], ['naviris.ñ', 'año 😀']]),
    ls('file://', [['naviris.a', 'tres'], ['naviris.b', null]]),
    ls('naviris://app', [['naviris.a', 'del origen nuevo']])
  ]);
  assert.deepEqual(clavesDeOrigen(dir, 'file://'), { 'naviris.a': 'tres', 'naviris.ñ': 'año 😀' });
  assert.deepEqual(clavesDeOrigen(dir, 'naviris://app'), { 'naviris.a': 'del origen nuevo' });
});

test('un registro a medio escribir al final se descarta y lo anterior se lee', () => {
  const dir = path.join(carpeta(), 'leveldb');
  const cortado = registro(lote(9, ls('file://', [['naviris.a', 'a medias']])));
  baseSintetica(dir, [ls('file://', [['naviris.a', 'bien']])], { extra: cortado.subarray(0, cortado.length - 3) });
  assert.deepEqual(clavesDeOrigen(dir, 'file://'), { 'naviris.a': 'bien' });
  // Y uno entero con el CRC mal, también fuera.
  const malo = Buffer.from(registro(lote(9, ls('file://', [['naviris.a', 'corrupto']]))));
  malo[10] ^= 0xff;
  baseSintetica(dir, [ls('file://', [['naviris.a', 'bien']])], { extra: malo });
  assert.deepEqual(clavesDeOrigen(dir, 'file://'), { 'naviris.a': 'bien' });
});

test('una tabla dañada no se lee a medias: lanza', () => {
  const dir = path.join(carpeta(), 'leveldb');
  fs.cpSync(FIXTURA, dir, { recursive: true });
  const f = path.join(dir, '000003.ldb');
  const b = fs.readFileSync(f); b[100] ^= 0xff; fs.writeFileSync(f, b);
  assert.throws(() => clavesDeOrigen(dir, 'file://'), /LevelDB ilegible/);
  // Y si falta una tabla que el MANIFEST da por viva, también.
  fs.rmSync(f);
  assert.throws(() => clavesDeOrigen(dir, 'file://'), /falta la tabla 3/);
});

test('sin base (perfil nuevo) no hay nada que pasar', () => {
  assert.deepEqual(almacenViejo(carpeta()), { claves: {} });
});

test('las imágenes del fondo y de los widgets pasan a naviris://app/datos; el historial no se toca', () => {
  const perfil = carpeta(), otra = carpeta();
  fs.mkdirSync(path.join(perfil, 'fondos'));
  fs.writeFileSync(path.join(perfil, 'fondos', 'hub-1.jpg'), 'fondo');
  const foto = path.join(otra, 'Mis fotos', 'gato ñ.png');
  fs.mkdirSync(path.dirname(foto)); fs.writeFileSync(foto, 'png del gato');
  const f = (r) => 'file:///' + r.replace(/\\/g, '/');
  const fondo = JSON.stringify(`url("${f(path.join(perfil, 'fondos', 'hub-1.jpg'))}") center/cover no-repeat`);
  const widgets = JSON.stringify([{ type: 'imagen', img: f(foto), slot: 0 }, { type: 'imagen', img: 'file:///C:/no/existe.png' }, { type: 'notas' }]);
  const historial = JSON.stringify([{ url: f(foto), title: 'gato' }]);
  baseSintetica(path.join(perfil, 'Local Storage', 'leveldb'), [ls('file://', [
    ['naviris.hubBg.mono', fondo], ['cobalt.hubBg.oscuro', fondo], ['naviris.widgets', widgets], ['naviris.history', historial]
  ])]);
  const { claves } = almacenViejo(perfil);
  assert.equal(JSON.parse(claves['naviris.hubBg.mono']), 'url("naviris://app/datos/fondos/hub-1.jpg") center/cover no-repeat');
  assert.equal(claves['cobalt.hubBg.oscuro'], claves['naviris.hubBg.mono']);
  const w = JSON.parse(claves['naviris.widgets']);
  assert.match(w[0].img, /^naviris:\/\/app\/datos\/imagenes\/[0-9a-f]{20}\.png$/);
  assert.equal(fs.readFileSync(path.join(perfil, 'imagenes', w[0].img.split('/').pop()), 'utf8'), 'png del gato');
  assert.equal(w[1].img, 'file:///C:/no/existe.png');           // no estaba: se queda como estaba
  assert.equal(claves['naviris.history'], historial);            // un file:/// del historial es una página
  assert.ok(fs.existsSync(foto), 'la imagen original sigue en su sitio');
});

test('copiaImagen: solo imágenes, y la misma imagen no se duplica', () => {
  const perfil = carpeta(), otra = carpeta();
  const a = path.join(otra, 'a.GIF'), b = path.join(otra, 'b.gif'), t = path.join(otra, 'c.txt');
  fs.writeFileSync(a, 'gif'); fs.writeFileSync(b, 'gif'); fs.writeFileSync(t, 'texto');
  assert.equal(copiaImagen(a, perfil), copiaImagen(b, perfil));
  assert.equal(fs.readdirSync(path.join(perfil, 'imagenes')).length, 1);
  assert.equal(copiaImagen(t, perfil), null);
});

test('la interfaz copia todo lo viejo, lo viejo gana y se apunta como hecho', () => {
  const s = almacen({ 'naviris.tema': '"claro"', 'naviris.nueva': '1' });
  const r = migraOrigen(s, () => ({ claves: { 'naviris.tema': '"oscuro"', 'cobalt.history': '[1]', 'naviris.bookmarks2': '[2]' } }));
  assert.deepEqual(r, { ok: true, copiadas: 3 });
  assert.deepEqual(s.todo(), { 'naviris.tema': '"oscuro"', 'naviris.nueva': '1', 'cobalt.history': '[1]', 'naviris.bookmarks2': '[2]', 'naviris.origenMigrado': '1' });
  // Ya hecha: aunque el principal mandara algo, no se toca nada.
  assert.deepEqual(migraOrigen(s, () => ({ claves: { 'naviris.tema': '"rosa"' } })), { ok: true, copiadas: 0 });
  assert.equal(s.getItem('naviris.tema'), '"oscuro"');
  // Y después, la migración de nombre de siempre sobre lo copiado.
  migraClaves(s);
  assert.equal(s.getItem('naviris.history'), '[1]');
});

test('si algo falla no se apunta y se reintenta entero, sin borrar nada', () => {
  const s = almacen({}, 10);
  const viejo = { claves: { 'naviris.a': 'corto', 'naviris.b': 'demasiado largo para el tope' } };
  assert.deepEqual(migraOrigen(s, () => viejo), { ok: false, fallidas: ['naviris.b'] });
  assert.equal(s.getItem('naviris.origenMigrado'), null);
  assert.equal(s.getItem('naviris.a'), 'corto');
  // El principal no pudo leer la base: no se escribe nada y queda pendiente.
  const v = almacen({ 'naviris.x': '1' });
  assert.deepEqual(migraOrigen(v, () => ({ error: 'LevelDB ilegible: CRC de bloque' })), { ok: false, error: 'LevelDB ilegible: CRC de bloque' });
  assert.deepEqual(v.todo(), { 'naviris.x': '1' });
  // Ya hecha según el principal (o una interfaz que no es la de Naviris): nada.
  assert.deepEqual(migraOrigen(v, () => null), { nada: true });
});

test('se pide lo viejo ANTES de tocar el localStorage', () => {
  const orden = [];
  const s = almacen();
  const espia = { getItem: (k) => { orden.push('lee'); return s.getItem(k); }, setItem: (k, v) => { orden.push('escribe'); s.setItem(k, v); } };
  migraOrigen(espia, () => { orden.push('pide'); return { claves: { a: '1' } }; });
  assert.equal(orden[0], 'pide');
});

test('la base real de Chromium tarda poco en leerse', () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) clavesDeOrigen(FIXTURA, 'file://');
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 / 20 < 50, 'menos de 50 ms por lectura');
});

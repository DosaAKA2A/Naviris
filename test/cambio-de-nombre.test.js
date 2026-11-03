// Paso del nombre viejo del navegador al nuevo: archivos del perfil, sesión de
// las webs (src/migraciones.js) y claves de la interfaz (src/migra-claves.js).
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migraArchivos, migraParticion, migraNombre, migraCarpetaV1, PART_NAVIRIS } = require('../src/migraciones');
const { migraClaves } = require('../src/migra-claves');

const temporales = [];
const carpeta = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-test-nombre-')); temporales.push(d); return d; };
test.after(() => { for (const d of temporales) fs.rmSync(d, { recursive: true, force: true }); });

const escribe = (f, txt) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };
const lee = (f) => fs.readFileSync(f, 'utf8');

// Lo que hay en una partición real, con una muestra de cada cosa que importa.
const DATOS = {
  'Network/Cookies': 'cookies de las sesiones iniciadas',
  'Local Storage/leveldb/000003.log': 'localStorage',
  'IndexedDB/https_www.youtube.com_0.indexeddb.leveldb/000005.ldb': 'indexeddb',
  'Service Worker/Database/000001.log': 'registros de service workers',
  'Service Worker/ScriptCache/index': 'scripts de service workers',
  'Session Storage/000001.log': 'sessionStorage',
  'CdmStorage.db': 'licencias de Widevine'
};
const CACHES = {
  'Cache/Cache_Data/data_0': 'caché http',
  'Code Cache/js/index': 'caché de código',
  'GPUCache/data_0': 'caché de gpu',
  'Service Worker/CacheStorage/abc/index.txt': 'cachestorage'
};
function perfilViejo() {
  const ud = carpeta();
  for (const [f, v] of Object.entries({ ...DATOS, ...CACHES })) escribe(path.join(ud, 'Partitions', 'cobalt', f), v);
  escribe(path.join(ud, 'cobalt-settings.json'), '{"lightMode":true}');
  escribe(path.join(ud, 'cobalt-passwords.json'), '[{"host":"x.com"}]');
  escribe(path.join(ud, 'naviris-downloads.json'), '[]');
  return ud;
}
const part = (ud, p, f) => path.join(ud, 'Partitions', p, f);

test('la sesión vieja pasa entera a la nueva y la vieja se queda sin las cachés', () => {
  const ud = perfilViejo();
  assert.equal(migraParticion(ud), PART_NAVIRIS);
  for (const [f, v] of Object.entries({ ...DATOS, ...CACHES })) assert.equal(lee(part(ud, 'naviris', f)), v, f);
  for (const [f, v] of Object.entries(DATOS)) assert.equal(lee(part(ud, 'cobalt', f)), v, 'la vieja conserva ' + f);
  for (const f of Object.keys(CACHES)) assert.equal(fs.existsSync(part(ud, 'cobalt', f)), false, 'caché movida: ' + f);
  assert.equal(fs.existsSync(path.join(ud, 'Partitions', 'naviris.migrando')), false);
});

test('la sesión se pasa una sola vez: lo que cambie después en la nueva no se pisa', () => {
  const ud = perfilViejo();
  migraParticion(ud);
  fs.writeFileSync(part(ud, 'naviris', 'Network/Cookies'), 'cookies nuevas');
  fs.writeFileSync(part(ud, 'cobalt', 'Network/Cookies'), 'la 2.x siguió usando la vieja');
  assert.equal(migraParticion(ud), PART_NAVIRIS);
  assert.equal(lee(part(ud, 'naviris', 'Network/Cookies')), 'cookies nuevas');
});

test('un perfil nuevo o sin sesión vieja no crea nada', () => {
  const ud = carpeta();
  assert.equal(migraParticion(ud), PART_NAVIRIS);
  assert.equal(fs.existsSync(path.join(ud, 'Partitions')), false);
  assert.deepEqual(migraNombre(ud), { archivos: 'naviris-', particion: PART_NAVIRIS });
});

test('si la copia falla a medias, todo vuelve a su sitio, se sigue con la vieja y se reintenta', () => {
  const ud = perfilViejo();
  const cpSync = fs.cpSync;
  fs.cpSync = (...a) => { cpSync(...a); throw new Error('disco lleno'); };
  let usa;
  try { usa = migraNombre(ud); } finally { fs.cpSync = cpSync; }
  assert.equal(usa.particion, 'persist:cobalt');
  assert.equal(fs.existsSync(path.join(ud, 'Partitions', 'naviris')), false);
  assert.equal(fs.existsSync(path.join(ud, 'Partitions', 'naviris.migrando')), false);
  for (const [f, v] of Object.entries({ ...DATOS, ...CACHES })) assert.equal(lee(part(ud, 'cobalt', f)), v, 'intacto: ' + f);
  // Siguiente arranque: sale bien.
  assert.equal(migraNombre(ud).particion, PART_NAVIRIS);
  for (const [f, v] of Object.entries({ ...DATOS, ...CACHES })) assert.equal(lee(part(ud, 'naviris', f)), v, f);
});

test('si la sesión vieja está en uso (no se deja mover), no se copia nada', () => {
  const ud = perfilViejo();
  const renameSync = fs.renameSync;
  fs.renameSync = (de, a) => { if (de.endsWith('Code Cache')) { const e = new Error('EBUSY: resource busy or locked'); e.code = 'EBUSY'; throw e; } return renameSync(de, a); };
  try { assert.throws(() => migraParticion(ud), /EBUSY/); } finally { fs.renameSync = renameSync; }
  assert.equal(fs.existsSync(path.join(ud, 'Partitions', 'naviris')), false);
  assert.equal(lee(part(ud, 'cobalt', 'Cache/Cache_Data/data_0')), 'caché http', 'la caché ya movida vuelve');
});

test('los restos de un intento cortado (un apagón) se tiran y se empieza de cero', () => {
  const ud = perfilViejo();
  escribe(path.join(ud, 'Partitions', 'naviris.migrando', 'Network', 'Cookies'), 'a medias');
  assert.equal(migraParticion(ud), PART_NAVIRIS);
  assert.equal(lee(part(ud, 'naviris', 'Network/Cookies')), DATOS['Network/Cookies']);
});

test('los archivos del perfil se copian con el nombre nuevo y los viejos se quedan', () => {
  const ud = perfilViejo();
  assert.deepEqual(migraArchivos(ud).sort(), ['naviris-passwords.json', 'naviris-settings.json']);
  assert.equal(lee(path.join(ud, 'naviris-settings.json')), '{"lightMode":true}');
  assert.equal(lee(path.join(ud, 'cobalt-settings.json')), '{"lightMode":true}');
  fs.writeFileSync(path.join(ud, 'naviris-settings.json'), '{"lightMode":false}');
  assert.deepEqual(migraArchivos(ud), [], 'la segunda vez no hace nada');
  assert.equal(lee(path.join(ud, 'naviris-settings.json')), '{"lightMode":false}');
  assert.equal(lee(path.join(ud, 'naviris-downloads.json')), '[]');
});

test('si un archivo no se puede copiar, no queda ninguno a medias y se arranca con los viejos', () => {
  const ud = perfilViejo();
  fs.mkdirSync(path.join(ud, 'cobalt-totp.json'));   // ilegible como archivo: la copia falla
  const usa = migraNombre(ud);
  assert.equal(usa.archivos, 'cobalt-');
  assert.deepEqual(fs.readdirSync(ud).filter((n) => /^naviris-(settings|passwords)/.test(n)), []);
  fs.rmdirSync(path.join(ud, 'cobalt-totp.json'));
  assert.equal(migraNombre(ud).archivos, 'naviris-');
  assert.equal(lee(path.join(ud, 'naviris-passwords.json')), '[{"host":"x.com"}]');
});

test('el perfil de la v1 se renombra solo si no hay uno de Naviris', () => {
  const ad = carpeta();
  escribe(path.join(ad, 'Cobalt', 'cobalt-settings.json'), '{}');
  migraCarpetaV1(ad);
  assert.equal(fs.existsSync(path.join(ad, 'Naviris', 'cobalt-settings.json')), true);
  escribe(path.join(ad, 'Cobalt', 'x'), '1');
  migraCarpetaV1(ad);
  assert.equal(fs.existsSync(path.join(ad, 'Cobalt', 'x')), true, 'no pisa el perfil de Naviris');
});

// localStorage de mentira con tope de tamaño, como el de Chromium.
function almacen(datos = {}, tope = Infinity) {
  const m = new Map(Object.entries(datos));
  const tam = () => [...m].reduce((t, [k, v]) => t + k.length + v.length, 0);
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const antes = m.get(k);
      m.set(k, String(v));
      if (tam() > tope) { if (antes == null) m.delete(k); else m.set(k, antes); const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    },
    removeItem: (k) => { m.delete(k); },
    datos: () => Object.fromEntries(m)
  };
}

test('las claves de la interfaz se copian a naviris.* una vez y las viejas se quedan', () => {
  const ls = almacen({ 'cobalt.history': '[1]', 'cobalt.widgets': '[2]', 'cobalt.hubBg.a': '"x"', 'otra': '1' });
  assert.equal(migraClaves(ls), 3);
  assert.deepEqual(ls.datos(), {
    'cobalt.history': '[1]', 'cobalt.widgets': '[2]', 'cobalt.hubBg.a': '"x"', 'otra': '1',
    'naviris.history': '[1]', 'naviris.widgets': '[2]', 'naviris.hubBg.a': '"x"', 'naviris.clavesMigradas': '1'
  });
  ls.setItem('naviris.history', '[1,9]');
  ls.setItem('cobalt.notas2', '"tarde"');
  assert.equal(migraClaves(ls), 0, 'hecha: no vuelve a copiar');
  assert.equal(ls.getItem('naviris.history'), '[1,9]');
});

test('sin sitio para la copia, la clave se mueve en vez de copiarse', () => {
  const grande = 'x'.repeat(100);
  const ls = almacen({ 'cobalt.hubBg.a': grande, 'cobalt.tema': '"azul"' }, 200);
  migraClaves(ls);
  assert.equal(ls.getItem('naviris.hubBg.a'), grande);
  assert.equal(ls.getItem('cobalt.hubBg.a'), null, 'movida');
  assert.equal(ls.getItem('naviris.tema'), '"azul"');
  assert.equal(ls.getItem('cobalt.tema'), '"azul"', 'copiada');
  assert.equal(ls.getItem('naviris.clavesMigradas'), '1');
});

test('si una clave no cabe ni moviéndola, no se pierde, no se apunta y se reintenta sin pisar lo copiado', () => {
  const ls = almacen({ 'cobalt.a': '1', 'cobalt.b': '2' });
  const setItem = ls.setItem;
  ls.setItem = (k, v) => { if (k === 'naviris.b') throw new Error('QuotaExceededError'); return setItem(k, v); };
  assert.throws(() => migraClaves(ls));
  assert.equal(ls.getItem('cobalt.b'), '2', 'la vieja sigue ahí');
  assert.equal(ls.getItem('naviris.clavesMigradas'), null);
  ls.setItem = setItem;
  ls.setItem('naviris.a', '"cambiada"');
  assert.equal(migraClaves(ls), 1);
  assert.equal(ls.getItem('naviris.a'), '"cambiada"');
  assert.equal(ls.getItem('naviris.b'), '2');
});

// Limpieza única de cookies de iframes mal convertidas (src/migraciones.js).
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migraPerfil, limpiaCookiesDeIframes } = require('../src/migraciones');

const DIA = 24 * 60 * 60 * 1e6;
const T0 = 13400000000000000;   // microsegundos desde 1601, como Chromium
const temporales = [];
const carpeta = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-test-mig-')); temporales.push(d); return d; };
test.after(() => { for (const d of temporales) fs.rmSync(d, { recursive: true, force: true }); });

// Perfil sintético con la tabla de cookies de Chromium (solo las columnas que se miran).
function perfil(cookies, particiones = ['naviris']) {
  const ud = carpeta();
  for (const p of particiones) {
    const dir = path.join(ud, 'Partitions', p, 'Network');
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, 'Cookies'));
    db.exec(`CREATE TABLE cookies (creation_utc INTEGER, host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT,
      expires_utc INTEGER, is_secure INTEGER, is_persistent INTEGER, samesite INTEGER)`);
    const ins = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of cookies) {
      const v = { top: '', vida: 30 * DIA, secure: 1, persistente: 1, samesite: 0, ...c };
      ins.run(T0, v.host, v.top, v.nombre, 'x', T0 + v.vida, v.secure, v.persistente, v.samesite);
    }
    db.close();
  }
  return ud;
}
const quedan = (ud, p = 'naviris') => {
  const db = new DatabaseSync(path.join(ud, 'Partitions', p, 'Network', 'Cookies'));
  const r = db.prepare('SELECT host_key AS host, name AS nombre, top_frame_site_key AS top FROM cookies').all().map((c) => ({ ...c }));
  db.close();
  return r;
};
// Lo de un sitio que se incrusta: una particionada guardada en su mismo host.
const PARTICIONADA_YT = { host: '.youtube.com', nombre: 'VISITOR_INFO1_LIVE', top: 'https://discord.com', vida: 180 * DIA };

test('borra la YSC de youtube.com que salió de un iframe (firma de la conversión)', () => {
  const ud = perfil([PARTICIONADA_YT, { host: '.youtube.com', nombre: 'YSC' }]);
  const borradas = limpiaCookiesDeIframes(path.join(ud, 'Partitions', 'naviris', 'Network', 'Cookies'));
  assert.deepEqual(borradas, [{ host: '.youtube.com', nombre: 'YSC' }]);
  assert.deepEqual(quedan(ud).map((c) => c.nombre), ['VISITOR_INFO1_LIVE']);   // la particionada no se toca
});

test('nunca toca cookies de sesión iniciada, aunque tengan la firma', () => {
  const nombres = ['SID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSIDTS', 'LOGIN_INFO', 'auth_token', 'ct0', 'twid', 'server_session_id', '_csrf', 'sp_dc'];
  const ud = perfil([PARTICIONADA_YT, ...nombres.map((nombre) => ({ host: '.youtube.com', nombre }))]);
  assert.deepEqual(limpiaCookiesDeIframes(path.join(ud, 'Partitions', 'naviris', 'Network', 'Cookies')), []);
});

test('no borra si falta cualquier parte del criterio', () => {
  const ud = perfil([
    PARTICIONADA_YT,
    { host: '.twitch.tv', nombre: 'unique_id' },                         // sitio sin particionadas
    { host: '.youtube.com', nombre: 'PREF', vida: 400 * DIA },           // vida normal, no de la conversión
    { host: '.youtube.com', nombre: 'A', samesite: 1 },                  // Lax: no pudo ser particionada
    { host: '.youtube.com', nombre: 'B', secure: 0 },                    // sin Secure
    { host: '.youtube.com', nombre: 'C', top: 'https://x.com' },         // particionada de verdad
    { host: 'www.youtube.com', nombre: 'D' }                             // otro host_key
  ]);
  assert.deepEqual(limpiaCookiesDeIframes(path.join(ud, 'Partitions', 'naviris', 'Network', 'Cookies')), []);
});

test('corre una sola vez, en todas las sesiones persistentes, y lo apunta', () => {
  const ud = perfil([PARTICIONADA_YT, { host: '.youtube.com', nombre: 'YSC' }], ['naviris', 'cont-abc']);
  const settings = {};
  const borradas = migraPerfil(settings, ud);
  assert.equal(borradas.length, 2);
  assert.deepEqual(settings.migraciones, { cookiesParticionadas: true });
  // segunda vez: ya hecha, no mira nada
  assert.equal(migraPerfil(settings, ud), null);
});

test('perfil nuevo sin bases: se apunta como hecha sin borrar nada', () => {
  const ud = carpeta();
  const settings = { migraciones: { otra: true } };
  assert.deepEqual(migraPerfil(settings, ud), []);
  assert.deepEqual(settings.migraciones, { otra: true, cookiesParticionadas: true });
});

test('si una base no se puede abrir, no se apunta y se reintenta', () => {
  const ud = perfil([]);
  fs.writeFileSync(path.join(ud, 'Partitions', 'naviris', 'Network', 'Cookies'), 'esto no es sqlite');
  const settings = {};
  assert.throws(() => migraPerfil(settings, ud));
  assert.equal(settings.migraciones, undefined);
});

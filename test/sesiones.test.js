// Conversión de cookies de sesión al cerrar (src/sesiones.js).
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { conservaCookiesDeSesion, DIAS_SESION } = require('../src/sesiones');

/* Imita el almacén de cookies de Electron 42 en lo que importa aquí:
   - get({}) devuelve TODAS, también las particionadas (CHIPS), sin marcarlas;
   - get({ url, name }) solo las que se mandarían a esa URL, nunca particionadas;
   - set() sin domain crea una cookie de un solo host; con domain, de dominio. */
function almacen(iniciales) {
  const lista = iniciales.map((c) => ({ path: '/', secure: false, httpOnly: false, sameSite: 'lax', ...c }));
  const casa = (c, host) => c.hostOnly ? c.domain === host : (host === c.domain.replace(/^\./, '') || host.endsWith(c.domain));
  return {
    lista,
    escritas: [],
    async get(f) {
      if (!f.url) return lista.map(({ particion, ...c }) => c);
      const u = new URL(f.url);
      return lista.filter((c) => !c.particion && c.name === f.name && casa(c, u.hostname) && u.pathname.startsWith(c.path))
        .map(({ particion, ...c }) => c);
    },
    async set(d) {
      this.escritas.push(d);
      const host = new URL(d.url).hostname;
      const nueva = { name: d.name, value: d.value, path: d.path, secure: d.secure, httpOnly: d.httpOnly, sameSite: d.sameSite,
        domain: d.domain || host, hostOnly: !d.domain, session: false, expirationDate: d.expirationDate };
      const i = lista.findIndex((c) => !c.particion && c.name === nueva.name && c.domain === nueva.domain && c.path === nueva.path);
      if (i >= 0) lista[i] = nueva; else lista.push(nueva);
    },
    async flushStore() {}
  };
}

test('una cookie de sesión propia se conserva 30 días', async () => {
  const s = almacen([{ name: 'sp_dc', value: 'a', domain: '.spotify.com', hostOnly: false, session: true, secure: true }]);
  const ahora = Date.UTC(2026, 10, 3);
  assert.equal(await conservaCookiesDeSesion(s, ahora), 1);
  assert.equal(s.escritas[0].domain, '.spotify.com');
  assert.equal(s.escritas[0].expirationDate, ahora / 1000 + DIAS_SESION * 86400);
});

test('las persistentes no se tocan', async () => {
  const s = almacen([{ name: 'SID', value: 'x', domain: '.youtube.com', hostOnly: false, session: false, expirationDate: 9e9 }]);
  assert.equal(await conservaCookiesDeSesion(s), 0);
  assert.equal(s.escritas.length, 0);
});

test('las de un solo host se reescriben sin domain (las __Host- no se pierden)', async () => {
  const s = almacen([{ name: '__Host-GAPS', value: 'g', domain: 'accounts.google.com', hostOnly: true, session: true, secure: true }]);
  assert.equal(await conservaCookiesDeSesion(s), 1);
  assert.equal('domain' in s.escritas[0], false);
  assert.equal(s.escritas[0].url, 'https://accounts.google.com/');
});

test('una particionada (iframe de otro sitio) NO se convierte en cookie normal', async () => {
  const s = almacen([
    { name: 'YSC', value: 'propia', domain: '.youtube.com', hostOnly: false, session: true, secure: true, sameSite: 'no_restriction' },
    { name: 'YSC', value: 'del-iframe', domain: '.youtube.com', hostOnly: false, session: true, secure: true, sameSite: 'no_restriction', particion: 'https://discord.com' }
  ]);
  assert.equal(await conservaCookiesDeSesion(s), 1);
  assert.deepEqual(s.escritas.map((d) => d.value), ['propia']);
  // la propia sigue con su valor: el del iframe no la ha pisado
  assert.equal(s.lista.find((c) => !c.particion && c.name === 'YSC').value, 'propia');
});

test('una particionada sin cookie propia con su nombre tampoco se escribe', async () => {
  const s = almacen([{ name: 'chips_ses', value: '1', domain: 'localhost', hostOnly: true, session: true, secure: true, sameSite: 'no_restriction', particion: 'http://127.0.0.1' }]);
  assert.equal(await conservaCookiesDeSesion(s), 0);
  assert.equal(s.escritas.length, 0);
});

test('si una cookie falla al escribirse, sigue con las demás', async () => {
  const s = almacen([
    { name: 'rara', value: '1', domain: '.a.com', hostOnly: false, session: true },
    { name: 'buena', value: '2', domain: '.b.com', hostOnly: false, session: true }
  ]);
  const set = s.set.bind(s);
  s.set = async (d) => { if (d.name === 'rara') throw new Error('no'); return set(d); };
  assert.equal(await conservaCookiesDeSesion(s), 1);
});

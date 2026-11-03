// Ventanas emergentes solo con gesto (src/emergentes.js).
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { creaGestos, activa, clavePermiso, VIGENCIA } = require('../src/emergentes');

// Reloj de mentira para mover el tiempo a mano
function reloj() { let t = 1000; const f = () => t; f.pasa = (ms) => { t += ms; }; return f; }

test('activan la página el clic, el toque y las teclas, salvo Escape', () => {
  for (const type of ['mouseDown', 'rawKeyDown', 'keyDown', 'touchEnd', 'gestureTap']) assert.equal(activa({ type }), true, type);
  for (const type of ['mouseMove', 'mouseUp', 'mouseWheel', 'keyUp', 'char', 'touchMove', 'gestureScrollBegin', undefined]) assert.equal(activa({ type }), false, String(type));
  assert.equal(activa({ type: 'rawKeyDown', key: 'Escape' }), false);
  assert.equal(activa({ type: 'keyDown', key: 'Escape' }), false);
  assert.equal(activa({ type: 'rawKeyDown', key: 'Enter' }), true);
  assert.equal(activa(null), false);
});

test('sin gesto no se abre nada', () => {
  const g = creaGestos(reloj());
  assert.equal(g.gasta(), false);
  g.apunta({ type: 'mouseMove' });
  g.apunta({ type: 'mouseWheel' });
  assert.equal(g.gasta(), false);
});

test('un clic vale para una sola ventana', () => {
  const r = reloj(); const g = creaGestos(r);
  g.apunta({ type: 'mouseDown' });
  r.pasa(300);
  assert.equal(g.gasta(), true);
  assert.equal(g.gasta(), false, 'la segunda del mismo clic se bloquea');
  g.apunta({ type: 'mouseDown' });
  assert.equal(g.gasta(), true, 'otro clic, otra ventana');
});

test('el gesto caduca a los 5 s, como en Chromium', () => {
  const r = reloj(); const g = creaGestos(r);
  g.apunta({ type: 'rawKeyDown', key: 'Enter' });
  r.pasa(VIGENCIA);
  assert.equal(g.gasta(), true, 'justo en el límite todavía vale');
  g.apunta({ type: 'touchEnd' });
  r.pasa(VIGENCIA + 1);
  assert.equal(g.gasta(), false);
});

test('el último gesto es el que cuenta', () => {
  const r = reloj(); const g = creaGestos(r);
  g.apunta({ type: 'mouseDown' });
  r.pasa(4000);
  g.apunta({ type: 'keyDown', key: 'a' });
  r.pasa(4000);
  assert.equal(g.gasta(), true);
});

test('cada webContents lleva sus propios gestos', () => {
  const r = reloj(); const a = creaGestos(r), b = creaGestos(r);
  a.apunta({ type: 'mouseDown' });
  assert.equal(b.gasta(), false, 'un clic en una pestaña no deja abrir a otra');
  assert.equal(a.gasta(), true);
});

test('el permiso se guarda por origen y solo para webs', () => {
  assert.equal(clavePermiso('https://www.ejemplo.com/ruta?q=1#x'), 'https://www.ejemplo.com|popups');
  assert.equal(clavePermiso('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080|popups');
  assert.equal(clavePermiso('https://ejemplo.com'), 'https://ejemplo.com|popups');
  for (const u of ['about:blank', 'file:///C:/x.html', 'javascript:alert(1)', 'chrome://gpu', '', 'no es url', null]) assert.equal(clavePermiso(u), '', String(u));
});

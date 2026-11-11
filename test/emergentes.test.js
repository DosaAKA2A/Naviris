// Ventanas emergentes solo con gesto (src/emergentes.js).
// Se ejecuta con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { creaGestos, activa, clavePermiso, creaPendientes, codigoAbrir, opcionesDeVentana, VIGENCIA, TOPE_PENDIENTES } = require('../src/emergentes');

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

// Lo bloqueado se abre al permitir el sitio (creaPendientes y codigoAbrir)
const intento = (url, extra = {}) => ({ url, frameName: '', features: '', disposition: 'foreground-tab', ...extra });
const A = 'https://a.example', B = 'https://b.example';

test('al permitir salen todos los del sitio, en orden y una sola vez', () => {
  const p = creaPendientes();
  p.apunta(7, 7, A, intento(A + '/uno'));
  p.apunta(7, 7, A, intento(A + '/login', { frameName: 'login', features: 'width=480,height=600', disposition: 'new-window' }));
  p.apunta(7, 7, B, intento(B + '/otro'));
  p.apunta(8, 8, A, intento(A + '/otra-pestana'));
  assert.deepEqual(p.saca(7, A).map((x) => [x.url, x.nombre, x.rasgos, x.desde]),
    [[A + '/uno', '', '', 7], [A + '/login', 'login', 'width=480,height=600', 7]]);
  assert.deepEqual(p.saca(7, A), [], 'ya salieron');
  assert.deepEqual(p.saca(7, B).map((x) => x.url), [B + '/otro'], 'los de otro sitio siguen ahí');
  assert.deepEqual(p.saca(8, A).map((x) => x.url), [A + '/otra-pestana'], 'cada pestaña, los suyos');
});

test('solo se guarda lo que se puede repetir: http(s) sin cuerpo', () => {
  const p = creaPendientes();
  p.apunta(1, 1, A, intento('about:blank'));
  p.apunta(1, 1, A, intento('javascript:alert(1)'));
  p.apunta(1, 1, A, intento('data:text/html,hola'));
  p.apunta(1, 1, A, intento(A + '/form', { postBody: { data: [], contentType: 'application/x-www-form-urlencoded' } }));
  p.apunta(1, 1, A, null);
  p.apunta(1, 1, A, intento('http://a.example/vale'));
  assert.deepEqual(p.saca(1, A).map((x) => x.url), ['http://a.example/vale']);
});

test('hasta 25 por pestaña, como Chrome', () => {
  const p = creaPendientes();
  for (let i = 0; i < TOPE_PENDIENTES + 5; i++) p.apunta(1, 1, A, intento(A + '/' + i));
  const l = p.saca(1, A);
  assert.equal(l.length, TOPE_PENDIENTES);
  assert.equal(l[0].url, A + '/0', 'se quedan los primeros');
});

test('al navegar o cerrarse la página que los pidió, se olvidan', () => {
  const p = creaPendientes();
  p.apunta(1, 1, A, intento(A + '/de-la-pestana'));
  p.apunta(1, 2, A, intento(A + '/de-su-ventana'));
  p.olvida(1);
  assert.deepEqual(p.saca(1, A).map((x) => x.url), [A + '/de-su-ventana'], 'solo los de esa página');
  p.apunta(1, 2, A, intento(A + '/x'));
  p.olvida(2);
  assert.deepEqual(p.saca(1, A), []);
});

test('el window.open que se repite lleva la misma dirección, nombre y características', () => {
  let llamada = null;
  const window = { open: (...a) => { llamada = a; return {}; } };
  const ejecuta = (c) => new Function('window', 'return ' + c.replace(/;$/, ''))(window);
  assert.equal(ejecuta(codigoAbrir({ url: A + '/login?x="1"&y=\'2\'', nombre: 'login', rasgos: 'width=480,height=600' })), undefined, 'no devuelve la ventana');
  assert.deepEqual(llamada, [A + '/login?x="1"&y=\'2\'', 'login', 'width=480,height=600']);
  ejecuta(codigoAbrir({ url: A + '/</script>', nombre: '', rasgos: '' }));
  assert.deepEqual(llamada, [A + '/</script>', '_blank', ''], 'sin nombre, _blank');
});

// La pantalla de mentira: 1920x1040 de zona útil, y otra a la izquierda.
const ZONAS = { principal: { x: 0, y: 0, width: 1920, height: 1040 }, izquierda: { x: -1280, y: 0, width: 1280, height: 720 } };
const zonaDe = (p) => (p && p.x < 0 ? ZONAS.izquierda : ZONAS.principal);

test('la página no decide cómo es la ventana: gana lo fijo en todo lo que deja pasar parseFeatures', () => {
  const o = opcionesDeVentana('popup,frame=no,thickFrame=no,titleBarStyle=hidden,alwaysOnTop=yes,closable=no,minimizable=no,maximizable=no,movable=no,resizable=no,skipTaskbar=yes,focusable=no,opacity=0,show=no,transparent=yes,fullscreen=yes,kiosk=yes,modal=yes,enableLargerThanScreen=yes,hasShadow=no,minWidth=3000,minHeight=3000,maxWidth=1,maxHeight=1,useContentSize=yes,center=yes,title=Soporte,backgroundColor=#f00,backgroundMaterial=mica', zonaDe);
  // Lo que el parser de Electron deja pasar a la ventana y no es solo de Mac (leído en su binario).
  const CLAVES = ['x', 'y', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'opacity', 'show', 'center', 'useContentSize', 'frame', 'transparent', 'hasShadow', 'movable', 'closable', 'focusable', 'minimizable', 'maximizable', 'fullscreenable', 'alwaysOnTop', 'skipTaskbar', 'modal', 'autoHideMenuBar', 'enableLargerThanScreen', 'paintWhenInitiallyHidden', 'roundedCorners', 'thickFrame', 'title', 'backgroundColor', 'titleBarStyle', 'backgroundMaterial'];
  for (const k of CLAVES) assert.ok(o[k] !== undefined, 'falta fijar ' + k);
  assert.deepEqual(
    [o.frame, o.thickFrame, o.alwaysOnTop, o.closable, o.minimizable, o.maximizable, o.movable, o.resizable, o.skipTaskbar, o.focusable, o.opacity, o.show, o.transparent, o.fullscreen, o.kiosk, o.modal, o.enableLargerThanScreen],
    [true, true, false, true, true, true, true, true, false, true, 1, true, false, false, false, false, false]);
  assert.equal(o.fullscreenable, false);
  assert.equal(o.titleBarStyle, 'default');
  assert.equal(o.backgroundColor, '#ffffff');
  assert.equal(o.title, 'Naviris');
  assert.deepEqual([o.minWidth, o.minHeight, o.maxWidth, o.maxHeight], [0, 0, 0, 0]);
});

test('la ventanita de un inicio de sesión sale con el tamaño y el sitio que pide', () => {
  const o = opcionesDeVentana('width=500,height=600,left=100,top=50,scrollbars=yes,resizable=yes', zonaDe);
  assert.deepEqual([o.width, o.height, o.x, o.y], [500, 600, 100, 50]);
  const x = opcionesDeVentana('popup=1, width = 480 , height = 640 , x=10, y=20', zonaDe);
  assert.deepEqual([x.width, x.height, x.x, x.y], [480, 640, 10, 20]);
  const otra = opcionesDeVentana('width=500,height=600,left=-1000,top=10', zonaDe);
  assert.deepEqual([otra.x, otra.y], [-1000, 10], 'también en la otra pantalla');
});

test('sin tamaño ni sitio, 800x600 y centrada en la pantalla de quien abre', () => {
  const o = opcionesDeVentana('popup', zonaDe);
  assert.deepEqual([o.width, o.height, o.x, o.y], [800, 600, 560, 220]);
  const vacio = opcionesDeVentana(undefined, zonaDe);
  assert.deepEqual([vacio.width, vacio.height], [800, 600]);
  const raro = opcionesDeVentana('width=abc,height=,left=xx', zonaDe);
  assert.deepEqual([raro.width, raro.height, raro.x], [800, 600, 560]);
});

test('el tamaño y el sitio se quedan siempre dentro de la pantalla', () => {
  const grande = opcionesDeVentana('x=-5000,y=-5000,width=4000,height=3000,enableLargerThanScreen=yes', zonaDe);
  assert.deepEqual([grande.width, grande.height, grande.x, grande.y], [1280, 720, -1280, 0]);
  const fuera = opcionesDeVentana('left=9000,top=9000,width=500,height=400', zonaDe);
  assert.deepEqual([fuera.x, fuera.y], [1420, 640]);
  const enana = opcionesDeVentana('width=1,height=1,left=-1,top=5', (p) => (p ? ZONAS.principal : ZONAS.principal));
  assert.deepEqual([enana.width, enana.height, enana.x, enana.y], [200, 150, 0, 5]);
  const solo = opcionesDeVentana('left=100', zonaDe);
  assert.equal(solo.x, 100);
  assert.equal(solo.y, 220, 'sin top, centrada en vertical');
});

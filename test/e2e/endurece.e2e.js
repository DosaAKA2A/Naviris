// Parte «endurece» de Naviris 3 (2026-11-11), en la app de verdad:
// · descargas: un programa que la web baja sola no llega a Descargas hasta que
//   lo conservas; descartarlo lo borra; con un clic baja como siempre; varias
//   seguidas sin gesto piden el permiso del sitio (#8);
// · contraseñas: la guardada en https no sale en http, la del router sí, y las
//   viejas se migran sin perder nada (#9);
// · el menú de un enlace que no es web solo ofrece copiarlo (#10);
// · las ventanitas: alert, confirm y prompt de verdad, menú y atajos (Menor 4);
// · sin iris.it.com en los accesos, con su migración, y el texto del modo agente (#14, #11).
// Todo con un servidor local (sin red de terceros) y la carpeta de Descargas
// cambiada a una temporal desde el inspector del proceso principal.
// NAVIRIS_E2E_PUERTO=9409 node --test test/e2e/endurece.e2e.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { arranca, conecta, lista, hasta, espera, PUERTO } = require('./naviris');

const PUERTO_MAIN = PUERTO + 1000;
const PROGRAMA = 'MZ-programa-de-prueba-endurece';
const pagina = (cuerpo, titulo = 'prueba') => `<!doctype html><meta charset="utf-8"><title>${titulo}</title><style>body{margin:0;font:16px sans-serif}</style>${cuerpo}`;
// Descarga sin gesto: un enlace con download pulsado por la página al cargar.
const solas = (...archivos) => pagina(`<p>descargas solas</p><script>${JSON.stringify(archivos)}.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = '/archivo/' + f; a.download = f; document.body.append(a); a.click(); }, 300 + i * 400));</script>`);
const PAGINAS = {
  '/programa-solo': solas('endurece-solo.exe'),
  '/script-solo': solas('endurece-script.hta'),
  '/navega-solo': pagina('<script>setTimeout(() => { location.href = "/archivo/endurece-navega.exe"; }, 300);</script>'),
  '/con-clic': pagina('<a id="a" href="/archivo/endurece-clic.exe" style="position:fixed;left:20px;top:20px;font-size:30px">bajar</a>'),
  '/varias': solas('endurece-1.txt', 'endurece-2.txt', 'endurece-3.txt'),
  '/enlaces': pagina('<p><a id="correo" href="mailto:alguien@ejemplo.test">correo</a></p><p><a id="archivo" href="file:///C:/Windows/win.ini">archivo</a></p><p><a id="js" href="javascript:void(0)">guion</a></p><p><a id="web" href="/destino">web</a></p>'),
  '/padre': pagina('<button style="position:fixed;inset:0;width:100%;height:100%">abrir</button>'),
  '/ventanita': pagina('<p id="t">Texto de la ventanita</p><input id="campo" value="copiame">', 'ventanita'),
  '/destino': pagina('<h1>destino</h1>')
};
const servidor = http.createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  if (ruta.startsWith('/archivo/')) {
    const nombre = ruta.slice(9);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${nombre}"` });
    res.end(PROGRAMA + ':' + nombre);
    return;
  }
  res.writeHead(PAGINAS[ruta] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGINAS[ruta] || 'no');
});
let base, otra;   // dos sitios: 127.0.0.1 y localhost

const DESCARGAS = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-endurece-descargas-'));
const enDescargas = () => fs.readdirSync(DESCARGAS).sort();

let app, principal;
const enMain = async (expr) => {
  const r = await principal.envia('Runtime.evaluate', { expression: `(async () => { const { app, BrowserWindow, Menu, webContents, safeStorage } = require('electron'); ${expr} })()`, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const ui = () => app.ui;

test.before(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  otra = `http://localhost:${servidor.address().port}`;
  app = await arranca([`--inspect=${PUERTO_MAIN}`]);
  const dbg = (await (await fetch(`http://127.0.0.1:${PUERTO_MAIN}/json/list`)).json())[0];
  principal = await conecta(dbg.webSocketDebuggerUrl);
  await principal.envia('Runtime.enable');
  await enMain(`app.setPath('downloads', ${JSON.stringify(DESCARGAS)}); return 1;`);
});
test.after(async () => {
  principal?.cierra();
  await app?.cierra();
  servidor.closeAllConnections(); servidor.close();
  fs.rmSync(DESCARGAS, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

// Una pestaña con una página del servidor local
async function abre(url) {
  const antes = new Set((await lista()).map((x) => x.id));
  await ui().evalua(`void createTab(${JSON.stringify(url)})`);
  const w = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id) && x.url.startsWith(url.split('/').slice(0, 3).join('/'))));
  const web = await conecta(w.webSocketDebuggerUrl);
  await hasta(() => web.evalua('document.readyState === "complete"'));
  return web;
}
const cierraPestanas = () => ui().evalua('(() => { tabs.slice(1).forEach((t) => closeTab(t.id)); return 1; })()');
const descargasEnUI = () => ui().evalua('[...dlMeta.values()].map((m) => ({ id: m.id, name: m.name, state: m.state, retenida: m.retenida || null }))');
const sinConfirmar = () => enMain(`const d = require('path').join(app.getPath('userData'), 'descargas-sin-confirmar'); const fs = require('fs'); return fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).filter((f) => /\\./.test(f)) : [];`);

test('un programa que la web baja sola no llega a Descargas hasta que lo conservas', async () => {
  const web = await abre(base + '/programa-solo');
  await hasta(() => ui().evalua(`!document.getElementById('riesgo-bar').classList.contains('hidden')`), 10000);
  assert.match(await ui().evalua(`document.getElementById('riesgo-text').textContent`), /endurece-solo\.exe puede dañar tu equipo/);
  await hasta(async () => (await sinConfirmar()).some((f) => /endurece-solo\.exe$/.test(f)), 8000);
  assert.deepEqual(enDescargas(), [], 'nada en Descargas todavía');
  const m = (await descargasEnUI()).find((x) => x.name === 'endurece-solo.exe');
  assert.equal(m.retenida, 'peligrosa');
  await ui().evalua(`document.getElementById('riesgo-conservar').click()`);
  await hasta(() => enDescargas().includes('endurece-solo.exe'), 8000);
  assert.equal(fs.readFileSync(path.join(DESCARGAS, 'endurece-solo.exe'), 'utf8'), PROGRAMA + ':endurece-solo.exe');
  await hasta(async () => (await descargasEnUI()).find((x) => x.id === m.id)?.state === 'completed', 5000);
  assert.equal(await ui().evalua(`document.getElementById('riesgo-bar').classList.contains('hidden')`), true);
  assert.deepEqual(await sinConfirmar(), [], 'la carpeta de espera queda vacía');
  web.cierra();
  await cierraPestanas();
});

test('descartarlo lo borra y no pasa nada a Descargas', async () => {
  const web = await abre(base + '/script-solo');
  await hasta(() => ui().evalua(`/endurece-script\\.hta/.test(document.getElementById('riesgo-text').textContent) && !document.getElementById('riesgo-bar').classList.contains('hidden')`), 10000);
  await hasta(async () => (await sinConfirmar()).length > 0, 8000);
  await ui().evalua(`document.getElementById('riesgo-descartar').click()`);
  await hasta(async () => (await descargasEnUI()).find((x) => x.name === 'endurece-script.hta')?.state === 'cancelled', 5000);
  assert.deepEqual(await sinConfirmar(), []);
  assert.ok(!enDescargas().includes('endurece-script.hta'));
  web.cierra();
  await cierraPestanas();
});

test('una página que navega sola a un programa también espera; escrito en la barra, no', async () => {
  let web = await abre(base + '/navega-solo');
  await hasta(() => ui().evalua(`/endurece-navega\.exe/.test(document.getElementById('riesgo-text').textContent) && !document.getElementById('riesgo-bar').classList.contains('hidden')`), 10000);
  await ui().evalua(`document.getElementById('riesgo-descartar').click()`);
  await hasta(async () => (await descargasEnUI()).find((x) => x.name === 'endurece-navega.exe')?.state === 'cancelled', 5000);
  web.cierra();
  await cierraPestanas();
  // La dirección escrita (o un marcador, o una pestaña nueva) la pide la persona: baja como siempre.
  await ui().evalua(`navigateActive(${JSON.stringify(base + '/archivo/endurece-tecleado.exe')})`);
  await hasta(() => enDescargas().includes('endurece-tecleado.exe'), 8000);
  assert.equal((await descargasEnUI()).find((m) => m.name === 'endurece-tecleado.exe').retenida, null);
  assert.ok(!enDescargas().includes('endurece-navega.exe'));
  await cierraPestanas();
});

test('con un clic en el enlace el programa baja a Descargas como siempre', async () => {
  const web = await abre(base + '/con-clic');
  const [x, y] = await web.evalua(`(() => { const r = document.getElementById('a').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await web.clic(x, y);
  await hasta(() => enDescargas().includes('endurece-clic.exe'), 8000);
  assert.equal(await ui().evalua(`document.getElementById('riesgo-bar').classList.contains('hidden')`), true, 'sin aviso');
  assert.equal((await descargasEnUI()).find((m) => m.name === 'endurece-clic.exe').retenida, null);
  web.cierra();
  await cierraPestanas();
});

test('varias descargas seguidas sin gesto: la primera baja y las demás esperan el permiso', async () => {
  const pideVarias = () => hasta(() => ui().evalua(`!els.permBar.classList.contains('hidden') && /descargar varios archivos/.test(els.permText.textContent)`), 10000);
  // Bloquear: solo queda la primera.
  let web = await abre(base + '/varias');
  await pideVarias();
  await hasta(() => enDescargas().includes('endurece-1.txt'), 8000);
  await hasta(async () => (await descargasEnUI()).filter((m) => m.retenida === 'varias').length === 2, 5000);
  assert.ok(!enDescargas().includes('endurece-2.txt') && !enDescargas().includes('endurece-3.txt'), 'las otras esperan');
  await ui().evalua(`document.getElementById('perm-block').click()`);
  await hasta(async () => (await descargasEnUI()).filter((m) => /endurece-[23]/.test(m.name)).every((m) => m.state === 'cancelled'), 5000);
  assert.ok(!enDescargas().includes('endurece-2.txt'));
  assert.deepEqual(await sinConfirmar(), []);
  web.cierra();
  await cierraPestanas();
  // Recordado: al volver, la primera baja y las demás ni empiezan ni preguntan.
  fs.rmSync(path.join(DESCARGAS, 'endurece-1.txt'));
  web = await abre(base + '/varias');
  await hasta(() => enDescargas().includes('endurece-1.txt'), 8000);
  await espera(1500);
  assert.deepEqual(enDescargas().filter((f) => /endurece-[123]/.test(f)), ['endurece-1.txt']);
  assert.equal(await ui().evalua(`els.permBar.classList.contains('hidden')`), true);
  web.cierra();
  await cierraPestanas();
  // Permitir en otro sitio: bajan las tres.
  web = await abre(otra + '/varias');
  await pideVarias();
  await ui().evalua(`document.getElementById('perm-allow').click()`);
  await hasta(() => ['endurece-1 (1).txt', 'endurece-2.txt', 'endurece-3.txt'].every((f) => enDescargas().includes(f)), 8000);
  const perms = await ui().evalua('window.navirisApp.permList()');
  assert.equal(perms[base + '|automatic-downloads'], 'block');
  assert.equal(perms[otra + '|automatic-downloads'], 'allow');
  web.cierra();
  await cierraPestanas();
});

test('contraseñas: la de https no sale en http, la del router sí, y las viejas se migran', async () => {
  const r = await ui().evalua(`(async () => {
    const a = await window.navirisApp.pwAdd('banco.test', 'ana', 'secreta-https', 'https');
    const b = await window.navirisApp.pwAdd('192.168.1.1', 'admin', 'secreta-router');
    return { a, b,
      https: (await window.navirisApp.pwForHost('banco.test', 'https')).map((c) => c.username + '|' + c.esquema),
      http: (await window.navirisApp.pwForHost('banco.test', 'http')).map((c) => c.username),
      router: (await window.navirisApp.pwForHost('192.168.1.1', 'http')).map((c) => c.username + '|' + c.esquema) };
  })()`);
  assert.equal(r.a.ok, true);
  assert.deepEqual(r.https, ['ana|https']);
  assert.deepEqual(r.http, [], 'la de https no se ofrece en http');
  assert.deepEqual(r.router, ['admin|http'], 'el router sin esquema escrito, por http');
  // En http se guarda aparte: no pisa la de https.
  await ui().evalua(`window.navirisApp.pwAdd('banco.test', 'ana', 'escrita-en-http', 'http')`);
  assert.deepEqual(await ui().evalua(`window.navirisApp.pwForHost('banco.test', 'https').then((l) => l.map((c) => c.esquema))`), ['https', 'http']);
  // Una lista de antes, sin esquema: se migra al leerla y no se pierde nada.
  const migrado = await enMain(`
    const fs = require('fs'), path = require('path');
    const dir = app.getPath('userData');
    const archivo = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('passwords.json')));
    const enc = (t) => safeStorage.encryptString(t).toString('base64');
    const vieja = [{ id: 'pw1', site: 'github.com', username: 'ana', enc: enc('a') }, { id: 'pw2', site: '10.0.0.1', username: 'root', enc: enc('b') }, { id: 'pw3', site: 'http://intranet.test/x', username: '', enc: enc('c') }];
    fs.writeFileSync(archivo, JSON.stringify(vieja));
    return { archivo, vieja };`);
  const tras = await ui().evalua(`(async () => ({ lista: await window.navirisApp.pwList(), github: (await window.navirisApp.pwForHost('github.com', 'http')).length, intranet: (await window.navirisApp.pwForHost('intranet.test', 'http')).length }))()`);
  assert.deepEqual(tras.lista.map((e) => e.id), ['pw1', 'pw2', 'pw3']);
  assert.equal(tras.github, 0);
  assert.equal(tras.intranet, 1);
  const enDisco = JSON.parse(fs.readFileSync(migrado.archivo, 'utf8'));
  assert.deepEqual(enDisco.map((e) => e.esquema), ['https', 'http', 'http']);
  enDisco.forEach((e, i) => { const { esquema, ...resto } = e; assert.deepEqual(resto, migrado.vieja[i]); });
});

test('el menú de un enlace que no es web solo ofrece copiarlo', async () => {
  const web = await abre(base + '/enlaces');
  const menuAbierto = () => ui().evalua('!!document.querySelector(".ctx-menu.abierto") && !!ctxMenuEl');
  const opciones = () => ui().evalua(`[...ctxMenuEl.querySelectorAll('.ctx-item')].map((b) => b.querySelector('.ctx-tx').textContent)`);
  const enlace = async (id) => {
    const [x, y] = await web.evalua(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    for (let intento = 0; ; intento++) {
      await web.envia('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await web.envia('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await web.envia('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
      try { await hasta(menuAbierto, 4000); break; } catch (e) { if (intento >= 3) throw e; }
    }
    const ops = await opciones();
    await web.clic(5, 300);
    await hasta(async () => !(await menuAbierto()), 3000);
    return ops;
  };
  for (const id of ['correo', 'archivo', 'js']) {
    const ops = await enlace(id);
    assert.ok(ops.includes('Copiar el enlace'), id);
    assert.deepEqual(ops.filter((t) => /enlace|destino/.test(t)), ['Copiar el enlace'], id + ': ' + ops.join(', '));
  }
  const web2 = await enlace('web');
  for (const t of ['Abrir el enlace en una pestaña nueva', 'Abrir el enlace en una ventana nueva', 'Copiar el enlace', 'Guardar el destino como…']) assert.ok(web2.includes(t), t);
  web.cierra();
  await cierraPestanas();
});

// La ventanita: abierta con un clic de verdad, como un inicio de sesión
async function ventanita() {
  const web = await abre(base + '/padre');
  await web.clic(100, 100);
  await web.evalua(`window.open(${JSON.stringify(base + '/ventanita')}, 'v', 'popup,left=40,top=40,width=420,height=320'); 1`);
  const t = await hasta(async () => (await lista()).find((x) => x.type === 'page' && x.url === base + '/ventanita'), 8000);
  const v = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => v.evalua('document.readyState === "complete"'));
  return { web, v, id: await enMain(`return BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === ${JSON.stringify(base + '/ventanita')}).webContents.id;`) };
}
const capa = () => hasta(async () => {
  const t = (await lista()).find((x) => x.url === 'naviris://app/dialogo.html');
  if (!t) return null;
  const c = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => c.evalua('document.readyState === "complete" && !!document.getElementById("tit").textContent'));
  return c;
}, 8000);
const sinCapa = () => hasta(async () => !(await lista()).some((x) => x.url === 'naviris://app/dialogo.html'), 5000);

test('en una ventanita, alert, confirm y prompt preguntan de verdad', async () => {
  const { web, v } = await ventanita();
  // confirm: Aceptar da true
  await v.evalua(`setTimeout(() => { window.__r = confirm('¿Seguimos?'); }, 0); 1`);
  let c = await capa();
  assert.equal(await c.evalua(`document.getElementById('tit').textContent`), '127.0.0.1 dice');
  assert.equal(await c.evalua(`document.getElementById('texto').textContent`), '¿Seguimos?');
  assert.equal(await c.evalua(`document.getElementById('cancelar').classList.contains('oculto')`), false);
  await c.evalua(`document.getElementById('aceptar').click(); 1`).catch(() => {});
  c.cierra();
  await sinCapa();
  assert.equal(await v.evalua('window.__r'), true);
  // confirm: Cancelar da false
  await v.evalua(`setTimeout(() => { window.__r = confirm('¿Y ahora?'); }, 0); 1`);
  c = await capa();
  await c.evalua(`document.getElementById('cancelar').click(); 1`).catch(() => {});
  c.cierra();
  await sinCapa();
  assert.equal(await v.evalua('window.__r'), false);
  // prompt: devuelve lo escrito
  await v.evalua(`setTimeout(() => { window.__r = prompt('¿Tu nombre?', 'Ana'); }, 0); 1`);
  c = await capa();
  assert.equal(await c.evalua(`document.getElementById('valor').value`), 'Ana');
  assert.equal(await c.evalua(`document.getElementById('silencio').classList.contains('oculto')`), false, 'desde el segundo aviso sale la casilla');
  await c.evalua(`document.getElementById('valor').value = 'Beatriz'; document.getElementById('aceptar').click(); 1`).catch(() => {});
  c.cierra();
  await sinCapa();
  assert.equal(await v.evalua('window.__r'), 'Beatriz');
  // alert: espera y vuelve
  await v.evalua(`setTimeout(() => { alert('Hola'); window.__r = 'tras-alert'; }, 0); 1`);
  c = await capa();
  assert.equal(await c.evalua(`document.getElementById('cancelar').classList.contains('oculto')`), true);
  await c.evalua(`document.getElementById('aceptar').click(); 1`).catch(() => {});
  c.cierra();
  await sinCapa();
  assert.equal(await v.evalua('window.__r'), 'tras-alert');
  // Cerrar la ventanita con un aviso abierto no deja nada colgado
  await v.evalua(`setTimeout(() => confirm('cerrar'), 0); 1`);
  (await capa()).cierra();
  v.cierra();
  await enMain(`BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === ${JSON.stringify(base + '/ventanita')}).close(); return 1;`);
  await sinCapa();
  web.cierra();
  await cierraPestanas();
});

test('en una ventanita hay menú de clic derecho y atajos', async () => {
  const { web, v, id } = await ventanita();
  // El menú del sistema: se cambia popup por uno que apunta lo que iba a salir.
  await enMain(`globalThis.__popupReal = Menu.prototype.popup; Menu.prototype.popup = function (o) { globalThis.__menu = { items: this.items, ventana: o && o.window ? o.window.webContents.id : null }; }; return 1;`);
  try {
    const [x, y] = await v.evalua(`(() => { const r = document.getElementById('t').getBoundingClientRect(); return [r.x + 10, r.y + r.height / 2]; })()`);
    await v.envia('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
    await v.envia('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    const menu = await hasta(() => enMain(`return globalThis.__menu && { items: globalThis.__menu.items.map((i) => i.type === 'separator' ? '-' : i.label), ventana: globalThis.__menu.ventana };`), 5000);
    assert.equal(menu.ventana, id, 'sale en la ventanita');
    for (const t of ['Atrás', 'Adelante', 'Recargar', 'Copiar la dirección de la página', 'Imprimir…', 'Inspeccionar']) assert.ok(menu.items.includes(t), t);
    assert.ok(!menu.items.includes('Pantalla completa'), 'sin pantalla completa');
    // Y sus opciones funcionan: Recargar
    await v.evalua('window.__vieja = 1');
    await enMain(`globalThis.__menu.items.find((i) => i.label === 'Recargar').click(); return 1;`);
    await hasta(() => v.evalua('window.__vieja === undefined && document.readyState === "complete"'), 8000);
  } finally {
    await enMain(`Menu.prototype.popup = globalThis.__popupReal; delete globalThis.__menu; return 1;`);
  }
  // Tecla de verdad, como en huecos.e2e.js; con tope, porque Ctrl+W se lleva el target.
  const tecla = async (key, code, vk, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await Promise.race([v.envia('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }).catch(() => {}), espera(1500)]);
  };
  const zoom = () => enMain(`return webContents.fromId(${id}).getZoomFactor();`);
  await tecla('=', 'Equal', 187, 2);
  await hasta(async () => Math.abs((await zoom()) - 1.1) < 0.001, 3000);
  await tecla('-', 'Minus', 189, 2);
  await tecla('-', 'Minus', 189, 2);
  await hasta(async () => Math.abs((await zoom()) - 0.9) < 0.001, 3000);
  await tecla('0', 'Digit0', 48, 2);
  await hasta(async () => (await zoom()) === 1, 3000);
  // F5 recarga
  await v.evalua('window.__vieja = 1');
  await tecla('F5', 'F5', 116);
  await hasta(() => v.evalua('window.__vieja === undefined && document.readyState === "complete"'), 8000);
  // Copiar con Ctrl+C lo hace Chromium
  await v.evalua(`(() => { const c = document.getElementById('campo'); c.focus(); c.select(); return 1; })()`);
  await tecla('c', 'KeyC', 67, 2);
  await hasta(async () => (await ui().evalua('window.navirisApp.readClipboard()')) === 'copiame', 3000);
  // Ctrl+W la cierra
  await tecla('w', 'KeyW', 87, 2);
  await hasta(async () => !(await enMain(`return webContents.getAllWebContents().some((w) => w.id === ${id} && !w.isDestroyed());`)), 5000);
  v.cierra();
  web.cierra();
  await cierraPestanas();
});

test('sin iris.it.com en los accesos de fábrica, y el de fábrica guardado se quita', async () => {
  assert.equal(await ui().evalua(`DEFAULT_DIALS.some((d) => /iris\\.it\\.com/.test(d.url)) || LIBRERIA.some((d) => /iris\\.it\\.com/.test(d.url))`), false);
  assert.equal(await ui().evalua(`dials.some((d) => /iris\\.it\\.com/.test(d.url))`), false);
  assert.match(await ui().evalua(`document.getElementById('opt-agent').closest('label').textContent`), /cualquier programa de tu equipo puede controlar Naviris/);
  // Un perfil de antes, con el acceso de fábrica guardado y otro puesto a mano: tras recargar la interfaz solo queda el suyo.
  await ui().evalua(`localStorage.setItem('naviris.dials', JSON.stringify([{ name: 'IRIS', url: 'https://iris.it.com' }, { name: 'Mío', url: 'https://iris.it.com/moovin' }, { name: 'YouTube', url: 'https://www.youtube.com' }])); localStorage.removeItem('naviris.irisFuera'); 1`);
  await ui().envia('Page.reload');
  await espera(1000);
  await hasta(() => ui().evalua('typeof dials !== "undefined" && Array.isArray(tabs)'), 20000);
  assert.deepEqual(await ui().evalua('dials.map((d) => d.name)'), ['Mío', 'YouTube']);
  assert.equal(await ui().evalua(`localStorage.getItem('naviris.irisFuera')`), '1');
});

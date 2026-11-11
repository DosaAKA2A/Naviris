// Menús de clic derecho propios de Naviris 3 (parte «estética»), en la app de verdad:
// el de la página (enlace, imagen, selección, campo con el corrector y página) y el de
// los campos de la interfaz (barra con «Pegar e ir») se pintan en la interfaz, encima
// del webview, y cada opción hace lo que dice. También el teclado, que no se salgan de
// la ventana y que un clic en la página los cierre.
// NAVIRIS_E2E_PUERTO=9412 npm run test:e2e   (o: node --test test/e2e/menus.e2e.js)
// No se pulsan las opciones que abren un cuadro del sistema (Guardar como, Imprimir),
// las que suben algo a internet (Google Lens) ni «Añadir al diccionario», que escribe
// en el diccionario de Windows: de esas se comprueba que están y se pueden elegir.
// El portapapeles se guarda al empezar y se devuelve al terminar.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { arranca, lista, hasta, espera, PUERTO } = require('./naviris');

const BASE = 'https://menus.test/';
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Menús</title>
<style>body{margin:24px;font:16px/1.5 sans-serif} img{display:block;width:200px;height:120px} textarea{font:16px sans-serif;width:300px}</style>
<h1 id="tit">Navegador web</h1>
<p><a id="enlace" href="${BASE}destino">motor de renderizado</a></p>
<img id="imagen" src="${BASE}img.svg" alt="prueba">
<p><textarea id="area" spellcheck="true">palabrra</textarea></p>
<p><input id="campo" value="hola mundo"></p>`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#3a6b5c"/></svg>';
const RUTAS = [[BASE + '*', (url) => /img\.svg$/.test(url) ? { cuerpo: SVG, tipo: 'image/svg+xml' }
  : { cuerpo: /destino/.test(url) ? '<!doctype html><meta charset="utf-8"><title>Destino</title><h1>Destino</h1>' : PAGINA, tipo: 'text/html; charset=utf-8' }]];

let app, portapapeles = '';
test.before(async () => {
  app = await arranca();
  portapapeles = await app.ui.evalua('window.navirisApp.readClipboard()');
});
test.after(async () => {
  await app?.ui.evalua(`window.navirisApp.clipWrite(${JSON.stringify(portapapeles || '')})`).catch(() => {});
  await app?.cierra();
});

const ui = () => app.ui;
const menuAbierto = () => ui().evalua('!!document.querySelector(".ctx-menu.abierto") && !!ctxMenuEl');
const opciones = () => ui().evalua(`[...ctxMenuEl.querySelectorAll('.ctx-item')].map((b) => ({ t: b.querySelector('.ctx-tx').textContent, off: b.disabled, kbd: b.querySelector('kbd')?.textContent || '' }))`);
const portapapelesEs = (t) => hasta(async () => (await ui().evalua('window.navirisApp.readClipboard()')) === t, 4000);
async function clicDerecho(dest, x, y) {
  // En el runner de GitHub el primer clic tras abrir la página a veces no llega: se repite.
  for (let intento = 0; ; intento++) {
    await dest.envia('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await dest.envia('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
    await dest.envia('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    try { await hasta(menuAbierto, 4000); break; } catch (e) { if (intento >= 3) throw e; }
  }
  await espera(250);   // lo que tarda en abrirse (200 ms): una persona apunta después
}
// Elige una opción por su texto con el ratón de verdad (sobre la interfaz)
async function elige(texto) {
  const p = await ui().evalua(`(() => { const b = [...ctxMenuEl.querySelectorAll('.ctx-item')].find((x) => x.querySelector('.ctx-tx').textContent === ${JSON.stringify(texto)}); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
  assert.ok(p, 'la opción «' + texto + '» está y se puede elegir');
  await ui().clic(p[0], p[1]);
  await hasta(async () => !(await menuAbierto()), 3000);
}
const centro = (web, sel, dx = 0) => web.evalua(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2 + ${dx}, r.y + r.height / 2]; })()`);
const pestanas = () => ui().evalua('tabs.length');

test('el menú de un enlace es el de Naviris, encima de la página, y sus opciones funcionan', async () => {
  const web = await app.abre(BASE + 'enlace', RUTAS);
  const [x, y] = await centro(web, '#enlace');
  await clicDerecho(web, x, y);
  const ops = await opciones();
  for (const t of ['Abrir el enlace en una pestaña nueva', 'Abrir el enlace en una ventana nueva', 'Abrir el enlace en una ventana privada', 'Copiar el enlace', 'Copiar el texto del enlace', 'Guardar el destino como…', 'Atrás', 'Recargar', 'Inspeccionar']) {
    assert.ok(ops.some((o) => o.t === t), 'falta «' + t + '»');
  }
  assert.equal(ops.find((o) => o.t === 'Atrás').kbd, 'Alt+←');
  assert.equal(ops.find((o) => o.t === 'Adelante').off, true, 'Adelante desactivado sin historial hacia delante');
  // Pintado en la interfaz y dentro de la ventana, cerca del clic
  const caja = await ui().evalua(`(() => { const r = ctxMenuEl.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, W: innerWidth, H: innerHeight }; })()`);
  assert.ok(caja.x >= 0 && caja.y >= 0 && caja.r <= caja.W && caja.b <= caja.H, 'dentro de la ventana: ' + JSON.stringify(caja));

  await elige('Copiar el enlace');
  await portapapelesEs(BASE + 'destino');
  await clicDerecho(web, x, y);
  await elige('Copiar el texto del enlace');
  await portapapelesEs('motor de renderizado');

  const antes = await pestanas();
  await clicDerecho(web, x, y);
  await elige('Abrir el enlace en una pestaña nueva');
  await hasta(async () => (await pestanas()) === antes + 1);
  await hasta(() => ui().evalua(`tabs.some((t) => (t.url || t.webview?.src) === ${JSON.stringify(BASE + 'destino')})`), 5000);

  // Ventana nueva: aparece otra interfaz con la dirección; se cierra
  const ids = new Set((await lista()).map((t) => t.id));
  await clicDerecho(web, x, y);
  await elige('Abrir el enlace en una ventana nueva');
  const nueva = await hasta(async () => (await lista()).find((t) => t.type === 'page' && /index\.html\?sacada=1/.test(t.url) && !ids.has(t.id)));
  assert.ok(nueva);
  await ui().evalua(`(() => { tabs.filter((t) => /destino/.test(t.url || '')).forEach((t) => closeTab(t.id)); return 1; })()`);
  await fetch(`http://127.0.0.1:${PUERTO}/json/close/${nueva.id}`).catch(() => {});
});

test('teclado: flechas que saltan las desactivadas, Intro elige y Esc cierra devolviendo el foco', async () => {
  const web = await app.abre(BASE + 'teclado', RUTAS);
  const [x, y] = await centro(web, '#tit');
  await clicDerecho(web, x, y);
  const pulsa = async (key, vk) => {
    await ui().envia('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk });
    await ui().envia('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
  };
  const activas = (await opciones()).filter((o) => !o.off).map((o) => o.t);
  assert.ok((await opciones()).some((o) => o.t === 'Adelante' && o.off), 'Adelante, desactivado, no recibe el foco');
  const conFoco = () => ui().evalua('document.activeElement.querySelector(".ctx-tx")?.textContent');
  await pulsa('ArrowDown', 40);
  assert.equal(await conFoco(), activas[0]);
  await pulsa('ArrowDown', 40);
  assert.equal(await conFoco(), activas[1], 'salta las desactivadas');
  await pulsa('Home', 36);
  await pulsa('ArrowUp', 38);
  assert.equal(await conFoco(), 'Inspeccionar', 'con vuelta al final');
  await pulsa('End', 35);
  assert.equal(await conFoco(), 'Inspeccionar');
  await pulsa('Escape', 27);
  await hasta(async () => !(await menuAbierto()), 2000);
  assert.equal(await ui().evalua('document.activeElement.tagName'), 'WEBVIEW', 'el foco vuelve a la página');
  // Intro elige: Recargar recarga la página
  await web.evalua('window.__vieja = 1');
  await clicDerecho(web, x, y);
  const iRecargar = (await opciones()).filter((o) => !o.off).findIndex((o) => o.t === 'Recargar');
  for (let i = 0; i <= iRecargar; i++) await pulsa('ArrowDown', 40);
  assert.equal(await conFoco(), 'Recargar');
  await pulsa('Enter', 13);
  await hasta(() => web.evalua('window.__vieja === undefined && document.readyState === "complete"'), 8000);
});

test('un clic en la página cierra el menú, y abierto en una esquina no se sale de la ventana', async () => {
  const web = await app.abre(BASE + 'esquina', RUTAS);
  const tam = await web.evalua('[innerWidth, innerHeight]');
  await clicDerecho(web, tam[0] - 10, tam[1] - 10);
  const caja = await ui().evalua(`(() => { const r = ctxMenuEl.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, W: innerWidth, H: innerHeight }; })()`);
  assert.ok(caja.r <= caja.W - 4 && caja.b <= caja.H - 4 && caja.x >= 4 && caja.y >= 4, JSON.stringify(caja));
  await web.clic(40, 40);
  await hasta(async () => !(await menuAbierto()), 3000);
});

test('selección e imagen: copiar, buscar en una pestaña nueva y copiar la dirección de la imagen', async () => {
  const web = await app.abre(BASE + 'seleccion', RUTAS);
  await web.evalua(`(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('tit')); getSelection().removeAllRanges(); getSelection().addRange(r); })(), 1`);
  const [x, y] = await centro(web, '#tit', -40);
  await clicDerecho(web, x, y);
  await elige('Copiar');
  await portapapelesEs('Navegador web');
  const antes = await pestanas();
  await clicDerecho(web, x, y);
  await elige('Buscar "Navegador web" en una pestaña nueva');
  await hasta(async () => (await pestanas()) === antes + 1);
  assert.match(await ui().evalua('activeTab().url || activeTab().webview?.src'), /google\.[^/]+\/search\?q=Navegador(\+|%20)web/);
  await ui().evalua('closeTab(activeId), 1');
  await ui().evalua(`activateTab(tabs.find((t) => /seleccion/.test(t.url || '')).id), 1`);
  await espera(400);
  const [ix, iy] = await centro(web, '#imagen');
  await clicDerecho(web, ix, iy);
  const ops = (await opciones()).map((o) => o.t);
  for (const t of ['Buscar la imagen con Google Lens', 'Copiar la imagen', 'Copiar la dirección de la imagen', 'Guardar la imagen como…']) assert.ok(ops.includes(t), 'falta «' + t + '»');
  await elige('Copiar la dirección de la imagen');
  await portapapelesEs(BASE + 'img.svg');
});

test('campo de la página: corrector, cortar, pegar, deshacer y seleccionar todo', async () => {
  const web = await app.abre(BASE + 'campo', RUTAS);
  // Se escribe la palabra mal escrita, como una persona (clic en el campo y teclear): así el corrector la marca seguro.
  const [ax, ay] = await centro(web, '#area');
  await web.clic(ax, ay);
  await web.evalua(`(() => { const a = document.getElementById('area'); a.value = ''; a.focus(); })(), 1`);
  await web.envia('Input.insertText', { text: 'palabrra ' });
  await espera(1500);
  const [x, y] = await web.evalua(`(() => { const r = document.getElementById('area').getBoundingClientRect(); return [r.x + 30, r.y + 12]; })()`);
  // El corrector a veces marca la palabra un instante después del primer clic derecho
  let ops = [];
  for (let i = 0; i < 4 && !ops.some((o) => o.t === 'palabra'); i++) {
    await clicDerecho(web, x, y);
    ops = await opciones();
    if (!ops.some((o) => o.t === 'palabra')) { await ui().evalua('closeCtxMenu(), 1'); await espera(500); }
  }
  assert.ok(ops.some((o) => o.t === 'palabra'), 'sugerencia del corrector: ' + JSON.stringify(ops.slice(0, 4)));
  assert.ok(ops.some((o) => o.t === 'Añadir al diccionario' && !o.off), 'Añadir al diccionario');
  assert.ok(ops.some((o) => o.t === 'Emojis'), 'Emojis');
  await elige('palabra');
  await hasta(() => web.evalua(`document.getElementById('area').value.trim() === 'palabra'`), 3000);

  // Seleccionar todo + Cortar vacían el campo y dejan el texto en el portapapeles
  const [cx, cy] = await centro(web, '#campo');
  await web.clic(cx, cy);
  await clicDerecho(web, cx, cy);
  await elige('Seleccionar todo');
  await clicDerecho(web, cx, cy);
  await elige('Cortar');
  await hasta(() => web.evalua(`document.getElementById('campo').value === ''`), 3000);
  await portapapelesEs('hola mundo');
  await clicDerecho(web, cx, cy);
  await elige('Pegar');
  await hasta(() => web.evalua(`document.getElementById('campo').value === 'hola mundo'`), 3000);
  await clicDerecho(web, cx, cy);
  await elige('Deshacer');
  await hasta(() => web.evalua(`document.getElementById('campo').value === ''`), 3000);
});

test('página: copiar su dirección, añadir a marcadores, al acceso rápido, código fuente, atrás y adelante', async () => {
  const web = await app.abre(BASE + 'pagina', RUTAS);
  const punto = [300, 400];
  await clicDerecho(web, ...punto);
  const ops = (await opciones()).map((o) => o.t);
  for (const t of ['Pantalla completa', 'Guardar la página como…', 'Guardar como PDF…', 'Imprimir…', 'Inspeccionar']) assert.ok(ops.includes(t), 'falta «' + t + '»');
  await elige('Copiar la dirección de la página');
  await portapapelesEs(BASE + 'pagina');
  await clicDerecho(web, ...punto);
  await elige('Añadir a marcadores');
  await hasta(() => ui().evalua(`!!findBookmark(${JSON.stringify(BASE + 'pagina')})`), 3000);
  await clicDerecho(web, ...punto);
  await elige('Añadir al acceso rápido');
  await hasta(() => ui().evalua(`!els.dialModal.classList.contains('hidden') && els.dialUrl.value === ${JSON.stringify(BASE + 'pagina')}`), 3000);
  await ui().evalua(`els.dialModal.classList.add('hidden'), 1`);
  await ui().evalua(`activateTab(tabs.find((t) => /pagina$/.test(t.url || '')).id), 1`);
  await espera(300);
  const antes = await pestanas();
  await clicDerecho(web, ...punto);
  await elige('Código fuente de la página');
  await hasta(async () => (await pestanas()) === antes + 1);
  assert.match(await ui().evalua('activeTab().url || activeTab().webview?.src'), /^view-source:https:\/\/menus\.test\/pagina/);
  await ui().evalua('closeTab(activeId), 1');
  await ui().evalua(`activateTab(tabs.find((t) => /pagina$/.test(t.url || '')).id), 1`);
  // Atrás y adelante
  await web.evalua(`location.href = ${JSON.stringify(BASE + 'destino')}, 1`);
  await hasta(() => web.evalua(`location.pathname === '/destino' && document.readyState === 'complete'`), 8000);
  await clicDerecho(web, ...punto);
  await elige('Atrás');
  await hasta(() => web.evalua(`location.pathname === '/pagina' && document.readyState === 'complete'`), 8000);
  await clicDerecho(web, ...punto);
  await elige('Adelante');
  await hasta(() => web.evalua(`location.pathname === '/destino' && document.readyState === 'complete'`), 8000);
});

test('barra de direcciones: menú propio con «Pegar e ir» que navega', async () => {
  const web = await app.abre(BASE + 'barra', RUTAS);
  await ui().evalua(`window.navirisApp.clipWrite(${JSON.stringify(BASE + 'destino')})`);
  const [x, y] = await ui().evalua(`(() => { const r = els.urlbar.getBoundingClientRect(); return [r.x + 60, r.y + r.height / 2]; })()`);
  await ui().clic(x, y);
  await clicDerecho(ui(), x, y);
  const ops = (await opciones()).map((o) => o.t);
  assert.deepEqual(ops, ['Deshacer', 'Rehacer', 'Cortar', 'Copiar', 'Pegar', 'Pegar e ir', 'Eliminar', 'Seleccionar todo']);
  await elige('Copiar');
  await portapapelesEs(BASE + 'barra');
  await ui().evalua(`window.navirisApp.clipWrite(${JSON.stringify(BASE + 'destino')})`);
  await ui().clic(x, y);
  await clicDerecho(ui(), x, y);
  await elige('Pegar e ir');
  await hasta(() => web.evalua(`location.pathname === '/destino' && document.readyState === 'complete'`), 8000);
});

test('menú de pestaña: duplicar y fijar', async () => {
  await app.abre(BASE + 'pestana', RUTAS);
  const p = await ui().evalua(`(() => { const r = document.querySelector('.tab.active').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const antes = await pestanas();
  await clicDerecho(ui(), p[0], p[1]);
  assert.equal((await opciones()).find((o) => o.t === 'Nueva pestaña').kbd, 'Ctrl+T');
  await elige('Duplicar pestaña');
  await hasta(async () => (await pestanas()) === antes + 1);
  await espera(300);   // las vecinas terminan de colocarse (200 ms)
  const q = await ui().evalua(`(() => { const r = document.querySelector('.tab.active').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await clicDerecho(ui(), q[0], q[1]);
  await elige('Fijar pestaña');
  await hasta(() => ui().evalua('!!activeTab().pinned'), 3000);
});

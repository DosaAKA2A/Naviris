// Traducir lo seleccionado (renderer/traductor.js), en la app de verdad: al
// seleccionar texto sale la burbuja encima de la selección, al pulsarla se
// traduce (con el traductor real: necesita internet), el clic derecho tiene
// «Traducir», un clic en la página lo cierra y el ajuste apaga la burbuja.
// NAVIRIS_E2E_PUERTO=9430 node --test test/e2e/traductor.e2e.js
// Con NAVIRIS_E2E_CAPTURA=<carpeta> guarda capturas de la burbuja y del panel.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { arranca, hasta, espera } = require('./naviris');

const BASE = 'https://traductor.test/';
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Tienda</title>
<style>body{margin:40px;font:18px/1.6 sans-serif;background:#fff;color:#111} h1{margin-top:120px}</style>
<h1 id="en">How was your shopping experience with Rndplace?</h1>
<p id="es">La entrega llegó dos días antes de lo previsto.</p>
<p id="num">12345 678</p>`;
const RUTAS = [[BASE + '*', () => ({ cuerpo: PAGINA, tipo: 'text/html; charset=utf-8' })]];
const CAPTURAS = process.env.NAVIRIS_E2E_CAPTURA || '';

let app;
test.before(async () => { app = await arranca(); });
test.after(async () => { await app?.cierra(); });

const ui = () => app.ui;
const burbuja = () => ui().evalua('!!document.querySelector(".trad-burbuja.abierto")');
const panel = () => ui().evalua('!!document.querySelector(".trad-panel.abierto")');
const nada = () => ui().evalua('!document.querySelector(".trad")');

// Arrastra el ratón de verdad de punta a punta del elemento (selecciona su texto)
async function selecciona(web, sel) {
  const r = await web.evalua(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + 2, r.y + r.height / 2, r.right - 2]; })()`);
  const [x0, y, x1] = r;
  await web.envia('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y });
  await web.envia('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) await web.envia('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 6, y, button: 'left', buttons: 1 });
  await web.envia('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 });
}
async function captura(nombre) {
  if (!CAPTURAS) return;
  const { data } = await ui().envia('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(CAPTURAS, { recursive: true });
  fs.writeFileSync(path.join(CAPTURAS, nombre + '.png'), Buffer.from(data, 'base64'));
}
const textoPanel = () => hasta(() => ui().evalua('(() => { const t = document.querySelector(".trad-texto"); return t && !t.classList.contains("cargando") ? t.textContent : ""; })()'), 15000);

test('la burbuja sale encima de la selección, traduce al español y un clic en la página la cierra', async () => {
  const web = await app.abre(BASE + 'uno', RUTAS);
  await selecciona(web, '#en');
  await hasta(burbuja, 4000);
  // Encima de la selección, dentro del webview
  const pos = await ui().evalua(`(() => { const b = document.querySelector('.trad-burbuja').getBoundingClientRect(); const w = document.querySelector('webview:not(.hidden)')?.getBoundingClientRect() || tabs.find((t) => t.id === activeId).webview.getBoundingClientRect(); return { b: b.bottom, x: b.x, w: w.top }; })()`);
  const sel = await web.evalua('getSelection().getRangeAt(0).getBoundingClientRect().top');
  assert.ok(pos.b <= pos.w + sel + 2, 'la burbuja queda encima del texto: ' + JSON.stringify({ pos, sel }));
  await espera(250);
  await captura('1-burbuja');

  const c = await ui().evalua(`(() => { const r = document.querySelector('.trad-boton').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await ui().clic(c[0], c[1]);
  await hasta(panel, 3000);
  const t = await textoPanel();
  assert.match(t, /experiencia/i, 'traducido al español: ' + t);
  assert.equal(await ui().evalua('document.querySelector(".trad-de").textContent'), 'Inglés');
  await captura('2-panel');

  // Copiar
  const cp = await ui().evalua(`(() => { const r = document.querySelector('.trad-copiar').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await ui().clic(cp[0], cp[1]);
  await hasta(() => ui().evalua('document.querySelector(".trad-copiar span").textContent === "Copiado"'), 3000);

  await web.clic(20, 20);
  await hasta(nada, 3000);
});

test('un texto que ya está en español se traduce al inglés; números sueltos no sacan burbuja', async () => {
  const web = await app.abre(BASE + 'dos', RUTAS);
  await selecciona(web, '#num');
  await espera(600);
  assert.equal(await burbuja(), false, 'sin burbuja para números');
  await selecciona(web, '#es');
  await hasta(burbuja, 4000);
  const c = await ui().evalua(`(() => { const r = document.querySelector('.trad-boton').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await ui().clic(c[0], c[1]);
  const t = await textoPanel();
  assert.match(t, /delivery|arrived/i, 'pasado al inglés: ' + t);
  assert.equal(await ui().evalua('document.querySelector(".trad-a").value'), 'en');
  await ui().envia('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await hasta(nada, 3000);
});

test('el clic derecho tiene «Traducir» y abre el panel donde se hizo el clic', async () => {
  const web = await app.abre(BASE + 'tres', RUTAS);
  await selecciona(web, '#en');
  await hasta(burbuja, 4000);
  const [x, y] = await web.evalua(`(() => { const r = document.querySelector('#en').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await web.envia('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await web.envia('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  await hasta(() => ui().evalua('!!document.querySelector(".ctx-menu.abierto")'), 4000);
  await espera(250);
  const p = await ui().evalua(`(() => { const b = [...ctxMenuEl.querySelectorAll('.ctx-item')].find((x) => x.querySelector('.ctx-tx').textContent.startsWith('Traducir "')); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + 20, r.y + r.height / 2]; })()`);
  assert.ok(p, 'el menú tiene «Traducir»');
  await ui().clic(p[0], p[1]);
  await hasta(panel, 3000);
  assert.match(await textoPanel(), /experiencia/i);
  await web.clic(20, 20);
  await hasta(nada, 3000);
});

test('con el ajuste apagado no sale la burbuja', async () => {
  await ui().evalua('window.navirisApp.setSettings({ traducirBurbuja: false }).then((s) => { settings = s; return 1; })');
  const web = await app.abre(BASE + 'cuatro', RUTAS);
  await selecciona(web, '#en');
  await espera(800);
  assert.equal(await burbuja(), false);
  await ui().evalua('window.navirisApp.setSettings({ traducirBurbuja: true }).then((s) => { settings = s; return 1; })');
});

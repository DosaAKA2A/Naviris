// Lo que faltaba frente a un navegador normal (parte «huecos» de Naviris 3), en la app de verdad:
// F5 que el freno ya no bloquea, el freno que sigue parando los bucles de la web, alert/confirm/prompt
// dentro de la pestaña sin congelar la interfaz, mailto: que pregunta, pestaña caída con «Recargar»,
// Ctrl+W que respeta las fijadas, Ctrl+N y el buscador elegible.
// NAVIRIS_E2E_PUERTO=9409 npm run test:e2e   (o: node --test test/e2e/huecos.e2e.js)
// El aviso de mailto: se CANCELA siempre: la prueba nunca abre una aplicación del equipo.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { arranca, hasta, espera } = require('./naviris');

const BASE = 'https://huecos.test/';
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Huecos</title>
<a id="mail" href="mailto:prueba@example.com" style="display:block;width:120px;height:30px">correo</a>
<p>Página de prueba</p>`;
const BUCLE = `<!doctype html><meta charset="utf-8"><title>Bucle</title>
<script>sessionStorage.n = (+sessionStorage.n || 0) + 1; setTimeout(() => location.reload(), 120);</script>`;
const RUTAS = [[BASE + '*', (url) => ({ cuerpo: /bucle/.test(url) ? BUCLE : PAGINA, tipo: 'text/html; charset=utf-8' })]];

// Tecla de verdad (como la del teclado) en un target: la web o la interfaz.
async function tecla(dest, key, code, vk, mods = 0) {
  const p = { modifiers: mods, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  // Con tope: si la tecla cierra la pestaña, su target desaparece y CDP ya no contesta.
  const envia = (type) => Promise.race([dest.envia('Input.dispatchKeyEvent', { type, ...p }).catch(() => {}), espera(1500)]);
  await envia('rawKeyDown');
  await envia('keyUp');
}
const CTRL = 2, MAYUS = 8;

let app;
test.before(async () => { app = await arranca(); });
test.after(async () => { await app?.cierra(); });

test('siete F5 seguidos recargan los siete (el freno no cuenta las recargas del usuario)', async () => {
  const web = await app.abre(BASE + 'f5', RUTAS);
  for (let i = 1; i <= 7; i++) {
    await web.evalua(`window.__vieja = ${i}, 1`);
    await tecla(web, 'F5', 'F5', 116);
    await hasta(async () => (await web.evalua('window.__vieja === undefined && document.readyState === "complete"')), 8000);
  }
  assert.ok(!(await app.ui.evalua(`els.toast.classList.contains('show') && /sin parar/.test(els.toast.textContent)`)), 'no sale el aviso de bucle');
});

test('una web que se recarga sola se sigue frenando', async () => {
  const web = await app.abre(BASE + 'inicio', RUTAS);
  await web.evalua(`sessionStorage.n = 0; location.href = '${BASE}bucle'; 1`);
  await hasta(() => app.ui.evalua(`/sin parar/.test(els.toast.textContent)`), 10000);
  const n = Number(await web.evalua('sessionStorage.n'));
  await espera(1500);
  assert.equal(Number(await web.evalua('sessionStorage.n')), n, 'después del aviso ya no carga más');
  assert.ok(n <= 5, 'cargas antes del freno: ' + n);
  await app.ui.evalua('closeTab(activeId), 1');
});

test('confirm y prompt: diálogo dentro de la pestaña, la interfaz sigue respondiendo', async () => {
  const web = await app.abre(BASE + 'dialogos', RUTAS);
  // Lanzado sin esperar: la página se queda parada hasta que se conteste.
  web.evalua(`setTimeout(() => { window.__c = confirm('¿Seguro?'); window.__p = prompt('Nombre', 'Ana'); }, 0), 1`);
  await hasta(() => app.ui.evalua(`!els.tabDialogo.classList.contains('hidden') && els.tdTexto.textContent === '¿Seguro?'`));
  assert.equal(await app.ui.evalua('els.tdTit.textContent'), 'huecos.test dice');
  // La interfaz contesta al momento y se puede abrir y cerrar otra pestaña
  const t0 = Date.now();
  assert.equal(await app.ui.evalua('(() => { const t = createTab(); const id = t.id; activateTab(id); closeTab(id); return tabs.length > 0; })()'), true);
  assert.ok(Date.now() - t0 < 1500);
  // Al volver a su pestaña el diálogo sigue ahí
  await hasta(() => app.ui.evalua(`!els.tabDialogo.classList.contains('hidden')`));
  await app.ui.evalua('els.tdAceptar.click(), 1');
  await hasta(() => app.ui.evalua(`!els.tdValor.classList.contains('hidden') && els.tdValor.value === 'Ana'`));
  await app.ui.evalua(`els.tdValor.value = 'Luis'; els.tdAceptar.click(); 1`);
  await hasta(() => web.evalua('window.__p !== undefined'));
  assert.equal(await web.evalua('window.__c'), true);
  assert.equal(await web.evalua('window.__p'), 'Luis');
  assert.equal(await app.ui.evalua(`els.tabDialogo.classList.contains('hidden')`), true);
});

test('un enlace mailto: pregunta antes de abrir la aplicación (y Cancelar no abre nada)', async () => {
  const web = await app.abre(BASE + 'correo', RUTAS);
  const [x, y] = await web.evalua(`(() => { const b = document.getElementById('mail').getBoundingClientRect(); return [b.x + 10, b.y + 10]; })()`);
  await web.clic(x, y);
  await hasta(() => app.ui.evalua(`!els.tabDialogo.classList.contains('hidden') && /correo/.test(els.tdTit.textContent)`));
  assert.equal(await app.ui.evalua('els.tdUrl.textContent'), 'mailto:prueba@example.com');
  assert.equal(await app.ui.evalua('els.tdAceptar.textContent'), 'Abrir');
  await app.ui.evalua('els.tdCancelar.click(), 1');
  await hasta(() => app.ui.evalua(`els.tabDialogo.classList.contains('hidden')`));
  assert.equal(await web.evalua('location.href'), BASE + 'correo');
});

test('pestaña caída: aviso con «Recargar» y vuelve al pulsarlo', async () => {
  const web = await app.abre(BASE + 'caida', RUTAS);
  web.envia('Page.crash').catch(() => {});
  await hasta(() => app.ui.evalua(`!document.getElementById('fallo-pagina').classList.contains('hidden')`));
  assert.equal(await app.ui.evalua(`document.getElementById('fallo-tit').textContent`), 'Esta pestaña dejó de funcionar');
  assert.match(await app.ui.evalua(`document.getElementById('fallo-reintentar').textContent`), /Recargar/);
  await app.ui.evalua(`document.getElementById('fallo-reintentar').click(), 1`);
  await hasta(() => app.ui.evalua(`document.getElementById('fallo-pagina').classList.contains('hidden') && activeTab().title === 'Huecos'`), 15000);
});

test('Ctrl+W no cierra la pestaña fijada; suelta, sí', async () => {
  const web = await app.abre(BASE + 'fijada', RUTAS);
  const id = await app.ui.evalua('activeId');
  await app.ui.evalua('setPinned(activeTab(), true), 1');
  await tecla(web, 'w', 'KeyW', 87, CTRL);
  await espera(500);
  assert.ok(await app.ui.evalua(`tabs.some((t) => t.id === ${id})`), 'la fijada sigue');
  await app.ui.evalua('setPinned(activeTab(), false), 1');
  await tecla(web, 'w', 'KeyW', 87, CTRL);
  await hasta(() => app.ui.evalua(`!tabs.some((t) => t.id === ${id})`));
});

test('Ctrl+Mayús+AvPág mueve la pestaña en vez de cambiar de pestaña', async () => {
  const web = await app.abre(BASE + 'mover', RUTAS);
  const id = await app.ui.evalua('activeId');
  await app.ui.evalua(`createTab('${BASE}otra', false), 1`);
  // En el runner de GitHub la pestaña nueva tarda: se espera a que exista antes de pulsar.
  await hasta(() => app.ui.evalua(`tabs.some((t) => t.url.endsWith('/otra'))`));
  await espera(300);
  const antes = await app.ui.evalua('tabs.findIndex((t) => t.id === activeId)');
  await tecla(web, 'PageDown', 'PageDown', 34, CTRL | MAYUS);
  await hasta(() => app.ui.evalua(`tabs.findIndex((t) => t.id === ${id}) === ${antes + 1}`)).catch(async (e) => {
    throw new Error(e.message + ' | antes=' + antes + ' pestañas=' + await app.ui.evalua(`JSON.stringify(tabs.map((t) => [t.id === ${id}, t.kind, t.url, !!t.pinned]))`) + ' activa=' + await app.ui.evalua('activeId === ' + id));
  });
  assert.equal(await app.ui.evalua('activeId'), id, 'sigue activa la misma');
});

test('Ctrl+N abre una ventana nueva con el hub', async () => {
  const web = await app.abre(BASE + 'ventana', RUTAS);
  const PUERTO = Number(process.env.NAVIRIS_E2E_PUERTO) || 9405;
  const lista = async () => (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
  await tecla(web, 'n', 'KeyN', 78, CTRL);
  const nueva = await hasta(async () => (await lista()).find((t) => t.type === 'page' && /index\.html\?sacada=1/.test(t.url)));
  await fetch(`http://127.0.0.1:${PUERTO}/json/close/${nueva.id}`);
});

test('buscador elegible: DuckDuckGo en la barra y vuelta a Google', async () => {
  await app.ui.evalua(`els.optBuscador.value = 'duckduckgo'; els.optBuscador.dispatchEvent(new Event('change')); 1`);
  await hasta(() => app.ui.evalua(`settings.buscador === 'duckduckgo'`));
  assert.equal(await app.ui.evalua(`toUrl('hola mundo')`), 'https://duckduckgo.com/?q=hola%20mundo');
  assert.equal(await app.ui.evalua('els.urlbar.placeholder'), 'Busca en DuckDuckGo o escribe una dirección');
  assert.equal(await app.ui.evalua(`toUrl('example.com')`), 'https://example.com');
  await app.ui.evalua(`els.optBuscador.value = 'google'; els.optBuscador.dispatchEvent(new Event('change')); 1`);
  await hasta(() => app.ui.evalua(`settings.buscador === 'google'`));
  assert.equal(await app.ui.evalua(`toUrl('hola')`), 'https://www.google.com/search?q=hola');
});

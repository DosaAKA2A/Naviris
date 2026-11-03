// El hub escala entero (src/hub-escala.js) en la app real: tres tamaños de ventana,
// la composición no se reordena ni se corta, el texto no baja de 11 px, editar
// acierta las celdas y redimensionar no deja tareas largas.
// npm run test:e2e   (puerto CDP: NAVIRIS_E2E_PUERTO, 9405 por defecto)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { arranca, hasta, espera } = require('./naviris');

// Ventanas maximizadas: portátil 1366×768 al 125 %, al 100 % y 1920×1080.
const TAMANOS = [
  { id: '1366x768 al 125 %', w: 1093, h: 576, dsf: 1.25 },
  { id: '1366x768 al 100 %', w: 1366, h: 720, dsf: 1 },
  { id: '1920x1080', w: 1920, h: 1032, dsf: 1 }
];

const MIDE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const scr = document.querySelector('#hub .hub-scroll').getBoundingClientRect();
  const z = encuadreHub.s, paso = z * hubEscala.PASO;
  const g = document.getElementById('widget-grid').getBoundingClientRect();
  const piezas = ['#hub-dock', '.hub-actions', '.hub-corner'].map((s) => document.querySelector(s).getBoundingClientRect());
  const pisa = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  let letraMin = 99;
  const ws = [...document.querySelectorAll('#widget-grid > .widget')].map((el) => {
    const r = el.getBoundingClientRect(), card = el.firstElementChild.getBoundingClientRect();
    const w = widgets.find((x) => x.id === el.dataset.id).geo.m;
    let saleDeLaTarjeta = 0;
    el.firstElementChild.querySelectorAll('*').forEach((d) => {
      const cs = getComputedStyle(d); if (cs.display === 'none' || d.closest('.nvs-bar')) return;
      const rd = d.getBoundingClientRect(); if (!rd.width || !rd.height) return;
      if (rd.right > card.right + 1 || rd.bottom > card.bottom + 1 || rd.left < card.left - 1 || rd.top < card.top - 1) saleDeLaTarjeta++;
      if ([...d.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) letraMin = Math.min(letraMin, parseFloat(cs.fontSize) * z);
    });
    return {
      id: el.dataset.id, geo: w,
      // celda que ocupa en pantalla, deducida de su rectángulo
      col: Math.round((r.left - g.left) / paso) + 1, row: Math.round((r.top - g.top) / paso) + 1,
      dentro: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5 && r.bottom <= scr.bottom + 0.5 && r.top >= scr.top - 0.5,
      pisaCromo: piezas.some((p) => pisa(p, r)), saleDeLaTarjeta
    };
  });
  return { modo: encuadreHub.modo, s: z, reflujo: document.getElementById('hub').classList.contains('reflujo'), ws, letraMin };
})()`;

async function aTamano(ui, t) {
  await ui.envia('Emulation.setDeviceMetricsOverride', { width: t.w, height: t.h, deviceScaleFactor: t.dsf, mobile: false, screenWidth: t.w, screenHeight: t.h + 40 });
}
async function deFabrica(ui) {
  await ui.evalua(`['naviris.widgets', 'naviris.maqueta'].forEach((k) => localStorage.removeItem(k)); localStorage.setItem('naviris.hub.v3', 'true'); true`);
  await ui.envia('Page.reload', { ignoreCache: true });
  await espera(1000);
  await hasta(() => ui.evalua(`typeof encuadreHub !== 'undefined' && !!encuadreHub && document.querySelectorAll('#widget-grid > .widget').length >= 8`));
  await espera(2200);   // entrada escalonada del arranque
}

test('el hub escala la composición entera en tres tamaños, sin reordenar ni cortar', { timeout: 180000 }, async () => {
  const app = await arranca();
  try {
    for (const t of TAMANOS) {
      await aTamano(app.ui, t);
      await deFabrica(app.ui);
      const d = await app.ui.evalua(MIDE);
      assert.equal(d.reflujo, false, `${t.id}: se reordenó en columnas`);
      assert.equal(d.modo, 'maqueta', `${t.id}: modo ${d.modo}`);
      assert.ok(d.s >= 0.7, `${t.id}: escala ${d.s}`);
      for (const w of d.ws) {
        assert.deepEqual([w.col, w.row], [w.geo.col, w.geo.row], `${t.id}: ${w.id} no está en su celda`);
        assert.ok(w.dentro, `${t.id}: ${w.id} se sale de la vista`);
        assert.ok(!w.pisaCromo, `${t.id}: ${w.id} pisa el dock, los botones o la esquina`);
        assert.equal(w.saleDeLaTarjeta, 0, `${t.id}: a ${w.id} se le sale contenido de la tarjeta`);
      }
      assert.ok(d.letraMin >= 10.95, `${t.id}: letra de ${d.letraMin} px`);
    }
  } finally { await app.cierra(); }
});

test('editar en un portátil: la maqueta entera escalada y el ratón acierta celdas y asas', { timeout: 120000 }, async () => {
  const app = await arranca();
  try {
    await aTamano(app.ui, TAMANOS[0]);
    await deFabrica(app.ui);
    await app.ui.evalua(`document.getElementById('hub-edit').click(); true`);
    await espera(400);
    const e = await app.ui.evalua(`({ editando: document.getElementById('hub').classList.contains('editing'), modo: encuadreHub.modo, s: encuadreHub.s })`);
    assert.equal(e.editando, true);
    assert.notEqual(e.modo, 'reflujo');
    // El centro de cada widget cae en una celda suya (celdaDe con la escala)
    const malas = await app.ui.evalua(`[...document.querySelectorAll('#widget-grid > .widget')].filter((el) => {
      const r = el.getBoundingClientRect(), g = widgets.find((x) => x.id === el.dataset.id).geo.m;
      const c = celdaDe({ clientX: r.left + 4, clientY: r.top + 4 });
      return c.col !== g.col || c.row !== g.row;
    }).map((el) => el.dataset.id)`);
    assert.deepEqual(malas, []);
    // Asa de la esquina del buscador: una celda a la izquierda encoge de 3 a 2
    const asa = await app.ui.evalua(`(() => { const r = document.querySelector('.widget[data-id="wse"] .w-redim.rb').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, paso: encuadreHub.s * hubEscala.PASO }; })()`);
    const raton = (type, x, y) => app.ui.envia('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await raton('mouseMoved', asa.x, asa.y);
    await raton('mousePressed', asa.x, asa.y);
    for (let i = 1; i <= 5; i++) await raton('mouseMoved', asa.x - asa.paso * i / 5, asa.y);
    await raton('mouseReleased', asa.x - asa.paso, asa.y);
    await espera(300);
    const geo = await app.ui.evalua(`widgets.find((x) => x.id === 'wse').geo.m`);
    assert.equal(geo.w, 2, 'el asa no movió una celda justa');
  } finally { await app.cierra(); }
});

test('redimensionar 20 veces no deja tareas de más de 50 ms', { timeout: 120000 }, async () => {
  const app = await arranca();
  try {
    await aTamano(app.ui, TAMANOS[2]);
    await deFabrica(app.ui);
    await app.ui.evalua(`window.__largas = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__largas.push(Math.round(e.duration)))).observe({ type: 'longtask' }); true`);
    // Control: el observador SÍ ve una tarea larga de verdad (si no, la prueba no valdría nada)
    await app.ui.evalua(`setTimeout(() => { const t0 = performance.now(); while (performance.now() - t0 < 70); }, 0); true`);
    await espera(400);
    assert.equal((await app.ui.evalua('window.__largas.splice(0).length')), 1, 'el observador de tareas largas no funciona');
    // Electron no deja cambiar la ventana por CDP (Browser.setWindowBounds no existe):
    // se cambia el viewport, que dispara lo mismo en la interfaz (resize, ResizeObserver, maquetación).
    // Del 1920 al portátil y vuelta, pasando por el reflujo (ventana estrecha)
    const anchos = [1920, 1700, 1500, 1366, 1280, 1200, 1093, 1000, 900, 1093, 1280, 1366, 1500, 1700, 1920, 1600, 1400, 1200, 1500, 1920];
    for (const w of anchos) {
      await app.ui.envia('Emulation.setDeviceMetricsOverride', { width: w, height: Math.round(w * 0.54), deviceScaleFactor: 1, mobile: false });
      await espera(60);
    }
    await espera(800);
    const largas = await app.ui.evalua('window.__largas');
    assert.deepEqual(largas, [], 'tareas largas: ' + largas.join(', ') + ' ms');
  } finally { await app.cierra(); }
});

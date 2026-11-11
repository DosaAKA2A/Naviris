// e2e (app real por CDP): el Centro de rendimiento de Ajustes.
//   - se abre desde el menú, enseña cifras reales (memoria, procesador, pestañas,
//     tiempo abierto) y los tres hitos del arranque,
//   - refresca cada 2 s SOLO abierto: cerrado no consulta nada al proceso principal,
//   - las pruebas de memoria, carga y renderizado dan resultados con sentido, se
//     guardan en el almacén de la interfaz y no dejan el webview de prueba montado,
//   - «Copiar resultados» deja en el portapapeles el texto con el equipo y el JSON.
// Se ejecuta con: npm run test:e2e:centro  (puerto CDP: NAVIRIS_E2E_PUERTO, 9425 para esta parte)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.NAVIRIS_E2E_PUERTO) process.env.NAVIRIS_E2E_PUERTO = '9425';
const { arranca, hasta, espera } = require('./naviris');

test('Centro de rendimiento', { timeout: 180000 }, async (t) => {
  const app = await arranca();
  const { ui } = app;
  try {
    // Cuenta las lecturas en vivo: cada una deja un objeto crVivo nuevo (navirisApp
    // viene de contextBridge y no se puede envolver).
    await ui.evalua('window.__vivo = 0; window.__ult = null; setInterval(() => { if (crVivo !== window.__ult) { window.__ult = crVivo; window.__vivo++; } }, 100); true');

    await t.test('se abre desde el menú con cifras reales', async () => {
      await ui.evalua('document.querySelector(\'#menu-pop [data-action="centro"]\').click()');
      await hasta(() => ui.evalua('document.getElementById("centro-page").classList.contains("active") && /\\d/.test(document.getElementById("cr-mem").textContent)'));
      const v = await ui.evalua(`({ mem: document.getElementById('cr-mem').textContent, cpu: document.getElementById('cr-cpu').textContent,
        tabs: document.getElementById('cr-tabs').textContent, activo: document.getElementById('cr-activo').textContent })`);
      assert.match(v.mem, /^\d+(\.\d)? (MB|GB)$/, v.mem);
      assert.match(v.cpu, /^\d+\.\d %$/, v.cpu);
      assert.match(v.tabs, /^\d+$/);
      assert.match(v.activo, /\d/);
      await hasta(() => ui.evalua('document.querySelectorAll("#cr-r-arranque .cr-mini").length === 3'));
      const arr = await ui.evalua('[...document.querySelectorAll("#cr-r-arranque .cr-mini-v")].map((e) => e.textContent)');
      for (const x of arr) assert.match(x, /\d+(\.\d+)? (ms|s)$/, 'hito: ' + x);
    });

    await t.test('refresca solo mientras está abierto', async () => {
      const a = await ui.evalua('window.__vivo');
      await espera(4500);
      const b = await ui.evalua('window.__vivo');
      assert.ok(b - a >= 2 && b - a <= 3, `abierto: ${b - a} lecturas en 4,5 s`);
      await ui.evalua('document.getElementById("cr-x").click()');
      assert.equal(await ui.evalua('document.getElementById("centro-page").classList.contains("active")'), false);
      assert.equal(await ui.evalua('crTimer'), null);
      const c = await ui.evalua('window.__vivo');
      await espera(4500);
      assert.equal(await ui.evalua('window.__vivo'), c, 'cerrado no consulta nada');
      await ui.evalua('abreCentro()');
    });

    await t.test('prueba de memoria', async () => {
      await ui.evalua('document.querySelector(\'.cr-medir[data-prueba="memoria"]\').click()');
      await hasta(() => ui.evalua('!!(store.get("naviris.centro", {}).memoria)'));
      const m = await ui.evalua('store.get("naviris.centro", {}).memoria');
      assert.ok(m.totalKb > 50 * 1024, 'más de 50 MB');
      assert.ok(m.grupos.length >= 3);
      assert.ok(m.pestanas >= 1);
    });

    await t.test('prueba de carga de páginas (local)', async () => {
      await ui.evalua('document.querySelector(\'.cr-medir[data-prueba="carga"]\').click()');
      await hasta(() => ui.evalua('!crOcupado && !!(store.get("naviris.centro", {}).carga)'), 60000);
      const c = await ui.evalua('store.get("naviris.centro", {}).carga');
      assert.equal(c.paginas.length, 3);
      for (const p of c.paginas) { assert.equal(p.veces, 3); assert.ok(p.total > 0 && p.total < 10000, `${p.pagina}: ${p.total} ms`); }
      assert.equal(await ui.evalua('document.querySelectorAll("#cr-banco webview").length'), 0, 'el webview de prueba se quita');
      console.log('# carga', JSON.stringify(c.paginas));
    });

    await t.test('prueba de renderizado', async () => {
      await ui.evalua('document.querySelector(\'.cr-medir[data-prueba="render"]\').click()');
      await hasta(() => ui.evalua('!crOcupado && !!(store.get("naviris.centro", {}).render)'), 60000);
      const r = await ui.evalua('store.get("naviris.centro", {}).render');
      assert.ok(r.fotogramas > 100, `${r.fotogramas} fotogramas`);
      assert.ok(r.fps > 20, `${r.fps} fps`);
      assert.ok(r.refrescoHz >= 30 && r.refrescoHz <= 500, `${r.refrescoHz} Hz`);
      assert.equal(await ui.evalua('document.querySelectorAll("#cr-banco webview").length'), 0);
      console.log('# render', JSON.stringify(r));
    });

    await t.test('cerrar en mitad de una prueba la cancela y lo quita todo', async () => {
      await ui.evalua('document.querySelector(\'.cr-medir[data-prueba="render"]\').click()');
      await hasta(() => ui.evalua('document.querySelectorAll("#cr-banco webview").length === 1'));
      await ui.evalua('cierraCentro()');
      assert.equal(await ui.evalua('document.querySelectorAll("#cr-banco webview").length'), 0);
      await hasta(() => ui.evalua('!crOcupado'), 30000);
      await ui.evalua('abreCentro()');
    });

    await t.test('copiar resultados', async () => {
      await ui.evalua('document.getElementById("cr-copiar").click()');
      await espera(800);
      const texto = await ui.evalua('window.navirisApp.clipRead()');
      assert.match(texto, /Naviris · Centro de rendimiento/);
      assert.match(texto, /Chromium \d+/);
      assert.match(texto, /núcleos lógicos/);
      const json = JSON.parse(texto.slice(texto.lastIndexOf('\n') + 1));
      assert.ok(json.resultados.memoria && json.resultados.carga && json.resultados.render);
      console.log('# copiado:\n' + texto.split('\n').map((l) => '#   ' + l).join('\n'));
    });
  } finally {
    await app.cierra();
  }
});

// Ahorro de energía (pestanas.js, noSeDuerme): con el tiempo de Ajustes, una
// pestaña sin usar se duerme; no se duermen las que tienen un formulario a
// medias (escrito de verdad con el teclado), las de un sitio de «No dormir
// nunca» ni las que usan la cámara o el micrófono. El reloj mira cada 30 s.
// NAVIRIS_E2E_PUERTO=9432 node --test test/e2e/dormir.e2e.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { arranca, hasta, espera } = require('./naviris');

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Página</title><form><input id="campo"><textarea id="area"></textarea></form>';
const rutas = (host) => [[`https://${host}/*`, () => ({ cuerpo: PAGINA, tipo: 'text/html; charset=utf-8' })]];

let app;
test.before(async () => { app = await arranca(); });
test.after(async () => { await app?.cierra(); });

test('duerme la pestaña sin usar y respeta formulario, «no dormir nunca» y cámara', { timeout: 120000 }, async () => {
  const ui = app.ui;
  const abre = async (host) => {
    const web = await app.abre(`https://${host}/`, rutas(host));
    const id = await ui.evalua('activeId');
    return { web, id };
  };
  const libre = await abre('dormir-libre.test');
  const form = await abre('dormir-form.test');
  const excluida = await abre('dormir-excluida.test');
  const camara = await abre('dormir-camara.test');
  const activa = await abre('dormir-activa.test');   // la que queda delante

  // Formulario a medias: se escribe de verdad con el teclado en su página
  // (con la pestaña delante y el foco en ella, como haría una persona)
  await ui.evalua(`activateTab(${form.id}); tabs.find((t) => t.id === ${form.id}).webview.focus(); 1`);
  await espera(300);
  await form.web.evalua('document.getElementById("campo").focus(); 1');
  await form.web.envia('Input.insertText', { text: 'hola' });
  await hasta(() => ui.evalua(`tabs.find((t) => t.id === ${form.id}).escribiendo === true`), 4000);
  await ui.evalua(`activateTab(${activa.id}); 1`);
  // Sitio excluido con la opción del menú de la pestaña
  await ui.evalua(`alternaNoDormir(tabs.find((t) => t.id === ${excluida.id})).then(() => 1)`);
  assert.ok((await ui.evalua('settings.noDormir')).includes('dormir-excluida.test'));
  // Cámara: la marca que pone el main al conceder el permiso
  await ui.evalua(`tabs.find((t) => t.id === ${camara.id}).usaMedia = true; 1`);

  // Tiempo de dormir mínimo y las cuatro «sin usar» desde hace mucho
  await ui.evalua('window.navirisApp.setSettings({ powerSaver: true, dormirTras: 0.05 }).then((s) => { settings = s; return 1; })');
  await ui.evalua(`[${libre.id}, ${form.id}, ${excluida.id}, ${camara.id}].forEach((id) => { tabs.find((t) => t.id === id).lastActive = 0; }); 1`);
  await hasta(() => ui.evalua(`tabs.find((t) => t.id === ${libre.id}).asleep === true`), 40000, 1000);
  await espera(500);
  const estado = await ui.evalua(`[${form.id}, ${excluida.id}, ${camara.id}].map((id) => !!tabs.find((t) => t.id === id).asleep)`);
  assert.deepEqual(estado, [false, false, false], 'formulario, excluida y cámara siguen despiertas');

  // Al enviar el formulario ya se puede dormir
  await form.web.evalua('document.querySelector("form").addEventListener("submit", (e) => e.preventDefault()); document.querySelector("form").requestSubmit(); 1');
  await hasta(() => ui.evalua(`tabs.find((t) => t.id === ${form.id}).escribiendo === false`), 4000);
  await hasta(() => ui.evalua(`tabs.find((t) => t.id === ${form.id}).asleep === true`), 40000, 1000);
  await ui.evalua('window.navirisApp.setSettings({ dormirTras: 30, noDormir: [] }).then((s) => { settings = s; return 1; })');
});

// Parte «auditoria» de Naviris 3 (2026-11-11), en la app de verdad:
// · la prueba de identidad de MOOVIN solo llega a https://moovin.live (ni a
//   iris.it.com, que caducó y lo sirve un tercero, ni a moovin.live por http);
// · los canales de la interfaz no atienden a un webview aunque este mande el
//   mensaje (lo que haría un renderer de una web comprometido).
// Las páginas se sirven desde CDP con la dirección real, sin salir a internet, y
// el worker de cuentas se simula en el proceso principal (inspector).
// NAVIRIS_E2E_PUERTO=9421 node --test test/e2e/auditoria.e2e.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { arranca, conecta, hasta, PUERTO } = require('./naviris');

const PUERTO_MAIN = PUERTO + 10;
let app, principal;
const enMain = async (expr) => {
  const r = await principal.envia('Runtime.evaluate', { expression: `(async () => { const { BrowserWindow, ipcMain, webContents } = require('electron'); ${expr} })()`, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const PAGINA = '<!doctype html><meta charset="utf-8"><title>prueba</title><p>pagina de prueba</p>';

test.before(async () => {
  app = await arranca([`--inspect=${PUERTO_MAIN}`]);
  const dbg = (await (await fetch(`http://127.0.0.1:${PUERTO_MAIN}/json/list`)).json())[0];
  principal = await conecta(dbg.webSocketDebuggerUrl);
  await principal.envia('Runtime.enable');
  // Cuenta de Naviris "iniciada" y worker de cuentas que firma cualquier cosa:
  // si una página llega a pedirla, se lleva la prueba.
  await app.ui.evalua(`window.navirisApp.cuentaToken('${'a'.repeat(64)}'); 1`);
  await enMain(`globalThis.__fetchReal = globalThis.fetch;
    globalThis.fetch = async (u, o) => String(u).includes('/moovin/identidad')
      ? { ok: true, json: async () => ({ prueba: 'PRUEBA-FIRMADA' }) } : globalThis.__fetchReal(u, o);
    return 1;`);
});
test.after(async () => {
  try { await enMain('globalThis.fetch = globalThis.__fetchReal; return 1;'); } catch { /* ya cerrada */ }
  principal?.cierra();
  await app?.cierra();
});

async function identidadEn(url) {
  const web = await app.abre(url, [[url.replace(/\/$/, '') + '*', () => ({ cuerpo: PAGINA, tipo: 'text/html' })]]);
  try {
    const tipo = await web.evalua('typeof window.__navMoovinIdentidad');
    return tipo === 'function' ? await web.evalua('window.__navMoovinIdentidad()') : null;
  } finally { web.cierra(); }
}

test('MOOVIN por https recibe la prueba de identidad', async () => {
  assert.equal(await identidadEn('https://moovin.live/'), 'PRUEBA-FIRMADA');
});

test('iris.it.com (caducado) y moovin.live por http no la reciben', async () => {
  assert.equal(await identidadEn('https://iris.it.com/moovin/'), null);
  assert.equal(await identidadEn('http://moovin.live/'), null);
});

test('un webview que manda mensajes de la interfaz no consigue nada', async () => {
  const web = await app.abre('https://ejemplo.test/', [['https://ejemplo.test/*', () => ({ cuerpo: PAGINA, tipo: 'text/html' })]]);
  try {
    const r = await enMain(`
      const wv = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().startsWith('https://ejemplo.test'));
      const evento = { sender: wv, senderFrame: wv.mainFrame, returnValue: undefined };
      const interfaces = () => BrowserWindow.getAllWindows().filter((w) => /index\\.html/.test(w.webContents.getURL())).length;
      const antes = interfaces();
      // Lo que antes atendía a cualquiera: abrir una ventana privada, pedir la lista
      // de descargas o instalar una actualización.
      ipcMain.listeners('win:new-private')[0](evento);
      ipcMain.listeners('update:install')[0](evento);
      const archivos = await ipcMain._invokeHandlers.get('downloads:files')(evento);
      await new Promise((r) => setTimeout(r, 1500));
      return { antes, despues: interfaces(), archivos };`);
    assert.equal(r.despues, r.antes, 'no se abre ninguna ventana');
    assert.deepEqual(r.archivos, { ok: false, error: 'origen no autorizado' });
    // Y la interfaz sigue pudiendo
    assert.equal(typeof await app.ui.evalua('window.navirisApp.version()'), 'string');
    await hasta(() => app.ui.evalua('Array.isArray(tabs)'));
  } finally { web.cierra(); }
});

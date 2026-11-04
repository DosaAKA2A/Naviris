// Una sola instancia por perfil (parte «instalador» de Naviris 3), en la app de verdad:
// lo que se pasa al arrancar se abre en pestañas, otra instancia sobre el mismo perfil le
// pasa lo suyo a la abierta y se cierra (sin ventana nueva, nunca en la privada), y una
// instancia con otro perfil sigue arrancando aparte (las pruebas y los agentes dependen de eso).
// NAVIRIS_E2E_PUERTO=9414 npm run test:e2e   (o: node --test test/e2e/instancia.e2e.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { arranca, conecta, lista, hasta, espera, RAIZ, PUERTO } = require('./naviris');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-instancia-'));
const pagina = (nombre) => {
  const ruta = path.join(DIR, nombre);
  fs.writeFileSync(ruta, `<!doctype html><meta charset="utf-8"><title>${nombre}</title><p>${nombre}</p>`);
  return { ruta, url: pathToFileURL(ruta).href };
};
const INICIAL = pagina('al arrancar.html');

// Lanza otra instancia de Naviris y espera a que salga (si sale)
function otra(args, ms = 15000) {
  const proc = spawn(require('electron'), ['.', ...args], { cwd: RAIZ, stdio: 'ignore' });
  const salida = new Promise((r) => proc.once('exit', (codigo) => r(codigo)));
  return { proc, salida: Promise.race([salida, espera(ms).then(() => 'sigue viva')]) };
}
const interfaces = async () => (await lista()).filter((x) => x.type === 'page' && /index\.html/.test(x.url));
const tieneTab = (url) => `tabs.some((t) => t.url === ${JSON.stringify(url)})`;

let app;
test.before(async () => { app = await arranca([INICIAL.ruta]); });
test.after(async () => {
  if (app) await app.cierra();
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('el archivo pasado al arrancar se abre en una pestaña', async () => {
  await hasta(() => app.ui.evalua(tieneTab(INICIAL.url)));
});

test('otra instancia con el mismo perfil abre su archivo en la ventana abierta y se cierra', async () => {
  // Como lo manda Windows desde el registro: --single-argument y la ruta sin comillas, con espacios.
  const p = pagina('segunda instancia.html');
  const { salida } = otra([`--user-data-dir=${app.perfil}`, '--single-argument', ...p.ruta.split(' ')]);
  assert.equal(await salida, 0, 'la segunda instancia sale enseguida y sin error');
  await hasta(() => app.ui.evalua(`${tieneTab(p.url)} && activeTab().url === ${JSON.stringify(p.url)}`));
  assert.equal((await interfaces()).length, 1, 'ninguna ventana nueva');
});

test('abrir Naviris otra vez sin nada no abre pestañas ni ventanas', async () => {
  const antes = await app.ui.evalua('tabs.length');
  const { salida } = otra([`--user-data-dir=${app.perfil}`]);
  assert.equal(await salida, 0);
  await espera(1500);
  assert.equal(await app.ui.evalua('tabs.length'), antes);
  assert.equal((await interfaces()).length, 1);
});

test('con una ventana privada delante, el enlace va a la normal', async () => {
  await app.ui.evalua('window.navirisApp.newPrivateWindow(), 1');
  const privada = await hasta(async () => (await lista()).find((x) => x.type === 'page' && /index\.html\?private=1/.test(x.url)));
  const ui2 = await conecta(privada.webSocketDebuggerUrl);
  try {
    await hasta(() => ui2.evalua('typeof createTab === "function" && Array.isArray(tabs)'));
    const p = pagina('desde la privada.html');
    const { salida } = otra([`--user-data-dir=${app.perfil}`, p.ruta]);
    assert.equal(await salida, 0);
    await hasta(() => app.ui.evalua(tieneTab(p.url)));
    assert.equal(await ui2.evalua(tieneTab(p.url)), false, 'nada en la privada');
  } finally {
    ui2.cierra();
    await fetch(`http://127.0.0.1:${PUERTO}/json/close/${privada.id}`);
  }
});

test('una instancia con otro perfil no se cierra: cada perfil tiene su cerradura', async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-otro-'));
  const { proc, salida } = otra([`--user-data-dir=${perfil}`], 8000);
  try {
    assert.equal(await salida, 'sigue viva');
    assert.equal((await interfaces()).length, 1, 'la primera no abrió nada');
  } finally {
    // Sin puerto CDP propio: se cierra por su PID.
    if (proc.exitCode === null) proc.kill();
    await espera(1500);
    fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

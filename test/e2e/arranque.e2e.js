// Arranque real de Naviris (npm run test:e2e). Abre la app con un perfil
// temporal y --inspect-brk, engancha los eventos de ventanas en el proceso
// principal antes de que corra main.js y comprueba el relevo del splash:
//   - el splash se muestra ya con contenido (nada de cuadrado vacío),
//   - suena el arranque, y sigue sonando aunque el splash se oculte,
//   - la ventana principal sale en cuanto la interfaz está lista y la
//     animación ha terminado (SPLASH_MINIMO desde que arranca), ni antes ni más tarde,
//   - el splash se oculta tras el fundido y se cierra.
// Puerto del inspector: NAVIRIS_E2E_PUERTO (por defecto 9406).
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const ELECTRON = require('electron');
const PUERTO = process.env.NAVIRIS_E2E_PUERTO || '9406';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const MINIMO = Number(fs.readFileSync(path.join(RAIZ, 'src', 'main.js'), 'utf8').match(/const SPLASH_MINIMO = (\d+);/)[1]);

const GANCHO = `(() => {
  const m = globalThis.__e2e = {};
  const marca = (k) => { if (!m[k]) m[k] = Date.now(); };
  const { app, ipcMain } = require('electron');
  ipcMain.on('ui:listo', () => marca('uiListo'));
  ipcMain.on('splash:anda', () => marca('animacionEmpieza'));
  app.on('browser-window-created', (_e, w) => {
    const q = (m.n = (m.n || 0) + 1) === 1 ? 'splash' : 'ventana';
    w.once('show', () => marca(q + 'Visible'));
    if (q !== 'splash') return;
    w.webContents.once('did-finish-load', () => marca('splashCargada'));
    w.webContents.once('media-started-playing', () => marca('sonidoEmpieza'));
    w.webContents.once('media-paused', () => marca('sonidoTermina'));
    w.once('hide', () => marca('splashOculto'));
    w.once('closed', () => marca('splashCerrado'));
  });
  globalThis.__salir = () => app.quit();
  return 'ok';
})()`;

function sesion(url) {
  const ws = new WebSocket(url); let id = 0; const pend = new Map(); const oyentes = [];
  ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else for (const f of oyentes) f(d); };
  const envia = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  return new Promise((r) => { ws.onopen = () => r({ ws, envia, oyentes }); });
}

test('el splash arranca, suena y releva a la ventana sin esperas de más', { timeout: 60000 }, async () => {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-splash-'));
  const app = spawn(ELECTRON, ['--inspect-brk=' + PUERTO, RAIZ, '--user-data-dir=' + perfil.split('\\').join('/')], { stdio: 'ignore' });
  try {
    let url = null;
    for (let i = 0; i < 500 && !url; i++) { try { url = (await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json())[0].webSocketDebuggerUrl; } catch { await espera(20); } }
    assert.ok(url, 'el inspector no respondió');
    const s = await sesion(url);
    const pausas = []; let siguiente = null;
    s.oyentes.push((d) => { if (d.method !== 'Debugger.paused') return; if (siguiente) { siguiente(d.params); siguiente = null; } else pausas.push(d.params); });
    const pausa = () => pausas.length ? Promise.resolve(pausas.shift()) : new Promise((r) => { siguiente = r; });
    await s.envia('Runtime.enable'); await s.envia('Debugger.enable'); await s.envia('Runtime.runIfWaitingForDebugger');
    await pausa();   // default_app de Electron
    await s.envia('Debugger.setBreakpointByUrl', { urlRegex: 'src[\\\\/]main\\.js$', lineNumber: 0 });
    await s.envia('Debugger.resume');
    const p = await pausa();   // primera línea de src/main.js
    const g = await s.envia('Debugger.evaluateOnCallFrame', { callFrameId: p.callFrames[0].callFrameId, expression: GANCHO, returnByValue: true });
    assert.strictEqual(g.result.result.value, 'ok');
    await s.envia('Debugger.setBreakpointsActive', { active: false });
    await s.envia('Debugger.resume');
    let m = {};
    for (let i = 0; i < 300 && !(m.splashCerrado && m.sonidoTermina); i++) {
      await espera(50);
      const r = await s.envia('Runtime.evaluate', { expression: 'JSON.stringify(globalThis.__e2e)', returnByValue: true });
      m = JSON.parse(r.result.result.value || '{}');
    }
    await s.envia('Runtime.evaluate', { expression: 'globalThis.__salir()' });
    s.ws.close();
    console.log('marcas (ms desde que se ve el splash):', Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'n').map(([k, v]) => [k, v - m.splashVisible])));

    assert.ok(m.splashVisible >= m.splashCargada, 'el splash se mostró antes de tener contenido');
    assert.ok(m.uiListo && m.ventanaVisible, 'la ventana principal no llegó a mostrarse');
    assert.ok(m.animacionEmpieza && m.animacionEmpieza - m.splashVisible < 400, 'la animación del splash no arrancó');
    const debida = Math.max(m.uiListo, m.animacionEmpieza + MINIMO);
    assert.ok(m.ventanaVisible - debida < 250, `la ventana salió ${m.ventanaVisible - debida} ms tarde`);
    assert.ok(m.ventanaVisible >= m.animacionEmpieza + MINIMO - 20, 'la ventana cortó la animación del splash');
    assert.ok(m.sonidoEmpieza && m.sonidoEmpieza - m.splashVisible < 400, 'el sonido de arranque no empezó con el splash');
    assert.ok(m.sonidoTermina > m.splashOculto, 'el sonido se cortó al ocultar el splash');
    assert.ok(m.splashOculto && m.splashCerrado, 'el splash no se ocultó o no se cerró');
  } finally {
    await new Promise((r) => { if (app.exitCode !== null) return r(); app.once('exit', r); setTimeout(() => { try { app.kill(); } catch {} r(); }, 6000); });
    fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

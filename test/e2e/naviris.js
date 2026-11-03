// Arranca Naviris de verdad (Electron) con un perfil temporal y el puerto CDP de
// NAVIRIS_E2E_PUERTO (9405 por defecto) y habla con él por CDP, sin dependencias:
// el WebSocket de Node basta. Las páginas de prueba se sirven DESDE el propio CDP
// (Fetch.fulfillRequest) con la dirección del sitio real, así el preload las trata
// como x.com o twitch.tv sin salir a internet.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const PUERTO = Number(process.env.NAVIRIS_E2E_PUERTO) || 9405;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function lista() { return (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); }

async function hasta(fn, ms = 20000, cada = 250) {
  const t0 = Date.now();
  let ultimo;
  while (Date.now() - t0 < ms) {
    try { ultimo = await fn(); if (ultimo) return ultimo; } catch (e) { ultimo = e; }
    await espera(cada);
  }
  throw new Error('no llegó a tiempo' + (ultimo instanceof Error ? ': ' + ultimo.message : ''));
}

// Sesión CDP con un target (la interfaz o un webview)
async function conecta(urlWs) {
  const ws = new WebSocket(urlWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pend = new Map(), oyentes = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) for (const o of oyentes) o(m);
  };
  const envia = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalua = async (expr) => {
    const r = await envia('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  // Clic de verdad (eventos de ratón del navegador, isTrusted) en un punto
  const clic = async (x, y) => {
    await envia('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await envia('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await envia('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  return { envia, evalua, clic, en: (fn) => oyentes.push(fn), cierra: () => ws.close() };
}

async function arranca() {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-'));
  const proc = spawn(require('electron'), ['.', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`], { cwd: RAIZ, stdio: 'ignore' });
  const t = await hasta(async () => (await lista()).find((x) => x.type === 'page' && /index\.html/.test(x.url)), 40000);
  const ui = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => ui.evalua('typeof createTab === "function" && Array.isArray(tabs)'));

  // Abre una pestaña con la página de prueba servida en `url`. `rutas` es una lista
  // [patrón de URL, () => { cuerpo, tipo }]: todo lo que pida la página y case con
  // un patrón se contesta desde aquí.
  async function abre(url, rutas) {
    const antes = new Set((await lista()).map((x) => x.id));
    await ui.evalua('void createTab("about:blank")');
    const w = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id)));
    const web = await conecta(w.webSocketDebuggerUrl);
    await web.envia('Fetch.enable', { patterns: rutas.map(([patron]) => ({ urlPattern: patron })) });
    web.en((m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const ruta = rutas.find(([patron]) => new RegExp('^' + patron.replace(/[.?]/g, '\\$&').replace(/\*/g, '.*') + '$').test(m.params.request.url));
      const { cuerpo, tipo } = ruta[1](m.params.request.url);
      const datos = Buffer.from(cuerpo);
      web.envia('Fetch.fulfillRequest', {
        requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: tipo }, { name: 'Content-Length', value: String(datos.length) }],
        body: datos.toString('base64')
      }).catch(() => {});
    });
    await web.envia('Page.enable');
    await web.envia('Page.navigate', { url });
    await hasta(() => web.evalua(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`));
    return web;
  }

  async function cierra() {
    ui.cierra();
    try {
      const v = await (await fetch(`http://127.0.0.1:${PUERTO}/json/version`)).json();
      const b = await conecta(v.webSocketDebuggerUrl);
      b.envia('Browser.close').catch(() => {});
      await espera(1500);
      b.cierra();
    } catch { /* ya cerrada */ }
    if (proc.exitCode === null) proc.kill();
    await espera(500);
    fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  return { ui, abre, cierra };
}

module.exports = { arranca, hasta, espera, RAIZ };

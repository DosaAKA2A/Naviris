// Arranque de Naviris de verdad (Electron del repo) con perfil propio y puerto
// CDP, y un cliente CDP mínimo para manejar la interfaz y las pestañas.
// Sin dependencias: Node 22+ trae WebSocket y fetch.
//
// Variables de entorno:
//   NAVIRIS_E2E_DIR     carpeta de trabajo (perfiles, capturas, registros).
//                       Por defecto <tmp>/naviris-e2e. Nunca dentro del repo.
//   NAVIRIS_E2E_PORT    puerto CDP (por defecto 9403).
//   NAVIRIS_E2E_LISTAS  carpeta con brave-rules*.txt + meta.json para sembrar
//                       el perfil y no esperar a la descarga de las listas.
//   NAVIRIS_E2E_APP     carpeta de la app a probar (por defecto este repo); sirve
//                       para medir el antes con una copia del código anterior.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = process.env.NAVIRIS_E2E_APP || path.join(__dirname, '..', '..');
const DIR = process.env.NAVIRIS_E2E_DIR || path.join(os.tmpdir(), 'naviris-e2e');
const PUERTO = Number(process.env.NAVIRIS_E2E_PORT || 9403);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Cliente CDP (modo plano: una conexión, varias sesiones) ---------- */
class CDP {
  static async conecta(wsUrl) {
    const c = new CDP();
    c.ws = new WebSocket(wsUrl);
    c.id = 0; c.pend = new Map(); c.oyentes = [];
    c.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && c.pend.has(d.id)) { const p = c.pend.get(d.id); c.pend.delete(d.id); d.error ? p.no(new Error(d.error.message + ' (' + p.metodo + ')')) : p.si(d.result); return; }
      if (d.method) for (const o of c.oyentes) o(d);
    };
    // Si la conexión se cae (Naviris cerrado, pestaña cerrada), lo pendiente
    // falla en vez de quedarse esperando para siempre.
    c.ws.onclose = () => { for (const p of c.pend.values()) p.no(new Error('conexión CDP cerrada (' + p.metodo + ')')); c.pend.clear(); };
    await new Promise((si, no) => { c.ws.onopen = si; c.ws.onerror = () => no(new Error('no conecta ' + wsUrl)); });
    return c;
  }
  // Con tope: un diálogo modal de Naviris (p. ej. "¿Salir de la página?")
  // bloquea el proceso principal y la respuesta no llegaría nunca.
  envia(metodo, params = {}, sessionId, topeMs = 60000) {
    const id = ++this.id;
    return new Promise((si, no) => {
      const t = setTimeout(() => { this.pend.delete(id); no(new Error('sin respuesta CDP en ' + topeMs + ' ms (' + metodo + ')')); }, topeMs);
      this.pend.set(id, { si: (v) => { clearTimeout(t); si(v); }, no: (e) => { clearTimeout(t); no(e); }, metodo });
      this.ws.send(JSON.stringify(sessionId ? { id, method: metodo, params, sessionId } : { id, method: metodo, params }));
    });
  }
  on(fn) { this.oyentes.push(fn); return () => { this.oyentes = this.oyentes.filter((x) => x !== fn); }; }
  cierra() { try { this.ws.close(); } catch { /* nada */ } }
}

// Evalúa una expresión (puede llevar await) y devuelve su valor.
async function evalua(cdp, expr, sessionId) {
  const r = await cdp.envia('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
  if (r.exceptionDetails) throw new Error('Excepción en la página: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

async function hasta(fn, { tope = 30000, cada = 250, que = 'condición' } = {}) {
  const fin = Date.now() + tope;
  let ultimo;
  while (Date.now() < fin) {
    try { ultimo = await fn(); if (ultimo) return ultimo; } catch (e) { ultimo = e; }
    await espera(cada);
  }
  throw new Error('Tiempo agotado esperando ' + que + (ultimo instanceof Error ? ': ' + ultimo.message : ''));
}

/* ---------- Perfil y arranque ---------- */
function preparaPerfil(nombre, ajustes = {}) {
  const perfil = path.join(DIR, 'perfiles', nombre);
  fs.rmSync(perfil, { recursive: true, force: true });
  fs.mkdirSync(perfil, { recursive: true });
  const version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  const base = {
    adblockEnabled: true, adblockWhitelist: [], agentMode: false, updatesAuto: false,
    restoreSession: false, appVersion: version, versionVista: version, devUpdates: false
  };
  fs.writeFileSync(path.join(perfil, 'naviris-settings.json'), JSON.stringify({ ...base, ...ajustes }, null, 2), 'utf8');
  const listas = process.env.NAVIRIS_E2E_LISTAS;
  if (listas && fs.existsSync(path.join(listas, 'meta.json'))) {
    const destino = path.join(perfil, 'adblock');
    fs.mkdirSync(destino, { recursive: true });
    for (const f of fs.readdirSync(listas)) if (/^(brave-rules.*\.txt|meta\.json)$/.test(f)) fs.copyFileSync(path.join(listas, f), path.join(destino, f));
  }
  return perfil;
}

async function arranca(nombre, ajustes) {
  const perfil = preparaPerfil(nombre, ajustes);
  const exe = path.join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  fs.mkdirSync(path.join(DIR, 'registros'), { recursive: true });
  const log = fs.openSync(path.join(DIR, 'registros', nombre + '.log'), 'w');
  const proc = spawn(exe, ['.', '--user-data-dir=' + perfil, '--remote-debugging-port=' + PUERTO], { cwd: REPO, stdio: ['ignore', log, log], windowsHide: false });
  const app = { proc, perfil, nombre, log: path.join(DIR, 'registros', nombre + '.log') };
  const version = await hasta(async () => (await fetch(`http://127.0.0.1:${PUERTO}/json/version`)).json(), { tope: 30000, que: 'el puerto CDP de Naviris' });
  app.navegador = await CDP.conecta(version.webSocketDebuggerUrl);
  const ui = await hasta(async () => (await lista()).find((t) => t.type === 'page' && /index\.html/.test(t.url) && !/private=1/.test(t.url)), { que: 'la ventana de Naviris' });
  app.ui = await CDP.conecta(ui.webSocketDebuggerUrl);
  await hasta(() => evalua(app.ui, 'return typeof createTab === "function" && !!window.navirisApp;'), { que: 'la interfaz' });
  return app;
}

async function lista() { return (await fetch(`http://127.0.0.1:${PUERTO}/json/list`, { signal: AbortSignal.timeout(10000) })).json(); }

// Motor del bloqueador montado (con listas). Con listas sembradas tarda ~1 s.
async function esperaMotor(app, tope = 120000) {
  return hasta(async () => (await evalua(app.ui, 'return (await window.navirisApp.adblockGet()).brave.engine;')), { tope, cada: 1000, que: 'el motor del bloqueador' });
}

async function cierra(app) {
  if (!app) return;
  try { await app.navegador.envia('Browser.close', {}, undefined, 5000); } catch { /* ya cerrado o bloqueado */ }
  const fin = Date.now() + 8000;
  while (app.proc.exitCode === null && Date.now() < fin) await espera(200);
  // Solo este proceso (su PID), nunca por nombre: Dosa puede tener su Naviris abierto.
  if (app.proc.exitCode === null) { try { process.kill(app.proc.pid); } catch { /* nada */ } }
  app.navegador?.cierra(); app.ui?.cierra();
}

/* ---------- Pestañas ---------- */
// Abre una pestaña nueva y devuelve su sesión CDP (target webview). La pestaña
// nace en about:blank y se navega a la URL con la red ya escuchada, para no
// perder las primeras peticiones del documento.
async function abrePestana(app, url, { tope = 45000 } = {}) {
  const antes = new Set((await lista()).filter((t) => t.type === 'webview').map((t) => t.id));
  const tabId = await evalua(app.ui, 'return createTab("about:blank", true).id;');
  const t = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id)), { tope, que: 'el webview de ' + url });
  const cdp = await CDP.conecta(t.webSocketDebuggerUrl);
  const pestana = { cdp, tabId, targetId: t.id, eventos: [], app };
  cdp.on((d) => pestana.eventos.push(d));
  await cdp.envia('Page.enable');
  await cdp.envia('Runtime.enable');
  await cdp.envia('Network.enable');
  if (url) await navega(pestana, url);
  return pestana;
}

async function navega(p, url) {
  await p.cdp.envia('Page.navigate', { url });
}

// Iframes de otro sitio (procesos aparte): se engancha a ellos y devuelve
// [{ url, sesion }] para evaluar dentro con evalua(p.cdp, expr, sesion).
async function marcos(p) {
  if (!p.marcos) {
    p.marcos = new Map();
    p.cdp.on((d) => {
      if (d.method === 'Target.attachedToTarget' && d.params.targetInfo.type === 'iframe') p.marcos.set(d.params.sessionId, d.params.targetInfo);
      if (d.method === 'Target.detachedFromTarget') p.marcos.delete(d.params.sessionId);
      if (d.method === 'Target.targetInfoChanged') for (const [s, t] of p.marcos) if (t.targetId === d.params.targetInfo.targetId) p.marcos.set(s, d.params.targetInfo);
    });
    await p.cdp.envia('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await espera(500);
  }
  return [...p.marcos].map(([sesion, t]) => ({ url: t.url, sesion }));
}

// Tiempo de CPU del hilo principal de la página (s), según Chromium.
async function cpuPagina(p) {
  if (!p.metricas) { await p.cdp.envia('Performance.enable', { timeDomain: 'threadTicks' }); p.metricas = true; }
  const r = await p.cdp.envia('Performance.getMetrics');
  const m = Object.fromEntries(r.metrics.map((x) => [x.name, x.value]));
  return { tarea: m.TaskDuration, script: m.ScriptDuration, estilo: m.RecalcStyleDuration, layout: m.LayoutDuration };
}

async function cierraPestana(app, p) {
  if (!p) return;
  p.cdp.cierra();
  await evalua(app.ui, `const t = tabs.find((x) => x.id === ${p.tabId}); if (t) closeTab(t.id); return true;`).catch(() => {});
}

const enPestana = (p, expr) => evalua(p.cdp, expr);

// Clic de verdad (eventos de entrada confiables) en el centro del elemento.
async function clic(p, selector) {
  const r = await enPestana(p, `const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block: 'center'}); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };`);
  if (!r) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await p.cdp.envia('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  }
  return true;
}

// El aviso de cookies de YouTube (sale en la UE sin sesión): se rechaza a mano,
// como lo haría la persona. Mientras está, el reproductor se queda en pausa.
// Devuelve true si había aviso y se rechazó (YouTube recarga la página después).
const RECHAZAR_YT = 'button[aria-label^="Rechazar el uso de cookies"], button[aria-label^="Reject the use of cookies"]';
const visibleYT = `const b = [...document.querySelectorAll(${JSON.stringify(RECHAZAR_YT)})].find((x) => x.offsetParent);`;
async function quitaAvisoCookiesYT(p, tope = 15000) {
  const hay = await hasta(() => enPestana(p, visibleYT + ' return !!b;'), { tope, que: 'el aviso de cookies' }).catch(() => false);
  if (!hay) return false;
  // El botón suele quedar fuera de la ventana (diálogo con su propio scroll):
  // el clic del DOM es lo mismo que haría la persona al pulsarlo.
  await enPestana(p, visibleYT + ' if (b) b.click(); return true;');
  await hasta(() => enPestana(p, visibleYT + ' return !b && document.readyState === "complete";'), { tope: 20000, que: 'que se vaya el aviso de cookies' });
  await espera(1500);
  return true;
}

async function captura(p, nombre) {
  fs.mkdirSync(path.join(DIR, 'capturas'), { recursive: true });
  const archivo = path.join(DIR, 'capturas', nombre + '.png');
  try {
    const r = await p.cdp.envia('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(archivo, Buffer.from(r.data, 'base64'));
  } catch (e) { return null; }
  return archivo;
}

// Peticiones que vio la pestaña: bloqueadas (ERR_BLOCKED_BY_CLIENT) y las
// servidas por un sustituto (redirección a naviris-sustituto://).
function red(p) {
  const pedidas = new Map();
  const bloqueadas = [], sustituidas = [];
  for (const d of p.eventos) {
    if (d.method === 'Network.requestWillBeSent') {
      pedidas.set(d.params.requestId, d.params.request.url);
      if (d.params.redirectResponse && /^naviris-sustituto:/.test(d.params.request.url)) sustituidas.push(d.params.redirectResponse.url);
    }
    if (d.method === 'Network.loadingFailed' && /BLOCKED_BY_CLIENT/.test(d.params.errorText || '')) bloqueadas.push(pedidas.get(d.params.requestId) || '?');
  }
  return { pedidas: [...pedidas.values()], bloqueadas, sustituidas };
}

// Documentos que cargó el marco principal de la pestaña (para contar recargas).
function documentos(p) {
  return p.eventos.filter((d) => d.method === 'Page.frameNavigated' && !d.params.frame.parentId).map((d) => d.params.frame.url);
}

module.exports = { CDP, evalua, hasta, espera, arranca, cierra, esperaMotor, abrePestana, navega, marcos, cpuPagina, cierraPestana, enPestana, clic, quitaAvisoCookiesYT, captura, red, documentos, DIR, PUERTO, REPO };

// Utilidades comunes del benchmark: lanzar cada navegador con perfil propio, hablar CDP a pelo
// (WebSocket de Node), abrir pestañas igual en todos y medir el árbol de procesos.
//
// Rutas, todas con variable de entorno y un valor por defecto:
//   NAVIRIS_BENCH_TRABAJO  carpeta de perfiles, semillas, medidas y registros (por defecto benchmark/trabajo)
//   NAVIRIS_REPO           código de Naviris que se mide con su Electron (por defecto, la raíz de este repo)
//   NAVIRIS_EXE            un Naviris.exe instalado o portable; si está, se mide ese en vez del código
//   CHROME_EXE, BRAVE_EXE, EDGE_EXE  ejecutables de cada navegador
//
// Puertos CDP: Naviris y el control 9422, Chrome 9442, Brave 9452, Edge 9472. Servidor local del arranque 9462.
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const barras = (p) => p.replace(/\\/g, '/');
export const SCRIPTS = barras(AQUI);
export const TRABAJO = barras(process.env.NAVIRIS_BENCH_TRABAJO || path.join(AQUI, 'trabajo'));
export const REPO = barras(process.env.NAVIRIS_REPO || path.join(AQUI, '..'));
for (const d of ['perfiles', 'semillas', 'medidas', 'medidas/procesos', 'logs']) fs.mkdirSync(`${TRABAJO}/${d}`, { recursive: true });

export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const PF = barras(process.env.ProgramFiles || 'C:/Program Files');
const PF86 = barras(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)');
const LOCAL = barras(process.env.LOCALAPPDATA || '');
// El primero que exista; si no hay ninguno, el primero (el error saldrá al lanzar, con la ruta a la vista).
const primero = (...rutas) => rutas.find((r) => r && fs.existsSync(r)) || rutas[0];

// Mismas condiciones para todos los Chromium de fuera: sin primera ejecución, sin extensiones, ventana de
// 1280×800 como la de Naviris, autoplay sin gesto (Naviris lo trae de serie) y sin cálculo de oclusión de
// ventanas (Naviris tampoco lo hace; así, si algo tapa la ventana, ninguno deja de pintar).
const COMUNES = ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-search-engine-choice-screen',
  '--window-size=1280,800', '--window-position=40,40', '--autoplay-policy=no-user-gesture-required', '--disable-features=CalculateNativeWinOcclusion'];

const navirisExe = process.env.NAVIRIS_EXE ? barras(process.env.NAVIRIS_EXE) : `${REPO}/node_modules/electron/dist/electron.exe`;
const navirisPre = process.env.NAVIRIS_EXE ? [] : [REPO];

// tipo: 'naviris' (interfaz propia con <webview>), 'electron' (una ventana que se navega) o 'chromium'.
// Firefox no está: ya no habla CDP y necesitaría WebDriver BiDi. Va aparte cuando se mida.
export const NAVS = {
  naviris: { tipo: 'naviris', exe: navirisExe, pre: navirisPre, puerto: 9422, args: [] },
  chrome: { tipo: 'chromium', exe: barras(process.env.CHROME_EXE || primero(`${PF}/Google/Chrome/Application/chrome.exe`, `${LOCAL}/Google/Chrome/Application/chrome.exe`)), pre: [], puerto: 9442, args: COMUNES, nueva: 'chrome://newtab/' },
  brave: { tipo: 'chromium', exe: barras(process.env.BRAVE_EXE || primero(`${PF}/BraveSoftware/Brave-Browser/Application/brave.exe`, `${LOCAL}/BraveSoftware/Brave-Browser/Application/brave.exe`)), pre: [], puerto: 9452, args: COMUNES, nueva: 'brave://newtab/' },
  edge: { tipo: 'chromium', exe: barras(process.env.EDGE_EXE || primero(`${PF86}/Microsoft/Edge/Application/msedge.exe`, `${PF}/Microsoft/Edge/Application/msedge.exe`)), pre: [], puerto: 9472, args: COMUNES, nueva: 'edge://newtab/' },
  // Control: el mismo Electron de Naviris sin nada de Naviris (electron-solo/), para separar lo que es de
  // Naviris de lo que es de Electron y Chromium.
  electron: { tipo: 'electron', exe: `${REPO}/node_modules/electron/dist/electron.exe`, pre: [`${SCRIPTS}/electron-solo`], puerto: 9422, args: [] }
};
// Variantes: «naviris-sin» es Naviris con el bloqueador apagado (misma semilla, adblockEnabled: false).
export const familia = (cual) => cual.split('-')[0];
export function config(cual) {
  const n = NAVS[familia(cual)];
  if (!n) throw new Error(`navegador desconocido: ${cual} (hay ${Object.keys(NAVS).join(', ')})`);
  return { ...n, fam: familia(cual) };
}

export class Sesion {
  constructor(url) { this.url = url; this.id = 0; this.pend = new Map(); this.oyentes = []; }
  abre() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => res(this);
      this.ws.onerror = () => rej(new Error('ws ' + this.url));
      this.ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id && this.pend.has(d.id)) { const p = this.pend.get(d.id); this.pend.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
        else if (d.method) for (const f of this.oyentes) f(d);
      };
      this.ws.onclose = () => { for (const p of this.pend.values()) p.rej(new Error('cerrado')); this.pend.clear(); };
    });
  }
  envia(method, params = {}, sessionId) {
    return new Promise((res, rej) => {
      const id = ++this.id; this.pend.set(id, { res, rej });
      const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
      try { this.ws.send(JSON.stringify(msg)); } catch (e) { this.pend.delete(id); rej(e); }
    });
  }
  async ev(expr, ms = 0) {
    const p = this.envia('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    const r = await (ms ? Promise.race([p, espera(ms).then(() => { throw new Error('evaluate sin respuesta'); })]) : p);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  cierra() { try { this.ws.close(); } catch {} }
}

export async function hasta(fn, ms = 30000, cada = 200) {
  const t0 = Date.now(); let ult;
  while (Date.now() - t0 < ms) { try { ult = await fn(); if (ult) return ult; } catch (e) { ult = e; } await espera(cada); }
  throw new Error('no llegó a tiempo' + (ult instanceof Error ? ': ' + ult.message : ''));
}

export function copiaPerfil(origen, destino) {
  if (!fs.existsSync(origen)) throw new Error(`no hay semilla en ${origen}: corre antes semillas.mjs`);
  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(origen, destino, { recursive: true, verbatimSymlinks: true });
}
export async function borraPerfil(dir) {
  for (let i = 0; i < 10; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await espera(500); } }
}

// Lanza un navegador con su perfil y su puerto CDP. Apunta el PID en pids.txt.
export function lanza(cual, perfil, { extra = [], log, urls = [] } = {}) {
  const n = config(cual);
  const args = [...n.pre, `--user-data-dir=${perfil}`, `--remote-debugging-port=${n.puerto}`, ...n.args, ...extra, ...urls];
  const salida = log ? fs.openSync(log, 'a') : 'ignore';
  const proc = spawn(n.exe, args, { stdio: ['ignore', salida, salida], cwd: n.pre[0] || undefined });
  fs.appendFileSync(`${TRABAJO}/pids.txt`, `${proc.pid} ${cual} ${new Date().toISOString()}\n`);
  return { cual, fam: n.fam, tipo: n.tipo, nueva: n.nueva, proc, pid: proc.pid, puerto: n.puerto, t0: Date.now() };
}

export const lista = async (b) => (await fetch(`http://127.0.0.1:${b.puerto}/json/list`)).json();
export async function navegador(b) {
  const v = await hasta(async () => (await fetch(`http://127.0.0.1:${b.puerto}/json/version`)).json(), 40000);
  return new Sesion(v.webSocketDebuggerUrl).abre();
}

// Interfaz de Naviris (index.html de la ventana principal).
export const esUI = (t) => t.type === 'page' && /index\.html/.test(t.url) && !/private=1|sacada=1/.test(t.url);
export async function conectaUI(b) {
  const t = await hasta(async () => (await lista(b)).find(esUI), 40000);
  const s = await new Sesion(t.webSocketDebuggerUrl).abre();
  await hasta(() => s.ev('typeof createTab === "function" && Array.isArray(tabs) && tabs.length > 0'), 30000);
  return s;
}

// Prepara la instancia: conexión al navegador y, en Naviris, a su interfaz. Espera la página de inicio.
export async function prepara(b) {
  b.nav = await navegador(b);
  if (b.tipo === 'naviris') b.ui = await conectaUI(b);
  else {
    const ini = await hasta(async () => (await lista(b)).find((t) => t.type === 'page'), 30000);
    b.inicio = ini.id;
  }
  return b;
}

/* Abre una pestaña en primer plano con `url` y devuelve { id, s } (s = sesión CDP con la página).
   Naviris: como lo hace la persona, createTab() de la interfaz; la página es un <webview>.
   Chromium: Target.createTarget, que también la pone delante. Control: navega su única ventana. */
export async function abrePestana(b, url) {
  if (b.tipo === 'naviris') {
    const antes = new Set((await lista(b)).filter((t) => t.type === 'webview').map((t) => t.id));
    const id = await b.ui.ev(`createTab(${JSON.stringify(url)}).id`);
    // Los widgets del hub también montan <webview> ocultos: vale el nuevo cuyo dominio es el pedido
    // (o, pasados 5 s, cualquiera nuevo, por si el sitio redirige a otro dominio).
    const base = new URL(url).hostname.replace(/^www\./, ''), t1 = Date.now();
    const t = await hasta(async () => (await lista(b)).find((x) => x.type === 'webview' && !antes.has(x.id) && x.webSocketDebuggerUrl &&
      (Date.now() - t1 > 5000 || (() => { try { return new URL(x.url).hostname.endsWith(base); } catch { return false; } })())), 30000, 100);
    return { id, s: await new Sesion(t.webSocketDebuggerUrl).abre() };
  }
  if (b.tipo === 'electron') {
    const t = (await lista(b)).find((x) => x.id === b.inicio);
    const s = await new Sesion(t.webSocketDebuggerUrl).abre();
    await s.envia('Page.navigate', { url });
    await espera(300);
    return { id: b.inicio, s };
  }
  const { targetId } = await b.nav.envia('Target.createTarget', { url, background: false });
  const t = await hasta(async () => (await lista(b)).find((x) => x.id === targetId && x.webSocketDebuggerUrl), 30000, 100);
  return { id: targetId, s: await new Sesion(t.webSocketDebuggerUrl).abre() };
}
export async function cierraPestana(b, p) {
  try { p.s.cierra(); } catch {}
  if (b.tipo === 'naviris') await b.ui.ev(`closeTab(${p.id}), true`);
  else if (b.tipo === 'electron') { const s = await new Sesion((await lista(b)).find((x) => x.id === b.inicio).webSocketDebuggerUrl).abre(); await s.envia('Page.navigate', { url: 'about:blank' }); s.cierra(); }
  else await b.nav.envia('Target.closeTarget', { targetId: p.id }).catch(() => {});
}
// Todo al fondo: la página de inicio delante (el hub en Naviris, la de nueva pestaña en los demás).
export async function inicioDelante(b) {
  if (b.tipo === 'naviris') return b.ui.ev(`(() => { const h = tabs.find((t) => t.kind === 'hub') || createTab(); activateTab(h.id); return activeTab().kind; })()`);
  const ini = (await lista(b)).find((t) => t.id === b.inicio);
  if (ini) { await b.nav.envia('Target.activateTarget', { targetId: b.inicio }); return ini.url; }
  const { targetId } = await b.nav.envia('Target.createTarget', { url: b.nueva || 'about:blank' });
  b.inicio = targetId; return 'nueva';
}

const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// Cierre ordenado por CDP; si a los 20 s sigue vivo, por PID y su árbol (nunca por nombre de proceso).
export async function cierraPid(pid, puerto) {
  try {
    const v = await hasta(async () => (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json(), 5000);
    const s = await new Sesion(v.webSocketDebuggerUrl).abre(); s.envia('Browser.close').catch(() => {}); await espera(300); s.cierra();
  } catch {}
  for (let i = 0; i < 80 && vivo(pid); i++) await espera(250);
  const forzado = vivo(pid);
  if (forzado) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  return forzado;
}
export async function cierra(b) {
  const t = Date.now();
  try { b.ui?.cierra(); } catch {}
  try { b.nav?.cierra(); } catch {}
  const forzado = await cierraPid(b.pid, b.puerto);
  // Algunos Chromium dejan algún hijo vivo unos segundos (crashpad): se espera a que acabe el árbol.
  await espera(1500);
  const o = { ms: Date.now() - t, forzado, codigo: b.proc.exitCode };
  fs.appendFileSync(`${TRABAJO}/logs/cierres.jsonl`, JSON.stringify({ pid: b.pid, cual: b.cual, ...o }) + '\n');
  return o;
}

const ps = (archivo, args, opciones) => ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${SCRIPTS}/ps/${archivo}`, ...args], opciones];

// Árbol de procesos con memoria y CPU en una ventana de N segundos (ps/procesos.ps1).
export function procesos(pid, segundos, guarda) {
  return new Promise((res) => {
    const p = spawn(...ps('procesos.ps1', ['-RootPid', String(pid), '-Segundos', String(segundos)]));
    let o = ''; p.stdout.on('data', (d) => { o += d; });
    p.on('exit', () => {
      if (guarda) fs.writeFileSync(guarda, o);
      const l = o.split(/\r?\n/).find((x) => x.startsWith('JSON '));
      res(l ? JSON.parse(l.slice(5)) : { error: o.slice(-300) });
    });
  });
}
// Lanza el ejecutable y mide cuándo enseña su primera ventana grande (ps/ventana-visible.ps1).
export function ventanaVisible(exe, fArgs, cwd) {
  return new Promise((res) => {
    const p = spawn(...ps('ventana-visible.ps1', ['-Exe', exe, '-ArgsFile', fArgs], { cwd }));
    let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; });
    p.on('exit', () => res(JSON.parse(o.trim().split(/\r?\n/).pop())));
  });
}
// Carga de CPU del resto del equipo durante la medida (ruido), para saber con qué se midió.
export function ruido(seg = 2) {
  try { return execFileSync(...ps('ruido.ps1', ['-Segundos', String(seg)], { encoding: 'utf8' })).trim().split(/\r?\n/).slice(0, 7); }
  catch (e) { return [String(e).slice(0, 100)]; }
}
export function memoriaLibreMB() {
  try { return Number(execFileSync('powershell', ['-NoProfile', '-Command', '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB)'], { encoding: 'utf8' }).trim()); } catch { return null; }
}

// Orden rotado en cada repetición, para repartir el ruido del equipo entre navegadores.
export const orden = (cuales, rep) => cuales.map((_, i) => cuales[(i + rep - 1) % cuales.length]);
// Argumentos comunes: <repeticiones> [etiqueta] [navs separados por coma]
export function argumentos(repsPorDefecto, navsPorDefecto) {
  const [reps, etq, navs] = process.argv.slice(2);
  return { REPS: Number(reps || repsPorDefecto), ETQ: etq || 'medida', CUALES: (navs || navsPorDefecto).split(',') };
}

export const guardaJSON = (ruta, o) => fs.writeFileSync(ruta, JSON.stringify(o, null, 1));
export const leeJSON = (ruta, d = null) => { try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { return d; } };
export const log = (...a) => { const l = `[${new Date().toISOString().slice(11, 19)}] ` + a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(l); fs.appendFileSync(`${TRABAJO}/logs/registro.log`, l + '\n'); };

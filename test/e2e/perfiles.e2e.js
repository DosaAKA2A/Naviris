// Pruebas con la app real (Electron + CDP): ventanas emergentes con opener,
// aviso de beforeunload que no congela el proceso principal y cookies
// particionadas que no se convierten al cerrar.
// Se ejecuta con: npm run test:e2e  (puerto CDP: NAVIRIS_E2E_PORT, 9404 por defecto)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const electron = require('electron');

const PUERTO = Number(process.env.NAVIRIS_E2E_PORT || 9404);
const RAIZ = path.join(__dirname, '..', '..');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Servidor de páginas de prueba (127.0.0.1 y localhost: dos sitios) ----------
const html = (cuerpo) => `<!doctype html><meta charset="utf-8"><body>${cuerpo}</body>`;
let WEB = 0;
const paginas = {
  '/': () => html('<h1>inicio</h1>'),
  '/bu': () => html('<h1>beforeunload</h1><script>addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; });</script>'),
  '/popup': () => html(`<button id="b">entrar</button><pre id="r">esperando</pre><script>
    addEventListener('message', (e) => { if (e.data && e.data.login) document.getElementById('r').textContent = 'ok:' + e.data.login; });
    document.getElementById('b').onclick = () => { const w = window.open('http://localhost:${WEB}/hijo', 'login', 'width=480,height=600'); if (!w) document.getElementById('r').textContent = 'null'; };
  </script>`),
  '/hijo': () => html(`<script>if (window.opener) { window.opener.postMessage({ login: 'token' }, '*'); setTimeout(() => window.close(), 200); }</script>`),
  '/chips-top': (res) => { res.setHeader('Set-Cookie', 'prop_ses=1; Path=/'); return html(`<iframe src="http://localhost:${WEB}/chips-frame"></iframe>`); },
  '/chips-frame': (res) => { res.setHeader('Set-Cookie', 'chips_ses=1; Secure; SameSite=None; Partitioned; Path=/'); return html('frame'); },
  '/ver-cookies': (_res, req) => html('<pre id="c">' + (req.headers.cookie || '') + '</pre>')
};
const atiende = (req, res) => {
  const f = paginas[new URL(req.url, 'http://x').pathname];
  if (!f) { res.writeHead(404); return res.end(); }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(f(res, req));
};
const servidores = [];
async function arrancaServidor() {
  const a = http.createServer(atiende);
  await new Promise((r) => a.listen(0, '127.0.0.1', r));
  WEB = a.address().port;
  servidores.push(a);
  // localhost puede resolverse a ::1: mismo puerto también ahí (si hay IPv6)
  const b = http.createServer(atiende);
  await new Promise((r) => { b.once('error', r); b.listen(WEB, '::1', r); });
  servidores.push(b);
}

// ---------- CDP mínimo ----------
async function conecta(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, ev, cierra: () => ws.close() };
}
const lista = async () => (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
async function hasta(f, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await f(); if (v) return v; } catch { /* aún no */ } await espera(150); }
  throw new Error('tiempo agotado');
}

// ---------- La app ----------
async function abreNaviris(perfil) {
  const proc = spawn(electron, [RAIZ, '--user-data-dir=' + perfil, '--remote-debugging-port=' + PUERTO], { stdio: 'ignore' });
  const t = await hasta(async () => (await lista()).find((x) => x.type === 'page' && /index\.html/.test(x.url)), 30000);
  const ui = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => ui.ev(`typeof createTab === 'function' && typeof window.cobalt === 'object'`));
  await espera(1500);
  return { proc, ui };
}
async function cierraNaviris({ proc, ui }) {
  // Cierre normal (botón de la ventana): pasa por el before-quit
  await ui.ev('window.cobalt.close(), 1').catch(() => {});
  ui.cierra();
  await Promise.race([new Promise((r) => proc.once('exit', r)), espera(15000)]);
  if (proc.exitCode === null) proc.kill();
}
async function pestana(app, url) {
  const antes = new Set((await lista()).filter((x) => x.type === 'webview').map((x) => x.id));
  await app.ui.ev(`createTab(${JSON.stringify(url)}), 1`);
  const t = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id)));
  const c = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => c.ev(`document.readyState === 'complete' && location.href.startsWith('http')`));
  return c;
}
async function clic(c, sel) {
  const [x, y] = await c.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}
// Pulsa el primer botón del aviso nativo (TaskDialog) del proceso, sin robar el foco.
function pulsaAviso(pid) {
  const ps = `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'
$A = [System.Windows.Automation.AutomationElement]; $C = [System.Windows.Automation.PropertyCondition]; $n = 0
foreach ($w in $A::RootElement.FindAll('Children', (New-Object $C ($A::ProcessIdProperty, ${pid})))) {
  foreach ($d in @($w) + @($w.FindAll('Children', (New-Object $C ($A::ClassNameProperty, '#32770'))))) {
    if ($d.Current.ClassName -eq '#32770') { [void][W]::PostMessage([IntPtr]$d.Current.NativeWindowHandle, 0x466, [IntPtr]100, [IntPtr]::Zero); $n++ } } }
$n`;
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps]).toString().trim());
}

const perfiles = [];
const perfilNuevo = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-perfiles-')); perfiles.push(p); return p; };

test.before(arrancaServidor);
test.after(() => {
  for (const s of servidores) s.close();
  for (const p of perfiles) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* algún proceso aún suelta archivos */ } }
});

test('window.open con tamaño abre ventana con opener: el login en ventanita contesta', async () => {
  const app = await abreNaviris(perfilNuevo());
  try {
    const c = await pestana(app, `http://127.0.0.1:${WEB}/popup`);
    await clic(c, '#b');
    const r = await hasta(async () => { const t = await c.ev(`document.getElementById('r').textContent`); return t !== 'esperando' && t; });
    assert.equal(r, 'ok:token');
    c.cierra();
  } finally { await cierraNaviris(app); }
});

test('el aviso de beforeunload no congela el proceso principal y al aceptar recarga', { skip: process.platform !== 'win32' }, async () => {
  const app = await abreNaviris(perfilNuevo());
  try {
    const otra = await pestana(app, `http://127.0.0.1:${WEB}/`);
    const c = await pestana(app, `http://127.0.0.1:${WEB}/bu`);
    await clic(c, 'h1');   // sin gesto del usuario la web no puede pedir el aviso
    const origen = await c.ev('performance.timeOrigin');
    app.ui.ev(`tabs.find((t) => t.webview && t.webview.getURL().endsWith('/bu')).webview.reload(), 1`).catch(() => {});
    await espera(1500);
    // Con el aviso abierto, la interfaz y la red de otra pestaña siguen respondiendo
    const ipc = await Promise.race([app.ui.ev(`window.cobalt.version().then(() => 'ok')`), espera(3000).then(() => 'colgado')]);
    assert.equal(ipc, 'ok');
    const red = await Promise.race([otra.ev(`fetch('/?' + Math.random()).then((r) => r.status)`), espera(3000).then(() => 'colgado')]);
    assert.equal(red, 200);
    assert.equal(await c.ev('performance.timeOrigin'), origen, 'mientras no se contesta, la página sigue');
    // «Salir de la página»: la recarga se repite y esta vez pasa
    assert.equal(pulsaAviso(app.proc.pid), 1);
    await hasta(async () => (await c.ev('performance.timeOrigin')) !== origen);
    c.cierra(); otra.cierra();
  } finally { await cierraNaviris(app); }
});

test('al cerrar, una cookie particionada de un iframe no pasa a ser cookie normal de su sitio', async () => {
  const perfil = perfilNuevo();
  let app = await abreNaviris(perfil);
  try {
    const c = await pestana(app, `http://127.0.0.1:${WEB}/chips-top`);
    await espera(1000);
    c.cierra();
  } finally { await cierraNaviris(app); }
  app = await abreNaviris(perfil);
  try {
    const propia = await pestana(app, `http://127.0.0.1:${WEB}/ver-cookies`);
    assert.match(await propia.ev(`document.getElementById('c').textContent`), /prop_ses=1/, 'la cookie de sesión propia se conserva');
    const iframe = await pestana(app, `http://localhost:${WEB}/ver-cookies`);
    assert.doesNotMatch(await iframe.ev(`document.getElementById('c').textContent`), /chips_ses/, 'la del iframe no aparece como cookie de localhost');
    propia.cierra(); iframe.cierra();
  } finally { await cierraNaviris(app); }
});

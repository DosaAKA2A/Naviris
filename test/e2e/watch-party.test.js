/* Watch Party de punta a punta: dos Naviris reales (perfiles y puertos CDP
   propios), el addon del repo cargado en la interfaz, el relay de producción
   y un video de YouTube. Comprueba que la sala se crea, que el invitado entra
   desde el hub y aterriza en el video del anfitrión, y que play, pausa y
   salto se sincronizan en los dos sentidos.

   npm run test:e2e
   Variables: WP_E2E_PUERTOS (por defecto "9402,9412"), WP_E2E_DIR (carpeta
   de los perfiles temporales; por defecto la temporal del sistema). Hace
   falta red: YouTube y wss://naviris-party.studio-iris2026.workers.dev.
   Sin dependencias: CDP con el WebSocket de Node 22+. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const ELECTRON = require(path.join(REPO, 'node_modules', 'electron'));
const ADDON = fs.readFileSync(path.join(REPO, 'addons', 'watch-party.js'), 'utf8');
const VIDEO = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // Big Buck Bunny, Blender Foundation (CC BY)
const [PA, PB] = (process.env.WP_E2E_PUERTOS || '9402,9412').split(',');
const DIR = process.env.WP_E2E_DIR || os.tmpdir();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Instancia de Naviris controlada por CDP ---------- */
async function lanza(puerto) {
  const perfil = path.join(DIR, 'naviris-e2e-watch-' + puerto);
  fs.rmSync(perfil, { recursive: true, force: true });
  fs.mkdirSync(perfil, { recursive: true });
  const proc = spawn(ELECTRON, [REPO, '--user-data-dir=' + perfil, '--remote-debugging-port=' + puerto], { stdio: 'ignore' });
  let ui = null;
  for (let i = 0; i < 120 && !ui; i++) {
    await dormir(500);
    try { ui = (await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json()).find((t) => t.type === 'page' && /index\.html/.test(t.url)); } catch { /* aún no escucha */ }
  }
  if (!ui) throw new Error('Naviris no arrancó en el puerto ' + puerto);
  const ws = new WebSocket(ui.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  // Con tope: un executeJavaScript sobre una página que está recargando puede no volver nunca.
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++n; pend.set(id, res); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pend.delete(id)) rej(new Error('CDP sin respuesta: ' + method)); }, 15000);
  });
  // Evalúa en la interfaz (ahí corre el addon); devuelve el valor o lanza.
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error('evaluación: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result.result.value;
  };
  // Evalúa dentro de la página de la pestaña de la sala, con gesto de usuario.
  const pagina = (expr) => ev(`naviris.activeWebview().executeJavaScript(${JSON.stringify(expr)}, true)`);
  const video = () => pagina('(()=>{const v=document.querySelector("#movie_player video");return v?{t:v.currentTime,paused:v.paused}:null})()');
  const cierra = async () => {
    try { const v = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => { b.onopen = r; }); b.send(JSON.stringify({ id: 1, method: 'Browser.close' })); } catch { /* ya cerrada */ }
    for (let i = 0; i < 20 && proc.exitCode === null; i++) await dormir(250);
    if (proc.exitCode === null) proc.kill();
    try { ws.close(); } catch { /* nada */ }
    // Algún proceso hijo puede tardar en soltar el perfil: se reintenta y, si no, se queda en Temp.
    try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* lo limpia Windows */ }
  };
  // La interfaz sale en /json/list antes de terminar de cargar: se espera a la API de addons.
  for (let i = 0; i < 60; i++) {
    try { if (await ev("document.readyState === 'complete' && typeof naviris === 'object' && !!document.getElementById('addon-tools')")) break; } catch { /* aún cargando */ }
    await dormir(500);
  }
  return { puerto, ev, pagina, video, cierra };
}

// Espera a que se cumpla cond() (async) o falla con el último valor visto.
const T0 = Date.now();
const paso = (txt) => console.log('[' + ((Date.now() - T0) / 1000).toFixed(1) + ' s] ' + txt);
async function hasta(cond, ms, que) {
  const fin = Date.now() + ms; let ultimo;
  while (Date.now() < fin) { try { ultimo = await cond(); if (ultimo && ultimo.ok) { paso(que); return ultimo; } } catch (e) { ultimo = String(e.message); } await dormir(400); }
  throw new Error('no se cumplió: ' + que + ' · último: ' + JSON.stringify(ultimo));
}

/* Un perfil nuevo en la UE ve el aviso de cookies de YouTube, que pausa el
   video sin parar hasta que se responde (y rechazarlo a mano a veces no se
   guarda y vuelve). Se deja puesta de antemano la cookie de "rechazar todo"
   (SOCS=CAI) en la sesión de las pestañas, desde una pestaña de YouTube
   ligera que luego se cierra. */
async function sinAvisoDeCookies(X) {
  const id = await X.ev("naviris.abrePestana('https://www.youtube.com/robots.txt', true)");
  let wv = null;
  for (let i = 0; i < 40 && !wv; i++) {
    await dormir(250);
    wv = (await (await fetch(`http://127.0.0.1:${X.puerto}/json/list`)).json()).find((t) => t.type === 'webview' && t.url.includes('youtube.com/robots'));
  }
  if (!wv) throw new Error('no apareció la pestaña de YouTube');
  const ws = new WebSocket(wv.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  const r = await new Promise((res) => {
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) res(m); };
    ws.send(JSON.stringify({ id: 1, method: 'Network.setCookie', params: { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/', secure: true, expires: Date.now() / 1000 + 3e7 } }));
  });
  ws.close();
  assert.equal(r.result && r.result.success, true, 'cookie de consentimiento puesta');
  await X.ev('closeTab(' + id + ')');
}

let A, B;
before(async () => { [A, B] = await Promise.all([lanza(PA), lanza(PB)]); });
after(async () => { await Promise.all([A && A.cierra(), B && B.cierra()]); });

test('dos Naviris en la misma sala sincronizan play, pausa y salto en YouTube', { timeout: 240000 }, async () => {
  // 1. Addon del repo en las dos interfaces
  for (const X of [A, B]) {
    await X.ev(ADDON);
    assert.equal(await X.ev("!!document.getElementById('adt-watch-party')"), true);
  }

  await Promise.all([sinAvisoDeCookies(A), sinAvisoDeCookies(B)]);

  // 2. El anfitrión abre el video y crea la sala
  await A.ev(`naviris.abrePestana(${JSON.stringify(VIDEO)}, true)`);
  await hasta(async () => ({ ok: !!(await A.video()) }), 30000, 'el video carga en A');
  const codigo = await A.ev(`(async()=>{
    document.getElementById('adt-watch-party').click();
    await new Promise(r=>setTimeout(r,400));
    const n=document.getElementById('nvp-name'); n.value='Anfitrión e2e'; n.dispatchEvent(new Event('change'));
    document.querySelector('#nvp-panel .nvp-cta').click();
    for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,250)); const s=document.querySelector('#nvp-panel .nvp-status'); if(s&&/En la sala/.test(s.innerText)) break; }
    return document.querySelector('#nvp-panel .nvp-code').innerText.trim();
  })()`);
  assert.match(codigo, /^[A-Z0-9]{6}$/);

  // 3. El invitado entra desde el hub, solo con el código
  await B.ev(`(async()=>{
    document.getElementById('adt-watch-party').click();
    await new Promise(r=>setTimeout(r,400));
    const n=document.getElementById('nvp-name'); n.value='Invitado e2e'; n.dispatchEvent(new Event('change'));
    document.getElementById('nvp-codein').value=${JSON.stringify(codigo)};
    document.querySelector('#nvp-panel .nvp-btn').click();
  })()`);
  await hasta(async () => { const u = await B.ev("(naviris.activeWebview()||{getURL:()=>''}).getURL()"); return { ok: u.includes('aqz-KE-bpKQ'), u }; }, 30000, 'B aterriza en el video del anfitrión');
  await hasta(async () => ({ ok: !!(await B.video()) }), 30000, 'el video carga en B');
  const estadoB = await B.ev("document.querySelector('#nvp-panel .nvp-status').innerText");
  assert.match(estadoB, /2 personas · invitado · En la sala/);
  await hasta(async () => ({ ok: await B.pagina('!!window.__navPartyAgent') }), 15000, 'agente inyectado en B');

  const juntos = async (paused, cerca) => {
    const [a, b] = [await A.video(), await B.video()];
    return { ok: a.paused === paused && b.paused === paused && Math.abs(a.t - b.t) < 2 && (cerca === undefined || Math.abs(b.t - cerca) < 3), a, b };
  };

  // 4. El anfitrión: play, pausa, salto
  await A.pagina('document.querySelector("#movie_player video").play().then(()=>1)');
  await hasta(() => juntos(false), 15000, 'play del anfitrión llega al invitado');
  await A.pagina('document.querySelector("#movie_player video").pause();1');
  await hasta(() => juntos(true), 10000, 'pausa del anfitrión llega al invitado');
  await A.pagina('document.querySelector("#movie_player video").currentTime=120;1');
  await hasta(() => juntos(true, 120), 10000, 'salto del anfitrión a 2:00 llega al invitado');

  // 5. El invitado también controla (control exclusivo apagado por defecto).
  // Antes, un respiro: lo que hace cada lado en los 900 ms siguientes a aplicar
  // una orden remota se toma por eco y no se difunde (ECHO_MS del addon).
  await dormir(1500);
  await B.pagina('document.querySelector("#movie_player video").currentTime=300;1');
  await hasta(async () => { const a = await A.video(); return { ok: Math.abs(a.t - 300) < 3, a }; }, 10000, 'salto del invitado a 5:00 llega al anfitrión');
  await B.pagina('document.querySelector("#movie_player video").play().then(()=>1)');
  await hasta(() => juntos(false), 15000, 'play del invitado llega al anfitrión');
  await B.pagina('document.querySelector("#movie_player video").pause();1');
  await hasta(() => juntos(true), 10000, 'pausa del invitado llega al anfitrión');

  // 6. Chat
  await A.ev(`(()=>{const i=document.getElementById('nvp-chatin');i.value='hola desde e2e';document.querySelector('#nvp-panel .nvp-send').click()})()`);
  await hasta(async () => ({ ok: /hola desde e2e/.test(await B.ev("document.querySelector('#nvp-panel .nvp-chat').innerText")) }), 8000, 'el chat llega al invitado');
});

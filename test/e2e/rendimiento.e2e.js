// e2e (app real por CDP): las pestañas que no se ven dejan de pintar sin cortar
// el sonido ni recargar al volver, la de AutoClaim sigue trabajando de fondo, y
// las ventanas emergentes solo se abren con un gesto de la persona (clic en la
// página o en un iframe de otro sitio), con aviso y permiso por sitio.
// Se ejecuta con: npm run test:e2e  (puerto CDP: NAVIRIS_E2E_PUERTO, 9405 por defecto)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { arranca, conecta, lista, hasta, espera } = require('./naviris');

// ---------- Páginas de prueba: 127.0.0.1 y localhost son dos sitios distintos ----------
let WEB = 0;
const html = (cuerpo) => `<!doctype html><meta charset="utf-8"><body style="margin:0">${cuerpo}</body>`;
// Un tono de 30 s (WAV de 8 kHz) para comprobar que el sonido sigue de fondo
function tono() {
  const n = 8000 * 30, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8000 * 2 * Math.PI * 440) * 800), 44 + i * 2);
  return b;
}
const TONO = tono();
const paginas = {
  // Cuenta los fotogramas que pinta y suena un audio en bucle
  '/fondo': () => html(`<h1>fondo</h1><audio id="a" src="/tono.wav" loop></audio><script>
    window.__raf = 0; (function f() { window.__raf++; requestAnimationFrame(f); })();
  </script>`),
  '/tono.wav': () => TONO,
  // Nada más cargar intenta abrir una pestaña, una ventana y un enlace _blank.
  // Con clic: una ventana de login con opener, un enlace, dos ventanas con un solo clic
  // y una ventana desde un iframe de otro sitio.
  '/emergentes': () => html(`<pre id="r">esperando</pre>
    <a id="l" href="/destino?enlace" target="_blank" style="display:block;width:200px;height:40px">enlace</a>
    <button id="b" style="width:200px;height:40px">entrar</button>
    <button id="dos" style="width:200px;height:40px">dos</button>
    <iframe id="f" src="http://localhost:${WEB}/marco" style="border:0;width:200px;height:60px;display:block"></iframe>
    <script>
      window.open('/destino?sola');
      window.open('/destino?ventana', '_blank', 'width=400,height=300');
      const a = document.createElement('a'); a.href = '/destino?script'; a.target = '_blank'; document.body.appendChild(a); a.click();
      addEventListener('message', (e) => { if (e.data && e.data.login) document.getElementById('r').textContent = 'ok:' + e.data.login; });
      document.getElementById('b').onclick = () => { const w = window.open('/hijo', 'login', 'width=480,height=600'); if (!w) document.getElementById('r').textContent = 'null'; };
      document.getElementById('dos').onclick = () => { window.open('/destino?dos1', '_blank', 'width=300,height=200'); window.open('/destino?dos2', '_blank', 'width=300,height=200'); };
    </script>`),
  '/marco': () => html(`<button id="bi" style="width:200px;height:60px">desde el iframe</button><script>
    document.getElementById('bi').onclick = () => window.open('http://localhost:${WEB}/destino?marco', '_blank', 'width=300,height=200');
  </script>`),
  '/hijo': () => html(`<script>if (window.opener) { window.opener.postMessage({ login: 'token' }, '*'); setTimeout(() => window.close(), 200); }</script>`),
  '/destino': () => html('<h1>destino</h1>')
};
const atiende = (req, res) => {
  const ruta = new URL(req.url, 'http://x').pathname;
  const f = paginas[ruta];
  if (!f) { res.writeHead(404); return res.end(); }
  res.setHeader('content-type', ruta.endsWith('.wav') ? 'audio/wav' : 'text/html; charset=utf-8');
  res.end(f());
};
const servidores = [];
test.before(async () => {
  const a = http.createServer(atiende);
  await new Promise((r) => a.listen(0, '127.0.0.1', r));
  WEB = a.address().port;
  servidores.push(a);
  // localhost puede resolverse a ::1: el mismo puerto también ahí (si hay IPv6)
  const b = http.createServer(atiende);
  await new Promise((r) => { b.once('error', r); b.listen(WEB, '::1', r); });
  servidores.push(b);
});
test.after(() => { for (const s of servidores) s.close(); });

// ---------- Ayudas ----------
// Abre una pestaña con la URL y conecta con su webview
async function pestana(nav, url) {
  const antes = new Set((await lista()).map((x) => x.id));
  await nav.ui.evalua(`void createTab(${JSON.stringify(url)})`);
  const t = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id) && x.url.startsWith('http')));
  const c = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => c.evalua(`document.readyState === 'complete'`));
  return c;
}
// Fotogramas que pinta la página en un rato
async function fotogramas(c, ms = 1500) {
  const a = await c.evalua('window.__raf');
  await espera(ms);
  return (await c.evalua('window.__raf')) - a;
}
const activa = (nav, expr) => nav.ui.evalua(`(() => { const t = tabs.find((x) => ${expr}); activateTab(t.id); return t.id; })()`);
const ventanas = async () => (await lista()).filter((x) => x.type === 'page' && !/index\.html/.test(x.url));
async function clic(c, sel) {
  const [x, y] = await c.evalua(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await c.clic(x, y);
}

test('las pestañas que no se ven dejan de pintar; el sonido sigue y al volver no recarga', { timeout: 120000 }, async (t) => {
  const nav = await arranca();
  t.after(() => nav.cierra());
  const c = await pestana(nav, `http://127.0.0.1:${WEB}/fondo`);
  await nav.ui.evalua(`(tabs.find((x) => x.url.endsWith('/fondo')).webview.setAudioMuted(true), 1)`);
  await c.evalua(`document.getElementById('a').play().then(() => 1)`);
  assert.ok(await fotogramas(c) > 20, 'la pestaña activa pinta');
  await c.evalua('window.__marca = 1');

  // Con el hub delante
  await activa(nav, `x.kind === 'hub'`);
  await espera(500);
  const s0 = await c.evalua(`document.getElementById('a').currentTime`);
  assert.ok(await fotogramas(c, 2000) <= 1, 'detrás del hub no pinta');
  const s1 = await c.evalua(`({ t: document.getElementById('a').currentTime, parado: document.getElementById('a').paused })`);
  assert.equal(s1.parado, false);
  assert.ok(s1.t - s0 > 1.5, 'el sonido sigue: ' + (s1.t - s0));

  // Al volver se ve enseguida y es la misma página
  const primero = c.evalua(`new Promise((r) => { const a = performance.now(); requestAnimationFrame(() => r(performance.now() - a)); })`);
  await activa(nav, `x.url.endsWith('/fondo')`);
  assert.ok(await Promise.race([primero, espera(1000).then(() => Infinity)]) < 1000, 'pinta al volver');
  assert.equal(await c.evalua('window.__marca'), 1, 'sin recargar');
  assert.ok(await fotogramas(c) > 20);

  // Detrás de otra pestaña
  const otra = await pestana(nav, `http://127.0.0.1:${WEB}/destino?otra`);
  await espera(500);
  assert.ok(await fotogramas(c, 2000) <= 1, 'detrás de otra pestaña no pinta');
  otra.cierra(); c.cierra();
});

test('la pestaña de AutoClaim sigue pintando y contando de fondo', { timeout: 120000 }, async (t) => {
  const nav = await arranca();
  t.after(() => nav.cierra());
  const PAGINA = fs.readFileSync(path.join(__dirname, 'paginas', 'twitch-canal.html'));
  const web = await nav.abre('https://www.twitch.tv/naviris-prueba', [['https://www.twitch.tv/naviris-*', () => ({ cuerpo: PAGINA, tipo: 'text/html; charset=utf-8' })]]);
  await web.evalua(`window.__raf = 0; (function f() { window.__raf++; requestAnimationFrame(f); })(); 1`);
  const pestanaTwitch = `x.kind === 'web' && /twitch\\.tv/.test(x.url)`;
  await nav.ui.evalua(`(activateAutoLoot(tabs.find((x) => ${pestanaTwitch})), 1)`);
  await espera(500);
  await activa(nav, `x.kind === 'hub'`);
  await espera(1000);
  assert.ok(await fotogramas(web, 2000) > 20, 'con el AutoClaim, de fondo sigue viva');
  // Apagado, vuelve a dormirse de fondo como las demás
  await nav.ui.evalua(`(setAutoLoot(tabs.find((x) => ${pestanaTwitch}), false), 1)`);
  await espera(300);
  await activa(nav, pestanaTwitch);
  await activa(nav, `x.kind === 'hub'`);
  await espera(800);
  assert.ok(await fotogramas(web, 2000) <= 1, 'sin el AutoClaim ya no pinta de fondo');
  web.cierra();
});

test('ventanas emergentes: sin gesto se bloquean y avisan; con clic se abren', { timeout: 150000 }, async (t) => {
  const nav = await arranca();
  t.after(() => nav.cierra());
  const pestanas = () => nav.ui.evalua('tabs.length');
  const sitio = `http://127.0.0.1:${WEB}`;
  const t0 = await pestanas();

  // Sin gesto: ni pestañas ni ventanas, y el aviso de la barra con las tres
  const c = await pestana(nav, sitio + '/emergentes');
  await espera(2500);
  assert.equal((await pestanas()) - t0, 1, 'solo la pestaña de la prueba');
  assert.equal((await ventanas()).length, 0, 'ninguna ventana');
  const aviso = await nav.ui.evalua(`({ visible: !document.getElementById('emerg-bar').classList.contains('hidden'), texto: document.getElementById('emerg-text').textContent })`);
  assert.deepEqual(aviso, { visible: true, texto: 'Se bloquearon 3 ventanas emergentes de 127.0.0.1.' });

  // Con clic: el login en ventanita contesta por window.opener
  await clic(c, '#b');
  assert.equal(await hasta(async () => { const r = await c.evalua(`document.getElementById('r').textContent`); return r !== 'esperando' && r; }), 'ok:token');
  await hasta(async () => (await ventanas()).length === 0, 5000);   // la ventana de login se cierra sola

  // Con clic en un enlace _blank: pestaña nueva
  await clic(c, '#l');
  await hasta(async () => (await pestanas()) - t0 === 2, 5000);
  await activa(nav, `x.url.endsWith('/emergentes')`);

  // Un clic, una ventana (como Chrome): la segunda del mismo clic se bloquea
  await clic(c, '#dos');
  await espera(1500);
  assert.deepEqual((await ventanas()).map((x) => new URL(x.url).search), ['?dos1']);

  // Clic dentro de un iframe de otro sitio (como el botón de «Iniciar sesión con Google»)
  await clic(c, '#f');
  await hasta(async () => (await ventanas()).some((x) => x.url.endsWith('?marco')), 5000);

  // «Permitir en este sitio»: queda en los permisos y al recargar se abren sin clic
  await nav.ui.evalua(`(document.getElementById('emerg-allow').click(), 1)`);
  const permisos = await nav.ui.evalua('window.navirisApp.permList()');
  assert.equal(permisos[sitio + '|popups'], 'allow');
  const v0 = (await ventanas()).length, p0 = await pestanas();
  await nav.ui.evalua(`(tabs.find((x) => x.url.endsWith('/emergentes')).webview.reload(), 1)`);
  await hasta(async () => (await pestanas()) - p0 === 2 && (await ventanas()).length - v0 === 1, 8000);
  c.cierra();
});

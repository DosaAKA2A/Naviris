// Rat Tool dentro de Naviris: arranca la app (perfil temporal propio, CDP en el
// puerto NAVIRIS_CDP_RAT o 9401) y prueba el panel y el proceso principal por
// las mismas llamadas que usa la interfaz (window.navirisApp.yt*). Una descarga
// real va a la carpeta Descargas del usuario: si ya hay un archivo con ese
// nombre la prueba se salta (no lo pisa) y el que baja lo borra al acabar.
// Necesita red; para saltarlo: set NAVIRIS_SIN_RED=1
// npm run test:e2e
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const BIN = path.join(REPO, 'resources', 'bin');
const PUERTO = Number(process.env.NAVIRIS_CDP_RAT || 9401);
const faltan = [...['yt-dlp.exe', 'ffmpeg.exe', 'deno.exe'].map((b) => path.join(BIN, b)), ELECTRON].filter((f) => !fs.existsSync(f)).map((f) => path.basename(f));
const SALTAR = process.env.NAVIRIS_SIN_RED === '1' ? 'NAVIRIS_SIN_RED=1' : (faltan.length ? 'faltan ' + faltan.join(', ') : false);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let app, perfil, ws, log, seq = 0;
const pendientes = new Map();
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pendientes.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalua(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('en la página: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function hasta(fn, ms, que) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fin) throw new Error('no llegó a tiempo: ' + que);
    await espera(500);
  }
}
const json = (ruta) => fetch(`http://127.0.0.1:${PUERTO}${ruta}`).then((r) => r.json());
const ultimo = (id) => evalua(`(window.__rat || []).filter((m) => m.id === ${JSON.stringify(id)}).at(-1) || null`);
const tempsRat = () => new Set(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('naviris-rat-descarga-') || d.startsWith('naviris-cookies-')));
const veces = (rx) => (fs.readFileSync(log, 'utf8').match(rx) || []).length;
const terminada = (id, ms) => hasta(async () => { const u = await ultimo(id); return u && u.state !== 'progressing' && u; }, ms, 'el final de ' + id);
// Restos de una descarga cortada que Naviris debe barrer al arrancar (con más
// de una hora), uno reciente que debe respetar y uno ajeno con nombre parecido.
const RESTOS = { viejo: 'naviris-rat-descarga-e2eVJ1', reciente: 'naviris-rat-descarga-e2eRC1', ajeno: 'naviris-rat-descarga-e2e-ajeno', cookies: 'naviris-cookies-1-e2e1.txt' };
const enTemp = (n) => path.join(os.tmpdir(), n);

test.before(async () => {
  if (SALTAR) return;
  perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-rat-e2e-perfil-'));
  const haceDosHoras = new Date(Date.now() - 2 * 3600 * 1000);
  for (const n of [RESTOS.viejo, RESTOS.reciente, RESTOS.ajeno]) { fs.mkdirSync(enTemp(n), { recursive: true }); fs.writeFileSync(path.join(enTemp(n), 'a medias.mp4'), 'x'); }
  fs.writeFileSync(enTemp(RESTOS.cookies), '# Netscape HTTP Cookie File\n');
  for (const n of [RESTOS.viejo, RESTOS.ajeno, RESTOS.cookies]) fs.utimesSync(enTemp(n), haceDosHoras, haceDosHoras);
  log = path.join(perfil, 'naviris.log');
  const salida = fs.openSync(log, 'a');
  app = spawn(ELECTRON, [REPO, '--user-data-dir=' + perfil, '--remote-debugging-port=' + PUERTO], { stdio: ['ignore', salida, salida], windowsHide: true });
  const pagina = await hasta(async () => {
    try { return (await json('/json/list')).find((t) => t.type === 'page' && /\/src\/index\.html/.test(t.url)); } catch { return null; }
  }, 60000, 'la ventana de Naviris');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const p = pendientes.get(m.id);
    if (p) { pendientes.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  await new Promise((r) => { ws.onopen = r; });
  await hasta(() => evalua('!!(window.navirisApp && window.ratTool && document.getElementById("rat-url"))'), 30000, 'el renderer');
  await evalua(`window.__rat = []; window.navirisApp.onDownloadNew((m) => window.__rat.push(JSON.parse(JSON.stringify(m))));
    window.navirisApp.onDownloadUpdate((m) => window.__rat.push(JSON.parse(JSON.stringify(m)))); true`);
});

test.after(async () => {
  if (!app) return;
  try {
    const { webSocketDebuggerUrl } = await json('/json/version');
    const b = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r) => { b.onopen = r; });
    b.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await espera(3000);
  } catch { /* ya cerrada */ }
  try { ws?.close(); } catch { /* nada */ }
  if (app.exitCode === null) { try { process.kill(app.pid); } catch { /* nada */ } }
  await espera(1500);
  fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  for (const n of Object.values(RESTOS)) fs.rmSync(enTemp(n), { recursive: true, force: true });
});

const opt = { skip: SALTAR, timeout: 240000 };

test('el panel carga rat.js y reconoce plataformas y videos', opt, async () => {
  const r = await evalua(`[ratTool.plataforma('https://www.twitch.tv/videos/1')?.nombre, ratTool.esVideo('https://www.twitch.tv/videos/1'),
    ratTool.esVideo('https://www.tiktok.com/foryou'), ratTool.esLista('https://www.youtube.com/playlist?list=PL1')]`);
  assert.deepEqual(r, ['Twitch', true, false, true]);
});

test('el texto del panel según el enlace', opt, async () => {
  const texto = (u) => evalua(`(() => { const i = document.getElementById('rat-url'); i.value = ${JSON.stringify(u)};
    i.dispatchEvent(new Event('input')); return document.getElementById('rat-plat').textContent; })()`);
  assert.equal(await texto('https://www.twitch.tv/videos/2915087502'), 'Plataforma: Twitch');
  assert.equal(await texto('https://vimeo.com/98044508'), 'Plataforma: Vimeo');
  assert.match(await texto('https://www.youtube.com/playlist?list=PLM6OA8eOe83s'), /^Es una lista de reproducción/);
  assert.match(await texto('https://www.tiktok.com/foryou'), /^Abre un video concreto/);
  assert.equal(await texto('https://otro-sitio.example/algo'), 'Se intentará con yt-dlp.');
  await texto('');
});

test('motor listo y yt-dlp revisado contra GitHub sin errores', opt, async () => {
  assert.equal(await evalua('window.navirisApp.ytAvailable()'), true);
  // la revisión se lanza en segundo plano; se le dan unos segundos
  await espera(8000);
  const texto = fs.readFileSync(log, 'utf8');
  assert.doesNotMatch(texto, /No se pudo actualizar yt-dlp|No se pudo preparar el motor/, texto);
});

test('calidades reales en el selector (YouTube con Deno) y ninguna para una lista', opt, async () => {
  const q = await evalua(`window.navirisApp.ytFormats('https://www.youtube.com/watch?v=aqz-KE-bpKQ')`);
  assert.ok(q.includes(1080) && q.includes(720), JSON.stringify(q));
  assert.deepEqual(await evalua(`window.navirisApp.ytFormats('https://www.youtube.com/playlist?list=PLM6OA8eOe83s')`), []);
});

test('una lista suelta no se descarga y el panel dice qué hacer', opt, async () => {
  const id = await evalua(`window.navirisApp.ytDownload('https://www.youtube.com/playlist?list=PLM6OA8eOe83s', 'video', '')`);
  const m = await hasta(async () => { const u = await ultimo(id); return u && u.state !== 'progressing' && u; }, 20000, 'el aviso de lista');
  assert.equal(m.state, 'interrupted');
  assert.match(m.error, /Abre uno de sus videos/);
});

test('descarga real a Descargas: archivo final, sin restos temporales', opt, async (t) => {
  const antes = tempsRat();
  const id = await evalua(`window.navirisApp.ytDownload('https://www.youtube.com/watch?v=jNQXAC9IVRw', 'video', '240')`);
  const carpeta = await evalua(`window.navirisApp.downloadPath(${JSON.stringify(id)})`);
  const esperado = path.join(carpeta, 'Me at the zoo [jNQXAC9IVRw].mp4');
  if (fs.existsSync(esperado)) {
    await evalua(`window.navirisApp.cancelDownload(${JSON.stringify(id)})`);
    t.skip('ya hay un "' + path.basename(esperado) + '" en Descargas; no se pisa');
    return;
  }
  const m = await hasta(async () => { const u = await ultimo(id); return u && u.state !== 'progressing' && u; }, 120000, 'el final de la descarga');
  try {
    assert.equal(m.state, 'completed', m.error);
    assert.equal(m.path, esperado);
    assert.equal(m.name, path.basename(esperado));
    assert.ok(fs.statSync(m.path).size > 100000);
    assert.ok(m.total > 0 && m.percent === 100);
    await espera(2000);
    const nuevos = [...tempsRat()].filter((d) => !antes.has(d));
    assert.deepEqual(nuevos, [], 'quedó la carpeta temporal');
  } finally {
    fs.rmSync(esperado, { force: true });
  }
});

test('cancelar no deja nada en Descargas ni en la carpeta temporal', opt, async () => {
  const antes = tempsRat();
  const id = await evalua(`window.navirisApp.ytDownload('https://www.youtube.com/watch?v=lTRiuFIWV54', 'video', '')`);
  const carpeta = await evalua(`window.navirisApp.downloadPath(${JSON.stringify(id)})`);
  const enMarcha = await hasta(async () => { const u = await ultimo(id); return u && u.percent > 0 && u; }, 90000, 'que empiece a bajar');
  assert.match(enMarcha.name, /📚.*\[lTRiuFIWV54\]\.mp4$/, 'el nombre con emoji llega bien');
  await evalua(`window.navirisApp.cancelDownload(${JSON.stringify(id)})`);
  await espera(6000);
  assert.equal((await ultimo(id)).state, 'cancelled');
  assert.ok(!fs.existsSync(path.join(carpeta, enMarcha.name)), 'quedó el archivo en Descargas');
  const nuevos = [...tempsRat()].filter((d) => !antes.has(d));
  assert.deepEqual(nuevos, [], 'quedó la carpeta temporal');
});

test('al arrancar borra solo los restos viejos del Rat Tool', opt, async () => {
  await hasta(() => !fs.existsSync(enTemp(RESTOS.viejo)) && !fs.existsSync(enTemp(RESTOS.cookies)), 15000, 'el barrido de restos');
  assert.ok(fs.existsSync(enTemp(RESTOS.reciente)), 'borró una carpeta reciente (podía ser una descarga en marcha)');
  assert.ok(fs.existsSync(enTemp(RESTOS.ajeno)), 'borró una carpeta que no es suya');
});

test('canal de Twitch (directo): no se lanza y manda a Videos del canal', opt, async () => {
  const id = await evalua(`window.navirisApp.ytDownload('https://www.twitch.tv/twitch', 'video', '')`);
  const m = await terminada(id, 10000);
  assert.equal(m.state, 'interrupted');
  assert.equal(m.error, 'Los directos no se descargan. Cuando acabe, descarga el video desde la pestaña Videos del canal');
  assert.deepEqual(await evalua(`window.navirisApp.ytFormats('https://www.twitch.tv/twitch')`), []);
});

test('directo de YouTube (is_live): no se graba y el mensaje lo explica', opt, async () => {
  const antes = tempsRat();
  const id = await evalua(`window.navirisApp.ytDownload('https://www.youtube.com/@LofiGirl/live', 'video', '')`);
  const m = await terminada(id, 90000);
  assert.equal(m.state, 'interrupted');
  assert.equal(m.error, 'Los directos no se descargan. Cuando acabe, descarga el video ya publicado');
  await espera(2000);
  assert.deepEqual([...tempsRat()].filter((d) => !antes.has(d)), []);
});

test('YouTube con restricción de edad: sin cookies de entrada y un solo reintento con la sesión', opt, async () => {
  const url = 'https://www.youtube.com/watch?v=6kLq3WMV1nU';
  // Sin sesión de YouTube en el perfil: no hay reintento
  const n0 = veces(/se reintenta con las cookies/g);
  const a = await terminada(await evalua(`window.navirisApp.ytDownload(${JSON.stringify(url)}, 'video', '144')`), 90000);
  assert.match(a.error, /restricción de edad.*YouTube/);
  assert.equal(veces(/se reintenta con las cookies/g), n0, 'reintentó sin tener sesión');
  // Con cookies de youtube.com (abrir YouTube en una pestaña las crea): un reintento, ni uno más
  await evalua(`createTab('https://www.youtube.com/'); true`);
  await espera(12000);
  const antes = tempsRat();
  const b = await terminada(await evalua(`window.navirisApp.ytDownload(${JSON.stringify(url)}, 'video', '144')`), 120000);
  assert.equal(b.state, 'interrupted');
  assert.match(b.error, /restricción de edad.*YouTube/);
  assert.equal(veces(/se reintenta con las cookies/g), n0 + 1, 'no hizo exactamente un reintento');
  await espera(2000);
  assert.deepEqual([...tempsRat()].filter((d) => !antes.has(d)), [], 'quedaron la carpeta temporal o el archivo de cookies');
});

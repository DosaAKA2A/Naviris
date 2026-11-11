// Parte «protocolo» de Naviris 3, en la app de verdad:
// · la interfaz se sirve por naviris://app y carga todo lo suyo (scripts, fuente, sonidos, imágenes);
// · lo que guardaba en file:// pasa a su origen nuevo en el primer arranque, sin tocar lo viejo;
// · una web, un webview o una ventanita no pueden usar naviris://;
// · una descarga cortada que se reanuda no suena a error.
// Para probarlo con la fuse apagada, como en el instalable: ELECTRON_OVERRIDE_DIST_PATH=<copia de Electron con
// GrantFileProtocolExtraPrivileges apagada>. Lo viejo se escribe siempre con el Electron del repo (fuse encendida),
// que es como lo escribían las versiones anteriores.
// NAVIRIS_E2E_PUERTO=9420 npm run test:e2e   (o: node --test test/e2e/protocolo.e2e.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');
const { conecta, lista, hasta, espera, RAIZ, PUERTO } = require('./naviris');
const { clavesDeOrigen } = require('../../src/migra-origen');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'naviris-e2e-protocolo-'));
const PERFIL = path.join(DIR, 'perfil');
const ELECTRON_DEL_REPO = path.join(path.dirname(require.resolve('electron')), 'dist', 'electron.exe');
const archivo = (r) => 'file:///' + r.replace(/\\/g, '/');

// PNG de 2x2, hecho a mano.
function png() {
  const tabla = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = tabla[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const trozo = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(2, 0); ih.writeUInt32BE(2, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ih), trozo('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]))), trozo('IEND', Buffer.alloc(0))]);
}

// Lo que una versión anterior (interfaz por file://) dejó en el perfil, escrito por Chromium de verdad.
const FOTO = path.join(DIR, 'Mis fotos', 'gato.png');
const FONDO = path.join(PERFIL, 'fondos', 'hub-1.png');
const MARCADORES = [{ id: 'b1', title: 'Marcador de la prueba', url: 'https://ejemplo.com/' }];
const VIEJO = {
  'naviris.bookmarks2': JSON.stringify(MARCADORES),
  'cobalt.history': JSON.stringify([{ url: 'https://ejemplo.com/', title: 'Ejemplo', ts: 1 }]),   // solo con el nombre viejo
  'naviris.tema': JSON.stringify('oscuro'),
  'naviris.hubBg.oscuro': JSON.stringify(`url("${archivo(FONDO)}") center/cover no-repeat`),
  'naviris.hub.v3': 'true',
  'naviris.widgets': JSON.stringify([{ id: 'w1', type: 'imagen', img: archivo(FOTO), slot: 0, geo: { std: { col: 1, row: 1, w: 3, h: 3 }, m: { col: 1, row: 1, w: 3, h: 3 }, uw: { col: 1, row: 1, w: 3, h: 3 } } }]),
  'naviris.prueba.ñ': 'año 😀'
};
function escribeLoViejo() {
  for (const f of [FOTO, FONDO]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, png()); }
  const app = path.join(DIR, 'version-anterior');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"version-anterior","main":"main.js"}');
  fs.writeFileSync(path.join(app, 'pagina.html'), '<!doctype html><title>interfaz vieja</title>');
  fs.writeFileSync(path.join(app, 'main.js'), `
    const { app, BrowserWindow } = require('electron');
    app.whenReady().then(async () => {
      const w = new BrowserWindow({ show: false });
      await w.loadFile(require('path').join(__dirname, 'pagina.html'));
      await w.webContents.executeJavaScript(${JSON.stringify(`for (const [k, v] of Object.entries(${JSON.stringify(VIEJO)})) localStorage.setItem(k, v); 1`)});
      setTimeout(() => app.quit(), 800);
    });`);
  const r = spawnSync(ELECTRON_DEL_REPO, [app, `--user-data-dir=${PERFIL}`], { timeout: 30000 });
  assert.equal(r.status, 0, 'la versión anterior escribió su localStorage');
}

// Arranca Naviris sobre PERFIL (que no se borra entre arranques).
async function arranca() {
  const proc = spawn(require('electron'), ['.', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${PERFIL}`], { cwd: RAIZ, stdio: 'ignore' });
  const t = await hasta(async () => (await lista()).find((x) => x.type === 'page' && /index\.html/.test(x.url)), 40000);
  const ui = await conecta(t.webSocketDebuggerUrl);
  await hasta(() => ui.evalua('typeof createTab === "function" && Array.isArray(tabs)'));
  return {
    ui, url: t.url,
    async cierra() {
      ui.cierra();
      try {
        const v = await (await fetch(`http://127.0.0.1:${PUERTO}/json/version`)).json();
        const b = await conecta(v.webSocketDebuggerUrl);
        b.envia('Browser.close').catch(() => {});
        await hasta(() => proc.exitCode !== null, 15000).catch(() => {});
        b.cierra();
      } catch { /* ya cerrada */ }
      if (proc.exitCode === null) proc.kill();
      await espera(500);
    }
  };
}
const ajustes = () => JSON.parse(fs.readFileSync(path.join(PERFIL, 'naviris-settings.json'), 'utf8'));

// Servidor local: una página cualquiera y una descarga que se corta (ver el test de la descarga).
const DESCARGA = 'protocolo-prueba-corte.bin';
const TAM = 512 * 1024;
let corta = true;   // mientras: la primera respuesta se corta a la cuarta parte y las de Range, sin dar nada
const servidor = http.createServer((req, res) => {
  if (req.url.startsWith('/descarga')) {
    const rango = /bytes=(\d+)-/.exec(req.headers.range || '');
    const desde = rango ? Number(rango[1]) : 0;
    if (rango && corta) { req.socket.destroy(); return; }
    const cab = { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${DESCARGA}"`, 'accept-ranges': 'bytes', etag: '"fijo"', 'last-modified': 'Wed, 11 Nov 2026 00:00:00 GMT' };
    if (rango) res.writeHead(206, { ...cab, 'content-length': TAM - desde, 'content-range': `bytes ${desde}-${TAM - 1}/${TAM}` });
    else res.writeHead(200, { ...cab, 'content-length': TAM });
    if (corta) { res.write(Buffer.alloc(TAM / 4, 1)); setTimeout(() => res.destroy(), 300); return; }
    res.end(Buffer.alloc(TAM - desde, 1));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>web</title><p>una web</p>');
});
let base, app;

test.before(async () => {
  escribeLoViejo();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  app = await arranca();
});
test.after(async () => {
  if (app) await app.cierra();
  servidor.close();
  fs.rmSync(path.join(os.homedir(), 'Downloads', DESCARGA), { force: true });
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('la interfaz vive en naviris://app y carga todo lo suyo', async () => {
  assert.equal(app.url, 'naviris://app/index.html');
  assert.equal(await app.ui.evalua('location.origin'), 'naviris://app');
  // Cada script y hoja de la página es de naviris://app y responde, y todos los módulos se ejecutaron.
  const piezas = await app.ui.evalua(`Promise.all([...document.querySelectorAll('script[src], link[href]')].map((e) => fetch(e.src || e.href).then((r) => [e.src || e.href, r.status], () => [e.src || e.href, 'falla'])))`);
  assert.ok(piezas.length > 30, 'scripts y estilos');
  assert.deepEqual(piezas.filter(([u, s]) => !u.startsWith('naviris://app/') || s !== 200), []);
  assert.equal(await app.ui.evalua(`typeof aplicaTema + typeof renderHub + typeof toggleDownloads + typeof showAbout`), 'functionfunctionfunctionfunction');
  assert.deepEqual(await app.ui.evalua(`document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))`), ['Inter Var']);
  assert.ok(await app.ui.evalua(`new Promise((ok) => { const a = new Audio('sonidos/cristal/aviso.ogg'); a.onloadedmetadata = () => ok(a.duration); a.onerror = () => ok(0); })`) > 0, 'sonido');
  assert.equal(await app.ui.evalua(`new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth); i.onerror = () => ok(0); i.src = 'temas/oscuro/1.jpg'; })`), 1024);
  // Lo del proceso principal no se sirve, ni saliéndose de la carpeta.
  for (const u of ['main.js', 'app-key.js', 'preload.js', '../package.json', 'renderer/%2e%2e/main.js', 'renderer%2f..%2fmain.js', 'datos/naviris-settings.json']) {
    assert.notEqual(await app.ui.evalua(`fetch(${JSON.stringify(u)}).then((r) => r.status, () => 'falla')`), 200, u);
  }
  // El IPC sensible sigue respondiendo a la interfaz.
  assert.equal(await app.ui.evalua('window.navirisApp.getSettings().then((s) => typeof s.adblockEnabled)'), 'boolean');
});

test('lo guardado en file:// llega entero al primer arranque y lo viejo se queda', async () => {
  const ls = await app.ui.evalua('Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))');
  assert.equal(ls['naviris.origenMigrado'], '1');
  assert.equal(ls['naviris.bookmarks2'], VIEJO['naviris.bookmarks2']);
  assert.equal(ls['naviris.prueba.ñ'], 'año 😀');
  assert.equal(ls['naviris.tema'], '"oscuro"');
  assert.equal(ls['naviris.history'], VIEJO['cobalt.history'], 'y migraClaves pasó la clave vieja');
  assert.equal(ls['cobalt.history'], VIEJO['cobalt.history']);
  assert.equal(await app.ui.evalua('bookmarks.length'), 1);
  assert.equal(await app.ui.evalua('temaActual()'), 'oscuro');
  assert.equal(ajustes().migraciones.origenInterfaz, true);
  // Las imágenes: el fondo del hub sigue en el perfil, la del widget se copió; las dos se ven.
  assert.equal(JSON.parse(ls['naviris.hubBg.oscuro']), 'url("naviris://app/datos/fondos/hub-1.png") center/cover no-repeat');
  assert.match(await app.ui.evalua(`getComputedStyle(document.getElementById('hub')).getPropertyValue('--hub-bg')`), /naviris:\/\/app\/datos\/fondos\/hub-1\.png/);
  const img = JSON.parse(ls['naviris.widgets'])[0].img;
  assert.match(img, /^naviris:\/\/app\/datos\/imagenes\/[0-9a-f]{20}\.png$/);
  for (const src of ['naviris://app/datos/fondos/hub-1.png', img]) {
    assert.equal(await app.ui.evalua(`new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth); i.onerror = () => ok(0); i.src = ${JSON.stringify(src)}; })`), 2, src);
  }
  // Y el widget del hub la pinta.
  await hasta(() => app.ui.evalua(`[...document.querySelectorAll('.w-img img')].some((i) => i.src === ${JSON.stringify(img)} && i.complete && i.naturalWidth === 2)`), 8000);
  // Mismo origen: el brillo del fondo se puede medir (canvas sin contaminar).
  assert.equal(await app.ui.evalua(`new Promise((ok) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); const g = c.getContext('2d'); g.drawImage(i, 0, 0); try { ok(g.getImageData(0, 0, 1, 1).data[0]); } catch (e) { ok(e.name); } }; i.src = 'naviris://app/datos/fondos/hub-1.png'; })`), 255);
  // Y la interfaz ya no puede cargar una imagen por file:, aunque sea suya.
  assert.equal(await app.ui.evalua(`new Promise((ok) => { const i = new Image(); i.onload = () => ok('cargó'); i.onerror = () => ok('no'); i.src = ${JSON.stringify(archivo(FOTO))}; })`), 'no');
});

test('una imagen nueva para un widget y la foto de la cuenta funcionan sin file:', async () => {
  const r = await app.ui.evalua(`window.navirisApp.imagenWidget(${JSON.stringify(FOTO)})`);
  assert.equal(r.ok, true);
  assert.equal(await app.ui.evalua(`new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth); i.onerror = () => ok(0); i.src = ${JSON.stringify(r.url)}; })`), 2);
  assert.equal((await app.ui.evalua(`window.navirisApp.imagenWidget(${JSON.stringify(path.join(DIR, 'version-anterior', 'main.js'))})`)).ok, false, 'solo imágenes');
  const foto = await app.ui.evalua(`reduceImagen(new File([new Uint8Array(${JSON.stringify([...png()])})], 'yo.png', { type: 'image/png' }))`);
  assert.match(foto, /^data:image\/jpeg;base64,/);
});

// Una pestaña nueva con una web servida por el servidor local.
async function abreWeb() {
  const antes = new Set((await lista()).map((x) => x.id));
  await app.ui.evalua(`void createTab(${JSON.stringify(base + '/web')})`);
  const w = await hasta(async () => (await lista()).find((x) => x.type === 'webview' && !antes.has(x.id) && x.url.startsWith(base)));
  const c = await conecta(w.webSocketDebuggerUrl);
  await hasta(() => c.evalua('document.readyState === "complete"'));
  return c;
}

test('una web no llega a naviris:// ni con fetch, ni con una imagen, ni navegando, ni desde una ventanita', async () => {
  const web = await abreWeb();
  const r = await web.evalua(`(async () => {
    const out = {};
    out.fetch = await fetch('naviris://app/index.html').then((r) => r.status, (e) => 'falla');
    out.fetchDatos = await fetch('naviris://app/datos/fondos/hub-1.png').then((r) => r.status, (e) => 'falla');
    out.img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok('cargó'); i.onerror = () => ok('no'); i.src = 'naviris://app/temas/oscuro/1.jpg'; });
    out.script = await new Promise((ok) => { const s = document.createElement('script'); s.onload = () => ok('cargó'); s.onerror = () => ok('no'); s.src = 'naviris://app/icons.js'; document.head.append(s); });
    out.iframe = await new Promise((ok) => { const f = document.createElement('iframe'); f.src = 'naviris://app/index.html'; f.onload = () => { try { ok(f.contentDocument ? 'legible' : 'opaco'); } catch { ok('opaco'); } }; document.body.append(f); setTimeout(() => ok('no'), 3000); });
    return out;
  })()`);
  assert.deepEqual({ ...r, iframe: r.iframe === 'legible' ? 'legible' : 'no' }, { fetch: 'falla', fetchDatos: 'falla', img: 'no', script: 'no', iframe: 'no' });
  // Navegar la pestaña a la interfaz no la carga: ni puente ni página.
  await web.evalua(`location.href = 'naviris://app/index.html'`).catch(() => {});
  await espera(1500);
  const wvs = (await lista()).filter((x) => x.type === 'webview');
  assert.ok(wvs.every((x) => !x.url.startsWith('naviris:') || x.title !== 'Naviris'), JSON.stringify(wvs.map((x) => x.url)));
  const tras = await conecta(wvs.find((x) => x.url.startsWith('naviris:') || x.url.startsWith(base) || x.url.startsWith('chrome-error:'))?.webSocketDebuggerUrl || wvs[0].webSocketDebuggerUrl);
  assert.equal(await tras.evalua(`typeof window.navirisApp`), 'undefined');
  assert.equal(await tras.evalua(`document.querySelector('#tabstrip') === null`), true);
  tras.cierra(); web.cierra();
  // Desde una ventanita (about:blank del mismo origen que la web, como las de inicio de sesión).
  const otra = await abreWeb();
  await otra.clic(20, 20);
  const desdeVentanita = await otra.evalua(`(async () => {
    const w = window.open('about:blank', 'v', 'popup,width=300,height=200');
    if (!w) return 'sin ventanita';
    const r = await w.fetch('naviris://app/index.html').then((r) => r.status, () => 'falla');
    w.close();
    return r;
  })()`);
  assert.equal(desdeVentanita, 'falla');
  otra.cierra();
});

test('una descarga cortada que se reanuda no suena a error ni se marca como fallida', async () => {
  fs.rmSync(path.join(os.homedir(), 'Downloads', DESCARGA), { force: true });
  await app.ui.evalua(`window.__sonidos = []; const __suena = window.navSonido; window.navSonido = (n) => { window.__sonidos.push(n); return __suena(n); }; 1`);
  await app.ui.evalua(`window.__estados = []; window.navirisApp.onDownloadUpdate((m) => window.__estados.push([m.state, !!m.cortada])); 1`);
  await app.ui.evalua(`window.navirisApp.download(${JSON.stringify(base + '/descarga')}, false), 1`);
  const id = await hasta(() => app.ui.evalua(`[...dlMeta.values()].find((m) => m.name === ${JSON.stringify(DESCARGA)} && m.cortada)?.id`), 20000);
  assert.deepEqual(await app.ui.evalua('window.__sonidos'), [], 'el corte no suena');
  assert.equal(await app.ui.evalua(`dlRows.get(${JSON.stringify(id)}).classList.contains('error')`), false);
  assert.match(await app.ui.evalua(`dlRows.get(${JSON.stringify(id)}).querySelector('.dl-sub').textContent`), /^Conexión cortada/);
  assert.equal(await app.ui.evalua(`dlRows.get(${JSON.stringify(id)}).querySelector('.dl-act2').title`), 'Reanudar');
  corta = false;
  await app.ui.evalua(`window.navirisApp.resumeDownload(${JSON.stringify(id)}), 1`);
  await hasta(() => app.ui.evalua(`dlMeta.get(${JSON.stringify(id)}).state === 'completed'`), 20000);
  await espera(300);
  assert.deepEqual(await app.ui.evalua('window.__sonidos'), ['descarga'], 'suena una vez, al terminar');
  assert.equal(fs.statSync(path.join(os.homedir(), 'Downloads', DESCARGA)).size, TAM);
  assert.ok((await app.ui.evalua('window.__estados')).every(([s]) => s !== 'interrupted'));
});

test('el estado del navegador predeterminado se mira al abrir el menú', async () => {
  await app.ui.evalua(`document.getElementById('menu-predet-estado').textContent = ''; 1`);
  await app.ui.evalua(`window.dispatchEvent(new Event('focus')); 1`);
  await espera(500);
  assert.equal(await app.ui.evalua(`document.getElementById('menu-predet-estado').textContent`), '', 'el foco ya no pregunta a Windows');
  await app.ui.evalua(`els.navMenu.click(); 1`);
  await hasta(() => app.ui.evalua(`document.getElementById('menu-predet-estado').textContent.length > 0`), 5000);
  await app.ui.evalua(`document.body.click(); 1`);
});

test('al volver a abrir no se migra otra vez: lo cambiado se queda y lo viejo sigue en file://', async () => {
  await app.ui.evalua(`store.set('naviris.tema', 'rosa'), localStorage.setItem('naviris.prueba.ñ', 'cambiada'), 1`);
  await app.cierra();
  app = null;
  // Lo de file:// no se ha tocado: la 2.x lo sigue encontrando.
  const viejo = clavesDeOrigen(path.join(PERFIL, 'Local Storage', 'leveldb'), 'file://');
  assert.deepEqual(viejo, VIEJO);
  app = await arranca();
  assert.equal(await app.ui.evalua(`localStorage.getItem('naviris.prueba.ñ')`), 'cambiada');
  assert.equal(await app.ui.evalua(`temaActual()`), 'rosa');
  assert.equal(await app.ui.evalua('bookmarks.length'), 1);
});

// Parte «firmas» de Naviris 3, en la app de verdad: naviris.site y las releases de
// GitHub se sirven desde la propia app (protocol.handle de https en la sesión por
// defecto, que es la que usan net.request y net.fetch del proceso principal), así
// se prueba sin salir a internet:
// · addons: el catálogo FIRMADO del repo instala; código tocado, catálogo tocado o
//   sin firma no instalan y lo dicen; lo ya instalado sigue funcionando;
// · actualizador: sin firma o con firma que no vale, no se descarga nada y la
//   interfaz manda a la web. (Que una firma buena deja pasar lo prueban
//   test/firmas.test.js y test/actualizador.test.js: aquí la app solo acepta la
//   clave real, y la privada no se toca en las pruebas.)
// NAVIRIS_E2E_PUERTO=9408 node --test test/e2e/firmas.e2e.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { arranca, conecta, hasta, RAIZ, PUERTO } = require('./naviris');

const PUERTO_MAIN = PUERTO + 100;
const ADDONS = path.join(RAIZ, 'addons');
const enLF = (t) => t.replace(/\r\n/g, '\n');
const CATALOGO = enLF(fs.readFileSync(path.join(ADDONS, 'catalog.json'), 'utf8'));
const FIRMA = fs.readFileSync(path.join(ADDONS, 'catalog.json.sig'), 'utf8');
const codigo = (id) => enLF(fs.readFileSync(path.join(ADDONS, id + '.js'), 'utf8'));

let app, principal;
const enMain = async (expr) => {
  const r = await principal.envia('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
// Lo que contesta "internet": url (sin ?t=) -> texto. Lo que no esté, 404.
const sirve = (rutas) => enMain(`globalThis.__rutasFirmas = ${JSON.stringify(rutas)}; return 1;`);
const naviris = (archivo) => 'https://naviris.site/addons/' + archivo;
const catalogoBueno = () => ({ [naviris('catalog.json')]: CATALOGO, [naviris('catalog.json.sig')]: FIRMA });

test.before(async () => {
  app = await arranca([`--inspect=${PUERTO_MAIN}`]);
  const dbg = (await (await fetch(`http://127.0.0.1:${PUERTO_MAIN}/json/list`)).json())[0];
  principal = await conecta(dbg.webSocketDebuggerUrl);
  await principal.envia('Runtime.enable');
  await enMain(`
    const { session, net } = require('electron');
    globalThis.__rutasFirmas = {};
    session.defaultSession.protocol.handle('https', (req) => {
      const url = req.url.split('?')[0];
      const r = globalThis.__rutasFirmas[url];
      if (r !== undefined) return new Response(r, { status: 200 });
      if (/^https:\\/\\/(naviris\\.site|github\\.com)\\//.test(url)) return new Response('no está', { status: 404 });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    // Ninguna descarga de verdad: solo se cuenta si electron-updater llegaría a bajar algo
    const { autoUpdater } = require('electron-updater');
    globalThis.__descargas = 0;
    autoUpdater.downloadUpdate = async () => { globalThis.__descargas++; return []; };
    return 1;`);
});
test.after(async () => {
  principal?.cierra();
  await app?.cierra();
});

const ui = (expr) => app.ui.evalua(expr);
const instala = (meta) => ui(`window.navirisApp.addonsInstall(${JSON.stringify(meta)})`);
const instalados = () => ui('window.navirisApp.addonsList()');
const archivo = (id) => path.join(app.perfil, 'addons', id + '.js');

test('addons: con el catálogo firmado del repo se instala, y lo que se guarda es lo del catálogo, no lo que mande la interfaz', async () => {
  await sirve({ ...catalogoBueno(), [naviris('design-lens.js')]: codigo('design-lens').replace(/\n/g, '\r\n') });
  const cat = await ui('window.navirisApp.addonsCatalog()');
  assert.equal(cat.ok, true, cat.message);
  assert.ok(cat.addons.length >= 7 && cat.addons.every((a) => /^[0-9a-f]{64}$/.test(a.sha256)));
  // La interfaz manda otro nombre y otro origen: cuenta solo el id
  const r = await instala({ id: 'design-lens', name: 'Falso', version: '9.9.9', entry: naviris('otro.js') });
  assert.equal(r.ok, true, r.message);
  const inst = (await instalados())['design-lens'];
  assert.equal(inst.name, 'Inspector de diseño');
  assert.equal(inst.version, JSON.parse(CATALOGO).addons.find((a) => a.id === 'design-lens').version);
  assert.equal(fs.readFileSync(archivo('design-lens'), 'utf8'), codigo('design-lens'), 'se guarda el código verificado, en LF');
});

test('addons: código con otra huella no se instala y se dice', async () => {
  await sirve({ ...catalogoBueno(), [naviris('sound-booster.js')]: codigo('sound-booster') + '\nfetch("https://example.com/robo");\n' });
  const r = await instala({ id: 'sound-booster' });
  assert.equal(r.ok, false);
  assert.match(r.message, /no coincide con el catálogo verificado/);
  assert.equal(fs.existsSync(archivo('sound-booster')), false);
  assert.equal((await instalados())['sound-booster'], undefined);
});

test('addons: catálogo tocado o sin firma no se acepta, y lo instalado sigue funcionando', async () => {
  const tocado = CATALOGO.replace(/"entry": "https:\/\/naviris\.site\/addons\/x-sensitive\.js"/, '"entry": "https://naviris.site/addons/otro.js"');
  assert.notEqual(tocado, CATALOGO);
  for (const rutas of [
    { [naviris('catalog.json')]: tocado, [naviris('catalog.json.sig')]: FIRMA, [naviris('otro.js')]: 'alert(1)' },
    { [naviris('catalog.json')]: CATALOGO, [naviris('x-sensitive.js')]: codigo('x-sensitive') }
  ]) {
    await sirve(rutas);
    const cat = await ui('window.navirisApp.addonsCatalog()');
    assert.equal(cat.ok, false);
    assert.match(cat.message, /No se pudo verificar el catálogo de addons/);
    const r = await instala({ id: 'x-sensitive' });
    assert.equal(r.ok, false);
    assert.match(r.message, /No se pudo verificar el catálogo/);
    assert.equal(fs.existsSync(archivo('x-sensitive')), false);
  }
  // La página de addons lo cuenta y sigue enseñando el instalado
  await ui('showAddonsPage()');
  await hasta(() => ui(`document.querySelector('#addons-list .adp-card') !== null`));
  const pagina = await ui(`document.getElementById('addons-list').textContent`);
  assert.match(pagina, /Inspector de diseño/);
  // El instalado sigue cargando en la interfaz como siempre (por naviris-addon://)
  assert.equal(await ui(`loadToolAddons().then(() => loadedTools.has('design-lens'))`), true);
  assert.equal(await ui(`!!document.querySelector('script[data-addon="design-lens"]')`), true);
  assert.equal((await instalados())['design-lens'].enabled, true);
});

// Lo que electron-updater habría leído de un feed: versión e instalador con su sha512
const SHA = crypto.createHash('sha512').update('instalador').digest('base64');
const FEED = `version: 3.0.1\nfiles:\n  - url: Naviris-Setup-3.0.1.exe\n    sha512: ${SHA}\n    size: 1000\npath: Naviris-Setup-3.0.1.exe\nsha512: ${SHA}\nreleaseDate: '2026-11-11T00:00:00.000Z'\n`;
const INFO = { version: '3.0.1', files: [{ url: 'Naviris-Setup-3.0.1.exe', sha512: SHA, size: 1000 }], path: 'Naviris-Setup-3.0.1.exe', sha512: SHA };
const RELEASE = 'https://github.com/DosaAKA2A/Naviris/releases/download/v3.0.1/latest.yml';

test('actualizador: sin firma no se descarga y el menú lleva a la web', async () => {
  await sirve({ [RELEASE]: FEED });
  await enMain(`require('electron-updater').autoUpdater.emit('update-available', ${JSON.stringify(INFO)}); return 1;`);
  await ui('window.navirisApp.updateDownload()');
  await hasta(() => ui(`!!updSoloWeb`));
  assert.equal(await enMain('return globalThis.__descargas;'), 0);
  assert.equal(await ui(`document.getElementById('menu-update').textContent`), 'Descargar la 3.0.1 desde la web');
  assert.equal(await ui(`updSoloWeb.web`), 'https://naviris.site/#descargar');
});

test('actualizador: con una firma que no vale tampoco, y en Acerca de se explica con el enlace a la web', async () => {
  // Firma con forma de firma pero de otra clave
  const otra = crypto.sign(null, Buffer.from('naviris-feed-1\n' + FEED), crypto.generateKeyPairSync('ed25519').privateKey).toString('base64');
  await sirve({ [RELEASE]: FEED, [RELEASE + '.sig']: otra });
  await ui(`showAbout(); updChosen = 'stable'; updBusy = true; 1`);
  await ui('window.navirisApp.updateDownload()');
  await hasta(() => ui(`!!document.querySelector('#upd-status .upd-web')`));
  assert.equal(await enMain('return globalThis.__descargas;'), 0);
  const estado = await ui(`({ texto: document.getElementById('upd-status').textContent, clase: document.getElementById('upd-status').className, ocupado: updBusy })`);
  assert.match(estado.texto, /No se pudo verificar la v3\.0\.1, así que no se descargó\. Descárgala desde la web de Naviris\./);
  assert.match(estado.texto, /Ir a naviris\.site/);
  assert.equal(estado.clase, 'err');
  assert.equal(estado.ocupado, false);
  await ui(`document.getElementById('about-modal').classList.add('hidden'); 1`);
});

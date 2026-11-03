// Carga src/webview-preload.js en un contexto vm, como si corriera en una página
// del sitio indicado, con Electron y el DOM sustituidos por piezas mínimas. Sirve
// para probar sin la app la lógica que el preload engancha a la página: los
// escuchadores que pone en window/document y lo que contesta a los mensajes de la
// interfaz ('cobalt-autoloot'…). Lo que la página tenga que encontrar en el DOM lo
// pone cada test en `dom` (selector -> elemento o lista).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RUTA = path.join(__dirname, '..', '..', 'src', 'webview-preload.js');

function cargaPreload(url, opciones = {}) {
  const u = new URL(url);
  const escuchas = [];                 // { donde: 'window'|'document', tipo, fn, captura }
  const enviados = [];                 // mensajes sendToHost: { canal, datos }
  const manejadores = {};              // ipcRenderer.on: canal -> fn
  const relojes = [];                  // setInterval/setTimeout pendientes (no corren solos)
  const almacen = new Map();
  const dom = opciones.dom || {};
  const escucha = (donde) => (tipo, fn, captura) => escuchas.push({ donde, tipo, fn, captura: !!(captura === true || (captura && captura.capture)) });
  const electron = {
    ipcRenderer: {
      sendSync: (canal) => (opciones.sendSync ? opciones.sendSync(canal) : (canal === 'preload:arranque' ? {} : false)),
      sendToHost: (canal, datos) => enviados.push({ canal, datos }),
      send: () => {},
      on: (canal, fn) => { manejadores[canal] = fn; },
      invoke: () => Promise.resolve()
    },
    contextBridge: { executeInMainWorld: () => {}, exposeInMainWorld: () => {} },
    webFrame: { executeJavaScript: () => Promise.resolve() }
  };
  const document = {
    readyState: 'loading',
    cookie: '',
    documentElement: { getAttribute: () => null, hasAttribute: () => false },
    body: {},
    addEventListener: escucha('document'),
    querySelector: (s) => { const v = dom[s]; return Array.isArray(v) ? v[0] || null : v || null; },
    querySelectorAll: (s) => { const v = dom[s]; return v ? (Array.isArray(v) ? v : [v]) : []; },
    getElementById: () => null
  };
  const reloj = (tipo) => (fn, ms) => { const r = { tipo, fn, ms, vivo: true }; relojes.push(r); return r; };
  const ctx = {
    require: (m) => { if (m === 'electron') return electron; throw new Error('require no previsto: ' + m); },
    console,
    URL,
    location: { hostname: u.hostname, href: u.href, pathname: u.pathname, origin: u.origin },
    navigator: { userAgent: 'test' },
    document,
    addEventListener: escucha('window'),
    removeEventListener: () => {},
    setTimeout: reloj('timeout'),
    setInterval: reloj('interval'),
    clearTimeout: (r) => { if (r) r.vivo = false; },
    clearInterval: (r) => { if (r) r.vivo = false; },
    MutationObserver: class { observe() {} disconnect() {} },
    WeakSet,
    localStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => almacen.set(k, String(v)),
      removeItem: (k) => almacen.delete(k)
    },
    fetch: () => Promise.reject(new Error('sin red en los tests')),
    Event: class { constructor(t) { this.type = t; } }
  };
  // Reloj de mentira para lo que mira Date.now() (las esperas entre reclamos)
  if (opciones.ahora) ctx.Date = class extends Date { static now() { return opciones.ahora(); } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(RUTA, 'utf8'), ctx, { filename: RUTA });
  // Ejecuta los temporizadores pendientes (una pasada; los intervalos siguen vivos)
  function corre(tipo) {
    for (const r of relojes.slice()) if (r.vivo && (!tipo || r.tipo === tipo)) { if (r.tipo === 'timeout') r.vivo = false; r.fn(); }
  }
  return { ctx, escuchas, enviados, manejadores, relojes, corre, almacen, dom };
}

module.exports = { cargaPreload };

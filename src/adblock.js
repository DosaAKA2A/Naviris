// Bloqueador de anuncios con el motor de Brave (adblock-rs, el crate adblock-rust
// oficial compilado para Node) y las MISMAS listas que usa Brave: se leen de su
// catálogo público y se refrescan solas cada día, así los cambios que Brave
// publica llegan sin actualizar Naviris.
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generarRecursos } = require('./adblock-recursos');

let Engine = null, FilterSet = null;
try { ({ Engine, FilterSet } = require('adblock-rs')); } catch (e) { console.log('[Naviris] adblock-rs no disponible:', e.message); }

const CATALOG_URL = 'https://raw.githubusercontent.com/brave/adblock-resources/master/filter_lists/list_catalog.json';
const REFRESH_MS = 24 * 3600 * 1000; // cadencia de actualización de listas y recursos
// Tope para regenerar TODOS los recursos (unos 80 archivos pequeños de GitHub).
// Si no da tiempo, se sigue con los que ya había: mejor viejos que a medias.
const RECURSOS_TOPE_MS = 120 * 1000;

const dir = () => path.join(app.getPath('userData'), 'adblock');
/* Las reglas se guardan separadas por su máscara de permisos. La de confianza
   (1) conserva el nombre de siempre, brave-rules.txt: lo que hay ahí en un
   perfil antiguo son justo las listas por defecto de Brave, que en su catálogo
   llevan todas `permission_mask: 1`, así que se sigue leyendo como de confianza
   sin tener que bajar nada al actualizar. */
const rulesFile = (mascara) => path.join(dir(), mascara === 1 ? 'brave-rules.txt' : 'brave-rules-p' + mascara + '.txt');
const metaFile = () => path.join(dir(), 'meta.json');
const recursosFile = () => path.join(dir(), 'resources.json');
// La copia de respaldo que viaja con la app (npm run adblock-recursos).
const recursosPaquete = path.join(__dirname, '..', 'resources', 'adblock');

let engine = null;
let meta = { updated: 0, lists: 0 };
let refreshing = false;

// Descarga con tope: una lista que se queda colgada dejaba `refreshing` en true
// y las listas ya no se volvían a actualizar hasta reiniciar Naviris. Junta los
// trozos como Buffer y decodifica al final: sumarlos como texto partía los
// caracteres de varios bytes que cayeran justo en el borde de un trozo.
function fetchBuffer(url, topeMs = 60000) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const trozos = [];
    const tope = setTimeout(() => { req.abort(); reject(new Error('sin respuesta ' + url)); }, topeMs);
    req.on('response', (res) => {
      if (res.statusCode !== 200) { clearTimeout(tope); reject(new Error('HTTP ' + res.statusCode + ' ' + url)); return; }
      res.on('data', (c) => { trozos.push(c); });
      res.on('end', () => { clearTimeout(tope); resolve(Buffer.concat(trozos)); });
      res.on('error', (e) => { clearTimeout(tope); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(tope); reject(e); });
    req.end();
  });
}
const fetchText = async (url) => (await fetchBuffer(url)).toString('utf8');

/* ---------- Recursos (scriptlets y sustitutos) ----------
   Hay dos copias posibles: la del paquete (se genera al compilar Naviris) y la
   que la app regenera ella sola cada 24 h en <userData>/adblock. Se usa la más
   nueva: tras actualizar Naviris, la del paquete puede ser más reciente que la
   guardada en el perfil. */
function leerJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function copiasDeRecursos() {
  const paquete = leerJSON(path.join(recursosPaquete, 'meta.json')) || {};
  const perfil = meta.recursos || {};
  return [
    { origen: 'perfil', archivo: recursosFile(), fecha: perfil.updated || 0, resumen: perfil },
    { origen: 'paquete', archivo: path.join(recursosPaquete, 'resources.json'), fecha: paquete.generado || 0, resumen: paquete }
  ].filter((o) => fs.existsSync(o.archivo)).sort((a, b) => b.fecha - a.fecha);
}

function recursosEnDisco() {
  for (const o of copiasDeRecursos()) {
    const lista = leerJSON(o.archivo);
    if (Array.isArray(lista) && lista.length) return { ...o, lista };
  }
  return null;
}

async function bajarRecursos() {
  const limite = Date.now() + RECURSOS_TOPE_MS;
  const bajar = (url) => {
    const queda = limite - Date.now();
    if (queda <= 0) return Promise.reject(new Error('tope de tiempo de los recursos'));
    return fetchBuffer(url, Math.min(60000, queda));
  };
  return generarRecursos(bajar);
}

function logRecursos(r) {
  if (!r) { console.log('[Naviris] Adblock sin recursos: sin scriptlets ni sustitutos'); return; }
  const s = r.resumen || {};
  const fecha = r.fecha ? new Date(r.fecha).toLocaleString('es-ES') : 'fecha desconocida';
  console.log('[Naviris] Recursos del adblock:', r.lista.length, 'recursos (' + (s.scriptlets ?? '?'), 'scriptlets de uBlock,',
    (s.confianza ?? '?'), 'de confianza;', (s.sustitutos ?? '?'), 'sustitutos;', (s.brave ?? '?'), 'de Brave), del', fecha, '(' + r.origen + ')');
}

/* ---------- Listas ----------
   `grupos` es un Map máscara -> texto de reglas. Cada grupo se parsea con SU
   máscara de permisos: los scriptlets `trusted-*` (los que reescriben las
   respuestas del reproductor de YouTube, por ejemplo) solo se inyectan si la
   lista que los pide se parseó con el permiso que exigen. Brave marca así sus
   listas en el catálogo (`permission_mask`); parsear todo junto sin máscara
   dejaba esos scriptlets fuera. */
function leerListas() {
  const grupos = new Map();
  for (const m of meta.mascaras || [1]) {
    try { grupos.set(m, fs.readFileSync(rulesFile(m), 'utf8')); } catch { /* ese grupo no está */ }
  }
  return grupos;
}

async function bajarListas() {
  const catalog = JSON.parse(await fetchText(CATALOG_URL));
  const fuentes = [];
  for (const list of catalog) {
    if (!list.default_enabled) continue; // el mismo conjunto activo por defecto en Brave
    // Las de otra plataforma, fuera: "Brave IOS-Specific Filters" viene activa
    // por defecto pero es solo para iOS (`platforms: ["IOS"]`), y con los
    // recursos cargados sus scriptlets pasarían a ejecutarse aquí (en YouTube
    // fuerza `visibilityState` a 'visible' para el vídeo en segundo plano del
    // móvil). Brave de escritorio tampoco la carga.
    if (Array.isArray(list.platforms) && list.platforms.length && !list.platforms.includes('WINDOWS')) continue;
    const mascara = Number(list.permission_mask) || 0;
    for (const s of list.sources || []) if (s.url) fuentes.push({ url: s.url, mascara });
  }
  const grupos = new Map();
  let okLists = 0;
  for (const f of fuentes) {
    try {
      const texto = await fetchText(f.url);
      grupos.set(f.mascara, (grupos.get(f.mascara) || '') + texto + '\n');
      okLists++;
    } catch (e) { /* una lista caída no rompe el resto */ }
  }
  if (!okLists) throw new Error('ninguna lista descargada');
  return { grupos, okLists };
}

function buildEngine(grupos, recursos) {
  if (!Engine) return;
  const t0 = Date.now();
  // false = sin modo depuración: guardaba el texto de cada regla (unos 8 MB más
  // en el proceso principal, medido) y no cambia qué se bloquea.
  const set = new FilterSet(false);
  // Siempre con objeto de opciones: el binding lanza si recibe `undefined`.
  for (const [mascara, texto] of grupos) set.addFilters(texto, { permissions: mascara });
  const e = new Engine(set);
  const t1 = Date.now();
  // Los recursos completos (unos 1 MB de JSON, 216 en octubre de 2026) cuestan
  // 3 ms y alrededor de 1 MB más de memoria en el proceso principal (medido con
  // el recolector forzado); el motor con las listas, unos 170 ms.
  if (recursos) { try { e.useResources(recursos); } catch (err) { console.log('[Naviris] resources del adblock inválidos:', err.message); } }
  engine = e;
  console.log('[Naviris] Motor del adblock listo en', t1 - t0, 'ms (+' + (Date.now() - t1), 'ms los recursos)');
}

async function refresh(force = false) {
  if (!Engine || refreshing) return;
  const ahora = Date.now();
  // `mascaras` falta en los perfiles de antes de separar por permisos: se
  // rebajan las listas una vez para dejar fuera la de iOS (ver bajarListas).
  const tocanListas = force || !meta.mascaras || ahora - meta.updated >= REFRESH_MS;
  const copias = copiasDeRecursos();
  const tocanRecursos = force || !copias.length || ahora - copias[0].fecha >= REFRESH_MS;
  if (!tocanListas && !tocanRecursos) return;
  refreshing = true;
  try {
    let grupos = null, recursos = null;
    if (tocanListas) {
      try {
        const r = await bajarListas();
        grupos = r.grupos;
        fs.mkdirSync(dir(), { recursive: true });
        for (const [m, texto] of grupos) fs.writeFileSync(rulesFile(m), texto, 'utf8');
        meta = { ...meta, updated: Date.now(), lists: r.okLists, mascaras: [...grupos.keys()] };
        fs.writeFileSync(metaFile(), JSON.stringify(meta), 'utf8');
        let kb = 0; for (const t of grupos.values()) kb += t.length / 1024;
        console.log('[Naviris] Listas de Brave actualizadas:', r.okLists, 'listas,', Math.round(kb), 'KB');
      } catch (e) {
        console.log('[Naviris] No se pudieron actualizar las listas de Brave:', e.message);
      }
    }
    if (tocanRecursos) {
      try {
        const { recursos: lista, resumen } = await bajarRecursos();
        fs.mkdirSync(dir(), { recursive: true });
        fs.writeFileSync(recursosFile(), JSON.stringify(lista), 'utf8');
        meta = { ...meta, recursos: { updated: Date.now(), ...resumen } };
        fs.writeFileSync(metaFile(), JSON.stringify(meta), 'utf8');
        recursos = { origen: 'red', fecha: meta.recursos.updated, resumen, lista };
        logRecursos(recursos);
      } catch (e) {
        console.log('[Naviris] No se pudieron regenerar los recursos del adblock (sigue con los que había):', e.message);
      }
    }
    if (grupos || recursos) {
      const g = grupos || leerListas();
      if (!recursos) { recursos = recursosEnDisco(); logRecursos(recursos); }
      if (g.size) buildEngine(g, recursos && recursos.lista);
    }
  } finally {
    refreshing = false;
  }
}

function init() {
  if (!Engine) return;
  // Arranca con la copia en disco (si existe) y refresca en segundo plano
  try {
    meta = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
  } catch (e) { meta = { updated: 0, lists: 0 }; }
  try {
    const grupos = leerListas();
    if (grupos.size) {
      const r = recursosEnDisco();
      logRecursos(r);
      buildEngine(grupos, r && r.lista);
    }
  } catch (e) { console.log('[Naviris] No se pudo cargar la caché del adblock:', e.message); }
  setTimeout(() => refresh(), 15000);           // tras el arranque, sin bloquearlo
  setInterval(() => refresh(), 6 * 3600 * 1000); // y comprueba cada 6 h (aplica si tocan 24 h)
}

const TYPE_MAP = {
  mainFrame: 'document', subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script',
  image: 'image', font: 'font', object: 'object', xhr: 'xmlhttprequest', ping: 'ping',
  cspReport: 'csp_report', media: 'media', webSocket: 'websocket', other: 'other'
};

/* ---------- Sustitutos (`$redirect=`) ----------
   El motor entrega cada sustituto como un data: URL, pero Electron NO sigue
   un redirectURL de onBeforeRequest hacia data: en las peticiones de una
   página: el <script> salta con error y el fetch falla, exactamente igual que
   si se cancelara (medido en Electron 42 con ad_status.js). Lo que sí sigue es
   un redirect a un esquema propio servido con protocol.handle, así que el
   sustituto se sirve por ahí: main registra ESQUEMA_SUSTITUTOS en cada sesión
   y responde con sustituto(url).
   Cada sustituto recibe un identificador aleatorio en vez de su nombre o su
   huella: una web no puede adivinar la dirección para preguntar si existe y
   así saber que navega con Naviris y su bloqueador. */
const ESQUEMA_SUSTITUTOS = 'naviris-sustituto';
const urlPorData = new Map();   // data: URL del motor -> URL propia
const sustitutoPorId = new Map(); // id -> { mime, cuerpo }

function urlDeSustituto(dataUrl) {
  const hecha = urlPorData.get(dataUrl);
  if (hecha) return hecha;
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  // Hay unos pocos cientos de recursos como mucho; el tope solo evita que
  // crezca sin fin si cambian mucho entre actualizaciones.
  if (sustitutoPorId.size >= 500) { sustitutoPorId.clear(); urlPorData.clear(); }
  const id = crypto.randomBytes(9).toString('hex');
  // Copia con memoria propia: un Buffer pequeño de Node comparte el bloque de
  // memoria con otros, y este se entrega una y otra vez como cuerpo de respuesta.
  sustitutoPorId.set(id, { mime: m[1], cuerpo: Uint8Array.from(Buffer.from(m[2], 'base64')) });
  const url = ESQUEMA_SUSTITUTOS + '://r/' + id;
  urlPorData.set(dataUrl, url);
  return url;
}

// Para el protocol.handle de main: { mime, cuerpo } o null si no existe.
function sustituto(url) {
  try { return sustitutoPorId.get(new URL(url).pathname.replace(/^\/+/, '')) || null; } catch { return null; }
}

/* Qué hacer con una petición. null = sin motor (main usa el respaldo clásico
   por dominios); si no, { bloquear, sustituto, reescrita }.
   · sustituto: URL (de ESQUEMA_SUSTITUTOS) del recurso que pide una regla
     `$redirect=`. Se sirve EN LUGAR de cancelar: hay webs que comprueban si su
     script de anuncios llegó a cargar y, si lo cortas, saben que hay
     bloqueador. El caso de libro es YouTube con ad_status.js, que tiene que
     dejar puesto `google_ad_status = 1`. Solo cuenta si la petición se
     bloquea: así lo hace Brave, porque un `$redirect-rule` trae sustituto sin
     bloquear y solo se aplica si OTRA regla bloquea.
   · reescrita: la URL sin los parámetros que quita `$removeparam`, que solo
     vale si la petición NO se bloquea.
   Pedir el resultado completo cuesta unos 2 µs más por petición que pedir
   solo el sí/no (medido: 8,1 frente a 6,2 µs). */
function check(details) {
  if (!engine) return null;
  try {
    const source = details.referrer || details.url;
    const r = engine.check(details.url, source, TYPE_MAP[details.resourceType] || 'other', details.method || 'GET', true);
    const bloquear = !!r.should_block;
    return {
      bloquear,
      sustituto: bloquear && r.redirect ? urlDeSustituto(r.redirect) : null,
      reescrita: !bloquear && r.rewritten_url ? r.rewritten_url : null
    };
  } catch (e) { return null; }
}

// CSS de ocultado (element hiding de las listas). Los scriptlets van aparte,
// por scriptletsFor(): se inyectan desde el preload, al empezar el documento.
function cosmeticsFor(url) {
  if (!engine) return null;
  try {
    const r = engine.urlCosmeticResources(url);
    if (!r) return null;
    let css = '';
    /* Los avisos de cookies NO se esconden. Las listas de Brave tapan el de
       YouTube (`##ytd-consent-bump-renderer`, `div[class^="ytd-consent"]`),
       pero el aviso sigue montado y su componente PAUSA el reproductor cada
       100 ms mientras esté ahí (`pausePlayer` de la app): el video arrancaba y
       se quedaba parado a los 0,5 s sin que se viera por qué (Dosa,
       2026-09-19). Con el aviso a la vista se acepta una vez y no vuelve. */
    const sel = (r.hide_selectors || []).filter((s) => !/consent/i.test(s));
    for (let i = 0; i < sel.length; i += 200) css += sel.slice(i, i + 200).join(',') + '{display:none !important}\n';
    return { css };
  } catch (e) { return null; }
}

/* Scriptlets (`##+js(...)`) de una URL, ya envueltos para inyectarse UNA vez
   en el mundo principal al empezar el documento (lo hace webview-preload.js).
   adblock-rust junta todos los de la URL en un solo texto: primero las
   funciones (las de apoyo y las de cada scriptlet) y luego una llamada por
   regla, cada una en su try/catch. Aquí se mete en una función anónima, como
   hace uBlock con su scriptlet.template.js, por dos motivos:
     · `scriptletGlobals`: los scriptlets de uBlock la usan sin declararla
       (safeSelf() la lee nada más empezar) porque la pone ese envoltorio. Sin
       ella, TODOS lanzaban un ReferenceError que su propio try/catch se
       tragaba: no hacían nada y no se notaba.
     · Así sus funciones (jsonPrune, safeSelf...) no quedan como globales de la
       página, donde la web podría verlas o pisarlas. */
function scriptletsFor(url) {
  if (!engine) return '';
  try {
    const r = engine.urlCosmeticResources(url);
    const s = r && r.injected_script;
    if (!s) return '';
    return '(function () {\nconst scriptletGlobals = {};\n' + s + '\n})();';
  } catch (e) { return ''; }
}

function status() {
  return { engine: !!engine, lists: meta.lists, updated: meta.updated };
}

module.exports = { init, refresh, check, sustituto, ESQUEMA_SUSTITUTOS, cosmeticsFor, scriptletsFor, status };

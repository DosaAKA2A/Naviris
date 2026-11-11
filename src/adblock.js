// Bloqueador de anuncios con el motor de Brave (adblock-rs, el crate adblock-rust
// oficial compilado para Node) y las MISMAS listas que usa Brave: se leen de su
// catálogo público y se refrescan solas cada día, así los cambios que Brave
// publica llegan sin actualizar Naviris. Más la que uBlock trae por defecto y
// Brave no (LISTAS_UBLOCK).
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { generarRecursos } = require('./adblock-recursos');
const { montaMotor } = require('./adblock-motor');

let Engine = null, FilterSet = null;
try { ({ Engine, FilterSet } = require('adblock-rs')); } catch (e) { console.log('[Naviris] adblock-rs no disponible:', e.message); }

const CATALOG_URL = 'https://raw.githubusercontent.com/brave/adblock-resources/master/filter_lists/list_catalog.json';
/* Listas que uBlock Origin trae activadas por defecto y el catálogo de Brave
   no. De su conjunto por defecto (assets.json) solo falta esta: la de Peter
   Lowe, unos 3.500 dominios de anuncios y rastreo (+3 en adblock.turtlecute.org,
   sin coste medible al montar ni en memoria; medido el 03/11/2026). Va sin
   permisos (máscara 0): son solo reglas de red y no le hace falta inyectar
   scriptlets de confianza. */
const LISTAS_UBLOCK = ['https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext'];
/* Listas que Brave activa por defecto y Naviris NO baja (por su uuid del catálogo).
   · «Cookie notice blocker» (EasyList Cookie, uBlock filters – Cookie Notices y
     los añadidos de Brave): acepta o cierra sola los avisos de consentimiento
     de cookies, con clics automáticos (`trusted-click-element`), cookies de
     consentimiento puestas a mano y CSS que los esconde. Decisión de Dosa
     (03/11/2026): acepta o rechaza la persona, en todas las webs. Era también
     la única que traía el clic automático en el aviso de YouTube que provocaba
     el bucle de recargas (21/10/2026), que antes se quitaba regla a regla.
     Medido sin ella: el resto de listas no trae ningún clic de consentimiento. */
const LISTAS_FUERA = ['AC023D22-AE88-4060-A978-4FEEEC4221693'];
// Con qué fuentes se bajaron las listas del perfil: si cambian, se vuelven a bajar.
const claveFuentes = [...LISTAS_UBLOCK, ...LISTAS_FUERA.map((id) => 'sin ' + id)].join(' ');
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

// Las URL que se bajan del catálogo de Brave, cada una con su máscara de permisos.
function fuentesDe(catalog) {
  const fuentes = [];
  for (const list of catalog) {
    if (!list.default_enabled) continue; // el mismo conjunto activo por defecto en Brave
    if (LISTAS_FUERA.includes(list.uuid)) continue;
    // Las de otra plataforma, fuera: "Brave IOS-Specific Filters" viene activa
    // por defecto pero es solo para iOS (`platforms: ["IOS"]`), y con los
    // recursos cargados sus scriptlets pasarían a ejecutarse aquí (en YouTube
    // fuerza `visibilityState` a 'visible' para el vídeo en segundo plano del
    // móvil). Brave de escritorio tampoco la carga.
    if (Array.isArray(list.platforms) && list.platforms.length && !list.platforms.includes('WINDOWS')) continue;
    const mascara = Number(list.permission_mask) || 0;
    for (const s of list.sources || []) if (s.url) fuentes.push({ url: s.url, mascara });
  }
  for (const url of LISTAS_UBLOCK) fuentes.push({ url, mascara: 0 });
  return fuentes;
}

async function bajarListas() {
  const fuentes = fuentesDe(JSON.parse(await fetchText(CATALOG_URL)));
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

/* El motor se monta en un hilo de trabajo (ver adblock-motor.js) y se guarda
   serializado en motor.bin: al arrancar se carga de ahí en unos 25 ms en vez
   de montarlo de nuevo (150-200 ms con el proceso principal parado, que es lo
   que se hacía en cada arranque). La clave dice con qué se montó: si cambian
   las listas, las reglas que se quitan o la versión de adblock-rs (su formato
   de serializado), no vale y se vuelve a montar. Los recursos no van dentro:
   se ponen aparte con useResources (3 ms). */
const motorFile = () => path.join(dir(), 'motor.bin');
let versionMotor = '';
try { versionMotor = require('adblock-rs/package.json').version; } catch { /* nada */ }
const claveMotor = () => JSON.stringify([versionMotor, meta.updated, meta.mascaras || [1]]);

function ponMotor(e, recursos, como, ms) {
  const t0 = Date.now();
  // Los recursos completos (unos 1 MB de JSON, 216 en octubre de 2026) cuestan
  // 3 ms y alrededor de 1 MB más de memoria en el proceso principal.
  if (recursos) { try { e.useResources(recursos); } catch (err) { console.log('[Naviris] resources del adblock inválidos:', err.message); } }
  engine = e;
  console.log('[Naviris] Motor del adblock listo (' + como + ') en', ms, 'ms (+' + (Date.now() - t0), 'ms los recursos)');
}

// Montaje en este mismo hilo: respaldo si el hilo de trabajo falla, y tests.
function buildEngine(grupos, recursos) {
  if (!Engine) return;
  const t0 = Date.now();
  ponMotor(montaMotor(grupos), recursos, 'montado en el hilo principal', Date.now() - t0);
}

/* Tope del hilo: montar cuesta 150-250 ms (medido). Si el hilo no contesta
   nunca (colgado, o parado por un depurador, que es como lo vio la parte
   «medición»), el bloqueador se quedaba apagado toda la sesión sin aviso: a los
   10 s se termina el hilo y se monta en el principal, como cuando falla. */
const HILO_TOPE_MS = 10000;
const HILO_MOTOR = path.join(__dirname, 'adblock-motor.js');

// `archivo` y `topeMs` solo cambian en los tests (un hilo que no contesta).
function montaEnHilo(grupos, { archivo = HILO_MOTOR, topeMs = HILO_TOPE_MS } = {}) {
  return new Promise((ok, no) => {
    const w = new Worker(archivo, { workerData: { motorDelBloqueador: true, grupos: [...grupos] } });
    const tope = setTimeout(() => {
      w.terminate();
      no(new Error('el hilo del motor no contestó en ' + topeMs / 1000 + ' s'));
    }, topeMs);
    const fin = (f) => (v) => { clearTimeout(tope); f(v); };
    w.once('message', fin(ok));
    w.once('error', fin(no));
    w.once('exit', fin((codigo) => no(new Error('el hilo del motor terminó con ' + codigo))));
  });
}

async function montaYGuarda(grupos, recursos, hilo) {
  const t0 = Date.now();
  let buf = null;
  try {
    buf = await montaEnHilo(grupos, hilo);
    const e = new Engine(new FilterSet(false));
    e.deserialize(buf);
    ponMotor(e, recursos, 'montado en un hilo aparte', Date.now() - t0);
  } catch (err) {
    console.log('[Naviris] Sin hilo para el motor del adblock, se monta aquí:', err.message);
    buildEngine(grupos, recursos);
    try { buf = engine.serialize(); } catch { buf = null; }
  }
  if (!buf) return;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(motorFile(), Buffer.from(buf));
    meta = { ...meta, motor: claveMotor() };
    fs.writeFileSync(metaFile(), JSON.stringify(meta), 'utf8');
  } catch (err) { console.log('[Naviris] No se pudo guardar el motor del adblock:', err.message); }
}

function motorDelDisco(recursos) {
  if (meta.motor !== claveMotor()) return false;
  try {
    const t0 = Date.now();
    const e = new Engine(new FilterSet(false));
    const b = fs.readFileSync(motorFile());
    e.deserialize(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    ponMotor(e, recursos, 'del disco', Date.now() - t0);
    return true;
  } catch (err) { console.log('[Naviris] motor.bin no vale, se vuelve a montar:', err.message); return false; }
}

async function refresh(force = false) {
  if (!Engine || refreshing) return;
  const ahora = Date.now();
  // `mascaras` falta en los perfiles de antes de separar por permisos: se
  // rebajan las listas una vez para dejar fuera la de iOS (ver bajarListas).
  // Lo mismo si cambian las fuentes (LISTAS_UBLOCK, LISTAS_FUERA): sin esperar 24 h.
  const tocanListas = force || !meta.mascaras || meta.fuentes !== claveFuentes || ahora - meta.updated >= REFRESH_MS;
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
        meta = { ...meta, updated: Date.now(), lists: r.okLists, mascaras: [...grupos.keys()], fuentes: claveFuentes };
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
    // Listas nuevas: motor nuevo (en el hilo aparte). Solo recursos nuevos: se
    // cambian en el motor que ya hay, sin volver a montarlo (antes se montaba
    // entero también en ese caso, cada vez que se regeneraban los recursos).
    if (grupos) {
      if (!recursos) { recursos = recursosEnDisco(); logRecursos(recursos); }
      if (grupos.size) await montaYGuarda(grupos, recursos && recursos.lista);
    } else if (recursos && engine) {
      try { engine.useResources(recursos.lista); } catch (err) { console.log('[Naviris] resources del adblock inválidos:', err.message); }
    } else if (recursos) {
      const g = leerListas();
      if (g.size) await montaYGuarda(g, recursos.lista);
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
  /* Listas bajadas con otras fuentes (un perfil de antes de LISTAS_FUERA): no se
     cargan, porque traen lo que Naviris ya no aplica (los clics en los avisos de
     cookies), y se vuelven a bajar ya. Mientras, la red usa el respaldo por
     dominios de main. */
  const viejas = !!meta.updated && meta.fuentes !== claveFuentes;
  try {
    const r = recursosEnDisco();
    logRecursos(r);
    if (viejas) console.log('[Naviris] Listas del adblock con otras fuentes: se vuelven a bajar antes de usarlas');
    else if (!motorDelDisco(r && r.lista)) {
      const grupos = leerListas();
      // Mientras se monta, refresh() espera: no puede pisarlo con otro motor.
      if (grupos.size) { refreshing = true; montaYGuarda(grupos, r && r.lista).finally(() => { refreshing = false; }); }
    }
  } catch (e) { console.log('[Naviris] No se pudo cargar la caché del adblock:', e.message); }
  setTimeout(() => refresh(), viejas ? 0 : 15000);  // tras el arranque, sin bloquearlo
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
/* `pagina`: la página de la pestaña (paginaDe en main). Hace falta cuando la
   petición no trae referrer (`no-referrer`, service workers): antes el origen
   pasaba a ser la PROPIA URL pedida, todo parecía de primera parte y las
   reglas `$third-party` y `$domain=` (también las excepciones) se evaluaban
   contra el host equivocado. Con referrer se sigue usando el referrer, que es
   el documento que pide (el del iframe, si viene de uno), como hace uBlock. */
function check(details, pagina) {
  if (!engine) return null;
  try {
    const source = details.referrer || pagina || details.url;
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
// por arranqueDe(): se inyectan desde el preload, al empezar el documento.
function cosmeticsFor(url) {
  if (!engine) return null;
  try {
    const r = engine.urlCosmeticResources(url);
    if (!r) return null;
    let css = '';
    const sel = sinAvisoDeCookies(r.hide_selectors || []);
    for (let i = 0; i < sel.length; i += 200) css += sel.slice(i, i + 200).join(',') + '{display:none !important}\n';
    return { css };
  } catch (e) { return null; }
}

/* Los avisos de consentimiento de cookies NO se esconden en ninguna web: los
   acepta o los rechaza la persona (Dosa, 03/11/2026; la lista de avisos de
   cookies tampoco se baja, ver LISTAS_FUERA). Las demás listas aún traen algún
   selector de aviso suelto, y esconderlo deja el aviso montado sin poder
   contestarlo. En YouTube (`##ytd-consent-bump-renderer`,
   `div[class^="ytd-consent"]`) su componente PAUSA el reproductor cada 100 ms
   mientras siga ahí (`pausePlayer` de la app): el video arrancaba y se quedaba
   parado a los 0,5 s sin que se viera por qué (Dosa, 2026-09-19). Con el aviso
   a la vista se contesta una vez y no vuelve. */
const sinAvisoDeCookies = (selectores) => selectores.filter((s) => !/consent/i.test(s));

/* Ocultado GENÉRICO por clase e id (`##.anuncio`, `###banner-ad`): son casi
   29.000 reglas de las listas (noviembre de 2026) que valen en cualquier sitio
   y que urlCosmeticResources NO devuelve, porque meterlas todas en cada página
   sería un CSS enorme. uBlock y Brave las aplican al vuelo: miran qué clases e
   ids hay en la página y piden al motor solo las reglas que casan con ellas.
   Aquí igual: el preload junta las clases e ids que aparecen (ver
   'adblock:genericos' en main) y esto devuelve los selectores que tocan, con
   las excepciones del sitio (`#@#`) ya descontadas. Hasta el 03/11/2026 no se
   aplicaban en ninguna parte: los anuncios de prueba "Static Ad" y "Dynamic Ad"
   de adblock.turtlecute.org quedaban a la vista. */
function genericosPara(url, clases, ids) {
  if (!engine) return [];
  try {
    const r = engine.urlCosmeticResources(url);
    if (!r || r.generichide) return [];
    return sinAvisoDeCookies(engine.hiddenClassIdSelectors(clases, ids, r.exceptions || []) || []);
  } catch (e) { return []; }
}

/* Scriptlets (`##+js(...)`) de una URL, ya envueltos para inyectarse UNA vez
   en el mundo principal al empezar el documento (lo hace webview-preload.js;
   en los iframes, main, ver 'did-frame-navigate').
   adblock-rust junta todos los de la URL en un solo texto: primero las
   funciones (las de apoyo y las de cada scriptlet) y luego una llamada por
   regla, cada una en su try/catch. Aquí se mete en una función anónima, como
   hace uBlock con su scriptlet.template.js, por dos motivos:
     · `scriptletGlobals`: los scriptlets de uBlock la usan sin declararla
       (safeSelf() la lee nada más empezar) porque la pone ese envoltorio. Sin
       ella, TODOS lanzaban un ReferenceError que su propio try/catch se
       tragaba: no hacían nada y no se notaba.
     · Así sus funciones (jsonPrune, safeSelf...) no quedan como globales de la
       página, donde la web podría verlas o pisarlas.
   Devuelve también `genericos`: si en este sitio vale el ocultado genérico por
   clase e id (no lo vale con `$generichide`, YouTube entre ellos), para que
   el preload no vigile la página si no hace falta. */
function arranqueDe(url) {
  const nada = { scriptlets: '', genericos: false };
  if (!engine) return nada;
  try {
    const r = engine.urlCosmeticResources(url);
    if (!r) return nada;
    const s = r.injected_script;
    return { scriptlets: s ? '(function () {\nconst scriptletGlobals = {};\n' + s + '\n})();' : '', genericos: !r.generichide };
  } catch (e) { return nada; }
}

function status() {
  return { engine: !!engine, lists: meta.lists, updated: meta.updated };
}

// buildEngine y montaYGuarda se exportan para los tests (test/adblock.test.js):
// montan el motor con listas y recursos fijos, sin red ni perfil.
module.exports = { init, refresh, check, sustituto, ESQUEMA_SUSTITUTOS, cosmeticsFor, genericosPara, arranqueDe, status, buildEngine, montaYGuarda, fuentesDe };

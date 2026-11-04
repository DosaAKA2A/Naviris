/* Lo que usa todo lo demás: elementos de la interfaz (els), store, ajustes, tema al arrancar, estado de las pestañas, utilidades, aviso (toast) y cuadro de texto. */

const $ = (s) => document.querySelector(s);
const IS_PRIVATE = new URLSearchParams(location.search).get('private') === '1';
// La sesión de las webs. Main solo la pasa si este arranque sigue en la vieja
// porque no se pudo pasar al nombre nuevo (ver migraNombre en migraciones.js).
const PARTITION = IS_PRIVATE ? 'naviris-private' : (new URLSearchParams(location.search).get('particion') || 'persist:naviris');
// Ventana abierta al sacar una pestaña de la barra: trae solo esa pestaña.
const SACADA = new URLSearchParams(location.search).get('sacada') === '1';

document.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = window.icon(el.dataset.ico) + el.innerHTML; });
document.querySelectorAll('[data-brand]').forEach((el) => { el.innerHTML = (window.brandIcon(el.dataset.brand) || '') + el.innerHTML; });
document.querySelectorAll('.iris-slot').forEach((el) => { el.innerHTML = window.irisLogo(+el.dataset.iris); });

const store = {
  get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); return true; } catch { return false; } }
};
// Las claves con el nombre viejo pasan a naviris.* antes de leer ninguna (ver migra-claves.js).
try { window.naviMigraClaves.migraClaves(localStorage); } catch (e) { console.warn('[Naviris] Claves de la interfaz pendientes:', e && e.message); }

const els = {};
[
  'tabstrip', 'newtab-btn', 'nav-back', 'nav-fwd', 'nav-reload', 'urlbar',
  'nav-shield', 'nav-star', 'nav-menu', 'menu-pop', 'bookmarks-bar', 'content', 'hub', 'widget-grid',
  'hub-edit', 'hub-customize', 'widget-palette', 'palette-list', 'customize-panel', 'bg-presets',
  'dial-modal', 'dial-name', 'dial-url', 'lib-grid', 'op-slider', 'op-valor', 'opt-restore', 'opt-powersaver', 'opt-gpu', 'opt-light', 'opt-atajos', 'opt-mousenav', 'opt-sonidos',
  'opt-agent', 'opt-updauto', 'opt-smartsearch', 'opt-passkeys', 'shield-pop', 'adblock-toggle', 'adblock-count', 'adblock-site', 'adblock-list',
  'media-panel', 'mp-title', 'mp-grid', 'mp-all', 'sb-home', 'sb-rat', 'sb-spotify',
  'sidebar', 'sb-media', 'sb-downloads', 'sb-history', 'sb-bookmarks', 'sb-passwords', 'sb-res', 'sb-settings', 'res-pop', 'res-list',
  'sb-loot', 'loot-panel', 'loot-close', 'loot-tab-ses', 'loot-tab-hist', 'loot-body',
  'history-panel', 'history-list', 'history-filter', 'history-clear', 'history-close',
  'pw-panel', 'pw-list', 'pw-form', 'pw-site', 'pw-user', 'pw-pass', 'pw-addbtn', 'pw-import', 'pw-cancel',
  'res-label', 'private-badge', 'toast', 'suggest',   'rat-pop', 'rat-url', 'rat-plat', 'rat-video', 'rat-audio', 'rat-note', 'rat-detect', 'rat-detect-logo',
  'rat-detect-name', 'rat-detect-url', 'rat-xtoggle', 'rat-xcheck', 'rat-qrow', 'rat-quality', 'dl-panel', 'dl-list',
  'rat-headsub', 'dl-page', 'dlp-filters', 'dlp-list', 'dlp-folder', 'dlp-active',
  'bm-page', 'bm-tree', 'bm-newfolder', 'bm-import', 'bm-filter', 'prompt-modal', 'prompt-title', 'prompt-input',
  'prompt-ok', 'prompt-cancel',   'perm-bar', 'perm-text', 'perm-remember', 'perm-allow', 'perm-block', 'perm-modal', 'perm-list', 'perm-clear-all', 'perm-modal-close',
  'pw-bar', 'pw-text', 'pw-no', 'pw-yes',
  'find-bar', 'find-input', 'find-count', 'find-prev', 'find-next', 'find-close',
  'sb-perf', 'hub-dock', 'perf-panel', 'perf-close', 'perf-resumen', 'perf-list', 'perf-nota', 'find-otras',
  'vtabs-col', 'vtabs-slot', 'vtabs-new', 'opt-vtabs', 'div-barra', 'div-salir', 'sb-espacios', 'esp-pop',
  'opt-buscador', 'opt-preguntar-descargas', 'tab-dialogo', 'td-tit', 'td-texto', 'td-url', 'td-valor', 'td-silencio', 'td-silenciar', 'td-cancelar', 'td-aceptar',
  'datos-modal', 'datos-periodo', 'datos-historial', 'datos-cookies', 'datos-cache', 'datos-cancelar', 'datos-borrar'
].forEach((id) => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

// 5 minutos dormía pestañas que seguías usando (te ibas a leer otra cosa y al
// volver ya se había recargado). Edge duerme a las 2 h y Chrome ronda ahí;
// 30 min es el punto en que ya no molesta y aún libera memoria de verdad.
const SLEEP_AFTER_MS = 30 * 60 * 1000;
let settings = { hardwareAcceleration: true, powerSaver: true };

/* Puente con el interruptor de modo claro, que existía antes que los temas y
   lo siguen llamando el arranque, los ajustes y la sincronización de la cuenta.
   Ojo: el tema rosa ES claro desde 2026-08-10 (rosa pastel), así que viaja como
   lightMode=true — con eso nativeTheme, scrollbars y webviews renderizan en
   claro. "Claro encendido" respeta el rosa elegido; apagar el modo claro sí
   lo pasa a oscuro (es lo que pide el interruptor). */
function applyTheme(light) {
  const t = temaActual();
  // Vuelve al ÚLTIMO tema de cada lado: con cuatro temas, ir y volver llevaba
  // siempre a Claro o a Naviris y se perdían Acid y Rosa (auditoría 2026-10).
  if (light) aplicaTema(esTemaClaro(t) ? t : store.get('naviris.temaClaro', 'claro'));
  else aplicaTema(esTemaClaro(t) ? store.get('naviris.temaOscuro', TEMA_POR_DEFECTO) : t);
}
/* Temas: cada uno es un juego de tokens en <html>. lightMode se mantiene
   porque los ajustes y la cuenta ya lo sincronizaban, y rosa se guarda aparte.

   OJO CON LOS NOMBRES (2026-08-21): la clave guardada y el nombre que se ve
   YA NO COINCIDEN. El tema que se llamaba "Naviris" (lima sobre carbon) pasa
   a llamarse ACID, y el blanco y negro pasa a ser "Naviris" y el
   PREDETERMINADO. Las claves NO se renombran a proposito: 'naviris.tema' y
   'naviris.hubBg.<tema>' ya estan escritas en el disco de todo el mundo, y la
   sincronizacion de la cuenta manda 'hubBgs' con estos nombres — renombrarlas
   obligaria a migrar cuatro claves y romperia el intercambio con la linea
   estable, que sigue mandando los de antes. Asi que la traduccion vive AQUI,
   en un solo sitio, y de aqui la leen el menu y el aviso. */
const TEMAS = ['mono', 'oscuro', 'claro', 'rosa'];   // en el orden del menu
const NOMBRES = { mono: 'Naviris', oscuro: 'Acid', claro: 'Claro', rosa: 'Rosa' };
// El tema de fabrica. Quien ya tiene uno elegido conserva el suyo: 'naviris.tema'
// se escribe en cada arranque, asi que esto solo lo estrenan los perfiles nuevos.
const TEMA_POR_DEFECTO = 'mono';
/* Que temas son CLAROS. Antes esto se escribia como 'tema !== oscuro' en
   cuatro sitios, y con 'mono' —que es oscuro— eso mandaba lightMode=true:
   nativeTheme, las scrollbars y los webviews habrian renderizado en claro
   debajo de una interfaz negra. */
const TEMAS_CLAROS = ['claro', 'rosa'];
const esTemaClaro = (t) => TEMAS_CLAROS.includes(t);
function temaActual() {
  const t = store.get('naviris.tema', null);
  if (TEMAS.includes(t)) return t;
  return store.get('naviris.lightMode', false) ? 'claro' : TEMA_POR_DEFECTO;
}
function aplicaTema(tema) {
  if (!TEMAS.includes(tema)) tema = TEMA_POR_DEFECTO;
  const raiz = document.documentElement;
  raiz.classList.toggle('light', tema === 'claro');
  raiz.classList.toggle('rosa', tema === 'rosa');
  raiz.classList.toggle('mono', tema === 'mono');
  store.set('naviris.tema', tema);
  store.set(esTemaClaro(tema) ? 'naviris.temaClaro' : 'naviris.temaOscuro', tema);
  store.set('naviris.lightMode', esTemaClaro(tema));
  // El fondo del hub tiene versión clara y oscura: se retraduce al cambiar de tema
  applyBackground(store.get(bgThemeKey(tema), null) || defaultBgTema());
  /* Y se REPINTA el hub: las fotos de los contenedores son las del tema activo
     (imagenDeTema) y se quedaban en las del tema anterior hasta que algo mas
     redibujaba. Va aqui, el paso unico por el que entra TODO cambio de tema
     (el menu Temas, el interruptor de modo claro y la cuenta), no solo en
     applyTheme — el menu llamaba directo a aplicaTema y se saltaba el repinte. */
  if (typeof renderHub === 'function' && els.hub && els.hub.classList.contains('active')) renderHub();
}
// Modo claro: la clase va en <html> para que los tokens de :root.light manden.
// Se aplica AQUÍ, antes de que cargue lo demás, leyendo el espejo de
// localStorage: los settings de verdad llegan por IPC más tarde y sin el
// espejo la interfaz arrancaría oscura y daría un fogonazo al cambiar.
(() => {
  const t = temaActual();
  document.documentElement.classList.toggle('light', t === 'claro');
  document.documentElement.classList.toggle('rosa', t === 'rosa');
  document.documentElement.classList.toggle('mono', t === 'mono');
})();
let tabs = [], activeId = null, nextId = 1;
let divId = null;   // pestaña acompañante de la pantalla dividida (ver barra-pestanas.js)
// Pestañas cerradas hace poco, para reabrirlas con Ctrl+Shift+T (como Chrome, las últimas 10).
const cerradas = [];

// Los servidores de casa (localhost, el router, la red local) casi nunca tienen https.
const ES_LOCAL = /^(localhost(?=[:/?#]|$)|127\.\d|10\.\d|192\.168\.\d|172\.(1[6-9]|2\d|3[01])\.\d)/i;
const toUrl = (input) => {
  const t = input.trim(); if (!t) return null;
  // "localhost:3000" o "miweb.com:8080/panel": eso es un puerto, no un esquema.
  const conPuerto = /^[\w.-]+:\d+(?=[/?#]|$)/.test(t);
  const hasScheme = !conPuerto && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t);
  const looksUrl = !t.includes(' ') && (hasScheme || conPuerto || t.includes('.') || /^localhost(?=[/?#]|$)/i.test(t));
  return looksUrl ? (hasScheme ? t : (ES_LOCAL.test(t) ? 'http://' : 'https://') + t) : window.naviBuscadores.urlDeBusqueda(settings.buscador, t);
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// El dominio que se enseña de una pestaña; si su dirección no es válida, la dirección tal cual.
const hostDeTab = (t) => { try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return t.url || ''; } };
const activeTab = () => tabs.find((t) => t.id === activeId) || null;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastTimer;
/* `accion` ({ label, alPulsar }) le pone un botón al aviso (el muro de YouTube).
   Con botón se queda 10 s y no se va mientras el ratón está encima: en los 3,2 s
   de un aviso normal no da tiempo a leerlo y llegar al botón. */
function toast(msg, accion = null) {
  const t = els.toast, quita = () => t.classList.remove('show');
  t.classList.toggle('con-accion', !!accion);
  t.onmouseenter = t.onmouseleave = null;
  if (accion) {
    const txt = document.createElement('span'); txt.textContent = msg;
    const b = document.createElement('button'); b.type = 'button'; b.textContent = accion.label;
    b.addEventListener('click', () => { clearTimeout(toastTimer); quita(); accion.alPulsar(); });
    t.replaceChildren(txt, b);
    t.onmouseenter = () => clearTimeout(toastTimer);
    t.onmouseleave = () => { clearTimeout(toastTimer); toastTimer = setTimeout(quita, 2500); };
  } else t.textContent = msg;
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(quita, accion ? 10000 : 3200);
}

/* Sonidos de Naviris (src/sonidos.js): suenan solo si el ajuste está activo */
const suena = (nombre) => { if (settings.sonidos !== false) window.navSonido(nombre); };

/* Modal de texto */
let promptCb = null;
// `opc`: { ok: texto del botón (por defecto "Crear"), valor: lo que ya trae escrito (seleccionado) }.
function promptModal(title, ph, cb, opc = {}) { els.promptTitle.textContent = title; els.promptInput.style.display = ''; els.promptInput.value = opc.valor || ''; els.promptInput.placeholder = ph || ''; els.promptOk.textContent = opc.ok || 'Crear'; els.promptModal.classList.remove('hidden'); els.promptInput.focus(); els.promptInput.select(); promptCb = cb; }
function promptConfirm(title, text, cb) {
  els.promptTitle.innerHTML = `${escapeHtml(title)}<br><span style="font-weight:400;color:var(--text-dim);font-size:13px">${escapeHtml(text)}</span>`;
  els.promptInput.style.display = 'none';
  els.promptOk.textContent = 'Borrar';
  els.promptModal.classList.remove('hidden');
  promptCb = () => cb();
}
els.promptOk.addEventListener('click', () => { els.promptModal.classList.add('hidden'); const cb = promptCb; promptCb = null; cb?.(els.promptInput.value); });
els.promptCancel.addEventListener('click', () => { els.promptModal.classList.add('hidden'); els.promptInput.type = 'text'; promptCb = null; });
els.promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.promptOk.click(); });

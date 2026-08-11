/* Naviris — renderer principal */
const $ = (s) => document.querySelector(s);
const IS_PRIVATE = new URLSearchParams(location.search).get('private') === '1';
const PARTITION = IS_PRIVATE ? 'cobalt-private' : 'persist:cobalt';

document.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = window.icon(el.dataset.ico) + el.innerHTML; });
document.querySelectorAll('[data-brand]').forEach((el) => { el.innerHTML = (window.brandIcon(el.dataset.brand) || '') + el.innerHTML; });
document.querySelectorAll('.iris-slot').forEach((el) => { el.innerHTML = window.irisLogo(+el.dataset.iris); });

const store = {
  get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};

const els = {};
[
  'splash', 'tabstrip', 'newtab-btn', 'nav-back', 'nav-fwd', 'nav-reload', 'nav-home', 'urlbar',
  'nav-shield', 'nav-star', 'nav-menu', 'menu-pop', 'bookmarks-bar', 'content', 'hub', 'widget-grid',
  'hub-edit', 'hub-customize', 'widget-palette', 'palette-list', 'customize-panel', 'bg-presets',
  'wp-file', 'dial-modal', 'dial-name', 'dial-url', 'opt-restore', 'opt-powersaver', 'opt-gpu', 'opt-light', 'opt-atajos', 'opt-mousenav',
  'opt-agent', 'opt-smartsearch', 'opt-passkeys', 'shield-pop', 'adblock-toggle', 'adblock-count', 'adblock-site', 'adblock-list',
  'media-panel', 'mp-title', 'mp-grid', 'mp-all', 'sb-home', 'sb-rat',
  'sb-media', 'sb-downloads', 'sb-history', 'sb-bookmarks', 'sb-passwords', 'sb-res', 'sb-settings', 'res-pop', 'res-list',
  'sb-loot', 'loot-panel', 'loot-close', 'loot-tab-ses', 'loot-tab-hist', 'loot-body',
  'history-panel', 'history-list', 'history-filter', 'history-clear', 'history-close',
  'pw-panel', 'pw-list', 'pw-form', 'pw-site', 'pw-user', 'pw-pass', 'pw-addbtn', 'pw-import', 'pw-cancel',
  'res-label', 'private-badge', 'toast', 'suggest',   'rat-pop', 'rat-url', 'rat-plat', 'rat-video', 'rat-audio', 'rat-note', 'rat-detect', 'rat-detect-logo',
  'rat-detect-name', 'rat-detect-url', 'rat-xtoggle', 'rat-xcheck', 'rat-qrow', 'rat-quality', 'dl-panel', 'dl-list',
  'rat-normal', 'rat-headsub', 'dl-page', 'dlp-filters', 'dlp-list', 'dlp-folder', 'dlp-active',
  'bm-page', 'bm-tree', 'bm-newfolder', 'bm-import', 'bm-filter', 'prompt-modal', 'prompt-title', 'prompt-input',
  'prompt-ok', 'prompt-cancel',   'perm-bar', 'perm-text', 'perm-remember', 'perm-allow', 'perm-block', 'perm-modal', 'perm-list', 'perm-clear-all', 'perm-modal-close',
  'pw-bar', 'pw-text', 'pw-no', 'pw-yes'
].forEach((id) => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

// 5 minutos dormía pestañas que seguías usando (te ibas a leer otra cosa y al
// volver ya se había recargado). Edge duerme a las 2 h y Chrome ronda ahí;
// 30 min es el punto en que ya no molesta y aún libera memoria de verdad.
const SLEEP_AFTER_MS = 30 * 60 * 1000;
let settings = { hardwareAcceleration: true, powerSaver: true };

// Modo claro: la clase va en <html> para que los tokens de :root.light manden.
// Se aplica AQUÍ, antes de que cargue lo demás, leyendo el espejo de
// localStorage: los settings de verdad llegan por IPC más tarde y sin el
// espejo la interfaz arrancaría oscura y daría un fogonazo al cambiar.
/* Puente con el interruptor de modo claro, que existía antes que los temas y
   lo siguen llamando el arranque, los ajustes y la sincronización de la cuenta.
   Ojo: el tema rosa ES claro desde 2026-08-10 (rosa pastel), así que viaja como
   lightMode=true — con eso nativeTheme, scrollbars y webviews renderizan en
   claro. "Claro encendido" respeta el rosa elegido; apagar el modo claro sí
   lo pasa a oscuro (es lo que pide el interruptor). */
function applyTheme(light) {
  const t = temaActual();
  if (light) aplicaTema(t === 'rosa' ? 'rosa' : 'claro');
  else aplicaTema(t === 'claro' || t === 'rosa' ? 'oscuro' : t);
}
/* Temas: 'oscuro' (el de siempre), 'claro' y 'rosa'. Cada uno es un juego de
   tokens en <html>; lightMode se mantiene porque los ajustes y la cuenta ya
   lo sincronizaban, y rosa se guarda aparte. */
const TEMAS = ['oscuro', 'claro', 'rosa'];
function temaActual() {
  const t = store.get('cobalt.tema', null);
  if (TEMAS.includes(t)) return t;
  return store.get('cobalt.lightMode', false) ? 'claro' : 'oscuro';
}
function aplicaTema(tema) {
  if (!TEMAS.includes(tema)) tema = 'oscuro';
  const raiz = document.documentElement;
  raiz.classList.toggle('light', tema === 'claro');
  raiz.classList.toggle('rosa', tema === 'rosa');
  store.set('cobalt.tema', tema);
  store.set('cobalt.lightMode', tema !== 'oscuro');
  // El fondo del hub tiene versión clara y oscura: se retraduce al cambiar de tema
  applyBackground(store.get('cobalt.hubBg', null) || BACKGROUNDS[0]);
}
(() => {
  // Antes de que cargue nada más, para que no haya fogonazo al cambiar.
  const t = temaActual();
  document.documentElement.classList.toggle('light', t === 'claro');
  document.documentElement.classList.toggle('rosa', t === 'rosa');
})();
let tabs = [], activeId = null, nextId = 1;
// Pestañas cerradas hace poco, para reabrirlas con Ctrl+Shift+T (como Chrome,
// las últimas 10). Se declara aquí arriba porque closeTab la usa.
const cerradas = [];

const toUrl = (input) => {
  const t = input.trim(); if (!t) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t);
  const looksUrl = !t.includes(' ') && (hasScheme || t.includes('.') || t === 'localhost');
  return looksUrl ? (hasScheme ? t : 'https://' + t) : 'https://www.google.com/search?q=' + encodeURIComponent(t);
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const activeTab = () => tabs.find((t) => t.id === activeId) || null;
// Detecta si una URL es de un vídeo descargable (YouTube /watch?, /shorts, youtu.be,
// TikTok /video|/photo, X /status, Instagram /reel|/reels|/p|/tv, etc.)
const isVideoUrl = (u) => /youtu\.be\/|\/(watch|shorts|video|status|reel|reels|clip|p|tv|embed)(\/|\?|$)/i.test(u || '');
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastTimer;
function toast(msg) { els.toast.textContent = msg; els.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200); }

/* ============ Menú contextual reutilizable ============ */
let ctxMenuEl = null;
function closeCtxMenu() { ctxMenuEl?.remove(); ctxMenuEl = null; }
window.addEventListener('mousedown', (e) => { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu(); });
window.addEventListener('blur', closeCtxMenu);
window.addEventListener('resize', closeCtxMenu);
function showCtxMenu(x, y, items) {
  closeCtxMenu();
  const m = document.createElement('div'); m.className = 'ctx-menu';
  for (const it of items) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; m.appendChild(s); continue; }
    const b = document.createElement('button'); b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.innerHTML = (it.icon ? `<span class="ctx-ic">${window.icon(it.icon)}</span>` : '') + `<span>${escapeHtml(it.label)}</span>`;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); closeCtxMenu(); it.action(); });
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  ctxMenuEl = m;
}
// Abre una URL en una pestaña de fondo, sin cambiar la pestaña actual
function openBackground(url) { createTab(url, false); toast('Abierto en segundo plano'); }
// Opciones comunes de un enlace (dial del hub, marcador…)
function linkMenu(url, onRemove) {
  const items = [
    { label: 'Abrir', icon: 'arrow-up-right', action: () => navigateActive(url) },
    { label: 'Abrir en segundo plano', icon: 'plus', action: () => openBackground(url) }
  ];
  if (onRemove) items.push({ sep: true }, { label: 'Eliminar', icon: 'trash', danger: true, action: onRemove });
  return items;
}

/* ============ Marcas → icono monocromo ============ */
const BRAND_BY_HOST = { 'youtube.com': 'youtube', 'youtu.be': 'youtube', 'twitch.tv': 'twitch', 'discord.com': 'discord', 'whatsapp.com': 'whatsapp', 'github.com': 'github', 'x.com': 'x', 'twitter.com': 'x', 'crunchyroll.com': 'crunchyroll', 'spotify.com': 'spotify', 'reddit.com': 'reddit', 'claude.ai': 'claude', 'mail.google.com': 'gmail', 'instagram.com': 'instagram' };
function brandOf(url) { const h = hostOf(url); for (const dom in BRAND_BY_HOST) if (h === dom || h.endsWith('.' + dom)) return BRAND_BY_HOST[dom]; return null; }

/* ============ Favicons + color ============ */
const tileCache = store.get('cobalt.tiles4', {});
const saveTiles = () => store.set('cobalt.tiles4', tileCache);

function dominantColor(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 32, 32);
      let d; try { d = ctx.getImageData(0, 0, 32, 32).data; } catch { return resolve(null); }
      const bk = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]; if (a < 200) continue;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 242 && mn > 230) continue; if (mx < 20) continue;
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
        const e = bk.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0 }; e.n++; e.r += r; e.g += g; e.b += b; e.s += sat; bk.set(key, e);
      }
      let best = null, bs = 0;
      for (const e of bk.values()) { const sc = e.n * (0.45 + (e.s / e.n) * 1.8); if (sc > bs) { bs = sc; best = e; } }
      resolve(best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
async function getTile(url) {
  const host = hostOf(url); if (!host) return null;
  const c = tileCache[host]; if (c && Date.now() - c.ts < 14 * 864e5) return c;
  const icon = await window.cobalt.fetchFavicon(url);
  const color = icon ? await dominantColor(icon) : null;
  const entry = { icon, color, ts: Date.now() };
  tileCache[host] = entry; saveTiles(); return entry;
}

/* ============ Historial ============ */
let history = IS_PRIVATE ? [] : store.get('cobalt.history', []);
function recordHistory(url, title) {
  if (IS_PRIVATE || !/^https?:/.test(url)) return;
  const i = history.findIndex((h) => h.url === url);
  if (i >= 0) { history[i].visits++; history[i].ts = Date.now(); if (title) history[i].title = title; }
  else history.push({ url, title: title || url, visits: 1, ts: Date.now() });
  if (history.length > 600) history = history.sort((a, b) => b.ts - a.ts).slice(0, 600);
  store.set('cobalt.history', history);
}

/* ============ Pestañas ============ */
function createTab(url = null, activate = true) {
  const tab = { id: nextId++, kind: url ? 'web' : 'hub', url: url || '', title: url ? 'Cargando…' : 'Nueva pestaña', webview: null, favicon: null, asleep: false, sleptUrl: null, lastActive: Date.now() };
  tabs.push(tab); if (url) attachWebview(tab, url); if (activate) activateTab(tab.id); renderTabs(); saveSession(); return tab;
}
// Guarda las URLs abiertas para restaurarlas al reabrir (si el ajuste está activo).
// No aplica en ventana privada. Se llama al crear/cerrar/navegar pestañas.
// Formato: string (histórico) u objeto { u, p } cuando la pestaña está fijada.
function saveSession() {
  if (IS_PRIVATE) return;
  // Se guardan también título y favicon: al reabrir, las pestañas entran
  // dormidas y sin eso se verían todas como "Cargando…" sin icono.
  const urls = tabs.filter((t) => t.kind === 'web' && t.url && /^https?:/.test(t.url))
    .map((t) => {
      const s = { u: t.sleptUrl || t.url, t: t.title || '', f: t.favicon || '' };
      if (t.pinned) s.p = 1;
      return s;
    });
  store.set('cobalt.session', urls);
}
/* Pestaña restaurada SIN cargar: se queda dormida hasta que se abre. El
   webview existe (en about:blank) para que despertarla sea solo cambiarle el
   src, igual que hace el ahorro de energía. */
function crearDormida(dato) {
  const url = typeof dato === 'string' ? dato : dato.u;
  const tab = {
    id: nextId++, kind: 'web', url, title: (dato && dato.t) || hostOf(url) || url,
    webview: null, favicon: (dato && dato.f) || null,
    asleep: true, sleptUrl: url, lastActive: 0
  };
  tabs.push(tab);
  attachWebview(tab, 'about:blank');
  tab.url = url;          // attachWebview lo había puesto en about:blank
  return tab;
}
let mediaTimer = null;
function attachWebview(tab, url) {
  const wv = document.createElement('webview');
  wv.setAttribute('allowpopups', ''); wv.setAttribute('partition', PARTITION); wv.src = url;
  tab.webview = wv; tab.kind = 'web'; tab.url = url;
  // Clic dentro de la página = cerrar los popovers de herramientas (esos
  // clics no burbujean hasta el document; el foco del webview sí avisa)
  wv.addEventListener('focus', () => { try { cerrarPopsHerramientas(); } catch { /* aún no cargó */ } });
  const onNav = (e) => {
    // Dormir una pestaña la manda a about:blank: NO pisar url/título/favicon,
    // al pasar el ratón debe seguir viéndose qué contenido tenía.
    if (tab.asleep || e.url === 'about:blank') return;
    tab.url = e.url; getTile(e.url).then((t) => { tab.favicon = t?.icon || null; renderTabs(); });
    if (tab.autoLoot) {
      const h = hostOf(e.url);
      // Solo se apaga al ir a OTRO sitio real: las URLs intermedias (about:blank,
      // redirecciones vacías) no cuentan como "salir de Twitch"
      if (/^https?:/i.test(e.url) && h && !/(^|\.)twitch\.tv$/.test(h)) {
        tab.autoLoot = false; tab.lowRes = false; tab.twitchClaims = 0; delete tab.lootStart; renderTabs();
      } else {
        // Navegación dentro de Twitch (SPA: buscar → entrar a un canal):
        // reengancha el recolector en la página nueva
        try { tab.webview?.send('cobalt-autoloot', { on: true, lowRes: !!tab.lowRes }); } catch { /* nada */ }
      }
    }
    // El botón AutoLoot de la topbar se recalcula en CADA navegación (antes solo
    // al cambiar de pestaña: era el bug de "abrí Twitch y no salía")
    if (tab.id === activeId) { syncNavUI(); updateLootUI(); if (!els.mediaPanel.classList.contains('hidden')) { clearTimeout(mediaTimer); mediaTimer = setTimeout(collectMedia, 600); } }
    saveSession();
  };
  wv.addEventListener('page-title-updated', (e) => { if (tab.asleep) return; tab.title = e.title || tab.title; if (tab.id === activeId) recordHistory(tab.url, tab.title); renderTabs(); });
  wv.addEventListener('did-navigate', onNav);
  wv.addEventListener('did-navigate-in-page', onNav);
  wv.addEventListener('did-start-loading', () => { if (tab.id === activeId) els.navReload.innerHTML = window.icon('x-mark'); });
  wv.addEventListener('did-stop-loading', () => { if (tab.id === activeId) { els.navReload.innerHTML = window.icon('arrow-path'); syncNavUI(); } });
  wv.addEventListener('media-started-playing', () => { tab.audible = true; if (tab.muted) { try { wv.setAudioMuted(true); } catch {} } renderTabs(); });
  wv.addEventListener('media-paused', () => { tab.audible = false; renderTabs(); });
  // Reanuda el AutoLoot tras recargar/navegar dentro de Twitch
  wv.addEventListener('dom-ready', () => { if (tab.autoLoot) { try { wv.send('cobalt-autoloot', { on: true, lowRes: !!tab.lowRes }); } catch {} } });
  wv.addEventListener('ipc-message', (e) => onWebviewMessage(wv, e));
  els.content.appendChild(wv);
}
function activateTab(id) {
  activeId = id; const tab = activeTab(); if (!tab) return; tab.lastActive = Date.now();
  if (tab.asleep && tab.webview) { tab.webview.src = tab.sleptUrl || tab.url; tab.asleep = false; tab.sleptUrl = null; }
  hideBookmarkPage(); hideAddonsPage(); hideDownloadsPage();
  els.hub.classList.toggle('active', tab.kind === 'hub');
  tabs.forEach((t) => {
    if (!t.webview || t.kind !== 'web') return;
    const active = t.id === id;
    t.webview.classList.toggle('active', active);
    // Las pestañas de AutoLoot inactivas quedan "vivas" (renderizadas fuera de
    // pantalla) para que sigan acumulando tiempo de drops
    t.webview.classList.toggle('loot-live', !active && !!t.autoLoot);
  });
  if (tab.kind === 'hub') { els.urlbar.value = ''; focusUrlbar(); }
  renderTabs(); syncNavUI(); applyResponsive(); updateLootUI();
  if (!els.mediaPanel.classList.contains('hidden')) collectMedia();
}
// Arranque con la sesión restaurada: se muestra el hub y las pestañas quedan
// dormidas en la barra, sin pestaña activa, hasta que se elige una.
function hubDeInicio() {
  activeId = null;
  hideBookmarkPage(); hideAddonsPage(); hideDownloadsPage();
  els.hub.classList.add('active');
  tabs.forEach((t) => { if (t.webview) t.webview.classList.remove('active'); });
  els.urlbar.value = '';
  syncNavUI();
}
// Pestaña nueva → foco en la BARRA DE DIRECCIONES (no en el buscador del hub):
// así la búsqueda inteligente sugiere desde la primera tecla.
function focusUrlbar() {
  requestAnimationFrame(() => { requestAnimationFrame(() => els.urlbar.focus()); });
}
// Si el hub está activo y el usuario empieza a teclear, el foco va a la barra
window.addEventListener('keydown', (e) => {
  if (!els.hub.classList.contains('active')) return;
  const t = document.activeElement; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) els.urlbar.focus();
});
function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id); if (idx === -1) return;
  recordarCerrada(tabs[idx]);   // para reabrirla con Ctrl+Shift+T
  tabs[idx].webview?.remove(); tabs.splice(idx, 1);
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) activateTab(tabs[Math.max(0, idx - 1)].id); else renderTabs();
  saveSession();
}
/* ===== Fijar pestañas: comprimidas (solo favicon) al lado izquierdo ===== */
function setPinned(tab, pin) {
  tab.pinned = !!pin;
  const i = tabs.findIndex((t) => t.id === tab.id); if (i === -1) return;
  tabs.splice(i, 1);
  // Fijada va al final del bloque de fijadas; soltada, justo después de él
  const limite = tabs.filter((t) => t.pinned).length;
  tabs.splice(limite, 0, tab);
  renderTabs(true); saveSession();
}
function copiarDireccion(tab) {
  const u = tab.sleptUrl || tab.url; if (!u) return;
  navigator.clipboard.writeText(u).then(() => toast('Dirección copiada'), () => toast('No se pudo copiar'));
}
function duplicarTab(tab) {
  const nueva = createTab(tab.sleptUrl || tab.url, false);
  // Se coloca justo a la derecha de la original, como en Opera/Chrome
  const from = tabs.findIndex((t) => t.id === nueva.id); tabs.splice(from, 1);
  tabs.splice(tabs.findIndex((t) => t.id === tab.id) + 1, 0, nueva);
  renderTabs(true); saveSession();
}
function menuDePestana(e, tab) {
  e.preventDefault();
  const web = tab.kind === 'web';
  const idx = tabs.findIndex((t) => t.id === tab.id);
  const otras = tabs.filter((t) => t.id !== tab.id && !t.pinned);
  const aLaDerecha = tabs.slice(idx + 1).filter((t) => !t.pinned);
  // Duplicadas: misma URL (la primera de cada URL sobrevive)
  const vistas = new Set(); const duplicadas = [];
  for (const t of tabs) { const u = t.kind === 'web' ? (t.sleptUrl || t.url) : 'hub'; if (vistas.has(u)) duplicadas.push(t); else vistas.add(u); }
  const items = [
    { label: 'Nueva pestaña', icon: 'plus', action: () => createTab() },
    { sep: true },
    ...(web ? [{ label: 'Recargar', icon: 'arrow-path', action: () => { try { tab.webview?.reload(); } catch {} } }] : []),
    { label: 'Recargar todas las páginas', icon: 'arrow-path', action: () => tabs.forEach((t) => { if (t.kind === 'web' && !t.asleep) { try { t.webview?.reload(); } catch {} } }) },
    ...(web ? [{ label: 'Copiar dirección de página', icon: 'clipboard', action: () => copiarDireccion(tab) }] : []),
    { sep: true },
    ...(web ? [{ label: 'Duplicar pestaña', icon: 'square-2-stack', action: () => duplicarTab(tab) }] : []),
    { label: tab.pinned ? 'Soltar pestaña' : 'Fijar pestaña', icon: 'pin', action: () => setPinned(tab, !tab.pinned) },
    ...(web ? [{ label: 'Guardar en marcadores', icon: 'bookmark-add', action: () => { if (tab.id !== activeId) activateTab(tab.id); if (!findBookmark(tab.url)) els.navStar.click(); else toast('Ya está en marcadores'); } }] : []),
    { sep: true },
    ...(web ? [{ label: tab.muted ? 'Activar sonido de la pestaña' : 'Silenciar pestaña', icon: tab.muted ? 'speaker-wave' : 'speaker-x-mark', action: () => toggleMute(tab) }] : []),
    { label: 'Silenciar otras pestañas', icon: 'speaker-x-mark', action: () => tabs.forEach((t) => { if (t.id !== tab.id && t.kind === 'web' && !t.muted) toggleMute(t); }) },
    { sep: true },
    { label: 'Cerrar pestaña', icon: 'x-mark', action: () => closeTab(tab.id) },
    ...(otras.length ? [{ label: 'Cerrar otras pestañas', icon: 'x-mark', action: () => otras.forEach((t) => closeTab(t.id)) }] : []),
    ...(aLaDerecha.length ? [{ label: 'Cerrar pestañas a la derecha', icon: 'x-mark', action: () => aLaDerecha.forEach((t) => closeTab(t.id)) }] : []),
    ...(duplicadas.length ? [{ label: 'Cerrar pestañas duplicadas', icon: 'x-mark', action: () => duplicadas.forEach((t) => closeTab(t.id)) }] : []),
    { sep: true },
    { label: 'Reabrir última pestaña cerrada', icon: 'clock', action: reabrirCerrada }
  ];
  showCtxMenu(e.clientX, e.clientY, items);
}
function makeTabEl(tab, mini) {
  const el = document.createElement('div');
  el.className = 'tab' + (tab.id === activeId ? ' active' : '') + (tab.asleep ? ' asleep' : '') + (tab.autoLoot ? ' farming' : '') + (tab.pinned ? ' pinned' : '') + (mini ? ' mini loot-member' : '');
  el.title = tab.autoLoot ? 'AutoClaim activo en este canal' + (tab.twitchClaims ? ` · ${tab.twitchClaims} reclamados` : '')
    : tab.asleep ? `Pestaña dormida — ${tab.title}\n${tab.sleptUrl || tab.url}`
    : (tab.url || 'Hub de Naviris');
  const title = document.createElement('span'); title.className = 't-title'; title.textContent = tab.title;
  const close = document.createElement('button'); close.className = 't-close'; close.innerHTML = window.icon('x-mark');
  close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
  if (tab.kind === 'web') {
    const fav = document.createElement('span'); fav.className = 't-fav';
    if (tab.favicon) { const im = document.createElement('img'); im.src = tab.favicon; im.onerror = () => { fav.innerHTML = '<span class="t-dot"></span>'; }; fav.appendChild(im); }
    else fav.innerHTML = '<span class="t-dot"></span>';
    el.appendChild(fav);
  }
  // Fijada: comprimida a solo el favicon (título y cierre viven en el tooltip
  // y el menú contextual). El resto, como siempre.
  if (!tab.pinned) {
    el.append(title);
    if (tab.agentControlled) { const ag = document.createElement('span'); ag.className = 't-agent'; ag.title = 'Un agente (CDP) está controlando esta pestaña'; el.appendChild(ag); }
    // Botón de silencio: aparece si la pestaña suena o está silenciada
    if (tab.kind === 'web' && (tab.audible || tab.muted)) {
      const spk = document.createElement('button'); spk.className = 't-mute' + (tab.muted ? ' muted' : '');
      spk.title = tab.muted ? 'Activar sonido' : 'Silenciar pestaña';
      spk.innerHTML = window.icon(tab.muted ? 'speaker-x-mark' : 'speaker-wave');
      spk.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(tab); });
      el.appendChild(spk);
    }
    el.appendChild(close);
  } else {
    el.title = (tab.title || '') + '\n' + (tab.sleptUrl || tab.url || '');
    // El hub no tiene favicon: fijado se representa con su icono de casa
    if (tab.kind !== 'web') { const h = document.createElement('span'); h.className = 't-fav'; h.innerHTML = window.icon('home'); el.prepend(h); }
  }
  el.addEventListener('click', () => activateTab(tab.id));
  el.addEventListener('auxclick', (e) => { if (e.button === 1 && !tab.pinned) closeTab(tab.id); });
  el.addEventListener('contextmenu', (e) => menuDePestana(e, tab));
  // Reordenar pestañas arrastrando (no en las mini del grupo AutoLoot ni fijadas)
  if (!mini && !tab.pinned) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { dragTabId = tab.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); document.querySelectorAll('.tab.drag-over').forEach((t) => t.classList.remove('drag-over')); });
    el.addEventListener('dragover', (e) => { if (dragTabId != null && dragTabId !== tab.id) { e.preventDefault(); el.classList.add('drag-over'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drag-over'); reorderTab(dragTabId, tab.id); dragTabId = null; });
  }
  return el;
}
let dragTabId = null;
// Mueve la pestaña arrastrada justo delante de la de destino. Las fijadas
// forman su propio bloque a la izquierda: no se cruza de un bloque al otro.
function reorderTab(fromId, toId) {
  const from = tabs.findIndex((t) => t.id === fromId), to = tabs.findIndex((t) => t.id === toId);
  if (from === -1 || to === -1 || from === to) return;
  if (!!tabs[from].pinned !== !!tabs[to].pinned) return;
  const [moved] = tabs.splice(from, 1);
  tabs.splice(tabs.findIndex((t) => t.id === toId), 0, moved);
  renderTabs(); saveSession();
}
// Firma del estado visible de las pestañas: si no cambia, no se repinta. Antes
// se recreaba la barra entera en CADA evento (título, favicon, media-started,
// media-paused...), y en páginas con vídeo eso llegaba varias veces por segundo:
// las pestañas parecían temblar porque el navegador rehacía el layout sin parar.
function firmaTabs() {
  return tabs.map((t) => [t.id, t.title, t.favicon || '', t.id === activeId, !!t.asleep,
    !!t.autoLoot, !!t.audible, !!t.muted, !!t.agentControlled, !!t.pinned].join('')).join('');
}
let ultimaFirmaTabs = null;
function renderTabs(forzar) {
  // AutoClaim se tiñe del morado de Twitch cuando la pestaña activa es un
  // canal (antes del early-return: es barato y depende de la pestaña activa)
  els.sbLoot.classList.toggle('on-twitch', activeIsTwitch());
  const f = firmaTabs();
  if (!forzar && f === ultimaFirmaTabs) return;
  ultimaFirmaTabs = f;
  // AutoClaim v2: un solo canal, sin grupo de pestañas acopladas; la pestaña
  // que farmea se queda en su sitio con su indicador (.farming)
  els.tabstrip.innerHTML = '';
  for (const tab of tabs) els.tabstrip.appendChild(makeTabEl(tab));
  ajustaPestanas();
}
/* Cuánto le toca a cada pestaña con el ancho que hay: por debajo de cierto
   tamaño se les quita primero la X y luego el título, hasta quedarse en el
   favicon. Lo decide JS porque el CSS no puede medir a sus hermanas. */
function ajustaPestanas() {
  const strip = els.tabstrip;
  const sueltas = strip.querySelectorAll('.tab:not(.pinned)').length;
  if (!sueltas) { strip.classList.remove('compacto', 'minimo'); return; }
  let fijas = 0;
  strip.querySelectorAll('.tab.pinned').forEach((t) => { fijas += t.offsetWidth + 4; });
  const cada = (strip.clientWidth - fijas) / sueltas - 4;
  strip.classList.toggle('compacto', cada < 108);
  strip.classList.toggle('minimo', cada < 66);
}
window.addEventListener('resize', ajustaPestanas);
function toggleMute(tab) {
  tab.muted = !tab.muted;
  try { tab.webview?.setAudioMuted(tab.muted); } catch {}
  renderTabs();
}
function navigateActive(input) {
  const url = toUrl(input); if (!url) return; hideBookmarkPage(); hideAddonsPage(); hideDownloadsPage();
  const tab = activeTab() || createTab();
  if (tab.kind === 'hub') { attachWebview(tab, url); tab.title = 'Cargando…'; activateTab(tab.id); } else tab.webview.src = url;
}
function syncNavUI() {
  const tab = activeTab(); const wv = tab?.kind === 'web' ? tab.webview : null;
  if (document.activeElement !== els.urlbar) els.urlbar.value = tab?.kind === 'web' ? tab.url : '';
  try { els.navBack.disabled = !wv?.canGoBack(); els.navFwd.disabled = !wv?.canGoForward(); } catch { els.navBack.disabled = els.navFwd.disabled = true; }
  const marked = tab?.kind === 'web' && findBookmark(tab.url);
  els.navStar.classList.toggle('starred', !!marked);
  if (!marked) els.navStar.classList.remove('removing');
  els.navStar.innerHTML = window.icon(marked ? (els.navStar.classList.contains('removing') ? 'bookmark-remove' : 'bookmark-added') : 'bookmark-add');
}
// Con la página ya guardada, pasar por encima ofrece QUITARLA: cinta con un
// menos en rojo. Al salir del botón vuelve el estado normal.
els.navStar.addEventListener('mouseenter', () => {
  if (!els.navStar.classList.contains('starred')) return;
  els.navStar.classList.add('removing');
  els.navStar.innerHTML = window.icon('bookmark-remove');
});
els.navStar.addEventListener('mouseleave', () => {
  if (els.navStar.classList.contains('removing')) { els.navStar.classList.remove('removing'); syncNavUI(); }
});
setInterval(() => {
  if (!settings.powerSaver) return; const now = Date.now(); let changed = false;
  for (const tab of tabs) {
    // No dormir: la pestaña activa, las de auto-reclamo de Twitch ni las que reproducen audio
    // (los drops solo cuentan si la pestaña sigue "viendo" el stream).
    if (tab.kind !== 'web' || tab.id === activeId || tab.asleep || !tab.webview || tab.autoLoot || tab.audible) continue;
    if (now - tab.lastActive > SLEEP_AFTER_MS) { try { tab.sleptUrl = tab.webview.getURL() || tab.url; tab.webview.src = 'about:blank'; tab.asleep = true; changed = true; } catch {} }
  }
  if (changed) renderTabs();
}, 30000);

/* ============ Autocompletado ============ */
let sugItems = [], sugSel = -1;
function buildSuggestions(q) {
  const query = q.trim().toLowerCase(); const out = [];
  if (query) { if (toUrl(q).startsWith('https://www.google.com/search')) out.push({ type: 'search', label: q, url: toUrl(q) }); else out.push({ type: 'go', label: q, url: toUrl(q) }); }
  const pool = [...bookmarksFlat().map((b) => ({ type: 'bookmark', label: b.title, url: b.url, score: 1000 })), ...dials.map((d) => ({ type: 'dial', label: d.name, url: d.url, score: 800 })), ...history.map((h) => ({ type: 'history', label: h.title, url: h.url, score: h.visits * 10 + 100 }))];
  const seen = new Set(out.map((o) => o.url));
  for (const m of pool.filter((p) => p.url && (p.url.toLowerCase().includes(query) || (p.label || '').toLowerCase().includes(query))).sort((a, b) => b.score - a.score)) { if (seen.has(m.url)) continue; seen.add(m.url); out.push(m); if (out.length >= 8) break; }
  return out;
}
function bestCompletion(q) {
  const cands = [];
  history.forEach((h) => { const host = hostOf(h.url); if (host) cands.push({ s: host, score: h.visits * 5 }); });
  bookmarksFlat().forEach((b) => { const host = hostOf(b.url); if (host) cands.push({ s: host, score: 12 }); });
  dials.forEach((d) => { const host = hostOf(d.url); if (host) cands.push({ s: host, score: 8 }); });
  const m = cands.filter((c) => c.s.toLowerCase().startsWith(q) && c.s.toLowerCase() !== q).sort((a, b) => b.score - a.score);
  return m[0]?.s;
}
function inlineComplete() {
  const val = els.urlbar.value;
  if (!val || val.includes(' ') || /^[a-z]+:/i.test(val)) return;
  const cand = bestCompletion(val.toLowerCase());
  if (cand && cand.length > val.length) { els.urlbar.value = val + cand.slice(val.length); els.urlbar.setSelectionRange(val.length, cand.length); }
}
function renderSuggest() {
  if (!settings.smartSearch) return hideSuggest();
  const q = els.urlbar.value; if (document.activeElement !== els.urlbar || !q.trim()) return hideSuggest();
  sugItems = buildSuggestions(q); if (!sugItems.length) return hideSuggest();
  els.suggest.innerHTML = '';
  sugItems.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'sug' + (i === sugSel ? ' sel' : '');
    const ic = document.createElement('span'); ic.className = 'sug-ic';
    if (it.type === 'search') ic.innerHTML = window.icon('magnifying-glass');
    else if (it.type === 'go') ic.innerHTML = window.icon('arrow-up-right');
    else { ic.innerHTML = window.icon(it.type === 'bookmark' ? 'star' : 'arrow-up-right'); getTile(it.url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.src = t.icon; ic.innerHTML = ''; ic.appendChild(im); } }); }
    const main = document.createElement('span'); main.className = 'sug-main';
    main.innerHTML = it.type === 'search' ? `Buscar <b>${escapeHtml(it.label)}</b> en Google` : escapeHtml(it.label || it.url);
    const u = document.createElement('span'); u.className = 'sug-url'; if (it.type !== 'search') u.textContent = hostOf(it.url);
    row.append(ic, main, u);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); navigateActive(it.url); hideSuggest(); els.urlbar.blur(); });
    els.suggest.appendChild(row);
  });
  els.suggest.classList.remove('hidden');
}
function hideSuggest() { els.suggest.classList.add('hidden'); sugSel = -1; }
els.urlbar.addEventListener('input', (e) => { sugSel = -1; if (settings.smartSearch && !(e.inputType || '').startsWith('delete')) inlineComplete(); renderSuggest(); });
els.urlbar.addEventListener('focus', () => { els.urlbar.select(); renderSuggest(); });
els.urlbar.addEventListener('blur', () => setTimeout(hideSuggest, 120));
els.urlbar.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sugSel = Math.min(sugItems.length - 1, sugSel + 1); renderSuggest(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sugSel = Math.max(-1, sugSel - 1); renderSuggest(); }
  else if (e.key === 'Enter') { navigateActive(sugSel >= 0 ? sugItems[sugSel].url : els.urlbar.value); hideSuggest(); els.urlbar.blur(); }
  else if (e.key === 'Escape') { hideSuggest(); els.urlbar.blur(); }
});

/* ============ Marcadores con carpetas ============ */
let bookmarks = store.get('cobalt.bookmarks2', migrateOld());
function migrateOld() { const old = store.get('cobalt.bookmarks', null); return Array.isArray(old) ? old.map((b) => ({ type: 'link', title: b.title, url: b.url })) : []; }
const saveBm = () => store.set('cobalt.bookmarks2', bookmarks);
function bookmarksFlat() { const o = []; for (const it of bookmarks) { if (it.type === 'link') o.push(it); else if (it.type === 'folder') o.push(...it.children); } return o; }
function findBookmark(url) { return bookmarksFlat().find((b) => b.url === url); }
function removeBookmark(url) { bookmarks = bookmarks.filter((it) => !(it.type === 'link' && it.url === url)); bookmarks.forEach((it) => { if (it.type === 'folder') it.children = it.children.filter((c) => c.url !== url); }); saveBm(); }
function renderBookmarksBar() {
  els.bookmarksBar.innerHTML = '';
  // Sin marcadores la barra no aporta nada: quitarla en vez de dejar una franja
  // vacía de 32px bajo la navbar en todas las ventanas.
  els.bookmarksBar.classList.toggle('empty', !bookmarks.length);
  for (const it of bookmarks) {
    if (it.type === 'folder') { const btn = document.createElement('button'); btn.className = 'bm-folder'; btn.innerHTML = window.icon('folder') + `<span>${escapeHtml(it.name)}</span>`; btn.addEventListener('click', (e) => { e.stopPropagation(); openFolderPop(it, btn); }); els.bookmarksBar.appendChild(btn); }
    else els.bookmarksBar.appendChild(makeBmChip(it));
  }
}
function makeBmChip(b) {
  const el = document.createElement('button'); el.className = 'bookmark'; el.title = b.url + '  (clic central: segundo plano · clic derecho: opciones)';
  const img = document.createElement('img'); getTile(b.url).then((t) => { if (t?.icon) img.src = t.icon; else img.remove(); });
  const label = document.createElement('span'); label.textContent = b.title; el.append(img, label);
  el.addEventListener('click', () => navigateActive(b.url));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openBackground(b.url); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, linkMenu(b.url, () => { removeBookmark(b.url); renderBookmarksBar(); syncNavUI(); renderBookmarkTree(); toast('Marcador eliminado'); })); });
  return el;
}
let folderPop = null;
function openFolderPop(folder, anchor) { closeFolderPop(); folderPop = document.createElement('div'); folderPop.className = 'bm-folder-pop'; folder.children.forEach((b) => folderPop.appendChild(makeBmChip(b))); document.body.appendChild(folderPop); const r = anchor.getBoundingClientRect(); folderPop.style.left = r.left + 'px'; folderPop.style.top = (r.bottom + 4) + 'px'; }
function closeFolderPop() { folderPop?.remove(); folderPop = null; }
els.navStar.addEventListener('click', () => {
  const tab = activeTab(); if (!tab || tab.kind !== 'web') return;
  if (findBookmark(tab.url)) removeBookmark(tab.url); else bookmarks.push({ type: 'link', title: tab.title || tab.url, url: tab.url });
  saveBm(); renderBookmarksBar(); syncNavUI(); renderBookmarkTree();
});

/* Página de marcadores */
function showBookmarkPage() { tabs.forEach((t) => t.webview?.classList.remove('active')); els.hub.classList.remove('active'); hideAddonsPage(); hideDownloadsPage(); els.bmPage.classList.remove('hidden'); els.bmPage.classList.add('active'); els.sbBookmarks.classList.add('open'); renderBookmarkTree(); }
function hideBookmarkPage() { els.bmPage.classList.remove('active'); els.bmPage.classList.add('hidden'); els.sbBookmarks.classList.remove('open'); }
let bmFilter = '';
function renderBookmarkTree() {
  if (!els.bmPage.classList.contains('active')) return;
  els.bmTree.innerHTML = ''; const f = bmFilter.toLowerCase();
  const matches = (b) => !f || (b.title || '').toLowerCase().includes(f) || (b.url || '').toLowerCase().includes(f);
  bookmarks.forEach((it, idx) => {
    if (it.type === 'folder') {
      const kids = it.children.filter(matches); if (f && !kids.length && !it.name.toLowerCase().includes(f)) return;
      const row = document.createElement('div'); row.className = 'bm-row bm-folder-row';
      row.innerHTML = `<span class="bm-ic bm-chev">${window.icon('chevron-down')}</span><span class="bm-ic">${window.icon('folder')}</span>`;
      const label = document.createElement('div'); label.className = 'bm-label'; label.innerHTML = `<div class="bm-t">${escapeHtml(it.name)}</div>`;
      const count = document.createElement('span'); count.className = 'bm-count'; count.textContent = it.children.length + ' elem.';
      const acts = document.createElement('div'); acts.className = 'bm-actions';
      const ren = document.createElement('button'); ren.title = 'Renombrar'; ren.innerHTML = window.icon('pencil-square'); ren.addEventListener('click', (e) => { e.stopPropagation(); promptModal('Renombrar carpeta', it.name, (v) => { if (v.trim()) { it.name = v.trim(); saveBm(); renderBookmarkTree(); renderBookmarksBar(); } }); });
      const del = document.createElement('button'); del.className = 'del'; del.title = 'Eliminar carpeta'; del.innerHTML = window.icon('trash'); del.addEventListener('click', (e) => { e.stopPropagation(); bookmarks.splice(idx, 1); saveBm(); renderBookmarkTree(); renderBookmarksBar(); });
      acts.append(ren, del); row.append(label, count, acts);
      row.addEventListener('click', () => row.classList.toggle('collapsed'));
      els.bmTree.appendChild(row);
      const kidsWrap = document.createElement('div'); kidsWrap.className = 'bm-children';
      (f ? kids : it.children).forEach((b) => kidsWrap.appendChild(bmManagerRow(b))); els.bmTree.appendChild(kidsWrap);
    } else if (matches(it)) els.bmTree.appendChild(bmManagerRow(it));
  });
}
function bmManagerRow(b) {
  const row = document.createElement('div'); row.className = 'bm-row';
  const ic = document.createElement('span'); ic.className = 'bm-ic'; ic.innerHTML = window.icon('bookmark'); getTile(b.url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.src = t.icon; ic.innerHTML = ''; ic.appendChild(im); } });
  const label = document.createElement('div'); label.className = 'bm-label'; label.innerHTML = `<div class="bm-t">${escapeHtml(b.title)}</div><div class="bm-u">${escapeHtml(b.url)}</div>`;
  const acts = document.createElement('div'); acts.className = 'bm-actions';
  if (bookmarks.some((x) => x.type === 'folder')) { const mv = document.createElement('button'); mv.title = 'Mover a carpeta'; mv.innerHTML = window.icon('folder'); mv.addEventListener('click', (e) => { e.stopPropagation(); moveToFolder(b); }); acts.appendChild(mv); }
  const del = document.createElement('button'); del.className = 'del'; del.title = 'Eliminar'; del.innerHTML = window.icon('trash'); del.addEventListener('click', (e) => { e.stopPropagation(); removeBookmark(b.url); renderBookmarkTree(); renderBookmarksBar(); syncNavUI(); });
  acts.append(del); row.append(ic, label, acts);
  row.addEventListener('click', () => navigateActive(b.url)); return row;
}
function moveToFolder(b) {
  const folders = bookmarks.filter((x) => x.type === 'folder');
  promptModal('Mover a carpeta (nombre)', folders.map((f) => f.name).join(', '), (val) => {
    const target = folders.find((f) => f.name.toLowerCase() === val.trim().toLowerCase()); if (!target) { toast('Carpeta no encontrada'); return; }
    removeBookmark(b.url); target.children.push({ type: 'link', title: b.title, url: b.url }); saveBm(); renderBookmarkTree(); renderBookmarksBar();
  });
}
els.bmNewfolder.addEventListener('click', () => promptModal('Nueva carpeta', 'Nombre de la carpeta', (name) => { if (!name.trim()) return; bookmarks.unshift({ type: 'folder', name: name.trim(), children: [] }); saveBm(); renderBookmarkTree(); renderBookmarksBar(); }));
els.bmImport.addEventListener('click', async (e) => {
  e.stopPropagation();
  const avail = await window.cobalt.importAvailable();
  const items = Object.entries(avail).filter(([, v]) => v.present).map(([key, v]) => ({ label: 'Desde ' + v.label, icon: 'arrow-down-tray', action: () => doImportBookmarks(key, v.label) }));
  if (!items.length) { toast('No se encontró Chrome/Brave/Edge con marcadores'); return; }
  const r = els.bmImport.getBoundingClientRect(); showCtxMenu(r.left, r.bottom + 4, items);
});
async function doImportBookmarks(key, label) {
  const r = await window.cobalt.importBookmarks(key);
  if (!r.ok || !r.items || !r.items.length) { toast('No se pudo importar de ' + label); return; }
  const existing = new Set();
  bookmarks.forEach((it) => { if (it.type === 'link') existing.add(it.url); else if (it.type === 'folder') it.children.forEach((c) => existing.add(c.url)); });
  const fresh = r.items.filter((b) => !existing.has(b.url));
  if (!fresh.length) { toast('Ya tenías esos marcadores'); return; }
  bookmarks.unshift({ type: 'folder', name: 'Importados de ' + label, children: fresh.map((b) => ({ type: 'link', title: b.title, url: b.url })) });
  saveBm(); renderBookmarkTree(); renderBookmarksBar();
  toast(`${fresh.length} marcadores importados de ${label}`);
}
els.bmFilter.addEventListener('input', () => { bmFilter = els.bmFilter.value; renderBookmarkTree(); });
els.sbBookmarks.addEventListener('click', () => { if (els.bmPage.classList.contains('active')) { hideBookmarkPage(); activateTab(activeId); } else showBookmarkPage(); });

/* Modal de texto */
let promptCb = null;
function promptModal(title, ph, cb) { els.promptTitle.textContent = title; els.promptInput.style.display = ''; els.promptInput.value = ''; els.promptInput.placeholder = ph || ''; els.promptOk.textContent = 'Crear'; els.promptModal.classList.remove('hidden'); els.promptInput.focus(); promptCb = cb; }
function promptConfirm(title, text, cb) {
  els.promptTitle.innerHTML = `${escapeHtml(title)}<br><span style="font-weight:400;color:var(--text-dim);font-size:13px">${escapeHtml(text)}</span>`;
  els.promptInput.style.display = 'none';
  els.promptOk.textContent = 'Borrar';
  els.promptModal.classList.remove('hidden');
  promptCb = () => cb();
}
els.promptOk.addEventListener('click', () => { els.promptModal.classList.add('hidden'); const cb = promptCb; promptCb = null; cb?.(els.promptInput.value); });
els.promptCancel.addEventListener('click', () => els.promptModal.classList.add('hidden'));
els.promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.promptOk.click(); });

/* ============ Accesos del hub (dials) ============ */
const DEFAULT_DIALS = [
  { name: 'YouTube', url: 'https://www.youtube.com' }, { name: 'Twitch', url: 'https://www.twitch.tv' },
  { name: 'Discord', url: 'https://discord.com/app' }, { name: 'WhatsApp', url: 'https://web.whatsapp.com' },
  { name: 'Crunchyroll', url: 'https://www.crunchyroll.com' }, { name: 'GitHub', url: 'https://github.com' },
  { name: 'Gmail', url: 'https://mail.google.com' }
];
let dials = store.get('cobalt.dials', DEFAULT_DIALS);
function removeDial(d) { dials = dials.filter((x) => x !== d); store.set('cobalt.dials', dials); renderHub(); }

// Logos de los dials: monocromos por defecto, o con su color de marca original
// si "Logos a color" está activo (los diseños son los mismos SVG de siempre;
// el color va por CSS variable para que el toggle no tenga que repintar a mano).
const colorLogosOn = () => store.get('cobalt.colorLogos', true);
function applyColorLogos() {
  document.documentElement.classList.toggle('color-logos', colorLogosOn());
  renderHub();
}
function styleDial(tile, letter, d) {
  const brand = brandOf(d.url);
  // El fondo y el filtro del favicon los pone el CSS (tokens --tile-default y
  // --fav-filter): antes se fijaban aquí en línea y en modo claro quedaban
  // tiles negros con iconos aclarados sobre un hub blanco.
  if (brand && window.brandIcon(brand)) {
    const m = document.createElement('span'); m.className = 'd-mono'; m.innerHTML = window.brandIcon(brand);
    const c = window.brandColor(brand);
    if (c) m.style.setProperty('--brand-c', c); // .color-logos lo usa; sin la clase, se ignora
    tile.appendChild(m); letter.remove(); return;
  }
  getTile(d.url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.className = 'd-fav'; im.src = t.icon; tile.style.setProperty('--icon-sz', '34px'); im.onload = () => letter.remove(); im.onerror = () => im.remove(); tile.appendChild(im); } });
}
function makeDialEl(d) {
  const el = document.createElement('div'); el.className = 'dial'; el.title = d.url;
  const tile = document.createElement('div'); tile.className = 'd-tile';
  const letter = document.createElement('span'); letter.className = 'd-letter'; letter.textContent = (d.name[0] || '·').toUpperCase(); tile.appendChild(letter);
  styleDial(tile, letter, d);
  const name = document.createElement('div'); name.className = 'd-name'; name.textContent = d.name;
  const x = document.createElement('button'); x.className = 'd-x'; x.title = 'Eliminar'; x.innerHTML = window.icon('x-mark'); x.addEventListener('click', (e) => { e.stopPropagation(); removeDial(d); });
  el.append(tile, name, x);
  el.addEventListener('click', () => { if (!els.hub.classList.contains('editing')) navigateActive(d.url); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1 && !els.hub.classList.contains('editing')) { e.preventDefault(); openBackground(d.url); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (els.hub.classList.contains('editing')) return; showCtxMenu(e.clientX, e.clientY, linkMenu(d.url, () => removeDial(d))); });
  return el;
}

/* ============ HUB: sistema de widgets ============ */
const WIDGET_TYPES = {
  clock: { name: 'Reloj', icon: 'clock', span: 6 },
  search: { name: 'Buscador', icon: 'magnifying-glass', span: 6 },
  shortcuts: { name: 'Accesos', icon: 'squares-2x2', span: 6 },
  date: { name: 'Fecha', icon: 'clock', span: 2 },
  weather: { name: 'Clima', icon: 'cloud', span: 2 },
  region: { name: 'Región', icon: 'map-pin', span: 2 },
  notes: { name: 'Notas', icon: 'pencil-square', span: 3 }
};
let widgets = store.get('cobalt.widgets', [
  { id: 'w1', type: 'clock', span: 6 }, { id: 'w2', type: 'search', span: 6 }, { id: 'w3', type: 'shortcuts', span: 6 }
]);
const saveWidgets = () => store.set('cobalt.widgets', widgets);
let widgetSeq = 100;

function renderHub() {
  els.widgetGrid.innerHTML = '';
  for (const w of widgets) {
    const el = document.createElement('div'); el.className = 'widget'; el.style.setProperty('--span', w.span); el.dataset.id = w.id;
    const body = document.createElement('div');
    if (w.type === 'clock') { el.classList.add('w-search'); body.className = 'w-card w-clock'; body.innerHTML = `<div class="time" id="w-time"></div><div class="greet" id="w-greet"></div>`; }
    else if (w.type === 'search') { el.classList.add('w-search'); body.appendChild(buildSearch()); }
    else if (w.type === 'shortcuts') { body.className = 'w-card w-shortcuts'; const g = document.createElement('div'); g.className = 'sc-grid'; dials.forEach((d) => g.appendChild(makeDialEl(d))); const add = document.createElement('div'); add.className = 'dial add'; add.innerHTML = `<div class="d-tile">${window.icon('plus')}</div><div class="d-name">Añadir</div>`; add.addEventListener('click', () => { els.dialName.value = ''; els.dialUrl.value = ''; els.dialModal.classList.remove('hidden'); els.dialName.focus(); }); g.appendChild(add); body.appendChild(g); }
    else if (w.type === 'date') { body.className = 'w-card w-date'; renderDate(body); }
    else if (w.type === 'weather') { body.className = 'w-card w-weather'; body.innerHTML = '<div class="w-loading">Cargando clima…</div>'; loadWeather(body, 'weather'); }
    else if (w.type === 'region') { body.className = 'w-card w-weather'; body.innerHTML = '<div class="w-loading">Cargando región…</div>'; loadWeather(body, 'region'); }
    else if (w.type === 'notes') { body.className = 'w-card w-notes'; body.innerHTML = `<div class="w-head">${window.icon('pencil-square')} Notas</div><textarea placeholder="Escribe algo…">${escapeHtml(store.get('cobalt.notes', ''))}</textarea>`; body.querySelector('textarea').addEventListener('input', (e) => store.set('cobalt.notes', e.target.value)); }
    if (body.parentNode !== el) el.appendChild(body);

    // Herramientas de edición
    const tools = document.createElement('div'); tools.className = 'w-tools';
    const grip = document.createElement('button'); grip.title = 'Arrastra para mover'; grip.innerHTML = window.icon('grip');
    const size = document.createElement('button'); size.title = 'Cambiar tamaño'; size.innerHTML = window.icon('arrows-pointing-out'); size.addEventListener('click', (e) => { e.stopPropagation(); const steps = [2, 3, 4, 6]; w.span = steps[(steps.indexOf(w.span) + 1) % steps.length]; saveWidgets(); renderHub(); });
    const rm = document.createElement('button'); rm.className = 'rm'; rm.title = 'Quitar widget'; rm.innerHTML = window.icon('x-mark'); rm.addEventListener('click', (e) => { e.stopPropagation(); widgets = widgets.filter((x) => x.id !== w.id); saveWidgets(); renderHub(); });
    tools.append(grip, size, rm); el.appendChild(tools);

    // Drag & drop
    el.draggable = false;
    grip.addEventListener('mousedown', () => { el.draggable = true; });
    el.addEventListener('dragstart', (e) => { el.classList.add('dragging'); e.dataTransfer.setData('text/plain', w.id); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); el.draggable = false; document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target')); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop-target'); const from = e.dataTransfer.getData('text/plain'); reorderWidget(from, w.id); });
    els.widgetGrid.appendChild(el);
  }
  tickClock();
}
function reorderWidget(fromId, toId) {
  if (fromId === toId) return;
  const fi = widgets.findIndex((w) => w.id === fromId), ti = widgets.findIndex((w) => w.id === toId);
  if (fi < 0 || ti < 0) return;
  const [m] = widgets.splice(fi, 1); widgets.splice(widgets.findIndex((w) => w.id === toId), 0, m);
  saveWidgets(); renderHub();
}
function buildSearch() {
  const form = document.createElement('form'); form.id = 'hub-search';
  form.innerHTML = `<span class="g-ico">${window.icon('magnifying-glass')}</span><input id="hub-search-input" type="text" spellcheck="false" placeholder="Buscar en Google" />`;
  form.addEventListener('submit', (e) => { e.preventDefault(); const inp = form.querySelector('input'); navigateActive(inp.value); inp.value = ''; });
  return form;
}
function renderDate(el) {
  const now = new Date(); const day = now.getDate();
  const wd = now.toLocaleDateString('es', { weekday: 'long' }); const mo = now.toLocaleDateString('es', { month: 'long', year: 'numeric' });
  el.innerHTML = `<div class="d-day">${day}</div><div class="d-rest">${wd}<br>${mo}</div>`;
}
function tickClock() {
  const now = new Date(); const t = document.getElementById('w-time'); const g = document.getElementById('w-greet');
  if (t) t.textContent = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (g) { if (IS_PRIVATE) g.textContent = 'Ventana privada — nada se guarda'; else { const h = now.getHours(); g.textContent = (h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches') + ' — listo para navegar'; } }
}
setInterval(tickClock, 10000);

/* Clima y región (open-meteo + ipapi, sin claves) */
let geoCache = null, wxCache = null;
// Estado del clima → [descripción, icono]. Los iconos son el set de clima
// elegido a mano (Dazzle Line Icons vía svgrepo, prefijo wx-). Prioridad:
// aviso severo > precipitación > viento fuerte > frío/calor > humedad > cielo.
function WMO(cur) {
  const c = cur.weather_code, t = cur.temperature_2m;
  const v = cur.wind_speed_10m || 0, h = cur.relative_humidity_2m || 0, dia = cur.is_day !== 0;
  if (c >= 95) return ['Tormenta', 'wx-alerta'];
  if (c >= 85) return ['Nevando', 'wx-nevando'];
  if (c >= 80) return (c === 80 && dia) ? ['Chubascos con sol', 'wx-arcoiris'] : ['Chubascos', 'wx-lluvia'];
  if (c === 77 || c === 66 || c === 67 || c === 56 || c === 57) return ['Granizo', 'wx-granizo'];
  if (c >= 71) return ['Nevando', 'wx-nevando'];
  if (c >= 61) return ['Lluvia', 'wx-lluvia'];
  if (c >= 51) return ['Posible lluvia', 'wx-paraguas'];
  if (c >= 45) return ['Niebla', 'wx-nublado'];
  if (v >= 40) return ['Ventoso', 'wx-viento'];
  if (t <= 3) return ['Frío', 'wx-frio'];
  if (t >= 33) return ['Caluroso', 'wx-calor'];
  if (h >= 85 && t >= 20) return ['Mucha humedad', 'wx-humedad'];
  if (c === 3) return ['Nublado', 'wx-nublado'];
  if (c >= 1) return ['Sol y nubes', 'wx-sol-nubes'];
  return dia ? ['Soleado', 'wx-sol'] : ['Despejado', 'moon'];
}
const WX_QUERY = 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day';
// ipapi.co limita peticiones sin aviso (devuelve HTML): se prueba en cadena con
// dos alternativas gratuitas y se normaliza al mismo formato.
async function getGeo() {
  if (geoCache) return geoCache;
  const fuentes = [
    ['https://ipapi.co/json/', (j) => j],
    ['https://ipwho.is/', (j) => ({ city: j.city, region: j.region, country_name: j.country, latitude: j.latitude, longitude: j.longitude, timezone: j.timezone && j.timezone.id })],
    ['https://get.geojs.io/v1/ip/geo.json', (j) => ({ city: j.city, region: j.region, country_name: j.country, latitude: +j.latitude, longitude: +j.longitude, timezone: j.timezone })]
  ];
  for (const [url, map] of fuentes) {
    try {
      const j = map(await (await fetch(url)).json());
      if (j && j.latitude != null && !isNaN(+j.latitude)) { geoCache = j; return geoCache; }
    } catch { /* siguiente fuente */ }
  }
  throw new Error('geo no disponible');
}
async function loadWeather(el, kind) {
  try {
    const geo = await getGeo();
    if (kind === 'region') { el.innerHTML = `<div class="wx-ic">${window.icon('map-pin')}</div><div><div class="wx-temp" style="font-size:20px">${escapeHtml(geo.city || '—')}</div><div class="wx-desc">${escapeHtml(geo.region || '')}, ${escapeHtml(geo.country_name || '')}</div><div class="wx-city">${escapeHtml(geo.timezone || '')}</div></div>`; return; }
    if (!wxCache) { const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=${WX_QUERY}`); wxCache = (await r.json()).current; }
    const [desc, ic] = WMO(wxCache);
    el.innerHTML = `<div class="wx-ic">${window.icon(ic)}</div><div><div class="wx-temp">${Math.round(wxCache.temperature_2m)}°</div><div class="wx-desc">${desc}</div><div class="wx-city">${window.icon('map-pin')} ${escapeHtml(geo.city || '')}</div></div>`;
  } catch { el.innerHTML = '<div class="w-loading">Clima no disponible (sin conexión)</div>'; }
}

/* ============ Pastilla de clima (esquina del hub, como Opera GX) ============ */
async function loadWeatherPill() {
  const el = document.getElementById('hub-weather'); if (!el) return;
  try {
    const geo = await getGeo();
    if (!wxCache) { const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=${WX_QUERY}`); wxCache = (await r.json()).current; }
    const [desc, ic] = WMO(wxCache);
    el.innerHTML = `${window.icon(ic)}<span>${Math.round(wxCache.temperature_2m)}°C</span><span class="wxp-sep"></span><span class="wxp-city">${escapeHtml(geo.city || desc)}</span>`;
    el.title = desc;
    el.classList.remove('hidden');
  } catch { el.classList.add('hidden'); }
}
loadWeatherPill();
setInterval(() => { wxCache = null; loadWeatherPill(); }, 30 * 60 * 1000); // refresco cada 30 min

/* ============ Cuenta Naviris (sincronización de preferencias) ============ */
const ACC_API = 'https://naviris-account.studio-iris2026.workers.dev';
let account = store.get('cobalt.account', null); // { email, token }
// Qué viaja: preferencias de usuario + marcadores + accesos + widgets + notas +
// fondo. NUNCA contraseñas, tarjetas, historial ni sesión (locales por diseño).
const SYNC_SETTINGS = ['lightMode', 'smartSearch', 'xRevealSensitive', 'blockPasskeys', 'restoreSession', 'powerSaver', 'adblockEnabled', 'adblockWhitelist', 'atajos', 'mouseNav'];
function buildSyncData() {
  const s = {};
  for (const k of SYNC_SETTINGS) if (settings[k] !== undefined) s[k] = settings[k];
  return {
    v: 1, settings: s,
    bookmarks: store.get('cobalt.bookmarks2', []),
    dials: store.get('cobalt.dials', null),
    widgets: store.get('cobalt.widgets', null),
    notes: store.get('cobalt.notes', ''),
    hubBg: store.get('cobalt.hubBg', null),
    colorLogos: store.get('cobalt.colorLogos', true)
  };
}
async function applySyncData(d) {
  if (!d) return;
  if (Array.isArray(d.bookmarks)) { store.set('cobalt.bookmarks2', d.bookmarks); bookmarks = d.bookmarks; }
  if (Array.isArray(d.dials)) { store.set('cobalt.dials', d.dials); dials = d.dials; }
  if (Array.isArray(d.widgets)) { store.set('cobalt.widgets', d.widgets); widgets = d.widgets; }
  if (typeof d.notes === 'string') store.set('cobalt.notes', d.notes);
  if (d.hubBg) { store.set('cobalt.hubBg', d.hubBg); applyBackground(d.hubBg); }
  if (typeof d.colorLogos === 'boolean') { store.set('cobalt.colorLogos', d.colorLogos); applyColorLogos(); }
  if (d.settings) {
    settings = await window.cobalt.setSettings(d.settings);
    applyTheme(settings.lightMode); els.optLight.checked = !!settings.lightMode;
    els.optSmartsearch.checked = settings.smartSearch !== false;
    els.optPasskeys.checked = settings.blockPasskeys !== false; els.optRestore.checked = settings.restoreSession !== false;
    els.optPowersaver.checked = settings.powerSaver;
    els.optAtajos.checked = settings.atajos !== false;
    els.optMousenav.checked = settings.mouseNav !== false;
    const ab = await window.cobalt.adblockGet(); els.navShield.classList.toggle('off', !ab.enabled);
  }
  renderBookmarksBar(); renderHub();
}
const accEls = {
  modal: $('#account-modal'), loginView: $('#acc-login-view'), userView: $('#acc-user-view'),
  email: $('#acc-email'), pass: $('#acc-pass'), error: $('#acc-error'), who: $('#acc-who'), last: $('#acc-last'),
  pill: $('#hub-account'), pillLabel: $('#hub-account-label')
};
function renderAccountPill() {
  const logged = !!(account && account.token);
  accEls.pill.classList.toggle('logged', logged);
  accEls.pillLabel.textContent = logged ? account.email.split('@')[0] : 'Iniciar sesión';
  accEls.pill.title = logged ? `Cuenta Naviris — ${account.email}` : 'Cuenta Naviris: guarda tus preferencias en la nube';
}
function accError(msg) { accEls.error.textContent = msg || ''; accEls.error.classList.toggle('hidden', !msg); }
function showAccountModal() {
  const logged = !!(account && account.token);
  accEls.loginView.classList.toggle('hidden', logged);
  accEls.userView.classList.toggle('hidden', !logged);
  if (logged) {
    accEls.who.textContent = account.email;
    const st = store.get('cobalt.syncStamp', 0);
    accEls.last.textContent = st ? 'Última sincronización: ' + new Date(st).toLocaleString('es') : 'Aún sin sincronizar en este equipo.';
  } else { accError(''); accEls.pass.value = ''; }
  accEls.modal.classList.remove('hidden');
  if (!logged) accEls.email.focus();
}
accEls.pill.addEventListener('click', showAccountModal);
$('#acc-cancel').addEventListener('click', () => accEls.modal.classList.add('hidden'));
$('#acc-close2').addEventListener('click', () => accEls.modal.classList.add('hidden'));

async function accRequest(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (account && account.token) headers.Authorization = 'Bearer ' + account.token;
  try {
    const r = await fetch(ACC_API + path, { ...opts, headers });
    return await r.json();
  } catch { return { ok: false, error: 'Sin conexión con el servidor de cuentas' }; }
}
async function accAuth(path) {
  const email = accEls.email.value.trim(), password = accEls.pass.value;
  if (!email || !password) { accError('Escribe el correo y la contraseña'); return; }
  accError('');
  const r = await accRequest(path, { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!r.ok) { accError(r.error || 'No se pudo iniciar sesión'); return; }
  account = { email: r.email, token: r.token };
  store.set('cobalt.account', account);
  renderAccountPill();
  // Al entrar: si la cuenta ya tiene datos se cargan aquí (eso es "moverse de PC");
  // si está vacía (recién creada), se sube lo de este equipo.
  const s = await accRequest('/sync');
  if (s.ok && s.data) { await applySyncData(s.data); store.set('cobalt.syncStamp', s.updatedAt); toast('Preferencias de tu cuenta cargadas'); }
  else if (s.ok) { await accPush(); toast('Cuenta lista: tus preferencias ya están en la nube'); }
  showAccountModal();
}
$('#acc-login').addEventListener('click', () => accAuth('/login'));
$('#acc-register').addEventListener('click', () => accAuth('/register'));
accEls.pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') accAuth('/login'); });
$('#acc-logout').addEventListener('click', async () => {
  await accRequest('/logout', { method: 'POST' });
  account = null; store.set('cobalt.account', null); store.set('cobalt.syncStamp', 0);
  renderAccountPill(); showAccountModal();
});
let lastPushJson = '';
async function accPush() {
  if (!account || !account.token) return;
  const data = buildSyncData();
  const r = await accRequest('/sync', { method: 'PUT', body: JSON.stringify({ data }) });
  if (r.ok) { lastPushJson = JSON.stringify(data); store.set('cobalt.syncStamp', r.updatedAt); }
  else if (/Sesión caducada/.test(r.error || '')) { account = null; store.set('cobalt.account', null); renderAccountPill(); }
  return r;
}
$('#acc-sync').addEventListener('click', async () => {
  const r = await accPush();
  toast(r && r.ok ? 'Sincronizado' : 'No se pudo sincronizar');
  showAccountModal();
});
// Al arrancar con sesión: baja lo del servidor si es más nuevo que lo aplicado aquí
async function accBootSync() {
  if (!account || !account.token) return;
  const s = await accRequest('/sync');
  if (s.ok && s.data && s.updatedAt > store.get('cobalt.syncStamp', 0)) { await applySyncData(s.data); store.set('cobalt.syncStamp', s.updatedAt); }
  lastPushJson = JSON.stringify(buildSyncData());
}
// Empuje automático: cada minuto, solo si algo cambió de verdad
setInterval(() => {
  if (!account || !account.token || IS_PRIVATE) return;
  const now = JSON.stringify(buildSyncData());
  if (now !== lastPushJson) accPush();
}, 60000);
renderAccountPill();

/* Edición / personalización del hub */
/* Selector de tema del hub, al lado de Editar */
(() => {
  const boton = document.getElementById('hub-temas');
  const pop = document.getElementById('temas-pop');
  if (!boton || !pop) return;
  const pinta = () => {
    const t = temaActual();
    pop.querySelectorAll('.tema-op').forEach((b) => b.classList.toggle('on', b.dataset.tema === t));
  };
  boton.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrir = pop.classList.contains('hidden');
    pop.classList.toggle('hidden', !abrir);
    boton.classList.toggle('on', abrir);
    if (abrir) pinta();
  });
  pop.querySelectorAll('.tema-op').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    aplicaTema(b.dataset.tema);
    pinta();
    pop.classList.add('hidden'); boton.classList.remove('on');
    // lightMode sigue viviendo en los ajustes: lo leen el interruptor de la
    // sidebar, el tema del sistema y la sincronización de la cuenta. El rosa
    // también es claro, así que solo el oscuro lo apaga.
    settings = await window.cobalt.setSettings({ lightMode: b.dataset.tema !== 'oscuro' });
    if (els.optLight) els.optLight.checked = b.dataset.tema !== 'oscuro';
    toast('Tema ' + (b.dataset.tema === 'oscuro' ? 'Naviris' : b.dataset.tema));
  }));
  document.addEventListener('click', (e) => {
    if (pop.classList.contains('hidden')) return;
    if (!pop.contains(e.target) && !boton.contains(e.target)) { pop.classList.add('hidden'); boton.classList.remove('on'); }
  });
})();

els.hubEdit.addEventListener('click', () => {
  const on = els.hub.classList.toggle('editing'); els.hubEdit.classList.toggle('on', on);
  els.widgetPalette.classList.toggle('hidden', !on); els.customizePanel.classList.add('hidden');
  els.hubEdit.querySelector('.lbl').textContent = on ? 'Listo' : 'Editar';
  if (on) renderPalette();
});
function renderPalette() {
  els.paletteList.innerHTML = '';
  for (const key in WIDGET_TYPES) { const w = WIDGET_TYPES[key]; const b = document.createElement('button'); b.className = 'pal-item'; b.innerHTML = `${window.icon(w.icon)}<span>${w.name}</span>`; b.addEventListener('click', () => { widgets.push({ id: 'w' + (++widgetSeq) + Date.now(), type: key, span: w.span }); saveWidgets(); renderHub(); }); els.paletteList.appendChild(b); }
}
els.hubCustomize.addEventListener('click', () => { const show = els.customizePanel.classList.contains('hidden'); els.customizePanel.classList.toggle('hidden', !show); els.widgetPalette.classList.add('hidden'); if (show) renderBgPresets(); });

// Fondos oscuros pero con tinte de color distinguible (gris oscuro por defecto)
const BACKGROUNDS = [
  // Predeterminado: gradiente MORADO profundo y apagado (regla de color:
  // oscuro = morado). La textura la pone el grano de #hub::after.
  'radial-gradient(130% 100% at 80% 0%, #322752 0%, #1c1730 45%, #100d17 100%)',
  'linear-gradient(135deg, #2f2f38 0%, #16161b 100%)',                 // Grafito claro
  'radial-gradient(120% 80% at 50% -10%, #2a1d44 0%, #0c0a16 62%)',    // Violeta
  'radial-gradient(120% 80% at 50% -10%, #132a4a 0%, #080d18 62%)',    // Azul
  'radial-gradient(120% 80% at 50% -10%, #0e3330 0%, #070f0e 62%)',    // Teal
  'radial-gradient(120% 80% at 50% -10%, #3a1420 0%, #120809 62%)',    // Vino
  'radial-gradient(120% 80% at 50% -10%, #35240c 0%, #120c06 62%)',    // Ámbar
  'radial-gradient(120% 80% at 50% -10%, #123326 0%, #070f0b 62%)',    // Bosque
  'radial-gradient(120% 80% at 50% -10%, #1c2740 0%, #0b0e15 62%)',    // Acero
  'linear-gradient(135deg, #2a1030 0%, #100a1e 45%, #0a0a0d 100%)'     // Aurora
];
// Los MISMOS diez fondos en versión clara, en el mismo orden: el fondo guardado
// se sigue identificando por su valor oscuro (canónico) y aquí se traduce según
// el tema, de modo que cambiar de claro a oscuro conserva el fondo elegido.
const BACKGROUNDS_LIGHT = [
  // Predeterminado claro: blanco con tinte coral suave (regla: claro = rojo)
  'radial-gradient(120% 90% at 75% 5%, #ffe9e6 0%, #f4eef0 45%, #eceef2 100%)',
  'linear-gradient(135deg, #f4f5f8 0%, #dcdfe6 100%)',                 // Grafito claro
  'radial-gradient(120% 80% at 50% -10%, #ece4fb 0%, #dcd6ea 62%)',    // Violeta
  'radial-gradient(120% 80% at 50% -10%, #e0ecfb 0%, #d2dcea 62%)',    // Azul
  'radial-gradient(120% 80% at 50% -10%, #ddf1ec 0%, #cfe2dd 62%)',    // Teal
  'radial-gradient(120% 80% at 50% -10%, #fae2e8 0%, #ebd3d8 62%)',    // Vino
  'radial-gradient(120% 80% at 50% -10%, #faeddb 0%, #ecdfcd 62%)',    // Ámbar
  'radial-gradient(120% 80% at 50% -10%, #ddf0e5 0%, #cfe1d7 62%)',    // Bosque
  'radial-gradient(120% 80% at 50% -10%, #e2e8f3 0%, #d3d9e5 62%)',    // Acero
  'linear-gradient(135deg, #f2e3f5 0%, #e4dff0 45%, #e9eaee 100%)'     // Aurora
];
// Y en versión rosa pastel para el tema rosa (2.7.3-dev.16): todos claros y
// rosados, conservando un matiz propio para que el selector siga ofreciendo
// variedad. Mismo orden y misma identidad canónica (el valor oscuro).
const BACKGROUNDS_ROSA = [
  // Predeterminado: la malla luminosa lavanda->rosa->coral de la referencia
  'radial-gradient(55% 45% at 22% 22%, #cdbcf7 0%, rgba(205,188,247,0) 62%), radial-gradient(50% 42% at 78% 26%, #f7a8ce 0%, rgba(247,168,206,0) 62%), radial-gradient(58% 52% at 55% 82%, #f9ab90 0%, rgba(249,171,144,0) 65%), linear-gradient(160deg, #efe8fb 0%, #f8e3ee 100%)',
  'linear-gradient(135deg, #fef6fa 0%, #f2dbe7 100%)',                 // Porcelana
  'radial-gradient(120% 80% at 50% -10%, #f3e6fb 0%, #ecd9ef 62%)',    // Lila
  'radial-gradient(120% 80% at 50% -10%, #e6e9fb 0%, #e0d7ec 62%)',    // Celeste
  'radial-gradient(120% 80% at 50% -10%, #def2ec 0%, #d5e5e2 62%)',    // Menta
  'radial-gradient(120% 80% at 50% -10%, #fbdde8 0%, #f3cfdd 62%)',    // Fresa
  'radial-gradient(120% 80% at 50% -10%, #fdeadf 0%, #f4dcd2 62%)',    // Melocotón
  'radial-gradient(120% 80% at 50% -10%, #e0f2e8 0%, #d6e6dc 62%)',    // Verde pastel
  'radial-gradient(120% 80% at 50% -10%, #e7ebf5 0%, #dcdfeb 62%)',    // Gris perla
  'linear-gradient(135deg, #fce4f2 0%, #ecdcf4 45%, #fdeff6 100%)'     // Aurora rosa
];
// Traduce el fondo canónico (oscuro) al del tema activo. Las imágenes propias
// del usuario se dejan intactas: son suyas y no se reinterpretan.
function bgForTheme(v) {
  if (!v || v.startsWith('url(')) return v;
  const i = BACKGROUNDS.indexOf(v);
  if (i < 0) return v;
  const raiz = document.documentElement.classList;
  if (raiz.contains('rosa')) return BACKGROUNDS_ROSA[i];
  return raiz.contains('light') ? BACKGROUNDS_LIGHT[i] : BACKGROUNDS[i];
}
function applyBackground(v) {
  if (v === 'transparent') v = BACKGROUNDS[0]; // el modo transparente se retiró (creaba capas de sombra)
  // Identidades viejas del fondo predeterminado (antes de la gama cálida):
  // quien lo tenía elegido pasa al predeterminado nuevo, no a "fondo custom"
  if (v === 'linear-gradient(160deg, #26262d 0%, #191920 100%)' || v === 'linear-gradient(160deg, #fdf1f6 0%, #f6dde9 100%)'
    || v === 'radial-gradient(110% 85% at 70% 8%, #262218 0%, #16140f 52%, #0e0d0b 100%)'
    || v === 'radial-gradient(110% 85% at 70% 8%, #232323 0%, #141414 52%, #0d0d0d 100%)'
    || v === 'linear-gradient(160deg, #eceef2 0%, #dfe2e8 100%)') v = BACKGROUNDS[0];
  let i = BACKGROUNDS_LIGHT.indexOf(v);
  if (i < 0) i = BACKGROUNDS_ROSA.indexOf(v);
  if (i >= 0) v = BACKGROUNDS[i]; // se guarda siempre el valor oscuro como identidad
  els.hub.style.setProperty('--hub-bg', bgForTheme(v));
  store.set('cobalt.hubBg', v);
  document.querySelectorAll('.bg-thumb').forEach((t) => t.classList.toggle('sel', t.dataset.bg === v));
}
function renderBgPresets() {
  els.bgPresets.innerHTML = ''; const saved = store.get('cobalt.hubBg', BACKGROUNDS[0]);
  for (const bg of BACKGROUNDS) { const th = document.createElement('div'); th.className = 'bg-thumb' + (bg === saved ? ' sel' : ''); th.style.background = bgForTheme(bg); th.dataset.bg = bg; th.addEventListener('click', () => applyBackground(bg)); els.bgPresets.appendChild(th); }
}
els.wpFile.addEventListener('change', () => {
  const f = els.wpFile.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      // Reescala a máx 1920px de ancho y exporta JPEG para no saturar el almacenamiento
      const maxW = 1920, scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let data;
      try { data = c.toDataURL('image/jpeg', 0.82); } catch { data = r.result; }
      applyBackground(`url("${data}") center/cover no-repeat`);
      toast('Fondo actualizado');
    };
    img.onerror = () => { applyBackground(`url("${r.result}") center/cover no-repeat`); };
    img.src = r.result;
  };
  r.readAsDataURL(f);
});
$('#dial-cancel').addEventListener('click', () => els.dialModal.classList.add('hidden'));
$('#dial-save').addEventListener('click', () => { const name = els.dialName.value.trim(); const url = toUrl(els.dialUrl.value); if (!name || !url) return; dials.push({ name, url }); store.set('cobalt.dials', dials); renderHub(); els.dialModal.classList.add('hidden'); });

/* ============ Recursos gráficos ============ */
let mediaItems = [], mediaFilter = 'all';
function mediaCollector() {
  const out = [], seen = new Set();
  const push = (type, url, w, h) => { if (!url || seen.has(url) || !/^https?:/i.test(url)) return; seen.add(url); out.push({ type, url, w: w || 0, h: h || 0 }); };
  document.querySelectorAll('img').forEach((im) => { const u = im.currentSrc || im.src; if (!im.naturalWidth || im.naturalWidth >= 40) push('image', u, im.naturalWidth, im.naturalHeight); });
  document.querySelectorAll('video').forEach((v) => { push('video', v.currentSrc || v.src, v.videoWidth, v.videoHeight); v.querySelectorAll('source').forEach((s) => push('video', s.src)); if (v.poster) push('image', v.poster); });
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && i < 1500; i++) { const bg = getComputedStyle(all[i]).backgroundImage; if (bg && bg !== 'none') { const m = bg.match(/url\(["']?(https?:[^"')]+?)["']?\)/); if (m) push('image', m[1]); } }
  return out.slice(0, 220);
}
async function collectMedia() {
  const tab = activeTab(); els.mpGrid.innerHTML = '';
  if (!tab || tab.kind !== 'web' || !tab.webview) { els.mpGrid.innerHTML = '<div class="mp-empty">Abre una página web para detectar sus imágenes y vídeos.</div>'; els.mpTitle.textContent = 'Recursos gráficos'; return; }
  els.mpGrid.innerHTML = '<div class="mp-empty">Escaneando la página…</div>';
  try { mediaItems = await tab.webview.executeJavaScript(`(${mediaCollector.toString()})()`); } catch { mediaItems = []; }
  renderMedia();
}
function renderMedia() {
  const items = mediaItems.filter((m) => mediaFilter === 'all' || m.type === mediaFilter);
  els.mpTitle.textContent = `Recursos gráficos (${items.length})`; els.mpGrid.innerHTML = '';
  if (!items.length) { els.mpGrid.innerHTML = '<div class="mp-empty">No hay recursos de este tipo en esta página.<br>Para vídeos de streaming usa Rat Tool.</div>'; return; }
  for (const m of items) {
    const card = document.createElement('div'); card.className = 'mp-item'; card.title = m.url;
    let thumb;
    if (m.type === 'image') { thumb = document.createElement('img'); thumb.loading = 'lazy'; thumb.src = m.url; }
    else { thumb = document.createElement('video'); thumb.muted = true; thumb.preload = 'metadata'; thumb.src = m.url; }
    thumb.addEventListener('error', () => { thumb.remove(); const fb = document.createElement('div'); fb.className = 'mi-fallback'; fb.innerHTML = window.icon(m.type === 'video' ? 'film' : 'photo'); card.prepend(fb); });
    const meta = document.createElement('div'); meta.className = 'mi-meta'; const ext = (m.url.split('?')[0].match(/\.(\w{2,4})$/) || [])[1] || m.type;
    meta.innerHTML = `<span>${ext.toUpperCase()}</span><span>${m.w && m.h ? m.w + '×' + m.h : ''}</span>`;
    const dl = document.createElement('button'); dl.className = 'mi-dl'; dl.title = 'Descargar'; dl.innerHTML = window.icon('arrow-down-tray');
    dl.addEventListener('click', (e) => { e.stopPropagation(); window.cobalt.download(m.url, IS_PRIVATE); dl.innerHTML = window.icon('check'); card.classList.add('done'); toast('Descarga iniciada'); toggleDownloads(true); });
    card.append(thumb, meta, dl); card.addEventListener('click', () => createTab(m.url)); els.mpGrid.appendChild(card);
  }
}
function toggleMediaPanel(force) { const open = force !== undefined ? force : els.mediaPanel.classList.contains('hidden'); if (open) { closeRightPanels(); els.mediaPanel.classList.remove('hidden'); els.sbMedia.classList.add('open'); collectMedia(); } else { els.mediaPanel.classList.add('hidden'); els.sbMedia.classList.remove('open'); } }
els.sbMedia.addEventListener('click', () => toggleMediaPanel());
$('#mp-close').addEventListener('click', () => toggleMediaPanel(false));
$('#mp-refresh').addEventListener('click', collectMedia);
document.querySelectorAll('.mp-chip').forEach((chip) => chip.addEventListener('click', () => { document.querySelectorAll('.mp-chip').forEach((c) => c.classList.remove('active')); chip.classList.add('active'); mediaFilter = chip.dataset.filter; renderMedia(); }));
els.mpAll.addEventListener('click', () => { const items = mediaItems.filter((m) => mediaFilter === 'all' || m.type === mediaFilter); items.forEach((m, i) => setTimeout(() => window.cobalt.download(m.url, IS_PRIVATE), i * 150)); toast(`Descargando ${items.length} recursos…`); toggleDownloads(true); });

/* ============ Descargas ============ */
const dlMeta = new Map(); const dlRows = new Map();
const fmtBytes = (n) => { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const VIEWABLE = /\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|ogg|mp3|wav|m4a|flac|pdf|txt|json|html?)$/i;
function upsertDownload(m) {
  dlMeta.set(m.id, m);
  let row = dlRows.get(m.id);
  const pct = m.percent != null ? m.percent : (m.total ? Math.round(m.received / m.total * 100) : 0);
  const done = m.state === 'completed', error = m.state === 'interrupted' || m.state === 'cancelled';
  if (!row) { row = document.createElement('div'); row.className = 'dl-item'; row.innerHTML = `<div class="dl-top"><div class="dl-kind"></div><div class="dl-info"><div class="dl-name"></div><div class="dl-sub"></div></div><button class="dl-act"></button></div><div class="dl-bar"><i></i></div>`; dlRows.set(m.id, row); els.dlList.prepend(row); row.addEventListener('click', (e) => { if (e.target.closest('.dl-act')) return; openDownloadInBrowser(m.id); }); }
  row.classList.toggle('done', done); row.classList.toggle('error', error);
  row.querySelector('.dl-kind').innerHTML = window.icon(m.kind === 'audio' ? 'musical-note' : m.kind === 'video' ? 'film' : done ? 'check' : 'arrow-down-tray');
  row.querySelector('.dl-name').textContent = m.name;
  row.querySelector('.dl-sub').textContent = done ? 'Completado · ' + fmtBytes(m.received) + ' · clic para abrir' : error ? (m.state === 'cancelled' ? 'Cancelado' : (m.error ? 'Error: ' + m.error : 'Error')) : (pct + '%' + (m.total ? ` · ${fmtBytes(m.received)} / ${fmtBytes(m.total)}` : ''));
  row.querySelector('.dl-sub').title = m.error || '';
  row.querySelector('.dl-bar > i').style.width = pct + '%';
  // La página de descargas, si está abierta, sigue el progreso en vivo
  if (els.dlPage.classList.contains('active')) renderDlActive();
  const act = row.querySelector('.dl-act');
  if (done) { act.innerHTML = window.icon('folder'); act.title = 'Mostrar en carpeta'; act.onclick = (e) => { e.stopPropagation(); window.cobalt.revealDownload(m.id); }; }
  else if (error) { act.innerHTML = window.icon('x-mark'); act.title = 'Cerrar'; act.onclick = (e) => { e.stopPropagation(); row.remove(); dlRows.delete(m.id); }; }
  else { act.innerHTML = window.icon('x-mark'); act.title = 'Cancelar'; act.onclick = (e) => { e.stopPropagation(); window.cobalt.cancelDownload(m.id); }; }
}
async function openDownloadInBrowser(id) {
  const m = dlMeta.get(id); if (!m || m.state !== 'completed') return;
  const p = await window.cobalt.downloadPath(id); if (!p) return;
  if (VIEWABLE.test(p)) createTab('file:///' + p.replace(/\\/g, '/')); else window.cobalt.openDownload(id);
}
window.cobalt.onDownloadNew((m) => upsertDownload(m));
window.cobalt.onDownloadUpdate((m) => { upsertDownload(m); if (m.state === 'completed') { toast('Descargado: ' + m.name); els.sbDownloads.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 400 }); if (els.dlPage.classList.contains('active')) window.cobalt.listDownloadFiles().then((f) => { dlpFiles = f; renderDownloadsPage(); }); } });
function toggleDownloads(force) { const open = force !== undefined ? force : els.dlPanel.classList.contains('hidden'); if (open) { closeRightPanels(); els.dlPanel.classList.remove('hidden'); els.sbDownloads.classList.add('open'); } else { els.dlPanel.classList.add('hidden'); els.sbDownloads.classList.remove('open'); } }
els.sbDownloads.addEventListener('click', () => toggleDownloadsPage());
$('#dl-close').addEventListener('click', () => toggleDownloads(false));
$('#dl-clear').addEventListener('click', () => { window.cobalt.clearDownloads(); for (const [id, row] of dlRows) if (row.classList.contains('done') || row.classList.contains('error')) { row.remove(); dlRows.delete(id); dlMeta.delete(id); } });
function closeRightPanels() { els.mediaPanel.classList.add('hidden'); els.sbMedia.classList.remove('open'); els.dlPanel.classList.add('hidden'); els.sbDownloads.classList.remove('open'); els.pwPanel.classList.add('hidden'); els.sbPasswords.classList.remove('open'); els.historyPanel.classList.add('hidden'); els.sbHistory.classList.remove('open'); els.lootPanel.classList.add('hidden'); els.sbLoot.classList.remove('open'); }

/* ============ Página de descargas: archivos reales por tipo y fecha ============ */
const DLP_TYPES = [
  { key: 'all', label: 'Todo' },
  { key: 'image', label: 'Imágenes', re: /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff?)$/i, ico: 'photo' },
  { key: 'video', label: 'Vídeo', re: /\.(mp4|webm|mkv|mov|avi|m4v)$/i, ico: 'film' },
  { key: 'audio', label: 'Música', re: /\.(mp3|wav|m4a|flac|ogg|opus|aac)$/i, ico: 'musical-note' },
  { key: 'doc', label: 'Documentos', re: /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|epub|rtf)$/i, ico: 'clipboard' },
  { key: 'zip', label: 'Comprimidos', re: /\.(zip|rar|7z|tar|gz|iso)$/i, ico: 'archive' },
  { key: 'app', label: 'Programas', re: /\.(exe|msi|apk)$/i, ico: 'squares-plus' },
  { key: 'other', label: 'Otros' }
];
let dlpFilter = 'all', dlpFiles = [];
const dlpTypeOf = (n) => (DLP_TYPES.find((t) => t.re && t.re.test(n)) || { key: 'other' }).key;
const dlpIcoOf = (n) => (DLP_TYPES.find((t) => t.re && t.re.test(n)) || {}).ico || 'archive';
function dlpGroup(ms) {
  const d = new Date(ms), now = new Date();
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) return 'Esta semana';
  const m = d.toLocaleDateString('es', { month: 'long', year: 'numeric' });
  return m.charAt(0).toUpperCase() + m.slice(1);
}
/* Descargas EN CURSO en la página: sin esto una descarga larga no se veía en
   ninguna parte (el panel lateral ya no se abre desde el sidebar y la lista de
   abajo solo tiene lo terminado), y parecía que "nunca acababa". */
function renderDlActive() {
  // Todo lo de esta sesión que NO haya terminado bien: en curso arriba y
  // fallidas visibles (antes desaparecían sin decir nada).
  const live = [...dlMeta.values()].filter((m) => m.state !== 'completed');
  els.dlpActive.innerHTML = '';
  if (!live.length) return;
  const h = document.createElement('div'); h.className = 'dlp-day'; h.textContent = 'En curso';
  els.dlpActive.appendChild(h);
  for (const m of live) {
    const failed = m.state !== 'progressing';
    const pct = m.percent != null ? Math.round(m.percent) : (m.total ? Math.round(m.received / m.total * 100) : null);
    // Sin Content-Length no hay porcentaje: se muestran los bytes recibidos en
    // vez de un 0% que parecería atascado.
    const sub = failed
      ? (m.state === 'cancelled' ? 'Cancelada' : 'Error: ' + (m.error || 'la descarga se interrumpió'))
      : pct != null
        ? `${pct}% · ${fmtBytes(m.received) || '0 B'}${m.total ? ' / ' + fmtBytes(m.total) : ''}`
        : `Descargando… ${fmtBytes(m.received) || '0 B'}`;
    const row = document.createElement('div'); row.className = 'dlp-row live' + (failed ? ' failed' : '');
    row.innerHTML = `<div class="dlp-ic">${window.icon(dlpIcoOf(m.name))}</div>`
      + `<div class="dlp-info"><div class="dlp-name"></div><div class="dlp-sub"></div>`
      + (failed ? '' : `<div class="dlp-bar"><i style="width:${pct != null ? pct : 100}%"></i></div>`)
      + `</div><div class="dlp-acts"><button class="dlp-cancel" title="${failed ? 'Descartar' : 'Cancelar'}">${window.icon('x-mark')}</button></div>`;
    row.querySelector('.dlp-name').textContent = m.name;
    row.querySelector('.dlp-sub').textContent = sub;
    if (!failed && pct == null) row.querySelector('.dlp-bar').classList.add('indet');
    row.querySelector('.dlp-cancel').addEventListener('click', (e) => {
      e.stopPropagation();
      if (failed) { dlMeta.delete(m.id); renderDlActive(); } else window.cobalt.cancelDownload(m.id);
    });
    els.dlpActive.appendChild(row);
  }
}
function renderDownloadsPage() {
  renderDlActive();
  els.dlpFilters.innerHTML = '';
  for (const t of DLP_TYPES) {
    const n = t.key === 'all' ? dlpFiles.length : dlpFiles.filter((f) => dlpTypeOf(f.name) === t.key).length;
    if (t.key !== 'all' && !n) continue;
    const b = document.createElement('button');
    b.className = 'mp-chip' + (dlpFilter === t.key ? ' active' : '');
    b.textContent = n ? `${t.label} · ${n}` : t.label;
    b.addEventListener('click', () => { dlpFilter = t.key; renderDownloadsPage(); });
    els.dlpFilters.appendChild(b);
  }
  els.dlpList.innerHTML = '';
  const files = dlpFiles.filter((f) => dlpFilter === 'all' || dlpTypeOf(f.name) === dlpFilter);
  if (!files.length) {
    // Con algo bajando no se dice "no has descargado nada": eso confundía
    if (!els.dlpActive.childElementCount) {
      const e = document.createElement('div'); e.className = 'dlp-empty';
      e.textContent = 'Aún no has descargado nada desde Naviris.'; els.dlpList.appendChild(e);
    }
    return;
  }
  let last = null;
  for (const f of files) {
    const g = dlpGroup(f.mtime);
    if (g !== last) { const h = document.createElement('div'); h.className = 'dlp-day'; h.textContent = g; els.dlpList.appendChild(h); last = g; }
    const row = document.createElement('div'); row.className = 'dlp-row'; row.title = f.name;
    const when = new Date(f.mtime).toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `<div class="dlp-ic">${window.icon(dlpIcoOf(f.name))}</div><div class="dlp-info"><div class="dlp-name"></div><div class="dlp-sub">${fmtBytes(f.size)} · ${when}</div></div><div class="dlp-acts"><button class="dlp-reveal" title="Mostrar en carpeta">${window.icon('folder')}</button></div>`;
    row.querySelector('.dlp-name').textContent = f.name;
    row.querySelector('.dlp-reveal').addEventListener('click', (e) => { e.stopPropagation(); window.cobalt.revealDownloadFile(f.name); });
    row.addEventListener('click', () => { if (VIEWABLE.test(f.name)) createTab('file:///' + f.path.replace(/\\/g, '/')); else window.cobalt.openDownloadFile(f.name); });
    els.dlpList.appendChild(row);
  }
}
async function showDownloadsPage() {
  closeRightPanels();
  tabs.forEach((t) => t.webview?.classList.remove('active'));
  els.hub.classList.remove('active'); hideBookmarkPage(); hideAddonsPage();
  els.dlPage.classList.remove('hidden'); els.dlPage.classList.add('active'); els.sbDownloads.classList.add('open');
  dlpFiles = await window.cobalt.listDownloadFiles();
  renderDownloadsPage();
}
function hideDownloadsPage() { els.dlPage.classList.remove('active'); els.dlPage.classList.add('hidden'); els.sbDownloads.classList.remove('open'); }
function toggleDownloadsPage() { if (els.dlPage.classList.contains('active')) { hideDownloadsPage(); activateTab(activeId); } else showDownloadsPage(); }
els.dlpFolder.addEventListener('click', () => window.cobalt.openDownloadsFolder());

/* ============ Loot: registro de recompensas del auto-reclamo ============ */
let loot = store.get('cobalt.loot', []);
function recordLoot(kind, channel, info) {
  info = info || {};
  loot.unshift({ t: Date.now(), kind: kind === 'drop' ? 'drop' : 'points', channel: channel || '', name: info.name || '', balance: (typeof info.balance === 'number' ? info.balance : null) });
  if (loot.length > 500) loot = loot.slice(0, 500);
  store.set('cobalt.loot', loot);
  updateLootUI();
}

/* ============ Historial ============ */
let histFilter = '';
function renderHistory() {
  const q = histFilter.toLowerCase();
  const items = history
    .filter((h) => !q || (h.title || '').toLowerCase().includes(q) || (h.url || '').toLowerCase().includes(q))
    .sort((a, b) => b.ts - a.ts);
  els.historyList.innerHTML = '';
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 864e5).toDateString();
  let lastDay = null;
  for (const h of items) {
    const day = new Date(h.ts).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const lbl = document.createElement('div'); lbl.className = 'hist-day';
      lbl.textContent = day === today ? 'Hoy' : day === yesterday ? 'Ayer' : new Date(h.ts).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
      els.historyList.appendChild(lbl);
    }
    const item = document.createElement('div'); item.className = 'hist-item'; item.title = h.url;
    const ic = document.createElement('span'); ic.className = 'hist-ic'; ic.innerHTML = window.icon('clock');
    getTile(h.url).then((t) => { if (t?.icon) { ic.innerHTML = ''; const im = document.createElement('img'); im.src = t.icon; ic.appendChild(im); } });
    const info = document.createElement('div'); info.className = 'hist-info';
    info.innerHTML = `<div class="hist-t">${escapeHtml(h.title || h.url)}</div><div class="hist-u">${escapeHtml(hostOf(h.url))}</div>`;
    const time = document.createElement('span'); time.className = 'hist-time'; time.textContent = new Date(h.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const x = document.createElement('button'); x.className = 'hist-x'; x.title = 'Quitar'; x.innerHTML = window.icon('x-mark');
    x.addEventListener('click', (e) => { e.stopPropagation(); history = history.filter((y) => y.url !== h.url); store.set('cobalt.history', history); renderHistory(); });
    item.append(ic, info, time, x);
    item.addEventListener('click', () => navigateActive(h.url));
    els.historyList.appendChild(item);
  }
}
function toggleHistory(force) {
  const open = force !== undefined ? force : els.historyPanel.classList.contains('hidden');
  if (open) { closeRightPanels(); els.historyPanel.classList.remove('hidden'); els.sbHistory.classList.add('open'); histFilter = ''; els.historyFilter.value = ''; renderHistory(); }
  else { els.historyPanel.classList.add('hidden'); els.sbHistory.classList.remove('open'); }
}
els.sbHistory.addEventListener('click', () => toggleHistory());
els.historyClose.addEventListener('click', () => toggleHistory(false));
els.historyFilter.addEventListener('input', () => { histFilter = els.historyFilter.value; renderHistory(); });
els.historyClear.addEventListener('click', () => {
  if (!history.length) { toast('El historial ya está vacío'); return; }
  promptConfirm('¿Borrar todo el historial?', `Se eliminarán ${history.length} entradas. No se puede deshacer.`, () => {
    history = []; store.set('cobalt.history', history); renderHistory(); toast('Historial borrado');
  });
})

/* ============ Gestor de contraseñas ============ */
async function renderPasswords() {
  const list = await window.cobalt.pwList();
  els.pwList.innerHTML = '';
  for (const e of list) {
    const item = document.createElement('div'); item.className = 'pw-item';
    const ic = document.createElement('span'); ic.className = 'pw-ic'; ic.innerHTML = window.icon('key');
    getTile('https://' + e.site).then((t) => { if (t?.icon) { ic.innerHTML = ''; const im = document.createElement('img'); im.src = t.icon; ic.appendChild(im); } });
    const info = document.createElement('div'); info.className = 'pw-info';
    const sub = document.createElement('div'); sub.className = 'pw-sub'; sub.textContent = e.username || '••••••••';
    info.innerHTML = `<div class="pw-site">${escapeHtml(e.site)}</div>`; info.appendChild(sub);
    const acts = document.createElement('div'); acts.className = 'pw-acts';
    const eye = document.createElement('button'); eye.title = 'Ver contraseña (Windows Hello)'; eye.innerHTML = window.icon('eye');
    eye.addEventListener('click', async () => {
      eye.disabled = true; const r = await window.cobalt.pwReveal(e.id); eye.disabled = false;
      if (r.ok) { sub.textContent = r.password; setTimeout(() => { sub.textContent = e.username || '••••••••'; }, 15000); }
      else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo verificar');
    });
    const copy = document.createElement('button'); copy.title = 'Copiar contraseña (Windows Hello)'; copy.innerHTML = window.icon('clipboard');
    copy.addEventListener('click', async () => {
      copy.disabled = true; const r = await window.cobalt.pwReveal(e.id); copy.disabled = false;
      if (r.ok) { try { await navigator.clipboard.writeText(r.password); toast('Contraseña copiada (se borra en 20 s)'); setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 20000); } catch { toast('No se pudo copiar'); } }
      else toast('Verificación cancelada');
    });
    const del = document.createElement('button'); del.className = 'del'; del.title = 'Eliminar'; del.innerHTML = window.icon('trash');
    del.addEventListener('click', async () => { await window.cobalt.pwDelete(e.id); renderPasswords(); });
    acts.append(eye, copy, del); item.append(ic, info, acts); els.pwList.appendChild(item);
  }
}
function togglePwPanel(force) {
  const open = force !== undefined ? force : els.pwPanel.classList.contains('hidden');
  if (open) { closeRightPanels(); els.pwPanel.classList.remove('hidden'); els.sbPasswords.classList.add('open'); renderPasswords(); }
  else { els.pwPanel.classList.add('hidden'); els.sbPasswords.classList.remove('open'); els.pwForm.classList.add('hidden'); document.getElementById('card-form').classList.add('hidden'); }
}
els.sbPasswords.addEventListener('click', async () => {
  const info = await window.cobalt.pwAvailable();
  if (!info.encryption) { toast('El cifrado seguro no está disponible en este sistema'); return; }
  togglePwPanel();
});
$('#pw-close').addEventListener('click', () => togglePwPanel(false));
els.pwAddbtn.addEventListener('click', () => {
  // Abre el formulario de la pestaña activa del panel (contraseñas o tarjetas)
  const enTarjetas = !document.getElementById('pw-sec-cards').classList.contains('hidden');
  if (enTarjetas) { const f = document.getElementById('card-form'); f.classList.toggle('hidden'); document.getElementById('card-number').focus(); return; }
  els.pwForm.classList.toggle('hidden'); els.pwSite.value = ''; els.pwUser.value = ''; els.pwPass.value = ''; els.pwSite.focus();
});
els.pwImport.addEventListener('click', async () => {
  toast('Elige el CSV exportado desde tu navegador (Configuración → Contraseñas → Exportar)');
  const r = await window.cobalt.pwImportCsv();
  if (r.ok) { renderPasswords(); toast(`Importadas: ${r.added} nuevas, ${r.updated} actualizadas`); }
  else if (!r.canceled) toast('No se pudo importar: ' + (r.error || 'archivo no válido'));
});
els.pwCancel.addEventListener('click', () => els.pwForm.classList.add('hidden'));
els.pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const site = hostOf(els.pwSite.value.includes('://') ? els.pwSite.value : 'https://' + els.pwSite.value) || els.pwSite.value.trim();
  if (!site || !els.pwPass.value) { toast('Falta el sitio o la contraseña'); return; }
  const r = await window.cobalt.pwAdd(site, els.pwUser.value.trim(), els.pwPass.value);
  if (r.ok) { els.pwForm.classList.add('hidden'); renderPasswords(); toast('Contraseña guardada y cifrada'); }
  else toast('No se pudo guardar');
});

/* ============ Gestor de tarjetas (pestaña del panel de contraseñas) ============ */
const cardEls = {
  tabPw: $('#pw-tab-pw'), tabCards: $('#pw-tab-cards'), secPw: $('#pw-sec-pw'), secCards: $('#pw-sec-cards'),
  form: $('#card-form'), number: $('#card-number'), holder: $('#card-holder'), month: $('#card-month'), year: $('#card-year'),
  cancel: $('#card-cancel'), list: $('#card-list')
};
function switchPwTab(cards) {
  cardEls.tabPw.classList.toggle('active', !cards); cardEls.tabCards.classList.toggle('active', cards);
  cardEls.secPw.classList.toggle('hidden', cards); cardEls.secCards.classList.toggle('hidden', !cards);
  document.querySelector('#pw-panel .mp-head > span').textContent = cards ? 'Tarjetas' : 'Contraseñas';
  els.pwImport.classList.toggle('hidden', cards); // el CSV es solo de contraseñas
  if (cards) renderCards(); else renderPasswords();
}
cardEls.tabPw.addEventListener('click', () => switchPwTab(false));
cardEls.tabCards.addEventListener('click', () => switchPwTab(true));
async function renderCards() {
  const list = await window.cobalt.cardsList();
  cardEls.list.innerHTML = '';
  for (const c of list) {
    const item = document.createElement('div'); item.className = 'pw-item';
    const ic = document.createElement('span'); ic.className = 'pw-ic card-chip'; ic.textContent = c.brand === 'American Express' ? 'AmEx' : c.brand.slice(0, 4);
    const info = document.createElement('div'); info.className = 'pw-info';
    const num = document.createElement('div'); num.className = 'pw-site card-num'; num.textContent = '•••• ' + c.last4;
    const sub = document.createElement('div'); sub.className = 'pw-sub';
    sub.textContent = `${c.brand} · ${String(c.expMonth).padStart(2, '0')}/${c.expYear}` + (c.holder ? ' · ' + c.holder : '');
    info.append(num, sub);
    const acts = document.createElement('div'); acts.className = 'pw-acts';
    const eye = document.createElement('button'); eye.title = 'Ver número completo (Windows Hello)'; eye.innerHTML = window.icon('eye');
    eye.addEventListener('click', async () => {
      eye.disabled = true; const r = await window.cobalt.cardsReveal(c.id); eye.disabled = false;
      if (r.ok) { num.textContent = r.number.replace(/(\d{4})(?=\d)/g, '$1 '); setTimeout(() => { num.textContent = '•••• ' + c.last4; }, 15000); }
      else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo verificar');
    });
    const copy = document.createElement('button'); copy.title = 'Copiar número (Windows Hello)'; copy.innerHTML = window.icon('clipboard');
    copy.addEventListener('click', async () => {
      copy.disabled = true; const r = await window.cobalt.cardsReveal(c.id); copy.disabled = false;
      if (r.ok) { try { await navigator.clipboard.writeText(r.number); toast('Número copiado (se borra en 20 s)'); setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 20000); } catch { toast('No se pudo copiar'); } }
      else toast('Verificación cancelada');
    });
    const del = document.createElement('button'); del.className = 'del'; del.title = 'Eliminar'; del.innerHTML = window.icon('trash');
    del.addEventListener('click', async () => { await window.cobalt.cardsDelete(c.id); renderCards(); });
    acts.append(eye, copy, del); item.append(ic, info, acts); cardEls.list.appendChild(item);
  }
}
cardEls.cancel.addEventListener('click', () => cardEls.form.classList.add('hidden'));
cardEls.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await window.cobalt.cardsAdd({ number: cardEls.number.value, holder: cardEls.holder.value.trim(), expMonth: cardEls.month.value, expYear: cardEls.year.value });
  if (r.ok) { cardEls.form.classList.add('hidden'); cardEls.number.value = cardEls.holder.value = cardEls.month.value = cardEls.year.value = ''; renderCards(); toast(r.updated ? 'Tarjeta actualizada' : 'Tarjeta guardada y cifrada'); }
  else toast(r.error || 'No se pudo guardar');
});
// El número se agrupa de 4 en 4 mientras se escribe, como en los formularios de pago
cardEls.number.addEventListener('input', () => {
  const digits = cardEls.number.value.replace(/\D/g, '').slice(0, 19);
  cardEls.number.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
});

/* ============ Rat Tool ============ */
const GRABBABLE = ['youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'twitch.tv', 'vimeo.com', 'dailymotion.com', 'reddit.com'];
const PLAT_MAP = { 'youtube.com': ['YouTube', 'youtube'], 'youtu.be': ['YouTube', 'youtube'], 'instagram.com': ['Instagram', 'instagram'], 'twitter.com': ['X', 'x'], 'x.com': ['X', 'x'], 'tiktok.com': ['TikTok', null], 'twitch.tv': ['Twitch', 'twitch'], 'facebook.com': ['Facebook', null], 'vimeo.com': ['Vimeo', null], 'reddit.com': ['Reddit', 'reddit'], 'dailymotion.com': ['Dailymotion', null] };
function platOf(url) { const h = hostOf(url); for (const d in PLAT_MAP) if (h === d || h.endsWith('.' + d)) return PLAT_MAP[d]; return null; }
// Extrae la URL del vídeo que se está viendo. En el feed de TikTok (/foryou) la
// barra no cambia, así que buscamos el vídeo concreto por varias vías.
function resolveMediaUrl() {
  const RX = /youtu\.be\/|\/(watch|shorts|video|status|reel|reels|clip|p|tv|embed)(\/|\?|$)/i;
  const ok = (u) => u && RX.test(u) ? u : null;
  // 1. Si la propia URL ya es de un vídeo, úsala
  if (ok(location.href)) return location.href;
  // 2. canonical / og:url (páginas de vídeo directas)
  const c = document.querySelector('link[rel="canonical"]'); if (ok(c && c.href)) return c.href;
  const og = document.querySelector('meta[property="og:url"]'); if (ok(og && og.content)) return og.content;
  // 3. Feeds (TikTok FYP, etc.): el enlace a /video/ más centrado en el viewport
  const cy = window.innerHeight / 2;
  let best = null, bestD = Infinity;
  document.querySelectorAll('a[href*="/video/"], a[href*="/status/"], a[href*="/reel/"]').forEach((a) => {
    if (!ok(a.href)) return;
    const r = a.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.width < 30 || r.height < 30) return;
    const d = Math.abs((r.top + r.bottom) / 2 - cy);
    if (d < bestD) { bestD = d; best = a.href; }
  });
  if (best) return best;
  // 4. Último recurso: el vídeo en reproducción → ancestro con enlace a /video/
  const vids = [...document.querySelectorAll('video')];
  const playing = vids.find((v) => !v.paused && v.currentTime > 0) || vids[0];
  if (playing) { let el = playing; for (let i = 0; i < 10 && el; i++, el = el.parentElement) { const a = el.querySelector && el.querySelector('a[href*="/video/"], a[href*="/status/"]'); if (a && ok(a.href)) return a.href; } }
  return location.href;
}
// ¿La pestaña activa es Twitch?
function activeIsTwitch() { const t = activeTab(); return t?.kind === 'web' && /(^|\.)twitch\.tv$/.test(hostOf(t.url)); }

/* ============ Panel de AutoLoot (integrado en el core) ============ */
let lootView = 'ses'; // 'ses' | 'hist'
// Ilumina el botón del sidebar cuando hay sesiones recolectando y refresca el
// panel si está abierto.
function updateLootUI() {
  const active = tabs.some((t) => t.autoLoot);
  els.sbLoot.classList.toggle('collecting', active);
  if (!els.lootPanel.classList.contains('hidden')) renderLootPanel();
}
let lootTimer = null;
function fmtDur(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm';
  return (s % 60) + 's';
}
function toggleLootPanel(force) {
  const open = force !== undefined ? force : els.lootPanel.classList.contains('hidden');
  if (open) {
    closeRightPanels(); els.lootPanel.classList.remove('hidden'); els.sbLoot.classList.add('open'); renderLootPanel();
    // Mientras el panel esté abierto, refresca el temporizador de cada sesión.
    if (!lootTimer) lootTimer = setInterval(() => {
      if (els.lootPanel.classList.contains('hidden')) { clearInterval(lootTimer); lootTimer = null; return; }
      if (lootView === 'ses') renderLootPanel();
    }, 10000);
  } else {
    els.lootPanel.classList.add('hidden'); els.sbLoot.classList.remove('open');
    if (lootTimer) { clearInterval(lootTimer); lootTimer = null; }
  }
}
function renderLootPanel() {
  els.lootTabSes.classList.toggle('active', lootView === 'ses');
  els.lootTabHist.classList.toggle('active', lootView === 'hist');
  const twitch = activeIsTwitch();
  // AutoClaim v2: sesión ÚNICA (un solo canal a la vez)
  const s = tabs.find((t) => t.autoLoot) || null;
  const cur = activeTab();
  const body = els.lootBody; body.innerHTML = '';
  if (lootView === 'ses') {
    if (!s) {
      const go = document.createElement('button'); go.id = 'loot-go'; go.className = 'loot-go' + (twitch ? '' : ' off');
      go.textContent = 'Activar en este canal'; go.disabled = !twitch;
      go.addEventListener('click', () => { activateAutoLoot(activeTab()); renderLootPanel(); });
      body.appendChild(go);
      const hint = document.createElement('div'); hint.className = 'loot-hint';
      hint.textContent = twitch
        ? 'Silencia el canal, baja la resolución solo en esa pestaña y reclama puntos y drops en segundo plano. Un canal a la vez.'
        : 'Abre un canal de Twitch para poder activar el AutoClaim.';
      body.appendChild(hint);
    } else {
      body.appendChild(lootLabel('CANAL EN FARMEO'));
      const row = document.createElement('div'); row.className = 'loot-ses';
      row.innerHTML = '<span class="ls-dot"></span><span class="ls-info"><span class="ls-name"></span><span class="ls-time"></span></span><span class="ls-n"></span>';
      row.querySelector('.ls-name').textContent = s.title || s.url;
      const tspan = row.querySelector('.ls-time');
      tspan.textContent = s.lootStart ? ('farmeando ' + fmtDur(Date.now() - s.lootStart)) : '';
      tspan.title = 'Tiempo que el AutoClaim lleva trabajando en este canal';
      const nspan = row.querySelector('.ls-n');
      nspan.textContent = s.twitchClaims || 0;
      nspan.title = 'Reclamos (puntos + drops) en esta sesión';
      const go2 = document.createElement('button'); go2.className = 'ls-btn'; go2.textContent = 'ir'; go2.addEventListener('click', () => activateTab(s.id));
      const stop = document.createElement('button'); stop.className = 'ls-btn stop'; stop.textContent = 'detener'; stop.addEventListener('click', () => { setAutoLoot(s, false); renderLootPanel(); });
      row.append(go2, stop); body.appendChild(row);
      // Estás viendo OTRO canal de Twitch: ofrecer mover el farmeo aquí
      if (twitch && cur && cur.id !== s.id) {
        const sw = document.createElement('button'); sw.className = 'loot-go'; sw.style.marginTop = '10px';
        sw.textContent = 'Cambiar el farmeo a este canal';
        sw.addEventListener('click', () => { activateAutoLoot(cur); renderLootPanel(); });
        body.appendChild(sw);
      }
      const hint2 = document.createElement('div'); hint2.className = 'loot-hint';
      hint2.textContent = 'Solo se farmea un canal a la vez: activar en otro canal detiene este.';
      body.appendChild(hint2);
    }
  } else {
    const pts = loot.filter((l) => l.kind === 'points').length, drops = loot.filter((l) => l.kind === 'drop').length;
    body.appendChild(lootLabel('LOOT OBTENIDO', pts + ' cofres · ' + drops + ' drops'));
    if (!loot.length) { const e = document.createElement('div'); e.className = 'loot-empty'; e.textContent = 'Aún no se ha reclamado nada.'; body.appendChild(e); }
    // Agrupado por canal: nº de cofres de puntos + saldo, y los drops con su nombre.
    const groups = new Map();
    for (const l of loot) { const k = (l.channel || 'Twitch').replace(/^www\./, ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
    const order = [...groups.entries()].sort((a, b) => b[1][0].t - a[1][0].t);
    for (const [chan, items] of order) {
      const ptsItems = items.filter((x) => x.kind === 'points');
      const dropItems = items.filter((x) => x.kind === 'drop');
      const bals = ptsItems.map((x) => x.balance).filter((x) => typeof x === 'number');
      const bal = bals.length ? Math.max(...bals) : null;
      const card = document.createElement('div'); card.className = 'loot-hgroup';
      const head = document.createElement('div'); head.className = 'lhg-head';
      const nm = document.createElement('span'); nm.className = 'lhg-name'; nm.textContent = chan;
      const sum = document.createElement('span'); sum.className = 'lhg-sum';
      sum.textContent = `${ptsItems.length} cofres` + (bal != null ? ` · ${bal.toLocaleString('es')} pts` : '') + (dropItems.length ? ` · ${dropItems.length} drops` : '');
      head.append(nm, sum); card.appendChild(head);
      for (const d of dropItems.slice(0, 40)) {
        const row = document.createElement('div'); row.className = 'lhg-drop';
        const ic = document.createElement('span'); ic.className = 'lh-ic'; ic.innerHTML = window.icon('gift');
        const dn = document.createElement('span'); dn.className = 'lh-name'; dn.textContent = d.name || 'Drop reclamado';
        const when = document.createElement('span'); when.className = 'lh-when';
        when.textContent = new Date(d.t).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        row.append(ic, dn, when); card.appendChild(row);
      }
      body.appendChild(card);
    }
    if (loot.length) { const c = document.createElement('button'); c.className = 'loot-clear-btn'; c.textContent = 'Vaciar historial'; c.addEventListener('click', () => { loot = []; store.set('cobalt.loot', loot); renderLootPanel(); }); body.appendChild(c); }
  }
}
function lootLabel(t, extra) {
  const d = document.createElement('div'); d.className = 'loot-lbl';
  d.innerHTML = '<span></span><span class="ll-x"></span>';
  d.firstChild.textContent = t; d.querySelector('.ll-x').textContent = extra || '';
  return d;
}
els.sbLoot.addEventListener('click', () => toggleLootPanel());
els.lootClose.addEventListener('click', () => toggleLootPanel(false));
els.lootTabSes.addEventListener('click', () => { lootView = 'ses'; renderLootPanel(); });
els.lootTabHist.addEventListener('click', () => { lootView = 'hist'; renderLootPanel(); });

/* Ancla un popover de herramienta JUNTO a su botón del sidebar. Antes iban
   clavados abajo por CSS (de cuando sus botones vivían abajo) y se abrían
   lejos del botón — queja del usuario 2026-08-11. */
function anclarPop(pop, btn) {
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.round(r.right + 14) + 'px';
  pop.style.bottom = 'auto';
  pop.style.top = '0px'; // visible y medible antes de colocarlo
  const h = pop.offsetHeight;
  pop.style.top = Math.max(8, Math.min(Math.round(r.top), window.innerHeight - h - 12)) + 'px';
}
/* Cierra los popovers de herramientas: lo llama el clic fuera (UI) y el foco
   de cualquier webview (los clics DENTRO de la página no burbujean hasta
   aquí, así que sin esto los popovers se quedaban abiertos). */
function cerrarPopsHerramientas() {
  if (els.ratPop && !els.ratPop.classList.contains('hidden')) { els.ratPop.classList.add('hidden'); els.sbRat.classList.remove('open'); }
  if (els.resPop && !els.resPop.classList.contains('hidden')) { els.resPop.classList.add('hidden'); els.sbRes.classList.toggle('open', !!resMode); }
  if (els.lootPop && !els.lootPop.classList.contains('hidden')) toggleLootPanel(false);
}
els.sbRat.addEventListener('click', async (e) => {
  e.stopPropagation();
  const open = els.ratPop.classList.contains('hidden'); els.ratPop.classList.toggle('hidden'); els.sbRat.classList.toggle('open', open);
  if (!open) return;
  anclarPop(els.ratPop, els.sbRat);
  const tab = activeTab();
  els.ratHeadsub.textContent = 'Descargar vídeo o audio';
  let url = tab?.kind === 'web' ? tab.url : '';
  // 1º: el vídeo de la PÁGINA ACTUAL (así, al pasar de TikTok a YouTube, detecta YouTube)
  if (tab?.kind === 'web' && tab.webview) { try { const real = await tab.webview.executeJavaScript(`(${resolveMediaUrl.toString()})()`); if (real) url = real; } catch {} }
  // 2º: solo si la página actual NO es un vídeo, usa el enlace copiado (útil en Instagram: copiar enlace → detectar)
  if (!isVideoUrl(url)) {
    try { const clip = (await window.cobalt.readClipboard() || '').trim(); if (/^https?:\/\/\S+$/i.test(clip)) url = clip; } catch {}
  }
  els.ratUrl.value = url; updateRatPlat();
  els.ratXcheck.checked = !!settings.xRevealSensitive;
  els.ratQrow.classList.add('hidden'); loadRatQualities();
  const ok = await window.cobalt.ytAvailable();
  els.ratNote.textContent = ok ? 'Se guarda en Descargas. En TikTok abre un vídeo concreto; se baja sin marca de agua.' : 'Faltan yt-dlp/ffmpeg en resources/bin.';
});

/* ============ AutoLoot (por pestaña) ============ */
function setAutoLoot(tab, on) {
  if (!tab || tab.kind !== 'web') return;
  tab.autoLoot = !!on;
  if (on) { if (!tab.lootStart) tab.lootStart = Date.now(); } // marca de inicio para el temporizador
  else { tab.lowRes = false; tab.twitchClaims = 0; delete tab.lootStart; }
  try { tab.webview?.send('cobalt-autoloot', { on: !!on, lowRes: !!tab.lowRes }); } catch { /* nada */ }
  renderTabs(); updateLootUI();
}
function activateAutoLoot(tab) {
  if (!tab || tab.kind !== 'web') return;
  // AutoClaim v2: UN solo canal a la vez (no se puede farmear dos, decisión de
  // producto). Activar aquí apaga cualquier sesión anterior.
  for (const t of tabs) if (t.autoLoot && t.id !== tab.id) setAutoLoot(t, false);
  tab.lowRes = true; tab.autoLoot = true;
  if (!tab.lootStart) tab.lootStart = Date.now(); // inicio del temporizador de trabajo
  if (!tab.muted) { tab.muted = true; try { tab.webview?.setAudioMuted(true); } catch { /* nada */ } }
  // La calidad ahora baja desde el menú del reproductor (en caliente), así que
  // ya no hace falta recargar la pestaña ni reiniciar el stream.
  try { tab.webview?.send('cobalt-autoloot', { on: true, lowRes: true }); } catch { /* nada */ }
  renderTabs(); updateLootUI();
  toast('AutoClaim activo: canal silenciado y en resolución mínima');
}
function updateRatPlat() {
  const url = els.ratUrl.value.trim(); const p = platOf(url);
  const tab = activeTab(); const onSite = tab?.kind === 'web' && p && hostOf(tab.url) === hostOf(url);
  // Tarjeta de detección con logo + URL cuando estás en la web
  if (p && onSite) {
    els.ratDetect.classList.remove('hidden');
    els.ratDetectLogo.innerHTML = p[1] ? window.brandIcon(p[1]) : window.icon('film');
    els.ratDetectName.textContent = 'Vídeo en ' + p[0] + ' detectado';
    els.ratDetectUrl.textContent = url;
  } else els.ratDetect.classList.add('hidden');
  // Toggle de sensibilidad solo en X
  const onX = p && p[0] === 'X' && onSite;
  els.ratXtoggle.classList.toggle('hidden', !onX);
  const looksVideo = isVideoUrl(url);
  if (p && !looksVideo) els.ratPlat.innerHTML = `<b style="color:var(--danger)">Abre un vídeo concreto</b> o pega su enlace (en el feed no se detecta).`;
  else els.ratPlat.innerHTML = p ? `Plataforma: <b>${p[0]}</b>` : (url ? 'Se intentará con yt-dlp.' : '');
}
let ratQualityToken = 0, ratQualityTimer = null;
async function loadRatQualities() {
  const url = els.ratUrl.value.trim();
  if (!/^https?:\/\//.test(url)) { els.ratQrow.classList.add('hidden'); return; }
  const token = ++ratQualityToken;
  els.ratQrow.classList.remove('hidden');
  els.ratQuality.innerHTML = '<option value="">Cargando resoluciones…</option>';
  let heights = [];
  try { heights = await window.cobalt.ytFormats(url); } catch {}
  if (token !== ratQualityToken) return; // llegó otra petición más nueva
  if (!heights.length) { els.ratQuality.innerHTML = '<option value="">Máxima calidad</option>'; return; }
  els.ratQuality.innerHTML = '<option value="">Máxima calidad</option>';
  heights.forEach((h) => { const o = document.createElement('option'); o.value = String(h); o.textContent = h + 'p'; els.ratQuality.appendChild(o); });
}
els.ratUrl.addEventListener('input', () => { updateRatPlat(); clearTimeout(ratQualityTimer); ratQualityTimer = setTimeout(loadRatQualities, 700); });
els.ratXcheck.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ xRevealSensitive: els.ratXcheck.checked }); const tab = activeTab(); if (tab?.kind === 'web' && /(^|\.)(x\.com|twitter\.com)$/.test(hostOf(tab.url))) tab.webview.reload(); toast(els.ratXcheck.checked ? 'Contenido sensible visible en X' : 'Sensibilidad de X restaurada'); });
async function ratGrab(mode) { const url = els.ratUrl.value.trim(); if (!/^https?:/.test(url)) { toast('Pega un enlace válido'); return; } const quality = mode === 'video' ? els.ratQuality.value : ''; els.ratPop.classList.add('hidden'); els.sbRat.classList.remove('open'); toggleDownloads(true); await window.cobalt.ytDownload(url, mode, quality); toast(mode === 'audio' ? 'Extrayendo MP3…' : (quality ? `Descargando vídeo (${quality}p)…` : 'Descargando vídeo…')); }
els.ratVideo.addEventListener('click', () => ratGrab('video'));
els.ratAudio.addEventListener('click', () => ratGrab('audio'));

/* ============ Resoluciones ============ */
const RESOLUTIONS = [
  { w: 0, h: 0, label: 'Adaptable', note: 'nativa' }, { w: 1920, h: 1080, label: 'Full HD', note: 'la más usada' },
  { w: 1366, h: 768, label: 'HD portátil', note: 'muy común' }, { w: 1536, h: 864, label: 'FHD 125%', note: 'con escala' },
  { w: 1440, h: 900, label: 'WXGA+', note: '16:10' }, { w: 1600, h: 900, label: 'HD+', note: '' },
  { w: 1280, h: 800, label: 'WXGA', note: 'portátiles antiguos' }, { w: 1280, h: 720, label: 'HD 720p', note: '' },
  { w: 1360, h: 768, label: 'HD 1360', note: 'económicos' }, { w: 1024, h: 768, label: 'XGA', note: 'muy antiguos' },
  { w: 1280, h: 1024, label: 'SXGA', note: '5:4' }, { w: 800, h: 600, label: 'SVGA', note: 'mínima' },
  { w: 2560, h: 1440, label: 'QHD', note: '27"' }, { w: 3840, h: 2160, label: '4K UHD', note: '' }
];
let resMode = null;
function applyResponsive() {
  for (const t of tabs) if (t.webview) t.webview.style.cssText = '';
  const tab = activeTab();
  if (!resMode || !tab || tab.kind !== 'web' || !tab.webview) { els.content.classList.remove('res-mode'); els.resLabel.classList.add('hidden'); return; }
  els.content.classList.add('res-mode'); const rect = els.content.getBoundingClientRect();
  const k = Math.min((rect.width - 28) / resMode.w, (rect.height - 52) / resMode.h, 1); const wv = tab.webview;
  wv.style.width = resMode.w + 'px'; wv.style.height = resMode.h + 'px'; wv.style.left = '50%'; wv.style.top = '50%'; wv.style.transform = `translate(-50%,-50%) scale(${k})`;
  els.resLabel.textContent = `${resMode.label} · ${resMode.w}×${resMode.h}` + (k < 1 ? ` · ${Math.round(k * 100)}%` : ''); els.resLabel.classList.remove('hidden');
}
function renderResList() {
  els.resList.innerHTML = '';
  for (const r of RESOLUTIONS) { const btn = document.createElement('button'); const sel = resMode ? resMode.w === r.w && resMode.h === r.h : r.w === 0; btn.className = 'rp-item' + (sel ? ' sel' : ''); btn.innerHTML = `<span>${r.label} <span class="rp-note">${r.note}</span></span><span class="rp-dim">${r.w ? r.w + '×' + r.h : '—'}</span>`; btn.addEventListener('click', () => { resMode = r.w ? r : null; applyResponsive(); renderResList(); }); els.resList.appendChild(btn); }
}
els.sbRes.addEventListener('click', (e) => { e.stopPropagation(); const open = els.resPop.classList.contains('hidden'); els.resPop.classList.toggle('hidden'); els.sbRes.classList.toggle('open', open); if (open) { anclarPop(els.resPop, els.sbRes); renderResList(); } });
window.addEventListener('resize', () => applyResponsive());

/* ============ Sidebar home + ajustes ============ */
els.sbHome.addEventListener('click', () => { const h = tabs.find((t) => t.kind === 'hub'); if (h) activateTab(h.id); else createTab(); });
els.sbSettings.addEventListener('click', (e) => { e.stopPropagation(); els.menuPop.classList.toggle('hidden'); });

/* ============ Bloqueador ============ */
let adblockPoll = null;
async function refreshAdblockUI() {
  const info = await window.cobalt.adblockGet(); els.adblockToggle.checked = info.enabled; els.navShield.classList.toggle('off', !info.enabled);
  els.adblockCount.textContent = info.enabled ? `${info.blocked} peticiones bloqueadas` : 'Desactivado';
  const tab = activeTab(); const host = tab?.kind === 'web' ? hostOf(tab.url) : '';
  if (host) { const allowed = info.whitelist.includes(host); els.adblockSite.classList.remove('hidden'); els.adblockSite.textContent = allowed ? `Volver a bloquear en ${host}` : `Permitir anuncios en ${host}`; els.adblockSite.dataset.host = host; els.adblockSite.dataset.allowed = allowed ? '1' : ''; } else els.adblockSite.classList.add('hidden');
  els.adblockList.innerHTML = '';
  for (const d of info.whitelist) { const row = document.createElement('div'); row.className = 'sp-item'; const s = document.createElement('span'); s.textContent = d; const rm = document.createElement('button'); rm.innerHTML = window.icon('trash'); rm.addEventListener('click', async () => { await window.cobalt.adblockWhitelist('remove', d); refreshAdblockUI(); }); row.append(s, rm); els.adblockList.appendChild(row); }
}
els.navShield.addEventListener('click', async (e) => { e.stopPropagation(); const open = els.shieldPop.classList.contains('hidden'); els.shieldPop.classList.toggle('hidden'); els.navShield.classList.toggle('open', open); clearInterval(adblockPoll); if (open) { await refreshAdblockUI(); adblockPoll = setInterval(refreshAdblockUI, 3000); } });
els.adblockToggle.addEventListener('change', async () => { await window.cobalt.adblockSetEnabled(els.adblockToggle.checked); refreshAdblockUI(); toast(els.adblockToggle.checked ? 'Bloqueador activado' : 'Bloqueador desactivado'); const tab = activeTab(); if (tab?.kind === 'web' && /(^|\.)youtube\.com$/.test(hostOf(tab.url))) tab.webview.reload(); });
els.adblockSite.addEventListener('click', async () => { const host = els.adblockSite.dataset.host; if (!host) return; await window.cobalt.adblockWhitelist(els.adblockSite.dataset.allowed ? 'remove' : 'add', host); refreshAdblockUI(); activeTab()?.webview?.reload(); });

/* ============ Información del sitio (candado) ============ */
const sitePop = document.getElementById('site-pop');
const stp = {
  host: document.getElementById('stp-host'), close: document.getElementById('stp-close'),
  secure: document.getElementById('stp-secure'), secureTitle: document.getElementById('stp-secure-title'),
  secureSub: document.getElementById('stp-secure-sub'), cookieN: document.getElementById('stp-cookie-n'),
  clear: document.getElementById('stp-cookies-clear'), config: document.getElementById('stp-siteconfig'),
  lock: document.getElementById('url-secure')
};
function cerrarSitePop() { sitePop.classList.add('hidden'); }
async function abrirSitePop() {
  const tab = activeTab();
  if (!tab || tab.kind !== 'web' || !tab.url) return;
  const u = (() => { try { return new URL(tab.url); } catch { return null; } })();
  if (!u) return;
  stp.host.textContent = u.hostname.replace(/^www\./, '');
  const seguro = u.protocol === 'https:';
  stp.secure.classList.toggle('danger', !seguro && u.protocol === 'http:');
  stp.secure.querySelector('.stp-ic').innerHTML = window.icon(seguro ? 'lock-closed' : 'eye-slash');
  if (seguro) { stp.secureTitle.textContent = 'La conexión es segura'; stp.secureSub.textContent = 'Lo que envías a este sitio (contraseñas, tarjetas) viaja cifrado.'; }
  else if (u.protocol === 'http:') { stp.secureTitle.textContent = 'La conexión no es segura'; stp.secureSub.textContent = 'Este sitio va por HTTP: no escribas datos sensibles aquí.'; }
  else { stp.secureTitle.textContent = 'Página local'; stp.secureSub.textContent = ''; }
  stp.cookieN.textContent = 'Contando…';
  sitePop.classList.remove('hidden');
  const d = await window.cobalt.siteData(tab.url, PARTITION);
  stp.cookieN.textContent = d.ok ? (d.cookies === 1 ? '1 cookie de este sitio' : d.cookies + ' cookies de este sitio') : 'No disponible';
}
stp.lock.addEventListener('click', (e) => { e.stopPropagation(); sitePop.classList.contains('hidden') ? abrirSitePop() : cerrarSitePop(); });
stp.close.addEventListener('click', cerrarSitePop);
stp.clear.addEventListener('click', async () => {
  const tab = activeTab(); if (!tab || tab.kind !== 'web') return;
  const r = await window.cobalt.siteClear(tab.url, PARTITION);
  if (r.ok) { toast('Cookies y datos del sitio borrados'); stp.cookieN.textContent = '0 cookies de este sitio'; try { tab.webview?.reload(); } catch { /* nada */ } }
  else toast('No se pudieron borrar los datos');
});
stp.config.addEventListener('click', () => { cerrarSitePop(); showPermManager(); });

/* ============ Navegación ============ */
els.navBack.addEventListener('click', () => activeTab()?.webview?.goBack());
els.navFwd.addEventListener('click', () => activeTab()?.webview?.goForward());
els.navReload.addEventListener('click', () => { const wv = activeTab()?.webview; if (!wv) return; wv.isLoading() ? wv.stop() : wv.reload(); });
els.navHome.addEventListener('click', () => createTab());
els.newtabBtn.addEventListener('click', () => createTab());

/* ============ Menú ============ */
els.navMenu.addEventListener('click', (e) => { e.stopPropagation(); els.menuPop.classList.toggle('hidden'); });
document.addEventListener('click', (e) => {
  if (!els.menuPop.contains(e.target) && !els.navMenu.contains(e.target) && !els.sbSettings.contains(e.target)) els.menuPop.classList.add('hidden');
  if (!els.resPop.contains(e.target) && !els.sbRes.contains(e.target)) { els.resPop.classList.add('hidden'); els.sbRes.classList.toggle('open', !!resMode); }
  if (!els.ratPop.contains(e.target) && !els.sbRat.contains(e.target)) { els.ratPop.classList.add('hidden'); els.sbRat.classList.remove('open'); }
  if (!els.shieldPop.contains(e.target) && !els.navShield.contains(e.target)) { els.shieldPop.classList.add('hidden'); els.navShield.classList.remove('open'); clearInterval(adblockPoll); adblockPoll = null; }
  if (!sitePop.contains(e.target) && !stp.lock.contains(e.target)) cerrarSitePop();
  if (!els.lootPanel.classList.contains('hidden') && !els.lootPanel.contains(e.target) && !els.sbLoot.contains(e.target)) toggleLootPanel(false);
  if (folderPop && !folderPop.contains(e.target) && !e.target.closest('.bm-folder')) closeFolderPop();
});
els.menuPop.addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.action; if (!a) return; els.menuPop.classList.add('hidden');
  if (a === 'newtab') createTab(); if (a === 'private') window.cobalt.newPrivateWindow(); if (a === 'bookmarks') showBookmarkPage();
  if (a === 'toggle-bookmarks') els.bookmarksBar.classList.toggle('hidden'); if (a === 'about') showAbout();
  if (a === 'update') { showAbout(); setTimeout(() => $('#upd-btn').click(), 100); }
  if (a === 'permissions') showPermManager();
});
els.optSmartsearch.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ smartSearch: els.optSmartsearch.checked }); });
els.optPasskeys.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ blockPasskeys: els.optPasskeys.checked }); toast(els.optPasskeys.checked ? 'Claves de acceso bloqueadas (recarga o reinicia)' : 'Claves de acceso permitidas (reinicia Naviris)'); activeTab()?.webview?.reload(); });
els.optRestore.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ restoreSession: els.optRestore.checked }); if (els.optRestore.checked) saveSession(); else store.set('cobalt.session', []); toast(els.optRestore.checked ? 'Se reabrirán tus pestañas al iniciar' : 'Se iniciará en el hub'); });
els.optPowersaver.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ powerSaver: els.optPowersaver.checked }); });
els.optAtajos.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ atajos: els.optAtajos.checked }); toast(els.optAtajos.checked ? 'Atajos de teclado activados' : 'Atajos de teclado desactivados'); });
els.optMousenav.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ mouseNav: els.optMousenav.checked }); toast(els.optMousenav.checked ? 'Botones del ratón activados' : 'Botones del ratón desactivados'); });
els.optLight.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ lightMode: els.optLight.checked }); applyTheme(settings.lightMode); });
// Interruptor de tema del hub: mismo ajuste que el del menú, con la bolita deslizante
document.getElementById('hub-theme').addEventListener('click', async () => {
  settings = await window.cobalt.setSettings({ lightMode: !settings.lightMode });
  els.optLight.checked = !!settings.lightMode;
  applyTheme(settings.lightMode);
});
els.optGpu.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ hardwareAcceleration: els.optGpu.checked }); window.cobalt.restart(); });
els.optAgent.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ agentMode: els.optAgent.checked }); window.cobalt.restart(); });
async function showAbout() { $('#about-version').textContent = 'v' + (await window.cobalt.version()); const gpu = await window.cobalt.gpuStatus(); const sec = await window.cobalt.secStatus(); $('#about-gpu').innerHTML = `Aceleración por GPU: <b>${settings.hardwareAcceleration ? 'activada' : 'desactivada'}</b><br>Canvas 2D: ${gpu['2d_canvas'] || '—'} · WebGL: ${gpu.webgl || '—'}<br>Sandbox por proceso: <b>${sec.sandbox ? 'activo' : 'no'}</b> · Aislamiento de sitios: <b>${sec.siteIsolation ? 'activo' : 'no'}</b> · HTTPS por defecto: <b>${sec.httpsUpgrades ? 'activo' : 'no'}</b><br>Modo agente (CDP): <b>${settings.agentMode ? 'activo en 127.0.0.1:9223' : 'desactivado'}</b>`; $('#about-modal').classList.remove('hidden'); }
$('#about-close').addEventListener('click', () => $('#about-modal').classList.add('hidden'));

/* ============ Contraseñas: guardar y autorrellenar en sitios ============ */
const pwPrompted = new Set(); // evita volver a preguntar por la misma cuenta en la sesión
function hidePwBar() { els.pwBar.classList.add('hidden'); }
function showPwBar(html, yesLabel, onYes) {
  els.pwText.innerHTML = html;
  els.pwYes.textContent = yesLabel;
  els.pwYes.onclick = () => { hidePwBar(); onYes(); };
  els.pwNo.onclick = hidePwBar;
  els.pwBar.classList.remove('hidden');
}
// Indicador de Modo agente: ÁMBAR = activo (puerto CDP abierto, sin agente conectado);
// VERDE = un agente está conectado/actuando. El agente declara presencia llamando a
// window.navirisAgentPing() (heartbeat) o controlando alguna pestaña. Si el heartbeat
// deja de llegar (~15s), vuelve a ámbar sin necesidad de un intervalo perpetuo.
let agentLastPing = 0, agentPingTimeout = null;
window.navirisAgentPing = function () {
  agentLastPing = Date.now(); refreshAgentBadge();
  clearTimeout(agentPingTimeout); agentPingTimeout = setTimeout(refreshAgentBadge, 15500);
};
function refreshAgentBadge() {
  const b = document.getElementById('agent-badge'); if (!b) return;
  if (!settings.agentMode) { b.classList.add('hidden'); b.classList.remove('connected'); return; }
  b.classList.remove('hidden');
  const connected = (Date.now() - agentLastPing < 15000) || tabs.some((t) => t.agentControlled);
  b.classList.toggle('connected', connected);
}
// Webview OCULTO que reclama los drops pendientes SIN tocar la pestaña que farmea:
// carga /drops/inventory (misma sesión, PARTITION compartida), pulsa el botón real de
// Twitch (que sí viaja con Client-Integrity) y se autodestruye. El farmeo no se corta.
let dropClaimer = null;
function ensureDropClaimer(sourceTab) {
  if (dropClaimer) return; // ya hay uno trabajando
  const wv = document.createElement('webview');
  wv.setAttribute('partition', PARTITION);
  wv.setAttribute('allowpopups', '');
  wv.classList.add('agent-hidden'); // renderizado pero fuera de pantalla: invisible al usuario
  wv.src = 'https://www.twitch.tv/drops/inventory';
  const cleanup = () => {
    if (!dropClaimer) return;
    try { clearTimeout(dropClaimer.timer); } catch { /* nada */ }
    try { wv.remove(); } catch { /* nada */ }
    dropClaimer = null;
  };
  wv.addEventListener('dom-ready', () => { try { wv.send('cobalt-claim-inventory'); } catch { /* nada */ } });
  wv.addEventListener('ipc-message', (ev) => {
    if (ev.channel !== 'cobalt-twitch') return;
    const d = (ev.args && ev.args[0]) || {};
    if (d.type === 'claim' && d.kind === 'drop') {
      if (sourceTab) { sourceTab.twitchClaims = (sourceTab.twitchClaims || 0) + 1; renderTabs(); }
      recordLoot('drop', (sourceTab && sourceTab.url && sourceTab.url.split('twitch.tv/')[1] ? 'twitch.tv/' + sourceTab.url.split('twitch.tv/')[1].split(/[/?#]/)[0] : 'twitch.tv/drops'), { name: d.name });
      toast(d.name ? ('Drop reclamado: ' + d.name) : 'Drop de Twitch reclamado');
    } else if (d.type === 'claim-done') {
      cleanup();
    }
  });
  els.content.appendChild(wv);
  dropClaimer = { wv, timer: setTimeout(cleanup, 45000) }; // salvavidas si algo falla
}
async function onWebviewMessage(wv, e) {
  const data = (e.args && e.args[0]) || {};
  // Botones 4/5 del ratón pulsados DENTRO de la página
  if (e.channel === 'cobalt-mouse-nav') {
    const dir = (e.args && e.args[0]) || '';
    if (dir === 'back') irAtras(); else if (dir === 'forward') irAdelante();
    return;
  }
  // Un agente (CDP) marcó/desmarcó esta pestaña: pinta el distintivo. Vale para cualquier pestaña.
  if (e.channel === 'cobalt-agent') {
    const tab = tabs.find((t) => t.webview === wv); if (!tab) return;
    tab.agentControlled = !!data.on;
    try { wv.classList.toggle('agent-controlled', !!data.on); } catch { /* nada */ }
    renderTabs(); refreshAgentBadge();
    return;
  }
  // Twitch: se atiende aunque la pestaña esté en segundo plano (ahí es donde se deja el stream)
  if (e.channel === 'cobalt-twitch') {
    const tab = tabs.find((t) => t.webview === wv); if (!tab) return;
    const seg = tab.url.split('twitch.tv/')[1];
    const channel = hostOf(tab.url).replace(/^www\./, '') + (seg ? '/' + seg.split(/[/?#]/)[0] : '');
    // Hay drops ganados sin reclamar: abre el webview oculto que los reclama sin cortar el farmeo.
    if (data.type === 'drops-pending') { ensureDropClaimer(tab); return; }
    if (data.type === 'claim') {
      tab.twitchClaims = data.count || ((tab.twitchClaims || 0) + 1); renderTabs();
      recordLoot(data.kind, channel, { name: data.name, balance: data.balance });
      toast(data.kind === 'drop' ? 'Drop de Twitch reclamado' : `Punto de Twitch reclamado (${tab.twitchClaims})`);
    }
    return;
  }
  if (activeTab()?.webview !== wv) return; // el resto (contraseñas) solo en la pestaña activa
  if (e.channel === 'cobalt-capture') {
    if (IS_PRIVATE) return; // en ventana privada no se guardan contraseñas
    const { url, username, password } = data;
    if (!password) return;
    const host = hostOf(url); if (!host) return;
    const key = host + '|' + (username || '');
    if (pwPrompted.has(key)) return;
    pwPrompted.add(key);
    const existing = (await window.cobalt.pwForHost(host)).find((c) => (c.username || '') === (username || ''));
    const who = username ? `<b>${escapeHtml(username)}</b> en <b>${escapeHtml(host)}</b>` : `<b>${escapeHtml(host)}</b>`;
    if (existing) showPwBar(`¿Actualizar la contraseña de ${who}?`, 'Actualizar', () => doSavePw(host, username, password));
    else showPwBar(`¿Guardar la contraseña de ${who} en Naviris?`, 'Guardar', () => doSavePw(host, username, password));
  } else if (e.channel === 'cobalt-loginform') {
    const host = hostOf(data.url); if (!host) return;
    const creds = await window.cobalt.pwForHost(host);
    if (!creds.length) return;
    const cred = creds[0];
    const who = cred.username ? `<b>${escapeHtml(cred.username)}</b>` : 'la cuenta guardada';
    showPwBar(`Rellenar ${who} en <b>${escapeHtml(host)}</b> — te pedirá verificación de Windows.`, 'Rellenar', () => doFillPw(wv, cred));
  } else if (e.channel === 'cobalt-cardform') {
    // Formulario de pago detectado: ofrecer la tarjeta guardada (CVC no; lo teclea el usuario)
    if (IS_PRIVATE) return;
    const host = hostOf(data.url); if (!host) return;
    const cards = await window.cobalt.cardsList();
    if (!cards.length) return;
    const card = cards[0];
    showPwBar(`Rellenar la tarjeta <b>${escapeHtml(card.brand)} •••• ${escapeHtml(card.last4)}</b> en <b>${escapeHtml(host)}</b> — te pedirá verificación de Windows. El CVC lo escribes tú.`, 'Rellenar', () => doFillCard(wv, card));
  }
}
async function doFillCard(wv, card) {
  const r = await window.cobalt.cardsFill(card.id);
  if (r.ok) { try { wv.send('cobalt-fill-card', r); toast('Tarjeta rellenada (falta el CVC)'); } catch { toast('No se pudo rellenar'); } }
  else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo rellenar');
}
async function doSavePw(host, username, password) {
  const r = await window.cobalt.pwAdd(host, username || '', password);
  toast(r && r.ok ? (r.updated ? 'Contraseña actualizada' : 'Contraseña guardada en Naviris') : 'No se pudo guardar');
}
async function doFillPw(wv, cred) {
  const r = await window.cobalt.pwReveal(cred.id);
  if (r.ok) { try { wv.send('cobalt-fill', { username: cred.username, password: r.password }); toast('Contraseña rellenada'); } catch { toast('No se pudo rellenar'); } }
  else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo rellenar');
}

/* ============ Permisos de sitios ============ */
const PERM_LABELS = { media: 'usar la cámara y el micrófono', geolocation: 'saber tu ubicación', notifications: 'enviarte notificaciones', midi: 'usar dispositivos MIDI', midiSysex: 'usar dispositivos MIDI', 'clipboard-read': 'leer tu portapapeles', hid: 'acceder a dispositivos HID', serial: 'acceder a puertos serie', usb: 'acceder a dispositivos USB', bluetooth: 'usar Bluetooth' };
const PERM_SHORT = { media: 'Cámara y micrófono', geolocation: 'Ubicación', notifications: 'Notificaciones', midi: 'MIDI', midiSysex: 'MIDI', 'clipboard-read': 'Portapapeles', hid: 'Dispositivos HID', serial: 'Puertos serie', usb: 'USB', bluetooth: 'Bluetooth' };
let permQueue = [];
function showNextPerm() {
  if (!permQueue.length) { els.permBar.classList.add('hidden'); return; }
  const req = permQueue[0];
  let what = PERM_LABELS[req.permission] || ('usar ' + req.permission);
  if (req.permission === 'media' && req.mediaTypes && req.mediaTypes.length) {
    const m = req.mediaTypes;
    what = m.includes('video') && m.includes('audio') ? 'usar la cámara y el micrófono' : m.includes('video') ? 'usar la cámara' : 'usar el micrófono';
  }
  let host = req.origin; try { host = new URL(req.origin).hostname.replace(/^www\./, ''); } catch {}
  els.permText.innerHTML = `<b>${escapeHtml(host)}</b> quiere ${escapeHtml(what)}.`;
  els.permRemember.checked = true;
  els.permBar.classList.remove('hidden');
}
function answerPerm(decision) {
  const req = permQueue.shift(); if (!req) return;
  window.cobalt.permRespond(req.id, decision, els.permRemember.checked);
  showNextPerm();
}
window.cobalt.onPermAsk((req) => { permQueue.push(req); if (permQueue.length === 1) showNextPerm(); });
els.permAllow.addEventListener('click', () => answerPerm('allow'));
els.permBlock.addEventListener('click', () => answerPerm('block'));

async function showPermManager() {
  const perms = await window.cobalt.permList();
  els.permList.innerHTML = '';
  const keys = Object.keys(perms);
  for (const key of keys) {
    const [origin, type] = key.split('|');
    let host = origin; try { host = new URL(origin).hostname.replace(/^www\./, ''); } catch {}
    const row = document.createElement('div'); row.className = 'perm-row';
    const info = document.createElement('div'); info.className = 'pr-info';
    info.innerHTML = `<div class="pr-site">${escapeHtml(host)}</div><div class="pr-perm">${escapeHtml(PERM_SHORT[type] || type)}</div>`;
    const state = document.createElement('span'); state.className = 'pr-state ' + (perms[key] === 'allow' ? 'allow' : 'block'); state.textContent = perms[key] === 'allow' ? 'Permitido' : 'Bloqueado';
    const x = document.createElement('button'); x.className = 'pr-x'; x.title = 'Revocar'; x.innerHTML = window.icon('trash');
    x.addEventListener('click', async () => { await window.cobalt.permRemove(key); showPermManager(); });
    row.append(info, state, x); els.permList.appendChild(row);
  }
  els.permModal.classList.remove('hidden');
}
els.permModalClose.addEventListener('click', () => els.permModal.classList.add('hidden'));
els.permClearAll.addEventListener('click', async () => { await window.cobalt.permClear(); showPermManager(); toast('Permisos borrados'); });

/* ===== Addons (catálogo remoto: naviris.site/addons) ===== */
const adEls = {
  page: document.getElementById('addons-page'),
  list: document.getElementById('addons-list'),
  refresh: document.getElementById('addons-refresh'),
  hubBtn: document.getElementById('hub-addons'),
  tools: document.getElementById('addon-tools')
};
function showAddonsPage() {
  tabs.forEach((t) => t.webview?.classList.remove('active'));
  els.hub.classList.remove('active'); hideBookmarkPage(); hideDownloadsPage();
  adEls.page.classList.remove('hidden'); adEls.page.classList.add('active');
  renderAddons();
}
function hideAddonsPage() { adEls.page.classList.remove('active'); adEls.page.classList.add('hidden'); }
adEls.hubBtn.addEventListener('click', showAddonsPage);
adEls.refresh.addEventListener('click', renderAddons);

async function renderAddons() {
  adEls.list.innerHTML = '<div class="adp-loading">Cargando catálogo…</div>';
  const [cat, installed] = await Promise.all([window.cobalt.addonsCatalog(), window.cobalt.addonsList()]);
  const remote = cat.ok ? cat.addons : [];
  const byId = new Map(remote.map((a) => [a.id, a]));
  for (const id of Object.keys(installed)) if (!byId.has(id)) byId.set(id, installed[id]);
  adEls.list.innerHTML = '';
  if (!byId.size) {
    adEls.list.innerHTML = '<div class="adp-error">' + (cat.ok ? 'El catálogo está vacío por ahora.' : 'No se pudo cargar el catálogo (' + (cat.message || 'sin conexión') + ').') + '</div>';
    return;
  }
  for (const meta of byId.values()) {
    const inst = installed[meta.id];
    const inCatalog = remote.some((a) => a.id === meta.id);
    const card = document.createElement('div'); card.className = 'adp-card';
    const top = document.createElement('div'); top.className = 'adp-top';
    top.innerHTML = '<span class="adp-ico">' + window.icon(meta.icon || 'puzzle-piece') + '</span>';
    const tt = document.createElement('div');
    tt.innerHTML = '<h3></h3><span class="adp-ver"></span>';
    tt.querySelector('h3').textContent = meta.name || meta.id;
    // Si lo tienes instalado en otra versión, se ve de un vistazo cuál corre
    // ahora mismo y cuál hay disponible (antes solo salía la del catálogo).
    const vTxt = inst && meta.version && inst.version !== meta.version
      ? 'v' + inst.version + ' instalada · v' + meta.version + ' disponible'
      : 'v' + ((inst && inst.version) || meta.version || '?');
    tt.querySelector('.adp-ver').textContent = vTxt + (meta.kind === 'tool' ? ' · herramienta' : ' · para sitios');
    top.appendChild(tt);
    const badge = document.createElement('span'); badge.className = 'adp-badge' + (inst?.enabled ? ' on' : '');
    badge.textContent = inst ? (inst.enabled ? 'ACTIVO' : 'PAUSADO') : 'DISPONIBLE';
    badge.style.marginLeft = 'auto';
    top.appendChild(badge);
    const desc = document.createElement('p'); desc.textContent = meta.description || '';
    const acts = document.createElement('div'); acts.className = 'adp-actions';
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'adp-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', fn); acts.appendChild(b); return b; };
    if (!inst) {
      btn('Instalar', 'primary', async (ev) => {
        ev.target.textContent = 'Instalando…'; ev.target.disabled = true;
        const r = await window.cobalt.addonsInstall(meta);
        toast(r.ok ? 'Addon instalado: ' + meta.name + (meta.kind === 'tool' ? '' : ' (activo al recargar los sitios)') : 'Error: ' + r.message);
        if (r.ok) loadToolAddons();
        renderAddons();
      });
    } else {
      if (inCatalog && meta.version && inst.version !== meta.version) {
        btn('Actualizar a v' + meta.version, 'primary', async (ev) => {
          ev.target.textContent = 'Actualizando…'; ev.target.disabled = true;
          const r = await window.cobalt.addonsInstall(meta);
          if (!r.ok) { toast('Error: ' + r.message); renderAddons(); return; }
          // Descargar el código nuevo NO basta: la herramienta vieja sigue
          // corriendo en memoria (su botón, sus temporizadores). Se retira y se
          // vuelve a cargar para que el usuario vea la versión nueva YA, sin
          // reiniciar; antes había que reiniciar y nadie lo sabía.
          if (meta.kind === 'tool') {
            try { naviris.unregisterTool(meta.id); } catch { /* nada */ }
            loadedTools.delete(meta.id);
            await new Promise((res) => setTimeout(res, 2600)); // el addon se auto-limpia al ver su botón fuera
            await loadToolAddons();
            toast('Actualizado a v' + meta.version + ' y recargado');
          } else {
            toast('Actualizado a v' + meta.version + ' · recarga la página para aplicarlo');
          }
          renderAddons();
        });
      }
      btn(inst.enabled ? 'Pausar' : 'Activar', '', async () => {
        await window.cobalt.addonsToggle(meta.id, !inst.enabled);
        if (inst.kind === 'tool') loadToolAddons();
        renderAddons();
      });
      btn('Quitar', 'danger', async () => {
        await window.cobalt.addonsUninstall(meta.id);
        naviris.unregisterTool(meta.id); loadedTools.delete(meta.id);
        toast('Addon eliminado'); renderAddons();
      });
    }
    card.append(top, desc, acts);
    adEls.list.appendChild(card);
  }
}

// API mínima que Naviris ofrece a los addons de tipo herramienta.
// Los addons viven en naviris.site: se actualizan sin publicar una release.
// Limpiadores que registran los addons de tipo herramienta (ver registerTool).
const toolUnloaders = new Map();
const naviris = {
  toast,
  activeWebview: () => { const t = activeTab(); return t && t.kind === 'web' && !t.asleep ? t.webview : null; },
  // TODAS las webviews vivas, no solo la de la pestaña activa. La necesitan los
  // addons que deben actuar sobre pestañas en segundo plano (Blockify tiene que
  // armar una pestaña de Spotify aunque el usuario esté mirando otra cosa); con
  // solo activeWebview esas pestañas no se tocaban hasta ponerlas en primer plano.
  allWebviews: () => tabs.filter((t) => t.kind === 'web' && !t.asleep && t.webview).map((t) => t.webview),
  savePng: (dataUrl, name) => window.cobalt.savePng(dataUrl, name),
  // onUnload: se invoca al retirar la herramienta (desinstalar o actualizar en
  // caliente) para que el addon suelte sus listeners. Sin esto, actualizar dejaba
  // vivos los listeners de la instancia vieja colgando de cada <webview> y acababa
  // habiendo dos manejadores peleándose por el mismo estado.
  registerTool({ id, label, icon, onClick, onUnload }) {
    if (document.getElementById('adt-' + id)) return;
    const b = document.createElement('button');
    b.id = 'adt-' + id; b.className = 'sb-btn'; b.title = label; b.innerHTML = window.icon(icon || 'puzzle-piece');
    b.addEventListener('click', () => onClick(b));
    adEls.tools.appendChild(b);
    if (typeof onUnload === 'function') toolUnloaders.set(id, onUnload);
  },
  unregisterTool(id) {
    const fin = toolUnloaders.get(id);
    if (fin) { toolUnloaders.delete(id); try { fin(); } catch { /* que un addon falle al soltar no impide retirarlo */ } }
    document.getElementById('adt-' + id)?.remove();
  },
  // Sensibilidad de X: única puerta de los addons hacia ese ajuste (lo usa el
  // addon "Sensibilidad X"; el resto de settings no se expone a addons).
  xSensitive: {
    get: () => !!settings.xRevealSensitive,
    set: async (v) => {
      settings = await window.cobalt.setSettings({ xRevealSensitive: !!v });
      els.ratXcheck.checked = !!v;
      const tab = activeTab();
      if (tab?.kind === 'web' && /(^|\.)(x\.com|twitter\.com)$/.test(hostOf(tab.url))) tab.webview.reload();
      return !!settings.xRevealSensitive;
    }
  }
};

const loadedTools = new Set();
// Los addons se cargan como <script> desde el esquema naviris-addon:, NO con
// new Function: la CSP de esta interfaz no permite 'unsafe-eval' (a propósito,
// ver SEGURIDAD.md) y con new Function ningún addon llegaba a arrancar. El
// addon ve `naviris` porque este const vive en el ámbito global del documento.
// El parámetro v evita que se reutilice el código viejo tras una actualización.
let addonSeq = 0;
function ejecutarAddon(id) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.dataset.addon = id;
    s.src = `naviris-addon://tool/${encodeURIComponent(id)}.js?v=${++addonSeq}`;
    s.onload = () => resolve(true);
    s.onerror = () => { console.error('Addon roto (no carga):', id); s.remove(); resolve(false); };
    document.head.appendChild(s);
  });
}
async function loadToolAddons() {
  const installed = await window.cobalt.addonsList();
  // Migración: addons retirados del producto. AutoLoot pasó al core; Twitch Kit
  // y Valve Rat Tool se descatalogaron (2026-07-29). Si alguien los tiene
  // instalados, se desinstalan solos para que no quede código muerto sin
  // actualizaciones.
  for (const retirado of ['autoloot', 'twitch-kit', 'steam-inventory-helper']) {
    if (installed[retirado]) { try { await window.cobalt.addonsUninstall(retirado); naviris.unregisterTool(retirado); delete installed[retirado]; } catch { /* nada */ } }
  }
  // Migración 2.7.3: la sensibilidad de X salió de Ajustes y ahora es el addon
  // "Sensibilidad X". Quien la tenía activa recibe el addon solo, para no
  // quedarse sin interruptor (si el catálogo no responde, se reintenta al
  // próximo arranque; el ajuste no se toca).
  if (settings.xRevealSensitive && !installed['x-sensitive']) {
    try {
      const cat = await window.cobalt.addonsCatalog();
      const meta = cat.ok && cat.addons.find((a) => a.id === 'x-sensitive');
      if (meta) { const r = await window.cobalt.addonsInstall(meta); if (r.ok) installed[meta.id] = { ...meta, enabled: true }; }
    } catch { /* nada */ }
  }
  for (const [id, meta] of Object.entries(installed)) {
    if (meta.kind !== 'tool' || !meta.enabled || loadedTools.has(id)) continue;
    if (await ejecutarAddon(id)) loadedTools.add(id);
  }
  for (const id of [...loadedTools]) {
    if (!installed[id] || !installed[id].enabled) {
      naviris.unregisterTool(id); loadedTools.delete(id);
      document.querySelector(`script[data-addon="${id}"]`)?.remove();
    }
  }
}
loadToolAddons();

/* Actualización: dos líneas oficiales (Naviris estable y NavirisDev), ambas
   visibles al buscar; el usuario instala la que quiera desde cualquier versión */
const updStatus = $('#upd-status'), updBtn = $('#upd-btn'), updBar = $('#upd-bar'), updLines = $('#upd-lines');
let updChosen = null;     // línea elegida ('stable'|'dev') mientras descarga
let updReadyLine = null;  // línea ya descargada, lista para instalar
let updBusy = false;
const UPD_LABEL = { stable: 'Naviris', dev: 'NavirisDev' };
function setUpd(text, cls) { updStatus.textContent = text; updStatus.className = cls || ''; }
function updLineEls(line) { return { ver: $('#upd-' + line + '-ver'), btn: $('#upd-' + line + '-btn') }; }
async function showChannels() {
  setUpd('Consultando versiones…'); updBtn.disabled = true;
  const r = await window.cobalt.updateChannels();
  updBtn.disabled = false;
  if (!r.ok) { setUpd('Error: ' + r.message, 'err'); return; }
  for (const line of ['stable', 'dev']) {
    const info = r[line], { ver, btn } = updLineEls(line);
    if (!info) { ver.textContent = 'no publicada'; btn.classList.add('hidden'); continue; }
    ver.textContent = 'v' + info.version; btn.classList.remove('hidden');
    if (updReadyLine === line) { btn.textContent = 'Reiniciar e instalar'; btn.disabled = false; }
    else if (info.version === r.current) { btn.textContent = 'Instalada'; btn.disabled = true; }
    else { btn.textContent = 'Instalar'; btn.disabled = updBusy; }
  }
  updLines.classList.remove('hidden');
  if (!updBusy && !updReadyLine) setUpd('Estás en la v' + r.current + '. Elige la versión que quieras usar.');
}
async function chooseLine(line) {
  if (updReadyLine === line) { window.cobalt.updateInstall(); return; }
  if (updBusy || updReadyLine) return;
  updBusy = true; updChosen = line;
  updLineEls('stable').btn.disabled = true; updLineEls('dev').btn.disabled = true;
  const r = await window.cobalt.updateChoose(line);
  if (r.state === 'dev') { setUpd('Las actualizaciones solo funcionan en la versión instalada.'); updBusy = false; updChosen = null; showChannels(); }
  else if (r.state === 'error') { setUpd('Error: ' + r.message, 'err'); updBusy = false; updChosen = null; showChannels(); }
}
updBtn.addEventListener('click', showChannels);
$('#upd-stable-btn').addEventListener('click', () => chooseLine('stable'));
$('#upd-dev-btn').addEventListener('click', () => chooseLine('dev'));
window.cobalt.onUpdateStatus((s) => {
  if (s.state === 'available') {
    // Solo se descarga si el usuario eligió línea; el aviso silencioso de arranque solo notifica
    if (!updChosen) { if ($('#about-modal').classList.contains('hidden')) toast('Nueva versión de Naviris disponible (menú → Acerca de)'); return; }
    setUpd('Descargando ' + UPD_LABEL[updChosen] + ' v' + s.version + '…'); updBar.classList.remove('hidden');
    window.cobalt.updateDownload();
  } else if (s.state === 'latest') {
    if (updChosen) { setUpd('Ya estás en la última versión de ' + UPD_LABEL[updChosen] + '.'); updBusy = false; updChosen = null; showChannels(); }
  } else if (s.state === 'downloading') {
    if (updChosen) { setUpd('Descargando ' + UPD_LABEL[updChosen] + '… ' + s.percent + '%'); updBar.classList.remove('hidden'); updBar.querySelector('i').style.width = s.percent + '%'; }
  } else if (s.state === 'downloaded') {
    if (!updChosen) return;
    updReadyLine = updChosen; updChosen = null; updBusy = false;
    updBar.classList.add('hidden');
    setUpd(UPD_LABEL[updReadyLine] + ' v' + s.version + ' lista para instalar.', 'hot');
    const { btn } = updLineEls(updReadyLine); btn.textContent = 'Reiniciar e instalar'; btn.disabled = false;
  } else if (s.state === 'error') {
    if (updChosen || updBusy) { setUpd('Error al actualizar: ' + s.message, 'err'); updBusy = false; updChosen = null; }
  }
});

/* Ventana */
$('#win-min').addEventListener('click', () => window.cobalt.minimize());
$('#win-max').addEventListener('click', () => window.cobalt.maximize());
$('#win-close').addEventListener('click', () => window.cobalt.close());
// El botón conserva SIEMPRE el icono de maximizar elegido por el usuario
// (antes al maximizar se cambiaba por otro y parecía que "desaparecía");
// solo cambia el tooltip según el estado.
window.cobalt.onMaximized((max) => { $('#win-max').title = max ? 'Restaurar' : 'Maximizar'; });

/* ============ Atajos de teclado y ratón ============ */
// Juego estándar de navegador (Chrome/Firefox/Edge). Los webviews reciben las
// teclas por su cuenta, así que estos van en la ventana y actúan sobre la
// pestaña activa.
function activeWv() { const t = activeTab(); return t?.kind === 'web' ? t.webview : null; }
function recargar(forzado) {
  const wv = activeWv(); if (!wv) return;
  try { forzado ? wv.reloadIgnoringCache() : wv.reload(); } catch { /* nada */ }
}
function irAtras() { const wv = activeWv(); try { if (wv?.canGoBack()) wv.goBack(); } catch { /* nada */ } }
function irAdelante() { const wv = activeWv(); try { if (wv?.canGoForward()) wv.goForward(); } catch { /* nada */ } }
function pararCarga() { const wv = activeWv(); try { wv?.stop(); } catch { /* nada */ } }
// Zoom por pestaña (como los navegadores: se recuerda mientras viva la pestaña)
function zoom(delta) {
  const tab = activeTab(); const wv = activeWv(); if (!wv || !tab) return;
  const nivel = delta === 0 ? 0 : Math.max(-5, Math.min(5, (tab.zoom || 0) + delta));
  tab.zoom = nivel;
  try { wv.setZoomLevel(nivel); } catch { /* nada */ }
  toast(nivel === 0 ? 'Zoom al 100 %' : 'Zoom ' + Math.round(Math.pow(1.2, nivel) * 100) + ' %');
}
function recordarCerrada(tab) {
  if (!tab || tab.kind !== 'web' || !tab.url) return;
  cerradas.push({ url: tab.url, title: tab.title });
  if (cerradas.length > 10) cerradas.shift();
}
function reabrirCerrada() {
  const t = cerradas.pop(); if (!t) { toast('No hay pestañas cerradas recientes'); return; }
  createTab(t.url);
}
// F12: consola de desarrollador de la página activa (abre/cierra, como Chrome)
function alternarDevtools() {
  const wv = activeWv(); if (!wv) { toast('Abre una página para inspeccionarla'); return; }
  try { wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools(); } catch { /* nada */ }
}
window.addEventListener('keydown', (e) => {
  const k = (e.key || '').toLowerCase();
  const soloCtrl = e.ctrlKey && !e.shiftKey && !e.altKey;
  const escribiendo = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  // Con los atajos desactivados siguen vivos solo los de ventana (F11, F12) y
  // Escape: quedarse en pantalla completa sin forma de salir sería una trampa.
  if (settings.atajos === false && !/^(F11|F12|Escape)$/.test(e.key)) return;

  // --- Pestañas ---
  if (e.ctrlKey && e.shiftKey && k === 'n') { e.preventDefault(); window.cobalt.newPrivateWindow(); return; }
  if (e.ctrlKey && e.shiftKey && k === 't') { e.preventDefault(); reabrirCerrada(); return; }
  if (soloCtrl && k === 't') { e.preventDefault(); createTab(); return; }
  // Ctrl+W respeta las fijadas (como Chrome): se sueltan o cierran desde su menú
  if (soloCtrl && k === 'w') { e.preventDefault(); const t = activeTab(); if (t && !t.pinned) closeTab(t.id); return; }
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const i = tabs.findIndex((t) => t.id === activeId); const n = tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]; if (n) activateTab(n.id); return; }
  if (e.ctrlKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
    e.preventDefault(); const i = tabs.findIndex((t) => t.id === activeId);
    const n = tabs[(i + (e.key === 'PageDown' ? 1 : tabs.length - 1)) % tabs.length]; if (n) activateTab(n.id); return;
  }
  // Ctrl+1..8 va a esa pestaña; Ctrl+9 a la última (igual que Chrome)
  if (soloCtrl && /^[1-9]$/.test(k)) {
    e.preventDefault();
    const n = k === '9' ? tabs[tabs.length - 1] : tabs[parseInt(k, 10) - 1];
    if (n) activateTab(n.id);
    return;
  }

  // --- Navegación ---
  if (e.key === 'F5' || (soloCtrl && k === 'r')) { e.preventDefault(); recargar(e.shiftKey); return; }
  if ((e.ctrlKey && e.shiftKey && k === 'r') || (e.shiftKey && e.key === 'F5')) { e.preventDefault(); recargar(true); return; }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); irAtras(); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); irAdelante(); return; }
  if (e.altKey && e.key === 'Home') { e.preventDefault(); els.sbHome.click(); return; }
  if (e.key === 'Escape' && !escribiendo) { pararCarga(); return; }

  // --- Barra de direcciones ---
  if ((soloCtrl && k === 'l') || e.key === 'F6' || (e.altKey && k === 'd')) { e.preventDefault(); els.urlbar.focus(); els.urlbar.select(); return; }

  // --- Ventana y página ---
  if (e.altKey && !e.ctrlKey && k === 'p') { e.preventDefault(); miniReproductor(); return; }
  if (e.key === 'F12') { e.preventDefault(); alternarDevtools(); return; }
  if (e.key === 'F11') { e.preventDefault(); window.cobalt.toggleFullscreen(); return; }
  if (soloCtrl && (k === '+' || k === '=' || e.key === 'Add')) { e.preventDefault(); zoom(1); return; }
  if (soloCtrl && (k === '-' || e.key === 'Subtract')) { e.preventDefault(); zoom(-1); return; }
  if (soloCtrl && k === '0') { e.preventDefault(); zoom(0); return; }
  if (soloCtrl && k === 'p') { e.preventDefault(); try { activeWv()?.print(); } catch { /* nada */ } return; }
  if (soloCtrl && k === 'd') { e.preventDefault(); els.navStar.click(); return; }

  // --- Paneles ---
  if (soloCtrl && k === 'j') { e.preventDefault(); toggleDownloads(); return; }
  if (soloCtrl && k === 'h') { e.preventDefault(); toggleHistory(); return; }
});
// Los mismos atajos, pero llegados desde una página con el foco dentro (el main
// los intercepta con before-input-event y los reenvía por IPC).
/* Minireproductor (picture-in-picture). Coge el vídeo que se ve más grande y lo
   saca a la ventanita del sistema, que queda por encima de cualquier otra app;
   volver a pulsarlo lo devuelve. El segundo argumento de executeJavaScript es
   el gesto de usuario: sin él Chromium rechaza la llamada.
   Funciona en cualquier web con un <video>, incluidas Netflix o Disney+, salvo
   que la propia web lo desactive con disablePictureInPicture.
   El botón visible vive en el addon "Minireproductor" del catálogo (2.7.3-dev.16);
   en el core quedan la fontanería, el atajo Alt+P y el menú contextual del video. */
const PIP_JS = `(() => {
  const v = Array.from(document.querySelectorAll('video'))
    .filter((x) => x.readyState !== 0 && !x.disablePictureInPicture)
    .sort((a, b) => {
      const ra = a.getClientRects()[0] || { width: 0, height: 0 };
      const rb = b.getClientRects()[0] || { width: 0, height: 0 };
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
  if (document.pictureInPictureElement) { document.exitPictureInPicture(); return 'salido'; }
  if (!v) return 'sin-video';
  return v.requestPictureInPicture().then(() => 'ok').catch((e) => 'error:' + e.message);
})()`;
async function miniReproductor() {
  const tab = activeTab();
  const wv = tab && tab.kind === 'web' && !tab.asleep ? tab.webview : null;
  if (!wv) { toast('Abre primero una página con video'); return; }
  try {
    const r = await wv.executeJavaScript(PIP_JS, true);
    if (r === 'sin-video') toast('No hay ningún video en esta página');
    else if (String(r).startsWith('error:')) toast('Esta página no deja usar el minireproductor');
    else if (r === 'ok') toast('Video en el minireproductor');
  } catch { toast('No se pudo abrir el minireproductor'); }
}

window.cobalt.onShortcut((cmd) => {
  const i = tabs.findIndex((t) => t.id === activeId);
  if (cmd === 'reload') recargar(false);
  else if (cmd === 'reload-hard') recargar(true);
  else if (cmd === 'back') irAtras();
  else if (cmd === 'forward') irAdelante();
  else if (cmd === 'new-tab') createTab();
  else if (cmd === 'close-tab') { if (activeId) closeTab(activeId); }
  else if (cmd === 'reopen-tab') reabrirCerrada();
  else if (cmd === 'focus-url') { els.urlbar.focus(); els.urlbar.select(); }
  else if (cmd === 'pip') miniReproductor();
  else if (cmd === 'downloads') toggleDownloadsPage();
  else if (cmd === 'history') toggleHistory();
  else if (cmd === 'bookmark') els.navStar.click();
  else if (cmd === 'fullscreen') window.cobalt.toggleFullscreen();
  else if (cmd === 'zoom-in') zoom(1);
  else if (cmd === 'zoom-out') zoom(-1);
  else if (cmd === 'zoom-reset') zoom(0);
  else if (cmd === 'devtools') alternarDevtools();
  else if (cmd === 'next-tab') { const n = tabs[(i + 1) % tabs.length]; if (n) activateTab(n.id); }
  else if (cmd === 'prev-tab') { const n = tabs[(i + tabs.length - 1) % tabs.length]; if (n) activateTab(n.id); }
  else if (cmd.startsWith('tab-')) {
    const d = cmd.slice(4);
    const n = d === '9' ? tabs[tabs.length - 1] : tabs[parseInt(d, 10) - 1];
    if (n) activateTab(n.id);
  }
});
// Botones 4 y 5 del ratón: atrás y adelante (el estándar de Windows). Los manda
// el propio Chromium como 'mouseup' con button 3/4; también llegan del webview.
window.addEventListener('mouseup', (e) => {
  if (settings.mouseNav === false) return;
  if (e.button === 3) { e.preventDefault(); irAtras(); }
  else if (e.button === 4) { e.preventDefault(); irAdelante(); }
});
window.addEventListener('auxclick', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
// Clic derecho en la ZONA VACÍA de la barra de pestañas (región de arrastre de
// la ventana): a la página no le llega — el main lo intercepta con
// 'system-context-menu' y manda las coordenadas. Menú de barra, como Chrome.
window.cobalt.onTabstripMenu(({ x, y }) => {
  showCtxMenu(x, y, [
    { label: 'Nueva pestaña', icon: 'plus', action: () => createTab() },
    { label: 'Reabrir última pestaña cerrada', icon: 'clock', action: reabrirCerrada },
    { sep: true },
    { label: 'Recargar todas las páginas', icon: 'arrow-path', action: () => tabs.forEach((t) => { if (t.kind === 'web' && !t.asleep) { try { t.webview?.reload(); } catch {} } }) }
  ]);
});
window.cobalt.onOpenUrl((p) => { if (typeof p === 'string') createTab(p); else createTab(p.url, !p.background); });
/* Lo que el menú contextual de la página no puede hacer desde el proceso
   principal: cosas de la interfaz (pestañas, marcadores, hub, Rat Tool). */
window.cobalt.onContextAction(({ tipo, datos }) => {
  if (tipo === 'buscar') { const u = toUrl(datos); if (u) createTab(u); return; }
  if (tipo === 'pantalla-completa') { window.cobalt.toggleFullscreen(); return; }
  if (tipo === 'pip') { miniReproductor(); return; }
  if (tipo === 'marcador') {
    if (findBookmark(datos.url)) { toast('Ya estaba en marcadores'); return; }
    bookmarks.push({ type: 'link', title: datos.titulo || datos.url, url: datos.url });
    saveBm(); renderBookmarksBar(); syncNavUI(); renderBookmarkTree();
    toast('Añadido a marcadores');
    return;
  }
  if (tipo === 'acceso') {
    els.dialName.value = datos.titulo || hostOf(datos.url) || '';
    els.dialUrl.value = datos.url || '';
    els.sbHome.click();
    els.dialModal.classList.remove('hidden');
    els.dialName.focus(); els.dialName.select();
    return;
  }
  if (tipo === 'rat') {
    // El Rat Tool prefiere la URL de la página (así reconoce YouTube, TikTok…);
    // la del propio <video> solo sirve de repuesto para archivos sueltos.
    const url = /^https?:/.test(datos.pagina || '') ? datos.pagina : (datos.src || '');
    if (!url) { toast('No he podido identificar ese vídeo'); return; }
    if (els.ratPop.classList.contains('hidden')) els.sbRat.click();
    setTimeout(() => { els.ratUrl.value = url; updateRatPlat(); els.ratQrow.classList.add('hidden'); loadRatQualities(); }, 60);
  }
});

/* Arranque */
(async function init() {
  settings = await window.cobalt.getSettings();
  els.optPowersaver.checked = settings.powerSaver; els.optGpu.checked = settings.hardwareAcceleration; els.optAgent.checked = !!settings.agentMode;
  els.optAtajos.checked = settings.atajos !== false; els.optMousenav.checked = settings.mouseNav !== false;
  // Migración 2.7.3-dev.16: el tema rosa pasó a ser claro. Quien lo eligió en
  // la versión oscura guarda lightMode=false y, sin esto, el arranque lo
  // degradaría a oscuro (y los webviews seguirían renderizando en oscuro).
  if (temaActual() === 'rosa' && !settings.lightMode) settings = await window.cobalt.setSettings({ lightMode: true });
  els.optLight.checked = !!settings.lightMode; applyTheme(settings.lightMode);
  // Modo agente activo: aviso permanente en la topbar (el puerto CDP está abierto).
  refreshAgentBadge();
  els.optSmartsearch.checked = settings.smartSearch !== false; els.optPasskeys.checked = settings.blockPasskeys !== false;
  const ab = await window.cobalt.adblockGet(); els.navShield.classList.toggle('off', !ab.enabled);
  if (IS_PRIVATE) { els.privateBadge.classList.remove('hidden'); els.privateBadge.innerHTML = window.icon('eye-slash') + '<span>Privado</span>'; }
  applyBackground(store.get('cobalt.hubBg', BACKGROUNDS[0]));
  document.documentElement.classList.toggle('color-logos', colorLogosOn());
  const optColor = document.getElementById('opt-colorlogos');
  optColor.checked = colorLogosOn();
  optColor.addEventListener('change', () => { store.set('cobalt.colorLogos', optColor.checked); applyColorLogos(); });
  window.cobalt.version().then((v) => { const el = document.getElementById('hub-version'); if (el) el.textContent = 'Naviris v' + v; });
  els.optRestore.checked = settings.restoreSession !== false;
  renderBookmarksBar(); renderHub();
  if (!IS_PRIVATE) accBootSync(); // cuenta Naviris: baja preferencias si el servidor tiene algo más nuevo
  // Restaura la sesión anterior si el ajuste está activo (por defecto sí, como Brave)
  const session = IS_PRIVATE ? [] : store.get('cobalt.session', []);
  if (settings.restoreSession !== false && Array.isArray(session) && session.length) {
    // NINGUNA se carga al arrancar: todas entran DORMIDAS y se abre el hub.
    // Cada pestaña carga solo cuando la seleccionas. Antes se cargaban todas y
    // cualquier página con vídeo se ponía a sonar sola nada más abrir Naviris.
    session.forEach((s) => { const t = crearDormida(s); if (s && s.p) t.pinned = true; });
    hubDeInicio();
    renderTabs(true);
  } else {
    createTab();
  }
  // El splash se ELIMINA del DOM tras el fundido: con visibility:hidden sus
  // animaciones infinitas seguían corriendo toda la sesión en el compositor.
  setTimeout(() => {
    els.splash.classList.add('gone');
    if (els.hub.classList.contains('active')) focusUrlbar();
    setTimeout(() => els.splash.remove(), 600);
  }, 1800);
})();


/* Naviris — renderer principal */
const $ = (s) => document.querySelector(s);
const IS_PRIVATE = new URLSearchParams(location.search).get('private') === '1';
const PARTITION = IS_PRIVATE ? 'cobalt-private' : 'persist:cobalt';

document.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = window.icon(el.dataset.ico) + el.innerHTML; });
document.querySelectorAll('[data-brand]').forEach((el) => { el.innerHTML = (window.brandIcon(el.dataset.brand) || '') + el.innerHTML; });
document.querySelectorAll('.iris-slot').forEach((el) => { el.innerHTML = window.irisLogo(+el.dataset.iris); });

const store = {
  get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); return true; } catch { return false; } }
};

const els = {};
[
  'splash', 'tabstrip', 'newtab-btn', 'nav-back', 'nav-fwd', 'nav-reload', 'urlbar',
  'nav-shield', 'nav-star', 'nav-menu', 'menu-pop', 'bookmarks-bar', 'content', 'hub', 'widget-grid',
  'hub-edit', 'hub-customize', 'widget-palette', 'palette-list', 'customize-panel', 'bg-presets',
  'dial-modal', 'dial-name', 'dial-url', 'opt-restore', 'opt-powersaver', 'opt-gpu', 'opt-light', 'opt-atajos', 'opt-mousenav',
  'opt-agent', 'opt-smartsearch', 'opt-passkeys', 'shield-pop', 'adblock-toggle', 'adblock-count', 'adblock-site', 'adblock-list',
  'media-panel', 'mp-title', 'mp-grid', 'mp-all', 'sb-home', 'sb-rat', 'sb-spotify',
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
  applyBackground(store.get(bgThemeKey(tema), null) || defaultBgTema());
  /* Y se REPINTA el hub: las fotos de los contenedores son las del tema activo
     (imagenDeTema) y se quedaban en las del tema anterior hasta que algo mas
     redibujaba. Va aqui, el paso unico por el que entra TODO cambio de tema
     (el menu Temas, el interruptor de modo claro y la cuenta), no solo en
     applyTheme — el menu llamaba directo a aplicaTema y se saltaba el repinte. */
  if (typeof renderHub === 'function' && els.hub && els.hub.classList.contains('active')) renderHub();
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
  // Si el menu es MAS ALTO que la ventana, el tope de arriba lo dejaba
  // asomando por abajo y sus ultimas opciones quedaban fuera de alcance.
  m.style.top = Math.max(6, Math.min(y, Math.max(6, window.innerHeight - r.height - 8))) + 'px';
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
const BRAND_BY_HOST = { 'youtube.com': 'youtube', 'youtu.be': 'youtube', 'twitch.tv': 'twitch', 'discord.com': 'discord', 'whatsapp.com': 'whatsapp', 'github.com': 'github', 'x.com': 'x', 'twitter.com': 'x', 'crunchyroll.com': 'crunchyroll', 'spotify.com': 'spotify', 'reddit.com': 'reddit', 'claude.ai': 'claude', 'mail.google.com': 'gmail', 'instagram.com': 'instagram', 'pinterest.com': 'pinterest', 'pinterest.es': 'pinterest' };
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
/* Pestaña de FONDO (clic con la rueda, "abrir el enlace en una pestaña nueva",
   target=_blank sin foco): NACE DORMIDA. Nada se carga hasta que entras en
   ella, así un vídeo de YouTube abierto de fondo no se pone a sonar en una
   pestaña que ni has mirado (pedido de Dosa, 2026-08-12). Reutiliza tal cual
   la mecánica de dormidas del ahorro de energía: despertar = poner el src.
   El título y el icono salen del historial si ya conocemos el sitio. */
function createTab(url = null, activate = true) {
  if (url && !activate && /^https?:/i.test(url)) {
    const conocido = history.find((h) => h.url === url);
    const tab = crearDormida({ u: url, t: (conocido && conocido.title) || '' });
    tab.sinCargar = true;   // dormida por no haberse abierto nunca, no por ahorro
    getTile(url).then((t) => { if (t?.icon) { tab.favicon = t.icon; renderTabs(); } }).catch(() => {});
    renderTabs(); saveSession(); return tab;
  }
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
  if (tab.asleep && tab.webview) { tab.webview.src = tab.sleptUrl || tab.url; tab.asleep = false; tab.sleptUrl = null; tab.sinCargar = false; }
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
    : tab.asleep ? `${tab.sinCargar ? 'Sin cargar — se abre al entrar' : 'Pestaña dormida'} — ${tab.title}\n${tab.sleptUrl || tab.url}`
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
  { name: 'Gmail', url: 'https://mail.google.com' },
  { name: 'Pinterest', url: 'https://www.pinterest.com' }, { name: 'IRIS', url: 'https://iris.it.com' }
];
let dials = store.get('cobalt.dials', DEFAULT_DIALS);
function removeDial(d) { dials = dials.filter((x) => x !== d); store.set('cobalt.dials', dials); renderHub(); }

// Logos de los dials: SIEMPRE monocromos. La opción "Logos a color" se
// eliminó del producto (decisión del usuario 2026-08-11: rompía la estética
// de vidrio y paleta única del hub).
function styleDial(tile, letter, d) {
  const brand = brandOf(d.url);
  // iris.it.com lleva SU logo oficial (nunca una inicial ni el favicon)
  try {
    if (/(^|\.)iris\.it\.com$/.test(new URL(d.url).hostname)) {
      const m = document.createElement('span'); m.className = 'd-mono d-iris';
      m.innerHTML = window.irisFlat(40); // monocromo, como el resto de marcas
      tile.appendChild(m); letter.remove(); return;
    }
  } catch { /* url rara: sigue el camino normal */ }
  // El fondo y el filtro del favicon los pone el CSS (tokens --tile-default y
  // --fav-filter): antes se fijaban aquí en línea y en modo claro quedaban
  // tiles negros con iconos aclarados sobre un hub blanco.
  if (brand && window.brandIcon(brand)) {
    const m = document.createElement('span'); m.className = 'd-mono'; m.innerHTML = window.brandIcon(brand);
    tile.appendChild(m); letter.remove(); return;
  }
  getTile(d.url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.className = 'd-fav'; im.src = t.icon; tile.style.setProperty('--icon-sz', '34px'); im.onload = () => letter.remove(); im.onerror = () => im.remove(); tile.appendChild(im); } });
}
let dialDrag = null;
function makeDialEl(d) {
  const el = document.createElement('div'); el.className = 'dial'; el.title = d.url;
  // En modo Editar, los tiles se reordenan arrastrando DENTRO del contenedor
  el.addEventListener('mousedown', () => { if (els.hub.classList.contains('editing')) el.draggable = true; });
  el.addEventListener('dragstart', (e) => {
    if (!els.hub.classList.contains('editing')) { e.preventDefault(); return; }
    e.stopPropagation(); dialDrag = d; els.hub.classList.add('arrastrando'); e.dataTransfer.setData('text/dial', d.url);
  });
  el.addEventListener('dragover', (e) => { if (dialDrag && dialDrag !== d) { e.preventDefault(); e.stopPropagation(); el.classList.add('dial-dest'); } });
  el.addEventListener('dragleave', () => el.classList.remove('dial-dest'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('dial-dest');
    if (!dialDrag || dialDrag === d) return;
    e.preventDefault(); e.stopPropagation();
    const desde = dials.indexOf(dialDrag), hasta = dials.indexOf(d);
    if (desde < 0 || hasta < 0) return;
    dials.splice(desde, 1); dials.splice(hasta, 0, dialDrag);
    dialDrag = null; store.set('cobalt.dials', dials); renderHub();
  });
  el.addEventListener('dragend', () => { el.draggable = false; dialDrag = null; els.hub.classList.remove('arrastrando'); document.querySelectorAll('.dial-dest').forEach((x) => x.classList.remove('dial-dest')); });
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
  notes: { name: 'Notas', icon: 'pencil-square', span: 3 },
  spotify: { name: 'Spotify', icon: 'musical-note', span: 3 },
  calendar: { name: 'Calendario', icon: 'calendar', span: 3 },
  user: { name: 'Cuenta', icon: 'user-circle', span: 2 },
  xtrends: { name: 'Tendencias X', icon: 'hash', span: 2, rspan: 2 },
  imagen: { name: 'Imagen', icon: 'photo', span: 2 },
  mail: { name: 'Gmail', icon: 'inbox', span: 2, rspan: 2 },
  descargas: { name: 'Descargas', icon: 'download' },
  privada: { name: 'Ventana privada', icon: 'hat-glasses' },
  monitor: { name: 'Monitor', icon: 'res-scale' },
  moovin: { name: 'Moovin', icon: 'tv-minimal' },
  clip: { name: 'Portapapeles', icon: 'clipboard' },
  deco: { name: 'Adorno', icon: 'star' },
  wallet: { name: 'Tarjetas', icon: 'credit-card' }
};
/* ===== GRILLA UNIVERSAL DE CELDAS (2026-08-11, pedido de Dosa) =====
   Como la pantalla de un movil: celda base 160x160 (el RELOJ es la referencia,
   2x1), cada widget ocupa un rectangulo de celdas {col,row,w,h} y se arrastra
   a cualquier hueco libre. Cada tipo declara sus TALLAS (algunas cambian la
   estructura). Sustituye a los mapas por tramo (span/col8/lienzo). */
/* UNA SOLA COMPOSICION (2026-08-11, logica de Dosa: "un UWQHD es un QHD mas
   largo"). La celda se deriva del ALTO (5 filas fijas en horizontal): a misma
   altura, mismas celdas. El ancho solo anade COLUMNAS: 16:9 usa 10, ultrawide
   13 (las 3 extra son largo, no otra maqueta). Cada widget tiene UNA geometria
   {col,row,w,h}; si en una pantalla estrecha no cabe, se recoloca TEMPORALMENTE
   sin tocar la composicion. Ventana rara (vertical): modo flujo con scroll. */
let CELDA_W = 160, CELDA_H = 160;
const CELDA_GAP = 18;
const FILAS_LOGICAS = 5;
let ultimoBucket = 'm', ultimasFilas = FILAS_LOGICAS; // 'm' = la unica maqueta
const TAMANOS = {
  clock: [[2, 1], [2, 2]],
  search: [[4, 1], [6, 1], [3, 1]],
  shortcuts: [[6, 1], [4, 2], [6, 2], [5, 1]],
  date: [[2, 1]],
  weather: [[2, 1], [1, 1], [2, 2]],
  region: [[2, 1]],
  notes: [[2, 2], [2, 1], [3, 2]],
  spotify: [[2, 2], [2, 3], [4, 2]],
  calendar: [[2, 2], [1, 1], [3, 3], [3, 2]],
  user: [[2, 1], [1, 1], [2, 2]],
  xtrends: [[2, 3], [2, 2], [2, 4]],
  imagen: [[2, 2], [4, 2], [2, 1], [3, 3]],
  mail: [[2, 3], [2, 4], [3, 3]],
  descargas: [[2, 2], [1, 1], [2, 1], [2, 3]],
  privada: [[1, 1], [2, 1]],
  monitor: [[2, 1], [1, 1], [1, 2], [2, 2]],
  moovin: [[2, 2], [1, 1], [2, 1], [4, 2]],
  clip: [[2, 2], [1, 1], [2, 3], [3, 2]],
  deco: [[1, 1], [2, 1], [2, 2]],
  wallet: [[2, 1], [1, 1], [2, 2]]
};
// Tallas LIBRES: estas cajas se estiran por los bordes a cualquier rectangulo
// de celdas (las imagenes se adaptan por cover; los accesos reorganizan tiles).
const LIBRES = new Set(['imagen', 'shortcuts', 'search']);
/* Los ACCESOS crecen con los marcadores: se calcula cuantas filas de tiles
   caben en su ancho y la tarjeta gana alto; los widgets de ABAJO se desplazan
   hacia abajo sin descuadrar (peticion de Dosa 2026-08-12). */
function altoAccesos(w) {
  const TILE = 92, GAP_T = 16, ETIQ = 26, PAD = 26;
  const anchoPx = w.w * CELDA_W + (w.w - 1) * CELDA_GAP - PAD;
  const porFila = Math.max(1, Math.floor((anchoPx + GAP_T) / (TILE + GAP_T)));
  const filas = Math.ceil((dials.length + 1) / porFila);
  const altoPx = filas * (TILE + ETIQ) + (filas - 1) * GAP_T + PAD;
  return Math.max(1, Math.ceil((altoPx + CELDA_GAP) / (CELDA_H + CELDA_GAP)));
}
function ajustaAccesos() {
  const w = widgets.find((x) => x.type === 'shortcuts' && x.geo && x.geo.m);
  if (!w) return;
  const g = w.geo.m;
  const nuevo = altoAccesos(g);
  const delta = nuevo - g.h;
  if (!delta) return;
  const finAntes = g.row + g.h - 1;
  g.h = nuevo; w.h = nuevo; w.row = g.row;
  // Empuje SOLO en las columnas que ocupan los accesos: los laterales no se
  // tocan (antes subia/bajaba toda la fila y descuadraba el bento).
  const cruza = (gx) => gx.col <= g.col + g.w - 1 && gx.col + gx.w - 1 >= g.col;
  delBucket().forEach((x) => {
    if (x.id === w.id) return;
    const gx = x.geo.m;
    if (!cruza(gx) || gx.row <= finAntes) return;
    const nueva = delta > 0
      ? Math.min(ultimasFilas - gx.h + 1, gx.row + delta)
      : Math.max(g.row + g.h, gx.row + delta); // al encoger, vuelven a su sitio
    gx.row = nueva; x.row = nueva;
  });
  saveWidgets();
}
function tallaValida(w) {
  if (LIBRES.has(w.type)) {
    const def = (TAMANOS[w.type] || [[2, 2]])[0];
    w.w = Math.max(1, w.w || def[0]); w.h = Math.max(1, w.h || def[1]);
    return [w.w, w.h];
  }
  const lista = TAMANOS[w.type] || [[2, 1]];
  if (lista.some(([a, b]) => a === w.w && b === w.h)) return [w.w, w.h];
  return lista[0];
}
/* ===== UNA SOLA MAQUETA (2026-08-12) =====
   Antes había tres composiciones según la forma de la ventana (ultrapanorámica
   17x7, horizontal 13x7 y una de emergencia) y cada widget SOLO se dibujaba en
   aquellas donde tenía posición guardada. Consecuencias que sufrió Dosa: abrir
   en ventana pequeña dejaba el hub EN BLANCO (ningún widget tenía posición en
   ese modo), la de emergencia montaba 60 filas fijas —10.000px de alto— con el
   bloque centrado, así que la mitad quedaba por encima del scroll, y encima
   las recolocaciones automáticas SE GUARDABAN: cambiar el tamaño de la ventana
   te destrozaba la composición buena.

   Ahora hay UNA maqueta (la tuya) y la ventana solo decide cómo se enseña:
     · Cabe entera            -> misma maqueta, celda más pequeña.
     · Cabe a lo ancho pero no a lo alto -> misma maqueta y SCROLL vertical.
     · No cabe ni a lo ancho (ventana estrecha o vertical) -> REFLUJO: se
       reordena en orden de lectura en las columnas que quepan.
   El reflujo NO se guarda nunca: al agrandar la ventana vuelve tu maqueta
   intacta. Solo se guarda lo que muevas tú en modo edición. */
/* Las celdas NO bajan de estos tamaños: los widgets están dibujados para una
   celda de ~150px y por debajo de ~118 se les rompe el contenido (el Monitor
   se corta, el reproductor se aplasta, las filas de Correo se parten). Antes
   se encogía hasta 66px con tal de que la maqueta cupiera, y eso era lo que
   se veía roto. Ahora se prefiere reordenar y hacer scroll antes que encoger. */
const CELDA_DISENO = 150;  // tamaño para el que están hechos los widgets
const CELDA_MIN = 118;     // mínimo con el que aún se leen; por debajo, reflujo
const CELDA_COMODA = 132;  // si el alto aprieta, no encogemos más: preferimos scroll
let COLS_MAESTRA = 13, FILAS_MAESTRA = 7;
function medidasMalla() {
  // OJO: en el primer render el hub aun mide 0 y caer a window.innerHeight
  // daba una celda mas grande de la cuenta (la malla no cabia y aparecia
  // scroll). 116px = titlebar + navbar.
  const anchoHub = els.hub.clientWidth || (window.innerWidth - 48);
  const altoHub = els.hub.clientHeight || (window.innerHeight - 116);
  const anchoUtil = anchoHub * 0.94;
  const csG = getComputedStyle(els.widgetGrid);
  const altoUtil = altoHub - (parseFloat(csG.paddingTop) || 24) - (parseFloat(csG.paddingBottom) || 90);
  const C = COLS_MAESTRA, F = FILAS_MAESTRA;
  const cwAncho = Math.floor((anchoUtil - (C - 1) * CELDA_GAP) / C);
  const cwAlto = Math.floor((altoUtil - (F - 1) * CELDA_GAP) / F);
  if (cwAncho >= CELDA_MIN) {
    // La maqueta se conserva. Si el alto no da, celda cómoda y scroll: mucho
    // mejor que reordenar los widgets por una ventana un poco baja.
    const cw = Math.min(cwAncho, Math.max(cwAlto, CELDA_COMODA));
    return { bucket: 'm', cols: C, cw, filas: F, reflujo: false, raro: cw > cwAlto };
  }
  // Ventana estrecha o vertical: reflujo en columnas, con la celda de DISEÑO
  // (los widgets se ven como deben) y scroll. Solo se encoge por debajo si la
  // ventana es tan estrecha que no cabrían ni dos columnas.
  let cw = CELDA_DISENO;
  let cols = Math.floor((anchoUtil + CELDA_GAP) / (cw + CELDA_GAP));
  if (cols < 2) { cols = 2; cw = Math.max(96, Math.floor((anchoUtil - CELDA_GAP) / 2)); }
  return { bucket: 'm', cols, cw, filas: 400, reflujo: true, raro: true };
}
function libre(occ, col, row, w, h, cols) {
  if (col < 1 || row < 1 || col + w - 1 > cols || row + h - 1 > ultimasFilas) return false;
  for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (occ.has(r + ':' + c)) return false;
  return true;
}
// Solo los widgets de la composicion ACTIVA ocupan celdas: los que aun no
// se han colocado en este bucket son invisibles y no deben estorbar (bug de
// "Ahi no cabe" en huecos claramente libres).
function delBucket() {
  return widgets.filter((x) => x.geo && x.geo.m);
}
function ocupa(occ, wd) { for (let r = wd.row; r < wd.row + wd.h; r++) for (let c = wd.col; c < wd.col + wd.w; c++) occ.add(r + ':' + c); }
// Toda mutacion (mover/estirar/talla) debe escribir en el bucket ACTIVO:
// el render lee geo[cols] primero, y sin esto restauraba la posicion vieja.
function fijaGeo(w) { (w.geo = w.geo || {}).m = { col: w.col, row: w.row, w: w.w, h: w.h }; }
function primerHueco(occ, w, h, cols) {
  for (let row = 1; row <= ultimasFilas - h + 1; row++) for (let col = 1; col <= cols - w + 1; col++) {
    if (libre(occ, col, row, w, h, cols)) return { col, row };
  }
  return null; // no cabe: el widget se oculta hasta que haya sitio
}

/* Disposicion de FABRICA: la composicion de Dosa (2026-08-11) en el sistema
   de COMPOSICION UNICA (celda por alto, 10 col en 16:9, 13 en ultrawide).
   Las imagenes van vacias: el usuario pone las suyas. */
const DEFAULT_WIDGETS = () => JSON.parse(JSON.stringify([
  {
    "id": "wse",
    "type": "search",
    "col": 5,
    "row": 1,
    "w": 5,
    "h": 1,
    "geo": {
      "std": {
        "col": 5,
        "row": 1,
        "w": 5,
        "h": 1
      },
      "uw": {
        "col": 7,
        "row": 1,
        "w": 5,
        "h": 1
      }
    }
  },
  {
    "id": "wck",
    "type": "clock",
    "col": 5,
    "row": 2,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 5,
        "row": 2,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 7,
        "row": 2,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "wi1",
    "type": "imagen",
    "col": 7,
    "row": 2,
    "w": 3,
    "h": 1,
    "geo": {
      "std": {
        "col": 7,
        "row": 2,
        "w": 3,
        "h": 1
      },
      "uw": {
        "col": 16,
        "row": 5,
        "w": 2,
        "h": 2
      }
    },
    "slot": 1
  },
  {
    "id": "wus",
    "type": "user",
    "col": 12,
    "row": 2,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 12,
        "row": 2,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 16,
        "row": 2,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "wsc",
    "type": "shortcuts",
    "col": 5,
    "row": 3,
    "w": 5,
    "h": 1,
    "geo": {
      "std": {
        "col": 5,
        "row": 3,
        "w": 5,
        "h": 1
      },
      "uw": {
        "col": 7,
        "row": 3,
        "w": 5,
        "h": 1
      }
    }
  },
  {
    "id": "wdescargas1786480816361",
    "type": "descargas",
    "col": 12,
    "row": 6,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 12,
        "row": 6,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 1,
        "row": 5,
        "w": 2,
        "h": 2
      }
    }
  },
  {
    "id": "w1011786484898580",
    "type": "calendar",
    "col": 12,
    "row": 4,
    "w": 2,
    "h": 2,
    "geo": {
      "std": {
        "col": 12,
        "row": 4,
        "w": 2,
        "h": 2
      },
      "uw": {
        "col": 14,
        "row": 2,
        "w": 2,
        "h": 2
      }
    }
  },
  {
    "id": "w1071786484934841",
    "type": "privada",
    "col": 7,
    "row": 4,
    "w": 1,
    "h": 1,
    "geo": {
      "std": {
        "col": 7,
        "row": 4,
        "w": 1,
        "h": 1
      },
      "uw": {
        "col": 10,
        "row": 4,
        "w": 1,
        "h": 1
      }
    }
  },
  {
    "id": "w1081786484952003",
    "type": "wallet",
    "col": 5,
    "row": 4,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 5,
        "row": 4,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 7,
        "row": 4,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "w1091786484963058",
    "type": "spotify",
    "col": 1,
    "row": 2,
    "w": 2,
    "h": 2,
    "geo": {
      "std": {
        "col": 1,
        "row": 2,
        "w": 2,
        "h": 2
      },
      "uw": {
        "col": 16,
        "row": 3,
        "w": 2,
        "h": 2
      }
    }
  },
  {
    "id": "w1021786485486556",
    "type": "imagen",
    "col": 1,
    "row": 6,
    "w": 2,
    "h": 2,
    "geo": {
      "std": {
        "col": 1,
        "row": 6,
        "w": 2,
        "h": 2
      },
      "uw": {
        "col": 9,
        "row": 2,
        "w": 3,
        "h": 1
      }
    },
    "slot": 2
  },
  {
    "id": "wweather1786486269253",
    "type": "weather",
    "col": 12,
    "row": 3,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 12,
        "row": 3,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 3,
        "row": 2,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "w1011786486744553",
    "type": "mail",
    "col": 14,
    "row": 4,
    "w": 2,
    "h": 3,
    "geo": {
      "uw": {
        "col": 14,
        "row": 4,
        "w": 2,
        "h": 3
      }
    }
  },
  {
    "id": "wxt1786486762568",
    "type": "xtrends",
    "col": 1,
    "row": 4,
    "w": 2,
    "h": 2,
    "geo": {
      "std": {
        "col": 1,
        "row": 4,
        "w": 2,
        "h": 2
      },
      "uw": {
        "col": 1,
        "row": 2,
        "w": 2,
        "h": 2
      }
    }
  },
  {
    "id": "wmonitor1786495950984",
    "type": "monitor",
    "col": 12,
    "row": 7,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 12,
        "row": 7,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 1,
        "row": 4,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "wclip1786495950984",
    "type": "clip",
    "col": 3,
    "row": 3,
    "w": 2,
    "h": 2,
    "geo": {
      "uw": {
        "col": 3,
        "row": 3,
        "w": 2,
        "h": 2
      }
    }
  },
  {
    "id": "wnotes1786495950984",
    "type": "notes",
    "col": 8,
    "row": 4,
    "w": 2,
    "h": 2,
    "geo": {
      "std": {
        "col": 8,
        "row": 4,
        "w": 2,
        "h": 2
      },
      "uw": {
        "col": 3,
        "row": 5,
        "w": 2,
        "h": 2
      }
    }
  },
  {
    "id": "wmoov1786496464075",
    "type": "moovin",
    "col": 5,
    "row": 5,
    "w": 1,
    "h": 1,
    "geo": {
      "std": {
        "col": 5,
        "row": 5,
        "w": 1,
        "h": 1
      },
      "uw": {
        "col": 11,
        "row": 4,
        "w": 1,
        "h": 1
      }
    }
  },
  {
    "id": "wdeco1786498510113",
    "type": "deco",
    "col": 9,
    "row": 4,
    "w": 1,
    "h": 1,
    "geo": {
      "uw": {
        "col": 9,
        "row": 4,
        "w": 1,
        "h": 1
      }
    }
  },
  {
    "id": "w1011786501277856",
    "type": "imagen",
    "col": 6,
    "row": 5,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 6,
        "row": 5,
        "w": 2,
        "h": 1
      }
    },
    "slot": 3
  }
]));
/* MIGRACION A LA GRILLA (2026-08-12) — lo que descuadro la maqueta de Dosa:
   las maquetas de antes de la grilla de celdas guardaban SOLO `span` (el ancho
   en doceavos de una fila), sin col/row ni geo. La grilla no tiene nada que
   traducir de ahi, asi que renderHub las recolocaba una a una con primerHueco:
   todo apelotonado en la fila 1 y el resto de la pantalla vacio. Ademas la
   composicion de fabrica no llegaba nunca, porque solo se usa cuando NO hay
   nada guardado. Ahora una maqueta sin `geo` se reconoce como vieja, se guarda
   tal cual en cobalt.widgets.pre-grilla (por si hiciera falta volver) y se
   adopta la composicion de fabrica. */
function migraMaquetaVieja(lista) {
  if (!Array.isArray(lista) || !lista.length) return DEFAULT_WIDGETS();
  if (lista.some((w) => w && w.geo && (w.geo.m || w.geo.std || w.geo.uw))) return lista;
  store.set('cobalt.widgets.pre-grilla', lista);
  const nueva = DEFAULT_WIDGETS();
  store.set('cobalt.widgets', nueva);
  return nueva;
}
let widgets = migraMaquetaVieja(store.get('cobalt.widgets', null));
// migracion: la geometria plana (col/row) se convierte en geo.std
widgets.forEach((w) => {
  if (!w.geo && w.col >= 1 && w.row >= 1) w.geo = { std: { col: w.col, row: w.row, w: w.w, h: w.h } };
});
/* De TRES composiciones por forma de ventana a UNA (2026-08-12): se adopta la
   que más widgets tenga (la ultrapanorámica manda si estaba compuesta ahí,
   porque es donde Dosa colocó todo) y pasa a ser LA maqueta. Las viejas
   geo.std/geo.uw se dejan intactas en disco como respaldo: si algún día hay
   que volver atrás, siguen ahí. */
(function migraAMaquetaUnica() {
  const guardada = store.get('cobalt.maqueta', null);
  if (guardada && guardada.cols) { COLS_MAESTRA = guardada.cols; FILAS_MAESTRA = guardada.filas || 7; }
  if (widgets.some((w) => w.geo && w.geo.m)) return;
  const cuenta = (k) => widgets.filter((w) => w.geo && w.geo[k]).length;
  const fuente = cuenta('uw') >= cuenta('std') && cuenta('uw') ? 'uw' : (cuenta('std') ? 'std' : null);
  if (fuente) { COLS_MAESTRA = fuente === 'uw' ? 17 : 13; FILAS_MAESTRA = 7; }
  widgets.forEach((w) => {
    const g = (w.geo && (w.geo[fuente] || w.geo.uw || w.geo.std)) || { col: w.col, row: w.row, w: w.w, h: w.h };
    (w.geo = w.geo || {}).m = {
      col: Math.max(1, g.col || 1), row: Math.max(1, g.row || 1),
      w: Math.max(1, g.w || w.w || 2), h: Math.max(1, g.h || w.h || 1)
    };
  });
  store.set('cobalt.maqueta', { cols: COLS_MAESTRA, filas: FILAS_MAESTRA });
  store.set('cobalt.widgets', widgets);
})();
const saveWidgets = () => store.set('cobalt.widgets', widgets);
let widgetSeq = 100;

let ultimoCols = 0, dragId = null;
function renderHub() {
  els.widgetGrid.innerHTML = '';
  const m = medidasMalla();
  ultimoBucket = m.bucket; ultimasFilas = m.filas;
  const reflujo = !!m.reflujo;
  els.hub.classList.toggle('con-scroll', !!m.raro);
  els.hub.classList.toggle('reflujo', reflujo);
  if (reflujo) els.hub.classList.remove('editing');   // sin sitio no se compone
  const cols = m.cols; ultimoCols = cols;
  CELDA_W = m.cw; CELDA_H = m.cw; // celda cuadrada que ESCALA con el monitor
  els.widgetGrid.style.gridTemplateColumns = `repeat(${cols}, ${CELDA_W}px)`;
  // Filas SIEMPRE explicitas: si la grilla solo creaba las usadas, el bloque
  // centrado quedaba desplazado respecto a la malla de guias. En reflujo van
  // implicitas: las filas las pone el contenido, no un numero fijo (las 60 de
  // antes creaban 10.000px de vacio con la mitad fuera del scroll).
  els.widgetGrid.style.gridTemplateRows = reflujo ? 'none' : `repeat(${m.filas}, ${CELDA_H}px)`;
  els.widgetGrid.style.gridAutoRows = `${CELDA_H}px`;
  els.widgetGrid.style.gap = `${CELDA_GAP}px`;
  // OJO: ajustaAccesos GUARDA (crece la tarjeta y empuja a los de abajo). En
  // reflujo no debe tocarse nada de la maqueta real.
  if (!reflujo) ajustaAccesos();
  const occ = new Set();
  /* En REFLUJO manda el orden de lectura de tu maqueta (arriba a abajo,
     izquierda a derecha), PERO el buscador y los accesos van SIEMPRE los
     primeros y a todo lo ancho: son lo primero que se usa del hub y tienen
     que quedar arriba y en el centro, caiga la ventana como caiga. */
  const MANDAN = { search: 0, shortcuts: 1 };
  const rango = (x) => (x.type in MANDAN ? MANDAN[x.type] : 2);
  const enOrden = !reflujo ? widgets : [...widgets].sort((a, b) => {
    const ga = (a.geo && a.geo.m) || a, gb = (b.geo && b.geo.m) || b;
    return (rango(a) - rango(b)) || (ga.row - gb.row) || (ga.col - gb.col);
  });
  for (const w of enOrden) {
    // UNA sola maqueta: geo.m. Ya no hay membresia por forma de ventana, así
    // que ningun widget puede "no pertenecer" y desaparecer.
    const g = w.geo && w.geo.m;
    if (g) { w.col = g.col; w.row = g.row; w.w = g.w; w.h = g.h; }
    let [tw, th] = tallaValida(w); if (tw > cols) tw = cols; w.w = tw; w.h = th;
    // Buscador y accesos, a todo el ancho en reflujo (no se guarda: es solo
    // como se muestran mientras la ventana no da para la maqueta real).
    if (reflujo && (w.type === 'search' || w.type === 'shortcuts')) {
      tw = cols;
      // A todo lo ancho los accesos caben en menos filas: se recalcula el alto
      // SOLO para pintar (guardarlo sería tocar la maqueta real), si no queda
      // un boquete debajo del tamaño que tienen en tu composición.
      if (w.type === 'shortcuts') th = altoAccesos({ w: tw });
    }
    let cc = reflujo ? 0 : w.col, rr = reflujo ? 0 : w.row;
    if (!(cc >= 1 && rr >= 1) || !libre(occ, cc, rr, tw, th, cols)) {
      const pos = primerHueco(occ, tw, th, cols);
      if (!pos) continue; // sin sitio visible: oculto hasta liberar celdas
      cc = pos.col; rr = pos.row;
      // Lo que se recoloca por el TAMAÑO DE LA VENTANA no se guarda jamás:
      // era exactamente lo que le destrozaba la maqueta a Dosa al abrir en
      // ventana pequeña. Solo persiste lo que se mueve en modo edición.
      if (!reflujo) { w.col = cc; w.row = rr; fijaGeo(w); }
    }
    ocupa(occ, { col: cc, row: rr, w: tw, h: th });
    const el = document.createElement('div'); el.className = 'widget'; el.dataset.id = w.id;
    el.style.gridColumn = `${cc} / span ${tw}`;
    el.style.gridRow = `${rr} / span ${th}`;
    const body = document.createElement('div');
    if (w.type === 'clock') {
      // Reloj-TARJETA del bento (2026-08-11): texto a la izquierda y chip del
      // día FUNDIDO en la esquina (scoop). Deja de ser un texto suelto centrado.
      body.className = 'w-card w-clock';
      body.innerHTML = `<div class="ck-chip" title="Hoy"><span id="w-dnum"></span></div><div class="time" id="w-time"></div><div class="greet" id="w-greet"></div><div class="ck-fecha" id="w-fecha"></div>`;
    }
    else if (w.type === 'search') { body.className = 'w-searchwrap'; body.appendChild(buildSearch()); }
    else if (w.type === 'shortcuts') { body.className = 'w-card w-shortcuts'; const g = document.createElement('div'); g.className = 'sc-grid'; dials.forEach((d) => g.appendChild(makeDialEl(d))); const add = document.createElement('div'); add.className = 'dial add'; add.innerHTML = `<div class="d-tile">${window.icon('plus')}</div><div class="d-name">Añadir</div>`; add.addEventListener('click', () => { els.dialName.value = ''; els.dialUrl.value = ''; els.dialModal.classList.remove('hidden'); els.dialName.focus(); }); g.appendChild(add); body.appendChild(g); }
    else if (w.type === 'date') { body.className = 'w-card w-date'; renderDate(body); }
    else if (w.type === 'weather') { body.className = 'w-card w-wx'; body.innerHTML = '<div class="w-loading">Cargando clima…</div>'; loadWeather(body, 'weather'); }
    else if (w.type === 'region') { body.className = 'w-card w-weather'; body.innerHTML = '<div class="w-loading">Cargando región…</div>'; loadWeather(body, 'region'); }
    else if (w.type === 'notes') { body.className = 'w-card w-notes'; renderNotasW(body); }
    else if (w.type === 'spotify') { body.className = 'w-card w-sp sp-vacio'; renderSpotify(body); }
    else if (w.type === 'calendar') { body.className = 'w-card w-cal'; renderCalendar(body); }
    else if (w.type === 'user') { body.className = 'w-card w-user'; renderUserCard(body); }
    else if (w.type === 'xtrends') { body.className = 'w-card w-xt'; renderXTrends(body); }
    else if (w.type === 'imagen') { body.className = 'w-card w-img'; renderImagen(body, w); }
    else if (w.type === 'mail') { body.className = 'w-card w-mail'; renderMail(body); }
    else if (w.type === 'descargas') { body.className = 'w-card w-dlw'; renderDescargasW(body); }
    else if (w.type === 'privada') { body.className = 'w-card w-priv'; renderPrivadaW(body); }
    else if (w.type === 'monitor') { body.className = 'w-card w-mon'; renderMonitorW(body); }
    else if (w.type === 'moovin') { body.className = 'w-card w-moov'; renderMoovinW(body); }
    else if (w.type === 'clip') { body.className = 'w-card w-clip'; renderClipW(body); }
    else if (w.type === 'deco') { body.className = 'w-card w-deco'; body.innerHTML = '<span class="dc-a"></span><span class="dc-b"></span><span class="dc-c"></span>'; }
    else if (w.type === 'wallet') { body.className = 'w-card w-wallet'; renderWalletW(body); }
    body.classList.add('t-' + tw + 'x' + th); // talla para CSS estructural
    if (body.parentNode !== el) el.appendChild(body);

    // Herramientas de edición
    const tools = document.createElement('div'); tools.className = 'w-tools';
    const grip = document.createElement('button'); grip.title = 'Arrastra para mover'; grip.innerHTML = window.icon('grip');
    const size = document.createElement('button'); size.title = 'Cambiar tamaño'; size.innerHTML = window.icon('arrows-pointing-out'); size.addEventListener('click', (e) => {
      e.stopPropagation();
      const lista = TAMANOS[w.type] || [[2, 1]];
      const i = lista.findIndex(([a, b]) => a === w.w && b === w.h);
      const sig = lista[(i + 1) % lista.length];
      const tw = Math.min(sig[0], ultimoCols), th = sig[1];
      // validar ANTES de cambiar: sin sitio para la talla nueva, se avisa y no
      // se toca nada (antes el widget se quedaba oculto por no caber)
      if (!empuja(w, tw, th)) { toast(`No hay sitio para ${tw}×${th} — ni empujando vecinos`); return; }
      saveWidgets(); renderHub();
    });
    const rm = document.createElement('button'); rm.className = 'rm'; rm.title = 'Quitar widget'; rm.innerHTML = window.icon('x-mark'); rm.addEventListener('click', (e) => {
      e.stopPropagation();
      // Con una sola maqueta, quitar es quitar (antes solo lo sacaba de la
      // composicion activa y seguia vivo en las otras).
      widgets = widgets.filter((x) => x.id !== w.id);
      saveWidgets(); renderHub();
    });
    tools.append(grip, size, rm); el.appendChild(tools);
    if (LIBRES.has(w.type)) { armaRedim(el, w, 'r'); armaRedim(el, w, 'b'); armaRedim(el, w, 'rb'); }

    // Drag: el widget solo se declara arrastrable; la celda destino la
    // resuelve la GRILLA (armaDnd), como mover iconos en un movil.
    el.draggable = false;
    grip.addEventListener('mousedown', () => { el.draggable = true; });
    el.addEventListener('dragstart', (e) => { el.classList.add('dragging'); dragId = w.id; els.hub.classList.add('arrastrando'); e.dataTransfer.setData('text/plain', w.id); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); el.draggable = false; dragId = null; els.hub.classList.remove('arrastrando'); document.getElementById('celda-fantasma')?.remove(); });
    // Orden de entrada para el escalonado del arranque (#hub.estrenando)
    el.style.setProperty('--i', els.widgetGrid.childElementCount);
    els.widgetGrid.appendChild(el);
  }
  // Guias de la grilla (visibles solo en modo Editar): todas las celdas con
  // contorno suave y el EJE CENTRAL (columna/fila del medio) tintado leve.
  // Guias como CAPA SUPERPUESTA (2026-08-12): antes eran items de la grilla y
  // anadian filas — al entrar en Editar todo saltaba hacia arriba. Ahora no
  // ocupan layout: se dibujan con gradientes sobre la malla real.
  // Guias: las CELDAS punteadas de siempre, pero dentro de una capa
  // superpuesta (no son items de la grilla, asi no anaden filas ni mueven
  // nada al entrar en Editar). El centro tine las dos centrales si el numero
  // es par, para que quede el mismo numero de celdas a cada lado.
  // En reflujo no hay guias: no se puede componer (y con las filas del
  // contenido serian miles de celdas dibujadas para nada).
  const malla = document.createElement('div'); malla.className = 'gmalla';
  const filasGuia = reflujo ? 0 : ultimasFilas;
  const midCols = cols % 2 ? [(cols + 1) / 2] : [cols / 2, cols / 2 + 1];
  const midFilas = filasGuia % 2 ? [(filasGuia + 1) / 2] : [filasGuia / 2, filasGuia / 2 + 1];
  for (let r = 1; r <= filasGuia; r++) for (let c = 1; c <= cols; c++) {
    const g = document.createElement('div'); g.className = 'gcelda';
    if (midCols.includes(c) || midFilas.includes(r)) g.classList.add('gc-centro');
    g.style.left = ((c - 1) * (CELDA_W + CELDA_GAP)) + 'px';
    g.style.top = ((r - 1) * (CELDA_H + CELDA_GAP)) + 'px';
    g.style.width = CELDA_W + 'px'; g.style.height = CELDA_H + 'px';
    malla.appendChild(g);
  }
  els.widgetGrid.appendChild(malla);
  requestAnimationFrame(() => {
    const cs = getComputedStyle(els.widgetGrid);
    const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
    const padR = parseFloat(cs.paddingRight) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    const anchoCeldas = cols * CELDA_W + (cols - 1) * CELDA_GAP;
    const altoCeldas = Math.max(0, filasGuia * CELDA_H + (filasGuia - 1) * CELDA_GAP);
    const dispW = els.widgetGrid.clientWidth - padL - padR;
    const dispH = els.widgetGrid.clientHeight - padT - padB;
    malla.style.left = (padL + Math.max(0, (dispW - anchoCeldas) / 2)) + 'px';
    malla.style.top = (padT + Math.max(0, (dispH - altoCeldas) / 2)) + 'px';
    malla.style.width = anchoCeldas + 'px'; malla.style.height = altoCeldas + 'px';
  });
  armaDnd();
  /* AL TOPE en cada recomposición. Si venías con la ventana pequeña y el hub
     desplazado, al maximizar la maqueta entera NO lleva scroll: el contenedor
     conservaba el desplazamiento viejo y te quedabas mirando el final, sin
     forma de subir (overflow hidden). Recomponer = empezar arriba. */
  const scr = els.hub.querySelector('.hub-scroll');
  if (scr && scr.scrollTop) scr.scrollTop = 0;
  // Los contenedores que scrollean dentro de los widgets acaban de nacer:
  // se enganchan al scroll propio (nunca la barra del sistema).
  if (window.nvsRepasa) requestAnimationFrame(window.nvsRepasa);
  // Si al medir de verdad la celda sale distinta (primer render sin layout),
  // se repinta UNA vez con la medida buena.
  if (!renderHub._ajustando) {
    requestAnimationFrame(() => {
      const m2 = medidasMalla();
      if (m2.cw !== CELDA_W || m2.cols !== ultimoCols || m2.filas !== ultimasFilas) {
        renderHub._ajustando = true; renderHub(); renderHub._ajustando = false;
      }
    });
  }
  tickClock();
  // Las pastillas de la esquina DUPLICAN widgets: con el widget presente en el
  // hub, su pastilla sobra (y en pantallas normales chocaba con la columna
  // derecha). El conmutador de tema, que no tiene widget, se queda.
  const tipos = new Set(widgets.map((x) => x.type));
  document.getElementById('hub-account')?.classList.toggle('hidden', tipos.has('user'));
  document.getElementById('hub-weather')?.classList.toggle('hidden', tipos.has('weather'));
}
/* Motor de arrastre de la grilla: fantasma verde/rojo bajo el cursor; soltar
   coloca si el area esta libre, intercambia si cae sobre otro y AMBOS caben,
   y avisa si no hay sitio. */
function celdaDe(e) {
  const r = els.widgetGrid.getBoundingClientRect();
  const cs = getComputedStyle(els.widgetGrid);
  const anchoMalla = ultimoCols * CELDA_W + (ultimoCols - 1) * CELDA_GAP;
  const x0 = r.left + (r.width - anchoMalla) / 2; // la malla va centrada
  const y0 = r.top + parseFloat(cs.paddingTop);
  return {
    col: Math.max(1, Math.floor((e.clientX - x0) / (CELDA_W + CELDA_GAP)) + 1),
    row: Math.max(1, Math.floor((e.clientY - y0) / (CELDA_H + CELDA_GAP)) + 1)
  };
}
/* Estirar por los BORDES (modo Editar, tallas libres): arrastras el asa y la
   caja crece/encoge por celdas con vista previa; si el rectangulo final pisa
   a otro, se revierte con aviso. */
/* EMPUJE al redimensionar (como un movil): la talla nueva se queda donde
   esta y los vecinos que estorben se recolocan al primer hueco; solo se
   niega si fisicamente no caben todos. */
function empuja(w, tw, th) {
  const col = Math.max(1, Math.min(w.col, ultimoCols - tw + 1));
  const row = Math.max(1, Math.min(w.row, ultimasFilas - th + 1));
  if (col + tw - 1 > ultimoCols || row + th - 1 > ultimasFilas) return false;
  const rect = { col, row, w: tw, h: th };
  const vive = (x) => x.geo && x.geo.m;
  const desplazados = delBucket().filter((x) => x.id !== w.id && vive(x) &&
    rect.col < x.col + x.w && rect.col + tw - 1 >= x.col && rect.row < x.row + x.h && rect.row + th - 1 >= x.row);
  const occ = new Set();
  delBucket().forEach((x) => { if (x.id !== w.id && vive(x) && !desplazados.includes(x)) ocupa(occ, x); });
  ocupa(occ, rect);
  const plan = [];
  for (const d of desplazados) {
    const pos = primerHueco(occ, d.w, d.h, ultimoCols);
    if (!pos) return false;
    plan.push([d, pos]); ocupa(occ, { col: pos.col, row: pos.row, w: d.w, h: d.h });
  }
  plan.forEach(([d, pos]) => { d.col = pos.col; d.row = pos.row; fijaGeo(d); });
  w.col = col; w.row = row; w.w = tw; w.h = th; fijaGeo(w);
  return true;
}
function armaRedim(el, w, dir) {
  const asa = document.createElement('div'); asa.className = 'w-redim ' + dir;
  asa.addEventListener('mousedown', (e) => {
    if (!els.hub.classList.contains('editing')) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, w0 = w.w, h0 = w.h;
    const occ = new Set(); delBucket().forEach((x) => { if (x.id !== w.id) ocupa(occ, x); });
    const mueve = (ev) => {
      let nw = w0, nh = h0;
      if (dir.includes('r')) nw = Math.max(1, w0 + Math.round((ev.clientX - x0) / (CELDA_W + CELDA_GAP)));
      if (dir.includes('b')) nh = Math.max(1, h0 + Math.round((ev.clientY - y0) / (CELDA_H + CELDA_GAP)));
      nw = Math.min(nw, ultimoCols - w.col + 1);
      el.style.gridColumn = w.col + ' / span ' + nw;
      el.style.gridRow = w.row + ' / span ' + nh;
      el.classList.toggle('redim-mal', !libre(occ, w.col, w.row, nw, nh, ultimoCols));
      el.dataset.nw = nw; el.dataset.nh = nh;
    };
    const suelta = () => {
      window.removeEventListener('mousemove', mueve); window.removeEventListener('mouseup', suelta);
      const nw = +el.dataset.nw || w0, nh = +el.dataset.nh || h0;
      if ((nw !== w0 || nh !== h0) && !empuja(w, nw, nh)) toast('Ahí no cabe ni empujando vecinos');
      saveWidgets(); renderHub();
    };
    window.addEventListener('mousemove', mueve); window.addEventListener('mouseup', suelta);
  });
  el.appendChild(asa);
}
function armaDnd() {
  if (els.widgetGrid.dataset.dnd) return; els.widgetGrid.dataset.dnd = '1';
  els.widgetGrid.addEventListener('dragover', (e) => {
    if (!dragId) return; e.preventDefault();
    const wd = widgets.find((x) => x.id === dragId); if (!wd) return;
    const pos = celdaDe(e);
    const occ = new Set(); delBucket().forEach((x) => { if (x.id !== dragId) ocupa(occ, x); });
    let g = document.getElementById('celda-fantasma');
    if (!g) { g = document.createElement('div'); g.id = 'celda-fantasma'; els.widgetGrid.appendChild(g); }
    g.style.gridColumn = pos.col + ' / span ' + wd.w;
    g.style.gridRow = pos.row + ' / span ' + wd.h;
    g.classList.toggle('mal', !libre(occ, pos.col, pos.row, wd.w, wd.h, ultimoCols));
  });
  els.widgetGrid.addEventListener('drop', (e) => {
    e.preventDefault(); document.getElementById('celda-fantasma')?.remove();
    const wd = widgets.find((x) => x.id === dragId); if (!wd) return;
    const pos = celdaDe(e);
    const occ = new Set(); delBucket().forEach((x) => { if (x.id !== wd.id) ocupa(occ, x); });
    if (libre(occ, pos.col, pos.row, wd.w, wd.h, ultimoCols)) { wd.col = pos.col; wd.row = pos.row; fijaGeo(wd); }
    else {
      // cae sobre otro: intercambio de posiciones si AMBOS caben tras el cambio
      const b = delBucket().find((x) => x.id !== wd.id && pos.col < x.col + x.w && pos.col + wd.w - 1 >= x.col && pos.row < x.row + x.h && pos.row + wd.h - 1 >= x.row);
      if (b) {
        const occ2 = new Set(); delBucket().forEach((x) => { if (x.id !== wd.id && x.id !== b.id) ocupa(occ2, x); });
        const cabeA = libre(occ2, b.col, b.row, wd.w, wd.h, ultimoCols);
        const t = new Set(occ2); if (cabeA) ocupa(t, { col: b.col, row: b.row, w: wd.w, h: wd.h });
        const cabeB = cabeA && libre(t, wd.col, wd.row, b.w, b.h, ultimoCols);
        if (cabeA && cabeB) { const pa = { col: b.col, row: b.row }; b.col = wd.col; b.row = wd.row; wd.col = pa.col; wd.row = pa.row; fijaGeo(wd); fijaGeo(b); }
        else toast('Ahí no cabe');
      } else toast('Ahí no cabe');
    }
    saveWidgets(); renderHub();
  });
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
  const dn = document.getElementById('w-dnum'); if (dn) dn.textContent = now.getDate();
  const fe = document.getElementById('w-fecha');
  if (fe) { const f = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }); fe.textContent = f.charAt(0).toUpperCase() + f.slice(1); }
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
    // Tarjeta VERDE del bento (2026-08-11): dato grande a la izquierda, icono
    // arriba a la derecha, chips de viento/humedad y ↗ fundido en el scoop.
    el.innerHTML = `
      <div class="wx2-top"><div class="wx2-temp">${Math.round(wxCache.temperature_2m)}°</div><div class="wx2-ic">${window.icon(ic)}</div></div>
      <div class="wx2-desc">${desc}</div>
      <div class="wx2-chips">
        <span class="wx2-chip">${Math.round(wxCache.wind_speed_10m || 0)} km/h</span>
        <span class="wx2-chip">${Math.round(wxCache.relative_humidity_2m || 0)}% hum.</span>
      </div>
      <div class="wx2-city">${escapeHtml(geo.city || '')}</div>
      <button class="wx2-go" title="Pronóstico completo">${window.icon('arrow-up-right')}</button>`;
    el.querySelector('.wx2-go').addEventListener('click', (e) => { e.stopPropagation(); navigateActive(`https://www.google.com/search?q=clima+${encodeURIComponent(geo.city || '')}`); });
  } catch { el.innerHTML = '<div class="w-loading">Clima no disponible (sin conexión)</div>'; }
}

/* ============ Widget Spotify (2026-08-11) ============
   Controla la pestaña ABIERTA de open.spotify.com — sin API ni claves: se lee
   navigator.mediaSession.metadata (título/artista/carátula, lo alimenta el
   propio player web) y se clican los botones reales por data-testid. El sondeo
   (3 s) solo trabaja con el hub visible y se apaga solo al quitar el widget. */
const SP_LEE = `(() => {
  const m = navigator.mediaSession; const md = m && m.metadata;
  const b = document.querySelector('[data-testid="control-button-playpause"]');
  const on = (m && m.playbackState === 'playing') || !!(b && /pausa|pause/i.test(b.getAttribute('aria-label') || ''));
  const art = md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : '';
  const vb = document.querySelector('[data-testid="volume-bar"] input[type=range]');
  const vol = vb ? Math.round((parseFloat(vb.value) / (parseFloat(vb.max) || 1)) * 100) : null;
  return { t: md ? md.title : '', a: md ? md.artist : '', art, on, vol };
})()`;
const SP_SEL = {
  play: ['[data-testid="control-button-playpause"]', 'button[aria-label*="Pausar"]', 'button[aria-label*="Pause"]', 'button[aria-label*="Reproducir"]', 'button[aria-label*="Play"]'],
  next: ['[data-testid="control-button-skip-forward"]', 'button[aria-label*="Siguiente"]', 'button[aria-label*="Next"]'],
  prev: ['[data-testid="control-button-skip-back"]', 'button[aria-label*="Anterior"]', 'button[aria-label*="Previous"]']
};

/* ===== Spotify RESIDENTE (2026-08-11, petición de Dosa) =====
   Webview propio FUERA del sistema de pestañas: no lo duerme el ahorro de
   energía y el audio sigue al navegar por otros sitios. El botón del sidebar
   (bajo el home) abre un panel cápsula; CERRAR el panel solo lo oculta.
   El botón aparece si hay sesión de Spotify (cookie sp_dc, IPC spotify:logged)
   o si el dock ya se usó alguna vez (cobalt.spotifyDock). */
let spPlayerWv = null;
/* PANEL DE SPOTIFY (rehecho 2026-08-12).
   Antes el panel medía 392px fijos y forzaba USER AGENT DE MÓVIL, porque a esa
   anchura la web de escritorio se veía apretada. El precio era grave y no se
   había visto: en su web móvil, Spotify CAPA "Tu biblioteca" y te manda a
   instalar la aplicación. Por eso Dosa no podía entrar a su biblioteca.
   Ahora: user agent normal (de escritorio), panel más ancho y ajustable
   arrastrando, y un zoom calculado para que la página crea que tiene al menos
   VIEWPORT_DESKTOP píxeles de ancho — así sirve la interfaz completa aunque el
   panel sea estrecho. */
const SP_VIEWPORT = 900;   // ancho de página mínimo para que Spotify dé la UI de escritorio
const SP_ANCHO_DEF = 720, SP_ANCHO_MIN = 380, SP_ANCHO_MAX = 1280;
function spAncho() {
  const v = +store.get('cobalt.spPanelW', SP_ANCHO_DEF) || SP_ANCHO_DEF;
  return Math.max(SP_ANCHO_MIN, Math.min(SP_ANCHO_MAX, v));
}
function aplicaSpAncho(px) {
  const ancho = Math.max(SP_ANCHO_MIN, Math.min(SP_ANCHO_MAX, Math.round(px)));
  const panel = document.getElementById('sp-panel');
  if (panel) panel.style.width = ancho + 'px';
  // Zoom < 1 = la página se cree más ancha de lo que es: con 720px reales y
  // zoom 0.8 ve 900, que es lo que necesita para no caer en la vista móvil.
  if (spPlayerWv) { try { spPlayerWv.setZoomFactor(Math.max(0.5, Math.min(1, ancho / SP_VIEWPORT))); } catch { /* aún no listo */ } }
  return ancho;
}
function ensureSpotifyPlayer() {
  if (spPlayerWv) return spPlayerWv;
  const wv = document.createElement('webview');
  wv.setAttribute('partition', PARTITION);
  // sin scrollbar dentro del panel (el scroll por rueda/gesto sigue vivo)
  wv.addEventListener('dom-ready', () => {
    wv.insertCSS('::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}').catch(() => {});
    aplicaSpAncho(spAncho());
  });
  /* Señales de que lo estás USANDO. Solo marcan la HORA del último uso: si
     además reiniciaban la cuenta atrás no se dormía jamás, porque el propio
     Spotify dispara navegaciones internas solo. Tampoco se escucha
     did-navigate-in-page por lo mismo — y no hace falta: para navegar por
     Spotify tienes que tener el panel abierto, y con el panel abierto no se
     duerme nunca. */
  const usando = () => { spUltimoUso = Date.now(); };
  wv.addEventListener('focus', usando);
  wv.addEventListener('did-navigate', usando);
  /* Al abrir una lista o un album, el widget tiene que ENTERARSE. Antes solo
     se leia al pintar el widget: si abrias la lista despues, se quedaba con
     "abre un album o una lista" para siempre. Aqui solo se marca sucia; el
     repaso de cada 3 s hace la lectura. */
  const cambio = () => { spListaSucia = true; };
  wv.addEventListener('did-navigate', cambio);
  wv.addEventListener('did-navigate-in-page', cambio);
  wv.src = 'https://open.spotify.com';
  document.getElementById('sp-holder').appendChild(wv);
  spPlayerWv = wv;
  store.set('cobalt.spotifyDock', true);
  els.sbSpotify.classList.remove('hidden');
  return wv;
}
/* Tirador del canto derecho, como el de los paneles web laterales. */
function armaSpGrip() {
  const panel = document.getElementById('sp-panel');
  const asa = document.getElementById('sp-grip');
  if (!panel || !asa) return;
  asa.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = panel.getBoundingClientRect().width;
    document.body.style.cursor = 'ew-resize';
    const mueve = (ev) => { panel.style.width = Math.max(SP_ANCHO_MIN, Math.min(SP_ANCHO_MAX, w0 + (ev.clientX - x0))) + 'px'; };
    const suelta = () => {
      document.removeEventListener('mousemove', mueve); document.removeEventListener('mouseup', suelta);
      document.body.style.cursor = '';
      store.set('cobalt.spPanelW', aplicaSpAncho(panel.getBoundingClientRect().width));
    };
    document.addEventListener('mousemove', mueve); document.addEventListener('mouseup', suelta);
  });
}
function toggleSpotifyPanel(force) {
  const panel = document.getElementById('sp-panel');
  const abrir = force !== undefined ? force : panel.classList.contains('hidden');
  if (abrir) { spUltimoUso = Date.now(); ensureSpotifyPlayer(); spDespierta(false); aplicaSpAncho(spAncho()); panel.classList.remove('hidden'); els.sbSpotify.classList.add('open'); }
  else { panel.classList.add('hidden'); els.sbSpotify.classList.remove('open'); }
  actualizaSpotifyVivo();
}
async function actualizaSpotifyVivo() {
  // La etiqueta "Sonando de fondo" del panel solo si de verdad suena
  const vivo = document.getElementById('sp-p-vivo'); if (!vivo || !spPlayerWv) return;
  try { const st = await spPlayerWv.executeJavaScript(SP_LEE, false); vivo.classList.toggle('hidden', !st.on); }
  catch { vivo.classList.add('hidden'); }
}
function spTab() {
  // El reproductor residente manda; si no existe, vale una pestaña abierta
  if (spPlayerWv) return { webview: spPlayerWv, asleep: false };
  return tabs.find((t) => {
    if (t.asleep || !t.webview) return false;
    try { return new URL(t.url).host === 'open.spotify.com'; } catch { return false; }
  });
}
/* Arranque del dock: glifo de marca, clic, y visibilidad por sesión o uso previo */
els.sbSpotify.innerHTML = window.brandIcon('spotify') || window.icon('musical-note');
els.sbSpotify.addEventListener('click', () => toggleSpotifyPanel());
armaSpGrip();
document.getElementById('sp-p-x').addEventListener('click', () => toggleSpotifyPanel(false));
(async () => {
  if (store.get('cobalt.spotifyDock', false)) { els.sbSpotify.classList.remove('hidden'); return; }
  try { if (await window.cobalt.spotifyLogged()) els.sbSpotify.classList.remove('hidden'); } catch { /* sin IPC: se queda oculto */ }
})();
function spCmd(cmd) {
  spUltimoUso = Date.now();
  const tab = spTab(); if (!tab) return;
  const sels = JSON.stringify(SP_SEL[cmd]);
  tab.webview.executeJavaScript(`(function(){ for (const s of ${sels}) { const b = document.querySelector(s); if (b) { b.click(); return; } } })()`, true).catch(() => {});
  setTimeout(actualizaSpotify, 400); // reflejar el nuevo estado enseguida
}
let spTimer = null;
/* ===== SPOTIFY SE DUERME EN PAUSA (2026-08-13, peticion de Dosa) =====
   El reproductor residente es un webview vivo: su proceso ronda los cientos de
   MB aunque no suene nada. Si la musica lleva PAUSADA 15 s, se manda a
   about:blank y se libera; la URL queda guardada y vuelve sola en cuanto pulsas
   play, abres el panel o eliges una cancion. No se duerme nunca sonando, que
   seria cortarte la musica. */
/* REACTIVADO (2026-08-13). Estuvo apagado mientras se buscaba por qué se
   cerraba la sesión de Spotify: resultó no tener nada que ver — sp_dc es una
   cookie DE SESIÓN y Chromium la tiraba al salir (arreglado en main.js,
   conservaSesiones). Con el culpable encontrado, vuelve el ahorro, pero con
   más margen: cinco minutos en pausa en vez de quince segundos. Liberar
   cientos de MB merece la pena; hacerlo con prisa, no. */
const SP_DORMIR_MS = 5 * 60 * 1000;
const SP_GRACIA_MS = 5 * 60 * 1000;   // margen desde el último uso: cerrar el panel no es dejar de usarlo
let spPausaDesde = 0, spDormido = false, spUrlDormida = '', spUltimoUso = 0, spListaSucia = false, spTicks = 0;
function spDuerme() {
  if (spDormido || !spPlayerWv) return;
  try { spUrlDormida = spPlayerWv.getURL() || 'https://open.spotify.com'; } catch { spUrlDormida = 'https://open.spotify.com'; }
  if (/^about:/.test(spUrlDormida)) return;
  spDormido = true;
  try { spPlayerWv.src = 'about:blank'; } catch { /* nada */ }
  document.querySelectorAll('.w-sp').forEach((el) => el.classList.add('sp-dormido'));
}
/* Despertar: se restaura la pagina y, si se pidio reproducir, se pulsa play en
   cuanto carga (Spotify recupera solo la cancion donde la dejaste). */
function spDespierta(conPlay) {
  if (!spPlayerWv) { ensureSpotifyPlayer(); return; }
  if (!spDormido) { if (conPlay) spCmd('play'); return; }
  spDormido = false; spPausaDesde = 0;
  document.querySelectorAll('.w-sp').forEach((el) => el.classList.remove('sp-dormido'));
  const alCargar = () => {
    spPlayerWv.removeEventListener('dom-ready', alCargar);
    if (conPlay) setTimeout(() => spCmd('play'), 1800);
  };
  spPlayerWv.addEventListener('dom-ready', alCargar);
  try { spPlayerWv.src = spUrlDormida || 'https://open.spotify.com'; } catch { /* nada */ }
}
async function actualizaSpotify() {
  if (!widgets.some((w) => w.type === 'spotify')) { clearInterval(spTimer); spTimer = null; return; }
  const cuerpos = document.querySelectorAll('.w-sp');
  if (!els.hub.classList.contains('active')) return;
  const tab = spTab(); let st = null;
  if (tab && !spDormido) { try { st = await tab.webview.executeJavaScript(SP_LEE, false); } catch { st = null; } }
  // Cuenta atras de la pausa: solo con el reproductor RESIDENTE (una pestana
  // normal de Spotify es del usuario y no se toca).
  // OJO: SP_LEE devuelve on:true con el reproductor VACIO (Spotify deja su
  // boton en ese estado), asi que sonando exige ademas que haya cancion. De
  // paso, un reproductor abierto sin nada cargado tambien se duerme: es un
  // proceso entero gastado en enseniar una portada.
  const sonando = !!(st && st.on && st.t);
  /* CUANDO PUEDE DORMIRSE (corregido 2026-08-13). La primera version solo
     miraba si sonaba algo, y se moria en las narices de Dosa mientras elegia
     musica: navegar por Spotify no es reproducir. Ahora hacen falta TRES
     cosas: que no suene nada, que el panel este CERRADO (con el abierto lo
     estas mirando) y que hayan pasado 60 s desde el ultimo uso — cerrar el
     panel no es dejar de usarlo. */
  const panel = document.getElementById('sp-panel');
  const mirando = panel && !panel.classList.contains('hidden');
  if (spPlayerWv && !spDormido) {
    if (sonando || mirando) spPausaDesde = 0;
    else if (!spPausaDesde) spPausaDesde = Date.now();
    else if (SP_DORMIR_MS > 0 && Date.now() - spPausaDesde > SP_DORMIR_MS && Date.now() - spUltimoUso > SP_GRACIA_MS) spDuerme();
  }
  // Usar Spotify en pestaña también revela el dock (además de la cookie de
  // sesión): la señal "tiene cuenta" más fiable es que lo esté usando.
  if (tab) els.sbSpotify.classList.remove('hidden');
  cuerpos.forEach((el) => pintaSpotify(el, st, !!tab));
  // Relectura de la lista: al navegar por Spotify, y de todos modos cada 15 s
  // como red de seguridad (su reproductor no avisa de todo lo que cambia).
  spTicks++;
  if (tab && !spDormido && (spListaSucia || spTicks % 5 === 0)) {
    spListaSucia = false;
    cuerpos.forEach((el) => llenaListas(el));
  }
}
function pintaSpotify(el, st, hayTab) {
  const sl = el.querySelector('.sp-vol-sl');
  if (sl && st && st.vol != null && !sl.dataset.tocando) sl.value = String(st.vol);
  const img = el.querySelector('.sp-art img'), tit = el.querySelector('.sp-tit'), sub = el.querySelector('.sp-sub');
  const abre = el.querySelector('.sp-abre'), play = el.querySelector('.sp-play');
  const hay = !!(st && st.t);
  el.classList.toggle('sp-vacio', !hay);
  abre.classList.toggle('hidden', hay || hayTab);
  // Con pestaña de Spotify los controles SIEMPRE sirven (clican los botones
  // reales del player), haya o no metadatos — sin pestaña, se apagan.
  el.querySelectorAll('.sp-b').forEach((b) => { b.disabled = !hayTab; });
  if (!hay) {
    tit.textContent = 'Spotify';
    sub.textContent = hayTab ? 'Spotify está abierto — reproduce algo para verlo aquí' : 'Abre open.spotify.com y controla la música desde aquí';
    img.removeAttribute('src'); return;
  }
  if (tit.textContent !== st.t) { tit.textContent = st.t; tit.title = st.t; }
  if (sub.textContent !== (st.a || '')) sub.textContent = st.a || '';
  if (st.art && img.getAttribute('src') !== st.art) img.src = st.art;
  const icono = st.on ? 'pause' : 'play';
  if (play.dataset.ic !== icono) { play.dataset.ic = icono; play.innerHTML = window.icon(icono); }
}
function renderSpotify(body) {
  // Reproductor + "Tu música" en UNA tarjeta (mock de Dosa: van juntos):
  // arriba el player con su FAB fundido al canto; debajo, tus listas.
  body.innerHTML = `
    <div class="sp-player">
      <div class="sp-art">${window.icon('musical-note')}<img alt="" /></div>
      <div class="sp-meta">
        <div class="sp-tit">Spotify</div>
        <div class="sp-sub">Abre open.spotify.com y controla la música desde aquí</div>
        <div class="sp-ctr">
          <button class="sp-b" data-cmd="prev" title="Anterior" disabled>${window.icon('skip-back')}</button>
          <button class="sp-b" data-cmd="next" title="Siguiente" disabled>${window.icon('skip-forward')}</button>
          <span class="sp-vol-ic" title="Volumen">${window.icon('speaker-wave')}</span>
          <input type="range" class="sp-vol-sl" min="0" max="100" value="70" title="Volumen" />
          <button class="sp-abre">Abrir Spotify</button>
        </div>
      </div>
    </div>
    <div class="sp-bib">
      <div class="w-head"><span class="spl-rotulo">Tu música</span><button class="wh-btn spl-rf" title="Actualizar">${window.icon('arrow-path')}</button></div>
      <div class="spl-lista"><div class="w-vacio">Conecta Spotify para ver tus listas</div></div>
    </div>
    <button class="sp-play sp-b" data-cmd="play" title="Reproducir / pausa" data-ic="play">${window.icon('play')}</button>`;
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]'); if (!b || b.disabled) return;
    e.stopPropagation();
    // Dormido, el play tiene que despertarlo primero (y los demas mandos
    // tambien, o pulsarian sobre una pagina en blanco).
    if (spDormido) { spDespierta(b.dataset.cmd === 'play'); return; }
    spCmd(b.dataset.cmd);
  });
  // "Abrir Spotify" levanta el reproductor RESIDENTE (no una pestaña): la
  // música sobrevive a la navegación y el botón del dock queda en el sidebar.
  body.querySelector('.sp-abre').addEventListener('click', (e) => { e.stopPropagation(); toggleSpotifyPanel(true); setTimeout(() => llenaListas(body), 5000); });
  body.querySelector('.spl-rf').addEventListener('click', (e) => { e.stopPropagation(); llenaListas(body); });
  const desliz = body.querySelector('.sp-vol-sl');
  if (desliz) {
    // Mientras lo arrastras, el repaso de cada 3 s NO debe pisarte el valor.
    const marca = () => { desliz.dataset.tocando = '1'; clearTimeout(desliz._t); desliz._t = setTimeout(() => { delete desliz.dataset.tocando; }, 1200); };
    ['pointerdown', 'input'].forEach((ev) => desliz.addEventListener(ev, marca));
    desliz.addEventListener('click', (e) => e.stopPropagation());
    desliz.addEventListener('input', () => {
      const t = spTab(); if (!t) return;
      t.webview.executeJavaScript(SPL_VOL(+desliz.value), true).catch(() => {});
      spUltimoUso = Date.now();
    });
  }
  clearInterval(spTimer); spTimer = setInterval(actualizaSpotify, 3000);
  actualizaSpotify();
  llenaListas(body);
}
async function llenaListas(body) {
  const cont = body.querySelector('.spl-lista'); if (!cont) return;
  const t = spTab();
  const rotulo = body.querySelector('.spl-rotulo');
  if (!t) { cont.innerHTML = '<div class="w-vacio">Conecta Spotify para ver lo que suena</div>'; return; }
  let r = null;
  try { r = await t.webview.executeJavaScript(SPL_LEE, false); } catch { /* aún cargando */ }
  const items = (r && r.items) || [];
  if (rotulo) rotulo.textContent = r && r.fuente === 'cola' ? 'A continuación'
    : r && r.fuente === 'biblioteca' ? 'Tu biblioteca' : 'Lista abierta';
  cont.innerHTML = items.map((l) => `<button class="spl-i" data-i="${l.i}" data-h="${escapeHtml(l.h || '')}"><span class="spl-t">${escapeHtml(l.t)}</span>${l.sub ? `<span class="spl-sub">${escapeHtml(l.sub)}</span>` : ''}${window.icon('play')}</button>`).join('') ||
    (r && r.fuente === 'ilegible'
      ? '<div class="w-vacio">Tienes una lista abierta pero no pude leer sus canciones — pulsa actualizar</div>'
      : '<div class="w-vacio">Abre un álbum o una lista en Spotify y aparecerán sus canciones</div>');
  cont.querySelectorAll('.spl-i').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (spDormido) { spDespierta(true); return; }
    const wv = spTab(); if (!wv) return;
    if (b.dataset.h) { splReproduce(b.dataset.h); return; }   // fila de biblioteca: se abre y suena
    wv.webview.executeJavaScript(SPL_TOCA(+b.dataset.i), true).catch(() => {});
    setTimeout(actualizaSpotify, 600);
  }));
  // Aquí SÍ hay scroll (con la barra propia de Naviris): un álbum entero no
  // cabe en la tarjeta y ocultar lo que sobra dejaba media lista invisible.
}

/* ============ Widget Cuenta (2026-08-11) ============
   Dos estados: sin sesión (invita a crearla) y con sesión (quién eres y cuándo
   sincronizó). El FAB ↗ vive fundido en la esquina (scoop) y abre el modal de
   cuenta que ya existe. Se repinta desde renderAccountPill al cambiar el estado. */
function renderUserCard(body) {
  const logged = !!(account && account.token);
  body.classList.toggle('u-on', logged);
  if (logged) {
    const nombre = account.email.split('@')[0];
    const st = store.get('cobalt.syncStamp', 0);
    body.innerHTML = `
      <div class="u-ava">${escapeHtml(nombre.charAt(0).toUpperCase())}</div>
      <div class="u-nom">${escapeHtml(nombre)}</div>
      <div class="u-mail">${escapeHtml(account.email)}</div>
      <div class="u-sync">${st ? 'Sincronizada · ' + new Date(st).toLocaleDateString('es') : 'Aún sin sincronizar aquí'}</div>
      <button class="u-go" title="Gestionar cuenta">${window.icon('arrow-up-right')}</button>`;
  } else {
    body.innerHTML = `
      <div class="u-ava u-ava-off">${window.icon('user-circle')}</div>
      <div class="u-nom">Tu cuenta</div>
      <div class="u-mail">Tema, fondo y ajustes en la nube, en cualquier equipo</div>
      <div class="u-sync">Sin sesión iniciada</div>
      <button class="u-go" title="Iniciar sesión">${window.icon('arrow-up-right')}</button>`;
  }
  body.onclick = () => showAccountModal(); // onclick y no addEventListener: se repinta y no acumula
}
function refrescaUserCards() { document.querySelectorAll('.w-user').forEach((b) => renderUserCard(b)); }

/* ============ Widget Calendario con recordatorios (2026-08-11) ============ */
const recordatorios = () => store.get('cobalt.reminders', []);
const guardaRecordatorios = (l) => store.set('cobalt.reminders', l);
function renderCalendar(body) {
  const vista = new Date(); vista.setDate(1);
  const pinta = () => {
    const y = vista.getFullYear(), m = vista.getMonth(); const hoy = new Date();
    // Mayúscula solo inicial ("Agosto de 2026"): el capitalize de CSS pondría "Agosto De 2026"
    const bruto = vista.toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const nombre = bruto.charAt(0).toUpperCase() + bruto.slice(1);
    const marca = new Set(recordatorios().map((r) => r.fecha));
    const hueco = (vista.getDay() + 6) % 7; // semana empieza en lunes
    const dias = new Date(y, m + 1, 0).getDate();
    let celdas = '';
    for (let i = 0; i < hueco; i++) celdas += '<span></span>';
    for (let d = 1; d <= dias; d++) {
      const f = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const esHoy = hoy.getFullYear() === y && hoy.getMonth() === m && hoy.getDate() === d;
      celdas += `<button class="cal-d${esHoy ? ' hoy' : ''}${marca.has(f) ? ' con' : ''}" data-f="${f}">${d}</button>`;
    }
    body.innerHTML = `
      <div class="cal-top">
        <button class="cal-nav" data-d="-1">${window.icon('chevron-left')}</button>
        <div class="cal-mes">${nombre}</div>
        <button class="cal-nav" data-d="1">${window.icon('chevron-right')}</button>
      </div>
      <div class="cal-sem"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="cal-grid">${celdas}</div>`;
    body.querySelectorAll('.cal-nav').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); vista.setMonth(vista.getMonth() + +b.dataset.d); pinta(); }));
    body.querySelectorAll('.cal-d').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); formulario(b.dataset.f); }));
  };
  const formulario = (f) => {
    const diaBruto = new Date(f + 'T00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
    const dia = diaBruto.charAt(0).toUpperCase() + diaBruto.slice(1);
    const lista = recordatorios().filter((r) => r.fecha === f).sort((a, b) => a.hora.localeCompare(b.hora));
    body.innerHTML = `
      <div class="cal-top">
        <button class="cal-nav cal-volver">${window.icon('chevron-left')}</button>
        <div class="cal-mes">${dia}</div><span></span>
      </div>
      <div class="cal-lista">${lista.map((r) => `<div class="cal-r"><span class="cal-r-h">${r.hora}</span><span class="cal-r-t">${escapeHtml(r.texto)}</span><button class="cal-r-x" data-id="${r.id}" title="Quitar">${window.icon('x-mark')}</button></div>`).join('') || '<div class="cal-nada">Sin recordatorios</div>'}</div>
      <div class="cal-form">
        <input type="time" class="cal-hora" value="09:00" />
        <input type="text" class="cal-texto" placeholder="Recordatorio…" maxlength="80" />
        <button class="cal-add" title="Añadir">${window.icon('plus')}</button>
      </div>`;
    body.querySelector('.cal-volver').addEventListener('click', (e) => { e.stopPropagation(); pinta(); });
    body.querySelectorAll('.cal-r-x').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); guardaRecordatorios(recordatorios().filter((r) => String(r.id) !== b.dataset.id)); formulario(f); }));
    const alta = () => {
      const texto = body.querySelector('.cal-texto').value.trim(); if (!texto) return;
      const l = recordatorios(); l.push({ id: Date.now(), fecha: f, hora: body.querySelector('.cal-hora').value || '09:00', texto, avisado: false });
      guardaRecordatorios(l); formulario(f);
    };
    body.querySelector('.cal-add').addEventListener('click', (e) => { e.stopPropagation(); alta(); });
    body.querySelector('.cal-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter') alta(); });
  };
  pinta();
}
/* ============ Widget "Tu música": listas del Spotify residente ============
   Lee las playlists/álbumes de la biblioteca del webview de Spotify (los
   enlaces reales de su sidebar) y al clicar navega el reproductor a la lista
   y pulsa su play grande. Sin API ni claves: es TU sesión. */
/* LA LISTA DEL WIDGET = LO QUE VIENE DESPUÉS (reescrito 2026-08-13 con el DOM
   real de Spotify delante, gracias a que Dosa abrió el CDP con su cuenta).
   Comprobado en una playlist de verdad: las pistas son [data-testid=
   "tracklist-row"] y el título vive en [data-testid="internal-track-link"];
   el resto de la fila trae el número, la duración y el artista.
   ANTES fallaba por dos cosas: se leía la PORTADA (si no hay lista abierta no
   hay pistas) y había un respaldo genérico por [role="row"] que en la portada
   casaba con sus rejillas e inventaba filas — de ahí que salieran "Título" y
   una sola canción. Ese respaldo se retira: mejor decir que no hay lista que
   enseñar basura. */
const SPL_LEE = `(async () => {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  // Al abrir una lista, sus filas tardan un momento en montarse
  for (let i = 0; i < 4; i++) {
    if (document.querySelectorAll('[data-testid="tracklist-row"]').length) break;
    await esperar(500);
  }
  const lim = (x) => (x || '').trim().replace(/\\s+/g, ' ').slice(0, 70);
  const filas = [...document.querySelectorAll('[data-testid="tracklist-row"]')];
  if (filas.length) {
    /* Se exige el ENLACE REAL de la pista (con href). Leyendo a media carga
       entraban la fila de cabecera ("Título/Álbum") y esqueletos repetidos:
       ninguno tiene href, así que con esto se caen solos. El href sirve además
       para quitar duplicados de la lista virtualizada. */
    const vistos = new Set();
    const items = filas.slice(0, 24).map((f, i) => {
      const enlace = f.querySelector('[data-testid="internal-track-link"]');
      const href = enlace && enlace.getAttribute('href');
      if (!href || vistos.has(href)) return null;
      vistos.add(href);
      const t = lim(enlace.textContent);
      if (!t) return null;
      const lineas = (f.innerText || '').split('\\n').map((x) => x.trim()).filter(Boolean);
      // Se descartan el número de pista, la duración y la marca de explícito
      const sub = lim(lineas.find((l) => l !== t && l !== 'E' && l.length > 1 &&
        !/^\\d+$/.test(l) && !/^\\d+:\\d\\d$/.test(l)) || '');
      return { t, sub, i };
    }).filter(Boolean);
    if (items.length) return { fuente: 'lista', items: items.slice(0, 20) };
  }
  // La barra de TU BIBLIOTECA, cuando no hay lista abierta pero sí barra
  const bib = document.querySelector('[data-testid="library-container"], nav[aria-label*="iblioteca"], nav[aria-label*="ibrary"]');
  if (bib) {
    const vis = new Set(); const out = [];
    bib.querySelectorAll('a[href^="/playlist/"], a[href^="/album/"], a[href^="/collection/"]').forEach((a) => {
      const t = lim(a.getAttribute('aria-label') || a.textContent);
      const h = a.getAttribute('href');
      if (t && h && !vis.has(h)) { vis.add(h); out.push({ t, sub: '', h }); }
    });
    if (out.length) return { fuente: 'biblioteca', items: out.slice(0, 12) };
  }
  const dentro = /\\/(playlist|album|artist|collection)\\//.test(location.pathname);
  return { fuente: dentro ? 'ilegible' : 'nada', items: [] };
})()`;
/* Reproducir la pista N de esa misma lista: Spotify no expone enlace de
   reproduccion, asi que se pulsa el boton de play de la fila y, si no lo
   encuentra (solo aparece al pasar el raton), se le manda un doble clic, que
   es como se reproduce una fila en su reproductor. */
const SPL_TOCA = (i) => `(() => {
  const f = document.querySelectorAll('[data-testid="tracklist-row"]')[${i}];
  if (!f) return false;
  const b = f.querySelector('button[data-testid="play-button"], button[aria-label*="Reproducir"], button[aria-label*="Play"]');
  if (b) { b.click(); return true; }
  f.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return true;
})()`;
/* VOLUMEN (peticion de Dosa): se mueve la barra del propio Spotify, asi el
   cambio se ve en su interfaz y sobrevive a los cambios de cancion. React
   ignora un value asignado a pelo: hay que usar el setter nativo y avisar. */
/* VOLUMEN. Se mueve la barra del propio Spotify (asi el cambio se ve en su
   interfaz y sobrevive al cambio de cancion). React ignora un value asignado a
   pelo: hay que usar el setter nativo y avisar con input/change. El deslizador
   manda un porcentaje ABSOLUTO, no pasos. */
const SPL_VOL = (pct) => `(() => {
  const inp = document.querySelector('[data-testid="volume-bar"] input[type=range]');
  if (!inp) return null;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const max = parseFloat(inp.max) || 1;
  const v = Math.max(0, Math.min(max, (${pct} / 100) * max));
  set.call(inp, String(v));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return Math.round((v / max) * 100);
})()`;
function splReproduce(h) {
  const wv = ensureSpotifyPlayer();
  const alCargar = () => {
    wv.removeEventListener('dom-ready', alCargar);
    // El play grande de la lista tarda en montarse (SPA): reintenta hasta 8 s
    wv.executeJavaScript(`(function(){ let n = 0; const t = setInterval(() => {
      const b = document.querySelector('[data-testid="action-bar-row"] [data-testid="play-button"], button[aria-label^="Reproducir"], button[aria-label^="Play"]');
      if (b) { b.click(); clearInterval(t); } else if (++n > 16) clearInterval(t);
    }, 500); })()`, true).catch(() => {});
  };
  wv.addEventListener('dom-ready', alCargar);
  wv.src = 'https://open.spotify.com' + h;
  toggleSpotifyPanel(true);
}

/* ============ Widget Tendencias de X (mundial) ============
   Sin API: se lee trends24.in (recopila las tendencias mundiales públicas) en
   un webview OCULTO que se destruye al terminar; caché de 20 min. Clic = buscar
   el tema en X. */
let xtCache = { t: 0, items: [], src: 'mundial' };
function scrapeOculto(url, code, timeoutMs = 15000) {
  return new Promise((res) => {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', PARTITION);
    wv.style.cssText = 'position:absolute;left:-9999px;top:0;width:1000px;height:800px;';
    let fin = false;
    const acaba = (v) => { if (fin) return; fin = true; try { wv.remove(); } catch { } res(v); };
    setTimeout(() => acaba(null), timeoutMs);
    wv.addEventListener('dom-ready', () => {
      setTimeout(() => { wv.executeJavaScript(code, false).then(acaba).catch(() => acaba(null)); }, 1500);
    });
    wv.src = url; document.body.appendChild(wv);
  });
}
const XT_LEE = `(() => {
  const out = [];
  const tarjeta = document.querySelector('.trend-card');
  if (tarjeta) tarjeta.querySelectorAll('.trend-card__list a').forEach((a) => out.push(a.textContent.trim()));
  if (!out.length) document.querySelectorAll('ol li a').forEach((a) => { if (out.length < 12) out.push(a.textContent.trim()); });
  return out.filter(Boolean).slice(0, 9);
})()`;
// x.com/explore con TU sesion: tendencias "Para ti" (el algoritmo del propio
// usuario). Sin sesion, X no pinta [data-testid=trend] y caemos a mundiales.
const XT_LEE_X = `(() => {
  const out = [];
  document.querySelectorAll('[data-testid="trend"]').forEach((t) => {
    const lineas = (t.innerText || '').split('
').map((x) => x.trim()).filter(Boolean);
    const tag = lineas.find((l) => l.startsWith('#')) || lineas[1] || lineas[0];
    if (tag && tag.length > 1 && !out.includes(tag)) out.push(tag);
  });
  return out.slice(0, 9);
})()`;
function renderXTrends(body) {
  const pinta = (items, cargando) => {
    const fuente = xtCache.src === 'ti' ? 'Para ti' : 'Mundial';
    const sinSesion = !cargando && xtCache.src !== 'ti';
    body.innerHTML = `<div class="w-head">${window.brandIcon('x') || window.icon('hash')} Tendencias<span class="xt-chip">${fuente} · X</span></div>` +
      `<div class="xt-lista">` +
      (cargando ? '<div class="w-vacio">Leyendo tendencias…</div>'
        : (items.map((t, i) => `<button class="xt-i"><span class="xt-n">${i + 1}</span><bdi class="xt-t">${escapeHtml(t)}</bdi>${window.icon('arrow-up-right')}</button>`).join('') ||
          '<div class="w-vacio">No se pudieron leer las tendencias</div>')) + `</div>` +
      // Las "Para ti" salen de TU sesión de X. Sin ella solo hay mundiales, y
      // callarlo hacía pensar que el widget estaba roto.
      (sinSesion ? `<button class="xt-login">Inicia sesión en X para ver las tuyas</button>` : '');
    body.querySelector('.xt-login')?.addEventListener('click', (e) => { e.stopPropagation(); navigateActive('https://x.com/login'); });
    body.querySelectorAll('.xt-i').forEach((b, i) => b.addEventListener('click', (e) => {
      e.stopPropagation(); navigateActive('https://x.com/search?q=' + encodeURIComponent(items[i]));
    }));
    // Sin scrollbar: solo las filas que CABEN completas en la talla actual
    requestAnimationFrame(() => {
      const cont = body.querySelector('.xt-lista'); if (!cont) return;
      const tope = cont.clientHeight;
      cont.querySelectorAll('.xt-i').forEach((f) => {
        if (f.offsetTop + f.offsetHeight > tope) f.style.display = 'none';
      });
    });
  };
  if (xtCache.items.length && Date.now() - xtCache.t < 20 * 60 * 1000) { pinta(xtCache.items); return; }
  pinta([], true);
  /* De donde salen tus tendencias, por orden (2026-08-13):
     1. TU PESTANA de X. Es la unica que tiene tu sesion de verdad.
     2. Un webview oculto en x.com/explore. Se queda como segundo intento
        porque, comprobado, X lo trata como visitante y lo manda al login —
        por eso salian las mundiales aunque tuvieras X abierto.
     3. trends24.in: las mundiales publicas, el ultimo recurso honesto. */
  const deTuPestana = () => {
    const t = tabs.find((x) => x.kind === 'web' && !x.asleep && x.webview &&
      /(^|\.)(x|twitter)\.com$/.test(hostOf(x.url) || ''));
    if (!t) return Promise.resolve(null);
    return t.webview.executeJavaScript(XT_LEE_X, false).catch(() => null);
  };
  const mundiales = () => scrapeOculto('https://trends24.in/', XT_LEE).then((mundo) => {
    if (mundo && mundo.length) xtCache = { t: Date.now(), items: mundo, src: 'mundial' };
    pinta(xtCache.items);
  });
  deTuPestana().then((mias) => {
    if (mias && mias.length >= 3) { xtCache = { t: Date.now(), items: mias, src: 'ti' }; pinta(mias); return null; }
    return scrapeOculto('https://x.com/explore', XT_LEE_X).then((tuyas) => {
      if (tuyas && tuyas.length >= 3) { xtCache = { t: Date.now(), items: tuyas, src: 'ti' }; pinta(tuyas); return null; }
      return mundiales();
    });
  });
}

/* ============ Widget Imagen (los huecos "violeta" del bento) ============
   Un marco para la imagen que el usuario quiera: se elige de disco y llena la
   tarjeta (cover). La ruta se guarda EN el widget (cobalt.widgets). */
/* Imagenes POR TEMA (2026-08-12): cada tema trae su juego empaquetado en
   src/temas/<tema>/<slot>.jpg. El widget guarda un `slot` (1..3) y solo usa
   ruta propia si el usuario elige una imagen suya (w.img manda siempre).
   El tema lo da temaActual() (arriba, lee el ajuste guardado): aqui habia una
   SEGUNDA definicion que lo deducia de las clases de <html> y, por izado, se
   comia a la primera — el arranque preguntaba el tema ANTES de poner esas
   clases, asi que siempre respondia 'oscuro' (fogonazo oscuro al abrir en
   claro/rosa y fondo del tema equivocado). */
/* Manda el SLOT (2026-08-12): un contenedor con slot ensena la foto del tema
   activo y cambia con el. `img` es solo para la imagen que elija el usuario, y
   al elegirla se retira el slot para que su foto mande. Antes era al reves, y
   los contenedores que apuntaban a un archivo suelto del disco se quedaban
   clavados en el juego de un tema (y solo existian en ese equipo). */
function imagenDeTema(w) {
  if (w.slot) return `temas/${temaActual()}/${w.slot}.jpg`;
  return w.img || '';
}
function renderImagen(body, w) {
  const elige = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const ruta = window.cobalt.filePath(f);
      if (!ruta) return;
      // GIF animado permitido: es contenido DEL USUARIO y la optimizacion es
      // decision suya (la regla anti-animacion-infinita es para NUESTRA UI).
      if (/\.gif$/i.test(ruta)) toast('GIF en bucle: se ve genial, pero consume mas GPU. Decision tuya.');
      w.img = 'file:///' + ruta.replace(/\\/g, '/'); w.slot = 0; saveWidgets(); pinta();
    };
    inp.click();
  };
  const pinta = () => {
    const src = imagenDeTema(w);
    body.classList.toggle('con-img', !!src);
    if (src) {
      body.innerHTML = `<img src="${escapeHtml(src)}" alt="" onerror="this.style.display='none'" /><button class="wi-cambia" title="Cambiar imagen">${window.icon('photo')}</button>`;
      body.querySelector('.wi-cambia').addEventListener('click', (e) => { e.stopPropagation(); elige(); });
      body.onclick = null;
    } else {
      body.innerHTML = `<div class="wi-vacio">${window.icon('photo')}<span>Elegir imagen</span></div>`;
      body.onclick = elige;
    }
  };
  pinta();
}

/* ============ Widget Correo — SOLO GMAIL (2026-08-12) ============
   Gmail se lee por su feed atom nativo con TUS cookies (lo pide main, sin
   CORS). Se retiraron las pestañas de Outlook y "+": Outlook no publica feed
   y montar su OAuth (registro en Entra, PKCE, token en disco) no compensa
   para una pestaña de widget — decisión de Dosa, 2026-08-12.
   El widget pasa a leerse como una bandeja de verdad: cabecera con la marca,
   el número de no leídos como dato grande, y filas con inicial del remitente,
   asunto y hora. Sin barras de scroll: las filas que no caben se ocultan
   (mismo criterio que el widget de Descargas). */
let mailCache = { t: 0, entradas: null, total: '0', err: null };
function mlHora(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return min + ' min';
  const hor = Math.round(min / 60);
  if (hor < 24) return hor + ' h';
  const dias = Math.round(hor / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return dias + ' d';
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
async function cargaGmail(force) {
  if (!force && mailCache.entradas && Date.now() - mailCache.t < 5 * 60 * 1000) return mailCache;
  try {
    const r = await window.cobalt.gmailFeed();
    if (!r.ok) { mailCache = { t: Date.now(), entradas: null, total: '0', err: (r.status === 401 || r.status === 403) ? 'sin-sesion' : 'error' }; return mailCache; }
    const doc = new DOMParser().parseFromString(r.xml, 'text/xml');
    const entradas = [...doc.querySelectorAll('entry')].slice(0, 8).map((e) => ({
      asunto: (e.querySelector('title')?.textContent || '').trim() || '(sin asunto)',
      de: (e.querySelector('author > name')?.textContent || '').trim() ||
          (e.querySelector('author > email')?.textContent || '').trim() || 'Desconocido',
      resumen: (e.querySelector('summary')?.textContent || '').trim(),
      fecha: Date.parse(e.querySelector('issued')?.textContent || e.querySelector('modified')?.textContent || '') || 0,
      link: e.querySelector('link')?.getAttribute('href') || 'https://mail.google.com'
    }));
    mailCache = { t: Date.now(), entradas, total: doc.querySelector('fullcount')?.textContent || '0', err: null };
  } catch { mailCache = { t: Date.now(), entradas: null, total: '0', err: 'error' }; }
  return mailCache;
}
function renderMail(body) {
  const cabecera = (girando) => `<div class="w-head">${window.brandIcon('gmail') || window.icon('inbox')}<span>Bandeja</span>
    <button class="wh-btn ml-recarga${girando ? ' ml-ocupado' : ''}" title="Actualizar">${window.icon('arrow-path')}</button></div>`;
  const fila = (e, i) => `<button class="ml-i" data-i="${i}" title="${escapeHtml(e.asunto)}">
      <span class="ml-txt">
        <span class="ml-de">${escapeHtml(e.de)}</span>
        <span class="ml-asunto">${escapeHtml(e.asunto)}</span>
        <span class="ml-resumen">${escapeHtml(e.resumen.slice(0, 90))}</span>
      </span>
      <span class="ml-hora">${escapeHtml(mlHora(e.fecha))}</span>
    </button>`;
  const pinta = async (force) => {
    body.innerHTML = cabecera(true) + '<div class="ml-hero"><span class="ml-n">·</span><span class="ml-lbl">leyendo bandeja</span></div>';
    ata();
    const m = await cargaGmail(force);
    let cuerpo;
    if (m.err === 'sin-sesion') {
      cuerpo = `<div class="w-vacio">Inicia sesión en Gmail para ver tu bandeja<button class="w-cta ml-abre">Abrir Gmail</button></div>`;
    } else if (m.err || !m.entradas) {
      cuerpo = `<div class="w-vacio">No se pudo leer la bandeja<button class="w-cta ml-recarga">Reintentar</button></div>`;
    } else if (!m.entradas.length) {
      cuerpo = `<div class="ml-limpia">${window.icon('check')}<span>Bandeja limpia</span></div>` +
        `<button class="ml-pie">Abrir Gmail ${window.icon('arrow-up-right')}</button>`;
    } else {
      const n = m.total || String(m.entradas.length);
      cuerpo = `<div class="ml-hero"><span class="ml-n">${escapeHtml(n)}</span><span class="ml-lbl">sin leer</span></div>` +
        `<div class="ml-lista">${m.entradas.map(fila).join('')}</div>` +
        `<button class="ml-pie">Abrir Gmail ${window.icon('arrow-up-right')}</button>`;
    }
    body.innerHTML = cabecera(false) + cuerpo;
    ata();
    recorta();
    function recorta() {
      const cont = body.querySelector('.ml-lista'); if (!cont) return;
      requestAnimationFrame(() => {
        const tope = cont.clientHeight;
        cont.querySelectorAll('.ml-i').forEach((f) => { if (f.offsetTop + f.offsetHeight > tope + 2) f.style.display = 'none'; });
      });
    }
    function ata() {
      body.querySelectorAll('.ml-recarga').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); pinta(true); }));
      body.querySelector('.ml-abre')?.addEventListener('click', (ev) => { ev.stopPropagation(); navigateActive('https://mail.google.com'); });
      body.querySelector('.ml-pie')?.addEventListener('click', (ev) => { ev.stopPropagation(); navigateActive('https://mail.google.com'); });
      body.querySelectorAll('.ml-i').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation(); const ent = mailCache.entradas?.[+b.dataset.i]; if (ent) navigateActive(ent.link);
      }));
    }
  };
  pinta();
}

/* ============ Widget DESCARGAS (2026-08-11) ============
   Diseño propio: ANILLO de progreso (SVG, avanza por eventos — nada infinito)
   con la descarga activa, y las últimas completadas como filas. Bebe de los
   mismos eventos download:new/update del panel. */
const dlVivo = new Map();
function anilloSVG() {
  return `<svg class="dlw-anillo" viewBox="0 0 72 72">
    <circle class="dlw-riel" cx="36" cy="36" r="31" />
    <circle class="dlw-avance" cx="36" cy="36" r="31" pathLength="100" />
  </svg>`;
}
function renderDescargasW(body) {
  body.innerHTML = `
    <div class="dlw-activa hidden">
      <div class="dlw-aro">${anilloSVG()}<div class="dlw-centro">${window.icon('download')}<span class="dlw-pct hidden"></span></div></div>
      <div class="dlw-meta"><div class="dlw-nombre"></div><div class="dlw-sub"></div></div>
    </div>
    <div class="w-head">${window.icon('download')} Hoy<span class="wh-sub dlw-cnt"></span></div>
    <div class="dlw-lista"><div class="w-vacio">Leyendo descargas…</div></div>
    <button class="w-cta dlw-ir">Panel de descargas</button>`;
  body.querySelector('.dlw-ir').addEventListener('click', (e) => { e.stopPropagation(); toggleDownloadsPage(); });
  llenaHoyDescargas(body);
  actualizaDescargasW();
}
/* Todas las descargas DE HOY (no solo la activa): filas que quepan, sin
   scrollbar; clic abre el archivo. */
function llenaHoyDescargas(body) {
  const cont = body.querySelector('.dlw-lista'); if (!cont) return;
  window.cobalt.listDownloadFiles().then((files) => {
    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const hoy = (files || []).filter((f) => f.mtime >= hoy0.getTime());
    const cnt = body.querySelector('.dlw-cnt'); if (cnt) cnt.textContent = hoy.length ? String(hoy.length) : '';
    cont.innerHTML = hoy.map((f) => {
      const ext = (f.name.split('.').pop() || 'doc').slice(0, 4);
      return `<button class="dlw-r" data-n="${escapeHtml(f.name)}"><span class="dlw-r-k">${escapeHtml(ext)}</span><span class="dlw-r-n">${escapeHtml(f.name)}</span></button>`;
    }).join('') || '<div class="w-vacio">Hoy no has descargado nada</div>';
    cont.querySelectorAll('.dlw-r').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); window.cobalt.openDownloadFile(b.dataset.n); }));
    requestAnimationFrame(() => {
      const tope = cont.clientHeight;
      cont.querySelectorAll('.dlw-r').forEach((f) => { if (f.offsetTop + f.offsetHeight > tope) f.style.display = 'none'; });
    });
  }).catch(() => { cont.innerHTML = '<div class="w-vacio">No se pudo leer la carpeta</div>'; });
}
function actualizaDescargasW() {
  const activa = [...dlVivo.values()].reverse().find((m) => m.state === 'progressing' || m.state === 'started');
  document.querySelectorAll('.w-dlw').forEach((el) => {
    const caja = el.querySelector('.dlw-activa'); if (!caja) return;
    caja.classList.toggle('hidden', !activa);
    if (!activa) return;
    const p = activa.total ? Math.round(activa.received / activa.total * 100) : null;
    el.querySelector('.dlw-nombre').textContent = activa.name || 'Descargando…';
    el.querySelector('.dlw-sub').textContent = p == null ? 'Descargando…' : p + '% — en curso';
    const pct = el.querySelector('.dlw-pct');
    pct.textContent = p == null ? '…' : p + '%';
    pct.classList.remove('hidden');
    el.querySelector('.dlw-centro svg').classList.add('hidden');
    const av = el.querySelector('.dlw-avance');
    if (av) av.style.strokeDashoffset = String(100 - (p ?? 30));
  });
}


/* ============ Widget MOOVIN (2026-08-12) ============
   Acceso a la biblioteca privada de IRIS (antes "Cine de IRIS"): Naviris ya
   pone el pase solo al entrar (cine:pase en main), asi que el widget es la
   puerta — cartel con play y entrada directa. */
function renderMoovinW(body) {
  body.innerHTML = `
    <div class="mv-cartel">${window.icon('tv-minimal')}</div>
    <div class="mv-meta"><div class="mv-tit">Moovin</div><div class="mv-sub">Tu biblioteca privada</div></div>
    <button class="mv-play" title="Entrar">${window.icon('play')}</button>`;
  const abre = (e) => { e?.stopPropagation(); navigateActive('https://iris.it.com/cine/'); };
  body.querySelector('.mv-play').addEventListener('click', abre);
  body.addEventListener('click', abre);
}

/* ============ Widget MONITOR (2026-08-12) ============
   RAM del sistema y consumo de Naviris (CPU/RAM), en barras. Sondeo cada 3 s
   solo con el hub visible; se apaga solo si el widget desaparece. */
let monTimer = null;
function renderMonitorW(body) {
  body.innerHTML = `
    <div class="w-head">${window.icon('res-scale')} Monitor</div>
    <div class="mon-fila"><span class="mon-k">RAM</span><div class="mon-riel"><i class="mon-ram"></i></div><span class="mon-v mon-ram-v">—</span></div>
    <div class="mon-fila"><span class="mon-k">CPU</span><div class="mon-riel"><i class="mon-cpu"></i></div><span class="mon-v mon-cpu-v">—</span></div>
    <div class="mon-pie"><span class="mon-app">Naviris —</span><span class="mon-proc"></span></div>
    <div class="mon-acc">
      <button class="mon-b mon-juego" title="Duerme pestañas de fondo y silencia el ruido">${window.icon('play')}<span>Modo juego</span></button>
      <button class="mon-b mon-limpia" title="Liberar memoria de pestañas dormidas">${window.icon('arrow-path')}<span>Liberar</span></button>
    </div>`;
  body.querySelector('.mon-juego').addEventListener('click', (e) => { e.stopPropagation(); modoJuego(); });
  body.querySelector('.mon-limpia').addEventListener('click', (e) => { e.stopPropagation(); liberaMemoria(); });
  clearInterval(monTimer); monTimer = setInterval(actualizaMonitor, 3000); // fresco: un tick durante el re-render lo apagaba
  requestAnimationFrame(actualizaMonitor); // el body aun no esta en el DOM
}
async function actualizaMonitor() {
  if (!widgets.some((w) => w.type === 'monitor')) { clearInterval(monTimer); monTimer = null; return; }
  const cajas = document.querySelectorAll('.w-mon');
  if (!els.hub.classList.contains('active')) return;
  const st = await window.cobalt.sysStats().catch(() => null); if (!st) return;
  const gbApp = st.appMb >= 1024 ? (st.appMb / 1024).toFixed(1) + ' GB' : st.appMb + ' MB';
  cajas.forEach((el) => {
    el.querySelector('.mon-ram').style.width = st.ramUso + '%';
    el.querySelector('.mon-ram-v').textContent = st.ramUso + '%';
    el.querySelector('.mon-cpu').style.width = Math.min(100, st.appCpu) + '%';
    el.querySelector('.mon-cpu-v').textContent = (st.appCpu < 10 ? st.appCpu.toFixed(1) : Math.round(st.appCpu)) + '%';
    el.querySelector('.mon-app').textContent = 'Naviris ' + gbApp;
    el.querySelector('.mon-proc').textContent = st.procesos + ' procesos';
  });
}

/* Modo juego: duerme TODAS las pestañas de fondo (libera su renderer) y
   silencia lo que suene. La activa se respeta. Reversible: al volver a una
   pestaña, se recarga sola (mecanica de "dormida" que ya existia). */
function modoJuego() {
  let n = 0;
  for (const t of tabs) {
    if (t.id === activeId || t.asleep || !t.webview) continue;
    try { t.webview.setAudioMuted(true); } catch { }
    t.sleptUrl = t.url; t.asleep = true;
    try { t.webview.src = 'about:blank'; } catch { }
    n++;
  }
  renderTabs(); saveSession();
  toast(n ? `Modo juego: ${n} pestaña${n > 1 ? 's' : ''} dormida${n > 1 ? 's' : ''}` : 'Modo juego: no había pestañas de fondo');
  actualizaMonitor();
}
function liberaMemoria() {
  for (const t of tabs) if (t.asleep && t.webview) { try { t.webview.src = 'about:blank'; } catch { } }
  toast('Memoria liberada');
  setTimeout(actualizaMonitor, 800);
}

/* ============ Widget PORTAPAPELES (2026-08-12) ============
   Historial de lo copiado (solo texto, local, max 20). Clic vuelve a copiar;
   se vigila el portapapeles cada 1,5 s mientras el hub esta visible. */
let clipTimer = null, clipUltimo = '';
const clipHist = () => store.get('cobalt.clip', []);
function renderClipW(body) {
  body.innerHTML = `
    <div class="w-head">${window.icon('clipboard')} Portapapeles<button class="wh-btn clip-x" title="Vaciar">${window.icon('x-mark')}</button></div>
    <div class="clip-lista"></div>`;
  body.querySelector('.clip-x').addEventListener('click', (e) => { e.stopPropagation(); store.set('cobalt.clip', []); pintaClip(); });
  clearInterval(clipTimer); clipTimer = setInterval(vigilaClip, 1500);
  requestAnimationFrame(vigilaClip);
}
async function vigilaClip() {
  if (!widgets.some((w) => w.type === 'clip')) { clearInterval(clipTimer); clipTimer = null; return; }
  if (!els.hub.classList.contains('active')) return;
  const t = (await window.cobalt.clipRead().catch(() => '') || '').trim();
  if (t && t !== clipUltimo) {
    clipUltimo = t;
    const l = clipHist().filter((x) => x !== t); l.unshift(t);
    store.set('cobalt.clip', l.slice(0, 20));
  }
  pintaClip();
}
function pintaClip() {
  const l = clipHist();
  document.querySelectorAll('.w-clip .clip-lista').forEach((cont) => {
    cont.innerHTML = l.map((t, i) => `<button class="clip-i" data-i="${i}"><span>${escapeHtml(t.slice(0, 90))}</span></button>`).join('') ||
      '<div class="w-vacio">Lo que copies aparecera aqui</div>';
    cont.querySelectorAll('.clip-i').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); const t = l[+b.dataset.i]; clipUltimo = t;
      window.cobalt.clipWrite(t); toast('Copiado de nuevo');
    }));
    requestAnimationFrame(() => {
      const tope = cont.clientHeight;
      cont.querySelectorAll('.clip-i').forEach((f) => { if (f.offsetTop + f.offsetHeight > tope) f.style.display = 'none'; });
    });
  });
}

/* ============ Widget NOTAS mejorado (2026-08-12) ============
   Lista de tareas con tachado + texto libre debajo; todo local. */
const notasLista = () => store.get('cobalt.notas2', []);
function renderNotasW(body) {
  const pinta = () => {
    const l = notasLista();
    body.innerHTML = `
      <div class="w-head">${window.icon('pencil-square')} Notas<span class="wh-sub">${l.filter((x) => !x.ok).length || ''}</span></div>
      <div class="nt-lista">${l.map((x, i) => `
        <label class="nt-i${x.ok ? ' ok' : ''}"><input type="checkbox" data-i="${i}"${x.ok ? ' checked' : ''} /><span class="nt-box">${window.icon('check')}</span><span class="nt-t">${escapeHtml(x.t)}</span><button class="nt-x" data-i="${i}" title="Quitar">${window.icon('x-mark')}</button></label>`).join('')}</div>
      <div class="nt-add"><input type="text" placeholder="Nueva tarea…" maxlength="120" /><button title="Añadir">${window.icon('plus')}</button></div>`;
    const alta = () => {
      const inp = body.querySelector('.nt-add input'); const t = inp.value.trim(); if (!t) return;
      const l2 = notasLista(); l2.push({ t, ok: false }); store.set('cobalt.notas2', l2); pinta();
      body.querySelector('.nt-add input').focus();
    };
    body.querySelector('.nt-add button').addEventListener('click', (e) => { e.stopPropagation(); alta(); });
    body.querySelector('.nt-add input').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') alta(); });
    body.querySelectorAll('.nt-i input').forEach((ch) => ch.addEventListener('change', (e) => {
      e.stopPropagation(); const l2 = notasLista(); l2[+ch.dataset.i].ok = ch.checked; store.set('cobalt.notas2', l2); pinta();
    }));
    body.querySelectorAll('.nt-x').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault(); const l2 = notasLista(); l2.splice(+b.dataset.i, 1); store.set('cobalt.notas2', l2); pinta();
    }));
  };
  pinta();
}

/* ============ Widget VENTANA PRIVADA (2026-08-11) ============
   Un solo boton, como icono de app: cuadrado 1x1 en violeta con el candado
   grande. Clic = ventana privada nueva. */
function renderPrivadaW(body) {
  body.innerHTML = `<div class="pv-ico">${window.icon('hat-glasses')}</div><span class="pv-t">Privada</span>`;
  body.addEventListener('click', () => window.cobalt.newPrivateWindow());
}

/* ============ Widget TARJETAS / WALLET (2026-08-11) ============
   Una mini TARJETA de crédito con el degradado del realce: chip, puntos y el
   candado de Windows Hello. No muestra NINGÚN dato real (los datos viven
   cifrados y detrás de Hello); el botón abre el gestor del panel. */
function renderWalletW(body) {
  body.innerHTML = `
    <div class="wl-tarjeta">
      <div class="wl-chip"></div>
      <div class="wl-puntos"><span>••••</span><span>••••</span><span>••••</span></div>
      <div class="wl-marca">Naviris</div>
    </div>
    <div class="wl-pie">
      <span class="wl-hello">${window.icon('key')} Windows Hello</span>
      <button class="wl-ver">Ver tarjetas</button>
    </div>`;
  const abre = (e) => {
    e?.stopPropagation();
    els.sbPasswords.click();           // abre el panel de contraseñas…
    setTimeout(() => switchPwTab(true), 60); // …y salta a la pestaña Tarjetas
  };
  body.querySelector('.wl-ver').addEventListener('click', abre);
  body.addEventListener('click', abre);
}

/* Aviso de recordatorios: chequeo cada 30 s; toast siempre y notificación si se puede */
setInterval(() => {
  const l = recordatorios(); const ahora = new Date(); let toca = false;
  for (const r of l) {
    if (r.avisado) continue;
    if (new Date(`${r.fecha}T${r.hora || '09:00'}`) <= ahora) {
      r.avisado = true; toca = true;
      toast(`Recordatorio: ${r.texto}`);
      try { new Notification('Naviris — Recordatorio', { body: r.texto }); } catch { /* sin permiso: queda el toast */ }
    }
  }
  if (toca) guardaRecordatorios(l);
}, 30000);

/* ============ Pastilla de clima (esquina del hub, como Opera GX) ============ */
async function loadWeatherPill() {
  const el = document.getElementById('hub-weather'); if (!el) return;
  if (widgets.some((x) => x.type === 'weather')) { el.classList.add('hidden'); return; }
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
    // Un fondo por tema (dev.49). `hubBg` se mantiene para las versiones que
    // aun sincronizan el fondo unico: viaja el del tema activo.
    hubBg: store.get(bgThemeKey(), null),
    hubBgs: Object.fromEntries(TEMAS.map((t) => [t, store.get(bgThemeKey(t), null)]).filter(([, v]) => v != null))
  };
}
async function applySyncData(d) {
  if (!d) return;
  if (Array.isArray(d.bookmarks)) { store.set('cobalt.bookmarks2', d.bookmarks); bookmarks = d.bookmarks; }
  if (Array.isArray(d.dials)) { store.set('cobalt.dials', d.dials); dials = d.dials; }
  if (Array.isArray(d.widgets)) { store.set('cobalt.widgets', d.widgets); widgets = d.widgets; }
  if (typeof d.notes === 'string') store.set('cobalt.notes', d.notes);
  if (d.hubBgs && typeof d.hubBgs === 'object') for (const t of TEMAS) if (d.hubBgs[t]) store.set(bgThemeKey(t), d.hubBgs[t]);
  if (d.hubBg && !(d.hubBgs && d.hubBgs[temaActual()])) applyBackground(d.hubBg);
  else if (d.hubBgs) applyBackground(store.get(bgThemeKey(), defaultBgTema()));
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
  refrescaUserCards(); // el widget de cuenta del hub refleja el mismo estado
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
/* Los menús de la barra del hub son EXCLUYENTES (2026-08-12, Dosa): abrir uno
   cierra los demás, para saltar de Temas a Aspecto con un solo clic en vez de
   cerrar a mano. Devuelve si habia algo abierto (lo usa Escape). */
function cierraMenusHub(excepto) {
  let habia = false;
  const pop = document.getElementById('temas-pop'), bt = document.getElementById('hub-temas');
  if (excepto !== 'temas' && pop && !pop.classList.contains('hidden')) {
    pop.classList.add('hidden'); if (bt) bt.classList.remove('on'); habia = true;
  }
  if (excepto !== 'aspecto' && els.customizePanel && !els.customizePanel.classList.contains('hidden')) {
    els.customizePanel.classList.add('hidden'); habia = true;
  }
  return habia;
}
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
    cierraMenusHub('temas');
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
  // En reflujo lo que se ve NO es tu maqueta, sino una recolocación temporal
  // por falta de ancho: componer ahí guardaría posiciones sin sentido.
  if (els.hub.classList.contains('reflujo')) {
    toast('Agranda la ventana para componer el hub');
    return;
  }
  const on = els.hub.classList.toggle('editing'); els.hubEdit.classList.toggle('on', on);
  els.widgetPalette.classList.toggle('hidden', !on); cierraMenusHub();
  els.hubEdit.querySelector('.lbl').textContent = on ? 'Listo' : 'Editar';
  if (on) renderPalette();
});
function renderPalette() {
  els.paletteList.innerHTML = '';
  for (const key in WIDGET_TYPES) {
    const w = WIDGET_TYPES[key]; const b = document.createElement('button'); b.className = 'pal-item';
    b.innerHTML = `${window.icon(w.icon)}<span>${w.name}</span>`;
    b.addEventListener('click', () => {
      // comprobar HUECO antes de crear: sin sitio se avisa (antes se creaba
      // una copia invisible en silencio por cada clic)
      const def = (TAMANOS[key] || [[2, 1]])[0];
      const tw = Math.min(def[0], ultimoCols), th = def[1];
      const occ = new Set(); delBucket().forEach((x) => ocupa(occ, x));
      const pos = primerHueco(occ, tw, th, ultimoCols);
      if (!pos) { toast(`No hay un hueco de ${tw}×${th} libre para ${w.name} — libera celdas`); return; }
      const nuevo = { id: 'w' + (++widgetSeq) + Date.now(), type: key, col: pos.col, row: pos.row, w: tw, h: th };
      widgets.push(nuevo); fijaGeo(nuevo);
      saveWidgets(); renderHub();
    });
    els.paletteList.appendChild(b);
  }
}
els.hubCustomize.addEventListener('click', (e) => {
  e.stopPropagation();
  const show = els.customizePanel.classList.contains('hidden');
  cierraMenusHub('aspecto');
  els.customizePanel.classList.toggle('hidden', !show);
  els.widgetPalette.classList.add('hidden');
  if (show) renderBgPresets();
});
// Clic fuera: el panel de aspecto se cierra como el de temas.
document.addEventListener('click', (e) => {
  if (els.customizePanel.classList.contains('hidden')) return;
  if (!els.customizePanel.contains(e.target) && !els.hubCustomize.contains(e.target)) els.customizePanel.classList.add('hidden');
});

// Fondos oscuros pero con tinte de color distinguible (gris oscuro por defecto)
const BACKGROUNDS = [
  // Predeterminado: CARBÓN puro. El lima es color de ESTADO (hover, activo),
  // NO tiñe el fondo. La textura la pone el grano de #hub::after.
  'radial-gradient(130% 100% at 80% 0%, #1c1c1c 0%, #121212 45%, #0a0a0a 100%)',
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
  // Predeterminado claro: blanco con tinte rojo-naranja suave (la gama del
  // logo claro de Naviris)
  'radial-gradient(120% 90% at 75% 5%, #ffe7dd 0%, #f6efec 45%, #eceef2 100%)',
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
  // El primer fondo rosa (malla luminosa) se retiro por decision de Dosa
  // (2026-08-12): este slot toma el ULTIMO fondo (Aurora rosa), que pasa a ser
  // el predeterminado del tema rosa.
  'linear-gradient(135deg, #fce4f2 0%, #ecdcf4 45%, #fdeff6 100%)',
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
/* Fondo por defecto: SIEMPRE el degradado plano del tema (2026-08-12, Dosa).
   Las fotos de src/temas/<tema>/ NO son fondos y nunca lo fueron: son el
   material de los WIDGETS DE IMAGEN, que cargan la del tema activo por su
   `slot` (ver imagenDeTema). Se devuelve la identidad canonica y bgForTheme
   la traduce al juego del tema (grafito en oscuro, gris claro, Aurora rosa). */
function defaultBgTema() { return BACKGROUNDS[0]; }
// Un fondo de temas/ guardado como fondo del hub es de la version que se
// equivoco: se descarta y el tema vuelve a su degradado.
const esFotoDeTema = (v) => typeof v === 'string' && /url\("?temas\//.test(v);
// Clave de store por tema: cada tema recuerda su propio fondo.
function bgThemeKey(tema) { return 'cobalt.hubBg.' + (tema || temaActual()); }
/* Hasta dev.48 el fondo era UNO para toda la app (cobalt.hubBg). Esa clave se
   retira sin heredarla: cada tema arranca con SU predeterminado (el primero de
   su paleta, el mas oscuro en el tema oscuro) y desde ahi se elige. Tiene que
   correr ANTES del primer applyTheme(), que ya escribe la clave del tema. */
function migraFondoPorTema() {
  for (const t of TEMAS) if (esFotoDeTema(store.get(bgThemeKey(t), null))) store.del(bgThemeKey(t));
  store.del('cobalt.hubBg');
}

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
  if (esFotoDeTema(v)) v = BACKGROUNDS[0];     // las fotos de los widgets no son fondo (ni llegando por sincronización)
  // Identidades viejas del fondo predeterminado (antes de la gama cálida):
  // quien lo tenía elegido pasa al predeterminado nuevo, no a "fondo custom"
  if (v === 'linear-gradient(160deg, #26262d 0%, #191920 100%)' || v === 'linear-gradient(160deg, #fdf1f6 0%, #f6dde9 100%)'
    || v === 'radial-gradient(110% 85% at 70% 8%, #262218 0%, #16140f 52%, #0e0d0b 100%)'
    || v === 'radial-gradient(110% 85% at 70% 8%, #232323 0%, #141414 52%, #0d0d0d 100%)'
    || v === 'linear-gradient(160deg, #eceef2 0%, #dfe2e8 100%)'
    || v === 'radial-gradient(130% 100% at 80% 0%, #322752 0%, #1c1730 45%, #100d17 100%)'
    || v === 'radial-gradient(130% 100% at 80% 0%, #23260f 0%, #141508 42%, #0a0a06 100%)') v = BACKGROUNDS[0];
  let i = BACKGROUNDS_LIGHT.indexOf(v);
  if (i < 0) i = BACKGROUNDS_ROSA.indexOf(v);
  if (i >= 0) v = BACKGROUNDS[i]; // se guarda siempre el valor oscuro como identidad
  els.hub.style.setProperty('--hub-bg', bgForTheme(v));
  store.set(bgThemeKey(), v);
  // Liquid glass Fase 2: la refracción SVG solo vale la pena sobre una FOTO
  // (un degradado liso no tiene textura que refractar) → se enciende sola
  // cuando el fondo es una imagen del usuario (valor url(...)).
  els.hub.classList.toggle('refract', typeof v === 'string' && v.startsWith('url('));
  ajustarVidrioAlFondo(v);
  generaFondoBlur();
  lgProgramar(); // el motor de lentes pone o quita los filtros por pieza
  document.querySelectorAll('.bg-thumb').forEach((t) => t.classList.toggle('sel', t.dataset.bg === v));
}
/* El tinte del vidrio sigue al FONDO, no al tema (2026-08-11): sobre una foto
   clara, el cristal ahumado del tema oscuro se veía como manchas negras (lo
   detectó Dosa con su fondo rojo). Se mide el brillo medio de la foto en un
   canvas de 32×32 y #hub.bg-claro cambia los tokens del vidrio al juego blanco
   (definido en styles.css). Con degradados del tema, la clase se quita. */
function ajustarVidrioAlFondo(v) {
  const m = typeof v === 'string' && v.match(/url\("?([^")]+)"?\)/);
  if (!m) { els.hub.classList.remove('bg-claro'); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
      const d = x.getImageData(0, 0, 32, 32).data; let v = 0;
      // Brillo HSV (max r/g/b) → TINTE del vidrio (bg-claro): un rojo vivo
      // "se ve" claro (V≈.65) aunque su luminancia sea baja. El texto flotante
      // ya no mide nada: lleva halo oscuro que funciona sobre cualquier foto.
      for (let i = 0; i < d.length; i += 4) v += Math.max(d[i], d[i + 1], d[i + 2]);
      els.hub.classList.toggle('bg-claro', v / (d.length / 4) / 255 > .48);
    } catch { /* canvas contaminado u otro fallo: se queda el vidrio del tema */ }
  };
  img.onerror = () => els.hub.classList.remove('bg-claro');
  img.src = m[1];
}

/* ===== GRANO SIN COSTURAS (2026-08-11) =====
   El grano era un mosaico SVG de 120px: sus juntas, invisibles a pelo, se
   convierten en LINEAS al pasar por el blur del vidrio (lo vio Dosa varias
   veces). Ahora el ruido se genera AL TAMANO EXACTO del hub — una sola pieza,
   nada que empalmar. El data-URI es minusculo (solo cambian W/H). */
/* ===== VIDRIO SIN backdrop-filter (2026-08-11, fin de las lineas) =====
   En la GPU de este equipo, el blur en vivo de Chromium trocea el backdrop en
   teselas y sus juntas aparecen como lineas blancas en cada cristal (+lag).
   Solucion definitiva: el fondo del hub es NUESTRO y estatico — se genera UNA
   copia ya desenfocada (canvas) y los cristales la muestran alineada por
   viewport (background-attachment: fixed). Cero blur en vivo. */
function generaFondoBlur() {
  const v = store.get(bgThemeKey(), defaultBgTema());
  const m = typeof v === 'string' && v.match(/url\("?([^")]+)"?\)/);
  if (!m) { els.hub.style.setProperty('--hub-bg-blur', bgForTheme(v)); return; } // un degradado ya es suave
  const img = new Image();
  img.onload = () => {
    const W = Math.max(640, Math.round(window.innerWidth / 2));
    const H = Math.max(360, Math.round(window.innerHeight / 2));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.filter = 'blur(22px) saturate(1.6)';
    const r = Math.max(W / img.width, H / img.height);
    const dw = img.width * r, dh = img.height * r;
    x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    els.hub.style.setProperty('--hub-bg-blur', `url("${c.toDataURL('image/jpeg', 0.72)}")`);
  };
  img.onerror = () => els.hub.style.setProperty('--hub-bg-blur', 'none');
  img.src = m[1];
}

function pintaGrano() {
  const w = Math.ceil(window.innerWidth);
  const h = Math.ceil(window.innerHeight);
  if (!w || !h) return;
  const svg = `%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='${w}' height='${h}' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E`;
  els.hub.style.setProperty('--grano-vivo', `url("data:image/svg+xml,${svg}")`);
}
let granoTimer = null;
window.addEventListener('resize', () => { clearTimeout(granoTimer); granoTimer = setTimeout(() => {
  pintaGrano(); generaFondoBlur();
  const m = medidasMalla();
  if (m.cw !== CELDA_W || m.cols !== ultimoCols || !!m.reflujo !== els.hub.classList.contains('reflujo')) renderHub();
}, 250); });
pintaGrano();
generaFondoBlur();

/* ===== MOTOR DE LENTES · liquid glass real (2026-08-11) =====
   Investigación (kube.io / Liquid Glass de Apple): la refracción de un cristal
   vive SOLO en la banda del bisel del canto — el interior es plano (gris 128 en
   el mapa = desplazamiento cero). Desplazar toda la superficie con ruido (lo
   que hacíamos) da el efecto "derretido". Aquí se genera un mapa de
   desplazamiento POR FORMA (SDF de rectángulo redondeado, banda con perfil
   suavizado) y se aplica con backdrop-filter: url(#filtro) — Chromium lo
   soporta. Solo activo con foto de fondo (#hub.refract); con degradados, las
   piezas usan su backdrop-filter de CSS (blur + saturate). */
const LG = { host: null, cache: new Map(), n: 0, mo: null, ro: null, prog: false };
function lgMapa(w, h, r, band) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); const img = x.createImageData(w, h);
  const bx = w / 2 - r, by = h / 2 - r;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const px = i + .5 - w / 2, py = j + .5 - h / 2;
    const qx = Math.abs(px) - bx, qy = Math.abs(py) - by;
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
    const d = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r; // SDF: <0 dentro
    let vx = 0, vy = 0; const t = -d;
    if (d <= 0 && t < band) {
      let nx, ny;
      if (ax > 0 || ay > 0) { const L = Math.hypot(ax, ay) || 1; nx = Math.sign(px) * ax / L; ny = Math.sign(py) * ay / L; }
      else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
      const u = 1 - t / band; const m = u * u * (3 - 2 * u); // smoothstep hacia el borde
      vx = nx * m; vy = ny * m; // hacia FUERA: lente convexa (el fondo se comprime en el canto)
    }
    const k = (j * w + i) * 4;
    img.data[k] = 128 + vx * 127; img.data[k + 1] = 128 + vy * 127; img.data[k + 2] = 128; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL();
}
function lgFiltro(el) {
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!w || !h) return;
  let r = parseFloat(getComputedStyle(el).borderRadius) || 12; r = Math.min(r, w / 2, h / 2);
  const band = Math.max(6, Math.min(14, Math.round(Math.min(w, h) * .22)));
  const key = w + 'x' + h + 'r' + Math.round(r);
  let id = LG.cache.get(key);
  if (!id) {
    id = 'lg-' + (++LG.n);
    const SVG = 'http://www.w3.org/2000/svg';
    const f = document.createElementNS(SVG, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('filterUnits', 'userSpaceOnUse');
    f.setAttribute('x', 0); f.setAttribute('y', 0); f.setAttribute('width', w); f.setAttribute('height', h);
    // sRGB OBLIGATORIO: en linearRGB el 128 del mapa deja de ser "quieto" y todo se desplaza
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = '<feImage href="' + lgMapa(w, h, Math.round(r), band) + '" x="0" y="0" width="' + w + '" height="' + h + '" result="map"/>'
      + '<feGaussianBlur in="SourceGraphic" stdDeviation="2" result="soft"/>'
      + '<feDisplacementMap in="soft" in2="map" scale="26" xChannelSelector="R" yChannelSelector="G" result="ref"/>'
      + '<feColorMatrix in="ref" type="saturate" values="1.6"/>';
    LG.host.appendChild(f);
    LG.cache.set(key, id);
  }
  el.style.webkitBackdropFilter = 'url(#' + id + ')';
  el.style.backdropFilter = 'url(#' + id + ')';
}
function lgAplicar() {
  LG.prog = false;
  if (!LG.host) {
    const SVG = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('width', 0); s.setAttribute('height', 0);
    s.setAttribute('aria-hidden', 'true'); s.style.position = 'absolute';
    LG.host = document.createElementNS(SVG, 'defs'); s.appendChild(LG.host);
    document.body.appendChild(s);
    LG.ro = new ResizeObserver(() => lgProgramar());
    LG.mo = new MutationObserver(() => lgProgramar());
    LG.mo.observe(els.hub, { childList: true, subtree: true });
  }
  // El motor ya no aplica filtros (backdrop-filter troceaba en esta GPU):
  // ahora ANCLA la capa desenfocada de cada cristal a coordenadas de viewport
  // (--vidrio-pos = -x -y del elemento). Determinista en cualquier compositor.
  els.hub.style.setProperty('--vidrio-tam', `${window.innerWidth}px ${window.innerHeight}px`);
  LG.ro.disconnect();
  const piezas = els.hub.querySelectorAll('.d-tile, #hub-search, .hub-pill, .hub-fab, #hub-addons, .w-clock, .w-sp, .w-user, .w-card:not(.w-shortcuts):not(.w-wx):not(.w-mail)');
  piezas.forEach((el) => {
    el.style.webkitBackdropFilter = ''; el.style.backdropFilter = ''; // restos del motor viejo
    const r = el.getBoundingClientRect();
    el.style.setProperty('--vidrio-pos', `${-Math.round(r.left)}px ${-Math.round(r.top)}px`);
    LG.ro.observe(el);
  });
}
function lgProgramar() {
  if (LG.prog) return; LG.prog = true;
  requestAnimationFrame(lgAplicar);
}
function renderBgPresets() {
  els.bgPresets.innerHTML = '';
  // Solo degradados: el aspecto del hub es plano. Las fotos de src/temas/ son
  // de los widgets de imagen y no se ofrecen aqui.
  const saved = store.get(bgThemeKey(), defaultBgTema());
  // Sin repetidos: en rosa, el primero y el ultimo son la misma Aurora, y se
  // veian dos miniaturas identicas. Se pinta la primera vez que aparece.
  const vistos = new Set();
  for (const bg of BACKGROUNDS) {
    const pintado = bgForTheme(bg);
    if (vistos.has(pintado)) continue;
    vistos.add(pintado);
    const th = document.createElement('div');
    th.className = 'bg-thumb' + (saved === bg ? ' sel' : '');
    th.style.background = pintado; th.dataset.bg = bg;
    th.addEventListener('click', () => applyBackground(bg));
    els.bgPresets.appendChild(th);
  }
}
/* Fondo propio A RESOLUCIÓN COMPLETA: el archivo se copia a userData y el hub
   apunta a él. Antes se reescalaba a 1920 px y se guardaba como JPEG dentro de
   localStorage (que no aguanta un 4K), y por eso los fondos se veían peor que
   el original — lo detectó Dosa el 2026-08-11. */
/* Fondo propio: se abre el diálogo del SISTEMA (el <input type="file"> no
   disparaba 'change' al reelegir el mismo archivo y el panel se quedaba
   colgado — lo reportó Dosa el 2026-08-11). Resolución completa: el archivo
   se copia a userData y el hub apunta a él. */
async function elegirFondoPropio() {
  const r = await window.cobalt.pickWallpaper();
  if (r?.canceled) return;
  if (r?.ok) { applyBackground(`url("${r.url}") center/cover no-repeat`); toast('Fondo actualizado'); return; }
  toast(r?.message || 'No se pudo usar esa imagen');
}
document.querySelector('.wp-custom')?.addEventListener('click', (e) => { e.preventDefault(); elegirFondoPropio(); });

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
window.cobalt.onDownloadNew((m) => { dlVivo.set(m.id, m); upsertDownload(m); actualizaDescargasW(); });
window.cobalt.onDownloadUpdate((m) => { dlVivo.set(m.id, m); actualizaDescargasW(); if (m.state === 'completed') document.querySelectorAll('.w-dlw').forEach((el) => llenaHoyDescargas(el)); upsertDownload(m); if (m.state === 'completed') { toast('Descargado: ' + m.name); els.sbDownloads.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 400 }); if (els.dlPage.classList.contains('active')) window.cobalt.listDownloadFiles().then((f) => { dlpFiles = f; renderDownloadsPage(); }); } });
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
    anclarPanelIzq(els.lootPanel, els.sbLoot); // pegado a SU botón, no arriba del todo
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
function anclarPanelIzq(panel, btn) {
  const r = btn.getBoundingClientRect();
  panel.style.top = '0px';
  const h = panel.offsetHeight;
  panel.style.top = Math.max(8, Math.min(Math.round(r.top - 8), window.innerHeight - h - 12)) + 'px';
  panel.style.left = Math.round(r.right + 12) + 'px';
}
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
/* Resoluciones en REJILLA de fichas (2026-08-11): la lista larga se salía de
   la pantalla y era un muro de texto. Cada resolución es una ficha compacta
   con su nombre, medidas y proporción; la activa va en el realce. */
function renderResList() {
  els.resList.innerHTML = '';
  for (const r of RESOLUTIONS) {
    const sel = resMode ? resMode.w === r.w && resMode.h === r.h : r.w === 0;
    const b = document.createElement('button');
    b.className = 'rp-card' + (sel ? ' sel' : '');
    const prop = r.w ? (Math.abs(r.w / r.h - 16 / 9) < 0.02 ? '16:9' : Math.abs(r.w / r.h - 16 / 10) < 0.02 ? '16:10' : Math.abs(r.w / r.h - 4 / 3) < 0.02 ? '4:3' : '') : '';
    b.innerHTML = `<span class="rp-dim">${r.w ? r.w + '×' + r.h : 'Nativa'}</span>` +
      `<span class="rp-name">${escapeHtml(r.label)}</span>` +
      (prop ? `<span class="rp-prop">${prop}</span>` : '');
    b.title = r.note || r.label;
    b.addEventListener('click', () => { resMode = r.w ? r : null; applyResponsive(); renderResList(); });
    els.resList.appendChild(b);
  }
}
els.sbRes.addEventListener('click', (e) => { e.stopPropagation(); const open = els.resPop.classList.contains('hidden'); els.resPop.classList.toggle('hidden'); els.sbRes.classList.toggle('open', open); if (open) { renderResList(); anclarPop(els.resPop, els.sbRes); } });
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
// El botón de inicio de la navbar se retiró (2026-08-11): estaba duplicado
// con el del sidebar (#sb-home), que es el que manda.
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
/* Aviso persistente de version nueva (2026-08-13). En una ventana baja el menu
   se salia de la pantalla y "Buscar actualizaciones" quedaba fuera de alcance:
   ademas de arreglar el menu, conviene que la actualizacion se VEA sin tener
   que ir a buscarla. */
function marcaActualizacion(version) {
  const boton = $('#nav-menu');
  if (boton) { boton.classList.add('hay-update'); boton.title = 'Menú — hay una versión nueva (' + version + ')'; }
  const pop = $('#menu-pop'), entrada = $('#menu-update');
  if (pop && entrada && pop.firstElementChild !== entrada) {
    entrada.classList.add('destacado');
    entrada.textContent = 'Actualizar a la ' + version;
    pop.insertBefore(entrada, pop.firstElementChild);
  }
}
window.cobalt.onUpdateStatus((s) => {
  if (s.state === 'available') {
    // Solo se descarga si el usuario eligió línea; el aviso silencioso de arranque solo notifica
    if (!updChosen) {
      // Un toast se va solo y el usuario se queda sin enterarse. Ademas se
      // marca el boton del menu con un punto, que no caduca, y la entrada de
      // actualizar sube ARRIBA del todo mientras haya version nueva.
      marcaActualizacion(s.version);
      if ($('#about-modal').classList.contains('hidden')) toast('Nueva versión de Naviris disponible (menú → Buscar actualizaciones)');
      return;
    }
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
  if (e.key === 'Escape') {
    // Escape sale de lo que este abierto ANTES de parar la carga: primero los
    // menus del hub, luego la pagina de Addons (se vuelve al hub). Cerrar lo
    // que estorba no depende de donde este el foco — al abrir una pestaña el
    // foco va a la barra de direcciones y, con el filtro de "escribiendo",
    // Escape no cerraba nada.
    if (cierraMenusHub()) return;
    if (adEls.page.classList.contains('active')) { hideAddonsPage(); els.hub.classList.add('active'); return; }
    if (!escribiendo) { pararCarga(); return; }
  }

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
/* ===== Buscar la imagen con Google Lens (2026-08-12) =====
   Lens ya no acepta que le pasen la URL de la imagen (ver el comentario de
   lens:imagen en main.js), hay que SUBIRLA, y la subida solo trae resultados
   si sale de una página de Google: desde ahí las cookies de la cuenta y del
   consentimiento viajan como en cualquier navegación normal.
   Así que: main baja los bytes → se abre una pestaña en Lens → cuando carga,
   se monta un formulario de subida con la imagen y se envía. El POST navega
   esa misma pestaña a los resultados, igual que en Chrome u Opera GX. */
function buscarConLens({ src, pagina }) {
  toast('Buscando la imagen con Google Lens…');
  window.cobalt.lensImagen({ src, pagina }).then((r) => {
    if (!r || !r.ok) { toast('Google Lens: ' + ((r && r.error) || 'no se pudo leer la imagen')); return; }
    const tab = createTab('https://lens.google.com/', true);
    const wv = tab.webview; if (!wv) return;
    let enviado = false;
    const enviar = () => {
      if (enviado) return; enviado = true;
      // El fichero se arma con DataTransfer porque input.files no se puede
      // rellenar de otra forma; f.submit() es una navegación de verdad.
      wv.executeJavaScript(`(() => {
        const bin = atob(${JSON.stringify(r.b64)});
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([u8], 'imagen', { type: ${JSON.stringify(r.tipo)} }));
        const f = document.createElement('form');
        f.method = 'POST'; f.enctype = 'multipart/form-data';
        f.action = 'https://lens.google.com/v3/upload?re=df&stcs=' + Date.now() * 1000;
        const i = document.createElement('input');
        i.type = 'file'; i.name = 'encoded_image';
        f.appendChild(i); document.body.appendChild(f);
        i.files = dt.files; f.submit();
      })()`).catch(() => toast('Google Lens: no se pudo enviar la imagen'));
    };
    wv.addEventListener('dom-ready', enviar, { once: true });
  }).catch(() => toast('Google Lens: no se pudo buscar la imagen'));
}
/* Lo que el menú contextual de la página no puede hacer desde el proceso
   principal: cosas de la interfaz (pestañas, marcadores, hub, Rat Tool). */
window.cobalt.onContextAction(({ tipo, datos }) => {
  if (tipo === 'buscar') { const u = toUrl(datos); if (u) createTab(u); return; }
  if (tipo === 'lens') { buscarConLens(datos); return; }
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
  migraFondoPorTema(); // antes de applyTheme(): el es quien aplica el fondo del tema
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
  // (el fondo ya lo puso applyTheme: cada tema recuerda el suyo)
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
    // El hub entra escalonado POR DEBAJO mientras el splash se va: el relevo
    // se solapa, que es lo que hace que parezca una sola secuencia.
    els.hub.classList.add('estrenando');
    if (els.hub.classList.contains('active')) focusUrlbar();
    setTimeout(() => els.splash.remove(), 600);
    setTimeout(() => els.hub.classList.remove('estrenando'), 1700);
  }, 1950);
})();


/* ===== Scroll propio de Naviris (2026-08-11) =====
   El scrollbar nativo rompía las esquinas redondeadas de las piezas flotantes.
   Este dibuja una barra flotante sobre cada contenedor: aparece al rodar, el
   pulgar se ESTIRA mientras ruedas y vuelve a su grosor al parar, y se puede
   arrastrar. Solo anima transform/opacity (regla de rendimiento del proyecto).
   Se auto-aplica a lo que scrollee y se re-mide con ResizeObserver. */
(function scrollPropio() {
  const MARGEN = 12;     // px que el pulgar NUNCA invade arriba y abajo
  const OCULTAR = 900;   // ms sin rodar -> el pulgar vuelve a su grosor
  const DESVANECER = 1400; // ms sin rodar -> la barra se va
  const puestos = new WeakSet();

  function montar(host) {
    if (puestos.has(host) || !host.isConnected) return;
    puestos.add(host);
    host.classList.add('nvs-host');
    // La barra va dentro del propio contenedor, así hereda su recorte redondeado
    const pos = getComputedStyle(host).position;
    if (pos === 'static') host.style.position = 'relative';
    const bar = document.createElement('div'); bar.className = 'nvs-bar';
    const thumb = document.createElement('div'); thumb.className = 'nvs-thumb';
    bar.appendChild(thumb); host.appendChild(bar);

    let tRod = null, tFade = null;
    const medir = () => {
      const alto = host.clientHeight, total = host.scrollHeight;
      if (total <= alto + 1) { bar.classList.remove('visible'); return; }
      bar.style.height = alto + 'px';
      bar.style.top = host.scrollTop + 'px'; // la barra viaja con el contenido
      /* El pulgar NO llega a los extremos (2026-08-13). Al tocar techo o suelo
         quedaba pegado al canto del contenedor —y contra su esquina redondeada—
         y se veia como un pegote. Se le reserva un margen arriba y abajo, y el
         recorrido se reparte dentro de ese hueco. */
      const util = Math.max(40, alto - MARGEN * 2);
      const h = Math.max(28, Math.round(util * alto / total));
      const y = MARGEN + Math.round((util - h) * (host.scrollTop / (total - alto)));
      thumb.style.height = h + 'px';
      thumb.style.top = y + 'px';
    };
    const rodando = () => {
      medir();
      bar.classList.add('visible', 'rodando');
      clearTimeout(tRod); clearTimeout(tFade);
      tRod = setTimeout(() => bar.classList.remove('rodando'), OCULTAR);
      tFade = setTimeout(() => bar.classList.remove('visible'), DESVANECER);
    };
    host.addEventListener('scroll', rodando, { passive: true });
    host.addEventListener('mouseenter', () => { medir(); if (host.scrollHeight > host.clientHeight + 1) bar.classList.add('visible'); });
    host.addEventListener('mouseleave', () => { if (!bar.classList.contains('rodando')) bar.classList.remove('visible'); });
    try { new ResizeObserver(medir).observe(host); } catch { /* navegador viejo */ }

    // Arrastrar el pulgar
    let arrastre = null;
    thumb.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      arrastre = { y0: e.clientY, top0: host.scrollTop };
      bar.classList.add('visible', 'rodando');
    });
    window.addEventListener('mousemove', (e) => {
      if (!arrastre) return;
      const alto = host.clientHeight, total = host.scrollHeight;
      const h = thumb.offsetHeight;
      const recorrido = Math.max(40, alto - MARGEN * 2) - h;   // el mismo hueco que usa medir()
      if (recorrido <= 0) return;
      host.scrollTop = arrastre.top0 + (e.clientY - arrastre.y0) * ((total - alto) / recorrido);
    });
    window.addEventListener('mouseup', () => { if (arrastre) { arrastre = null; rodando(); } });
    medir();
  }

  // Contenedores que scrollean en la UI (los webviews conservan el suyo)
  /* REGLA (Dosa, 2026-08-13): NINGUN scroll de Naviris usa la barra del
     sistema. Todo lo que scrollee en la interfaz entra en esta lista — los
     menus y popovers se sumaron al limitarlos al alto de la ventana, que es
     cuando empezaron a scrollear. */
  const SEL = '#hub .hub-scroll, .overlay-page, .lp-body, .hub-panel, #history-list, #dl-list, #pw-list, #card-list, #mp-grid, #loot-list, #suggest, #res-list, #perm-list, #sidebar-config, .sp-list, .spl-lista, .ml-lista, .xt-lista, #menu-pop, #shield-pop, #res-pop, #rat-pop, #loot-pop, #site-pop, .ctx-menu, .temas-pop, .modal-card';
  const barrer = () => document.querySelectorAll(SEL).forEach(montar);
  /* El hub y sus widgets se pintan DESPUÉS de este repaso inicial, y luego cada
     vez que se recompone: sin esta puerta, listas como la de Spotify se
     quedaban con la barra del sistema. renderHub la llama al terminar. */
  window.nvsRepasa = barrer;
  barrer();
  // Los paneles y páginas se crean al vuelo: se revisan al abrirse
  document.addEventListener('click', () => setTimeout(barrer, 120), true);
  window.addEventListener('resize', barrer);
})();

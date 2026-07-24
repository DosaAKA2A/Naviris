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
  'wp-file', 'dial-modal', 'dial-name', 'dial-url', 'opt-restore', 'opt-powersaver', 'opt-gpu',
  'opt-agent', 'opt-smartsearch', 'opt-xsensitive', 'opt-passkeys', 'shield-pop', 'adblock-toggle', 'adblock-count', 'adblock-site', 'adblock-list',
  'media-panel', 'mp-title', 'mp-grid', 'mp-all', 'sb-home', 'sb-sites', 'sb-claude', 'sb-rat',
  'sb-media', 'sb-downloads', 'sb-history', 'sb-bookmarks', 'sb-passwords', 'sb-res', 'sb-settings', 'res-pop', 'res-list',
  'sb-loot', 'loot-panel', 'loot-close', 'loot-tab-ses', 'loot-tab-hist', 'loot-body',
  'history-panel', 'history-list', 'history-filter', 'history-clear', 'history-close',
  'pw-panel', 'pw-list', 'pw-form', 'pw-site', 'pw-user', 'pw-pass', 'pw-addbtn', 'pw-import', 'pw-cancel',
  'res-label', 'private-badge', 'toast', 'suggest', 'web-panel', 'wpz-title', 'wpz-host', 'wpz-grip',
  'rat-pop', 'rat-url', 'rat-plat', 'rat-video', 'rat-audio', 'rat-note', 'rat-detect', 'rat-detect-logo',
  'rat-detect-name', 'rat-detect-url', 'rat-xtoggle', 'rat-xcheck', 'rat-qrow', 'rat-quality', 'dl-panel', 'dl-list',
  'rat-normal', 'rat-headsub',
  'bm-page', 'bm-tree', 'bm-newfolder', 'bm-import', 'bm-filter', 'prompt-modal', 'prompt-title', 'prompt-input',
  'prompt-ok', 'prompt-cancel', 'sidebar-modal', 'sidebar-config', 'sidebar-add', 'sidebar-done',
  'perm-bar', 'perm-text', 'perm-remember', 'perm-allow', 'perm-block', 'perm-modal', 'perm-list', 'perm-clear-all', 'perm-modal-close',
  'pw-bar', 'pw-text', 'pw-no', 'pw-yes'
].forEach((id) => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

const SLEEP_AFTER_MS = 5 * 60 * 1000;
let settings = { hardwareAcceleration: true, powerSaver: true };
let tabs = [], activeId = null, nextId = 1;

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
function saveSession() {
  if (IS_PRIVATE) return;
  const urls = tabs.filter((t) => t.kind === 'web' && t.url && /^https?:/.test(t.url)).map((t) => t.sleptUrl || t.url);
  store.set('cobalt.session', urls);
}
let mediaTimer = null;
function attachWebview(tab, url) {
  const wv = document.createElement('webview');
  wv.setAttribute('allowpopups', ''); wv.setAttribute('partition', PARTITION); wv.src = url;
  tab.webview = wv; tab.kind = 'web'; tab.url = url;
  const onNav = (e) => {
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
  wv.addEventListener('page-title-updated', (e) => { tab.title = e.title || tab.title; if (tab.id === activeId) recordHistory(tab.url, tab.title); renderTabs(); });
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
  hideBookmarkPage(); hideAddonsPage();
  els.hub.classList.toggle('active', tab.kind === 'hub');
  tabs.forEach((t) => {
    if (!t.webview || t.kind !== 'web') return;
    const active = t.id === id;
    t.webview.classList.toggle('active', active);
    // Las pestañas de AutoLoot inactivas quedan "vivas" (renderizadas fuera de
    // pantalla) para que sigan acumulando tiempo de drops
    t.webview.classList.toggle('loot-live', !active && !!t.autoLoot);
  });
  if (tab.kind === 'hub') { els.urlbar.value = ''; focusHubSearch(); }
  // Al elegir una pestaña que NO es de AutoLoot, el grupo se pliega de nuevo
  if (!tab.autoLoot) lootExpanded = false;
  renderTabs(); syncNavUI(); applyResponsive(); updateLootUI();
  if (!els.mediaPanel.classList.contains('hidden')) collectMedia();
}
function focusHubSearch() {
  requestAnimationFrame(() => { requestAnimationFrame(() => { const si = document.getElementById('hub-search-input'); (si || els.urlbar).focus(); }); });
}
// Si el hub está activo y el usuario empieza a teclear, el foco va al buscador
window.addEventListener('keydown', (e) => {
  if (!els.hub.classList.contains('active')) return;
  const t = document.activeElement; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { const si = document.getElementById('hub-search-input'); if (si) si.focus(); }
});
function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id); if (idx === -1) return;
  tabs[idx].webview?.remove(); tabs.splice(idx, 1);
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) activateTab(tabs[Math.max(0, idx - 1)].id); else renderTabs();
  saveSession();
}
function makeTabEl(tab, mini) {
  const el = document.createElement('div');
  el.className = 'tab' + (tab.id === activeId ? ' active' : '') + (tab.asleep ? ' asleep' : '') + (mini ? ' mini loot-member' : ''); el.title = tab.url || 'Hub de Naviris';
  const zzz = document.createElement('span'); zzz.className = 't-zzz'; zzz.innerHTML = window.icon('moon');
  const title = document.createElement('span'); title.className = 't-title'; title.textContent = tab.title;
  const close = document.createElement('button'); close.className = 't-close'; close.innerHTML = window.icon('x-mark');
  close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
  if (tab.kind === 'web') {
    const fav = document.createElement('span'); fav.className = 't-fav';
    if (tab.favicon) { const im = document.createElement('img'); im.src = tab.favicon; im.onerror = () => { fav.innerHTML = '<span class="t-dot"></span>'; }; fav.appendChild(im); }
    else fav.innerHTML = '<span class="t-dot"></span>';
    el.appendChild(fav);
  }
  el.append(zzz, title);
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
  el.addEventListener('click', () => activateTab(tab.id));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); });
  // Reordenar pestañas arrastrando (no en las mini del grupo AutoLoot)
  if (!mini) {
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
// Mueve la pestaña arrastrada justo delante de la de destino
function reorderTab(fromId, toId) {
  const from = tabs.findIndex((t) => t.id === fromId), to = tabs.findIndex((t) => t.id === toId);
  if (from === -1 || to === -1 || from === to) return;
  const [moved] = tabs.splice(from, 1);
  tabs.splice(tabs.findIndex((t) => t.id === toId), 0, moved);
  renderTabs(); saveSession();
}
let lootExpanded = false;
function renderTabs() {
  els.tabstrip.innerHTML = '';
  const loots = tabs.filter((t) => t.autoLoot);
  if (!loots.length) lootExpanded = false;
  // El grupo AutoLoot siempre va primero, a la izquierda del resto de pestañas
  if (loots.length) {
    els.tabstrip.appendChild(makeLootGroupTab(loots));
    if (lootExpanded) for (const lt of loots) els.tabstrip.appendChild(makeTabEl(lt, true));
  }
  for (const tab of tabs) {
    if (tab.autoLoot) continue;
    els.tabstrip.appendChild(makeTabEl(tab));
  }
}
function makeLootGroupTab(list) {
  const active = !lootExpanded && list.some((t) => t.id === activeId);
  const claims = list.reduce((n, t) => n + (t.twitchClaims || 0), 0);
  const el = document.createElement('div');
  el.className = 'tab group-tab' + (active ? ' active' : '') + (lootExpanded ? ' open' : '');
  el.title = `AutoLoot: ${list.length} canal(es)` + (claims ? ` · ${claims} reclamados` : '') + '. Clic para desplegar/plegar.';
  el.innerHTML = `<span class="gt-ic">${window.icon('gift')}</span><span class="t-title">AutoLoot · ${list.length}</span><span class="gt-caret">${window.icon(lootExpanded ? 'chevron-right' : 'chevron-down')}</span>`;
  el.addEventListener('click', (e) => { e.stopPropagation(); lootExpanded = !lootExpanded; renderTabs(); });
  return el;
}
function toggleMute(tab) {
  tab.muted = !tab.muted;
  try { tab.webview?.setAudioMuted(tab.muted); } catch {}
  renderTabs();
}
function navigateActive(input) {
  const url = toUrl(input); if (!url) return; hideBookmarkPage(); hideAddonsPage();
  const tab = activeTab() || createTab();
  if (tab.kind === 'hub') { attachWebview(tab, url); tab.title = 'Cargando…'; activateTab(tab.id); } else tab.webview.src = url;
}
function syncNavUI() {
  const tab = activeTab(); const wv = tab?.kind === 'web' ? tab.webview : null;
  if (document.activeElement !== els.urlbar) els.urlbar.value = tab?.kind === 'web' ? tab.url : '';
  try { els.navBack.disabled = !wv?.canGoBack(); els.navFwd.disabled = !wv?.canGoForward(); } catch { els.navBack.disabled = els.navFwd.disabled = true; }
  const marked = tab?.kind === 'web' && findBookmark(tab.url);
  els.navStar.innerHTML = window.icon(marked ? 'star-solid' : 'star'); els.navStar.classList.toggle('starred', !!marked);
}
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
function showBookmarkPage() { tabs.forEach((t) => t.webview?.classList.remove('active')); els.hub.classList.remove('active'); hideAddonsPage(); els.bmPage.classList.remove('hidden'); els.bmPage.classList.add('active'); els.sbBookmarks.classList.add('open'); renderBookmarkTree(); }
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
  const ic = document.createElement('span'); ic.className = 'bm-ic'; ic.innerHTML = window.icon('star'); getTile(b.url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.src = t.icon; ic.innerHTML = ''; ic.appendChild(im); } });
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

// Estilo único: logo monocromo sobre tile oscuro
function styleDial(tile, letter, d) {
  const brand = brandOf(d.url);
  tile.style.background = 'linear-gradient(140deg,#1e1e23,#141418)';
  if (brand && window.brandIcon(brand)) { const m = document.createElement('span'); m.className = 'd-mono'; m.innerHTML = window.brandIcon(brand); tile.appendChild(m); letter.remove(); return; }
  getTile(d.url).then((t) => { if (t?.icon) { const im = document.createElement('img'); im.src = t.icon; tile.style.setProperty('--icon-sz', '34px'); im.style.filter = 'grayscale(1) brightness(1.5)'; im.onload = () => letter.remove(); im.onerror = () => im.remove(); tile.appendChild(im); } });
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
const WMO = (c) => c === 0 ? ['Despejado', 'sun'] : c <= 3 ? ['Parcialmente nublado', 'cloud'] : c <= 48 ? ['Niebla', 'cloud'] : c <= 67 ? ['Lluvia', 'cloud'] : c <= 77 ? ['Nieve', 'cloud'] : c <= 82 ? ['Chubascos', 'cloud'] : ['Tormenta', 'bolt'];
async function getGeo() { if (geoCache) return geoCache; const r = await fetch('https://ipapi.co/json/'); geoCache = await r.json(); return geoCache; }
async function loadWeather(el, kind) {
  try {
    const geo = await getGeo();
    if (kind === 'region') { el.innerHTML = `<div class="wx-ic">${window.icon('map-pin')}</div><div><div class="wx-temp" style="font-size:20px">${escapeHtml(geo.city || '—')}</div><div class="wx-desc">${escapeHtml(geo.region || '')}, ${escapeHtml(geo.country_name || '')}</div><div class="wx-city">${escapeHtml(geo.timezone || '')}</div></div>`; return; }
    if (!wxCache) { const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code`); wxCache = (await r.json()).current; }
    const [desc, ic] = WMO(wxCache.weather_code);
    el.innerHTML = `<div class="wx-ic">${window.icon(ic)}</div><div><div class="wx-temp">${Math.round(wxCache.temperature_2m)}°</div><div class="wx-desc">${desc}</div><div class="wx-city">${window.icon('map-pin')} ${escapeHtml(geo.city || '')}</div></div>`;
  } catch { el.innerHTML = '<div class="w-loading">Clima no disponible (sin conexión)</div>'; }
}

/* Edición / personalización del hub */
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
  'linear-gradient(160deg, #26262d 0%, #191920 100%)',                 // Gris oscuro (predeterminado)
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
function applyBackground(v) {
  if (v === 'transparent') v = BACKGROUNDS[0]; // el modo transparente se retiró (creaba capas de sombra)
  els.hub.style.setProperty('--hub-bg', v);
  store.set('cobalt.hubBg', v);
  document.querySelectorAll('.bg-thumb').forEach((t) => t.classList.toggle('sel', t.dataset.bg === v));
}
function renderBgPresets() {
  els.bgPresets.innerHTML = ''; const saved = store.get('cobalt.hubBg', BACKGROUNDS[0]);
  for (const bg of BACKGROUNDS) { const th = document.createElement('div'); th.className = 'bg-thumb' + (bg === saved ? ' sel' : ''); th.style.background = bg; th.dataset.bg = bg; th.addEventListener('click', () => applyBackground(bg)); els.bgPresets.appendChild(th); }
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
window.cobalt.onDownloadUpdate((m) => { upsertDownload(m); if (m.state === 'completed') { toast('Descargado: ' + m.name); els.sbDownloads.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 400 }); } });
function toggleDownloads(force) { const open = force !== undefined ? force : els.dlPanel.classList.contains('hidden'); if (open) { closeRightPanels(); els.dlPanel.classList.remove('hidden'); els.sbDownloads.classList.add('open'); } else { els.dlPanel.classList.add('hidden'); els.sbDownloads.classList.remove('open'); } }
els.sbDownloads.addEventListener('click', () => toggleDownloads());
$('#dl-close').addEventListener('click', () => toggleDownloads(false));
$('#dl-clear').addEventListener('click', () => { window.cobalt.clearDownloads(); for (const [id, row] of dlRows) if (row.classList.contains('done') || row.classList.contains('error')) { row.remove(); dlRows.delete(id); dlMeta.delete(id); } });
function closeRightPanels() { els.mediaPanel.classList.add('hidden'); els.sbMedia.classList.remove('open'); els.dlPanel.classList.add('hidden'); els.sbDownloads.classList.remove('open'); els.pwPanel.classList.add('hidden'); els.sbPasswords.classList.remove('open'); els.historyPanel.classList.add('hidden'); els.sbHistory.classList.remove('open'); els.lootPanel.classList.add('hidden'); els.sbLoot.classList.remove('open'); }

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
  else { els.pwPanel.classList.add('hidden'); els.sbPasswords.classList.remove('open'); els.pwForm.classList.add('hidden'); }
}
els.sbPasswords.addEventListener('click', async () => {
  const info = await window.cobalt.pwAvailable();
  if (!info.encryption) { toast('El cifrado seguro no está disponible en este sistema'); return; }
  togglePwPanel();
});
$('#pw-close').addEventListener('click', () => togglePwPanel(false));
els.pwAddbtn.addEventListener('click', () => { els.pwForm.classList.toggle('hidden'); els.pwSite.value = ''; els.pwUser.value = ''; els.pwPass.value = ''; els.pwSite.focus(); });
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
  const sessions = tabs.filter((t) => t.autoLoot);
  const body = els.lootBody; body.innerHTML = '';
  if (lootView === 'ses') {
    const go = document.createElement('button'); go.id = 'loot-go'; go.className = 'loot-go' + (twitch ? '' : ' off');
    go.textContent = 'Activar'; go.disabled = !twitch;
    go.addEventListener('click', () => { activateAutoLoot(activeTab()); renderLootPanel(); });
    body.appendChild(go);
    const hint = document.createElement('div'); hint.className = 'loot-hint';
    hint.textContent = twitch
      ? 'Silencia el canal, baja la resolución solo en esa pestaña y reclama puntos y drops en segundo plano, agrupada a la izquierda.'
      : 'Abre un canal de Twitch para poder activar una sesión.';
    body.appendChild(hint);
    body.appendChild(lootLabel('SESIONES ACTIVAS', String(sessions.length)));
    if (!sessions.length) { const e = document.createElement('div'); e.className = 'loot-empty'; e.textContent = 'No hay sesiones recolectando ahora mismo.'; body.appendChild(e); }
    for (const s of sessions) {
      const row = document.createElement('div'); row.className = 'loot-ses';
      row.innerHTML = '<span class="ls-dot"></span><span class="ls-info"><span class="ls-name"></span><span class="ls-time"></span></span><span class="ls-n"></span>';
      row.querySelector('.ls-name').textContent = s.title || s.url;
      const tspan = row.querySelector('.ls-time');
      tspan.textContent = s.lootStart ? ('farmeando ' + fmtDur(Date.now() - s.lootStart)) : '';
      tspan.title = 'Tiempo que AutoLoot lleva trabajando en este stream';
      const nspan = row.querySelector('.ls-n');
      nspan.textContent = s.twitchClaims || 0;
      nspan.title = 'Reclamos (puntos + drops) en esta sesión';
      const go2 = document.createElement('button'); go2.className = 'ls-btn'; go2.textContent = 'ir'; go2.addEventListener('click', () => activateTab(s.id));
      const stop = document.createElement('button'); stop.className = 'ls-btn stop'; stop.textContent = 'parar'; stop.addEventListener('click', () => { setAutoLoot(s, false); renderLootPanel(); });
      row.append(go2, stop); body.appendChild(row);
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

els.sbRat.addEventListener('click', async (e) => {
  e.stopPropagation();
  const open = els.ratPop.classList.contains('hidden'); els.ratPop.classList.toggle('hidden'); els.sbRat.classList.toggle('open', open);
  if (!open) return;
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
  tab.lowRes = true; tab.autoLoot = true;
  if (!tab.lootStart) tab.lootStart = Date.now(); // inicio del temporizador de trabajo
  if (!tab.muted) { tab.muted = true; try { tab.webview?.setAudioMuted(true); } catch { /* nada */ } }
  // La calidad ahora baja desde el menú del reproductor (en caliente), así que
  // ya no hace falta recargar la pestaña ni reiniciar el stream.
  try { tab.webview?.send('cobalt-autoloot', { on: true, lowRes: true }); } catch { /* nada */ }
  renderTabs(); updateLootUI();
  toast('Modo Loot: silenciado, resolución mínima y pestaña agrupada a la izquierda');
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
els.ratXcheck.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ xRevealSensitive: els.ratXcheck.checked }); els.optXsensitive.checked = els.ratXcheck.checked; const tab = activeTab(); if (tab?.kind === 'web' && /(^|\.)(x\.com|twitter\.com)$/.test(hostOf(tab.url))) tab.webview.reload(); toast(els.ratXcheck.checked ? 'Contenido sensible visible en X' : 'Sensibilidad de X restaurada'); });
async function ratGrab(mode) { const url = els.ratUrl.value.trim(); if (!/^https?:/.test(url)) { toast('Pega un enlace válido'); return; } const quality = mode === 'video' ? els.ratQuality.value : ''; els.ratPop.classList.add('hidden'); els.sbRat.classList.remove('open'); toggleDownloads(true); await window.cobalt.ytDownload(url, mode, quality); toast(mode === 'audio' ? 'Extrayendo MP3…' : (quality ? `Descargando vídeo (${quality}p)…` : 'Descargando vídeo…')); }
els.ratVideo.addEventListener('click', () => ratGrab('video'));
els.ratAudio.addEventListener('click', () => ratGrab('audio'));

/* ============ Panel web lateral ============ */
let panelView = null;
function openWebPanel(url, title, btn) {
  const same = panelView && els.webPanel.dataset.url === url && !els.webPanel.classList.contains('hidden');
  document.querySelectorAll('.sb-site, #sb-claude').forEach((b) => b.classList.remove('open'));
  if (same) { els.webPanel.classList.add('hidden'); return; }
  els.webPanel.classList.remove('hidden'); els.webPanel.dataset.url = url; els.wpzTitle.textContent = title; btn?.classList.add('open');
  if (!panelView) { panelView = document.createElement('webview'); panelView.setAttribute('partition', PARTITION); panelView.setAttribute('allowpopups', ''); els.wpzHost.appendChild(panelView); }
  if (panelView.getAttribute('src') !== url) panelView.src = url;
}
els.sbClaude.addEventListener('click', () => openWebPanel('https://claude.ai', 'Claude', els.sbClaude));
$('#wpz-close').addEventListener('click', () => { els.webPanel.classList.add('hidden'); document.querySelectorAll('.sb-site, #sb-claude').forEach((b) => b.classList.remove('open')); });
$('#wpz-reload').addEventListener('click', () => panelView?.reload());
$('#wpz-tab').addEventListener('click', () => { const u = els.webPanel.dataset.url; if (u) createTab(panelView?.getURL() || u); });
// Redimensionar panel
(function () {
  let dragging = false;
  els.wpzGrip.addEventListener('mousedown', (e) => { dragging = true; e.preventDefault(); document.body.style.cursor = 'col-resize'; });
  window.addEventListener('mousemove', (e) => { if (!dragging) return; const w = Math.max(320, Math.min(760, e.clientX - 48)); document.documentElement.style.setProperty('--panel-w', w + 'px'); });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.cursor = ''; store.set('cobalt.panelW', getComputedStyle(document.documentElement).getPropertyValue('--panel-w')); } });
})();

/* ============ Sidebar sites (configurable) ============ */
const KNOWN_SITES = [
  { name: 'WhatsApp', url: 'https://web.whatsapp.com', brand: 'whatsapp' }, { name: 'Discord', url: 'https://discord.com/app', brand: 'discord' },
  { name: 'Twitch', url: 'https://www.twitch.tv', brand: 'twitch' }, { name: 'YouTube', url: 'https://www.youtube.com', brand: 'youtube' },
  { name: 'Reddit', url: 'https://www.reddit.com', brand: 'reddit' }, { name: 'Instagram', url: 'https://www.instagram.com', brand: 'instagram' },
  { name: 'Spotify', url: 'https://open.spotify.com', brand: 'spotify' }, { name: 'Gmail', url: 'https://mail.google.com', brand: 'gmail' }
];
let sidebarSites = store.get('cobalt.sidebarSites', KNOWN_SITES.slice(0, 5));
const saveSidebar = () => store.set('cobalt.sidebarSites', sidebarSites);
function renderSidebarSites() {
  els.sbSites.innerHTML = '';
  for (const s of sidebarSites) {
    const btn = document.createElement('button'); btn.className = 'sb-site'; btn.title = s.name; btn.dataset.url = s.url;
    const mono = s.brand && window.brandIcon(s.brand); btn.innerHTML = mono || (s.name[0] || '·').toUpperCase();
    if (!mono) getTile(s.url).then((t) => { if (t?.icon) { btn.innerHTML = ''; const im = document.createElement('img'); im.src = t.icon; im.style.cssText = 'width:16px;height:16px;border-radius:4px;filter:grayscale(1) brightness(1.4)'; btn.appendChild(im); } });
    btn.addEventListener('click', () => openWebPanel(s.url, s.name, btn));
    els.sbSites.appendChild(btn);
  }
}
function renderSidebarConfig() {
  els.sidebarConfig.innerHTML = '';
  sidebarSites.forEach((s, i) => {
    const row = document.createElement('div'); row.className = 'sc-row';
    const ic = document.createElement('span'); ic.className = 'sc-ic'; ic.innerHTML = (s.brand && window.brandIcon(s.brand)) || escapeHtml((s.name[0] || '·').toUpperCase());
    const name = document.createElement('span'); name.className = 'sc-name'; name.textContent = s.name;
    const rm = document.createElement('button'); rm.className = 'sc-rm'; rm.innerHTML = window.icon('trash'); rm.addEventListener('click', () => { sidebarSites.splice(i, 1); saveSidebar(); renderSidebarConfig(); renderSidebarSites(); });
    row.append(ic, name, rm); els.sidebarConfig.appendChild(row);
  });
  const avail = KNOWN_SITES.filter((k) => !sidebarSites.some((s) => s.url === k.url));
  if (avail.length) { const t = document.createElement('div'); t.className = 'sp-list-title'; t.textContent = 'Sugeridas'; t.style.margin = '8px 0 4px'; els.sidebarConfig.appendChild(t); for (const k of avail) { const row = document.createElement('div'); row.className = 'sc-row'; const ic = document.createElement('span'); ic.className = 'sc-ic'; ic.innerHTML = (k.brand && window.brandIcon(k.brand)) || k.name[0]; const name = document.createElement('span'); name.className = 'sc-name'; name.textContent = k.name; const add = document.createElement('button'); add.className = 'sc-rm'; add.style.color = 'var(--ok)'; add.innerHTML = window.icon('plus'); add.addEventListener('click', () => { sidebarSites.push(k); saveSidebar(); renderSidebarConfig(); renderSidebarSites(); }); row.append(ic, name, add); els.sidebarConfig.appendChild(row); } }
}
els.sidebarAdd.addEventListener('click', () => promptModal('Añadir web al sidebar (URL)', 'https://...', (val) => { const url = toUrl(val); if (!url) return; const name = hostOf(url).split('.')[0]; sidebarSites.push({ name: name.charAt(0).toUpperCase() + name.slice(1), url, brand: brandOf(url) }); saveSidebar(); renderSidebarConfig(); renderSidebarSites(); }));
els.sidebarDone.addEventListener('click', () => els.sidebarModal.classList.add('hidden'));

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
els.sbRes.addEventListener('click', (e) => { e.stopPropagation(); const open = els.resPop.classList.contains('hidden'); els.resPop.classList.toggle('hidden'); els.sbRes.classList.toggle('open', open); if (open) renderResList(); });
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
  if (!els.lootPanel.classList.contains('hidden') && !els.lootPanel.contains(e.target) && !els.sbLoot.contains(e.target)) toggleLootPanel(false);
  if (folderPop && !folderPop.contains(e.target) && !e.target.closest('.bm-folder')) closeFolderPop();
});
els.menuPop.addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.action; if (!a) return; els.menuPop.classList.add('hidden');
  if (a === 'newtab') createTab(); if (a === 'private') window.cobalt.newPrivateWindow(); if (a === 'bookmarks') showBookmarkPage();
  if (a === 'toggle-bookmarks') els.bookmarksBar.classList.toggle('hidden'); if (a === 'about') showAbout();
  if (a === 'update') { showAbout(); setTimeout(() => $('#upd-btn').click(), 100); }
  if (a === 'sidebar') { renderSidebarConfig(); els.sidebarModal.classList.remove('hidden'); }
  if (a === 'permissions') showPermManager();
});
els.optSmartsearch.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ smartSearch: els.optSmartsearch.checked }); });
els.optXsensitive.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ xRevealSensitive: els.optXsensitive.checked }); els.ratXcheck.checked = els.optXsensitive.checked; const tab = activeTab(); if (tab?.kind === 'web' && /(^|\.)(x\.com|twitter\.com)$/.test(hostOf(tab.url))) tab.webview.reload(); });
els.optPasskeys.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ blockPasskeys: els.optPasskeys.checked }); toast(els.optPasskeys.checked ? 'Claves de acceso bloqueadas (recarga o reinicia)' : 'Claves de acceso permitidas (reinicia Naviris)'); activeTab()?.webview?.reload(); });
els.optRestore.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ restoreSession: els.optRestore.checked }); if (els.optRestore.checked) saveSession(); else store.set('cobalt.session', []); toast(els.optRestore.checked ? 'Se reabrirán tus pestañas al iniciar' : 'Se iniciará en el hub'); });
els.optPowersaver.addEventListener('change', async () => { settings = await window.cobalt.setSettings({ powerSaver: els.optPowersaver.checked }); });
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
  }
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
  els.hub.classList.remove('active'); hideBookmarkPage();
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
    tt.querySelector('.adp-ver').textContent = 'v' + (meta.version || '?') + (meta.kind === 'tool' ? ' · herramienta' : ' · para sitios');
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
        btn('Actualizar a v' + meta.version, 'primary', async () => {
          const r = await window.cobalt.addonsInstall(meta);
          toast(r.ok ? 'Addon actualizado' : 'Error: ' + r.message);
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
const naviris = {
  toast,
  activeWebview: () => { const t = activeTab(); return t && t.kind === 'web' && !t.asleep ? t.webview : null; },
  savePng: (dataUrl, name) => window.cobalt.savePng(dataUrl, name),
  registerTool({ id, label, icon, onClick }) {
    if (document.getElementById('adt-' + id)) return;
    const b = document.createElement('button');
    b.id = 'adt-' + id; b.className = 'sb-btn'; b.title = label; b.innerHTML = window.icon(icon || 'puzzle-piece');
    b.addEventListener('click', () => onClick(b));
    adEls.tools.appendChild(b);
  },
  unregisterTool(id) { document.getElementById('adt-' + id)?.remove(); }
};

const loadedTools = new Set();
async function loadToolAddons() {
  const installed = await window.cobalt.addonsList();
  // Migración: AutoLoot dejó de ser addon (ahora vive en el core). Si alguien lo
  // tenía instalado, se retira para no duplicar el botón.
  if (installed.autoloot) { try { await window.cobalt.addonsUninstall('autoloot'); naviris.unregisterTool('autoloot'); delete installed.autoloot; } catch { /* nada */ } }
  for (const [id, meta] of Object.entries(installed)) {
    if (meta.kind !== 'tool' || !meta.enabled || loadedTools.has(id)) continue;
    const code = await window.cobalt.addonsCode(id);
    if (!code) continue;
    try { new Function('naviris', code)(naviris); loadedTools.add(id); } catch (e) { console.error('Addon roto:', id, e); }
  }
  for (const id of [...loadedTools]) {
    if (!installed[id] || !installed[id].enabled) { naviris.unregisterTool(id); loadedTools.delete(id); }
  }
}
loadToolAddons();

/* Actualización */
const updStatus = $('#upd-status'), updBtn = $('#upd-btn'), updBar = $('#upd-bar');
let updState = 'idle';
function setUpd(text, cls) { updStatus.textContent = text; updStatus.className = cls || ''; }
updBtn.addEventListener('click', async () => {
  if (updState === 'available') { updBtn.textContent = 'Descargando…'; updBtn.disabled = true; updBar.classList.remove('hidden'); await window.cobalt.updateDownload(); return; }
  if (updState === 'downloaded') { window.cobalt.updateInstall(); return; }
  setUpd('Buscando…'); updBtn.disabled = true;
  const r = await window.cobalt.updateCheck();
  if (r.state === 'dev') { setUpd('Las actualizaciones solo funcionan en la versión instalada.'); updBtn.disabled = false; }
  else if (r.state === 'error') { setUpd('Error: ' + r.message, 'err'); updBtn.disabled = false; }
});
window.cobalt.onUpdateStatus((s) => {
  updState = s.state;
  if (s.state === 'checking') { setUpd('Buscando actualizaciones…'); updBtn.disabled = true; }
  else if (s.state === 'available') { setUpd('¡Versión ' + s.version + ' disponible!', 'hot'); updBtn.textContent = 'Descargar e instalar'; updBtn.disabled = false; if ($('#about-modal').classList.contains('hidden')) toast('Nueva versión de Naviris disponible (menú → Acerca de)'); }
  else if (s.state === 'latest') { setUpd('Ya tienes la última versión.'); updBtn.textContent = 'Buscar actualizaciones'; updBtn.disabled = false; }
  else if (s.state === 'downloading') { setUpd('Descargando… ' + s.percent + '%'); updBar.classList.remove('hidden'); updBar.querySelector('i').style.width = s.percent + '%'; }
  else if (s.state === 'downloaded') { setUpd('Listo para instalar la versión ' + s.version + '.', 'hot'); updBtn.textContent = 'Reiniciar e instalar'; updBtn.disabled = false; updBar.classList.add('hidden'); }
  else if (s.state === 'error') { setUpd('Error al actualizar: ' + s.message, 'err'); updBtn.disabled = false; }
});

/* Ventana */
$('#win-min').addEventListener('click', () => window.cobalt.minimize());
$('#win-max').addEventListener('click', () => window.cobalt.maximize());
$('#win-close').addEventListener('click', () => window.cobalt.close());
window.cobalt.onMaximized((max) => { $('#win-max').innerHTML = window.icon(max ? 'square-2-stack' : 'stop'); });

/* Atajos */
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); window.cobalt.newPrivateWindow(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 't') { e.preventDefault(); createTab(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeId) closeTab(activeId); }
  if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); els.urlbar.focus(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleDownloads(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); toggleHistory(); }
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const i = tabs.findIndex((t) => t.id === activeId); const n = tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]; if (n) activateTab(n.id); }
});
window.cobalt.onOpenUrl((p) => { if (typeof p === 'string') createTab(p); else createTab(p.url, !p.background); });

/* Arranque */
(async function init() {
  settings = await window.cobalt.getSettings();
  els.optPowersaver.checked = settings.powerSaver; els.optGpu.checked = settings.hardwareAcceleration; els.optAgent.checked = !!settings.agentMode;
  // Modo agente activo: aviso permanente en la topbar (el puerto CDP está abierto).
  refreshAgentBadge();
  els.optSmartsearch.checked = settings.smartSearch !== false; els.optXsensitive.checked = !!settings.xRevealSensitive; els.optPasskeys.checked = settings.blockPasskeys !== false;
  const ab = await window.cobalt.adblockGet(); els.navShield.classList.toggle('off', !ab.enabled);
  if (IS_PRIVATE) { els.privateBadge.classList.remove('hidden'); els.privateBadge.innerHTML = window.icon('eye-slash') + '<span>Privado</span>'; }
  const savedW = store.get('cobalt.panelW', null); if (savedW) document.documentElement.style.setProperty('--panel-w', savedW);
  applyBackground(store.get('cobalt.hubBg', BACKGROUNDS[0]));
  window.cobalt.version().then((v) => { const el = document.getElementById('hub-version'); if (el) el.textContent = 'Naviris v' + v; });
  els.optRestore.checked = settings.restoreSession !== false;
  renderSidebarSites(); renderBookmarksBar(); renderHub();
  // Restaura la sesión anterior si el ajuste está activo (por defecto sí, como Brave)
  const session = IS_PRIVATE ? [] : store.get('cobalt.session', []);
  if (settings.restoreSession !== false && Array.isArray(session) && session.length) {
    session.forEach((u, i) => createTab(u, i === 0));
  } else {
    createTab();
  }
  setTimeout(() => { els.splash.classList.add('gone'); if (els.hub.classList.contains('active')) focusHubSearch(); }, 1800);
})();


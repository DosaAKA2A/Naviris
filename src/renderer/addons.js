/* Addons: catálogo, instalación y la API `naviris` que usan los de tipo herramienta. */

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
  els.hub.classList.remove('active'); hideBookmarkPage(); hideDownloadsPage(); cierraNovedadesPagina(true);
  adEls.page.classList.remove('hidden'); adEls.page.classList.add('active');
  renderAddons();
}
function hideAddonsPage() { adEls.page.classList.remove('active'); adEls.page.classList.add('hidden'); }
adEls.hubBtn.addEventListener('click', showAddonsPage);
adEls.refresh.addEventListener('click', renderAddons);

async function renderAddons() {
  adEls.list.innerHTML = '<div class="adp-loading">Cargando catálogo…</div>';
  const [cat, installed] = await Promise.all([window.navirisApp.addonsCatalog(), window.navirisApp.addonsList()]);
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
        const r = await window.navirisApp.addonsInstall(meta);
        toast(r.ok ? 'Addon instalado: ' + meta.name + (meta.kind === 'tool' ? '' : ' (activo al recargar los sitios)') : 'Error: ' + r.message);
        if (r.ok) loadToolAddons();
        renderAddons();
      });
    } else {
      if (inCatalog && meta.version && inst.version !== meta.version) {
        btn('Actualizar a v' + meta.version, 'primary', async (ev) => {
          ev.target.textContent = 'Actualizando…'; ev.target.disabled = true;
          const r = await window.navirisApp.addonsInstall(meta);
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
        await window.navirisApp.addonsToggle(meta.id, !inst.enabled);
        if (inst.kind === 'tool') loadToolAddons();
        renderAddons();
      });
      btn('Quitar', 'danger', async () => {
        await window.navirisApp.addonsUninstall(meta.id);
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
// Atajos reclamados por addons (Alt + letra). Llegan por dos caminos: el
// keydown de esta interfaz y, cuando el foco está dentro de una página, el
// before-input-event del main (comandos 'addon-<letra>').
const atajosAddon = new Map();
function lanzaAtajoAddon(tecla) {
  const fn = atajosAddon.get(String(tecla || '').toLowerCase());
  if (!fn) return false;
  try { fn(); } catch { /* que un addon falle no rompe el teclado */ }
  return true;
}
const naviris = {
  toast,
  activeWebview: () => { const t = activeTab(); return t && t.kind === 'web' && !t.asleep ? t.webview : null; },
  // TODAS las webviews vivas, no solo la de la pestaña activa. La necesitan los
  // addons que deben actuar sobre pestañas en segundo plano (Blockify tiene que
  // armar una pestaña de Spotify aunque el usuario esté mirando otra cosa); con
  // solo activeWebview esas pestañas no se tocaban hasta ponerlas en primer plano.
  allWebviews: () => tabs.filter((t) => t.kind === 'web' && !t.asleep && t.webview).map((t) => t.webview),
  savePng: (dataUrl, name) => window.navirisApp.savePng(dataUrl, name),
  // onUnload: se invoca al retirar la herramienta (desinstalar o actualizar en
  // caliente) para que el addon suelte sus listeners. Sin esto, actualizar dejaba
  // vivos los listeners de la instancia vieja colgando de cada <webview> y acababa
  // habiendo dos manejadores peleándose por el mismo estado.
  registerTool({ id, label, icon, onClick, onUnload }) {
    if (document.getElementById('adt-' + id)) return;
    const b = document.createElement('button');
    // El icono lo elige el addon, que se actualiza por su cuenta: si pide uno
    // que esta version del navegador no trae, el botón saldría VACÍO (un
    // círculo sin nada dentro) y sin ningún aviso. Mejor la pieza de puzle.
    const ico = window.iconExists?.(icon) ? icon : 'puzzle-piece';
    b.id = 'adt-' + id; b.className = 'sb-btn'; b.title = label; b.innerHTML = window.icon(ico);
    b.addEventListener('click', () => onClick(b));
    adEls.tools.appendChild(b);
    if (typeof onUnload === 'function') toolUnloaders.set(id, onUnload);
  },
  /* Coloca el panel de un addon PEGADO a su botón del riel. Un panel con un
     `top` fijo aparece lejos de lo que lo abrió (y si cae sobre la barra de
     título, deja de recibir clics). Es el mismo anclaje que usan el Rat Tool y
     el panel de resolución, para que todo el riel se comporte igual. */
  anclaAlBoton(panel, btn) {
    btn = btn || document.getElementById('adt-' + (panel && panel.dataset ? panel.dataset.addon : ''));
    if (!panel || !btn) return;
    anclarPop(panel, btn);
  },
  unregisterTool(id) {
    const fin = toolUnloaders.get(id);
    if (fin) { toolUnloaders.delete(id); try { fin(); } catch { /* que un addon falle al soltar no impide retirarlo */ } }
    document.getElementById('adt-' + id)?.remove();
  },
  // Abre una pestaña con esa dirección. Por defecto pasa a primer plano.
  abrePestana(url, activar = true) {
    if (!/^https?:\/\//i.test(url || '')) return null;
    const t = createTab(url, activar !== false);
    return t ? t.id : null;
  },
  /* Lee una página SIN enseñársela al usuario: webview fuera de pantalla con la
     misma sesión que las pestañas, se carga, se ejecuta `expr` dentro y se
     destruye. Devuelve lo que devuelva expr, o null si no da nada a tiempo.
     Lo usa Strainer para resolver una pasarela sin que sus anuncios lleguen a
     verse. OJO: no se oculta con display:none — una webview así no llega a
     cargar; hay que sacarla de la vista. */
  leePagina(url, expr, ms) {
    return new Promise((resolve) => {
      if (!/^https?:\/\//i.test(url || '') || typeof expr !== 'string') { resolve(null); return; }
      const wv = document.createElement('webview');
      wv.setAttribute('partition', PARTITION);
      wv.style.cssText = 'position:fixed;left:-20000px;top:0;width:1024px;height:768px;opacity:0;pointer-events:none';
      let cerrado = false;
      const acaba = (v) => {
        if (cerrado) return;
        cerrado = true; clearTimeout(reloj);
        try { wv.remove(); } catch { /* ya no estaba */ }
        resolve(v || null);
      };
      const reloj = setTimeout(() => acaba(null), Math.min(Math.max(Number(ms) || 12000, 2000), 40000));
      // dom-ready se repite en cada navegación de la pasarela: cada una es otra
      // oportunidad de encontrar el enlace, y la última palabra la tiene el reloj.
      wv.addEventListener('dom-ready', async () => {
        try { wv.setAudioMuted(true); } catch { /* nada */ }
        try { const r = await wv.executeJavaScript(expr); if (r) acaba(r); } catch { /* la página no dejó */ }
      });
      wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame) acaba(null); });
      document.body.appendChild(wv);
      wv.src = url;
    });
  },
  // Atajo de teclado para un addon: solo Alt + una letra, y solo las que el
  // core no usa ya (hoy queda libre la 's'). Funciona con el foco en la
  // interfaz y también leyendo una página. offAtajo se llama en onUnload.
  onAtajo(tecla, fn) {
    tecla = String(tecla || '').toLowerCase();
    if (tecla.length !== 1 || typeof fn !== 'function') return false;
    atajosAddon.set(tecla, fn);
    return true;
  },
  offAtajo(tecla) { atajosAddon.delete(String(tecla || '').toLowerCase()); },
  // Sensibilidad de X: única puerta de los addons hacia ese ajuste (lo usa el
  // addon "Sensibilidad X"; el resto de settings no se expone a addons).
  xSensitive: {
    get: () => !!settings.xRevealSensitive,
    set: async (v) => {
      settings = await window.navirisApp.setSettings({ xRevealSensitive: !!v });
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
  const installed = await window.navirisApp.addonsList();
  // Migración: addons retirados del producto. AutoLoot pasó al core; Twitch Kit
  // y Valve Rat Tool se descatalogaron (2026-07-29). Si alguien los tiene
  // instalados, se desinstalan solos para que no quede código muerto sin
  // actualizaciones.
  // 'salta-pasarelas' vivió unas horas el 2026-08-16: es el mismo addon que
  // ahora se llama Strainer, con otro id. Se desinstala para que no queden dos.
  // 'long-screenshot' (Captura larga) se descatalogó el 2026-09-09: sale del
  // catálogo y se desinstala a quien lo tuviera puesto.
  for (const retirado of ['autoloot', 'twitch-kit', 'steam-inventory-helper', 'salta-pasarelas', 'long-screenshot']) {
    if (installed[retirado]) { try { await window.navirisApp.addonsUninstall(retirado); naviris.unregisterTool(retirado); delete installed[retirado]; } catch { /* nada */ } }
  }
  // Migración 2.7.3: la sensibilidad de X salió de Ajustes y ahora es el addon
  // "Sensibilidad X". Quien la tenía activa recibe el addon solo, para no
  // quedarse sin interruptor (si el catálogo no responde, se reintenta al
  // próximo arranque; el ajuste no se toca).
  if (settings.xRevealSensitive && !installed['x-sensitive']) {
    try {
      const cat = await window.navirisApp.addonsCatalog();
      const meta = cat.ok && cat.addons.find((a) => a.id === 'x-sensitive');
      if (meta) { const r = await window.navirisApp.addonsInstall(meta); if (r.ok) installed[meta.id] = { ...meta, enabled: true }; }
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

/* Pestañas: crearlas, dormirlas, su webview, página de error, activar, cerrar, fijar y su menú. */

/* ============ Historial ============ */
let history = IS_PRIVATE ? [] : store.get('naviris.history', []);
function recordHistory(url, title) {
  if (IS_PRIVATE || !/^https?:/.test(url)) return;
  const i = history.findIndex((h) => h.url === url);
  if (i >= 0) { history[i].visits++; history[i].ts = Date.now(); if (title) history[i].title = title; }
  else history.push({ url, title: title || url, visits: 1, ts: Date.now() });
  if (history.length > 600) history = history.sort((a, b) => b.ts - a.ts).slice(0, 600);
  guardaHistorial();
}

/* ============ Pestañas ============ */
/* Pestaña de FONDO (clic con la rueda, "abrir el enlace en una pestaña nueva",
   target=_blank sin foco): NACE DORMIDA. Nada se carga hasta que entras en
   ella, así un vídeo de YouTube abierto de fondo no se pone a sonar en una
   pestaña que ni has mirado (pedido de Dosa, 2026-08-12). Reutiliza tal cual
   la mecánica de dormidas del ahorro de energía: despertar = poner el src.
   El título y el icono salen del historial si ya conocemos el sitio. */
/* Donde entra una pestaña nueva. Sin madre, al final. Con madre, JUSTO
   DETRAS de ella — y detras de las que esa misma madre haya abierto antes,
   para que tres enlaces de la misma pagina salgan en el orden en que se
   pulsaron y todos pegados a ella. Es como se comporta Opera GX, y lo pidio
   Dosa el 2026-08-30: antes se iban todas al final de la barra y perdias de
   vista de donde habian salido. */
function colocaPestana(tab, abridorId) {
  const i = abridorId == null ? -1 : tabs.findIndex((x) => x.id === abridorId);
  if (i === -1) { tabs.push(tab); return tab; }
  tab.abridor = abridorId;
  let j = i + 1;
  while (j < tabs.length && tabs[j].abridor === abridorId) j++;
  tabs.splice(j, 0, tab);
  return tab;
}
function createTab(url = null, activate = true, contenedor = null, abridor = null) {
  /* Lo que se abre DESDE una pestaña se queda en su contenedor y en su
     espacio: un enlace de la cuenta del contenedor no puede salir con la
     cuenta normal, ni uno de un espacio protegido caer en el General. */
  const madre = abridor != null ? tabs.find((x) => x.id === abridor) : null;
  contenedor = contenedor || (madre && madre.contenedor) || null;
  const espacio = madre ? (madre.espacio || null) : espacioActivo;
  if (url && !activate && /^https?:/i.test(url)) {
    const conocido = history.find((h) => h.url === url);
    const tab = crearDormida({ u: url, t: (conocido && conocido.title) || '', e: espacio, c: contenedor }, abridor);
    tab.sinCargar = true;   // dormida por no haberse abierto nunca, no por ahorro
    getTile(url).then((t) => { if (t?.icon) { tab.favicon = t.icon; renderTabs(); } }).catch(() => {});
    renderTabs(); saveSession(); return tab;
  }
  const tab = { id: nextId++, kind: url ? 'web' : 'hub', url: url || '', title: url ? 'Cargando…' : 'Nueva pestaña', webview: null, favicon: null, asleep: false, sleptUrl: null, lastActive: Date.now(), contenedor: contenedor || null, espacio };
  colocaPestana(tab, abridor);
  if (url) attachWebview(tab, url); if (activate) activateTab(tab.id); renderTabs(); saveSession(); return tab;
}
// Guarda las URLs abiertas para restaurarlas al reabrir (si el ajuste está activo).
// No aplica en ventana privada. Se llama al crear/cerrar/navegar pestañas.
// Formato: string (histórico) u objeto { u, p } cuando la pestaña está fijada.
function saveSession() {
  // La sesión es de la ventana principal: una ventana sacada la pisaría con la suya.
  if (IS_PRIVATE || SACADA) return;
  // Se guarda también el título: al reabrir, las pestañas entran dormidas y
  // sin él se verían todas como "Cargando…". El favicon ya no (auditoría
  // 2026-10): era una imagen en base64 por pestaña reescrita en cada
  // navegación; al restaurar sale de la caché de iconos (getTile).
  const urls = tabs.filter((t) => t.kind === 'web' && t.url && /^https?:/.test(t.url))
    .map((t) => {
      const s = { u: t.sleptUrl || t.url, t: t.title === 'Cargando…' ? '' : (t.title || '') };
      if (t.pinned) s.p = 1;
      if (t.espacio) s.e = t.espacio;
      if (t.contenedor) s.c = t.contenedor;
      return s;
    });
  store.set('naviris.session', urls);
}
/* Pestaña restaurada SIN cargar: se queda dormida hasta que se abre, y sin
   webview, que es lo que gasta. Despertarla lo crea (despiertaPestana). */
function crearDormida(dato, abridor) {
  const url = typeof dato === 'string' ? dato : dato.u;
  const tab = {
    id: nextId++, kind: 'web', url, title: (dato && dato.t) || hostOf(url) || url,
    webview: null, favicon: (dato && dato.f) || null,
    asleep: true, sleptUrl: url, lastActive: 0,
    espacio: (dato && dato.e) || null,
    contenedor: (dato && dato.c) || null
  };
  colocaPestana(tab, abridor);
  return tab;
}
/* Dormir una pestaña es QUITAR su webview y quedarse con la dirección. Antes
   se la mandaba a about:blank y su proceso seguía vivo (medido: un renderer
   de ~14 MB privados por cada dormida). Al despertarla se vuelve a crear, en
   la partición que le toque en ese momento. Su atrás y adelante se guardan al
   dormirla y el webview nuevo nace con ellos (NAV-VIVO-07). */
function duermePestana(t) {
  if (t.webview) {
    try { t.sleptUrl = t.webview.getURL() || t.url; } catch { t.sleptUrl = t.url; }
    try { t.historial = window.navirisApp.historialDe(t.webview.getWebContentsId()); } catch { t.historial = null; }
    t.webview.remove(); t.webview = null;
  }
  t.asleep = true; t.audible = false; t.fallo = null;
}
function despiertaPestana(t) {
  const url = t.sleptUrl || t.url;
  if (t.historial) { window.navirisApp.historialAlDespertar(url, t.historial); t.historial = null; }
  attachWebview(t, url);
  t.asleep = false; t.sleptUrl = null; t.sinCargar = false;
}
/* Electron no deja cambiar la partición de un webview que ya navegó (la
   revierte y avisa en la consola). Para mudar una pestaña a otra sesión
   (espacio protegido, "Mover a") se duerme: al despertar nace en la nueva.
   La de AutoClaim se despierta ya, porque tiene que seguir contando. */
function mudaDeSesion(t) {
  if (!t.webview || t.webview.getAttribute('partition') === particionDeTab(t)) return;
  duermePestana(t);
  if (t.autoLoot) { despiertaPestana(t); t.webview.classList.add(t.id === activeId ? 'active' : 'loot-live'); }
}
// Si la pestaña activa ya no está en el espacio que se ve, se pasa a la
// última usada de este (o a una nueva si no queda ninguna).
function sigueEnEspacio() {
  const activa = activeTab();
  if (activa && enEspacio(activa)) return;
  const cand = tabsVisibles().sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
  if (cand) activateTab(cand.id); else createTab();
}
/* ===== Página de error propia =====
   Lo que se ve cuando una dirección no existe o no hay conexión: qué pasó en
   una frase, la dirección y un botón para reintentar. Tapa el webview de la
   pestaña activa, que Chromium deja en blanco (ver did-fail-load). */
function motivoFallo(f) {
  const h = hostOf(f.url) || f.url, c = f.codigo;
  // La pestaña se cayó (render-process-gone): no es la red, es la página.
  if (f.caida) {
    if (f.caida === 'oom') return ['Esta pestaña se quedó sin memoria', 'La página usaba demasiada memoria y se cerró. Recárgala para seguir.'];
    if (f.caida === 'killed') return ['Esta pestaña se cerró', 'Windows o un programa del equipo cerró la página. Recárgala para seguir.'];
    return ['Esta pestaña dejó de funcionar', 'La página se cerró de forma inesperada. Recárgala para seguir.'];
  }
  if (!navigator.onLine || c === -106 || c === -21) return ['No hay conexión a internet', 'Revisa tu conexión y vuelve a intentarlo.'];
  if (c === -105 || c === -137) return ['No se puede acceder a este sitio', 'No se encontró la dirección de ' + h + '. Revisa que esté bien escrita.'];
  if (c === -102) return ['No se puede acceder a este sitio', h + ' rechazó la conexión.'];
  if (c === -118 || c === -7) return ['No se puede acceder a este sitio', h + ' tardó demasiado en responder.'];
  if (c === -100 || c === -101 || c === -324) return ['No se puede acceder a este sitio', 'Se cortó la conexión con ' + h + '.'];
  if (c === -310) return ['No se puede acceder a este sitio', h + ' redirige demasiadas veces.'];
  if (c <= -200 && c > -300) return ['La conexión no es segura', 'El certificado de ' + h + ' no es válido, así que Naviris no abrió la página.'];
  return ['No se puede acceder a este sitio', 'La página no se pudo cargar.'];
}
function pintaFallo() {
  const caja = document.getElementById('fallo-pagina'); if (!caja) return;
  const tab = activeTab();
  const f = tab && tab.kind === 'web' && !tab.asleep ? tab.fallo : null;
  caja.classList.toggle('hidden', !f);
  if (!f) return;
  const [titulo, motivo] = motivoFallo(f);
  document.getElementById('fallo-tit').textContent = titulo;
  const m = document.getElementById('fallo-motivo'); m.textContent = motivo; m.title = f.desc;   // el código de Chromium, solo al pasar el ratón
  document.getElementById('fallo-url').textContent = f.url;
  document.getElementById('fallo-reintentar').lastChild.textContent = f.caida ? 'Recargar' : 'Reintentar';
}
document.getElementById('fallo-reintentar')?.addEventListener('click', () => {
  const tab = activeTab();
  if (tab && tab.fallo && tab.webview) recargaWv(tab.webview);
});
let mediaTimer = null;
function attachWebview(tab, url) {
  const wv = document.createElement('webview');
  wv.setAttribute('allowpopups', '');
  // Contenedor o espacio bloqueado: cada uno navega en SU sesión, no en la normal.
  wv.setAttribute('partition', particionDeTab(tab));
  wv.src = url;
  tab.webview = wv; tab.kind = 'web'; tab.url = url;
  // Clic dentro de la página = cerrar los popovers de herramientas (esos
  // clics no burbujean hasta el document; el foco del webview sí avisa)
  wv.addEventListener('focus', () => { try { cerrarPopsHerramientas(); } catch { /* aún no cargó */ } });
  /* Al salir del fullscreen HTML (el video de MOOVIN, YouTube…) la página se
     quedaba con la geometría de pantalla completa para el RATÓN: el cursor
     sobre "Siguiente capítulo" encendía el hover del botón de pantalla
     completa (Dosa, 2026-09-19). Es cosa de Chromium con <webview>: el guest
     no vuelve a preguntar dónde está en pantalla hasta que cambia de tamaño.
     Se le obliga: un píxel menos de alto y vuelta, dos frames después. */
  wv.addEventListener('leave-html-full-screen', () => {
    wv.style.height = 'calc(100% - 1px)';
    requestAnimationFrame(() => requestAnimationFrame(() => { wv.style.height = ''; }));
  });
  const onNav = (e) => {
    // Un iframe que cambia SU url también avisa aquí: eso no es la página.
    if (e.isMainFrame === false) return;
    // about:blank no es una visita: NO pisar url/título/favicon, al pasar el
    // ratón debe seguir viéndose qué contenido tenía.
    if (tab.asleep || e.url === 'about:blank') return;
    if (pwBarHost && tab.id === activeId && hostOf(e.url) !== pwBarHost) hidePwBar();   // lo que ofrecía rellenar era para el sitio de antes
    tab.url = e.url; getTile(e.url).then((t) => { tab.favicon = t?.icon || null; renderTabs(); });
    /* El historial se apunta AL NAVEGAR, que es cuando de verdad se visita
       algo. Antes solo se apuntaba en `page-title-updated`, o sea que una
       pagina SIN <title> no entraba en el historial NUNCA — y una en segundo
       plano tampoco, porque ademas se pedia que fuera la pestaña activa.
       Encontrado el 2026-08-30. El titulo se rellena luego, cuando la pagina
       lo anuncie: `recordHistory` actualiza la entrada que ya exista. */
    /* Una web que reescribe su URL sin parar (Maps al mover el mapa, los
       filtros de un buscador) no hace una visita nueva cada vez: dentro de
       una ráfaga de la misma web se corrige la última entrada, y la sesión se
       guarda una vez al acabar en vez de en cada cambio. */
    const ult = tab.histUlt, ahora = Date.now();
    const rafaga = e.type === 'did-navigate-in-page' && ult && ahora - ult.ts < 3000 && hostOf(ult.url) === hostOf(e.url);
    if (rafaga) {
      const h = history.find((x) => x.url === ult.url);
      if (h && !history.some((x) => x.url === e.url)) { h.url = e.url; h.ts = ahora; }
    } else recordHistory(e.url, tab.title);
    tab.histUlt = { url: e.url, ts: ahora };
    if (tab.autoLoot) {
      const h = hostOf(e.url);
      // Solo se apaga al ir a OTRO sitio real: las URLs intermedias (about:blank,
      // redirecciones vacías) no cuentan como "salir de Twitch"
      if (/^https?:/i.test(e.url) && h && !/(^|\.)twitch\.tv$/.test(h)) {
        tab.autoLoot = false; tab.lowRes = false; tab.twitchClaims = 0; delete tab.lootStart; renderTabs();
      } else {
        // Navegación dentro de Twitch (SPA: buscar → entrar a un canal):
        // reengancha el recolector en la página nueva
        try { tab.webview?.send('naviris-autoloot', { on: true, lowRes: !!tab.lowRes }); } catch { /* nada */ }
      }
    }
    // El botón AutoLoot de la topbar se recalcula en CADA navegación (antes solo
    // al cambiar de pestaña: era el bug de "abrí Twitch y no salía")
    if (tab.id === activeId) { syncNavUI(); updateLootUI(); if (!els.mediaPanel.classList.contains('hidden')) { clearTimeout(mediaTimer); mediaTimer = setTimeout(collectMedia, 600); } }
    if (rafaga) { clearTimeout(tab.rafagaTimer); tab.rafagaTimer = setTimeout(saveSession, 3000); }
    else saveSession();
  };
  wv.addEventListener('page-title-updated', (e) => { if (tab.asleep) return; tab.title = e.title || tab.title; if (tab.id === activeId) recordHistory(tab.url, tab.title); renderTabs(); });
  /* El icono que declara la propia pagina. Vale mas que el del servicio de
     Google, que para sitios poco populares devuelve un generico o uno de 16
     px — que es lo que se veia pixelado en la barra. */
  wv.addEventListener('page-favicon-updated', (e) => {
    if (tab.asleep) return;
    const mejor = mejorIcono(e.favicons);
    if (!mejor) return;
    getTile(tab.url, mejor).then((f) => {
      if (f && f.icon && f.icon !== tab.favicon) { tab.favicon = f.icon; renderTabs(); }
    }).catch(() => {});
  });
  wv.addEventListener('did-navigate', onNav);
  wv.addEventListener('did-navigate-in-page', onNav);
  // Buscar en la página: el recuento llega por evento, no en la llamada.
  wv.addEventListener('found-in-page', onEncontrado);
  wv.addEventListener('did-navigate', () => { if (tab.id === activeId) reiniciaBusqueda(); });
  wv.addEventListener('did-start-loading', () => { if (tab.id === activeId) els.navReload.innerHTML = window.icon('x-mark'); });
  wv.addEventListener('did-stop-loading', () => { if (tab.id === activeId) { els.navReload.innerHTML = window.icon('arrow-path'); syncNavUI(); } });
  /* La dirección no existe o no hay conexión: Chromium deja la página en
     blanco. Se apunta el fallo y encima se pone la página de error propia
     (pintaFallo). El -3 es una navegación cortada (otra encima, una
     descarga), no un fallo; y si la web de antes sigue en su sitio (getURL
     no cambió), no hay nada que tapar. */
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    let actual = ''; try { actual = wv.getURL(); } catch { /* nada */ }
    if (actual !== e.validatedURL) return;
    tab.fallo = { url: e.validatedURL, codigo: e.errorCode, desc: e.errorDescription || '' };
    tab.url = e.validatedURL;
    tab.title = hostOf(e.validatedURL) || e.validatedURL;   // y deja de decir "Cargando…"
    renderTabs(); saveSession();
    if (tab.id === activeId) { syncNavUI(); pintaFallo(); }
  });
  // Se quita cuando ya hay otra página en su sitio (al reintentar no parpadea en blanco).
  wv.addEventListener('did-navigate', () => { tab.avisos = 0; if (tab.fallo) { tab.fallo = null; if (tab.id === activeId) pintaFallo(); } });
  // Lo bloqueado era de la página anterior (main también lo olvida al navegar).
  wv.addEventListener('did-navigate', () => { if (emergAviso && emergAviso.tab === tab.id) ocultaEmergentes(); });
  /* Pestaña caída (2026-11-03): el proceso de la página murió (falta de
     memoria, un fallo de Chromium, el sistema lo mató). Antes quedaba un
     rectángulo gris sin nada; ahora sale la página de error con «Recargar».
     No se recarga sola: si la página se cae al cargar, sería otro bucle.
     'clean-exit' es un cierre normal (al dormir o cerrar la pestaña). */
  wv.addEventListener('render-process-gone', (e) => {
    const razon = e.details?.reason || e.reason;
    if (razon === 'clean-exit' || tab.asleep || tab.webview !== wv) return;
    let url = tab.url; try { url = wv.getURL() || tab.url; } catch { /* nada */ }
    tab.fallo = { url, caida: razon === 'oom' || razon === 'killed' ? razon : 'crashed', desc: razon || '' };
    tab.audible = false;
    renderTabs();
    if (tab.id === activeId) { syncNavUI(); pintaFallo(); }
  });
  // Silenciada a mano: al recrear el webview (despertar) sigue silenciada desde el principio.
  wv.addEventListener('did-attach', () => { if (tab.muted) { try { wv.setAudioMuted(true); } catch { /* nada */ } } });
  wv.addEventListener('media-started-playing', () => { tab.audible = true; if (tab.muted) { try { wv.setAudioMuted(true); } catch {} } renderTabs(); });
  wv.addEventListener('media-paused', () => { tab.audible = false; renderTabs(); });
  // Reanuda el AutoLoot tras recargar/navegar dentro de Twitch
  wv.addEventListener('dom-ready', () => { if (tab.autoLoot) { try { wv.send('naviris-autoloot', { on: true, lowRes: !!tab.lowRes }); } catch {} } });
  wv.addEventListener('ipc-message', (e) => onWebviewMessage(wv, e));
  els.content.appendChild(wv);
}
function activateTab(id) {
  /* Una pestaña de OTRO espacio (Rendimiento, Buscar en otras pestañas,
     Ctrl+Mayús+T…) no se abre a pelo: se ENTRA en su espacio, que pide la
     contraseña si está protegido y cambia el historial y los marcadores.
     Antes se cambiaba `espacioActivo` sin más y el candado se saltaba. Se la
     marca como la última usada para que sea la que abra al entrar. */
  const destino = tabs.find((t) => t.id === id);
  if (destino && !enEspacio(destino)) { destino.lastActive = Date.now(); cambiaEspacio(destino.espacio || null); return; }
  if (pwBarHost && id !== activeId) hidePwBar();   // ofrecía rellenar la pestaña que se deja
  if (emergAviso && id !== emergAviso.tab) ocultaEmergentes();   // era de la pestaña que se deja
  activeId = id; const tab = activeTab(); if (!tab) return; tab.lastActive = Date.now();
  if (tab.asleep) despiertaPestana(tab);
  // La de novedades tambien: si no, se quedaba encima al cambiar de pestaña y
  // parecia una pestaña que no se podia cerrar (2026-08-18).
  hideBookmarkPage(); hideAddonsPage(); hideDownloadsPage(); cierraNovedadesPagina(true);
  cerrarBuscar();   // la búsqueda es de la página que se deja atrás
  if (divId !== null && divId === id) divId = null;   // no se divide consigo misma
  els.hub.classList.toggle('active', tab.kind === 'hub');
  setTimeout(aplicaDivision, 0);
  tabs.forEach((t) => {
    if (!t.webview || t.kind !== 'web') return;
    const active = t.id === id;
    t.webview.classList.toggle('active', active);
    // Las pestañas de AutoLoot inactivas quedan "vivas" (renderizadas fuera de
    // pantalla) para que sigan acumulando tiempo de drops
    t.webview.classList.toggle('loot-live', !active && !!t.autoLoot);
  });
  if (tab.kind === 'hub') { els.urlbar.value = ''; focusUrlbar(); }
  else els.urlbar.blur();   // lo que se estuviera escribiendo era para la pestaña de antes
  renderTabs(); syncNavUI(); applyResponsive(); updateLootUI();
  if (!els.mediaPanel.classList.contains('hidden')) collectMedia();
  pintaFallo();
  pintaDialogo();
  // El muro de YouTube que salió con la pestaña de fondo, si sigue en ese video.
  if (tab.muroPendiente) {
    const vid = tab.muroPendiente; tab.muroPendiente = null;
    try { if (new URL(tab.url).searchParams.get('v') === vid) avisaMuroYT(tab, vid); } catch { /* nada */ }
  }
}
// Arranque con la sesión restaurada: las pestañas quedan dormidas en la barra
// hasta que se eligen, y delante se abre una "Nueva pestaña" con el hub, activa
// (antes el hub salía sin ninguna pestaña marcada en la barra).
function hubDeInicio() {
  createTab();
}
// Pestaña nueva → foco en la BARRA DE DIRECCIONES (no en el buscador del hub):
// así la búsqueda inteligente sugiere desde la primera tecla.
function focusUrlbar() {
  // Solo si el hub sigue delante: si en esos dos fotogramas se abrió una web (un
  // enlace que llega al arrancar), la barra le ponía encima sus sugerencias.
  requestAnimationFrame(() => { requestAnimationFrame(() => { if (els.hub.classList.contains('active')) els.urlbar.focus(); }); });
}
// Si el hub está activo y el usuario empieza a teclear, el foco va a la barra
window.addEventListener('keydown', (e) => {
  if (!els.hub.classList.contains('active')) return;
  const t = document.activeElement; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  // La barra espaciadora es para pulsar el botón del hub que tenga el foco, no el principio de una búsqueda.
  if (e.key === ' ') return;
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) els.urlbar.focus();
});
// `olvidar`: no pasa a la lista de Ctrl+Mayús+T (al borrar un espacio protegido).
function closeTab(id, olvidar) {
  if (divId !== null && id === divId) { divId = null; els.content.classList.remove('dividido'); els.divBarra.classList.add('hidden'); }
  const idx = tabs.findIndex((t) => t.id === id); if (idx === -1) return;
  if (!olvidar) recordarCerrada(tabs[idx]);   // para reabrirla con Ctrl+Shift+T
  tabs[idx].webview?.remove(); tabs.splice(idx, 1);
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) {
    // La sustituta sale del MISMO espacio; si no queda ninguna, se abre una
    // nueva ahí en vez de sacarte a otro espacio sin avisar.
    const vis = tabsVisibles();
    if (!vis.length) { createTab(); return; }
    const antes = vis.filter((t) => tabs.findIndex((x) => x.id === t.id) < idx).pop();
    activateTab((antes || vis[0]).id);
  } else renderTabs();
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
  const nueva = createTab(tab.sleptUrl || tab.url, false, tab.contenedor, tab.id);   // mismo contenedor y espacio
  // Se coloca justo a la derecha de la original, como en Opera/Chrome
  const from = tabs.findIndex((t) => t.id === nueva.id); tabs.splice(from, 1);
  tabs.splice(tabs.findIndex((t) => t.id === tab.id) + 1, 0, nueva);
  renderTabs(true); saveSession();
}
function menuDePestana(e, tab) {
  e.preventDefault();
  const web = tab.kind === 'web';
  // Todo lo de "las demás" va sobre las pestañas que se VEN: las de otros
  // espacios no se cierran, silencian ni recargan desde aquí sin verlas.
  const vis = tabsVisibles();
  const idx = vis.findIndex((t) => t.id === tab.id);
  const otras = vis.filter((t) => t.id !== tab.id && !t.pinned);
  const aLaDerecha = vis.slice(idx + 1).filter((t) => !t.pinned);
  // Duplicadas: misma URL (la primera de cada URL sobrevive)
  const vistas = new Set(); const duplicadas = [];
  for (const t of vis) { const u = t.kind === 'web' ? (t.sleptUrl || t.url) : 'hub'; if (vistas.has(u)) duplicadas.push(t); else vistas.add(u); }
  // Cambiar de espacio puede cambiar de sesión (protegido): ver mudaDeSesion.
  // La mitad derecha de la pantalla dividida se va con ella: se deshace antes.
  const mueveA = (idEsp) => { if (tab.id === divId) salirDivision(); tab.espacio = idEsp; mudaDeSesion(tab); sigueEnEspacio(); renderTabs(true); saveSession(); };
  const items = [
    { label: 'Nueva pestaña', icon: 'plus', kbd: 'Ctrl+T', action: () => createTab() },
    { sep: true },
    ...(web && tab.id !== activeId ? [{ label: 'Abrir en pantalla dividida', icon: 'square-2-stack', action: () => dividirCon(tab) }] : []),
    ...(espacios.length ? [{ sep: true }] : []),
    ...espacios.filter((e) => e.id !== tab.espacio).map((e) => ({ label: 'Mover a ' + e.nombre, icon: 'squares-2x2', action: () => mueveA(e.id) })),
    ...(tab.espacio ? [{ label: 'Sacar del espacio', icon: 'squares-2x2', action: () => mueveA(null) }] : []),
    ...(espacios.length ? [{ sep: true }] : []),
    ...(web && !IS_PRIVATE ? [{ label: 'Abrir en un contenedor nuevo', icon: 'layers', action: () => abreEnContenedor(tab.url, nuevoContenedor()) }] : []),
    ...(web && !IS_PRIVATE ? contenedores.filter((c) => !tab.contenedor || c.id !== tab.contenedor.id).map((c) => ({ label: 'Abrir en ' + c.nombre, icon: 'layers', action: () => abreEnContenedor(tab.url, c) })) : []),
    ...(divId !== null && tab.id === divId ? [{ label: 'Salir de la pantalla dividida', icon: 'x-mark', action: () => salirDivision() }] : []),
    ...(web ? [{ label: 'Recargar', icon: 'arrow-path', kbd: tab.id === activeId ? 'F5' : '', action: () => recargaWv(tab.webview) }] : []),
    { label: 'Recargar todas las páginas', icon: 'arrow-path', action: () => vis.forEach((t) => { if (t.kind === 'web' && !t.asleep) recargaWv(t.webview); }) },
    ...(web ? [{ label: 'Copiar dirección de página', icon: 'clipboard', action: () => copiarDireccion(tab) }] : []),
    { sep: true },
    ...(web ? [{ label: 'Duplicar pestaña', icon: 'square-2-stack', action: () => duplicarTab(tab) }] : []),
    { label: tab.pinned ? 'Soltar pestaña' : 'Fijar pestaña', icon: 'pin', action: () => setPinned(tab, !tab.pinned) },
    ...(web ? [{ label: 'Guardar en marcadores', icon: 'bookmark-add', action: () => { if (tab.id !== activeId) activateTab(tab.id); if (!findBookmark(tab.url)) els.navStar.click(); else toast('Ya está en marcadores'); } }] : []),
    { sep: true },
    ...(web ? [{ label: tab.muted ? 'Activar sonido de la pestaña' : 'Silenciar pestaña', icon: tab.muted ? 'speaker-wave' : 'speaker-x-mark', action: () => toggleMute(tab) }] : []),
    { label: 'Silenciar otras pestañas', icon: 'speaker-x-mark', action: () => vis.forEach((t) => { if (t.id !== tab.id && t.kind === 'web' && !t.muted) toggleMute(t); }) },
    { sep: true },
    { label: 'Cerrar pestaña', icon: 'x-mark', kbd: tab.id === activeId && !tab.pinned ? 'Ctrl+W' : '', action: () => closeTab(tab.id) },
    ...(otras.length ? [{ label: 'Cerrar otras pestañas', icon: 'x-mark', action: () => otras.forEach((t) => closeTab(t.id)) }] : []),
    ...(aLaDerecha.length ? [{ label: 'Cerrar pestañas a la derecha', icon: 'x-mark', action: () => aLaDerecha.forEach((t) => closeTab(t.id)) }] : []),
    ...(duplicadas.length ? [{ label: 'Cerrar pestañas duplicadas', icon: 'x-mark', action: () => duplicadas.forEach((t) => closeTab(t.id)) }] : []),
    { sep: true },
    { label: 'Reabrir última pestaña cerrada', icon: 'rotate-ccw', kbd: 'Ctrl+Mayús+T', action: reabrirCerrada }
  ];
  showCtxMenu(e.clientX, e.clientY, items);
}
function makeTabEl(tab, mini) {
  const el = document.createElement('div');
  el.dataset.tabId = tab.id;   // para seguirla mientras se arrastra
  el.className = 'tab' + (tab.id === activeId ? ' active' : '') + (tab.asleep ? ' asleep' : '') + (tab.autoLoot ? ' farming' : '') + (tab.pinned ? ' pinned' : '') + (mini ? ' mini loot-member' : '');
  el.title = tab.autoLoot ? 'AutoClaim activo en este canal' + (tab.twitchClaims ? ` · ${tab.twitchClaims} reclamados` : '')
    : tab.asleep ? `${tab.sinCargar ? 'Sin cargar — se abre al entrar' : 'Pestaña dormida'} — ${tab.title}\n${tab.sleptUrl || tab.url}`
    : (tab.url || 'Hub de Naviris');
  if (tab.contenedor) {
    const marca = document.createElement('span');
    marca.className = 't-cont';
    marca.style.background = tab.contenedor.color;
    marca.title = 'Contenedor: ' + tab.contenedor.nombre;
    el.appendChild(marca);
  }
  const title = document.createElement('span'); title.className = 't-title'; title.textContent = tab.title;
  const close = document.createElement('button'); close.className = 't-close'; close.innerHTML = window.icon('x-mark'); close.setAttribute('aria-label', 'Cerrar pestaña');
  close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
  // El hub no tiene favicon: lleva la casa del botón de Inicio. Sin ella, con
  // la barra llena se quedaba en un hueco vacío o en una X suelta.
  const fav = document.createElement('span'); fav.className = 't-fav';
  if (tab.kind !== 'web') fav.innerHTML = window.icon('home');
  else if (tab.favicon) { const im = document.createElement('img'); im.src = tab.favicon; im.onerror = () => { fav.innerHTML = '<span class="t-dot"></span>'; }; fav.appendChild(im); }
  else fav.innerHTML = '<span class="t-dot"></span>';
  el.appendChild(fav);
  // Fijada: comprimida a solo el favicon (título y cierre viven en el tooltip
  // y el menú contextual). El resto, como siempre.
  if (!tab.pinned) {
    el.append(title);
    if (tab.agentControlled) { const ag = document.createElement('span'); ag.className = 't-agent'; ag.title = 'Un agente (CDP) está controlando esta pestaña'; el.appendChild(ag); }
    // Botón de silencio: aparece si la pestaña suena o está silenciada
    if (tab.kind === 'web' && (tab.audible || tab.muted)) {
      const spk = document.createElement('button'); spk.className = 't-mute' + (tab.muted ? ' muted' : '');
      spk.title = tab.muted ? 'Activar sonido' : 'Silenciar pestaña'; spk.setAttribute('aria-label', spk.title);
      spk.innerHTML = window.icon(tab.muted ? 'speaker-x-mark' : 'speaker-wave');
      spk.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(tab); });
      el.appendChild(spk);
    }
    el.appendChild(close);
  } else {
    el.title = (tab.title || '') + '\n' + (tab.sleptUrl || tab.url || '');
  }
  el.addEventListener('click', () => { if (!document.body.classList.contains('acaba-de-arrastrar')) activateTab(tab.id); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1 && !tab.pinned) closeTab(tab.id); });
  el.addEventListener('contextmenu', (e) => menuDePestana(e, tab));
  // Arrastrar: reordenar, y sacar la pestaña a su propia ventana.
  if (!mini) el.addEventListener('pointerdown', (e) => empiezaArrastre(e, tab, el));
  return el;
}

function pestanaDeWebContents(id) {
  if (id == null) return null;
  for (const t of tabs) {
    if (!t.webview) continue;
    try { if (t.webview.getWebContentsId() === id) return t; } catch { /* aun sin montar */ }
  }
  return null;
}

setInterval(() => {
  spCuentaPausa();   // el Spotify residente se duerme en pausa haya o no widget (no depende del ahorro)
  if (!settings.powerSaver) return; const now = Date.now(); let changed = false;
  for (const tab of tabs) {
    // No dormir: la pestaña activa, las de auto-reclamo de Twitch ni las que reproducen audio
    // (los drops solo cuentan si la pestaña sigue "viendo" el stream).
    if (tab.kind !== 'web' || tab.id === activeId || tab.id === divId || tab.asleep || !tab.webview || tab.autoLoot || tab.audible) continue;
    if (now - tab.lastActive > SLEEP_AFTER_MS) { duermePestana(tab); changed = true; }
  }
  if (changed) renderTabs();
}, 30000);

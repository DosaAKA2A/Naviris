/* Atajos de teclado y ratón, y avisos del main sobre las pestañas (abrir dirección, bucle de recargas, página colgada). */

// F12: consola de desarrollador de la página activa (abre/cierra, como Chrome)
function alternarDevtools() {
  const wv = activeWv(); if (!wv) { toast('Abre una página para inspeccionarla'); return; }
  try { wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools(); } catch { /* nada */ }
}
/* El teclado de la interfaz. Los atajos salen de la MISMA tabla que usa main
   con el foco dentro de una web (src/atajos.js) y van a ejecutaAtajo, así los
   dos caminos hacen siempre lo mismo. Aquí solo queda lo que no es un atajo:
   Escape, que cierra lo que esté abierto antes de parar la carga, y los
   Alt+letra de los addons. */
window.addEventListener('keydown', (e) => {
  const k = (e.key || '').toLowerCase();
  const escribiendo = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  // Con los atajos desactivados siguen vivos solo los de ventana (F11, F12) y
  // Escape: quedarse en pantalla completa sin forma de salir sería una trampa.
  if (settings.atajos === false && !/^(F11|F12|Escape)$/.test(e.key)) return;

  if (e.key === 'Escape') {
    // Escape sale de lo que este abierto ANTES de parar la carga: primero los
    // menus del hub, luego las paginas de Novedades y Addons (se vuelve al
    // hub). Cerrar lo que estorba no depende de donde este el foco — al abrir
    // una pestaña el foco va a la barra de direcciones y, con el filtro de
    // "escribiendo", Escape no cerraba nada.
    // Lo que está encima de todo se cierra primero: el menú contextual y el cuadro de texto o contraseña.
    if (ctxMenuEl) { closeCtxMenu(); return; }
    if (!els.promptModal.classList.contains('hidden')) { els.promptCancel.click(); return; }
    if (!els.datosModal.classList.contains('hidden')) { els.datosModal.classList.add('hidden'); return; }
    // Y los menús y popovers del riel y de la barra, como en Chrome.
    if ([els.menuPop, els.shieldPop, sitePop, els.ratPop, els.resPop, els.lootPanel, els.espPop].some((p) => !p.classList.contains('hidden')) || folderPop) { cerrarPopsHerramientas(); return; }
    if (cerrarBuscar()) return;
    if (cierraMenusHub()) return;
    if (cierraNovedadesPagina()) return;
    if (adEls.page.classList.contains('active')) { hideAddonsPage(); els.hub.classList.add('active'); return; }
    if (!escribiendo) { pararCarga(); return; }
    return;
  }

  const cmd = window.naviAtajos.comandoDe({ key: e.key, control: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
  if (cmd) {
    // Alt+S es de los addons: si ninguno lo reclama, la tecla sigue su camino.
    if (cmd.startsWith('addon-') && !atajosAddon.has(cmd.slice(6))) return;
    e.preventDefault();
    ejecutaAtajo(cmd);
    return;
  }
  // --- Addons --- (al final: los atajos del core mandan sobre los de un addon)
  if (e.altKey && !e.ctrlKey && !e.shiftKey && k.length === 1 && lanzaAtajoAddon(k)) { e.preventDefault(); }
});
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

/* Lo que hace cada atajo, venga de la interfaz o de una página con el foco
   dentro (main lo intercepta con before-input-event y lo reenvía por IPC). */
function siguientePestana(paso) {
  const v = tabsVisibles(), j = v.findIndex((t) => t.id === activeId);
  const n = v[(j + paso + v.length) % v.length]; if (n) activateTab(n.id);
}
// Ctrl+Mayús+RePág/AvPág: mueve la activa un puesto, sin saltar entre fijadas y sueltas.
function muevePestana(paso) {
  const v = tabsVisibles(), j = v.findIndex((t) => t.id === activeId);
  const vecina = v[j + paso];
  if (j === -1 || !vecina || !mueveA(activeId, vecina.id, paso < 0)) return;
  renderTabs(true); saveSession();
}
function ejecutaAtajo(cmd) {
  movTeclado = true;   // lo que haga el atajo en la barra de pestañas no se anima
  try { ejecutaComando(cmd); } finally { movTeclado = false; }
}
function ejecutaComando(cmd) {
  if (cmd === 'reload') recargar(false);
  else if (cmd === 'reload-hard') recargar(true);
  else if (cmd === 'back') irAtras();
  else if (cmd === 'forward') irAdelante();
  else if (cmd === 'home') els.sbHome.click();
  else if (cmd === 'new-tab') createTab();
  else if (cmd === 'new-window') window.navirisApp.newWindow();
  else if (cmd === 'new-private') window.navirisApp.newPrivateWindow();
  // Ctrl+W y Ctrl+F4 no cierran las fijadas (decisión de Dosa): se cierran desde su menú.
  else if (cmd === 'close-tab') { const t = activeTab(); if (window.naviAtajos.cierraConAtajo(t)) closeTab(t.id); }
  else if (cmd === 'reopen-tab') reabrirCerrada();
  else if (cmd === 'focus-url') { els.urlbar.focus(); els.urlbar.select(); }
  // Ctrl+K / Ctrl+E: la barra vacía, lista para buscar (Esc devuelve la dirección).
  else if (cmd === 'focus-search') { els.urlbar.focus(); els.urlbar.value = ''; renderSuggest(); }
  else if (cmd === 'pip') miniReproductor();
  else if (cmd.startsWith('addon-')) lanzaAtajoAddon(cmd.slice(6));
  else if (cmd === 'find') abrirBuscar();
  // F3, Ctrl+G y sus Mayús: siguiente y anterior; sin búsqueda abierta, la abren.
  else if (cmd === 'find-next' || cmd === 'find-prev') {
    if (els.findBar.classList.contains('hidden') || !buscaTexto) abrirBuscar();
    else buscar(cmd === 'find-next', true);
  }
  else if (cmd === 'downloads') toggleDownloadsPage();
  else if (cmd === 'history') toggleHistory();
  else if (cmd === 'bookmark') els.navStar.click();
  else if (cmd === 'print') { try { activeWv()?.print(); } catch { /* nada */ } }
  else if (cmd === 'save-page') { const wv = activeWv(); if (wv) { try { window.navirisApp.guardaPagina(wv.getWebContentsId()); } catch { /* aún sin montar */ } } }
  else if (cmd === 'view-source') { const t = activeTab(); if (t?.kind === 'web' && /^https?:/i.test(t.url)) createTab('view-source:' + t.url, true, t.contenedor, t.id); }
  else if (cmd === 'clear-data') abreBorrarDatos();
  else if (cmd === 'fullscreen') window.navirisApp.toggleFullscreen();
  else if (cmd === 'zoom-in') zoom(1);
  else if (cmd === 'zoom-out') zoom(-1);
  else if (cmd === 'zoom-reset') zoom(0);
  else if (cmd.startsWith('rueda-')) zoomRueda(cmd.startsWith('rueda-in:') ? 1 : -1, Number(cmd.slice(cmd.indexOf(':') + 1)));
  else if (cmd === 'devtools') alternarDevtools();
  else if (cmd === 'next-tab') siguientePestana(1);
  else if (cmd === 'prev-tab') siguientePestana(-1);
  else if (cmd === 'move-tab-right') muevePestana(1);
  else if (cmd === 'move-tab-left') muevePestana(-1);
  else if (cmd.startsWith('tab-')) {
    const d = cmd.slice(4), v = tabsVisibles();   // Ctrl+1…8 y Ctrl+9 = la última
    const n = d === '9' ? v[v.length - 1] : v[parseInt(d, 10) - 1];
    if (n) activateTab(n.id);
  }
}
window.navirisApp.onShortcut(ejecutaAtajo);
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
window.navirisApp.onTabstripMenu(({ x, y }) => {
  showCtxMenu(x, y, [
    { label: 'Nueva pestaña', icon: 'plus', kbd: 'Ctrl+T', action: () => createTab() },
    { label: 'Reabrir última pestaña cerrada', icon: 'rotate-ccw', kbd: 'Ctrl+Mayús+T', action: reabrirCerrada },
    { sep: true },
    { label: 'Recargar todas las páginas', icon: 'arrow-path', action: () => tabsVisibles().forEach((t) => { if (t.kind === 'web' && !t.asleep) recargaWv(t.webview); }) }
  ]);
});
/* `origen` es el id de webContents del webview que abrio el enlace. Se
   traduce a la pestaña para poder colocar la nueva justo detras. */

window.navirisApp.onOpenUrl((p) => {
  if (typeof p === 'string') { createTab(p); return; }
  const madre = pestanaDeWebContents(p.origen);
  // Una pestaña sacada de otra ventana llega con el id de su contenedor.
  const cont = p.contenedor ? contenedores.find((c) => c.id === p.contenedor) || null : null;
  createTab(p.url, !p.background, cont, madre ? madre.id : null);
});
// Una pestaña que recargaba la misma página sin parar y main ha frenado
// (ver frenoDeRecargas en main.js).
window.navirisApp.onBucle((p) => {
  if (!pestanaDeWebContents(p.wc)) return;
  let host = p.url; try { host = new URL(p.url).hostname.replace(/^www\./, ''); } catch { /* nada */ }
  toast(host + ' se recargaba sin parar y lo he detenido', { label: 'Reintentar', alPulsar: () => window.navirisApp.reintentaBucle(p.wc) });
});
// Una página que no contesta (bucle de JavaScript): se avisa con la salida.
// Esperar es no hacer nada; si vuelve a responder, el aviso ya no vale.
window.navirisApp.onColgada(({ wc, colgada }) => {
  const tab = pestanaDeWebContents(wc);
  if (!tab || !colgada) return;
  toast((hostOf(tab.url) || 'La página') + ' no responde', { label: 'Cerrar pestaña', alPulsar: () => { if (tabs.includes(tab)) closeTab(tab.id); } });
});

/* Bloqueador, información del sitio, botones de navegación, menú y ajustes, y botones de la ventana. */

/* ============ Bloqueador ============ */
let adblockPoll = null;
async function refreshAdblockUI() {
  const info = await window.navirisApp.adblockGet(); els.adblockToggle.checked = info.enabled; els.navShield.classList.toggle('off', !info.enabled);
  els.adblockCount.textContent = info.enabled ? `${info.blocked} peticiones bloqueadas` : 'Desactivado';
  const tab = activeTab(); const host = tab?.kind === 'web' ? hostOf(tab.url) : '';
  if (host) { const permitido = info.whitelist.find((d) => host === d || host.endsWith('.' + d)); const allowed = !!permitido; els.adblockSite.classList.remove('hidden'); els.adblockSite.textContent = allowed ? `Volver a bloquear en ${permitido}` : `Permitir anuncios en ${host}`; els.adblockSite.dataset.host = permitido || host; els.adblockSite.dataset.allowed = allowed ? '1' : ''; } else els.adblockSite.classList.add('hidden');
  els.adblockList.innerHTML = '';
  for (const d of info.whitelist) { const row = document.createElement('div'); row.className = 'sp-item'; const s = document.createElement('span'); s.textContent = d; const rm = document.createElement('button'); rm.innerHTML = window.icon('trash'); rm.addEventListener('click', async () => { await window.navirisApp.adblockWhitelist('remove', d); refreshAdblockUI(); }); row.append(s, rm); els.adblockList.appendChild(row); }
}
els.navShield.addEventListener('click', async (e) => { e.stopPropagation(); const open = els.shieldPop.classList.contains('hidden'); els.shieldPop.classList.toggle('hidden'); els.navShield.classList.toggle('open', open); clearInterval(adblockPoll); if (open) { await refreshAdblockUI(); adblockPoll = setInterval(refreshAdblockUI, 3000); } });
els.adblockToggle.addEventListener('change', async () => { await window.navirisApp.adblockSetEnabled(els.adblockToggle.checked); refreshAdblockUI(); toast(els.adblockToggle.checked ? 'Bloqueador activado' : 'Bloqueador desactivado'); const tab = activeTab(); if (tab?.kind === 'web' && /(^|\.)youtube\.com$/.test(hostOf(tab.url))) tab.webview.reload(); });
els.adblockSite.addEventListener('click', async () => { const host = els.adblockSite.dataset.host; if (!host) return; await window.navirisApp.adblockWhitelist(els.adblockSite.dataset.allowed ? 'remove' : 'add', host); refreshAdblockUI(); activeTab()?.webview?.reload(); });

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
  const d = await window.navirisApp.siteData(tab.url, PARTITION);
  stp.cookieN.textContent = d.ok ? (d.cookies === 1 ? '1 cookie de este sitio' : d.cookies + ' cookies de este sitio') : 'No disponible';
}
stp.lock.addEventListener('click', (e) => { e.stopPropagation(); sitePop.classList.contains('hidden') ? abrirSitePop() : cerrarSitePop(); });
stp.close.addEventListener('click', cerrarSitePop);
stp.clear.addEventListener('click', async () => {
  const tab = activeTab(); if (!tab || tab.kind !== 'web') return;
  const r = await window.navirisApp.siteClear(tab.url, PARTITION);
  if (r.ok) { toast('Cookies y datos del sitio borrados'); stp.cookieN.textContent = '0 cookies de este sitio'; try { tab.webview?.reload(); } catch { /* nada */ } }
  else toast('No se pudieron borrar los datos');
});
stp.config.addEventListener('click', () => { cerrarSitePop(); showPermManager(); });

/* ============ Navegación ============ */
els.navBack.addEventListener('click', irAtras);
els.navFwd.addEventListener('click', irAdelante);
els.navReload.addEventListener('click', () => { const wv = activeTab()?.webview; if (!wv) return; if (wv.isLoading()) wv.stop(); else recargaWv(wv); });
els.newtabBtn.addEventListener('click', () => createTab());

/* ============ Menú ============ */
els.navMenu.addEventListener('click', (e) => {
  e.stopPropagation(); els.menuPop.classList.toggle('hidden');
  // Si la última vez se abrió desde el riel, vuelve a su sitio bajo el ⋮.
  if (!els.menuPop.classList.contains('hidden')) { els.menuPop.style.left = els.menuPop.style.top = els.menuPop.style.bottom = ''; els.menuPop.scrollTop = 0; }
});
document.addEventListener('click', (e) => {
  if (!els.menuPop.contains(e.target) && !els.navMenu.contains(e.target) && !els.sbSettings.contains(e.target)) els.menuPop.classList.add('hidden');
  if (!els.resPop.contains(e.target) && !els.sbRes.contains(e.target)) { els.resPop.classList.add('hidden'); els.sbRes.classList.toggle('open', !!resMode); }
  if (!els.ratPop.contains(e.target) && !els.sbRat.contains(e.target)) { els.ratPop.classList.add('hidden'); els.sbRat.classList.remove('open'); }
  if (!els.shieldPop.contains(e.target) && !els.navShield.contains(e.target)) { els.shieldPop.classList.add('hidden'); els.navShield.classList.remove('open'); clearInterval(adblockPoll); adblockPoll = null; }
  if (!sitePop.contains(e.target) && !stp.lock.contains(e.target)) cerrarSitePop();
  if (!els.lootPanel.classList.contains('hidden') && !els.lootPanel.contains(e.target) && !els.sbLoot.contains(e.target)) toggleLootPanel(false);
  if (folderPop && !folderPop.contains(e.target) && !e.target.closest('.bm-folder')) closeFolderPop();
  if (!els.espPop.classList.contains('hidden') && !els.espPop.contains(e.target) && !els.sbEspacios.contains(e.target)) alternaEspacios();
}, true);   // en captura: los botones que abren otro popover cortan la propagación y quedaban dos abiertos a la vez
els.menuPop.addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.action; if (!a) return; els.menuPop.classList.add('hidden');
  if (a === 'newtab') createTab(); if (a === 'newwindow') window.navirisApp.newWindow(); if (a === 'private') window.navirisApp.newPrivateWindow(); if (a === 'bookmarks') showBookmarkPage();
  if (a === 'borrar-datos') abreBorrarDatos();
  if (a === 'predeterminado') hacerPredeterminado();
  if (a === 'toggle-bookmarks') els.bookmarksBar.classList.toggle('hidden'); if (a === 'about') showAbout();
  // Con la estable ya descargada, la entrada del menú instala directamente: el
  // texto dice "Reiniciar e instalar la X", así que no hay sorpresa posible.
  if (a === 'update') { if (updAutoLista) window.navirisApp.updateInstall(); else { showAbout(); setTimeout(() => $('#upd-btn').click(), 100); } }
  if (a === 'permissions') showPermManager();
  // Volver a ver la página de la versión instalada cuando quieras: sale sola al
  // actualizar, pero cerrarla no puede significar perderla.
  if (a === 'novedades') (async () => {
    const v = await window.navirisApp.version();
    const pag = await paginaNovedades(v);
    if (pag) abreNovedadesPagina(pag);
    else toast('Esta versión no trae página de novedades');
  })();
});
els.optSmartsearch.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ smartSearch: els.optSmartsearch.checked }); });
// Motor de búsqueda (src/buscadores.js): la lista sale de ahí, no del HTML.
function pintaBuscador() {
  const sel = els.optBuscador, b = window.naviBuscadores;
  if (!sel.options.length) {
    for (const [id, m] of Object.entries(b.BUSCADORES)) sel.add(new Option(m.nombre, id));
  }
  sel.value = b.BUSCADORES[settings.buscador] ? settings.buscador : b.POR_DEFECTO;
  els.urlbar.placeholder = 'Busca en ' + b.buscador(settings.buscador).nombre + ' o escribe una dirección';
}
els.optBuscador.addEventListener('change', async () => {
  settings = await window.navirisApp.setSettings({ buscador: els.optBuscador.value });
  pintaBuscador();
  toast('Buscador: ' + window.naviBuscadores.buscador(settings.buscador).nombre);
});
els.optPreguntarDescargas.addEventListener('change', async () => {
  settings = await window.navirisApp.setSettings({ preguntarDescargas: els.optPreguntarDescargas.checked });
  toast(els.optPreguntarDescargas.checked ? 'Cada descarga preguntará dónde guardarse' : 'Las descargas van directas a Descargas');
});
els.optPasskeys.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ blockPasskeys: els.optPasskeys.checked }); toast(els.optPasskeys.checked ? 'Claves de acceso bloqueadas (recarga o reinicia)' : 'Claves de acceso permitidas (reinicia Naviris)'); activeTab()?.webview?.reload(); });
els.optRestore.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ restoreSession: els.optRestore.checked }); if (els.optRestore.checked) saveSession(); else store.set('naviris.session', []); toast(els.optRestore.checked ? 'Se reabrirán tus pestañas al iniciar' : 'Se iniciará en el hub'); });
els.optPowersaver.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ powerSaver: els.optPowersaver.checked }); });
els.optAtajos.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ atajos: els.optAtajos.checked }); toast(els.optAtajos.checked ? 'Atajos de teclado activados' : 'Atajos de teclado desactivados'); });
els.optVtabs.addEventListener('change', async () => {
  settings = await window.navirisApp.setSettings({ tabsVerticales: els.optVtabs.checked });
  aplicaVerticales(els.optVtabs.checked);
  toast(els.optVtabs.checked ? 'Pestañas en vertical' : 'Pestañas arriba');
});
els.vtabsNew.addEventListener('click', () => createTab());
els.divSalir.innerHTML = window.icon('x-mark');
els.divSalir.addEventListener('click', salirDivision);
els.optMousenav.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ mouseNav: els.optMousenav.checked }); toast(els.optMousenav.checked ? 'Botones del mouse activados' : 'Botones del mouse desactivados'); });
els.optSonidos.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ sonidos: els.optSonidos.checked }); });
els.optLight.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ lightMode: els.optLight.checked }); applyTheme(settings.lightMode); });
// Interruptor de tema del hub: mismo ajuste que el del menú, con la bolita deslizante
document.getElementById('hub-theme').addEventListener('click', async () => {
  settings = await window.navirisApp.setSettings({ lightMode: !settings.lightMode });
  els.optLight.checked = !!settings.lightMode;
  applyTheme(settings.lightMode);
});
els.optGpu.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ hardwareAcceleration: els.optGpu.checked }); window.navirisApp.restart(); });
els.optAgent.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ agentMode: els.optAgent.checked }); window.navirisApp.restart(); });
els.optUpdauto.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ updatesAuto: els.optUpdauto.checked }); toast(els.optUpdauto.checked ? 'Naviris se actualizará solo' : 'Te avisaré cuando haya versión nueva; la instalas tú desde el menú'); });
// Los estados de getGPUFeatureStatus llegan en inglés de Chromium ("enabled", "disabled_software"…)
const gpuTxt = (v) => !v ? '—' : /^enabled/.test(v) ? 'activado' : /software/.test(v) ? 'por software' : /^unavailable/.test(v) ? 'no disponible' : 'desactivado';
async function showAbout() { $('#about-version').textContent = 'v' + (await window.navirisApp.version()); const gpu = await window.navirisApp.gpuStatus(); const sec = await window.navirisApp.secStatus(); $('#about-gpu').innerHTML = `Aceleración por GPU: <b>${settings.hardwareAcceleration ? 'activada' : 'desactivada'}</b><br>Canvas 2D: <b>${gpuTxt(gpu['2d_canvas'])}</b> · WebGL: <b>${gpuTxt(gpu.webgl)}</b><br>Sandbox por proceso: <b>${sec.sandbox ? 'activo' : 'no'}</b> · Aislamiento de sitios: <b>${sec.siteIsolation ? 'activo' : 'no'}</b><br>HTTPS por defecto: <b>${sec.httpsUpgrades ? 'activo' : 'no'}</b><br>Modo agente (CDP): <b>${settings.agentMode ? 'activo en 127.0.0.1:9223' : 'desactivado'}</b>`; $('#about-modal').classList.remove('hidden'); }
$('#about-close').addEventListener('click', () => $('#about-modal').classList.add('hidden'));
/* Navegador predeterminado (menú). Windows no deja ponerlo desde la app: se
   abre su página de Configuración. El estado se mira al arrancar y cada vez
   que se vuelve a la ventana, que es lo que pasa al cerrar Configuración. */
let predet = { registrado: false, predeterminado: false };
async function pintaPredeterminado() {
  try { predet = await window.navirisApp.navegadorEstado(); } catch { return; }
  $('#menu-predet-estado').textContent = !predet.registrado ? 'Solo en la versión instalada'
    : predet.predeterminado ? 'Ya es tu navegador predeterminado' : 'Se elige en Configuración de Windows';
}
async function hacerPredeterminado() {
  if (!predet.registrado) { toast('Instala Naviris para elegirlo como navegador predeterminado'); return; }
  if (predet.predeterminado) { toast('Naviris ya es tu navegador predeterminado'); return; }
  toast(await window.navirisApp.hacerPredeterminado() ? 'Elige Naviris en Configuración de Windows' : 'No se pudo abrir Configuración de Windows');
}
pintaPredeterminado();
window.addEventListener('focus', pintaPredeterminado);

/* Ventana */
$('#win-min').addEventListener('click', () => window.navirisApp.minimize());
$('#win-max').addEventListener('click', () => window.navirisApp.maximize());
$('#win-close').addEventListener('click', () => window.navirisApp.close());
// El botón conserva SIEMPRE el icono de maximizar elegido por el usuario
// (antes al maximizar se cambiaba por otro y parecía que "desaparecía");
// solo cambia el tooltip según el estado.
window.navirisApp.onMaximized((max) => { $('#win-max').title = max ? 'Restaurar' : 'Maximizar'; });

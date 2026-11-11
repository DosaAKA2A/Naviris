/* Navegación y barra de direcciones: ir a una dirección, vista del dominio, estrella, autocompletado, recargar, atrás y adelante, zoom y reabrir pestañas. */

function navigateActive(input) {
  const url = toUrl(input); if (!url) return; hideBookmarkPage(); hideAddonsPage(); hideDownloadsPage(); cierraCentro(true);
  const tab = activeTab() || createTab();
  if (tab.kind === 'hub') { attachWebview(tab, url); tab.title = 'Cargando…'; activateTab(tab.id); }
  else {
    avisaNavUsuario(tab.webview);
    tab.webview.src = url;
    // Marcadores, Descargas o Addons escondían el webview: vuelve a la vista (y la mitad derecha, si hay división).
    tab.webview.classList.add('active'); aplicaDivision();
  }
}
function syncNavUI() {
  const tab = activeTab(); const wv = tab?.kind === 'web' ? tab.webview : null;
  if (document.activeElement !== els.urlbar) els.urlbar.value = tab?.kind === 'web' ? tab.url : '';
  try { els.navBack.disabled = !wv?.canGoBack(); els.navFwd.disabled = !wv?.canGoForward(); } catch { els.navBack.disabled = els.navFwd.disabled = true; }
  const marked = tab?.kind === 'web' && findBookmark(tab.url);
  els.navStar.classList.toggle('starred', !!marked);
  if (!marked) els.navStar.classList.remove('removing');
  els.navStar.innerHTML = window.icon(marked ? (els.navStar.classList.contains('removing') ? 'bookmark-remove' : 'bookmark-added') : 'bookmark-add');
  pintaVistaUrl();
}
/* Barra sin foco (Naviris 3): el dominio en blanco y el resto en gris, sin el
   https:// delante. Solo si lo escrito ES la dirección de la pestaña; con foco,
   o con algo a medio escribir, se ve el campo tal cual (y entero). */
const urlVista = { box: document.getElementById('urlbox'), dom: document.querySelector('#url-vista .uv-dom'), ruta: document.querySelector('#url-vista .uv-ruta') };
function pintaVistaUrl() {
  const t = activeTab(), v = els.urlbar.value;
  let u = null;
  // Con el menú de la barra abierto, la barra sigue como con foco (se ve lo que se va a copiar o cortar).
  const conFoco = document.activeElement === els.urlbar || (ctxMenuEl && ctxFocoPrevio === els.urlbar);
  if (!conFoco && t?.kind === 'web' && v && v === t.url) { try { u = new URL(v); } catch { /* se queda el campo */ } }
  const web = u && /^https?:$/.test(u.protocol);
  urlVista.box.classList.toggle('vista', !!web);
  if (!web) return;
  // La ruta legible, como la ve una persona (%C3%AD → í); el dominio, tal cual.
  let resto = (u.port ? ':' + u.port : '') + u.pathname + u.search + u.hash;
  try { resto = decodeURI(resto); } catch { /* se queda codificada */ }
  urlVista.dom.textContent = u.hostname;
  urlVista.ruta.textContent = resto === '/' ? '' : resto;
}
els.urlbar.addEventListener('focus', pintaVistaUrl);
els.urlbar.addEventListener('blur', pintaVistaUrl);
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

/* ============ Autocompletado ============ */
let sugItems = [], sugSel = -1;
function buildSuggestions(q) {
  const query = q.trim().toLowerCase(); const out = [];
  if (query) { const u = toUrl(q); out.push({ type: window.naviBuscadores.esBusqueda(settings.buscador, u) ? 'search' : 'go', label: q, url: u }); }
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
    else { ic.innerHTML = window.icon(it.type === 'bookmark' ? 'star' : 'arrow-up-right'); ponFavicon(ic, it.url); }
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
  else if (e.key === 'Escape') {
    // Se descarta lo escrito y vuelve la dirección de la página que se ve, como en Chrome.
    const t = activeTab(); els.urlbar.value = t?.kind === 'web' ? t.url : '';
    hideSuggest(); els.urlbar.blur();
  }
});

/* ============ Atajos de teclado y ratón ============ */
// Juego estándar de navegador (Chrome/Firefox/Edge). Los webviews reciben las
// teclas por su cuenta, así que estos van en la ventana y actúan sobre la
// pestaña activa.
function activeWv() { const t = activeTab(); return t?.kind === 'web' ? t.webview : null; }
function avisaNavUsuario(wv) { try { window.navirisApp.navUsuario(wv.getWebContentsId()); } catch { /* aún sin montar */ } }
// Recarga que pide la persona (F5, Ctrl+R, el botón, los menús): main la deja
// pasar aunque el freno de bucles esté puesto (ver freno-recargas.js).
function recargaWv(wv, forzado) {
  if (!wv) return;
  avisaNavUsuario(wv);
  try { forzado ? wv.reloadIgnoringCache() : wv.reload(); } catch { /* nada */ }
}
function recargar(forzado) { recargaWv(activeWv(), forzado); }
function irAtras() { const wv = activeWv(); try { if (wv?.canGoBack()) { avisaNavUsuario(wv); wv.goBack(); } } catch { /* nada */ } }
function irAdelante() { const wv = activeWv(); try { if (wv?.canGoForward()) { avisaNavUsuario(wv); wv.goForward(); } } catch { /* nada */ } }
function pararCarga() { const wv = activeWv(); try { wv?.stop(); } catch { /* nada */ } }
/* Zoom (Ctrl+'+', Ctrl+'-', Ctrl+0 y Ctrl+rueda), con los escalones de Chrome.
   Antes se sumaba ±1 a un tab.zoom propio (niveles de 1,2x: 83 %, 69 %…), pero
   Chromium guarda el zoom POR SITIO en la sesión (medido: tras subir el zoom en
   example.com, otra pestaña nueva de example.com ya abría al mismo nivel, y
   al navegar a otro dominio volvía a 0). El tab.zoom se quedaba viejo al
   cambiar de web y el siguiente Ctrl+'+' saltaba desde un nivel que no era el
   de la página. Ahora se parte siempre del zoom real del webview y es
   Chromium quien lo recuerda por sitio, como hace Chrome.
   `wv` permite apuntar a una web concreta (Ctrl+rueda: la que está bajo el
   ratón); si no, la pestaña activa. */
function zoom(delta, wv = activeWv()) {
  if (!wv) return;
  let actual = 1;
  try { actual = wv.getZoomFactor(); } catch { return; }   // webview aún sin adjuntar
  const f = window.naviAtajos.siguienteZoom(actual, delta);   // los pasos de Chrome (atajos.js)
  try { wv.setZoomFactor(f); } catch { /* nada */ }
  toast(f === 1 ? 'Zoom al 100 %' : 'Zoom ' + Math.round(f * 100) + ' %');
}
// Ctrl+rueda llega del main con el id del webContents donde se giró la rueda.
// Solo se hace zoom si es una pestaña: en los widgets del hub o el panel de
// Spotify el zoom lo lleva cada uno (el de Spotify lo calcula aplicaSpAncho).
function zoomRueda(delta, idWc) {
  const tab = tabs.find((t) => { try { return t.kind === 'web' && t.webview?.getWebContentsId() === idWc; } catch { return false; } });
  if (tab) zoom(delta, tab.webview);
}
function recordarCerrada(tab) {
  if (!tab || tab.kind !== 'web' || !tab.url) return;
  cerradas.push({ url: tab.url, title: tab.title, espacio: tab.espacio || null, contenedor: tab.contenedor || null });
  if (cerradas.length > 10) cerradas.shift();
}
// Vuelve a su espacio y a su contenedor. Si su espacio está protegido,
// activarla pasa por la contraseña (activateTab).
function reabrirCerrada() {
  const t = cerradas.pop(); if (!t) { toast('No hay pestañas cerradas recientes'); return; }
  const tab = crearDormida({ u: t.url, t: t.title, e: t.espacio, c: t.contenedor });
  activateTab(tab.id); renderTabs(); saveSession();
}

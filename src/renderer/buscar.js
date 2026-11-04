/* Buscar en la página (Ctrl+F), búsqueda en otras pestañas, Google Lens y acciones del menú de la página. */

/* ============ Buscar en la página (Ctrl+F) ============
   Naviris no lo tenía: `findInPage` no aparecía en el proyecto y Ctrl+F no
   estaba entre los atajos, así que la función más básica de cualquier navegador
   faltaba. Electron trae el motor hecho en webContents.findInPage; lo que se
   monta aquí es la barra, el recuento y el recorrido de resultados.

   Dos cosas que hay que respetar del API:
   - findInPage RE-busca desde cero si no se le pasa `findNext: true`. Al teclear
     se busca de nuevo (el texto cambió); al pulsar Intro se avanza con findNext,
     que es lo que mueve al siguiente resultado en vez de repetir el primero.
   - El recuento no vuelve en la llamada, llega después en el evento
     `found-in-page`, y solo trae `matches` cuando `finalUpdate` es true. */
let buscaTexto = '';
let buscaWv = null;

function pintaRecuento(actual, total) {
  if (!els.findCount) return;
  const vacio = total === 0 && buscaTexto !== '';
  els.findCount.textContent = buscaTexto === '' ? '' : vacio ? 'Sin resultados' : actual + '/' + total;
  els.findCount.classList.toggle('vacio', vacio);
  const nada = vacio || buscaTexto === '';
  if (els.findPrev) els.findPrev.disabled = nada;
  if (els.findNext) els.findNext.disabled = nada;
}

function onEncontrado(e) {
  const r = e.result || e;
  if (r.finalUpdate) pintaRecuento(r.activeMatchOrdinal || 0, r.matches || 0);
}

// El webview mantiene su propia sesión de búsqueda: hay que soltarla al cambiar
// de pestaña, al navegar y al cerrar la barra, o los resaltados se quedan pegados.
function paraBusqueda(wv) {
  try { (wv || buscaWv)?.stopFindInPage('clearSelection'); } catch { /* nada */ }
}

function buscar(adelante = true, siguiente = false) {
  const wv = activeWv();
  if (!wv) return;
  if (buscaWv && buscaWv !== wv) paraBusqueda(buscaWv);
  buscaWv = wv;
  if (!buscaTexto) { paraBusqueda(wv); pintaRecuento(0, 0); return; }
  try {
    /* MEDIDO: pasar `findNext: false` de forma explícita hace que la búsqueda
       se ejecute pero NO emita 'found-in-page', así que el recuento no llegaba
       nunca. Sin opciones sí emite. O sea: consulta nueva, llamada pelada; para
       avanzar dentro de la misma consulta, con findNext.
       Tampoco vale llamar a stopFindInPage justo antes: el corte se lleva por
       delante el evento de la búsqueda recién lanzada. La sesión se cierra solo
       al cerrar la barra, al cambiar de pestaña y al navegar. */
    if (siguiente) wv.findInPage(buscaTexto, { forward: adelante, findNext: true });
    else wv.findInPage(buscaTexto);
  } catch { /* la pestaña aún no tiene contenido */ }
}

function abrirBuscar() {
  const wv = activeWv();
  if (!wv) { toast('Abre una página para buscar dentro'); return; }
  els.findBar?.classList.remove('hidden');
  els.findInput?.focus();
  els.findInput?.select();
  if (buscaTexto) buscar(true, false);
}

function cerrarBuscar() {
  if (!els.findBar || els.findBar.classList.contains('hidden')) return false;
  els.findBar.classList.add('hidden');
  cierraOtras();
  clearTimeout(otrasTimer);
  paraBusqueda();
  buscaWv = null;
  pintaRecuento(0, 0);
  try { activeWv()?.focus(); } catch { /* nada */ }
  return true;
}

// Al navegar o cambiar de pestaña la búsqueda anterior ya no vale.
function reiniciaBusqueda() {
  if (!els.findBar || els.findBar.classList.contains('hidden')) { paraBusqueda(); buscaWv = null; return; }
  paraBusqueda();
  buscaWv = null;
  pintaRecuento(0, 0);
  if (buscaTexto) buscar(true, false);
}

/* Buscar en TODAS las pestañas abiertas.
   Se cuenta sobre el texto visible de cada una, no con findInPage: findInPage
   resalta y mueve el scroll, y no queremos remover pestañas que la persona no
   está mirando. Las dormidas se saltan a propósito: no tienen contenido
   cargado, y despertarlas para buscar sería justo lo contrario de lo que hace
   el panel de rendimiento. */
let otrasTimer = null;

function cierraOtras() { els.findOtras?.classList.add('hidden'); }

async function cuentaEnOtras(texto) {
  const q = texto.toLowerCase();
  const otras = tabs.filter((t) => t.kind === 'web' && t.id !== activeId && !t.asleep && t.webview);
  const expr = `(() => { const t = (document.body ? document.body.innerText : '').toLowerCase();
    const q = ${JSON.stringify(q)}; if (!q) return 0;
    let n = 0, i = 0; while ((i = t.indexOf(q, i)) !== -1) { n++; i += q.length; } return n; })()`;
  const res = await Promise.all(otras.map((t) => t.webview.executeJavaScript(expr, true)
    .then((n) => ({ t, n: Number(n) || 0 })).catch(() => ({ t, n: 0 }))));
  return res.filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
}

async function pintaOtras() {
  if (!els.findOtras) return;
  const texto = buscaTexto;
  if (!texto || texto.length < 2 || els.findBar.classList.contains('hidden')) { cierraOtras(); return; }
  const hits = await cuentaEnOtras(texto);
  if (buscaTexto !== texto) return;                    // se siguió escribiendo
  if (!hits.length) { cierraOtras(); return; }
  els.findOtras.innerHTML = `<div class="fo-tit">También en ${hits.length} ${hits.length === 1 ? 'pestaña' : 'pestañas'}</div>`;
  for (const { t, n } of hits) {
    const host = hostDeTab(t);
    const fila = document.createElement('div');
    fila.className = 'fo-fila';
    fila.innerHTML = `<img alt="" />
      <div class="fo-info"><div class="fo-t">${escapeHtml(t.title || host || 'Pestaña')}</div><div class="fo-h">${escapeHtml(host)}</div></div>
      <span class="fo-n">${n}</span>`;
    if (t.favicon) fila.querySelector('img').src = t.favicon; // igual que en perf: por .src
    fila.addEventListener('click', () => {
      cierraOtras();
      activateTab(t.id);
      // activateTab cierra la barra (la búsqueda era de la otra página): se
      // reabre con el mismo texto ya buscando en la que acaba de abrirse.
      els.findInput.value = texto;
      buscaTexto = texto;
      abrirBuscar();
    });
    const ico = fila.querySelector('img');
    ico.addEventListener('error', () => { ico.style.visibility = 'hidden'; });
    els.findOtras.appendChild(fila);
  }
  els.findOtras.classList.remove('hidden');
}

if (els.findInput) {
  /* Se busca al dejar de teclear, no con cada letra: cada búsqueda nueva
     arranca desde la coincidencia anterior, así que escribiendo "navegador"
     letra a letra se acababa en la 10/70 en vez de en la primera. */
  let buscaTimer = null;
  els.findInput.addEventListener('input', () => {
    buscaTexto = els.findInput.value;
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => { buscaTimer = null; buscar(true, false); }, 150);
    clearTimeout(otrasTimer);
    // Medio segundo de calma: contar en todas las pestañas a cada tecla sería
    // pedirle trabajo a webs que nadie está mirando.
    otrasTimer = setTimeout(pintaOtras, 500);
  });
  els.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Intro justo después de teclear: primero la búsqueda pendiente (la primera coincidencia).
      if (buscaTimer) { clearTimeout(buscaTimer); buscaTimer = null; buscar(true, false); return; }
      buscar(!e.shiftKey, true);
    }
    else if (e.key === 'Escape') { e.preventDefault(); cerrarBuscar(); }
  });
  els.findNext?.addEventListener('click', () => { buscar(true, true); els.findInput.focus(); });
  els.findPrev?.addEventListener('click', () => { buscar(false, true); els.findInput.focus(); });
  els.findClose?.addEventListener('click', cerrarBuscar);
  pintaRecuento(0, 0);
}

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
  window.navirisApp.lensImagen({ src, pagina }).then((r) => {
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
window.navirisApp.onContextAction(({ tipo, datos }) => {
  if (tipo === 'buscar') { const u = toUrl(datos); if (u) createTab(u); return; }
  if (tipo === 'lens') { buscarConLens(datos); return; }
  if (tipo === 'pantalla-completa') { window.navirisApp.toggleFullscreen(); return; }
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
    renderLibreria();
    els.dialModal.classList.remove('hidden');
    els.dialName.focus(); els.dialName.select();
    return;
  }
  if (tipo === 'rat') {
    // El Rat Tool prefiere la URL de la página (así reconoce YouTube, TikTok…);
    // la del propio <video> solo sirve de repuesto para archivos sueltos.
    const url = /^https?:/.test(datos.pagina || '') ? datos.pagina : (datos.src || '');
    if (!url) { toast('No se pudo identificar ese video'); return; }
    if (els.ratPop.classList.contains('hidden')) els.sbRat.click();
    setTimeout(() => { els.ratUrl.value = url; updateRatPlat(); els.ratQrow.classList.add('hidden'); loadRatQualities(); }, 60);
  }
});

/* Paneles laterales: recursos gráficos, rendimiento, historial y borrar datos de navegación. */

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
  if (!tab || tab.kind !== 'web' || !tab.webview) { els.mpGrid.innerHTML = '<div class="mp-empty">Abre una página web para detectar sus imágenes y videos.</div>'; els.mpTitle.textContent = 'Recursos gráficos'; return; }
  els.mpGrid.innerHTML = '<div class="mp-empty">Escaneando la página…</div>';
  let r = [];
  try { r = await tab.webview.executeJavaScript(`(${mediaCollector.toString()})()`); } catch { /* nada */ }
  // Corre en el mundo de la página y la web puede falsear lo que devuelve: se
  // queda solo lo que tiene la forma esperada.
  mediaItems = (Array.isArray(r) ? r : []).filter((m) => m && typeof m.url === 'string' && /^https?:/i.test(m.url))
    .map((m) => ({ type: m.type === 'video' ? 'video' : 'image', url: m.url, w: Number(m.w) || 0, h: Number(m.h) || 0 }));
  renderMedia();
}
function renderMedia() {
  const items = mediaItems.filter((m) => mediaFilter === 'all' || m.type === mediaFilter);
  els.mpTitle.textContent = `Recursos gráficos (${items.length})`; els.mpGrid.innerHTML = '';
  if (!items.length) { els.mpGrid.innerHTML = '<div class="mp-empty">No hay recursos de este tipo en esta página.<br>Para videos de streaming usa Rat Tool.</div>'; return; }
  for (const m of items) {
    const card = document.createElement('div'); card.className = 'mp-item'; card.title = m.url;
    let thumb;
    if (m.type === 'image') { thumb = document.createElement('img'); thumb.loading = 'lazy'; thumb.src = m.url; }
    else { thumb = document.createElement('video'); thumb.muted = true; thumb.preload = 'metadata'; thumb.src = m.url; }
    thumb.addEventListener('error', () => { thumb.remove(); const fb = document.createElement('div'); fb.className = 'mi-fallback'; fb.innerHTML = window.icon(m.type === 'video' ? 'film' : 'photo'); card.prepend(fb); });
    const meta = document.createElement('div'); meta.className = 'mi-meta'; const ext = (m.url.split('?')[0].match(/\.(\w{2,4})$/) || [])[1] || m.type;
    const tipo = document.createElement('span'); tipo.textContent = ext.toUpperCase();
    const medida = document.createElement('span'); medida.textContent = m.w && m.h ? m.w + '×' + m.h : '';
    meta.append(tipo, medida);
    const dl = document.createElement('button'); dl.className = 'mi-dl'; dl.title = 'Descargar'; dl.innerHTML = window.icon('arrow-down-tray');
    dl.addEventListener('click', (e) => { e.stopPropagation(); window.navirisApp.download(m.url, IS_PRIVATE); dl.innerHTML = window.icon('check'); card.classList.add('done'); toast('Descarga iniciada'); toggleDownloads(true); });
    card.append(thumb, meta, dl); card.addEventListener('click', () => createTab(m.url)); els.mpGrid.appendChild(card);
  }
}
function toggleMediaPanel(force) { const open = force !== undefined ? force : els.mediaPanel.classList.contains('hidden'); if (open) { closeRightPanels(); els.mediaPanel.classList.remove('hidden'); els.sbMedia.classList.add('open'); collectMedia(); } else { els.mediaPanel.classList.add('hidden'); els.sbMedia.classList.remove('open'); } }
els.sbMedia.addEventListener('click', () => toggleMediaPanel());
$('#mp-close').addEventListener('click', () => toggleMediaPanel(false));
$('#mp-refresh').addEventListener('click', collectMedia);
document.querySelectorAll('.mp-chip').forEach((chip) => chip.addEventListener('click', () => { document.querySelectorAll('.mp-chip').forEach((c) => c.classList.remove('active')); chip.classList.add('active'); mediaFilter = chip.dataset.filter; renderMedia(); }));
els.mpAll.addEventListener('click', () => { const items = mediaItems.filter((m) => mediaFilter === 'all' || m.type === mediaFilter); if (!items.length) { toast('No hay recursos que descargar'); return; } items.forEach((m, i) => setTimeout(() => window.navirisApp.download(m.url, IS_PRIVATE), i * 150)); toast(`Descargando ${items.length} recursos…`); toggleDownloads(true); });

/* ============ Panel de rendimiento ============
   Qué gasta CADA pestaña, no un total que no dice nada. Sale de
   app.getAppMetrics() cruzado con el proceso de cada webview.
   Dos avisos que hay que respetar para que los números no mientan:
   - Chromium mete varias pestañas del MISMO sitio en un solo proceso. Cuando
     pasa, la memoria es la del proceso entero: se marca y NO se suma dos veces.
   - Una pestaña dormida no tiene proceso, así que no gasta nada. Eso no es un
     hueco en la tabla, es justo lo que se quiere ver. */
let perfTimer = null;
const perfMB = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB');

function cierraPerf() {
  if (perfTimer) { clearInterval(perfTimer); perfTimer = null; }
  els.perfPanel?.classList.add('hidden');
  els.sbPerf?.classList.remove('open');
}

function togglePerf(force) {
  const abrir = force !== undefined ? force : els.perfPanel.classList.contains('hidden');
  if (!abrir) { cierraPerf(); return; }
  closeRightPanels();
  els.perfPanel.classList.remove('hidden');
  els.sbPerf.classList.add('open');
  pintaPerf(true);
  // 2 s: suficiente para ver subir una pestaña que se desmadra y lo bastante
  // lento como para no ser, él mismo, un gasto de CPU.
  perfTimer = setInterval(pintaPerf, 2000);
}

const perfFilas = new Map();   // id de pestaña → su fila del panel
async function pintaPerf(reordena) {
  if (!els.perfPanel || els.perfPanel.classList.contains('hidden')) return;
  const web = tabs.filter((t) => t.kind === 'web');
  const lista = web.map((t) => {
    let wcId = null;
    try { wcId = t.asleep ? null : t.webview?.getWebContentsId?.() ?? null; } catch { /* aún no montada */ }
    return { id: t.id, wcId };
  });
  const d = await window.navirisApp.perfTabs(lista).catch(() => null);
  if (!d) return;

  const porId = new Map(d.filas.map((f) => [f.id, f]));
  const conDato = d.filas.filter((f) => f.mb !== null);
  const pico = Math.max(1, ...conDato.map((f) => f.mb));
  const dePestanas = new Set();
  let mbPestanas = 0;
  for (const f of conDato) { if (!dePestanas.has(f.pid)) { dePestanas.add(f.pid); mbPestanas += f.mb; } }

  const caja = (k, v, sub) => `<div class="perf-caja"><span class="perf-k">${k}</span><span class="perf-v">${v}</span><span class="perf-s">${sub}</span></div>`;
  els.perfResumen.innerHTML =
    caja('Naviris', perfMB(d.totalMb), d.totalCpu + ' % de CPU')
    + caja('Pestañas', perfMB(mbPestanas), web.length + (web.length === 1 ? ' abierta' : ' abiertas'))
    + caja('Interfaz', perfMB(d.restoMb), d.procesos + ' procesos');

  /* Las filas se REUTILIZAN y solo cambian sus datos: rehacerlas cada 2 s se
     comía el clic que caía en medio (el botón ya era otro) y las movía bajo el
     cursor. Se ordenan por memoria solo al abrir el panel. */
  const vivas = new Set(web.map((t) => t.id));
  for (const [id, fila] of perfFilas) if (!vivas.has(id)) { fila.remove(); perfFilas.delete(id); }
  const orden = reordena ? web.slice().sort((a, b) => ((porId.get(b.id)?.mb) || -1) - ((porId.get(a.id)?.mb) || -1)) : web;
  for (const t of orden) {
    const f = porId.get(t.id) || {};
    let fila = perfFilas.get(t.id);
    if (!fila) {
      fila = document.createElement('div');
      fila.innerHTML = `
        <img class="perf-fav" alt="" />
        <div class="perf-info"><div class="perf-tit"></div><div class="perf-sub"></div><div class="perf-barra"><i></i></div></div>
        <div class="perf-num"><div class="perf-mb"></div><div class="perf-cpu"></div></div>
        <button class="perf-acc"></button>`;
      fila.addEventListener('click', (e) => { if (!e.target.closest('.perf-acc')) activateTab(t.id); });
      fila.querySelector('.perf-acc').addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.asleep) { activateTab(t.id); return; }
        if (t.id === activeId || t.id === divId) { toast('No se duerme la pestaña que estás viendo'); return; }
        if (t.autoLoot) { toast('AutoClaim la mantiene despierta para seguir contando'); return; }
        duermePestana(t); renderTabs(); pintaPerf();
      });
      const img = fila.querySelector('.perf-fav');
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      perfFilas.set(t.id, fila);
      els.perfList.appendChild(fila);
    } else if (reordena) els.perfList.appendChild(fila);   // al final, en el orden nuevo
    fila.className = 'perf-fila' + (t.id === activeId ? ' activa' : '') + (t.asleep ? ' perf-dormida' : '');
    // De un espacio protegido que no se ha abierto en esta sesión no se enseña ni el título ni el dominio.
    const cerrado = (() => { const e = espacioDeTab(t); return e && e.bloqueado && !espDesbloqueados.has(e.id) ? e : null; })();
    const host = cerrado ? '' : hostDeTab(t);
    const sub = t.asleep ? 'Dormida — no gasta nada'
      : f.comparten > 1 ? `${host} — comparte proceso con ${f.comparten - 1} más`
        : host;
    const hayMb = f.mb !== null && f.mb !== undefined;
    fila.querySelector('.perf-tit').textContent = cerrado ? 'Pestaña en ' + cerrado.nombre : (t.title || host || 'Pestaña');
    fila.querySelector('.perf-sub').textContent = sub;
    const barra = fila.querySelector('.perf-barra');
    barra.style.display = hayMb ? '' : 'none';
    if (hayMb) barra.firstElementChild.style.width = Math.round((f.mb / pico) * 100) + '%';
    fila.querySelector('.perf-mb').textContent = hayMb ? perfMB(f.mb) : '—';
    const cpu = fila.querySelector('.perf-cpu');
    cpu.textContent = f.cpu !== null && f.cpu !== undefined ? f.cpu + ' %' : '';
    cpu.classList.toggle('alta', (f.cpu || 0) >= 15);
    const acc = fila.querySelector('.perf-acc'), accTit = t.asleep ? 'Despertar' : 'Dormir esta pestaña';
    if (acc.title !== accTit) { acc.title = accTit; acc.innerHTML = window.icon(t.asleep ? 'arrow-path' : 'moon-zzz'); }
    const favImg = fila.querySelector('.perf-fav'), fav = t.favicon && !cerrado ? t.favicon : '';
    if ((favImg.getAttribute('src') || '') !== fav) {   // por .src, NUNCA interpolado en el HTML
      favImg.style.visibility = '';
      if (fav) favImg.src = fav; else favImg.removeAttribute('src');
    }
  }
  els.perfNota.textContent = 'Dormir una pestaña libera su proceso entero. Naviris ya lo hace solo a los 30 minutos sin usarla.';
}

els.sbEspacios?.addEventListener('click', alternaEspacios);
els.sbPerf?.addEventListener('click', () => togglePerf());
els.perfClose?.addEventListener('click', () => togglePerf(false));

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
    ponFavicon(ic, h.url);
    const info = document.createElement('div'); info.className = 'hist-info';
    info.innerHTML = `<div class="hist-t">${escapeHtml(h.title || h.url)}</div><div class="hist-u">${escapeHtml(hostOf(h.url))}</div>`;
    const time = document.createElement('span'); time.className = 'hist-time'; time.textContent = new Date(h.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const x = document.createElement('button'); x.className = 'hist-x'; x.title = 'Quitar'; x.innerHTML = window.icon('x-mark');
    x.addEventListener('click', (e) => { e.stopPropagation(); history = history.filter((y) => y.url !== h.url); guardaHistorial(); renderHistory(); });
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
    history = []; guardaHistorial(); renderHistory(); toast('Historial borrado');
  });
})

/* ===== BORRAR DATOS DE NAVEGACIÓN (Ctrl+Mayús+Supr) =====
   El historial se borra por periodo; cookies y caché siempre enteras, porque
   Electron no deja borrarlas por fechas (lo dice el propio cuadro). */
function abreBorrarDatos() {
  els.menuPop.classList.add('hidden');
  els.datosModal.classList.remove('hidden');
  els.datosBorrar.focus();
}
els.datosCancelar.addEventListener('click', () => els.datosModal.classList.add('hidden'));
els.datosBorrar.addEventListener('click', async () => {
  const hist = els.datosHistorial.checked, cookies = els.datosCookies.checked, cache = els.datosCache.checked;
  if (!hist && !cookies && !cache) { toast('Elige qué quieres borrar'); return; }
  els.datosBorrar.disabled = true;
  try {
    // La privada no tiene historial (y su guardado pisaría el de la normal).
    if (hist && !IS_PRIVATE) {
      const desde = Number(els.datosPeriodo.value) ? Date.now() - Number(els.datosPeriodo.value) : 0;
      history = desde ? history.filter((h) => h.ts < desde) : [];
      guardaHistorial();
      if (!els.historyPanel.classList.contains('hidden')) renderHistory();
    }
    if (cookies || cache) await window.navirisApp.borraDatos({ cookies, cache });
    els.datosModal.classList.add('hidden');
    toast('Datos de navegación borrados');
  } finally { els.datosBorrar.disabled = false; }
});

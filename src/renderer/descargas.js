/* Descargas: panel, avisos de progreso y página de archivos por tipo y fecha. */

/* ============ Descargas ============ */
const dlMeta = new Map(); const dlRows = new Map();
const fmtBytes = (n) => { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const VIEWABLE = /\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|ogg|mp3|wav|m4a|flac|pdf|txt|json|html?)$/i;
function upsertDownload(m) {
  dlMeta.set(m.id, m);
  let row = dlRows.get(m.id);
  const pct = m.percent != null ? m.percent : (m.total ? Math.round(m.received / m.total * 100) : 0);
  const done = m.state === 'completed', error = m.state === 'interrupted' || m.state === 'cancelled';
  if (!row) { row = document.createElement('div'); row.className = 'dl-item'; row.innerHTML = `<div class="dl-top"><div class="dl-kind"></div><div class="dl-info"><div class="dl-name"></div><div class="dl-sub"></div></div><button class="dl-act dl-act2"></button><button class="dl-act"></button></div><div class="dl-bar"><i></i></div>`; dlRows.set(m.id, row); els.dlList.prepend(row); row.addEventListener('click', (e) => { if (e.target.closest('.dl-act')) return; openDownloadInBrowser(m.id); }); }
  row.classList.toggle('done', done); row.classList.toggle('error', error);
  row.querySelector('.dl-kind').innerHTML = window.icon(m.kind === 'audio' ? 'musical-note' : m.kind === 'video' ? 'film' : done ? 'check' : 'arrow-down-tray');
  row.querySelector('.dl-name').textContent = m.name;
  row.querySelector('.dl-sub').textContent = done ? 'Completado · ' + fmtBytes(m.received) + ' · clic para abrir' : error ? (m.state === 'cancelled' ? 'Cancelada' : (m.error ? 'Error: ' + m.error : 'Error')) : ((m.paused ? 'En pausa · ' : '') + pct + '%' + (m.total ? ` · ${fmtBytes(m.received)} / ${fmtBytes(m.total)}` : ''));
  row.querySelector('.dl-sub').title = m.error || '';
  row.querySelector('.dl-bar > i').style.transform = `scaleX(${pct / 100})`;
  // La página de descargas, si está abierta, sigue el progreso en vivo
  if (els.dlPage.classList.contains('active')) renderDlActive();
  const act = row.querySelector('.dl-act:not(.dl-act2)');
  if (done) { act.innerHTML = window.icon('folder'); act.title = 'Mostrar en carpeta'; act.onclick = (e) => { e.stopPropagation(); window.navirisApp.revealDownload(m.id); }; }
  else if (error) { act.innerHTML = window.icon('x-mark'); act.title = 'Cerrar'; act.onclick = (e) => { e.stopPropagation(); row.remove(); dlRows.delete(m.id); }; }
  else { act.innerHTML = window.icon('x-mark'); act.title = 'Cancelar'; act.onclick = (e) => { e.stopPropagation(); window.navirisApp.cancelDownload(m.id); }; }
  accionDescarga(row.querySelector('.dl-act2'), m);
}
/* Pausar y reanudar la que está en curso; reintentar la que falló o se
   canceló (2026-11-03). Solo las del navegador ('file'): las del Rat Tool son
   yt-dlp y no se pueden pausar. La reintentada vuelve como descarga nueva. */
function accionDescarga(b, m) {
  const archivo = m.kind === 'file' && m.state !== 'completed';
  const enCurso = m.state === 'progressing';
  b.classList.toggle('hidden', !archivo);
  if (!archivo) return;
  b.innerHTML = window.icon(enCurso ? (m.paused ? 'play' : 'pause') : 'arrow-path');
  b.title = enCurso ? (m.paused ? 'Reanudar' : 'Pausar') : 'Reintentar';
  b.setAttribute('aria-label', b.title);
  b.onclick = (e) => {
    e.stopPropagation();
    if (enCurso) { if (m.paused) window.navirisApp.resumeDownload(m.id); else window.navirisApp.pauseDownload(m.id); return; }
    window.navirisApp.retryDownload(m.id);
    dlRows.get(m.id)?.remove(); dlRows.delete(m.id); dlMeta.delete(m.id);
    if (els.dlPage.classList.contains('active')) renderDlActive();
  };
}
async function openDownloadInBrowser(id) {
  const m = dlMeta.get(id); if (!m || m.state !== 'completed') return;
  const p = await window.navirisApp.downloadPath(id); if (!p) return;
  if (VIEWABLE.test(p)) createTab('file:///' + p.replace(/\\/g, '/')); else window.navirisApp.openDownload(id);
}
window.navirisApp.onDownloadNew((m) => { dlVivo.set(m.id, m); upsertDownload(m); actualizaDescargasW(); });
/* Cada descarga suena UNA vez: al terminar o al fallar. Cancelarla no suena
   (lo acaba de hacer el usuario). 'failed' es el del motor de descargas. */
const dlSonadas = new Set();
function sonidoDescarga(m) {
  const fin = m.state === 'completed' ? 'descarga' : (m.state === 'interrupted' || m.state === 'failed') ? 'error' : null;
  if (!fin || dlSonadas.has(m.id)) return;
  dlSonadas.add(m.id); suena(fin);
}
window.navirisApp.onDownloadUpdate((m) => { sonidoDescarga(m); dlVivo.set(m.id, m); actualizaDescargasW(); if (m.state === 'completed') document.querySelectorAll('.w-dlw').forEach((el) => llenaHoyDescargas(el)); upsertDownload(m); if (m.state === 'completed') { toast('Descargado: ' + m.name); els.sbDownloads.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 400 }); if (els.dlPage.classList.contains('active')) window.navirisApp.listDownloadFiles().then((f) => { dlpFiles = f; renderDownloadsPage(); }); } });
function toggleDownloads(force) { const open = force !== undefined ? force : els.dlPanel.classList.contains('hidden'); if (open) { closeRightPanels(); els.dlPanel.classList.remove('hidden'); els.sbDownloads.classList.add('open'); } else { els.dlPanel.classList.add('hidden'); els.sbDownloads.classList.remove('open'); } }
els.sbDownloads.addEventListener('click', () => toggleDownloadsPage());
$('#dl-close').addEventListener('click', () => toggleDownloads(false));
$('#dl-clear').addEventListener('click', () => { window.navirisApp.clearDownloads(); for (const [id, row] of dlRows) if (row.classList.contains('done') || row.classList.contains('error')) { row.remove(); dlRows.delete(id); dlMeta.delete(id); } });
function closeRightPanels() { els.mediaPanel.classList.add('hidden'); els.sbMedia.classList.remove('open'); els.dlPanel.classList.add('hidden'); els.sbDownloads.classList.remove('open'); els.pwPanel.classList.add('hidden'); els.sbPasswords.classList.remove('open'); els.historyPanel.classList.add('hidden'); els.sbHistory.classList.remove('open'); els.lootPanel.classList.add('hidden'); els.sbLoot.classList.remove('open'); cierraPerf(); }

/* ============ Página de descargas: archivos reales por tipo y fecha ============ */
const DLP_TYPES = [
  { key: 'all', label: 'Todo' },
  { key: 'image', label: 'Imágenes', re: /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff?)$/i, ico: 'file-image' },
  { key: 'video', label: 'Video', re: /\.(mp4|webm|mkv|mov|avi|m4v)$/i, ico: 'file-video' },
  { key: 'audio', label: 'Música', re: /\.(mp3|wav|m4a|flac|ogg|opus|aac)$/i, ico: 'musical-note' },
  { key: 'doc', label: 'Documentos', re: /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|epub|rtf)$/i, ico: 'file-text' },
  { key: 'zip', label: 'Comprimidos', re: /\.(zip|rar|7z|tar|gz|iso)$/i, ico: 'file-archive' },
  { key: 'app', label: 'Programas', re: /\.(exe|msi|apk)$/i, ico: 'squares-plus' },
  { key: 'other', label: 'Otros' }
];
let dlpFilter = 'all', dlpFiles = [];
const dlpTypeOf = (n) => (DLP_TYPES.find((t) => t.re && t.re.test(n)) || { key: 'other' }).key;
const dlpIcoOf = (n) => (DLP_TYPES.find((t) => t.re && t.re.test(n)) || {}).ico || 'file';
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
/* Las filas se ACTUALIZAN en su sitio: llegan varios avisos de progreso por
   segundo y rehacerlas en cada uno se comía el clic en "Cancelar". Solo se
   rehace la fila que pasa de en curso a fallida (cambia su botón). */
const dlpFilas = new Map();   // id de descarga → { row, failed }
/* Icono del tipo con la marca de hecho debajo: al terminar se cruzan (CSS). */
const dlpIcono = (nombre) => `<span class="dlp-base">${window.icon(dlpIcoOf(nombre))}</span><span class="dlp-ok">${window.icon('check')}</span>`;
function renderDlActive() {
  // Todo lo de esta sesión que NO haya terminado bien: en curso arriba y
  // fallidas visibles (antes desaparecían sin decir nada). La que termina con
  // la página abierta se queda un momento marcada como hecha (.fin) y pasa a
  // la lista de abajo.
  const live = [...dlMeta.values()].filter((m) => m.state !== 'completed' || dlpFilas.has(m.id));
  for (const [id, f] of dlpFilas) {
    const m = dlMeta.get(id);
    if (!m || (m.state !== 'completed' && f.failed !== (m.state !== 'progressing'))) { f.row.remove(); dlpFilas.delete(id); }
  }
  if (!live.length) { els.dlpActive.innerHTML = ''; return; }
  if (!els.dlpActive.querySelector(':scope > .dlp-day')) {
    const h = document.createElement('div'); h.className = 'dlp-day'; h.textContent = 'En curso';
    els.dlpActive.prepend(h);
  }
  for (const m of live) {
    const hecha = m.state === 'completed';
    const failed = !hecha && m.state !== 'progressing';
    const pct = hecha ? 100 : m.percent != null ? Math.round(m.percent) : (m.total ? Math.round(m.received / m.total * 100) : null);
    // Sin Content-Length no hay porcentaje: se muestran los bytes recibidos en
    // vez de un 0% que parecería atascado.
    const sub = hecha ? 'Completado · ' + (fmtBytes(m.received) || '0 B')
      : failed ? (m.state === 'cancelled' ? 'Cancelada' : 'Error: ' + (m.error || 'la descarga se interrumpió'))
      : (m.paused ? 'En pausa · ' : '') + (pct != null
        ? `${pct}% · ${fmtBytes(m.received) || '0 B'}${m.total ? ' / ' + fmtBytes(m.total) : ''}`
        : `${m.paused ? '' : 'Descargando… '}${fmtBytes(m.received) || '0 B'}`);
    let row = dlpFilas.get(m.id)?.row;
    if (!row) {
      row = document.createElement('div'); row.className = 'dlp-row live' + (failed ? ' failed' : '');
      row.innerHTML = `<div class="dlp-ic">${dlpIcono(m.name)}</div>`
        + `<div class="dlp-info"><div class="dlp-name"></div><div class="dlp-sub"></div>`
        + (failed ? '' : '<div class="dlp-bar"><i></i></div>')
        + `</div><div class="dlp-acts"><button class="dlp-pausa"></button><button class="dlp-cancel" title="${failed ? 'Descartar' : 'Cancelar'}" aria-label="${failed ? 'Descartar' : 'Cancelar'}">${window.icon('x-mark')}</button></div>`;
      row.querySelector('.dlp-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        if (failed) { dlMeta.delete(m.id); renderDlActive(); } else window.navirisApp.cancelDownload(m.id);
      });
      dlpFilas.set(m.id, { row, failed });
      els.dlpActive.appendChild(row);
    }
    row.querySelector('.dlp-name').textContent = m.name;
    row.title = m.name;
    row.querySelector('.dlp-sub').textContent = sub;
    row.classList.toggle('pausa', !!m.paused && !failed);
    if (hecha) {
      if (!row.classList.contains('fin')) {
        row.classList.add('fin');
        row.querySelector('.dlp-acts').classList.add('hidden');
        setTimeout(() => { row.remove(); dlpFilas.delete(m.id); renderDownloadsPage(); }, 1600);
      }
    } else accionDescarga(row.querySelector('.dlp-pausa'), m);
    if (!failed) {
      const bar = row.querySelector('.dlp-bar');
      bar.classList.toggle('indet', pct == null);
      bar.firstElementChild.style.transform = `scaleX(${pct != null ? pct / 100 : 1})`;
    }
  }
}
function renderDownloadsPage() {
  renderDlActive();
  els.dlpFilters.innerHTML = '';
  for (const t of DLP_TYPES) {
    const n = t.key === 'all' ? dlpFiles.length : dlpFiles.filter((f) => dlpTypeOf(f.name) === t.key).length;
    if (t.key !== 'all' && !n) continue;
    const b = document.createElement('button');
    b.className = 'dlp-filtro' + (dlpFilter === t.key ? ' on' : '');
    b.setAttribute('aria-pressed', String(dlpFilter === t.key));
    b.textContent = t.label;
    if (n) { const c = document.createElement('span'); c.textContent = n; b.appendChild(c); }
    b.addEventListener('click', () => { dlpFilter = t.key; renderDownloadsPage(); });
    els.dlpFilters.appendChild(b);
  }
  els.dlpList.innerHTML = '';
  // La que acaba de terminar sigue arriba marcada como hecha: no se repite aquí.
  const enCurso = new Set([...dlpFilas.keys()].map((id) => dlMeta.get(id)?.name));
  const files = dlpFiles.filter((f) => !enCurso.has(f.name) && (dlpFilter === 'all' || dlpTypeOf(f.name) === dlpFilter));
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
    row.innerHTML = `<div class="dlp-ic">${dlpIcono(f.name)}</div><div class="dlp-info"><div class="dlp-name"></div><div class="dlp-sub">${fmtBytes(f.size)} · ${when}</div></div><div class="dlp-acts"><button class="dlp-reveal" title="Mostrar en carpeta" aria-label="Mostrar en carpeta">${window.icon('folder')}</button></div>`;
    row.querySelector('.dlp-name').textContent = f.name;
    row.querySelector('.dlp-reveal').addEventListener('click', (e) => { e.stopPropagation(); window.navirisApp.revealDownloadFile(f.name); });
    row.addEventListener('click', () => { if (VIEWABLE.test(f.name)) createTab('file:///' + f.path.replace(/\\/g, '/')); else window.navirisApp.openDownloadFile(f.name); });
    els.dlpList.appendChild(row);
  }
}
async function showDownloadsPage() {
  closeRightPanels();
  tabs.forEach((t) => t.webview?.classList.remove('active'));
  els.hub.classList.remove('active'); hideBookmarkPage(); hideAddonsPage(); cierraNovedadesPagina(true);
  els.dlPage.classList.remove('hidden'); els.dlPage.classList.add('active'); els.sbDownloads.classList.add('open');
  dlpFiles = await window.navirisApp.listDownloadFiles();
  renderDownloadsPage();
}
function hideDownloadsPage() { els.dlPage.classList.remove('active'); els.dlPage.classList.add('hidden'); els.sbDownloads.classList.remove('open'); }
function toggleDownloadsPage() { if (els.dlPage.classList.contains('active')) { hideDownloadsPage(); activateTab(activeId); } else showDownloadsPage(); }
els.dlpFolder.addEventListener('click', () => window.navirisApp.openDownloadsFolder());

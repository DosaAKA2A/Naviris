/* Marcadores con carpetas: barra, página de gestión, importación y dónde se guardan. */

/* ============ Marcadores con carpetas ============ */
let bookmarks = store.get('naviris.bookmarks2', migrateOld());
function migrateOld() { const old = store.get('naviris.bookmarks', null); return Array.isArray(old) ? old.map((b) => ({ type: 'link', title: b.title, url: b.url })) : []; }
/* ===== Dónde se guardan historial y marcadores =====
   Con un espacio protegido activo, los dos van a SU archivo cifrado; si no, al
   almacén de siempre. Todo lo demás de la interfaz sigue leyendo las mismas
   variables `history` y `bookmarks`, así que el panel del historial, la barra
   de marcadores y el importador funcionan igual sin enterarse. */
function espacioProtegidoActivo() {
  const e = espacioActivo ? espacioPorId(espacioActivo) : null;
  return (e && e.bloqueado) ? e : null;
}
function guardaHistorial() {
  const e = espacioProtegidoActivo();
  if (e) { guardaDatosEspacio(e.id); return; }
  store.set('naviris.history', history);
}
function guardaMarcadores() {
  const e = espacioProtegidoActivo();
  if (e) { guardaDatosEspacio(e.id); return; }
  store.set('naviris.bookmarks2', bookmarks);
}
let guardaEspTimer = null;
function guardaDatosEspacio(id) {
  // Se agrupan los guardados: navegar dispara muchos seguidos y cada uno cifra.
  // Los datos se toman AHORA: si en esos 400 ms se cambia de espacio, `history`
  // y `bookmarks` ya son los del General y acababan dentro de este archivo.
  const datos = { historial: history, marcadores: bookmarks };
  clearTimeout(guardaEspTimer);
  guardaEspTimer = setTimeout(() => {
    window.navirisApp.espGuarda(id, datos).catch(() => {});
  }, 400);
}
const saveBm = () => guardaMarcadores();
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
function openFolderPop(folder, anchor) { closeFolderPop(); folderPop = document.createElement('div'); folderPop.className = 'bm-folder-pop'; folder.children.forEach((b) => folderPop.appendChild(makeBmChip(b))); document.body.appendChild(folderPop); const r = anchor.getBoundingClientRect(); folderPop.style.left = Math.max(8, Math.min(r.left, innerWidth - folderPop.offsetWidth - 8)) + 'px'; folderPop.style.top = (r.bottom + 4) + 'px';
  // Una carpeta importada tiene cientos: cabe en la ventana y el resto se alcanza con scroll.
  folderPop.style.maxHeight = (innerHeight - r.bottom - 16) + 'px';
}
function closeFolderPop() { folderPop?.remove(); folderPop = null; }
els.navStar.addEventListener('click', () => {
  const tab = activeTab(); if (!tab || tab.kind !== 'web') return;
  if (findBookmark(tab.url)) removeBookmark(tab.url); else bookmarks.push({ type: 'link', title: tab.title || tab.url, url: tab.url });
  saveBm(); renderBookmarksBar(); syncNavUI(); renderBookmarkTree();
});

/* Página de marcadores */
function showBookmarkPage() { tabs.forEach((t) => t.webview?.classList.remove('active')); els.hub.classList.remove('active'); hideAddonsPage(); hideDownloadsPage(); cierraNovedadesPagina(true); els.bmPage.classList.remove('hidden'); els.bmPage.classList.add('active'); els.sbBookmarks.classList.add('open'); renderBookmarkTree(); }
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
      const ren = document.createElement('button'); ren.title = 'Renombrar'; ren.innerHTML = window.icon('pencil-square'); ren.addEventListener('click', (e) => { e.stopPropagation(); promptModal('Renombrar carpeta', it.name, (v) => { if (v.trim()) { it.name = v.trim(); saveBm(); renderBookmarkTree(); renderBookmarksBar(); } }, { ok: 'Guardar', valor: it.name }); });
      const del = document.createElement('button'); del.className = 'del'; del.title = 'Eliminar carpeta'; del.innerHTML = window.icon('trash');
      // Con marcadores dentro se confirma: una carpeta importada puede tener cientos y no hay deshacer.
      const borra = () => { const i = bookmarks.indexOf(it); if (i !== -1) bookmarks.splice(i, 1); saveBm(); renderBookmarkTree(); renderBookmarksBar(); };
      del.addEventListener('click', (e) => {
        e.stopPropagation(); const n = it.children.length;
        if (!n) { borra(); return; }
        promptConfirm('¿Borrar la carpeta ' + it.name + '?', (n === 1 ? 'Se borra también el marcador que tiene dentro.' : 'Se borran también los ' + n + ' marcadores que tiene dentro.') + ' No se puede deshacer.', borra);
      });
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
  const ic = document.createElement('span'); ic.className = 'bm-ic'; ic.innerHTML = window.icon('bookmark'); ponFavicon(ic, b.url);
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
  }, { ok: 'Mover' });
}
els.bmNewfolder.addEventListener('click', () => promptModal('Nueva carpeta', 'Nombre de la carpeta', (name) => { if (!name.trim()) return; bookmarks.unshift({ type: 'folder', name: name.trim(), children: [] }); saveBm(); renderBookmarkTree(); renderBookmarksBar(); }));
els.bmImport.addEventListener('click', async (e) => {
  e.stopPropagation();
  const avail = await window.navirisApp.importAvailable();
  const items = Object.entries(avail).filter(([, v]) => v.present).map(([key, v]) => ({ label: 'Desde ' + v.label, icon: 'arrow-down-tray', action: () => doImportBookmarks(key, v.label) }));
  if (!items.length) { toast('No se encontró Chrome/Brave/Edge con marcadores'); return; }
  const r = els.bmImport.getBoundingClientRect(); showCtxMenu(r.left, r.bottom + 4, items);
});
async function doImportBookmarks(key, label) {
  const r = await window.navirisApp.importBookmarks(key);
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

/* Menú contextual propio: pestañas, accesos, marcadores, páginas y campos de texto. */

/* ============ Menú contextual de Naviris ============
   UNO para todo (Naviris 3): pestañas, accesos, marcadores y también la página
   y los campos de texto, que antes eran el menú de Windows (ver muestraMenu en
   main.js). Mismo tamaño, iconos y atajos que el resto de la interfaz.
   - Teclado: flechas (con vuelta), Inicio/Fin, Intro o espacio para elegir,
     Esc o Tab para cerrar. Al cerrar sin elegir, el foco vuelve adonde estaba.
   - Nunca se sale de la ventana: se abre hacia el lado que cabe y, si es más
     alto que la ventana, hace scroll dentro.
   - Encima de una página funciona igual: el menú es de la interfaz y se pinta
     sobre el webview. Hacer clic en la página le quita el foco y lo cierra.
   - Movimiento: abre en 200 ms (frena) desde el punto del clic y cierra en
     110 ms (acelera). Abierto con el teclado no se anima. */
let ctxMenuEl = null, ctxFocoPrevio = null;
function closeCtxMenu(devolverFoco = true) {
  const m = ctxMenuEl; if (!m) return;
  ctxMenuEl = null;
  const previo = ctxFocoPrevio; ctxFocoPrevio = null;
  if (devolverFoco && previo?.isConnected && m.contains(document.activeElement)) previo.focus({ preventScroll: true });
  if (previo === els.urlbar) pintaVistaUrl();   // la barra vuelve a su vista si el foco no volvió
  m.classList.remove('abierto');
  m.inert = true;
  setTimeout(() => m.remove(), 140);
}
window.addEventListener('mousedown', (e) => { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu(false); });
window.addEventListener('blur', () => closeCtxMenu(false));
window.addEventListener('resize', () => closeCtxMenu(false));
/* items: { label, icon, kbd, disabled, danger, action } o { sep: true }.
   op.teclado: abierto con el teclado (sin animación y con la primera opción
   marcada). op.foco: adónde vuelve el foco si se cierra sin elegir. */
function showCtxMenu(x, y, items, op = {}) {
  closeCtxMenu(false);
  ctxFocoPrevio = op.foco || (document.activeElement !== document.body ? document.activeElement : null);
  const m = document.createElement('div'); m.className = 'ctx-menu'; m.tabIndex = -1;
  m.setAttribute('role', 'menu'); m.setAttribute('aria-label', op.titulo || 'Menú contextual');
  for (const it of items) {
    if (it.sep) {
      // Sin separadores repetidos ni al principio o al final.
      if (m.lastElementChild && !m.lastElementChild.classList.contains('ctx-sep')) { const s = document.createElement('div'); s.className = 'ctx-sep'; s.setAttribute('role', 'separator'); m.appendChild(s); }
      continue;
    }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.setAttribute('role', 'menuitem'); b.tabIndex = -1; b.disabled = !!it.disabled;
    if (it.label.length > 40) b.title = it.label;   // las muy largas se cortan con puntos suspensivos
    b.innerHTML = `<span class="ctx-ic">${it.icon ? window.icon(it.icon) : ''}</span><span class="ctx-tx">${escapeHtml(it.label)}</span>` + (it.kbd ? `<kbd>${escapeHtml(it.kbd)}</kbd>` : '');
    b.addEventListener('click', (ev) => { ev.stopPropagation(); closeCtxMenu(); it.action(); });
    m.appendChild(b);
  }
  if (m.lastElementChild?.classList.contains('ctx-sep')) m.lastElementChild.remove();
  if (op.teclado) m.classList.add('sin-mov');
  document.body.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight, W = window.innerWidth, H = window.innerHeight;
  const izq = x + w > W - 8 && x - w >= 8;
  const arriba = y + h > H - 8 && y - h >= 8;
  m.style.left = (izq ? x - w : Math.max(8, Math.min(x, W - w - 8))) + 'px';
  m.style.top = (arriba ? y - h : Math.max(8, Math.min(y, H - h - 8))) + 'px';
  m.style.transformOrigin = (izq ? 'right' : 'left') + ' ' + (arriba ? 'bottom' : 'top');
  ctxMenuEl = m;
  m.addEventListener('keydown', teclaMenu);
  // El ratón marca la opción que señala (el teclado sigue desde ahí).
  m.addEventListener('mouseover', (e) => { const b = e.target.closest('.ctx-item'); if (b && !b.disabled) b.focus({ preventScroll: true }); });
  m.addEventListener('mouseleave', () => { if (m === ctxMenuEl) m.focus({ preventScroll: true }); });
  // Clic fuera de la interfaz (en la página): el foco se va y el menú se cierra.
  m.addEventListener('focusout', (e) => { if (m === ctxMenuEl && !m.contains(e.relatedTarget)) closeCtxMenu(false); });
  const primera = op.teclado && m.querySelector('.ctx-item:not(:disabled)');
  (primera || m).focus({ preventScroll: true });
  void m.offsetWidth;   // estado inicial pintado: así la transición arranca desde él
  m.classList.add('abierto');
  window.nvsRepasa?.(m);   // se abre con el botón derecho, que no dispara el repaso del clic
}
function teclaMenu(e) {
  const m = ctxMenuEl; if (!m) return;
  const its = [...m.querySelectorAll('.ctx-item:not(:disabled)')];
  const i = its.indexOf(document.activeElement);
  const ve = (j) => { e.preventDefault(); its[(j + its.length) % its.length]?.focus(); };
  if (e.key === 'ArrowDown') ve(i + 1);
  else if (e.key === 'ArrowUp') ve(i < 0 ? -1 : i - 1);
  else if (e.key === 'Home') ve(0);
  else if (e.key === 'End') ve(-1);
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) its[i].click(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCtxMenu(); }
  else if (e.key === 'Tab') { e.preventDefault(); closeCtxMenu(); }
  e.stopPropagation();   // las teclas del menú no llegan a los atajos de la interfaz
}
/* Los menús que arma el main: el de la página (con el id de su webview) y el
   de los campos de la interfaz. Las coordenadas ya vienen en las de la ventana
   (medido: las del clic derecho de un webview no son relativas a la página).
   Al elegir se devuelve el número de la opción y el main ejecuta su acción. */
window.navirisApp.onMenu((m) => {
  const { x, y } = m;
  let foco = document.activeElement;
  if (m.wc != null) {
    foco = pestanaDeWebContents(m.wc)?.webview;
    if (!foco) return;
  }
  const items = m.items.map((it) => it.sep ? { sep: true } : { label: it.label, icon: it.icon, kbd: it.kbd, disabled: it.disabled, action: () => window.navirisApp.eligeMenu(m.id, it.n) });
  showCtxMenu(x, y, items, { foco, teclado: !!m.teclado, titulo: m.wc != null ? 'Menú de la página' : 'Menú del campo' });
});
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

/* Clic derecho en un campo de texto de la interfaz (barra de direcciones,
   buscar en la página, filtros, ajustes): el menú de editar, con el mismo
   aspecto que los demás. La barra añade «Pegar e ir». Ver 'ui:menu-campo' en
   main.js. Con la tecla de menú se abre en el campo, no donde esté el ratón. */
document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  const el = e.target;
  const texto = el instanceof HTMLInputElement ? /^(text|search|url|email|password|number|tel)$/.test(el.type) : el instanceof HTMLTextAreaElement;
  if (!texto && !(el instanceof HTMLElement && el.isContentEditable)) return;
  e.preventDefault();
  if (document.activeElement !== el) el.focus();
  const valor = texto ? el.value : el.textContent;
  const seleccion = texto ? el.selectionStart !== el.selectionEnd : !!String(getSelection() || '');
  const teclado = !e.pointerType;
  const r = el.getBoundingClientRect();
  window.navirisApp.menuCampo({ urlbar: el === els.urlbar, seleccion, vacio: !valor, teclado,
    x: teclado ? r.left + 12 : e.clientX, y: teclado ? r.bottom + 4 : e.clientY });
});
window.navirisApp.onPegarEIr((texto) => { els.urlbar.value = texto; navigateActive(texto); hideSuggest(); els.urlbar.blur(); });

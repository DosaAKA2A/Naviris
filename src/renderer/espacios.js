/* Espacios (grupos de pestañas, con o sin contraseña) y contenedores (sesiones aparte). */

/* ===== Espacios =====
   Un espacio es un grupo de pestañas: el trabajo por un lado, lo personal por
   otro. Las pestañas de los demás espacios NO se cierran ni se recargan, solo
   dejan de dibujarse en la barra; siguen ahí y siguen contando en el panel de
   rendimiento, que es la verdad y no conviene esconderla.
   Las pestañas sin espacio son las de General. Cambiar de espacio no cierra
   nada: si el espacio al que entras está vacío se te abre una pestaña nueva. */
let espacios = [];        // [{ id, nombre }]
let espacioActivo = null;

const enEspacio = (t) => (t.espacio || null) === (espacioActivo || null);
const espacioPorId = (id) => espacios.find((e) => e.id === id) || null;
const espacioDeTab = (t) => (t && t.espacio ? espacioPorId(t.espacio) : null);
// Un espacio bloqueado navega en SU sesión: ni cookies ni historial compartidos.
const particionDeTab = (t) => {
  if (IS_PRIVATE) return PARTITION;   // la ventana privada no deja nada en disco, ni en un espacio
  if (t.contenedor) return t.contenedor.particion;
  const e = espacioDeTab(t);
  return (e && e.bloqueado && e.particion) ? e.particion : PARTITION;
};
let espDesbloqueados = new Set();
const tabsVisibles = () => tabs.filter(enEspacio);

function guardaEspacios() {
  window.navirisApp.setSettings({ espacios, espacioActivo }).then((s2) => { settings = s2; });
}

function creaEspacio(nombre) {
  const e = { id: Math.random().toString(36).slice(2, 8), nombre: nombre || 'Espacio ' + (espacios.length + 1) };
  espacios.push(e);
  guardaEspacios();
  return e;
}

/* Al salir de un espacio, sus pestañas se DUERMEN: sueltan su proceso entero y
   dejan de gastar. Es la misma siesta que ya hace Naviris a los 30 minutos, solo
   que aquí sabemos seguro que no las estás mirando. Las de AutoClaim se quedan
   despiertas a propósito: existen justo para seguir contando en segundo plano. */
function duermeEspacio(id) {
  for (const t of tabs) {
    if ((t.espacio || null) !== (id || null)) continue;
    if (t.kind !== 'web' || t.asleep || t.autoLoot || !t.webview) continue;
    duermePestana(t);
  }
}

async function cambiaEspacio(id) {
  if (id === (espacioActivo || null)) return;
  const destino = id ? espacioPorId(id) : null;
  if (destino && destino.bloqueado && !espDesbloqueados.has(destino.id)) {
    pideClave(destino, 'Entrar en ' + destino.nombre, async (clave) => {
      const r = await window.navirisApp.espDesbloquea(destino.id, clave);
      if (!r.ok) { toast(r.error || 'Contraseña incorrecta'); return; }
      espDesbloqueados.add(destino.id);
      cambiaEspacio(id);
    });
    return;
  }
  // Al salir de un espacio protegido, lo suyo se guarda y se recupera lo normal.
  const salgoDe = espacioProtegidoActivo();
  if (salgoDe) {
    clearTimeout(guardaEspTimer);   // el guardado agrupado que quedara pendiente ya va en este
    await window.navirisApp.espGuarda(salgoDe.id, { historial: history, marcadores: bookmarks }).catch(() => {});
    history = store.get('naviris.history', []);
    bookmarks = store.get('naviris.bookmarks2', []);
  }
  duermeEspacio(espacioActivo);
  espacioActivo = id;
  if (destino && destino.bloqueado) {
    const r = await window.navirisApp.espDatos(destino.id).catch(() => null);
    if (r && r.ok) {
      history = Array.isArray(r.datos.historial) ? r.datos.historial : [];
      bookmarks = Array.isArray(r.datos.marcadores) ? r.datos.marcadores : [];
    }
  }
  renderBookmarksBar();
  guardaEspacios();
  // Si la pestaña activa ya no se ve, se pasa a la última usada del espacio.
  const activa = tabs.find((t) => t.id === activeId);
  if (!activa || !enEspacio(activa)) {
    const cand = tabsVisibles().sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
    if (cand) activateTab(cand.id);
    else createTab();
  }
  renderTabs(true);
  pintaEspacios();
}

async function borraEspacio(id, clave) {
  const esp = espacioPorId(id);
  const r = await window.navirisApp.espBorra(id, clave || '');
  if (!r.ok) { toast(r.error || 'No se pudo borrar el espacio'); return; }
  /* Borrado desde DENTRO: se sale al General antes de cerrar nada (si no,
     closeTab abría la sustituta en el espacio borrado). Si estaba protegido,
     lo que hay en memoria es SU historial y SUS marcadores: se sueltan sin
     guardar (se van con él) y vuelven los generales. */
  if (espacioActivo === id) {
    if (esp && esp.bloqueado) {
      clearTimeout(guardaEspTimer);
      history = store.get('naviris.history', []);
      bookmarks = store.get('naviris.bookmarks2', []);
      renderBookmarksBar();
      if (typeof renderHistory === 'function' && !els.historyPanel.classList.contains('hidden')) renderHistory();
    }
    espacioActivo = null;
  }
  if (esp && esp.bloqueado) {
    // Bloqueado: se va TODO. Sus pestañas no vuelven al general, porque eran
    // justo las que no debían mezclarse; se cierran con él, y tampoco se
    // pueden reabrir con Ctrl+Mayús+T.
    for (const t of tabs.filter((t2) => t2.espacio === id)) closeTab(t.id, true);
    for (let i = cerradas.length - 1; i >= 0; i--) if (cerradas[i].espacio === id) cerradas.splice(i, 1);
  } else {
    for (const t of tabs) if (t.espacio === id) t.espacio = null;
    for (const c of cerradas) if (c.espacio === id) c.espacio = null;
  }
  espacios = espacios.filter((e) => e.id !== id);
  espDesbloqueados.delete(id);
  guardaEspacios();
  renderTabs(true);
  pintaEspacios();
  toast(esp && esp.bloqueado ? 'Espacio borrado con todo lo que guardaba' : 'Espacio borrado');
}

/* Cuadro de contraseña. Reutiliza el modal que ya existe, en modo password. */
function pideClave(esp, titulo, cb, ayuda) {
  els.promptTitle.innerHTML = escapeHtml(titulo)
    + '<br><span style="font-weight:400;color:var(--text-dim);font-size:13px">'
    + escapeHtml(ayuda || 'Contraseña de este espacio.') + '</span>';
  els.promptInput.style.display = '';
  els.promptInput.type = 'password';
  els.promptInput.value = '';
  els.promptInput.placeholder = 'Contraseña';
  els.promptOk.textContent = 'Aceptar';
  els.promptModal.classList.remove('hidden');
  setTimeout(() => els.promptInput.focus(), 30);
  promptCb = (valor) => { els.promptInput.type = 'text'; cb(valor || ''); };
}

function renombraEspacio(id) {
  const esp = espacioPorId(id); if (!esp) return;
  els.promptTitle.innerHTML = 'Nombre del espacio';
  els.promptInput.style.display = '';
  els.promptInput.type = 'text';
  els.promptInput.value = esp.nombre;
  els.promptInput.placeholder = 'Trabajo, Personal…';
  els.promptOk.textContent = 'Guardar';
  els.promptModal.classList.remove('hidden');
  setTimeout(() => { els.promptInput.focus(); els.promptInput.select(); }, 30);
  promptCb = (valor) => {
    const n = String(valor || '').trim().slice(0, 32);
    if (!n) return;
    esp.nombre = n;
    guardaEspacios();
    pintaEspacios();
    renderTabs(true);
  };
}

function bloqueaEspacio(id) {
  const esp = espacioPorId(id); if (!esp || esp.bloqueado) return;
  pideClave(esp, 'Bloquear ' + esp.nombre, async (clave) => {
    const r = await window.navirisApp.espBloquea(id, clave);
    if (!r.ok) { toast(r.error || 'No se pudo bloquear'); return; }
    // La copia buena es la de main (trae la sal). Si se guardara la de aqui,
    // la sal se perderia y el espacio no se podria abrir nunca mas.
    Object.assign(esp, r.espacio || {});
    espDesbloqueados.add(id);
    guardaEspacios();
    /* Si lo estas protegiendo desde dentro, lo que tenias delante era el
       historial y los marcadores GENERALES: hay que soltarlos ya, o el primer
       guardado los metaria dentro del espacio protegido. */
    if ((espacioActivo || null) === id) {
      const rd = await window.navirisApp.espDatos(id).catch(() => null);
      history = (rd && rd.ok && Array.isArray(rd.datos.historial)) ? rd.datos.historial : [];
      bookmarks = (rd && rd.ok && Array.isArray(rd.datos.marcadores)) ? rd.datos.marcadores : [];
      renderBookmarksBar();
      if (typeof renderHistory === 'function' && !els.historyPanel.classList.contains('hidden')) renderHistory();
    }
    // Las pestañas que ya estaban dentro navegaban en la sesión normal; se
    // recargan en la del espacio para que lo de dentro se quede dentro.
    for (const t of tabs.filter((t2) => t2.espacio === id)) mudaDeSesion(t);
    if (activeTab()?.asleep) activateTab(activeId);
    pintaEspacios();
    renderTabs(true);
    toast('Espacio protegido. Te pedirá la contraseña una vez por sesión');
  }, 'Se te pedirá al entrar, una vez por sesión, y también para borrarlo. Su historial y sus marcadores se guardan cifrados con esta contraseña: si la pierdes, se pierden. Mínimo 4 caracteres.');
}

function pintaEspacios() {
  if (!els.espPop || els.espPop.classList.contains('hidden')) return;
  const cuenta = (id) => tabs.filter((t) => (id === null ? !t.espacio : t.espacio === id)).length;
  els.espPop.innerHTML = '<div class="ep-tit">Espacios</div>';

  const fila = (esp) => {
    const id = esp ? esp.id : null;
    const el = document.createElement('div');
    el.className = 'ep-fila' + ((espacioActivo || null) === id ? ' activo' : '');
    const bloq = esp && esp.bloqueado;
    const abierto = bloq && espDesbloqueados.has(id);
    el.innerHTML = `${bloq ? '<span class="ep-candado" title="' + (abierto ? 'Bloqueado, abierto en esta sesión' : 'Bloqueado: pide contraseña') + '">' + window.icon(abierto ? 'lock-open' : 'lock-closed') + '</span>' : ''}
      <span class="ep-n">${escapeHtml(esp ? esp.nombre : 'General')}</span>
      <span class="ep-c">${cuenta(id)}</span>`;
    if (esp) {
      const acc = document.createElement('span');
      acc.className = 'ep-acc';
      acc.innerHTML = `<button class="ep-b" data-a="nombre" title="Cambiar el nombre">${window.icon('pencil-square')}</button>
        ${bloq ? '' : '<button class="ep-b" data-a="bloquea" title="Bloquear con contraseña">' + window.icon('lock-closed') + '</button>'}
        <button class="ep-b ep-x" data-a="borra" title="Borrar espacio">${window.icon('trash')}</button>`;
      el.appendChild(acc);
      acc.addEventListener('click', (ev) => {
        const b = ev.target.closest('.ep-b'); if (!b) return;
        ev.stopPropagation();
        if (b.dataset.a === 'nombre') renombraEspacio(id);
        else if (b.dataset.a === 'bloquea') bloqueaEspacio(id);
        else if (bloq) {
          pideClave(esp, 'Borrar ' + esp.nombre, (clave) => borraEspacio(id, clave),
            'Se borra el espacio Y todo lo que guardaba: sesiones, cookies y caché. No se puede deshacer.');
        } else {
          promptConfirm('¿Borrar ' + esp.nombre + '?', 'Sus pestañas no se cierran: vuelven al General.', () => borraEspacio(id));
        }
      });
    }
    el.addEventListener('click', (ev) => { if (!ev.target.closest('.ep-acc')) cambiaEspacio(id); });
    // Con Tab: al enfocar la fila aparecen sus acciones (:focus-within) y Enter entra
    el.tabIndex = 0; el.setAttribute('role', 'button');
    el.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === el) { ev.preventDefault(); cambiaEspacio(id); } });
    els.espPop.appendChild(el);
  };

  fila(null);
  espacios.forEach(fila);

  const nuevoBtn = document.createElement('button');
  nuevoBtn.className = 'ep-nuevo';
  nuevoBtn.textContent = '+ Espacio nuevo';
  nuevoBtn.addEventListener('click', () => {
    const e = creaEspacio();
    cambiaEspacio(e.id);   // está vacío: ya abre él su pestaña nueva
    renombraEspacio(e.id);   // recién creado: lo primero es ponerle nombre
  });
  els.espPop.appendChild(nuevoBtn);
}

function alternaEspacios() {
  const abrir = els.espPop.classList.contains('hidden');
  els.espPop.classList.toggle('hidden', !abrir);
  els.sbEspacios.classList.toggle('open', abrir);
  if (abrir) { pintaEspacios(); anclarPop(els.espPop, els.sbEspacios); }
}

/* ===== Contenedores =====
   Un contenedor es una sesión aparte con su propio bote de cookies: sirve para
   tener dos cuentas del mismo sitio abiertas a la vez sin que se pisen. La
   pestaña recuerda en cuál vive, y main prepara esa partición con la MISMA
   identidad y las mismas reglas que la normal antes de que se use. */
const CONT_COLORES = ['#e0603a', '#3a9ae0', '#5cb85c', '#c07ae0', '#e0b03a', '#3ac0b0'];
let contenedores = [];   // [{ id, nombre, particion, color }]

function nuevoContenedor(nombre) {
  const id = Math.random().toString(36).slice(2, 8);
  const c = { id, nombre: nombre || 'Contenedor ' + (contenedores.length + 1), particion: 'persist:cont-' + id, color: CONT_COLORES[contenedores.length % CONT_COLORES.length] };
  contenedores.push(c);
  window.navirisApp.setSettings({ contenedores }).then((s2) => { settings = s2; });
  return c;
}

async function abreEnContenedor(url, cont) {
  await window.navirisApp.contPrepara(cont.particion);
  const tab = createTab(url || null, true, cont);
  return tab;
}

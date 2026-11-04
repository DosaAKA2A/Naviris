/* Hub: pintado, mover y estirar widgets, buscador, reloj, descanso cuando no se ve, recordatorios y pastilla del clima. */

const saveWidgets = () => store.set('naviris.widgets', widgets);
let widgetSeq = 100;

let ultimoCols = 0, dragId = null;
/* El DOCK de accesos (reforma 2.8.1): los mismos .dial de siempre (makeDialEl:
   navegar, reordenar arrastrando en Editar, quitar), en una barra abajo al
   centro. armaDock se engancha UNA vez al contenedor: sus listeners buscan los
   .dial vivos en cada evento, así que repintar el contenido no los duplica. */
function renderDock() {
  const dock = els.hubDock; if (!dock) return;
  dock.innerHTML = '';
  // En la repisa el nombre sale como etiqueta propia encima del icono (.d-name): sin el tooltip del sistema.
  const repisa = dock.classList.contains('repisa');
  dock.style.setProperty('--dk-n', dials.length + 1);   // para encoger los tiles si no caben (CSS)
  dials.forEach((d) => { const el = makeDialEl(d); if (repisa) el.removeAttribute('title'); else el.title = d.name; dock.appendChild(el); });
  const sep = document.createElement('div'); sep.className = 'dk-sep'; dock.appendChild(sep);
  const add = document.createElement('div'); add.className = 'dial add'; if (!repisa) add.title = 'Añadir acceso';
  add.tabIndex = 0; add.setAttribute('role', 'button'); add.setAttribute('aria-label', 'Añadir acceso');
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add.click(); } });
  add.innerHTML = `<div class="d-tile">${window.icon('plus')}</div><div class="d-name">Añadir acceso</div>`;
  add.addEventListener('click', () => { els.dialName.value = ''; els.dialUrl.value = ''; renderLibreria(); els.dialModal.classList.remove('hidden'); els.dialName.focus(); });
  dock.appendChild(add);
  if (!dock.dataset.armado) { armaDock(dock); dock.dataset.armado = '1'; }
}
/* LISTAS SIN SCROLL (tendencias, correo, descargas, portapapeles): solo se
   enseñan las filas que CABEN completas. Se mide en pantalla
   (getBoundingClientRect): offsetTop cuenta desde el widget mientras la lista
   no está posicionada y escondía filas que cabían; en el portapapeles 2x1 no
   cabía ni la primera. Eran cuatro copias de lo mismo, medidas UNA vez: con el
   hub escalado la letra pequeña tiene suelo y la proporción cambia con la
   escala, así que ahora cada lista se recuerda y se vuelve a medir cuando la
   escala se asienta (remideListas, desde reencuadra). */
const listasRecortadas = new Map();   // lista -> [selector de fila, holgura en px]
function mideFilas(cont, sel, holgura) {
  const filas = cont.querySelectorAll(sel);
  filas.forEach((f) => { f.style.display = ''; });
  const tope = cont.getBoundingClientRect().bottom;
  filas.forEach((f) => { if (f.getBoundingClientRect().bottom > tope + holgura) f.style.display = 'none'; });
}
function recortaFilas(cont, sel, holgura = 0.5) {
  listasRecortadas.set(cont, [sel, holgura]);
  requestAnimationFrame(() => { if (cont.isConnected) mideFilas(cont, sel, holgura); });
}
function remideListas() {
  for (const [cont, [sel, holgura]] of listasRecortadas) {
    if (cont.isConnected) mideFilas(cont, sel, holgura); else listasRecortadas.delete(cont);
  }
}
function renderHub() {
  renderDock();
  els.widgetGrid.innerHTML = '';
  // Las pastillas de la esquina DUPLICAN widgets: con el widget presente en el
  // hub, su pastilla sobra (y en pantallas normales chocaba con la columna
  // derecha). El conmutador de tema, que no tiene widget, se queda. Va ANTES
  // de medir: lo que ocupa la esquina entra en las cuentas del encuadre.
  const tipos = new Set(widgets.map((x) => x.type));
  document.getElementById('hub-account')?.classList.toggle('hidden', tipos.has('user'));
  document.getElementById('hub-weather')?.classList.toggle('hidden', tipos.has('weather'));
  const m = medidasMalla();
  const reflujo = m.modo === 'reflujo';
  ultimasFilas = reflujo ? 400 : FILAS_MAESTRA;
  els.hub.classList.toggle('con-scroll', m.modo !== 'maqueta');
  els.hub.classList.toggle('reflujo', reflujo);
  const cols = m.cols; ultimoCols = cols;
  els.widgetGrid.style.gridTemplateColumns = `repeat(${cols}, ${CELDA_W}px)`;
  // Filas SIEMPRE explicitas: si la grilla solo creaba las usadas, el bloque
  // centrado quedaba desplazado respecto a la malla de guias. En reflujo van
  // implicitas: las filas las pone el contenido, no un numero fijo (las 60 de
  // antes creaban 10.000px de vacio con la mitad fuera del scroll). Con scroll
  // y sin editar se pintan hasta la última OCUPADA: las vacías de debajo solo
  // alargarían el recorrido.
  const filasPintadas = (m.modo === 'scroll' && m.caja && !els.hub.classList.contains('editing')) ? m.caja.r1 : FILAS_MAESTRA;
  els.widgetGrid.style.gridTemplateRows = reflujo ? 'none' : `repeat(${filasPintadas}, ${CELDA_H}px)`;
  els.widgetGrid.style.gridAutoRows = `${CELDA_H}px`;
  els.widgetGrid.style.gap = `${CELDA_GAP}px`;
  // Alto de los accesos y empuje de los de abajo: SOLO para esta pintada. En
  // reflujo no aplica, que ahí manda el orden de lectura.
  const ajus = reflujo ? new Map() : ajustaAccesos();
  const occ = new Set();
  /* En REFLUJO manda el orden de lectura de tu maqueta (arriba a abajo,
     izquierda a derecha), PERO el buscador y los accesos van SIEMPRE los
     primeros y a todo lo ancho: son lo primero que se usa del hub y tienen
     que quedar arriba y en el centro, caiga la ventana como caiga. */
  const MANDAN = { search: 0, shortcuts: 1 };
  const rango = (x) => (x.type in MANDAN ? MANDAN[x.type] : 2);
  /* Buscador y accesos se COLOCAN los primeros SIEMPRE, no solo en reflujo
     (2026-08-18): son lo primero que se usa del hub, así que si alguna vez hay
     pelea por una celda la ganan ellos y nunca se quedan sin pintar. Con la
     maqueta sana esto no mueve nada —no hay solapes— y el resto conserva su
     orden porque el sort es estable. */
  const enOrden = [...widgets].sort((a, b) => {
    const ga = (a.geo && a.geo.m) || a, gb = (b.geo && b.geo.m) || b;
    if (!reflujo) return rango(a) - rango(b);
    return (rango(a) - rango(b)) || (ga.row - gb.row) || (ga.col - gb.col);
  });
  for (const w of enOrden) {
    // UNA sola maqueta: geo.m. Ya no hay membresia por forma de ventana, así
    // que ningun widget puede "no pertenecer" y desaparecer.
    const g = w.geo && w.geo.m;
    if (g) { w.col = g.col; w.row = g.row; w.w = g.w; w.h = g.h; }
    const aj = ajus.get(w.id);   // ajuste de los accesos: vive solo en esta pintada
    if (aj) { w.row = aj.row; w.h = aj.h; }
    let [tw, th] = tallaValida(w); if (tw > cols) tw = cols; w.w = tw; w.h = th;
    // Buscador y accesos, a todo el ancho en reflujo (no se guarda: es solo
    // como se muestran mientras la ventana no da para la maqueta real).
    if (reflujo && (w.type === 'search' || w.type === 'shortcuts')) {
      // El buscador ya es una baldosa (reforma 2.8.1): a todo lo ancho salia una
      // losa gigante. Cuatro celdas bastan y sigue yendo el primero.
      tw = w.type === 'search' ? Math.min(4, cols) : cols;
      // A todo lo ancho los accesos caben en menos filas: se recalcula el alto
      // SOLO para pintar (guardarlo sería tocar la maqueta real), si no queda
      // un boquete debajo del tamaño que tienen en tu composición.
      if (w.type === 'shortcuts') th = altoAccesos({ w: tw });
    }
    let cc = reflujo ? 0 : w.col, rr = reflujo ? 0 : w.row;
    if (!(cc >= 1 && rr >= 1) || !libre(occ, cc, rr, tw, th, cols)) {
      const pos = primerHueco(occ, tw, th, cols);
      if (!pos) continue; // sin sitio visible: oculto hasta liberar celdas
      cc = pos.col; rr = pos.row;
      // Lo que se recoloca por el TAMAÑO DE LA VENTANA no se guarda jamás:
      // era exactamente lo que le destrozaba la maqueta a Dosa al abrir en
      // ventana pequeña. Solo persiste lo que se mueve en modo edición.
      // El fijaGeo que había aquí escribía en geo.m y hacía justo lo que el
      // comentario decía que no pasaba: el primer arrastre posterior guardaba
      // la maqueta ya descolocada (2026-08-18). Solo se toca la posición de
      // esta pintada, que es la que necesitan arrastre y redimensión.
      if (!reflujo) { w.col = cc; w.row = rr; }
    }
    ocupa(occ, { col: cc, row: rr, w: tw, h: th });
    const el = document.createElement('div'); el.className = 'widget'; el.dataset.id = w.id;
    el.style.gridColumn = `${cc} / span ${tw}`;
    el.style.gridRow = `${rr} / span ${th}`;
    const body = document.createElement('div');
    if (w.type === 'clock') {
      // Reloj-TARJETA del bento (2026-08-11): texto a la izquierda y chip del
      // día FUNDIDO en la esquina (scoop). Deja de ser un texto suelto centrado.
      body.className = 'w-card w-clock';
      body.innerHTML = `<div class="time"></div><div class="greet"></div><div class="ck-fecha"></div>`;
    }
    else if (w.type === 'search') { body.className = 'w-searchwrap'; body.appendChild(buildSearch()); }
    else if (w.type === 'shortcuts') { body.className = 'w-card w-shortcuts'; const g = document.createElement('div'); g.className = 'sc-grid'; dials.forEach((d) => g.appendChild(makeDialEl(d))); const add = document.createElement('div'); add.className = 'dial add'; add.innerHTML = `<div class="d-tile">${window.icon('plus')}</div><div class="d-name">Añadir</div>`; add.addEventListener('click', () => { els.dialName.value = ''; els.dialUrl.value = ''; els.dialModal.classList.remove('hidden'); els.dialName.focus(); }); g.appendChild(add); body.appendChild(g); armaDock(g); }
    else if (w.type === 'date') { body.className = 'w-card w-date'; renderDate(body); }
    else if (w.type === 'weather') { body.className = 'w-card w-wx'; body.innerHTML = '<div class="w-loading">Cargando clima…</div>'; loadWeather(body, 'weather'); }
    else if (w.type === 'region') { body.className = 'w-card w-weather'; body.innerHTML = '<div class="w-loading">Cargando región…</div>'; loadWeather(body, 'region'); }
    else if (w.type === 'notes') { body.className = 'w-card w-notes'; renderNotasW(body); }
    else if (w.type === 'spotify') { body.className = 'w-card w-sp sp-vacio'; renderSpotify(body); }
    else if (w.type === 'calendar') { body.className = 'w-card w-cal'; renderCalendar(body); }
    else if (w.type === 'user') { body.className = 'w-card w-user'; renderUserCard(body); }
    else if (w.type === 'xtrends') { body.className = 'w-card w-xt'; renderXTrends(body); }
    else if (w.type === 'imagen') { body.className = 'w-card w-img'; renderImagen(body, w); }
    else if (w.type === 'mail') { body.className = 'w-card w-mail'; renderMail(body); }
    else if (w.type === 'descargas') { body.className = 'w-card w-dlw'; renderDescargasW(body); }
    else if (w.type === 'privada') { body.className = 'w-card w-priv'; renderPrivadaW(body); }
    else if (w.type === 'monitor') { body.className = 'w-card w-mon'; renderMonitorW(body); }
    else if (w.type === 'moovin') { body.className = 'w-card w-moov'; renderMoovinW(body); }
    else if (w.type === 'clip') { body.className = 'w-card w-clip'; renderClipW(body); }
    else if (w.type === 'deco') { body.className = 'w-card w-deco'; body.innerHTML = '<span class="dc-a"></span><span class="dc-b"></span><span class="dc-c"></span>'; }
    else if (w.type === 'wallet') { body.className = 'w-card w-wallet'; renderWalletW(body); }
    else if (w.type === 'auth') { body.className = 'w-card w-auth'; renderAuthW(body); }
    body.classList.add('t-' + tw + 'x' + th); // talla para CSS estructural
    if (body.parentNode !== el) el.appendChild(body);

    // Herramientas de edición
    const tools = document.createElement('div'); tools.className = 'w-tools';
    const grip = document.createElement('button'); grip.title = 'Arrastra para mover'; grip.innerHTML = window.icon('grip');
    const size = document.createElement('button'); size.title = 'Cambiar tamaño'; size.innerHTML = window.icon('arrows-pointing-out'); size.addEventListener('click', (e) => {
      e.stopPropagation();
      const lista = TAMANOS[w.type] || [[2, 1]];
      const i = lista.findIndex(([a, b]) => a === w.w && b === w.h);
      const sig = lista[(i + 1) % lista.length];
      const tw = Math.min(sig[0], ultimoCols), th = sig[1];
      // validar ANTES de cambiar: sin sitio para la talla nueva, se avisa y no
      // se toca nada (antes el widget se quedaba oculto por no caber)
      if (!empuja(w, tw, th)) { toast(`No hay sitio para ${tw}×${th} — ni empujando vecinos`); return; }
      saveWidgets(); renderHub();
    });
    const rm = document.createElement('button'); rm.className = 'rm'; rm.title = 'Quitar widget'; rm.innerHTML = window.icon('x-mark'); rm.addEventListener('click', (e) => {
      e.stopPropagation();
      // Con una sola maqueta, quitar es quitar (antes solo lo sacaba de la
      // composicion activa y seguia vivo en las otras).
      widgets = widgets.filter((x) => x.id !== w.id);
      saveWidgets(); renderHub();
    });
    tools.append(grip, size, rm); el.appendChild(tools);
    if (LIBRES.has(w.type)) { armaRedim(el, w, 'r'); armaRedim(el, w, 'b'); armaRedim(el, w, 'rb'); }

    // Drag: el widget solo se declara arrastrable; la celda destino la
    // resuelve la GRILLA (armaDnd), como mover iconos en un movil.
    el.draggable = false;
    grip.addEventListener('mousedown', () => { el.draggable = true; });
    el.addEventListener('dragstart', (e) => { el.classList.add('dragging'); dragId = w.id; els.hub.classList.add('arrastrando'); e.dataTransfer.setData('text/plain', w.id); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); el.draggable = false; dragId = null; els.hub.classList.remove('arrastrando'); document.getElementById('celda-fantasma')?.remove(); });
    // Orden de entrada para el escalonado del arranque (#hub.estrenando)
    el.style.setProperty('--i', els.widgetGrid.childElementCount);
    els.widgetGrid.appendChild(el);
  }
  // Guias de la grilla (visibles solo en modo Editar): todas las celdas con
  // contorno suave y el EJE CENTRAL (columna/fila del medio) tintado leve.
  // Guias como CAPA SUPERPUESTA (2026-08-12): antes eran items de la grilla y
  // anadian filas — al entrar en Editar todo saltaba hacia arriba. Ahora no
  // ocupan layout: se dibujan con gradientes sobre la malla real.
  // Guias: las CELDAS punteadas de siempre, pero dentro de una capa
  // superpuesta (no son items de la grilla, asi no anaden filas ni mueven
  // nada al entrar en Editar). El centro tine las dos centrales si el numero
  // es par, para que quede el mismo numero de celdas a cada lado.
  // En reflujo no hay guias: no se puede componer (y con las filas del
  // contenido serian miles de celdas dibujadas para nada).
  const malla = document.createElement('div'); malla.className = 'gmalla';
  const filasGuia = reflujo ? 0 : filasPintadas;
  const midCols = cols % 2 ? [(cols + 1) / 2] : [cols / 2, cols / 2 + 1];
  const midFilas = filasGuia % 2 ? [(filasGuia + 1) / 2] : [filasGuia / 2, filasGuia / 2 + 1];
  for (let r = 1; r <= filasGuia; r++) for (let c = 1; c <= cols; c++) {
    const g = document.createElement('div'); g.className = 'gcelda';
    if (midCols.includes(c) || midFilas.includes(r)) g.classList.add('gc-centro');
    g.style.left = ((c - 1) * (CELDA_W + CELDA_GAP)) + 'px';
    g.style.top = ((r - 1) * (CELDA_H + CELDA_GAP)) + 'px';
    g.style.width = CELDA_W + 'px'; g.style.height = CELDA_H + 'px';
    malla.appendChild(g);
  }
  // La rejilla ya no lleva padding ni centrado propio (la coloca aplicaEncuadre):
  // la capa de guías va pegada a su esquina, en px de diseño como las celdas.
  malla.style.width = hubEscala.tam(cols) + 'px';
  malla.style.height = Math.max(0, hubEscala.tam(filasGuia)) + 'px';
  els.widgetGrid.appendChild(malla);
  aplicaEncuadre(m);
  armaDnd();
  /* AL TOPE en cada recomposición. Si venías con la ventana pequeña y el hub
     desplazado, al maximizar la maqueta entera NO lleva scroll: el contenedor
     conservaba el desplazamiento viejo y te quedabas mirando el final, sin
     forma de subir (overflow hidden). Recomponer = empezar arriba. */
  const scr = els.hub.querySelector('.hub-scroll');
  if (scr && scr.scrollTop) scr.scrollTop = 0;
  // Los contenedores que scrollean dentro de los widgets acaban de nacer:
  // se enganchan al scroll propio (nunca la barra del sistema).
  if (window.nvsRepasa) requestAnimationFrame(window.nvsRepasa);
  tickClock();
}
/* Motor de arrastre de la grilla: fantasma verde/rojo bajo el cursor; soltar
   coloca si el area esta libre, intercambia si cae sobre otro y AMBOS caben,
   y avisa si no hay sitio. */
/* El ratón va en px de pantalla y la rejilla está escalada: el rectángulo de
   getBoundingClientRect ya viene con el zoom, y el paso de celda se multiplica
   por la escala (hubEscala.celdaEn). */
function celdaDe(e) {
  return hubEscala.celdaEn(e.clientX, e.clientY, els.widgetGrid.getBoundingClientRect(), encuadreHub.s);
}
/* Estirar por los BORDES (modo Editar, tallas libres): arrastras el asa y la
   caja crece/encoge por celdas con vista previa; si el rectangulo final pisa
   a otro, se revierte con aviso. */
/* EMPUJE al redimensionar (como un movil): la talla nueva se queda donde
   esta y los vecinos que estorben se recolocan al primer hueco; solo se
   niega si fisicamente no caben todos. */
function empuja(w, tw, th) {
  const col = Math.max(1, Math.min(w.col, ultimoCols - tw + 1));
  const row = Math.max(1, Math.min(w.row, ultimasFilas - th + 1));
  if (col + tw - 1 > ultimoCols || row + th - 1 > ultimasFilas) return false;
  const rect = { col, row, w: tw, h: th };
  const vive = (x) => x.geo && x.geo.m;
  const desplazados = delBucket().filter((x) => x.id !== w.id && vive(x) &&
    rect.col < x.col + x.w && rect.col + tw - 1 >= x.col && rect.row < x.row + x.h && rect.row + th - 1 >= x.row);
  const occ = new Set();
  delBucket().forEach((x) => { if (x.id !== w.id && vive(x) && !desplazados.includes(x)) ocupa(occ, x); });
  ocupa(occ, rect);
  const plan = [];
  for (const d of desplazados) {
    const pos = primerHueco(occ, d.w, d.h, ultimoCols);
    if (!pos) return false;
    plan.push([d, pos]); ocupa(occ, { col: pos.col, row: pos.row, w: d.w, h: d.h });
  }
  plan.forEach(([d, pos]) => { d.col = pos.col; d.row = pos.row; fijaGeo(d); });
  w.col = col; w.row = row; w.w = tw; w.h = th; fijaGeo(w);
  return true;
}
function armaRedim(el, w, dir) {
  const asa = document.createElement('div'); asa.className = 'w-redim ' + dir;
  asa.addEventListener('mousedown', (e) => {
    if (!els.hub.classList.contains('editing')) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, w0 = w.w, h0 = w.h;
    const occ = new Set(); delBucket().forEach((x) => { if (x.id !== w.id) ocupa(occ, x); });
    const mueve = (ev) => {
      let nw = w0, nh = h0;
      if (dir.includes('r')) nw = Math.max(1, w0 + hubEscala.celdasDe(ev.clientX - x0, encuadreHub.s));
      if (dir.includes('b')) nh = Math.max(1, h0 + hubEscala.celdasDe(ev.clientY - y0, encuadreHub.s));
      nw = Math.min(nw, ultimoCols - w.col + 1);
      el.style.gridColumn = w.col + ' / span ' + nw;
      el.style.gridRow = w.row + ' / span ' + nh;
      el.classList.toggle('redim-mal', !libre(occ, w.col, w.row, nw, nh, ultimoCols));
      el.dataset.nw = nw; el.dataset.nh = nh;
    };
    const suelta = () => {
      window.removeEventListener('mousemove', mueve); window.removeEventListener('mouseup', suelta);
      const nw = +el.dataset.nw || w0, nh = +el.dataset.nh || h0;
      if ((nw !== w0 || nh !== h0) && !empuja(w, nw, nh)) toast('Ahí no cabe ni empujando vecinos');
      saveWidgets(); renderHub();
    };
    window.addEventListener('mousemove', mueve); window.addEventListener('mouseup', suelta);
  });
  el.appendChild(asa);
}
function armaDnd() {
  if (els.widgetGrid.dataset.dnd) return; els.widgetGrid.dataset.dnd = '1';
  els.widgetGrid.addEventListener('dragover', (e) => {
    if (!dragId) return; e.preventDefault();
    const wd = widgets.find((x) => x.id === dragId); if (!wd) return;
    const pos = celdaDe(e);
    const occ = new Set(); delBucket().forEach((x) => { if (x.id !== dragId) ocupa(occ, x); });
    let g = document.getElementById('celda-fantasma');
    if (!g) { g = document.createElement('div'); g.id = 'celda-fantasma'; els.widgetGrid.appendChild(g); }
    g.style.gridColumn = pos.col + ' / span ' + wd.w;
    g.style.gridRow = pos.row + ' / span ' + wd.h;
    g.classList.toggle('mal', !libre(occ, pos.col, pos.row, wd.w, wd.h, ultimoCols));
  });
  els.widgetGrid.addEventListener('drop', (e) => {
    e.preventDefault(); document.getElementById('celda-fantasma')?.remove();
    const wd = widgets.find((x) => x.id === dragId); if (!wd) return;
    const pos = celdaDe(e);
    const occ = new Set(); delBucket().forEach((x) => { if (x.id !== wd.id) ocupa(occ, x); });
    if (libre(occ, pos.col, pos.row, wd.w, wd.h, ultimoCols)) { wd.col = pos.col; wd.row = pos.row; fijaGeo(wd); }
    else {
      // cae sobre otro: intercambio de posiciones si AMBOS caben tras el cambio
      const b = delBucket().find((x) => x.id !== wd.id && pos.col < x.col + x.w && pos.col + wd.w - 1 >= x.col && pos.row < x.row + x.h && pos.row + wd.h - 1 >= x.row);
      if (b) {
        const occ2 = new Set(); delBucket().forEach((x) => { if (x.id !== wd.id && x.id !== b.id) ocupa(occ2, x); });
        const cabeA = libre(occ2, b.col, b.row, wd.w, wd.h, ultimoCols);
        const t = new Set(occ2); if (cabeA) ocupa(t, { col: b.col, row: b.row, w: wd.w, h: wd.h });
        const cabeB = cabeA && libre(t, wd.col, wd.row, b.w, b.h, ultimoCols);
        if (cabeA && cabeB) { const pa = { col: b.col, row: b.row }; b.col = wd.col; b.row = wd.row; wd.col = pa.col; wd.row = pa.row; fijaGeo(wd); fijaGeo(b); }
        else toast('Ahí no cabe');
      } else toast('Ahí no cabe');
    }
    saveWidgets(); renderHub();
  });
}
function buildSearch() {
  const form = document.createElement('form'); form.id = 'hub-search';
  form.innerHTML = `<span class="g-ico">${window.icon('magnifying-glass')}</span><input id="hub-search-input" type="text" spellcheck="false" placeholder="Buscar en Google" /><kbd title="Presiona / para buscar">/</kbd>`;
  form.addEventListener('submit', (e) => { e.preventDefault(); const inp = form.querySelector('input'); navigateActive(inp.value); inp.value = ''; });
  return form;
}
// "/" enfoca el buscador del hub (como en GitHub o YouTube), si no estás escribiendo
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!els.hub.classList.contains('active')) return;
  const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  const inp = document.getElementById('hub-search-input'); if (inp) { e.preventDefault(); inp.focus(); }
});
function renderDate(el) {
  const now = new Date(); const day = now.getDate();
  // Mayúscula solo al principio de cada línea: con text-transform salía "Octubre De 2026"
  const may = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const wd = may(now.toLocaleDateString('es', { weekday: 'long' })); const mo = may(now.toLocaleDateString('es', { month: 'long', year: 'numeric' }));
  el.innerHTML = `<div class="d-day">${day}</div><div class="d-rest">${wd}<br>${mo}</div>`;
}
/* Todos los relojes del hub, no solo el primero (con ids, un segundo Reloj
   salía vacío). Solo se escribe lo que cambia: reescribir el mismo texto cada
   10 s también obligaba a recalcular el hub. */
function tickClock() {
  const now = new Date(); const h = now.getHours();
  const hora = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const saludo = IS_PRIVATE ? 'Ventana privada — nada se guarda' : (h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches') + ' — listo para navegar';
  const f = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }); const fecha = f.charAt(0).toUpperCase() + f.slice(1);
  const pon = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  document.querySelectorAll('.w-clock').forEach((ck) => { pon(ck.querySelector('.time'), hora); pon(ck.querySelector('.greet'), saludo); pon(ck.querySelector('.ck-fecha'), fecha); });
}
let relojTimer = setInterval(tickClock, 10000);   // se apaga con el hub oculto (vigilaHub)

/* ===== EL HUB DESCANSA CUANDO NO SE VE (auditoría 2026-10) =====
   Reloj, monitor, portapapeles, autenticador y Spotify paraban su trabajo con
   el hub oculto, pero sus temporizadores seguían despertando a la interfaz.
   Ahora solo existen con el hub a la vista: se apagan al cambiar a una página
   o a otra pestaña y al minimizar, y vuelven con una lectura inmediata. Se
   vigila la clase del propio #hub (no hay que tocar cada sitio que lo enseña). */
function hubSeVe() { return els.hub.classList.contains('active') && !document.hidden; }
function relojHub(t, fn, ms) { clearInterval(t); return hubSeVe() ? setInterval(fn, ms) : null; }
let hubVisto = null;
function vigilaHub() {
  const ve = hubSeVe();
  if (ve === hubVisto) return;
  hubVisto = ve;
  relojTimer = relojHub(relojTimer, tickClock, 10000);
  if (!ve) {
    [monTimer, clipTimer, authTimer, spTimer].forEach(clearInterval);
    monTimer = clipTimer = authTimer = spTimer = null;
    return;
  }
  tickClock();
  const hay = (tipo) => widgets.some((w) => w.type === tipo);
  if (hay('monitor')) { monTimer = relojHub(monTimer, actualizaMonitor, 3000); actualizaMonitor(); }
  if (hay('clip') && !IS_PRIVATE) { clipTimer = relojHub(clipTimer, vigilaClip, 1500); vigilaClip(); }
  if (hay('spotify')) { spTimer = relojHub(spTimer, actualizaSpotify, 3000); actualizaSpotify(); }
  document.querySelectorAll('.w-auth').forEach(renderAuthW);
  if (wxViejo) refrescaClimaW();
}
new MutationObserver(vigilaHub).observe(els.hub, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', vigilaHub);
vigilaHub();

/* Aviso de recordatorios: chequeo cada 30 s; toast siempre y notificación si se puede */
setInterval(() => {
  const l = recordatorios(); const ahora = new Date(); let toca = false;
  for (const r of l) {
    if (r.avisado) continue;
    if (new Date(`${r.fecha}T${r.hora || '09:00'}`) <= ahora) {
      r.avisado = true; toca = true;
      toast(`Recordatorio: ${r.texto}`); suena('aviso');
      try { new Notification('Naviris — Recordatorio', { body: r.texto, silent: settings.sonidos !== false }); } catch { /* sin permiso: queda el toast */ }
    }
  }
  if (toca) guardaRecordatorios(l);
}, 30000);

/* ============ Pastilla de clima (esquina del hub, como Opera GX) ============ */
async function loadWeatherPill() {
  const el = document.getElementById('hub-weather'); if (!el) return;
  if (widgets.some((x) => x.type === 'weather')) { el.classList.add('hidden'); return; }
  try {
    const geo = await getGeo();
    if (!wxCache) { const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=${WX_QUERY}`); wxCache = (await r.json()).current; }
    const [desc, ic] = WMO(wxCache);
    el.innerHTML = `${window.icon(ic)}<span>${Math.round(wxCache.temperature_2m)}°C</span><span class="wxp-sep"></span><span class="wxp-city">${escapeHtml(geo.city || desc)}</span>`;
    el.title = desc;
    el.classList.remove('hidden');
  } catch { el.classList.add('hidden'); }
}
loadWeatherPill();
setInterval(() => { wxCache = null; loadWeatherPill(); refrescaClimaW(); }, 30 * 60 * 1000); // refresco cada 30 min
/* El widget de Clima también se refresca (auditoría 2026-10: enseñaba el dato
   del arranque todo el día). Con el hub oculto no se pide nada: queda marcado
   y se pide al volver a verlo (vigilaHub). */
function refrescaClimaW() {
  const cajas = document.querySelectorAll('.w-wx');
  wxViejo = cajas.length > 0 && !hubSeVe();
  if (!wxViejo) cajas.forEach((el) => loadWeather(el, 'weather'));
}

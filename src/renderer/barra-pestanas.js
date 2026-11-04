/* Barra de pestañas: arrastre, pintado, movimiento, pantalla dividida y pestañas en vertical. */

/* ===== Arrastrar pestañas =====
   Con eventos de PUNTERO, no con el arrastre de HTML5. Dos motivos, los dos
   pedidos por Dosa el 2026-08-30:

   1. El de HTML5 no dice donde se solto si fue fuera de la ventana, y hacia
      falta para poder SACAR una pestaña a una ventana nueva.
   2. Reordenaba mal. La version vieja metia la pestaña siempre DELANTE de la
      de destino, asi que arrastrarla una posicion a la derecha la dejaba
      exactamente donde estaba y parecia que no funcionaba nada. Ahora la
      posicion sale de comparar el puntero con el CENTRO de cada pestaña, que
      es lo que hace que se sienta natural en las dos direcciones.

   El reordenado es EN VIVO: la barra se repinta mientras se arrastra, asi que
   los elementos se destruyen y se vuelven a crear. Por eso los escuchas van
   en `window` y todo se sigue por el id de la pestaña, nunca por el nodo. */
let arrastre = null;
const UMBRAL_ARRASTRE = 5;    // px antes de considerarlo arrastre y no un clic
const UMBRAL_SACAR = 58;      // px por debajo/encima de la barra para sacarla

function empiezaArrastre(e, tab, el) {
  if (e.button !== 0) return;
  // Los botones de dentro (cerrar, silenciar) hacen lo suyo.
  if (e.target.closest('.t-close, .t-mute')) return;
  arrastre = {
    id: tab.id, x0: e.clientX, y0: e.clientY, movido: false,
    fijada: !!tab.pinned, sacando: false
  };
}

function posicionDestino(x, y) {
  /* La ranura donde caeria ahora mismo: se mira el centro de cada pestaña del
     mismo bloque (fijadas y sueltas no se mezclan). En vertical todas tienen
     la misma X: ahí manda la altura. */
  const arr = arrastre;
  const vertical = document.documentElement.classList.contains('vtabs');
  const cajas = [...els.tabstrip.querySelectorAll('.tab:not(.ida)')]
    .map((n) => ({ n, id: Number(n.dataset.tabId), r: n.getBoundingClientRect() }))
    .filter((c) => c.id && c.id !== arr.id);
  let destino = null, antes = true;
  for (const c of cajas) {
    const t = tabs.find((x) => x.id === c.id);
    if (!t || !!t.pinned !== arr.fijada) continue;
    if (vertical ? y < c.r.top + c.r.height / 2 : x < c.r.left + c.r.width / 2) { destino = c.id; antes = true; break; }
    destino = c.id; antes = false;
  }
  return { destino, antes };
}

function mueveA(fromId, toId, antes) {
  const from = tabs.findIndex((t) => t.id === fromId);
  const to = tabs.findIndex((t) => t.id === toId);
  if (from === -1 || to === -1) return false;
  if (!!tabs[from].pinned !== !!tabs[to].pinned) return false;
  const [moved] = tabs.splice(from, 1);
  // El indice de destino se vuelve a buscar DESPUES de sacarla: si no, al
  // mover hacia la derecha se cuela una posicion de menos.
  const j = tabs.findIndex((t) => t.id === toId);
  if (j === -1) { tabs.splice(from, 0, moved); return false; }
  tabs.splice(antes ? j : j + 1, 0, moved);
  return true;
}

window.addEventListener('pointermove', (e) => {
  if (!arrastre) return;
  if (!arrastre.movido) {
    if (Math.abs(e.clientX - arrastre.x0) < UMBRAL_ARRASTRE
      && Math.abs(e.clientY - arrastre.y0) < UMBRAL_ARRASTRE) return;
    arrastre.movido = true;
    document.body.classList.add('arrastrando-pestana');
  }
  const el = els.tabstrip.querySelector('.tab[data-tab-id="' + arrastre.id + '"]');
  if (el) el.classList.add('dragging');

  /* Fuera de la barra por arriba o por abajo: se va a sacar. Solo si queda
     mas de una pestaña — sacar la unica que hay no separa nada. En vertical
     la barra es la columna de la izquierda: se saca hacia la derecha. */
  const vertical = document.documentElement.classList.contains('vtabs');
  const r = (vertical ? els.vtabsCol : els.tabstrip).getBoundingClientRect();
  const lejos = vertical ? e.clientX > r.right + UMBRAL_SACAR
    : e.clientY > r.bottom + UMBRAL_SACAR || e.clientY < r.top - UMBRAL_SACAR;
  const puede = tabsVisibles().length > 1 && !arrastre.fijada;
  arrastre.sacando = lejos && puede;
  document.body.classList.toggle('sacando-pestana', arrastre.sacando);
  if (arrastre.sacando) return;

  const { destino, antes } = posicionDestino(e.clientX, e.clientY);
  if (destino != null && destino !== arrastre.id) {
    if (mueveA(arrastre.id, destino, antes)) renderTabs(true);
  }
});

window.addEventListener('pointerup', () => {
  if (!arrastre) return;
  const a = arrastre; arrastre = null;
  document.body.classList.remove('arrastrando-pestana', 'sacando-pestana');
  document.querySelectorAll('.tab.dragging').forEach((n) => n.classList.remove('dragging'));
  if (!a.movido) return;             // fue un clic, ya lo trata el click
  /* El clic llega DESPUES del pointerup. Sin esta marca, soltar una pestaña
     encima de otra activaba esa otra. */
  document.body.classList.add('acaba-de-arrastrar');
  setTimeout(() => document.body.classList.remove('acaba-de-arrastrar'), 0);
  const tab = tabs.find((x) => x.id === a.id);
  if (a.sacando && tab) {
    const url = tab.sleptUrl || tab.url;
    if (/^https?:/i.test(url)) {
      window.navirisApp.sacarPestana(url, tab.contenedor ? tab.contenedor.id : null);
      closeTab(tab.id);
      return;
    }
  }
  renderTabs(true); saveSession();
});
// Si el puntero se pierde (alt-tab, la ventana deja de tener el foco) no se
// queda un arrastre colgado para siempre.
window.addEventListener('pointercancel', () => {
  if (!arrastre) return;
  arrastre = null;
  document.body.classList.remove('arrastrando-pestana', 'sacando-pestana');
  renderTabs(true);
});
// Firma del estado visible de las pestañas: si no cambia, no se repinta. Antes
// se recreaba la barra entera en CADA evento (título, favicon, media-started,
// media-paused...), y en páginas con vídeo eso llegaba varias veces por segundo:
// las pestañas parecían temblar porque el navegador rehacía el layout sin parar.
function firmaTabs() {
  return tabs.map((t) => [t.id, t.title, t.favicon || '', t.id === activeId, !!t.asleep,
    !!t.autoLoot, !!t.audible, !!t.muted, !!t.agentControlled, !!t.pinned,
    t.espacio || '', t.contenedor ? t.contenedor.id : ''].join('')).join('') + '|' + (espacioActivo || '');
}
let ultimaFirmaTabs = null;
function renderTabs(forzar) {
  // AutoClaim se tiñe del morado de Twitch cuando la pestaña activa es un
  // canal (antes del early-return: es barato y depende de la pestaña activa)
  els.sbLoot.classList.toggle('on-twitch', activeIsTwitch());
  const f = firmaTabs();
  if (!forzar && f === ultimaFirmaTabs) return;
  ultimaFirmaTabs = f;
  const antes = fotoPestanas();
  // AutoClaim v2: un solo canal, sin grupo de pestañas acopladas; la pestaña
  // que farmea se queda en su sitio con su indicador (.farming)
  els.tabstrip.innerHTML = '';
  els.tabstrip.classList.remove('deslizando');
  for (const tab of tabsVisibles()) els.tabstrip.appendChild(makeTabEl(tab));
  ajustaPestanas();
  if (antes) animaPestanas(antes);
  pestanaPintadaActiva = activeId;
}
/* ===== Movimiento de la barra de pestañas (Naviris 3) =====
   La sección «Movimiento» de las propuestas, en la barra de verdad. Solo
   transform y opacity, con la API de animaciones del navegador: cada una sale
   de donde está lo que se ve, así que una interrumpida no salta.
   - Pestaña nueva: entra en 240 ms (frena). La que se cierra se va en 160 ms
     (acelera) y las vecinas ocupan su sitio deslizándose (FLIP, 200 ms).
   - Cambiar de pestaña con el ratón: la lengüeta de la hoja viaja de la que se
     deja a la nueva en 220 ms (frena).
   Lo que se hace con el teclado (Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+1…) no se
   anima, ni las pestañas en vertical, ni una tanda grande (restaurar sesión).
   Con «reducir movimiento» solo quedan los fundidos. */
let movTeclado = false, pestanaPintadaActiva = null;
const movReducido = matchMedia('(prefers-reduced-motion: reduce)');
function fotoPestanas() {
  const strip = els.tabstrip;
  if (movTeclado || document.documentElement.classList.contains('vtabs') || !strip.isConnected || !strip.offsetWidth) return null;
  const cajas = new Map();
  for (const n of strip.children) if (n.classList.contains('tab') && !n.classList.contains('ida')) cajas.set(Number(n.dataset.tabId), { n, r: n.getBoundingClientRect() });
  // Una lengüeta a medio viaje: la siguiente sale de donde se ve ahora.
  const leng = strip.querySelector('#tab-lengueta');
  return { cajas, leng: leng ? leng.getBoundingClientRect() : null, strip: strip.getBoundingClientRect() };
}
function animaPestanas(antes) {
  const strip = els.tabstrip, reducido = movReducido.matches;
  const ahora = new Map([...strip.querySelectorAll('.tab:not(.ida)')].map((n) => [Number(n.dataset.tabId), n]));
  const nuevas = [...ahora.keys()].filter((id) => !antes.cajas.has(id));
  const idas = [...antes.cajas.keys()].filter((id) => !ahora.has(id));
  if (nuevas.length > 2 || idas.length > 3) return;   // restaurar sesión, cerrar otras…
  for (const id of nuevas) {
    ahora.get(id).animate(reducido ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  // La que se cierra: un fantasma en su sitio que se apaga.
  for (const id of idas) {
    const { n, r } = antes.cajas.get(id);
    n.classList.remove('active'); n.classList.add('ida'); n.inert = true;
    n.style.cssText = `position:absolute;bottom:0;left:${r.left - antes.strip.left + strip.scrollLeft}px;width:${r.width}px;pointer-events:none`;
    strip.appendChild(n);
    n.animate(reducido ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.92)' }],
      { duration: 160, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).onfinish = () => n.remove();
  }
  if (reducido) return;
  // Las que se mueven de sitio (al abrir, cerrar o reordenar), de su sitio de antes al nuevo.
  for (const [id, n] of ahora) {
    const a = antes.cajas.get(id); if (!a) continue;
    const dx = a.r.left - n.getBoundingClientRect().left;
    if (Math.abs(dx) > .5) n.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  deslizaLengueta(antes, ahora);
}
function deslizaLengueta(antes, ahora) {
  const strip = els.tabstrip, n = ahora.get(activeId);
  const desde = antes.leng || (pestanaPintadaActiva !== activeId ? antes.cajas.get(pestanaPintadaActiva)?.r : null);
  if (!n || !desde || !antes.cajas.has(activeId)) return;   // una pestaña nueva ya entra con su propio fundido
  const r = n.getBoundingClientRect();
  if (Math.abs(desde.left - r.left) < .5) return;
  const leng = document.createElement('span'); leng.id = 'tab-lengueta';
  leng.style.cssText = `left:${n.offsetLeft}px;width:${r.width}px`;
  strip.prepend(leng);
  strip.classList.add('deslizando');
  leng.animate([{ transform: `translateX(${desde.left - r.left}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' })
    .onfinish = () => { if (leng.isConnected) { leng.remove(); strip.classList.remove('deslizando'); } };
}
/* ===== Pantalla dividida =====
   Dos pestañas visibles a la vez. No se crea nada nuevo: los webviews que ya
   existen dejan de ocupar el ancho entero y se reparten el hueco, así que la de
   la derecha sigue siendo una pestaña de verdad (su historial, su sonido, su
   sitio en la barra). El acompañante se marca con `divId`; la izquierda es
   siempre la pestaña activa. */
function aplicaDivision() {
  const compa = tabs.find((t) => t.id === divId);
  if (!compa || compa.kind !== 'web' || compa.id === activeId || !enEspacio(compa)) divId = null;
  els.content.classList.toggle('dividido', !!divId);
  els.divBarra.classList.toggle('hidden', !divId);
  for (const t of tabs) {
    if (!t.webview) continue;
    t.webview.classList.remove('izq', 'der');
    if (!divId) continue;
    if (t.id === activeId) t.webview.classList.add('izq');
    else if (t.id === divId) { t.webview.classList.add('der'); t.webview.classList.add('active'); }
  }
}

function dividirCon(tab) {
  if (!tab || tab.kind !== 'web') { toast('Solo se puede dividir con una pestaña web'); return; }
  if (tab.id === activeId) { toast('Elige una pestaña distinta de la que estás viendo'); return; }
  if (tab.asleep) despiertaPestana(tab);
  tab.lastActive = Date.now();   // se está viendo: el ahorro de energía no la cuenta como olvidada
  divId = tab.id;
  aplicaDivision();
  renderTabs();
  toast('Pantalla dividida — el botón del centro la deshace');
}

function salirDivision() {
  if (divId === null) return;
  divId = null;
  aplicaDivision();
  activateTab(activeId);   // devuelve el ancho entero a la que queda
  renderTabs();
}

/* ===== Pestañas en vertical =====
   El #tabstrip es UNO solo y se muda de sitio: al titlebar o a la columna de la
   izquierda. Así renderTabs, el arrastre, los menús de pestaña y las mini de
   AutoLoot siguen funcionando sin tocarlos, y no hay dos listas que puedan
   contar cosas distintas. */
function aplicaVerticales(on) {
  const strip = els.tabstrip;
  if (!strip || !els.vtabsCol) return;
  document.documentElement.classList.toggle('vtabs', !!on);
  els.vtabsCol.classList.toggle('hidden', !on);
  if (on) els.vtabsSlot.appendChild(strip);
  else els.newtabBtn.parentNode.insertBefore(strip, els.newtabBtn);
  ajustaPestanas();
}

/* Lo que mide una pestaña con sitio de sobra, el hueco entre dos y el relleno
   de los lados de la barra (el sitio de las curvas de la activa). Tienen que
   ir a la par con `.tab { max-width }` y `#tabstrip { gap; padding }` del CSS. */
const ANCHO_PESTANA = 240, HUECO_PESTANA = 2, RELLENO_BARRA = 20;
/* Cuánto le toca a cada pestaña con el ancho que hay: por debajo de cierto
   tamaño se les quita primero la X y luego el título, hasta quedarse en el
   favicon. Lo decide JS porque el CSS no puede medir a sus hermanas. */
function ajustaPestanas() {
  const strip = els.tabstrip;
  // En vertical cada pestaña ocupa el ancho entero: no hay nada que repartir, y
  // los modos compacto/mínimo esconderían el título teniendo sitio de sobra.
  if (document.documentElement.classList.contains('vtabs')) {
    strip.classList.remove('compacto', 'minimo'); strip.style.flexBasis = ''; return;
  }
  const sueltas = strip.querySelectorAll('.tab:not(.pinned):not(.ida)').length;
  if (!sueltas) { strip.classList.remove('compacto', 'minimo'); strip.style.flexBasis = ''; return; }
  let fijas = 0;
  strip.querySelectorAll('.tab.pinned:not(.ida)').forEach((t) => { fijas += t.offsetWidth + HUECO_PESTANA; });
  /* EL ANCHO QUE PIDE LA BARRA. Sin esto se quedaba en la mitad de la ventana
     y las pestañas salian estrechas con hueco vacio al lado (medido el
     2026-08-30: 503 px de 1260). Se pide lo que ocuparian todas a su ancho
     completo; si no cabe, el `flex-shrink` las encoge como siempre. */
  strip.style.flexBasis = (RELLENO_BARRA + fijas + sueltas * (ANCHO_PESTANA + HUECO_PESTANA)) + 'px';
  const cada = (strip.clientWidth - RELLENO_BARRA - fijas) / sueltas - HUECO_PESTANA;
  strip.classList.toggle('compacto', cada < 108);
  strip.classList.toggle('minimo', cada < 66);
}
window.addEventListener('resize', ajustaPestanas);
function toggleMute(tab) {
  tab.muted = !tab.muted;
  try { tab.webview?.setAudioMuted(tab.muted); } catch {}
  renderTabs();
}

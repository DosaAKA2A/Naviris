/* ============ Traducir lo seleccionado (Dosa, 2026-11-17: «como Opera GX») ============
   Al seleccionar texto en una página sale encima una burbuja «Traducir»; al
   pulsarla se abre en el mismo sitio la traducción, con el idioma de origen,
   el de destino (se puede cambiar y se recuerda) y un botón para copiarla. El
   clic derecho de la página tiene también «Traducir» y abre lo mismo donde
   se hizo el clic.
   - La página solo avisa de QUÉ hay seleccionado y DÓNDE (webview-preload.js);
     la traducción la pide el main (ipc 'traducir') y solo al pulsar el botón.
   - La burbuja se apaga en Ajustes (traducirBurbuja); el clic derecho queda.
   - Se cierra al quitar la selección, hacer scroll, pulsar Esc, cambiar de
     pestaña o hacer clic fuera. */
const TRAD_IDIOMAS = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh-CN', 'ru'];
const nombreIdioma = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['es'], { type: 'language' }); } catch { /* nada */ }
  return (c) => {
    if (!c) return 'Detectado';
    let n = c; try { n = dn ? dn.of(c) : c; } catch { /* nada */ }
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : c;
  };
})();

let tradEl = null;      // la burbuja o el panel abierto
let tradWv = null;      // el webview del que salió la selección (null si vino del clic derecho)
let tradPeticion = 0;   // descarta respuestas de una traducción que ya no se ve

function cierraTraductor() {
  const el = tradEl; if (!el) return;
  tradEl = null; tradWv = null; tradPeticion++;
  el.classList.remove('abierto');
  setTimeout(() => el.remove(), 140);
}

// Coloca `el` centrado sobre el punto (x, y) de la ventana; si no cabe arriba, debajo de `abajo`.
function colocaTraductor(el, x, y, abajo) {
  const w = el.offsetWidth, h = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
  const left = Math.max(8, Math.min(x - w / 2, W - w - 8));
  let top = y - h - 8;
  if (top < 8) top = Math.min(abajo + 8, H - h - 8);
  el.style.left = left + 'px';
  el.style.top = Math.max(8, top) + 'px';
}

function abreTraductorEl(clase) {
  if (tradEl) { tradEl.remove(); tradEl = null; }
  const el = document.createElement('div');
  el.className = 'trad ' + clase;
  document.body.appendChild(el);
  tradEl = el;
  return el;
}

// La página avisa de lo seleccionado. `d` null = ya no hay selección.
function seleccionEnPagina(wv, d) {
  if (!d) { if (tradWv === wv || (tradEl && !tradWv)) cierraTraductor(); return; }
  if (settings.traducirBurbuja === false) return;
  const tab = tabs.find((t) => t.webview === wv);
  if (!tab || (tab.id !== activeId && tab.id !== divId)) return;
  const texto = String(d.texto || '').trim();
  if (!texto || texto.length > 5000) return;
  // Una selección que ya está en el idioma de destino no necesita burbuja: se
  // nota a simple vista si son solo números, símbolos o una URL.
  if (!/\p{L}{2,}/u.test(texto) || /^https?:\/\/\S+$/.test(texto)) { cierraTraductor(); return; }
  const r = wv.getBoundingClientRect();
  const k = d.ancho > 0 ? r.width / d.ancho : 1;   // el zoom de la página
  const x = r.left + (d.x + d.w / 2) * k, arriba = r.top + d.y * k, abajo = r.top + (d.y + d.h) * k;
  const b = abreTraductorEl('trad-burbuja');
  tradWv = wv;
  b.innerHTML = `<button type="button" class="trad-boton">${window.icon('languages')}<span>Traducir</span></button>`;
  b.querySelector('button').addEventListener('click', (e) => {
    e.stopPropagation();
    muestraTraduccion(texto, x, arriba, abajo, wv);
  });
  colocaTraductor(b, x, arriba, abajo);
  void b.offsetWidth; b.classList.add('abierto');
}

// Desde el clic derecho: las coordenadas ya vienen en las de la ventana (como las del menú).
function traduceEnPunto(texto, x, y) {
  muestraTraduccion(texto, x, y, y, null);
}

async function muestraTraduccion(texto, x, arriba, abajo, wv, destino = settings.traducirA || 'es') {
  const p = abreTraductorEl('trad-panel');
  tradWv = wv;
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Traducción');
  p.innerHTML = `<div class="trad-cab">
      <span class="trad-ic">${window.icon('languages')}</span>
      <span class="trad-de">Detectando…</span><span class="trad-flecha">→</span>
      <select class="trad-a" aria-label="Traducir a">${TRAD_IDIOMAS.map((c) => `<option value="${c}"${c === destino ? ' selected' : ''}>${escapeHtml(nombreIdioma(c))}</option>`).join('')}</select>
      <button type="button" class="trad-x" title="Cerrar" aria-label="Cerrar">${window.icon('x-mark')}</button>
    </div>
    <div class="trad-texto cargando" aria-live="polite">Traduciendo…</div>
    <div class="trad-pie"><button type="button" class="trad-copiar" disabled>${window.icon('copy')}<span>Copiar</span></button></div>`;
  p.querySelector('.trad-x').addEventListener('click', cierraTraductor);
  p.querySelector('.trad-a').addEventListener('change', async (e) => {
    const nuevo = e.target.value;
    settings = await window.navirisApp.setSettings({ traducirA: nuevo });
    muestraTraduccion(texto, x, arriba, abajo, wv, nuevo);
  });
  colocaTraductor(p, x, arriba, abajo);
  void p.offsetWidth; p.classList.add('abierto');

  const id = ++tradPeticion;
  const r = await window.navirisApp.traducir(texto, destino).catch(() => ({ ok: false }));
  if (id !== tradPeticion || tradEl !== p) return;   // se cerró o se pidió otra
  const caja = p.querySelector('.trad-texto');
  caja.classList.remove('cargando');
  if (!r || !r.ok) {
    caja.classList.add('error');
    caja.textContent = 'No se pudo traducir. Comprueba la conexión e inténtalo de nuevo.';
    p.querySelector('.trad-de').textContent = 'Error';
  } else {
    caja.textContent = r.texto;
    p.querySelector('.trad-de').textContent = nombreIdioma(r.origen);
    // Si el texto ya estaba en el idioma elegido, el main lo pasó al inglés: el selector lo refleja
    if (r.destino && r.destino !== destino) p.querySelector('.trad-a').value = r.destino;
    const copiar = p.querySelector('.trad-copiar');
    copiar.disabled = false;
    copiar.addEventListener('click', () => {
      navigator.clipboard.writeText(r.texto)
        .then(() => { copiar.querySelector('span').textContent = 'Copiado'; })
        .catch(() => toast('No se pudo copiar'));
    });
  }
  colocaTraductor(p, x, arriba, abajo);   // el texto cambió el alto
}

window.addEventListener('mousedown', (e) => { if (tradEl && !tradEl.contains(e.target)) cierraTraductor(); }, true);
window.addEventListener('keydown', (e) => { if (tradEl && e.key === 'Escape') { e.stopPropagation(); cierraTraductor(); } }, true);
window.addEventListener('resize', cierraTraductor);

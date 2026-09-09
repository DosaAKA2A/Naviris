/* Ventana de arranque de Naviris.
   El anillo NO es decorativo: cada tramo llega del proceso principal según
   avanza el arranque de verdad (Widevine, bloqueador, sesiones, interfaz).
   Ver splashProgreso() en main.js. */
document.getElementById('marca').innerHTML = window.irisLogo(66);

const avance = document.getElementById('avance');
const etapa = document.getElementById('etapa');
const pie = document.getElementById('pie');
const LARGO = 439.82; // perímetro del aro (radio 70)

/* Cada hito nombra lo que viene A CONTINUACIÓN, que es lo que uno espera leer
   mientras espera. El 100 cierra la ventana y no necesita texto. */
const ETAPAS = { 12: 'Reproducción protegida', 48: 'Bloqueador de anuncios', 62: 'Sesiones y espacios', 74: 'Interfaz', 85: 'Casi listo' };

/* El arco solo AVANZA. Si dos hitos llegan casi a la vez (arranque en frío
   contra arranque caliente) el porcentaje podría retroceder un instante, y un
   arco que da marcha atrás se lee como un error. */
let visto = 0;
function pinta(pct) {
  const p = Math.max(visto, Math.min(100, pct || 0));
  visto = p;
  avance.style.strokeDashoffset = String(LARGO * (1 - p / 100));
}

/* En un arranque caliente los hitos pasan en menos de un segundo y los textos
   parpadearían. Cada etapa se queda un mínimo en pantalla; esto solo retrasa
   el TEXTO, nunca el arranque (la ventana ya cierra con su mínimo propio,
   SPLASH_MINIMO en main.js, calculado para que quepan las cinco). */
const MINIMO_ETAPA = 320;
const cola = []; let mostrando = false;
function encola(texto) {
  if (!texto || cola[cola.length - 1] === texto || (!cola.length && etapa.textContent === texto)) return;
  cola.push(texto); if (!mostrando) siguiente();
}
function siguiente() {
  if (!cola.length) { mostrando = false; return; }
  mostrando = true;
  etapa.textContent = cola.shift();
  etapa.classList.remove('cambia'); void etapa.offsetWidth; etapa.classList.add('cambia');
  setTimeout(siguiente, MINIMO_ETAPA);
}

pinta(4); // algo se ve desde el primer fotograma: el arco nunca arranca vacío
window.navSplash.onProgreso((d) => {
  if (d && typeof d.pct === 'number') { pinta(d.pct); encola(ETAPAS[d.pct]); }
  if (d && d.version) pie.textContent = 'v' + d.version;
});

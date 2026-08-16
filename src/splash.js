/* Ventana de arranque de Naviris.
   La barra NO es decorativa: cada tramo llega del proceso principal según
   avanza el arranque de verdad (Widevine, bloqueador, sesiones, interfaz).
   Ver splashProgreso() en main.js. */
document.getElementById('marca').innerHTML = window.irisLogo(76);

const fill = document.getElementById('fill');
const pie = document.getElementById('pie');

/* La barra solo AVANZA. Si dos hitos llegan casi a la vez (arranque en frío
   contra arranque caliente) el porcentaje podría retroceder un instante, y una
   barra que da marcha atrás se lee como un error. */
let visto = 0;
function pinta(pct) {
  const p = Math.max(visto, Math.min(100, pct || 0));
  visto = p;
  fill.style.transform = 'scaleX(' + (p / 100) + ')';
}

pinta(4); // algo se ve desde el primer fotograma: la barra nunca arranca vacía
window.navSplash.onProgreso((d) => {
  if (d && typeof d.pct === 'number') pinta(d.pct);
  if (d && d.version) pie.textContent = 'v' + d.version;
});

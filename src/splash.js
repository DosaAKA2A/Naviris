/* Ventana de arranque de Naviris (ver el comentario de splash.html).
   main.js la abre con ?v=<variante>&tema=<oscuro|claro>&sonido=<1|0>. */
const q = new URLSearchParams(location.search);
const VARIANTE = ['apertura', 'firma', 'icono'].includes(q.get('v')) ? q.get('v') : 'apertura';
const raiz = document.documentElement;
raiz.dataset.v = VARIANTE;
raiz.classList.toggle('claro', q.get('tema') === 'claro');

const tarjeta = document.getElementById('tarjeta');
const etapa = document.getElementById('etapa');
const { viewBox, d } = window.irisRuta;
// El isotipo son dos piezas: el marco (cuadrado redondeado) y la lente (el hueco)
const [MARCO, LENTE] = d.split(/(?=M)/);
const NS = 'http://www.w3.org/2000/svg';
const svg = (html) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', viewBox); s.setAttribute('class', 'logo'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = html; return s; };

let destello = null;
if (VARIANTE === 'apertura') {
  // El hueco es una máscara: la lente pinta "nada" y se puede animar sola
  tarjeta.append(svg(
    `<defs><mask id="iris" maskUnits="userSpaceOnUse" x="-10" y="-10" width="900" height="900">` +
    `<rect x="-10" y="-10" width="900" height="900" fill="#fff"/><path class="lente" d="${LENTE}" fill="#000"/></mask></defs>` +
    `<path class="relleno" d="${MARCO}" mask="url(#iris)"/>`));
} else if (VARIANTE === 'firma') {
  // pathLength=1: el trazo se dibuja de 0 a 1 sin medir longitudes
  tarjeta.append(svg(
    `<path class="relleno" fill-rule="evenodd" d="${d}"/>` +
    `<path class="trazo" pathLength="1" d="${MARCO}"/><path class="trazo" pathLength="1" d="${LENTE}"/>`));
  const nombre = document.createElement('span');
  nombre.className = 'nombre'; nombre.textContent = 'Naviris';
  tarjeta.append(nombre);
} else {
  /* El destello: el logo se enciende a lo largo de su diagonal (la misma de la
     lente) con un borde de luz suave. Es un degradado cuyos cortes avanzan con
     requestAnimationFrame durante ~0,7 s y se paran: nada queda animándose. */
  tarjeta.append(svg(
    `<defs><linearGradient id="luz" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="876" y2="875">` +
    `<stop offset="0" class="encendido"/><stop offset="0" class="encendido"/><stop offset="0" class="apagado"/><stop offset="1" class="apagado"/>` +
    `</linearGradient></defs><path fill="url(#luz)" fill-rule="evenodd" d="${d}"/>`));
  const css = getComputedStyle(raiz);
  const [a, b, c, e] = tarjeta.querySelectorAll('stop');
  for (const s of [a, b]) s.setAttribute('stop-color', css.getPropertyValue('--marca').trim());
  for (const s of [c, e]) s.setAttribute('stop-color', css.getPropertyValue('--apagado').trim());
  const BORDE = 0.22; // ancho del borde de luz, en fracción de la diagonal
  const pinta = (p) => { b.setAttribute('offset', Math.max(0, Math.min(1, p - BORDE))); c.setAttribute('offset', Math.max(0, Math.min(1, p))); };
  pinta(0);
  destello = (retraso, dur) => {
    let t0 = 0;
    const paso = (t) => {
      if (!t0) t0 = t;
      const x = Math.min(1, Math.max(0, (t - t0 - retraso) / dur));
      const suave = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; // ease-in-out cúbica
      pinta(suave * (1 + BORDE));
      if (x < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  };
}

/* ARRANCA: la animación sale a la vez que el sonido. El audio tarda un poco en
   empezar la primera vez (el servicio de audio se abre al pedirlo), así que se
   espera a 'playing' — con tope, para que un equipo sin salida de audio no
   retrase nada. */
let arrancada = false;
function arranca() {
  if (arrancada) return; arrancada = true;
  raiz.classList.add('anda');
  window.navSplash.anda();
  if (destello) destello(180, 700); // cruza el centro del logo a ~0,42 s, con la campana
}
document.fonts.ready.then(() => {
  const audio = q.get('sonido') === '1' ? window.navSonido('arranque') : null;
  if (audio) { audio.addEventListener('playing', arranca, { once: true }); setTimeout(arranca, 260); } else arranca();
});

/* Los hitos del arranque siguen llegando del proceso principal (Widevine,
   bloqueador, sesiones, interfaz). Solo se enseñan si el arranque se alarga:
   en uno normal la ventana ya se ha ido antes de que haga falta. */
const ETAPAS = { 12: 'Reproducción protegida', 48: 'Bloqueador de anuncios', 62: 'Sesiones y espacios', 74: 'Interfaz', 85: 'Casi listo' };
const LENTO = 2200;
let ultima = '';
window.navSplash.onProgreso((p) => { if (ETAPAS[p]) { ultima = ETAPAS[p]; if (etapa.classList.contains('visible')) etapa.textContent = ultima; } });
setTimeout(() => { if (ultima) { etapa.textContent = ultima; etapa.classList.add('visible'); } }, LENTO);

// El relevo: main.js enseña la ventana principal y pide que esta se vaya
window.navSplash.onSale(() => raiz.classList.add('sale'));

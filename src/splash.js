/* Ventana de arranque de Naviris (ver el comentario de splash.html).
   main.js la abre con ?v=<variante>&lente=<estilo>&tema=<oscuro|claro>&sonido=<1|0>. */
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

/* LENTE DE «APERTURA» (2.ª tanda, 3/11: «que sea más fluida, como si estuviera
   hecha de agua»). 'clasica' abre la lente con un escalado rígido (CSS). Las
   otras cuatro la abren como un líquido; las mueve un solo bucle de
   requestAnimationFrame que se para a los 0,9 s y deja el logo EXACTAMENTE
   como el estático: sin transformación, sin filtro y sin recorte.
   Se elige en main.js (SPLASH_LENTE):
     gota     nace de tres gotas que se funden en la rendija (tensión superficial)
     muelle   se abre con un muelle y se asienta oscilando, como agua que se calma
     menisco  se abre como la clásica, con el borde ondulando hasta quedar quieto
     marea    se llena desde abajo con una superficie en ola */
const LENTES = ['clasica', 'gota', 'muelle', 'menisco', 'marea'];
const ESTILO = LENTES.includes(q.get('lente')) ? q.get('lente') : 'clasica';
raiz.dataset.lente = ESTILO;
const tramo = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const suave = (x) => x * x * (3 - 2 * x);
// cubic-bezier de CSS resuelto a mano (Newton): las mismas curvas que la hoja de estilos
const curva = (x1, y1, x2, y2) => (x) => {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x;
    const der = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
    if (Math.abs(der) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - err / der));
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
};
const abre = curva(0.7, 0, 0.2, 1);   // la de 'clasica'
const frena = curva(0.16, 1, 0.3, 1); // --frena
/* Muelle subamortiguado de 0 a 1: amortiguación z, periodo propio T (s) y
   velocidad de salida v (1/s), para que arranque lanzado y no despacio. */
const muelle = (t, z, T, v) => {
  if (t <= 0) return 0;
  const w = 2 * Math.PI / T, wd = w * Math.sqrt(1 - z * z);
  return 1 + Math.exp(-z * w * t) * (-Math.cos(wd * t) + (v - z * w) / wd * Math.sin(wd * t));
};
const CERRADA = 0.035; // la rendija de partida (la misma que en el CSS)
const DURA = 0.9;      // s: lo que dura la lente, como la clásica con su retraso

// Lo que cada estilo añade dentro de la máscara (la lente pinta en negro = hueco)
function mascaraLente() {
  const lente = `<path class="lente" d="${LENTE}" fill="#000"/>`;
  const zona = 'filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"';
  if (ESTILO === 'gota') return `<filter id="goo" ${zona} x="-10" y="-10" width="900" height="900">` +
    `<feGaussianBlur stdDeviation="28"/><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7"/></filter>` +
    `<g class="gotas" filter="url(#goo)">${lente}<circle fill="#000"/><circle fill="#000"/><circle fill="#000"/></g>`;
  // El ruido tiene margen de sobra: se desplaza 0,2 de la zona y no puede dejar la lente sin onda
  if (ESTILO === 'menisco') return `<filter id="menisco" ${zona} x="-300" y="-300" width="1480" height="1480">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="1" seed="4"/><feOffset/>` +
    `<feDisplacementMap in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `<g class="borde" filter="url(#menisco)">${lente}</g>`;
  if (ESTILO === 'marea') return `<clipPath id="marea" clipPathUnits="userSpaceOnUse"><path/></clipPath>` +
    lente.replace('/>', ' clip-path="url(#marea)"/>');
  return lente;
}

/* Prepara el estilo líquido y devuelve la función que lo pone en marcha.
   Cada estilo es paso(t), con t en segundos desde que arranca la animación,
   y limpia(), que deja el logo como el estático. */
function lenteLiquida(logo) {
  const lente = logo.querySelector('.lente');
  const caja = lente.getBBox();
  const cx = caja.x + caja.width / 2, cy = caja.y + caja.height / 2;
  const pon = (largo, ancho) => { lente.style.transform = `rotate(45deg) scale(${largo}, ${ancho}) rotate(-45deg)`; };
  let paso, limpia;
  if (ESTILO === 'muelle') {
    /* Al pasarse, la lente se estira a lo ancho y encoge a lo largo (y al
       revés): conserva su "volumen", como una gota que se asienta. */
    let pasada = false;
    paso = (t) => {
      // Llega entera a los 0,45 s y su pasada máxima (+4,6 %) cae a los 0,55 s, con la cumbre del sonido
      const ancho = CERRADA + (1 - CERRADA) * muelle(t - 0.1, 0.7, 0.7, 1.5);
      if (ancho >= 1) pasada = true;
      pon(pasada ? 1 - 0.6 * (ancho - 1) : 1, ancho);
    };
    limpia = () => {};
  } else if (ESTILO === 'gota') {
    const [centro, g1, g2] = logo.querySelectorAll('.gotas circle');
    const [desenfoque, umbral] = logo.querySelectorAll('#goo > *');
    const semieje = Math.hypot(caja.width, caja.height) / 2;
    const gota = (c, k, r) => { c.setAttribute('cx', cx + k * semieje * Math.SQRT1_2); c.setAttribute('cy', cy + k * semieje * Math.SQRT1_2); c.setAttribute('r', Math.max(0, r)); };
    paso = (t) => {
      pon(0.25 + 0.75 * frena(tramo(t, 0.06, 0.55)), CERRADA + (1 - CERRADA) * muelle(t - 0.1, 0.9, 0.7, 1.5));
      const k = 0.18 + 0.24 * frena(tramo(t, 0.04, 0.45)), r = 75 * Math.sin(Math.PI * tramo(t, 0.04, 0.55));
      gota(centro, 0, 115 * Math.sin(Math.PI * tramo(t, 0, 0.6)));
      gota(g1, -k, r); gota(g2, k, r);
      // La tensión superficial se suelta al final: desenfoque a 0 y umbral a la identidad
      const g = 1 - suave(tramo(t, 0.5, 0.85));
      desenfoque.setAttribute('stdDeviation', 28 * g);
      umbral.setAttribute('values', `1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${1 + 17 * g} ${-7 * g}`);
    };
    limpia = () => { logo.querySelector('.gotas').removeAttribute('filter'); for (const c of [centro, g1, g2]) c.remove(); };
  } else if (ESTILO === 'menisco') {
    const [, ola, mapa] = logo.querySelectorAll('#menisco > *');
    paso = (t) => {
      pon(1, CERRADA + (1 - CERRADA) * abre(tramo(t, 0.1, 0.82)));
      // La onda sube enseguida y se calma hasta 0; recorre el borde a lo largo de la diagonal
      mapa.setAttribute('scale', 56 * suave(tramo(t, 0.06, 0.3)) * (1 - tramo(t, 0.3, 0.86)) ** 2);
      ola.setAttribute('dx', 240 * t); ola.setAttribute('dy', 240 * t);
    };
    limpia = () => logo.querySelector('.borde').removeAttribute('filter');
  } else {
    // marea: la lente entera, recortada por un agua que sube con su ola
    const agua = logo.querySelector('#marea path');
    const fondo = caja.y + caja.height + 30, alto = caja.height + 100;
    lente.style.transform = 'none';
    paso = (t) => {
      const p = suave(tramo(t, 0.04, 0.82));
      const nivel = fondo - p * alto, a = 30 * (1 - p), fase = t * 11;
      let ruta = '';
      for (let x = -20; x <= 900; x += 23) ruta += `${ruta ? 'L' : 'M'}${x},${(nivel + a * Math.sin(x / 70 + fase) + 0.4 * a * Math.sin(x / 37 - 1.7 * fase)).toFixed(1)}`;
      agua.setAttribute('d', `${ruta}L900,900L-20,900Z`);
    };
    limpia = () => lente.removeAttribute('clip-path');
  }
  paso(0);
  return () => {
    const fin = () => { lente.style.transform = 'none'; limpia(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return fin();
    const t0 = performance.now();
    const cuadro = (ahora) => {
      const t = Math.max(0, (ahora - t0) / 1000);
      if (t >= DURA) return fin();
      paso(t); requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
  };
}

let destello = null, liquida = null;
if (VARIANTE === 'apertura') {
  // El hueco es una máscara: la lente pinta "nada" y se puede animar sola
  const logo = svg(
    `<defs><mask id="iris" maskUnits="userSpaceOnUse" x="-10" y="-10" width="900" height="900">` +
    `<rect x="-10" y="-10" width="900" height="900" fill="#fff"/>${mascaraLente()}</mask></defs>` +
    `<path class="relleno" d="${MARCO}" mask="url(#iris)"/>`);
  tarjeta.append(logo);
  if (ESTILO !== 'clasica') liquida = lenteLiquida(logo);
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
  if (liquida) liquida();
}
document.fonts.ready.then(() => {
  const audio = q.get('sonido') === '1' ? window.navSonido('arranque') : null;
  // La ventana no se cierra hasta que el sonido acaba (main.js, splash:fin): cerrarla cortaría la cola
  const fin = () => window.navSplash.fin();
  if (audio) {
    audio.addEventListener('playing', arranca, { once: true }); setTimeout(arranca, 260);
    audio.addEventListener('ended', fin, { once: true }); audio.addEventListener('error', fin, { once: true });
  } else { arranca(); fin(); }
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

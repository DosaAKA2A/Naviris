/* ===== EL HUB ESCALA ENTERO (2026-11-03) =====
   Dosa: "en una pantalla más pequeña, de laptop, todo se ve súper grande y
   descuadrado; los widgets no se adaptan al tamaño de la pantalla". Medido: por
   debajo de una celda de 116 px el hub se reordenaba en columnas de 150 px con
   scroll, y eso pasaba en TODOS los portátiles (1280×720, 1366×768 al 100 y al
   125 %, 1536×864 al 125 %, 1440×900). Y en 1920×1080 la celda bajaba a 122 px
   pero el contenido seguía dibujado para 150: el reloj perdía el saludo.

   Ahora la rejilla se dibuja SIEMPRE a su tamaño de diseño (celda de 150) y se
   le aplica `zoom` de CSS: letra, márgenes, iconos y radios escalan juntos y la
   composición es la misma en pequeño. `zoom` (y no transform: scale) porque
   Chromium vuelve a maquetar el texto al tamaño final: sale nítido.

   Las cuentas van aquí, sin DOM, para poder probarlas (test/hub-escala.test.js):
     · La escala la pide la parte OCUPADA de la maqueta, no la maqueta entera.
       Las calles vacías de alrededor son aire: si no caben, se quedan fuera de
       la vista, pero cada widget sigue en su celda y a la misma distancia de
       los demás. La de fábrica (6×3 en una maqueta de 13×7) cabe así en un
       portátil sin encoger hasta lo ilegible.
     · Nunca por encima de 1 si para llegar hay que recortar calles: en 1080p
       la de fábrica sale a su tamaño de diseño, no gigante. Si la maqueta
       ENTERA cabe más grande (1440p, 4K), crece con la pantalla como antes.
     · Por debajo del SUELO el contenido ya no se lee: si a lo ancho cabe,
       scroll vertical con la escala del suelo; si ni eso, reflujo en columnas.
     · Editando se enseña la maqueta entera (hacen falta todas las celdas para
       colocar): entra a lo ancho a cualquier escala y, si a lo alto no, scroll. */
(function (raiz) {
  const CELDA = 150;            // tamaño de diseño de una celda
  const GAP = 12;               // hueco entre celdas (de diseño)
  const PASO = CELDA + GAP;
  const SUELO = 0.7;            // por debajo, reflujo o scroll
  const SUELO_EDICION = 0.5;    // editando: por debajo se prefiere scroll a encoger más
  const MARGEN_X = 0.03;        // aire a cada lado (el 94 % útil de siempre)

  const tam = (n) => n * PASO - GAP;

  // Rectángulo ocupado de la maqueta: { c0, c1, r0, r1 } en celdas (base 1).
  function cajaOcupada(lista) {
    let c0 = Infinity, c1 = 0, r0 = Infinity, r1 = 0;
    for (const g of lista) {
      if (!g || !(g.w > 0) || !(g.h > 0)) continue;
      c0 = Math.min(c0, g.col); c1 = Math.max(c1, g.col + g.w - 1);
      r0 = Math.min(r0, g.row); r1 = Math.max(r1, g.row + g.h - 1);
    }
    return c1 ? { c0, c1, r0, r1 } : null;
  }

  /* Encaja un tramo [a, b] (lo ocupado) dentro de [lo, hi] (lo visible): parte
     de `x` (el centrado) y se mueve lo justo para que lo ocupado no se salga. */
  function encaja(x, a, b, lo, hi) {
    if (b - a > hi - lo) return x + (lo - a);        // no cabe: manda el principio
    if (a < lo) return x + (lo - a);
    if (b > hi) return x - (b - hi);
    return x;
  }

  /* hub: { ancho, alto } de la zona del hub en px de pantalla.
     inf: px de abajo que se quedan el dock y los botones.
     esquina: { ancho, alto } del bloque de pastillas de arriba a la derecha;
     solo resta alto si lo ocupado le pasa por debajo. sup: aire de arriba.
     Devuelve { modo, s, cols, x, y, alto } con x/y en px de pantalla desde la
     esquina del hub (dónde va la esquina de la rejilla) y `alto` el del
     contenido cuando hay scroll. */
  function encuadre({ hub, cols, filas, caja, edicion = false, inf = 130, esquina = null, sup = 16 }) {
    caja = caja || { c0: 1, c1: cols, r0: 1, r1: filas };
    const mx = hub.ancho * MARGEN_X;
    const ancho = hub.ancho - 2 * mx;
    const anchoCaja = caja.c1 - caja.c0 + 1, altoCaja = caja.r1 - caja.r0 + 1;
    const fitW = (n) => ancho / tam(n);

    const prueba = (arriba) => {
      const alto = Math.max(1, hub.alto - arriba - inf);
      const fitH = (n) => alto / tam(n);
      if (edicion) {
        const s = Math.min(fitW(cols), Math.max(fitH(filas), SUELO_EDICION));
        return { modo: s > fitH(filas) + 1e-9 ? 'scroll' : 'maqueta', s, arriba, alto, entera: true };
      }
      const sEntera = Math.min(fitW(cols), fitH(filas));
      const sCaja = Math.min(fitW(anchoCaja), fitH(altoCaja));
      const s = Math.max(sEntera, Math.min(1, sCaja));
      if (s >= SUELO) return { modo: 'maqueta', s, arriba, alto };
      if (fitW(anchoCaja) >= SUELO) return { modo: 'scroll', s: SUELO, arriba, alto };
      return { modo: 'reflujo', arriba, alto };
    };
    const coloca = (p) => {
      const { s, arriba, alto } = p;
      const x0 = (hub.ancho - s * tam(cols)) / 2;
      const desdeX = (c) => s * PASO * (c - 1);
      const desdeY = (r) => s * PASO * (r - 1);
      // Editando, la maqueta entera a la vista; si no, lo ocupado.
      const [c0, c1, r0, r1] = p.entera ? [1, cols, 1, filas] : [caja.c0, caja.c1, caja.r0, caja.r1];
      const x = encaja(x0, x0 + desdeX(c0), x0 + desdeX(c1) + s * CELDA, mx, hub.ancho - mx);
      let y;
      if (p.modo === 'scroll') y = arriba - desdeY(r0);    // lo ocupado empieza arriba; el resto, con scroll
      else {
        const y0 = arriba + (alto - s * tam(filas)) / 2;
        y = encaja(y0, y0 + desdeY(r0), y0 + desdeY(r1) + s * CELDA, arriba, arriba + alto);
      }
      return { x, y, ocupado: { izq: x + desdeX(c0), der: x + desdeX(c1) + s * CELDA, sup: y + desdeY(r0), inf: y + desdeY(r1) + s * CELDA } };
    };

    let p = prueba(sup);
    if (p.modo === 'reflujo') return reflujo(ancho);
    let pos = coloca(p);
    /* La esquina de arriba (cuenta, clima, tema) solo cuenta si lo ocupado le
       pasa POR DEBAJO: con el bloque centrado no la toca y no hace falta
       regalarle una franja entera de alto. */
    if (esquina && pos.ocupado.der > hub.ancho - esquina.ancho - 8 && pos.ocupado.sup < esquina.alto + 8) {
      p = prueba(Math.max(sup, esquina.alto + 8));
      if (p.modo === 'reflujo') return reflujo(ancho);
      pos = coloca(p);
    }
    const altoContenido = p.modo === 'scroll' ? pos.ocupado.inf + 24 : 0;
    return { modo: p.modo, s: p.s, cols, x: pos.x, y: pos.y, alto: altoContenido };
  }

  /* Reflujo: en orden de lectura, a la escala del SUELO (la misma densidad que
     una maqueta reducida; a escala 1 era el "todo se ve enorme" del portátil) y
     tantas columnas como quepan. Solo se encoge más si no caben ni dos. */
  function reflujo(ancho) {
    let s = SUELO, cols = Math.floor((ancho / s + GAP) / PASO);
    if (cols < 2) { cols = 2; s = Math.max(0.45, ancho / tam(2)); }
    return { modo: 'reflujo', s, cols, x: 0, y: 0, alto: 0 };
  }

  // Celda (base 1) bajo un punto de pantalla. `origen` es la esquina de la
  // rejilla en pantalla (getBoundingClientRect, que ya viene con el zoom).
  function celdaEn(px, py, origen, s) {
    return {
      col: Math.max(1, Math.floor((px - origen.left) / (s * PASO)) + 1),
      row: Math.max(1, Math.floor((py - origen.top) / (s * PASO)) + 1)
    };
  }
  // Celdas que suma un arrastre de `delta` px de pantalla (asas de tamaño).
  const celdasDe = (delta, s) => Math.round(delta / (s * PASO));

  const api = { CELDA, GAP, PASO, SUELO, SUELO_EDICION, tam, cajaOcupada, encuadre, celdaEn, celdasDe };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.hubEscala = api;
})(typeof window !== 'undefined' ? window : globalThis);

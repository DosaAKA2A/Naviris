/* Hub: tipos de widget, malla de celdas, maqueta de fábrica y migraciones de lo guardado. */

/* ============ HUB: sistema de widgets ============ */
const WIDGET_TYPES = {
  clock: { name: 'Reloj', icon: 'clock', span: 6 },
  search: { name: 'Buscador', icon: 'magnifying-glass', span: 6 },
  date: { name: 'Fecha', icon: 'clock', span: 2 },
  weather: { name: 'Clima', icon: 'cloud', span: 2 },
  region: { name: 'Región', icon: 'map-pin', span: 2 },
  notes: { name: 'Notas', icon: 'pencil-square', span: 3 },
  spotify: { name: 'Spotify', icon: 'musical-note', span: 3 },
  calendar: { name: 'Calendario', icon: 'calendar', span: 3 },
  user: { name: 'Cuenta', icon: 'user-circle', span: 2 },
  xtrends: { name: 'Tendencias X', icon: 'hash', span: 2, rspan: 2 },
  imagen: { name: 'Imagen', icon: 'photo', span: 2 },
  mail: { name: 'Gmail', icon: 'inbox', span: 2, rspan: 2 },
  descargas: { name: 'Descargas', icon: 'download' },
  privada: { name: 'Ventana privada', icon: 'book-lock' },
  monitor: { name: 'Monitor', icon: 'res-scale' },
  moovin: { name: 'MOOVIN', icon: 'tv' },
  clip: { name: 'Portapapeles', icon: 'clipboard' },
  deco: { name: 'Adorno', icon: 'star' },
  wallet: { name: 'Tarjetas', icon: 'credit-card' },
  auth: { name: 'Autenticador', icon: 'fingerprint' }
};
/* ===== GRILLA UNIVERSAL DE CELDAS (2026-08-11, pedido de Dosa) =====
   Como la pantalla de un movil: celda base 160x160 (el RELOJ es la referencia,
   2x1), cada widget ocupa un rectangulo de celdas {col,row,w,h} y se arrastra
   a cualquier hueco libre. Cada tipo declara sus TALLAS (algunas cambian la
   estructura). Sustituye a los mapas por tramo (span/col8/lienzo). */
/* UNA SOLA COMPOSICION (2026-08-11, logica de Dosa: "un UWQHD es un QHD mas
   largo"). La celda se deriva del ALTO (7 filas): a misma altura, mismas
   celdas. El ancho solo anade COLUMNAS: 16:9 usa 13 y 21:9 usa 17, y a 1440p
   las dos dan la celda de diseño (las 4 extra son largo, no otra maqueta).
   Cada widget tiene UNA geometria {col,row,w,h}; si en una pantalla estrecha
   no cabe, se recoloca TEMPORALMENTE sin tocar la composicion. Ventana rara
   (vertical): modo flujo con scroll. */
/* La celda se dibuja SIEMPRE a su tamaño de diseño y la rejilla entera escala
   con `zoom` (src/hub-escala.js): estas son medidas de diseño, no de pantalla. */
const CELDA_W = hubEscala.CELDA, CELDA_H = hubEscala.CELDA;
const CELDA_GAP = hubEscala.GAP; // reforma 2.8.1: baldosas más juntas
const FILAS_LOGICAS = 5;
let ultimasFilas = FILAS_LOGICAS;
const TAMANOS = {
  clock: [[2, 1], [2, 2]],
  search: [[4, 1], [6, 1], [3, 1]],
  shortcuts: [[6, 1], [4, 2], [6, 2], [5, 1]],
  date: [[2, 1]],
  weather: [[2, 1], [1, 1], [2, 2]],
  region: [[2, 1]],
  notes: [[2, 2], [2, 1], [3, 2]],
  spotify: [[2, 2], [2, 3], [4, 2]],
  calendar: [[2, 2], [1, 1], [3, 3], [3, 2]],
  user: [[2, 1], [1, 1], [2, 2]],
  xtrends: [[2, 3], [2, 2], [2, 4]],
  imagen: [[2, 2], [4, 2], [2, 1], [3, 3]],
  mail: [[2, 3], [2, 4], [3, 3]],
  descargas: [[2, 2], [1, 1], [2, 1], [2, 3]],
  privada: [[1, 1], [2, 1]],
  monitor: [[2, 1], [1, 1], [1, 2], [2, 2]],
  moovin: [[2, 2], [1, 1], [2, 1], [4, 2]],
  clip: [[2, 2], [2, 1], [1, 1], [2, 3], [3, 2]],   // 2x1: la de la composición de fábrica
  deco: [[1, 1], [2, 1], [2, 2]],
  wallet: [[2, 1], [1, 1], [2, 2]],
  auth: [[2, 2], [2, 1], [2, 3], [3, 2]]
};
// Tallas LIBRES: estas cajas se estiran por los bordes a cualquier rectangulo
// de celdas (las imagenes se adaptan por cover; los accesos reorganizan tiles).
const LIBRES = new Set(['imagen', 'shortcuts', 'search']);
/* Los ACCESOS crecen con los marcadores: se calcula cuantas filas de tiles
   caben en su ancho y la tarjeta gana alto; los widgets de ABAJO se desplazan
   hacia abajo sin descuadrar (peticion de Dosa 2026-08-12). */
/* Medidas REALES del CSS (2026-08-18): .w-card lleva padding 24 —o sea 48 de
   los dos lados, no 26— y .sc-grid tiene gap 22px 16px, distinto por filas y
   por columnas. Con el 26 de antes la cuenta creía que cabía un acceso más por
   fila del que cabe: en la captura de 120px de celda calculaba 6 y el CSS
   ponía 5. La tarjeta se dimensionaba para una rejilla que no era la pintada. */
/* ALTO MINIMO, no alto impuesto (2026-08-21). Antes esta cuenta llevaba
   PAD = 48 en los dos ejes y ETIQ = 26, asi que una sola fila de iconos daba
   166px y NUNCA cabia en una celda de 150: los accesos siempre pedian dos
   filas de celda, y por mucho que Dosa los estirara a lo ancho y los
   encogiera a lo alto, la pintada los devolvia a 2. Ahora el padding vertical
   de .w-shortcuts es 16 (PAD_Y = 32) y la etiqueta mide lo que mide
   (line-height fija de 14 + 9 de hueco = 24), asi que una fila entra en una
   celda y la tarjeta de accesos puede ser una franja de una sola fila. */
function altoAccesos(w) {
  const TILE = 92, GAP_X = 16, GAP_Y = 22, ETIQ = 24, PAD_X = 48, PAD_Y = 32;
  const anchoPx = w.w * CELDA_W + (w.w - 1) * CELDA_GAP - PAD_X;
  const porFila = Math.max(1, Math.floor((anchoPx + GAP_X) / (TILE + GAP_X)));
  const filas = Math.ceil((dials.length + 1) / porFila);
  const altoPx = filas * (TILE + ETIQ) + (filas - 1) * GAP_Y + PAD_Y;
  return Math.max(1, Math.ceil((altoPx + CELDA_GAP) / (CELDA_H + CELDA_GAP)));
}
/* El alto de los accesos y el empuje que provoca NO SE GUARDAN (2026-08-18):
   salen del tamaño de celda, o sea de la ventana. Antes esto escribía en
   geo.m y llamaba a saveWidgets, así que una ventana estrecha CONGELABA la
   deformación en disco y tu composición ya no volvía ni abriendo en grande.
   Ahora se devuelve un mapa de ajustes que solo vive en esta pintada: la
   maqueta guardada queda intacta y todo se recalcula desde ella. */
function ajustaAccesos() {
  const ajustes = new Map();
  const w = widgets.find((x) => x.type === 'shortcuts' && x.geo && x.geo.m);
  if (!w) return ajustes;
  const g = w.geo.m;
  /* El alto que TU le diste manda; la cuenta solo puede AGRANDARLO cuando los
     accesos ya no caben (que es para lo que se hizo: crecer con los
     marcadores). Antes se imponia el resultado de la cuenta a secas y eso
     pisaba cualquier redimension: la tarjeta volvia sola a su alto "correcto"
     en cuanto se repintaba el hub. */
  const nuevo = Math.max(g.h, altoAccesos(g));
  const delta = nuevo - g.h;
  if (!delta) return ajustes;
  const finAntes = g.row + g.h - 1;
  ajustes.set(w.id, { row: g.row, h: nuevo });
  // Empuje SOLO en las columnas que ocupan los accesos: los laterales no se
  // tocan (antes subia/bajaba toda la fila y descuadraba el bento).
  const cruza = (gx) => gx.col <= g.col + g.w - 1 && gx.col + gx.w - 1 >= g.col;
  delBucket().forEach((x) => {
    if (x.id === w.id) return;
    const gx = x.geo.m;
    if (!cruza(gx) || gx.row <= finAntes) return;
    const nueva = delta > 0
      ? Math.min(ultimasFilas - gx.h + 1, gx.row + delta)
      : Math.max(g.row + nuevo, gx.row + delta); // al encoger, vuelven a su sitio
    if (nueva !== gx.row) ajustes.set(x.id, { row: nueva, h: gx.h });
  });
  return ajustes;
}
function tallaValida(w) {
  if (LIBRES.has(w.type)) {
    const def = (TAMANOS[w.type] || [[2, 2]])[0];
    w.w = Math.max(1, w.w || def[0]); w.h = Math.max(1, w.h || def[1]);
    return [w.w, w.h];
  }
  const lista = TAMANOS[w.type] || [[2, 1]];
  if (lista.some(([a, b]) => a === w.w && b === w.h)) return [w.w, w.h];
  return lista[0];
}
/* ===== UNA SOLA MAQUETA (2026-08-12) =====
   Antes había tres composiciones según la forma de la ventana (ultrapanorámica
   17x7, horizontal 13x7 y una de emergencia) y cada widget SOLO se dibujaba en
   aquellas donde tenía posición guardada. Consecuencias que sufrió Dosa: abrir
   en ventana pequeña dejaba el hub EN BLANCO (ningún widget tenía posición en
   ese modo), la de emergencia montaba 60 filas fijas —10.000px de alto— con el
   bloque centrado, así que la mitad quedaba por encima del scroll, y encima
   las recolocaciones automáticas SE GUARDABAN: cambiar el tamaño de la ventana
   te destrozaba la composición buena.

   Ahora hay UNA maqueta (la tuya) y la ventana solo decide cómo se enseña:
     · Lo ocupado cabe        -> misma maqueta ESCALADA entera (zoom), con las
       calles vacías de alrededor como aire (src/hub-escala.js).
     · Cabe a lo ancho pero no a lo alto -> misma maqueta y SCROLL vertical.
     · No cabe ni a lo ancho (ventana estrecha o vertical) -> REFLUJO: se
       reordena en orden de lectura en las columnas que quepan.
   El reflujo NO se guarda nunca: al agrandar la ventana vuelve tu maqueta
   intacta. Solo se guarda lo que muevas tú en modo edición. */
/* Hasta noviembre de 2026 la celda no bajaba de 116 px porque el contenido de
   los widgets estaba en px fijos para 150 ("a 120 px el reproductor monta el
   botón encima del volumen"): por debajo, reflujo. Eso dejaba en reflujo a
   todos los portátiles. Ahora el contenido escala CON la celda (zoom sobre la
   rejilla), así que encoger ya no rompe nada: las cuentas viven en
   src/hub-escala.js. */
/* Lo que pisa el hub por fuera de la rejilla se MIDE, no se supone: el dock y
   los botones de abajo cambian con el ancho (suben sobre los botones) y con el
   alto (densidad compacta). No dependen de la rejilla, así que medirlos no
   provoca la persecución que obligó a usar constantes con el padding. */
let COLS_MAESTRA = 13, FILAS_MAESTRA = 7;
function medidasMalla() {
  const r = els.hub.getBoundingClientRect();
  // En el primer render el hub puede medir 0: titlebar + navbar y riel lateral.
  const hub = { ancho: r.width || (window.innerWidth - 70), alto: r.height || (window.innerHeight - 106) };
  let dock = els.hubDock.getBoundingClientRect();
  const acc = document.querySelector('.hub-actions').getBoundingClientRect();
  /* En pantallas bajas el dock va en la fila de los botones (densidad compacta).
     Si con tus accesos choca a lo ancho con los botones o con la versión, sube
     encima. Se mira solo el ancho, que no cambia al subir: no hay vaivén. */
  const ver = document.getElementById('hub-version').getBoundingClientRect();
  const choca = (q) => q.width && dock.left < q.right + 8 && q.left < dock.right + 8;
  const sube = !!dock.width && (choca(acc) || choca(ver));
  if (sube !== els.hub.classList.contains('dock-sube')) { els.hub.classList.toggle('dock-sube', sube); dock = els.hubDock.getBoundingClientRect(); }
  const inf = (r.height && dock.height) ? Math.ceil(r.bottom - Math.min(dock.top, acc.top)) + 12 : 130;
  const esq = document.querySelector('.hub-corner').getBoundingClientRect();
  const esquina = (r.height && esq.height) ? { ancho: r.right - esq.left, alto: esq.bottom - r.top } : null;
  const caja = hubEscala.cajaOcupada(delBucket().map((x) => x.geo.m));
  const m = hubEscala.encuadre({
    hub, cols: COLS_MAESTRA, filas: FILAS_MAESTRA, inf, esquina, caja,
    edicion: els.hub.classList.contains('editing')
  });
  // En reflujo la rejilla va en flujo: arriba solo se le deja sitio a la esquina.
  m.inf = inf; m.caja = caja; m.sup = esquina ? esquina.alto + 8 : 92;
  return m;
}
/* Coloca y escala la rejilla. Solo escribe estilo de la rejilla: no rehace
   widgets, así que se puede llamar en cada fotograma de un redimensionado. El
   margen va en px de DISEÑO porque el zoom también escala los de la propia
   rejilla. */
let encuadreHub = null;
function aplicaEncuadre(m) {
  const g = els.widgetGrid.style;
  g.setProperty('--z', m.s);   // zoom de la rejilla (y contrazoom de las herramientas de edición)
  els.hub.style.setProperty('--franja', m.inf + 'px');
  if (m.modo === 'reflujo') { g.marginLeft = g.marginTop = ''; g.paddingTop = (m.sup / m.s) + 'px'; }
  else { g.marginLeft = (m.x / m.s) + 'px'; g.marginTop = (m.y / m.s) + 'px'; g.paddingTop = ''; }
  encuadreHub = m;
}
function libre(occ, col, row, w, h, cols) {
  if (col < 1 || row < 1 || col + w - 1 > cols || row + h - 1 > ultimasFilas) return false;
  for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (occ.has(r + ':' + c)) return false;
  return true;
}
// Solo los widgets de la composicion ACTIVA ocupan celdas: los que aun no
// se han colocado en este bucket son invisibles y no deben estorbar (bug de
// "Ahi no cabe" en huecos claramente libres).
function delBucket() {
  return widgets.filter((x) => x.geo && x.geo.m);
}
function ocupa(occ, wd) { for (let r = wd.row; r < wd.row + wd.h; r++) for (let c = wd.col; c < wd.col + wd.w; c++) occ.add(r + ':' + c); }
// Toda mutacion (mover/estirar/talla) debe escribir en el bucket ACTIVO:
// el render lee geo[cols] primero, y sin esto restauraba la posicion vieja.
function fijaGeo(w) { (w.geo = w.geo || {}).m = { col: w.col, row: w.row, w: w.w, h: w.h }; }
function primerHueco(occ, w, h, cols) {
  for (let row = 1; row <= ultimasFilas - h + 1; row++) for (let col = 1; col <= cols - w + 1; col++) {
    if (libre(occ, col, row, w, h, cols)) return { col, row };
  }
  return null; // no cabe: el widget se oculta hasta que haya sitio
}

/* Disposicion de FABRICA: la composicion de Dosa (2026-08-11) en las dos
   anchuras. `uw` es la suya de 21:9 (17 columnas) y manda; `std` es LA MISMA
   sin las dos calles vacías —las columnas 5-6 y 12-13—, que es justo lo que
   sobra al pasar a 16:9 (17 - 4 = 13 columnas). Así los tres bloques (lateral
   izquierdo, centro y lateral derecho) y las filas son idénticos en las dos
   pantallas: el 21:9 solo añade aire, no otra maqueta. Se eligen por la forma
   del monitor, no por cuál tiene más widgets (2026-08-18).
   Las imagenes salen del tema (`slot` -> temas/<tema>/<slot>.jpg); las que
   añada el usuario van sin slot y piden archivo. */
/* COMPOSICIÓN DE FÁBRICA (reforma 2.8.1, 2026-09-09): la "Mosaico + dock" que
   eligió Dosa. Un bloque de 6×3 celdas centrado (std: columnas 4-9 de 13;
   uw: 6-11 de 17; filas 3-5 de 7): buscador, reloj y clima arriba; tendencias
   en 2×2, monitor y descargas; notas y portapapeles. Los accesos ya no son un
   widget: viven en el dock (renderDock). */
const DEFAULT_WIDGETS = () => JSON.parse(JSON.stringify([
  {
    "id": "wse",
    "type": "search",
    "col": 4,
    "row": 3,
    "w": 3,
    "h": 1,
    "geo": {
      "std": {
        "col": 4,
        "row": 3,
        "w": 3,
        "h": 1
      },
      "uw": {
        "col": 6,
        "row": 3,
        "w": 3,
        "h": 1
      }
    }
  },
  {
    "id": "wck",
    "type": "clock",
    "col": 7,
    "row": 3,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 7,
        "row": 3,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 9,
        "row": 3,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "wwx",
    "type": "weather",
    "col": 9,
    "row": 3,
    "w": 1,
    "h": 1,
    "geo": {
      "std": {
        "col": 9,
        "row": 3,
        "w": 1,
        "h": 1
      },
      "uw": {
        "col": 11,
        "row": 3,
        "w": 1,
        "h": 1
      }
    }
  },
  {
    "id": "wxt",
    "type": "xtrends",
    "col": 4,
    "row": 4,
    "w": 2,
    "h": 2,
    "geo": {
      "std": {
        "col": 4,
        "row": 4,
        "w": 2,
        "h": 2
      },
      "uw": {
        "col": 6,
        "row": 4,
        "w": 2,
        "h": 2
      }
    }
  },
  {
    "id": "wmon",
    "type": "monitor",
    "col": 6,
    "row": 4,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 6,
        "row": 4,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 8,
        "row": 4,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "wdl",
    "type": "descargas",
    "col": 8,
    "row": 4,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 8,
        "row": 4,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 10,
        "row": 4,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "wnt",
    "type": "notes",
    "col": 6,
    "row": 5,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 6,
        "row": 5,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 8,
        "row": 5,
        "w": 2,
        "h": 1
      }
    }
  },
  {
    "id": "wcl",
    "type": "clip",
    "col": 8,
    "row": 5,
    "w": 2,
    "h": 1,
    "geo": {
      "std": {
        "col": 8,
        "row": 5,
        "w": 2,
        "h": 1
      },
      "uw": {
        "col": 10,
        "row": 5,
        "w": 2,
        "h": 1
      }
    }
  }
]))
/* MIGRACION A LA GRILLA (2026-08-12) — lo que descuadro la maqueta de Dosa:
   las maquetas de antes de la grilla de celdas guardaban SOLO `span` (el ancho
   en doceavos de una fila), sin col/row ni geo. La grilla no tiene nada que
   traducir de ahi, asi que renderHub las recolocaba una a una con primerHueco:
   todo apelotonado en la fila 1 y el resto de la pantalla vacio. Ademas la
   composicion de fabrica no llegaba nunca, porque solo se usa cuando NO hay
   nada guardado. Ahora una maqueta sin `geo` se reconoce como vieja, se guarda
   tal cual en naviris.widgets.pre-grilla (por si hiciera falta volver) y se
   adopta la composicion de fabrica. */
let deFabrica = false; // sin nada compuesto por el usuario: manda el monitor
function migraMaquetaVieja(lista) {
  if (!Array.isArray(lista) || !lista.length) { deFabrica = true; return DEFAULT_WIDGETS(); }
  if (lista.some((w) => w && w.geo && (w.geo.m || w.geo.std || w.geo.uw))) return lista;
  store.set('naviris.widgets.pre-grilla', lista);
  const nueva = DEFAULT_WIDGETS();
  deFabrica = true;
  store.set('naviris.widgets', nueva);
  return nueva;
}
let widgets = migraMaquetaVieja(store.get('naviris.widgets', null));
/* REFORMA 2.8.1 (2026-09-09): la composición de fábrica cambia para todos UNA
   vez. La maqueta anterior se guarda en naviris.widgets.pre-v3 por si hay que
   volver, y el widget de accesos desaparece (ahora es el dock). */
if (!store.get('naviris.hub.v3', false)) {
  if (!deFabrica) store.set('naviris.widgets.pre-v3', widgets);
  widgets = DEFAULT_WIDGETS(); deFabrica = true;
  store.set('naviris.widgets', widgets); store.del('naviris.maqueta'); store.set('naviris.hub.v3', true);
}
widgets = widgets.filter((w) => w && w.type !== 'shortcuts');
// migracion: la geometria plana (col/row) se convierte en geo.std
widgets.forEach((w) => {
  if (!w.geo && w.col >= 1 && w.row >= 1) w.geo = { std: { col: w.col, row: w.row, w: w.w, h: w.h } };
});
/* De TRES composiciones por forma de ventana a UNA (2026-08-12): se adopta la
   que más widgets tenga (la ultrapanorámica manda si estaba compuesta ahí,
   porque es donde Dosa colocó todo) y pasa a ser LA maqueta. Las viejas
   geo.std/geo.uw se dejan intactas en disco como respaldo: si algún día hay
   que volver atrás, siguen ahí. */
/* INSTALACION NUEVA: la composicion la elige el MONITOR (2026-08-18). Ese
   desempate por número de widgets es para MIGRAR (el usuario compuso en una de
   las dos y esa manda), pero en una instalación limpia no hay nada que migrar y
   ganaba siempre la ultrapanorámica: 17 columnas en un 16:9 dejan la celda en
   120px cuando los widgets están dibujados para 150, y el hub sale apretado y
   cortado. Se elige por la forma de la pantalla, que es el dato real. */
const ULTRA_DESDE = 2; // 21:9 = 2.33; un 16:9 es 1.78 y un 16:10, 1.6
// Ancho que le queda al hub con la ventana maximizada: la pantalla menos la
// barra lateral (44 + 12 de margenes) y los margenes del contenido (4 + 10).
const CROMO_ANCHO = 70;
function cabenColumnas(C) {
  const p = window.screen || {};
  const anchoUtil = (((p.width || window.innerWidth) - CROMO_ANCHO) * 0.94);
  return Math.floor((anchoUtil - (C - 1) * CELDA_GAP) / C) >= CELDA_W;
}
/* Qué composición le toca a esta pantalla. Manda la FORMA, como quería Dosa:
   21:9 lleva 17 columnas y 16:9 lleva 13. Pero un 21:9 corto (2560x1080) no da
   para dibujar 17 columnas a tamaño de diseño —salen a 120px y el reproductor
   se rompe—, así que ahí se usa la de 13: es la misma composición sin las
   calles, y se ve entera y a su tamaño en vez de apretada. Si tampoco cabe la
   de 13, ya se encarga medidasMalla de irse a reflujo. */
function composicionDeLaPantalla() {
  const p = window.screen || {};
  const r = (p.width && p.height) ? p.width / p.height : window.innerWidth / window.innerHeight;
  return (r >= ULTRA_DESDE && cabenColumnas(17)) ? 'uw' : 'std';
}
(function migraAMaquetaUnica() {
  const guardada = store.get('naviris.maqueta', null);
  if (guardada && guardada.cols) { COLS_MAESTRA = guardada.cols; FILAS_MAESTRA = guardada.filas || 7; }
  if (widgets.some((w) => w.geo && w.geo.m)) return;
  const cuenta = (k) => widgets.filter((w) => w.geo && w.geo[k]).length;
  const fuente = deFabrica
    ? composicionDeLaPantalla()
    : (cuenta('uw') >= cuenta('std') && cuenta('uw') ? 'uw' : (cuenta('std') ? 'std' : null));
  if (fuente) { COLS_MAESTRA = fuente === 'uw' ? 17 : 13; FILAS_MAESTRA = 7; }
  widgets.forEach((w) => {
    const g = (w.geo && (w.geo[fuente] || w.geo.uw || w.geo.std)) || { col: w.col, row: w.row, w: w.w, h: w.h };
    (w.geo = w.geo || {}).m = {
      col: Math.max(1, g.col || 1), row: Math.max(1, g.row || 1),
      w: Math.max(1, g.w || w.w || 2), h: Math.max(1, g.h || w.h || 1)
    };
  });
  store.set('naviris.maqueta', { cols: COLS_MAESTRA, filas: FILAS_MAESTRA });
  store.set('naviris.widgets', widgets);
})();
/* REPARAR LAS QUE YA NACIERON TORCIDAS (2026-08-18) —————————————————————
   Las instalaciones hechas antes de este arreglo tienen 17 columnas guardadas
   aunque el monitor sea 16:9, y ahí la celda se queda en 120px: widgets
   cortados, la tarjeta de accesos empujando a los de abajo y alguno tirado en
   medio. Actualizar no les arreglaba nada, porque la maqueta ya está en disco
   y la migración respeta lo guardado. Esto la rehace, pero SOLO si nadie ha
   compuesto: si la maqueta guardada coincide con una de fábrica, cambiarla por
   la de fábrica del ancho correcto no le quita nada a nadie. En cuanto tú
   mueves una sola caja deja de coincidir y no se toca nunca más.

   La huella exige que TODO cuadre con la de fábrica, y solo perdona lo que el
   empuje de los accesos podía cambiar por su cuenta: la tarjeta pudo crecer de
   alto, y los widgets que están debajo de ella y en sus columnas pudieron
   BAJAR. Cualquier otra diferencia —una caja movida, redimensionada, quitada o
   añadida— significa que ahí ha compuesto alguien, y entonces no se toca.

   Regla que queda: mientras no compongas, el hub sigue a tu monitor; en cuanto
   compones, es tuyo y manda tu composición. */
const IMG_RETIRADA = 'w1011786501277856'; // la imagen que solo existía en 16:9
function huellaDeFabrica(lista) {
  const fab = DEFAULT_WIDGETS();
  for (const k of ['uw', 'std']) {
    const acc = (fab.find((f) => f.type === 'shortcuts') || { geo: {} }).geo[k];
    const cruzaAcc = (g) => !!acc && g.col <= acc.col + acc.w - 1 && g.col + g.w - 1 >= acc.col;
    const porId = new Map(fab.map((f) => [f.id, f]));
    const bajados = [];
    const cuadra = lista.every((w) => {
      const g = w.geo && w.geo.m;
      if (!g) return false;
      const fw = porId.get(w.id);
      if (!fw) return w.id === IMG_RETIRADA; // la única sobrante admitida
      const f = fw.geo[k];
      if (f.col !== g.col || f.w !== g.w) return false;
      if (fw.type === 'shortcuts') return f.row === g.row; // solo pudo crecer de alto
      if (f.h !== g.h) return false;
      if (!(cruzaAcc(f) && f.row > acc.row)) return f.row === g.row;
      // Debajo de los accesos y en sus columnas: el empuje solo baja, nunca sube.
      if (g.row < f.row) return false;
      bajados.push({ delta: g.row - f.row, tope: g.row + g.h - 1 >= FILAS_MAESTRA });
      return true;
    });
    // El empuje es UN desplazamiento para todos: los que no lo comparten es que
    // los movió alguien. Único perdón, los que topan con la última fila, que el
    // empuje deja a medio camino.
    const d = Math.max(0, ...bajados.map((x) => x.delta));
    const empujeCoherente = bajados.every((x) => x.delta === d || x.tope);
    if (cuadra && empujeCoherente && fab.every((f) => lista.some((w) => w.id === f.id))) return k;
  }
  return null;
}
(function reparaMaquetaDeFabrica() {
  const toca = composicionDeLaPantalla();
  const cols = toca === 'uw' ? 17 : 13;
  if (COLS_MAESTRA === cols) return;            // ya está en el ancho que toca
  if (huellaDeFabrica(widgets) === null) return; // compuesta a mano: intocable
  store.set('naviris.widgets.pre-reparacion', widgets);
  const fab = DEFAULT_WIDGETS();
  const porId = new Map(widgets.map((w) => [w.id, w]));
  widgets = fab.map((f) => {
    const viejo = porId.get(f.id);
    if (!viejo) return f;
    // Se conserva TODO lo que sea contenido del usuario (la imagen que haya
    // elegido, por ejemplo); solo se rehace la geometría.
    viejo.geo = viejo.geo || {};
    viejo.geo.m = Object.assign({}, f.geo[toca]);
    viejo.col = viejo.geo.m.col; viejo.row = viejo.geo.m.row;
    viejo.w = viejo.geo.m.w; viejo.h = viejo.geo.m.h;
    return viejo;
  });
  // La imagen retirada solo se queda si el usuario le puso una suya; con la
  // del tema es pura decoración descolocada y se va.
  const suelta = porId.get(IMG_RETIRADA);
  if (suelta && suelta.img && !suelta.slot) widgets.push(suelta);
  COLS_MAESTRA = cols; FILAS_MAESTRA = 7;
  store.set('naviris.maqueta', { cols: COLS_MAESTRA, filas: FILAS_MAESTRA });
  store.set('naviris.widgets', widgets);
})();

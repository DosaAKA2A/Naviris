// Cuentas de escala y celdas del hub (src/hub-escala.js): sin DOM ni Electron.
// npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const he = require('../src/hub-escala');

// Hub medido en la app (px CSS) para varias ventanas maximizadas; inf = dock y
// botones de abajo, esquina = pastillas de arriba a la derecha.
const HUB = {
  '1366x768@125': { ancho: 1023, alto: 479, inf: 90 },
  '1280x720@100': { ancho: 1210, alto: 575, inf: 90 },
  '1920x1080@100': { ancho: 1850, alto: 920, inf: 116 },
  '2560x1440@100': { ancho: 2490, alto: 1280, inf: 116 }
};
const ESQUINA = { ancho: 146, alto: 70 };
const FABRICA = { c0: 4, c1: 9, r0: 3, r1: 5 };          // bloque 6×3 en 13×7
const CARGADA = { c0: 1, c1: 13, r0: 2, r1: 6 };         // casi toda la maqueta
const COLUMNA = { c0: 16, c1: 17, r0: 2, r1: 7 };        // la de Dosa: 2×6 a la derecha de 17
const encuadre = (t, caja, extra = {}) => he.encuadre({
  hub: { ancho: HUB[t].ancho, alto: HUB[t].alto }, inf: HUB[t].inf, esquina: ESQUINA,
  cols: extra.cols || 13, filas: 7, caja, ...extra
});
// Rectángulo en pantalla (desde la esquina del hub) de las celdas ocupadas
const ocupado = (m, c) => ({
  izq: m.x + m.s * he.PASO * (c.c0 - 1), der: m.x + m.s * (he.PASO * c.c1 - he.GAP),
  sup: m.y + m.s * he.PASO * (c.r0 - 1), inf: m.y + m.s * (he.PASO * c.r1 - he.GAP)
});

test('cajaOcupada: rectángulo mínimo que contiene todos los widgets', () => {
  assert.deepEqual(he.cajaOcupada([{ col: 4, row: 3, w: 3, h: 1 }, { col: 7, row: 4, w: 3, h: 2 }]), { c0: 4, c1: 9, r0: 3, r1: 5 });
  assert.equal(he.cajaOcupada([]), null);
  assert.equal(he.cajaOcupada([null, { col: 1, row: 1, w: 0, h: 1 }]), null);
});

test('tam y celdas: 13 celdas de 150 con hueco de 12 miden 2094', () => {
  assert.equal(he.tam(13), 13 * 150 + 12 * 12);
  assert.equal(he.tam(1), 150);
});

test('portátil 1366×768 al 125 %: la de fábrica se ve ENTERA, sin reflujo ni scroll', () => {
  const m = encuadre('1366x768@125', FABRICA);
  assert.equal(m.modo, 'maqueta');
  assert.ok(m.s >= he.SUELO && m.s < 1, 'escala ' + m.s);
  const o = ocupado(m, FABRICA), h = HUB['1366x768@125'];
  assert.ok(o.izq >= 0 && o.der <= h.ancho, 'cabe a lo ancho');
  assert.ok(o.sup >= 0 && o.inf <= h.alto - h.inf + 0.01, 'no pisa el dock');
});

test('1920×1080: la de fábrica a su tamaño de diseño (no gigante), con la maqueta centrada', () => {
  const m = encuadre('1920x1080@100', FABRICA);
  assert.equal(m.modo, 'maqueta');
  assert.equal(m.s, 1);
  // Centrada la MAQUETA (13 columnas), no el bloque: el de fábrica va una
  // media columna a la izquierda del centro, como en la pantalla grande.
  assert.ok(Math.abs(m.x - (HUB['1920x1080@100'].ancho - he.tam(13)) / 2) < 1e-9);
});

test('2560×1440: si la maqueta entera cabe más grande, crece con la pantalla', () => {
  const m = encuadre('2560x1440@100', FABRICA);
  assert.ok(m.s > 1, 'escala ' + m.s);
  assert.equal(m.s, Math.min((2490 * 0.94) / he.tam(13), (1280 - 16 - 116) / he.tam(7)));
});

test('la composición no se reordena: misma distancia entre widgets a cualquier escala', () => {
  for (const t of Object.keys(HUB)) {
    const m = encuadre(t, FABRICA);
    if (m.modo === 'reflujo') continue;
    const a = ocupado(m, { c0: 4, c1: 6, r0: 3, r1: 3 }), b = ocupado(m, { c0: 7, c1: 8, r0: 3, r1: 3 });
    assert.ok(Math.abs((b.izq - a.izq) - m.s * he.PASO * 3) < 1e-6, t);
  }
});

test('composición pegada a un lado (la de Dosa): se desplaza lo justo para no salirse', () => {
  const m = encuadre('1920x1080@100', COLUMNA, { cols: 17 });
  assert.equal(m.modo, 'maqueta');
  const o = ocupado(m, COLUMNA), h = HUB['1920x1080@100'];
  assert.ok(o.der <= h.ancho * 0.97 + 0.01, 'no se sale por la derecha');
  assert.ok(o.der > h.ancho * 0.9, 'sigue pegada a la derecha');
  assert.ok(o.sup >= ESQUINA.alto + 8 - 0.01, 'deja sitio a la esquina de arriba');
});

test('por debajo del suelo: scroll si cabe a lo ancho, reflujo si no', () => {
  const col = encuadre('1366x768@125', COLUMNA, { cols: 17 });
  assert.equal(col.modo, 'scroll');
  assert.equal(col.s, he.SUELO);
  assert.ok(col.alto > HUB['1366x768@125'].alto, 'el contenido pide scroll');
  const cargada = encuadre('1366x768@125', CARGADA);
  assert.equal(cargada.modo, 'reflujo');
  // el reflujo va a la escala del suelo (no a 1): misma densidad, más columnas
  assert.equal(cargada.s, he.SUELO);
  assert.equal(cargada.cols, Math.floor((1023 * 0.94 / he.SUELO + he.GAP) / he.PASO));
  assert.ok(cargada.cols * he.PASO * he.SUELO - he.GAP * he.SUELO <= 1023 * 0.94, 'las columnas caben');
});

test('reflujo muy estrecho: dos columnas encogidas, nunca menos', () => {
  const m = he.encuadre({ hub: { ancho: 200, alto: 500 }, cols: 13, filas: 7, caja: CARGADA, inf: 90 });
  assert.equal(m.modo, 'reflujo');
  assert.equal(m.cols, 2);
  assert.ok(m.s < he.SUELO && m.s >= 0.45);
});

test('editando: la maqueta ENTERA a lo ancho, a cualquier escala', () => {
  const m = encuadre('1366x768@125', FABRICA, { edicion: true });
  const ancho = 1023 * 0.94;
  assert.ok(Math.abs(m.s - Math.min(ancho / he.tam(13), Math.max((479 - 16 - 90) / he.tam(7), he.SUELO_EDICION))) < 1e-9);
  const o = ocupado(m, { c0: 1, c1: 13, r0: 1, r1: 7 });
  assert.ok(o.izq >= 1023 * 0.03 - 0.01 && o.der <= 1023 * 0.97 + 0.01);
  assert.notEqual(m.modo, 'reflujo');
});

test('celdaEn y celdasDe: el ratón en px de pantalla con la rejilla escalada', () => {
  const s = 0.7, origen = { left: 100, top: 50 };
  // centro de la celda (3, 2)
  const x = 100 + s * (2 * he.PASO + 75), y = 50 + s * (1 * he.PASO + 75);
  assert.deepEqual(he.celdaEn(x, y, origen, s), { col: 3, row: 2 });
  assert.deepEqual(he.celdaEn(0, 0, origen, s), { col: 1, row: 1 });
  assert.equal(he.celdasDe(s * he.PASO * 2, s), 2);
  assert.equal(he.celdasDe(s * he.PASO * 0.4, s), 0);
  assert.equal(he.celdasDe(-s * he.PASO, s), -1);
});

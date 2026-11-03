// AutoClaim de Twitch (preload): qué reclama, cuántas veces lo avisa y qué saldo manda.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cargaPreload } = require('./ayudas/preload-en-vm');

function boton(texto, props = {}) {
  return {
    textContent: texto, clics: 0,
    getAttribute: (k) => (k === 'aria-label' ? props.aria || null : null),
    getBoundingClientRect: () => props.rect || { width: 120, height: 30 },
    click() { this.clics++; },
    closest: () => null
  };
}
// Resumen de puntos como lo pinta Twitch hoy: el cofre aparece en el 2º hijo
function resumen(cofre) {
  return { querySelector: (s) => (s === ':scope > :nth-child(2) button' ? cofre || null : null) };
}
function twitch(dom) {
  let ahora = 1e6;
  const p = cargaPreload('https://www.twitch.tv/canal', { dom, ahora: () => ahora });
  p.avanza = (ms) => { ahora += ms; };
  p.reclamos = () => p.enviados.filter((m) => m.canal === 'cobalt-twitch' && m.datos.type === 'claim').map((m) => JSON.parse(JSON.stringify(m.datos)));
  p.enciende = () => p.manejadores['cobalt-autoloot']({}, { on: true, lowRes: false });
  return p;
}

test('AutoClaim: pulsa el cofre una vez y avisa sin contador propio, con el saldo de puntos', () => {
  const cofre = boton('');
  const dom = {
    '.community-points-summary': resumen(cofre),
    '[data-test-selector="copo-balance-string"]': { textContent: '1.250' }
  };
  const p = twitch(dom);
  p.enciende();
  assert.strictEqual(cofre.clics, 1);
  assert.deepStrictEqual(p.reclamos(), [{ type: 'claim', kind: 'points', balance: 1250 }]);
  // El mismo cofre sigue ahí un momento: no se cuenta dos veces
  p.avanza(2000); p.corre('interval');
  assert.strictEqual(p.reclamos().length, 1);
  // Pasados 5 s, un cofre nuevo sí
  p.avanza(5000); p.corre('interval');
  assert.strictEqual(p.reclamos().length, 2);
  assert.ok(p.reclamos().every((r) => !('count' in r)), 'la cuenta la lleva la interfaz');
});

test('AutoClaim: el cofre también se encuentra por su icono (.claimable-bonus__icon)', () => {
  const cofre = boton('');
  const p = twitch({ '.claimable-bonus__icon': { closest: (s) => (s === 'button' ? cofre : null) } });
  p.enciende();
  assert.strictEqual(cofre.clics, 1);
});

test('AutoClaim: el saldo ya no junta los Bits con los puntos y entiende las abreviaturas', () => {
  const casos = [['1.250', 1250], ['980', 980], ['12,3 mil', 12300], ['1.2K', 1200], ['3,4 M', 3400000], ['', null]];
  for (const [texto, esperado] of casos) {
    const p = twitch({
      '.community-points-summary': resumen(boton('')),
      '[data-test-selector="copo-balance-string"]': { textContent: texto }
    });
    p.enciende();
    assert.strictEqual(p.reclamos()[0].balance, esperado, texto);
  }
});

test('AutoClaim: cada botón de drop se pulsa y se cuenta una sola vez', () => {
  const drop = boton('Reclamar ahora');
  const otros = [boton('Claim your channel points'), boton('Reclamar', { rect: { width: 0, height: 0 } }), boton('Seguir')];
  const p = twitch({ 'button, [role="button"]': [drop, ...otros] });
  p.enciende();
  assert.strictEqual(drop.clics, 1);
  p.avanza(9000); p.corre('interval');
  p.avanza(9000); p.corre('interval');
  assert.strictEqual(drop.clics, 1, 'el botón que tarda en irse no se vuelve a pulsar');
  assert.deepStrictEqual(p.reclamos(), [{ type: 'claim', kind: 'drop' }]);
  assert.ok(otros.every((b) => b.clics === 0), 'ni "claim your channel points", ni invisibles, ni otros');
});

test('AutoClaim: apagado no reclama nada', () => {
  const cofre = boton('');
  const p = twitch({ '.community-points-summary': resumen(cofre) });
  p.enciende();
  p.manejadores['cobalt-autoloot']({}, { on: false });
  p.avanza(10000); p.corre('interval');
  assert.strictEqual(cofre.clics, 1);
});

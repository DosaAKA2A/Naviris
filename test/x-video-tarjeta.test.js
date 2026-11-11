// X: el clic sobre un video tapado por el enlace de su tarjeta de sitio web se queda
// en el video (pausa/reanuda) y no abre la web. Lo demás sigue como siempre.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cargaPreload } = require('./ayudas/preload-en-vm');

// Elementos de mentira con lo justo que mira el preload
function el(props = {}) {
  const e = {
    parentElement: null, hijos: [],
    closest(sel) {
      for (let x = this; x; x = x.parentElement) if (x.coincide && x.coincide(sel)) return x;
      return null;
    },
    contains(otro) { for (let x = otro; x; x = x.parentElement) if (x === this) return true; return false; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      const recorre = (n) => { for (const h of n.hijos) { if (h.coincide && h.coincide(sel)) out.push(h); recorre(h); } };
      recorre(this); return out;
    },
    ...props
  };
  return e;
}
function cuelga(padre, ...hijos) { for (const h of hijos) { h.parentElement = padre; padre.hijos.push(h); } return padre; }
const enlace = (href) => el({ href, coincide: (s) => s === 'a[href]' });
const boton = () => el({ coincide: (s) => /button/.test(s) });
function video(rect = { left: 0, top: 0, right: 640, bottom: 360 }) {
  return el({
    paused: true, llamadas: [],
    coincide: (s) => s === 'video',
    getBoundingClientRect: () => rect,
    play() { this.paused = false; this.llamadas.push('play'); return Promise.resolve(); },
    pause() { this.paused = true; this.llamadas.push('pause'); }
  });
}
function clic(target, extra = {}) {
  return { isTrusted: true, button: 0, target, clientX: 320, clientY: 180, prevenido: false, cortado: false,
    preventDefault() { this.prevenido = true; }, stopImmediatePropagation() { this.cortado = true; }, ...extra };
}
function escuchaClicDeX() {
  const p = cargaPreload('https://x.com/BrooklynNets/status/1349794411333394432');
  const c = p.escuchas.filter((x) => x.donde === 'window' && x.tipo === 'click' && x.captura);
  assert.strictEqual(c.length, 1, 'una escucha de clic en captura en window');
  return c[0].fn;
}
// Lo que pinta hoy el cliente nuevo de X: el enlace va ENCIMA del video, como hermano
function tarjetaComoHoy(href = 'https://www.youtube.com/watch?v=yUMUPyii1m8') {
  const v = video(); const a = enlace(href);
  const capa = cuelga(el(), a);
  const reproductor = cuelga(el(), v, capa);
  return { v, a, reproductor };
}

test('X: clic en el video tapado por el enlace de la tarjeta → reproduce y no abre la web', () => {
  const alClic = escuchaClicDeX();
  const { v, a } = tarjetaComoHoy();
  const e = clic(a);
  alClic(e);
  assert.ok(e.prevenido && e.cortado);
  assert.deepStrictEqual(v.llamadas, ['play']);
  const e2 = clic(a);
  alClic(e2);
  assert.deepStrictEqual(v.llamadas, ['play', 'pause'], 'el segundo clic pausa');
});

test('X: si el enlace (t.co) envuelve al reproductor también se queda en el video', () => {
  const alClic = escuchaClicDeX();
  const v = video(); const a = cuelga(enlace('https://t.co/abc123'), cuelga(el(), v));
  const e = clic(v.parentElement);
  alClic(e);
  assert.ok(e.prevenido);
  assert.deepStrictEqual(v.llamadas, ['play']);
});

test('X: lo que no es un video tapado sigue igual', () => {
  const alClic = escuchaClicDeX();
  // Fuera del rectángulo del video (el "De youtube.com" de debajo, el título…)
  let t = tarjetaComoHoy();
  let e = clic(t.a, { clientY: 400 }); alClic(e);
  assert.ok(!e.prevenido, 'fuera del video'); assert.deepStrictEqual(t.v.llamadas, []);
  // Enlace interno de X sobre un video (el de un post normal)
  t = tarjetaComoHoy('https://x.com/BrooklynNets/status/1');
  e = clic(t.a); alClic(e);
  assert.ok(!e.prevenido, 'enlace a x.com');
  // Enlace relativo (también es de X)
  t = tarjetaComoHoy('/BrooklynNets/status/1');
  e = clic(t.a); alClic(e);
  assert.ok(!e.prevenido, 'enlace relativo');
  // Ctrl+clic y clic con la rueda: quien lo hace quiere abrir la web
  t = tarjetaComoHoy();
  e = clic(t.a, { ctrlKey: true }); alClic(e); assert.ok(!e.prevenido, 'ctrl');
  e = clic(t.a, { button: 1 }); alClic(e); assert.ok(!e.prevenido, 'rueda');
  // Clic sintético (lo lanza la propia página)
  e = clic(t.a, { isTrusted: false }); alClic(e); assert.ok(!e.prevenido, 'sintético');
  // Enlace sin video cerca (tarjeta de imagen o de texto)
  const a = enlace('https://example.com/');
  cuelga(el(), a);
  e = clic(a); alClic(e); assert.ok(!e.prevenido, 'tarjeta sin video');
  // Dos videos en el mismo bloque: no se sabe cuál es, no se toca
  const v1 = video(), v2 = video(), a2 = enlace('https://example.com/');
  cuelga(el(), v1, v2, cuelga(el(), a2));
  e = clic(a2); alClic(e); assert.ok(!e.prevenido, 'dos videos');
});

test('X: los controles del reproductor dentro del enlace siguen a lo suyo', () => {
  const alClic = escuchaClicDeX();
  const v = video(); const b = boton();
  cuelga(enlace('https://t.co/abc123'), cuelga(el(), v), b);
  const e = clic(b);
  alClic(e);
  assert.ok(!e.prevenido);
  assert.deepStrictEqual(v.llamadas, []);
});

test('X: la escucha solo se pone en x.com y twitter.com', () => {
  for (const url of ['https://example.com/', 'https://www.youtube.com/', 'https://notx.com/']) {
    const p = cargaPreload(url);
    assert.ok(!p.escuchas.some((x) => x.donde === 'window' && x.tipo === 'click'), url);
  }
  assert.ok(cargaPreload('https://twitter.com/i/status/1').escuchas.some((x) => x.donde === 'window' && x.tipo === 'click'));
});

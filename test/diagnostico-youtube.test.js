// Qué dice la batería del bloqueador según lo que ve la página de YouTube: un aviso
// sin contestar o un límite a la IP no pueden pasar por un reproductor roto.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diagnosticoYouTube } = require('./e2e/naviris-adblock');

const base = {
  url: 'https://www.youtube.com/watch?v=x', playabilityInicial: { status: 'OK', reason: null }, playabilityReproductor: { status: 'OK', reason: null },
  hayMoviePlayer: true, hayVideo: true, video: { t: 3, pausado: false }, avisoCookies: [], pantallaError: null, estadoHttp: 200
};
const tipo = (cambios) => diagnosticoYouTube({ ...base, ...cambios }).tipo;

test('reproductor en orden', () => assert.equal(tipo({}), 'ok'));

test('las dos formas del aviso de cookies', () => {
  assert.equal(tipo({ avisoCookies: ['Rechazar el uso de cookies'] }), 'aviso-cookies');
  assert.equal(tipo({ url: 'https://consent.youtube.com/m?continue=x', hayVideo: false, playabilityInicial: null, playabilityReproductor: null }), 'aviso-cookies');
});

test('el reto de bot y el 429 son límite de la IP, en inglés y en español', () => {
  for (const reason of ['Sign in to confirm you’re not a bot', 'Inicia sesión para confirmar que no eres un bot']) {
    const d = diagnosticoYouTube({ ...base, hayVideo: false, playabilityInicial: { status: 'LOGIN_REQUIRED', reason }, playabilityReproductor: null });
    assert.equal(d.tipo, 'limite-ip');
    assert.match(d.resumen, /LOGIN_REQUIRED/);
  }
  assert.equal(tipo({ estadoHttp: 429, hayVideo: false, playabilityInicial: null, playabilityReproductor: null }), 'limite-ip');
  assert.equal(tipo({ url: 'https://www.google.com/sorry/index?continue=x', hayVideo: false, playabilityInicial: null, playabilityReproductor: null }), 'limite-ip');
});

test('otro estado no es límite ni se da por bueno', () => {
  assert.equal(tipo({ playabilityReproductor: { status: 'LOGIN_REQUIRED', reason: 'Confirma tu edad' } }), 'no-reproducible');
  assert.equal(tipo({ playabilityReproductor: { status: 'ERROR', reason: 'Video no disponible' } }), 'no-reproducible');
});

test('sin datos y sin video: no hay reproductor', () => {
  assert.equal(tipo({ hayVideo: false, playabilityInicial: null, playabilityReproductor: null }), 'sin-reproductor');
});

test('una página que no contesta no revienta el diagnóstico', () => {
  assert.equal(diagnosticoYouTube({ errorAlMirar: 'conexión CDP cerrada' }).tipo, 'sin-respuesta');
  assert.equal(diagnosticoYouTube(undefined).tipo, 'sin-respuesta');
});

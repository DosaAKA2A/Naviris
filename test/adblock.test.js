// Decisiones del bloqueador (src/adblock.js) con listas pequeñas y los recursos
// que viajan con la app. Sin red ni Electron: npm test
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const adblock = require('../src/adblock');

const RECURSOS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'adblock', 'resources.json'), 'utf8'));
const pide = (url, tipo = 'script', extra = {}) => ({ url, resourceType: tipo, method: 'GET', referrer: '', ...extra });

test('sin motor, check() devuelve null (main usa el respaldo por dominios)', () => {
  assert.equal(adblock.check(pide('https://ads.example/x.js'), 'https://site.example/'), null);
  assert.equal(adblock.arranqueDe('https://site.example/').scriptlets, '');
});

// Lista de confianza (máscara 1, como las listas por defecto de Brave) y otra sin permisos.
const CONFIANZA = [
  '||ads.example^',
  '||ads.example/ok.js',
  '@@||ads.example/ok.js',
  '||cebo.example/ad_status.js$script,redirect=noopjs',
  '||cebo.example/pixel.gif$image,redirect=1x1.gif',
  '||tracker.example^$third-party',
  '$removeparam=utm_source,domain=limpia.example',
  'site.example##.anuncio',
  'site.example##.consent-banner',
  'site.example##+js(set, miBandera, 1)',
  'confianza.example##+js(trusted-set, otraBandera, 1)',
  // Las reglas de clic automático en el aviso de cookies de YouTube que
  // Naviris quita (ver REGLAS_FUERA): tal cual vienen en las listas.
  'www.youtube.com##+js(trusted-click-element, ytd-button-renderer.ytd-consent-bump-v2-lightbox + ytd-button-renderer.ytd-consent-bump-v2-lightbox button[aria-label], , 1000)',
  'www.youtube.com##+js(trusted-click-element, .ytd-consent-bump-v2-lightbox > yt-button-shape > button[aria-label="Accept the use of cookies and other data for the purposes described"], , 1000)',
  'www.youtube.com,m.youtube.com##+js(trusted-click-element, button[aria-label*="Accept the use of cookie"], , 1500)',
  'www.youtube.com##+js(set, ytInitialPlayerResponse.adPlacements, undefined)',
  // Ocultado genérico por clase e id, con una excepción y un sitio sin genéricos.
  '##.banner-publi',
  '###caja-anuncio',
  '##.consent-generico',
  // Ocultado genérico que no es de clase ni id: llega en el CSS de cualquier sitio.
  '##[data-consent-aviso]',
  '##[data-publi-generica]',
  'exento.example#@#.banner-publi',
  '@@||singenericos.example^$generichide'
].join('\n');
const SIN_PERMISOS = 'otra.example##+js(trusted-set, banderaSinPermiso, 1)\notra.example##+js(set, banderaNormal, 1)';

test('monta el motor con dos grupos de máscara', () => {
  adblock.buildEngine(new Map([[1, CONFIANZA], [0, SIN_PERMISOS]]), RECURSOS);
  assert.equal(adblock.status().engine, true);
});

test('bloquea, respeta las excepciones @@ y deja pasar lo demás', () => {
  assert.equal(adblock.check(pide('https://ads.example/banner.js'), 'https://site.example/').bloquear, true);
  assert.equal(adblock.check(pide('https://ads.example/ok.js'), 'https://site.example/').bloquear, false);
  assert.equal(adblock.check(pide('https://cdn.example/app.js'), 'https://site.example/').bloquear, false);
});

test('$redirect= se sirve por el esquema propio y siempre con la misma URL', () => {
  const a = adblock.check(pide('https://cebo.example/ad_status.js'), 'https://www.youtube.com/');
  assert.equal(a.bloquear, true);
  assert.match(a.sustituto, /^naviris-sustituto:\/\/r\/[0-9a-f]{18}$/);
  const b = adblock.check(pide('https://cebo.example/ad_status.js?x=1'), 'https://www.youtube.com/');
  assert.equal(b.sustituto, a.sustituto, 'el mismo recurso debe reutilizar su URL');
  const s = adblock.sustituto(a.sustituto);
  assert.equal(s.mime, 'application/javascript');
  assert.ok(s.cuerpo instanceof Uint8Array && s.cuerpo.length > 0);
  const gif = adblock.check(pide('https://cebo.example/pixel.gif', 'image'), 'https://site.example/');
  assert.equal(adblock.sustituto(gif.sustituto).mime, 'image/gif');
  assert.equal(adblock.sustituto('naviris-sustituto://r/noexiste'), null);
});

test('$removeparam reescribe la URL solo si no se bloquea', () => {
  const r = adblock.check(pide('https://limpia.example/p?utm_source=x&id=7', 'xhr', { referrer: 'https://limpia.example/' }), 'https://limpia.example/');
  assert.equal(r.bloquear, false);
  assert.equal(r.reescrita, 'https://limpia.example/p?id=7');
});

test('$third-party se evalúa contra la página cuando la petición no trae referrer', () => {
  assert.equal(adblock.check(pide('https://tracker.example/t.js'), 'https://site.example/').bloquear, true);
  assert.equal(adblock.check(pide('https://tracker.example/t.js'), 'https://tracker.example/').bloquear, false);
  // Con referrer manda el referrer (el documento que pide, p. ej. un iframe).
  assert.equal(adblock.check(pide('https://tracker.example/t.js', 'script', { referrer: 'https://tracker.example/x' }), 'https://site.example/').bloquear, false);
});

test('cosméticos: fuera de YouTube oculta también los avisos de cookies, como Brave', () => {
  const c = adblock.cosmeticsFor('https://site.example/');
  assert.match(c.css, /\.anuncio/);
  assert.match(c.css, /\.consent-banner/);
  assert.match(c.css, /\[data-consent-aviso\]/);
});

// Los avisos de cookies solo se dejan a la vista en YouTube: allí el aviso
// escondido pero montado pausa el reproductor (ver sinAvisoDeCookies).
const EN_YOUTUBE = ['https://www.youtube.com/watch?v=x', 'https://youtube.com/', 'https://m.youtube.com/', 'https://music.youtube.com/',
  'https://www.youtube-nocookie.com/embed/x', 'https://youtube-nocookie.com/embed/x'];
const FUERA_DE_YOUTUBE = ['https://site.example/', 'https://www.spiegel.de/', 'https://notyoutube.com/', 'https://youtube.com.example/', 'https://www.youtube.co/'];
test('avisos de cookies: se dejan a la vista solo en YouTube y sus subdominios', () => {
  for (const url of EN_YOUTUBE) {
    const css = adblock.cosmeticsFor(url).css;
    assert.doesNotMatch(css, /consent/i, url + ': CSS');
    assert.match(css, /\[data-publi-generica\]/, url + ': el resto del CSS sigue');
    assert.deepEqual(adblock.genericosPara(url, ['consent-generico', 'banner-publi'], []), ['.banner-publi'], url + ': genérico');
  }
  for (const url of FUERA_DE_YOUTUBE) {
    assert.match(adblock.cosmeticsFor(url).css, /\[data-consent-aviso\]/, url + ': CSS');
    assert.deepEqual(adblock.genericosPara(url, ['consent-generico'], []), ['.consent-generico'], url + ': genérico');
  }
});

test('scriptlets: envueltos con scriptletGlobals y JavaScript válido', () => {
  const s = adblock.arranqueDe('https://site.example/').scriptlets;
  assert.match(s, /^\(function \(\) \{\nconst scriptletGlobals = \{\};/);
  assert.match(s, /miBandera/);
  assert.doesNotThrow(() => new vm.Script(s));
});

test('los trusted-* solo se inyectan desde una lista con permiso de confianza', () => {
  assert.match(adblock.arranqueDe('https://confianza.example/').scriptlets, /otraBandera/);
  const otra = adblock.arranqueDe('https://otra.example/').scriptlets;
  assert.match(otra, /banderaNormal/);
  assert.doesNotMatch(otra, /banderaSinPermiso/);
});

test('YouTube: ninguna regla pulsa sola el aviso de cookies (bucle de recargas)', () => {
  const s = adblock.arranqueDe('https://www.youtube.com/watch?v=x').scriptlets;
  assert.match(s, /ytInitialPlayerResponse\.adPlacements/, 'el resto de scriptlets de YouTube sigue');
  // Se busca la llamada (trustedClickElement("…")), no el texto de las
  // funciones de apoyo, que se incluyen igual por otras reglas.
  const clics = s.split('\n').filter((l) => l.startsWith('trustedClickElement('));
  assert.deepEqual(clics, [], 'quedan clics automáticos en YouTube');
});

test('ocultado genérico: solo lo que casa y con excepciones', () => {
  const g = adblock.genericosPara('https://cualquiera.example/', ['banner-publi', 'normal'], ['caja-anuncio', 'cabecera']);
  assert.deepEqual(g.sort(), ['#caja-anuncio', '.banner-publi']);
  assert.deepEqual(adblock.genericosPara('https://exento.example/', ['banner-publi'], []), [], 'la excepción #@# del sitio se respeta');
  assert.deepEqual(adblock.genericosPara('https://singenericos.example/', ['banner-publi'], ['caja-anuncio']), [], '$generichide apaga el genérico');
  assert.equal(adblock.arranqueDe('https://cualquiera.example/').genericos, true);
  assert.equal(adblock.arranqueDe('https://singenericos.example/').genericos, false);
});

test('motor montado en un hilo aparte y serializado: decide igual que el montado aquí', async () => {
  const { Worker } = require('worker_threads');
  const { Engine, FilterSet } = require('adblock-rs');
  const grupos = [[1, CONFIANZA], [0, SIN_PERMISOS]];
  const buf = await new Promise((ok, no) => {
    const w = new Worker(path.join(__dirname, '..', 'src', 'adblock-motor.js'), { workerData: { motorDelBloqueador: true, grupos } });
    w.once('message', ok); w.once('error', no);
  });
  const e = new Engine(new FilterSet(false));
  e.deserialize(buf);
  e.useResources(RECURSOS);
  const r = (url, fuente, tipo) => e.check(url, fuente, tipo, 'GET', true);
  assert.equal(r('https://ads.example/banner.js', 'https://site.example/', 'script').should_block, true);
  assert.equal(r('https://ads.example/ok.js', 'https://site.example/', 'script').should_block, false, 'la excepción @@ sobrevive al serializado');
  assert.ok(r('https://cebo.example/ad_status.js', 'https://www.youtube.com/', 'script').redirect, 'el $redirect sobrevive');
  const s = (u) => e.urlCosmeticResources(u).injected_script;
  assert.match(s('https://confianza.example/'), /otraBandera/, 'el permiso de confianza sobrevive');
  assert.doesNotMatch(s('https://otra.example/'), /banderaSinPermiso/);
  assert.doesNotMatch(s('https://www.youtube.com/'), /Accept the use of cookie/, 'REGLAS_FUERA también en el hilo');
});

// Va la última: deja montado un motor distinto del de las pruebas de arriba.
test('si el hilo del motor no contesta, se termina al tope y se monta en el principal', async () => {
  const lineas = [];
  const log = console.log;
  console.log = (...a) => lineas.push(a.join(' '));
  const t0 = Date.now();
  try {
    await adblock.montaYGuarda(new Map([[1, '||colgado.example^']]), RECURSOS, { archivo: path.join(__dirname, 'ayudas', 'hilo-colgado.js'), topeMs: 300 });
  } finally { console.log = log; }
  const ms = Date.now() - t0;
  assert.ok(ms >= 300 && ms < 5000, 'tardó ' + ms + ' ms');
  assert.equal(lineas.filter((l) => /no contestó en 0\.3 s/.test(l)).length, 1, 'una línea en el registro: ' + lineas.join(' | '));
  assert.ok(lineas.some((l) => /montado en el hilo principal/.test(l)));
  assert.equal(adblock.check(pide('https://colgado.example/x.js'), 'https://site.example/').bloquear, true, 'el motor de respaldo bloquea');
  // Que el hilo se termina de verdad lo comprueba el propio proceso del test: un
  // hilo que siguiera dando vueltas no le dejaría acabar.
});

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

test('cosméticos: oculta los anuncios del sitio y los genéricos', () => {
  const c = adblock.cosmeticsFor('https://site.example/');
  assert.match(c.css, /\.anuncio/);
  assert.match(c.css, /\[data-publi-generica\]/);
});

// Los avisos de consentimiento de cookies los contesta la persona: no se
// esconden en ninguna web (en YouTube, además, escondido pero montado pausa
// el reproductor; ver sinAvisoDeCookies).
const WEBS = ['https://site.example/', 'https://www.spiegel.de/', 'https://www.youtube.com/watch?v=x', 'https://m.youtube.com/',
  'https://music.youtube.com/', 'https://www.youtube-nocookie.com/embed/x'];
test('avisos de cookies: no se esconden en ninguna web', () => {
  for (const url of WEBS) {
    const css = adblock.cosmeticsFor(url).css;
    assert.doesNotMatch(css, /consent/i, url + ': CSS');
    assert.match(css, /\[data-publi-generica\]/, url + ': el resto del CSS sigue');
    assert.deepEqual(adblock.genericosPara(url, ['consent-generico', 'banner-publi'], []), ['.banner-publi'], url + ': genérico');
  }
});

// Un trozo del catálogo de Brave (filter_lists/list_catalog.json) tal como viene.
const CATALOGO = [
  { uuid: 'default', title: 'Brave Default Adblock Filters', default_enabled: true, permission_mask: 1,
    sources: [{ url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt' }, { url: 'https://easylist.to/easylist/easylist.txt' }] },
  { uuid: '9F38E77A-64AA-4C5F-AF37-727CAE1266FF', title: 'Brave IOS-Specific Filters', default_enabled: true, permission_mask: 1, platforms: ['IOS'],
    sources: [{ url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-ios-specific.txt' }] },
  { uuid: 'AC023D22-AE88-4060-A978-4FEEEC4221693', title: 'Cookie notice blocker', desc: 'EasyList Cookie', default_enabled: true, permission_mask: 1,
    sources: [{ url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster_ubo.txt' },
      { url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt' },
      { url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/brave-cookie-specific.txt' }] },
  { uuid: '2F3DCE16-A19A-493C-A88F-2E110FBD37D6', title: 'Mobile app promo blocker', default_enabled: true, permission_mask: 1,
    sources: [{ url: 'https://secure.fanboy.co.nz/fanboy-mobile-notifications.txt' }] },
  { uuid: 'otra', title: 'Fanboy Annoyances', default_enabled: false, sources: [{ url: 'https://secure.fanboy.co.nz/fanboy-annoyance_ubo.txt' }] }
];
test('listas: la de avisos de cookies no se baja; las demás por defecto sí, con su máscara', () => {
  const f = adblock.fuentesDe(CATALOGO);
  assert.deepEqual(f.map((x) => x.url.split('/').pop()), ['filters.txt', 'easylist.txt', 'fanboy-mobile-notifications.txt',
    'serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext']);
  assert.deepEqual(f.map((x) => x.mascara), [1, 1, 1, 0]);
  assert.ok(!f.some((x) => /cookie/i.test(x.url)), 'se cuela una lista de cookies');
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

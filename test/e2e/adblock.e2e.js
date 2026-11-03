// Batería e2e del bloqueador contra Naviris real (perfil limpio, CDP).
// Uso: npm run test:e2e:adblock   (ver test/e2e/naviris.js para las variables)
//
// Cada prueba mide algo concreto, deja captura en <NAVIRIS_E2E_DIR>/capturas y
// apunta lo medido en <NAVIRIS_E2E_DIR>/resultados-<etiqueta>.json
// (NAVIRIS_E2E_ETIQUETA, por defecto "ultima"), para comparar antes y después.
//
// Lo que NO se puede probar sin una cuenta de Google marcada por YouTube: el
// muro anti-bloqueador real (playabilityStatus ERROR con
// enforcementMessageViewModel). Aquí se simula pintando esos mismos datos en
// la página (prueba "muro simulado"), que es lo que lee el preload.
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const n = require('./naviris-adblock');

const ETIQUETA = process.env.NAVIRIS_E2E_ETIQUETA || 'ultima';
const RESULTADOS = path.join(n.DIR, 'resultados-' + ETIQUETA + '.json');
const resultados = {};
function apunta(prueba, datos) {
  resultados[prueba] = datos;
  fs.mkdirSync(n.DIR, { recursive: true });
  fs.writeFileSync(RESULTADOS, JSON.stringify(resultados, null, 2), 'utf8');
}

// Videos de canales grandes: sin cuenta y desde España todos traen preroll
// (comprobado con el bloqueador apagado: ad-showing a los pocos segundos).
const VIDEOS = ['kJQP7kiw5Fk', 'JGwWNGJdvx8', '9bZkp7q19f0'];
// Para el embed, uno que permite incrustarse (los de VEVO no).
const EMBED = 'dQw4w9WgXcQ';
const LARGO = '0e3GPea1Tyg';     // 25 min (MrBeast): para buscar anuncios a mitad
// El directo 24/7 en curso de Lofi Girl (los id de sus directos cambian).
const DIRECTO = 'https://www.youtube.com/@LofiGirl/live';

// Lo que mira cada muestra del reproductor de YouTube.
const ESTADO_YT = `
  const p = document.getElementById('movie_player');
  const v = p ? p.querySelector('video') : document.querySelector('video');
  let pr = null; try { pr = p && p.getPlayerResponse && p.getPlayerResponse(); } catch (e) {}
  return {
    url: location.href,
    estado: p && p.getPlayerState ? p.getPlayerState() : null,
    t: v ? v.currentTime : null, pausado: v ? v.paused : null,
    anuncio: p ? p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting') : null,
    datosAnuncio: pr ? !!(pr.adPlacements || pr.adSlots) : null,
    directo: !!(pr && pr.videoDetails && pr.videoDetails.isLive),
    estadoPR: pr && pr.playabilityStatus ? pr.playabilityStatus.status : null
  };`;

async function muestrea(p, segundos) {
  const m = [];
  for (let i = 0; i < segundos; i++) {
    await n.espera(1000);
    m.push(await n.enPestana(p, ESTADO_YT).catch((e) => ({ error: e.message })));
  }
  const conT = m.filter((x) => typeof x.t === 'number');
  return {
    anuncio: m.some((x) => x.anuncio),
    datosAnuncio: m.some((x) => x.datosAnuncio),
    primerT: conT.length ? conT[0].t : null,
    avanza: conT.length > 1 ? +(conT[conT.length - 1].t - conT[0].t).toFixed(1) : 0,
    pausadoAlFinal: m.length ? m[m.length - 1].pausado : null,
    estados: m.map((x) => x.estado),
    directo: m.some((x) => x.directo),
    estadoPR: m.length ? m[m.length - 1].estadoPR : null
  };
}

// Elementos de anuncio de la interfaz de YouTube que se ven (no ocultos).
const ANUNCIOS_INTERFAZ = `
  const sel = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-search-pyv-renderer, ytd-banner-promo-renderer, #masthead-ad, ytd-statement-banner-renderer, ytd-companion-slot-renderer, ytd-action-companion-ad-renderer, ytd-player-legacy-desktop-watch-ads-renderer, ytd-ads-engagement-panel-content-renderer, ytm-promoted-sparkles-web-renderer, ad-slot-renderer';
  const todos = [...document.querySelectorAll(sel)];
  const vistos = todos.filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent !== null && r.width > 0 && r.height > 0; });
  return { total: todos.length, vistos: vistos.length, tipos: [...new Set(vistos.map((e) => e.tagName.toLowerCase()))] };`;

/* ======================= YouTube con el bloqueador ======================= */
describe('YouTube con el bloqueador', { timeout: 15 * 60 * 1000 }, () => {
  let app, p;
  before(async () => {
    app = await n.arranca('yt');
    await n.esperaMotor(app);
    p = await n.abrePestana(app, 'https://www.youtube.com/watch?v=' + VIDEOS[0]);
    await n.quitaAvisoCookiesYT(p);
  });
  after(() => n.cierra(app));

  it('preroll: varios videos sin anuncio, arrancan en 0:00 y avanzan', async () => {
    const por = {};
    for (const id of VIDEOS) {
      await n.navega(p, 'https://www.youtube.com/watch?v=' + id);
      por[id] = await muestrea(p, 12);
      await n.captura(p, 'yt-preroll-' + id);
    }
    apunta('yt-preroll', por);
    for (const [id, r] of Object.entries(por)) {
      assert.equal(r.anuncio, false, id + ': se vio un anuncio');
      assert.equal(r.datosAnuncio, false, id + ': el reproductor recibió adPlacements/adSlots');
      assert.ok(r.primerT !== null && r.primerT < 4, id + ': no arrancó en 0:00 (' + r.primerT + ')');
      assert.ok(r.avanza >= 6, id + ': el video no avanza (' + r.avanza + ' s en 11 s)');
      assert.equal(r.pausadoAlFinal, false, id + ': se quedó en pausa');
    }
  });

  it('navegación interna (SPA): el video siguiente tampoco trae anuncio', async () => {
    await n.navega(p, 'https://www.youtube.com/watch?v=' + VIDEOS[1]);
    await n.espera(5000);
    const antes = await n.enPestana(p, 'return location.href;');
    const ok = await n.hasta(() => n.enPestana(p, `
      const a = [...document.querySelectorAll('#secondary a[href^="/watch?v="], #related a[href^="/watch?v="]')].find((x) => x.offsetParent && !x.href.includes(${JSON.stringify(VIDEOS[1])}));
      if (!a) return false; a.click(); return true;`), { tope: 20000, que: 'un video relacionado' });
    await n.hasta(async () => (await n.enPestana(p, 'return location.href;')) !== antes, { tope: 15000, que: 'la navegación interna' });
    const docsAntes = n.documentos(p).length;
    const r = await muestrea(p, 12);
    r.documentosNuevos = n.documentos(p).length - docsAntes;
    r.url = await n.enPestana(p, 'return location.href;');
    await n.captura(p, 'yt-spa');
    apunta('yt-spa', r);
    assert.ok(ok);
    assert.equal(r.anuncio, false, 'se vio un anuncio tras navegar por dentro');
    assert.equal(r.datosAnuncio, false, 'el reproductor recibió datos de anuncio');
    assert.ok(r.avanza >= 6, 'el video no avanza');
  });

  it('midroll: a mitad de un video largo no salta ningún anuncio', async () => {
    await n.navega(p, 'https://www.youtube.com/watch?v=' + LARGO);
    const inicio = await muestrea(p, 6);
    const saltos = [];
    for (const frac of [0.3, 0.5, 0.7]) {
      await n.enPestana(p, `const v = document.querySelector('#movie_player video'); v.currentTime = v.duration * ${frac}; return true;`);
      saltos.push(await muestrea(p, 8));
    }
    await n.captura(p, 'yt-midroll');
    apunta('yt-midroll', { inicio, saltos });
    assert.equal(inicio.anuncio, false);
    for (const s of saltos) {
      assert.equal(s.anuncio, false, 'anuncio a mitad del video');
      assert.ok(s.avanza >= 4, 'el video no avanza tras saltar');
    }
  });

  it('directo: el live arranca sin anuncio', async () => {
    await n.navega(p, DIRECTO);
    const r = await muestrea(p, 14);
    await n.captura(p, 'yt-directo');
    apunta('yt-directo', r);
    assert.equal(r.anuncio, false, 'anuncio en el directo');
    assert.ok(r.directo, 'no se reconoce como directo');
    assert.ok(r.avanza >= 6, 'el directo no avanza');
  });

  it('Shorts: se reproducen y ninguno de los cinco primeros es un anuncio', async () => {
    await n.navega(p, 'https://www.youtube.com/shorts/');
    await n.hasta(() => n.enPestana(p, 'return /\\/shorts\\/[\\w-]{6,}/.test(location.pathname);'), { tope: 20000, que: 'un Short' });
    const vistos = [];
    for (let i = 0; i < 5; i++) {
      await n.espera(3500);
      vistos.push(await n.enPestana(p, `
        const act = document.querySelector('ytd-reel-video-renderer[is-active]') || document.querySelector('ytd-shorts');
        const v = document.querySelector('ytd-reel-video-renderer[is-active] video, #shorts-player video');
        return {
          url: location.pathname,
          anuncio: !!(act && act.querySelector('ytd-ad-slot-renderer, ytd-reel-player-overlay-renderer[is-ad], .ytp-ad-player-overlay, ad-badge-view-model, [class*="ad-badge"]')),
          t: v ? +v.currentTime.toFixed(1) : null, pausado: v ? v.paused : null
        };`));
      // Al siguiente, con el botón de la propia página (como la persona).
      await n.enPestana(p, `
        const b = document.querySelector('#navigation-button-down button, #navigation-button-down yt-button-shape button');
        if (b) b.click(); else { const c = document.querySelector('#shorts-inner-container'); if (c) c.scrollBy(0, c.clientHeight); }
        return true;`);
    }
    await n.captura(p, 'yt-shorts');
    apunta('yt-shorts', vistos);
    assert.ok(new Set(vistos.map((x) => x.url)).size >= 4, 'no se pasó de un Short a otro');
    assert.equal(vistos.filter((x) => x.anuncio).length, 0, 'algún Short era un anuncio');
    assert.ok(vistos.filter((x) => x.t > 0.5).length >= 3, 'los Shorts no se reproducen');
  });

  it('portada y búsqueda: sin anuncios a la vista', async () => {
    await n.navega(p, 'https://www.youtube.com/');
    await n.espera(7000);
    await n.enPestana(p, 'window.scrollTo(0, 2500); return true;');
    await n.espera(2500);
    const portada = await n.enPestana(p, ANUNCIOS_INTERFAZ);
    await n.enPestana(p, 'window.scrollTo(0, 0); return true;');
    await n.captura(p, 'yt-portada');
    await n.navega(p, 'https://www.youtube.com/results?search_query=' + encodeURIComponent('comprar zapatillas running'));
    await n.espera(7000);
    const busqueda = await n.enPestana(p, ANUNCIOS_INTERFAZ);
    await n.captura(p, 'yt-busqueda');
    apunta('yt-portada-busqueda', { portada, busqueda });
    assert.equal(portada.vistos, 0, 'anuncios en la portada: ' + portada.tipos);
    assert.equal(busqueda.vistos, 0, 'anuncios en la búsqueda: ' + busqueda.tipos);
  });

  it('YouTube Music: reproduce sin anuncio', async () => {
    // En su propia pestaña, que luego se cierra: Music pide confirmación al
    // salir mientras suena (beforeunload) y ese diálogo de Naviris es modal.
    const m = await n.abrePestana(app, 'https://music.youtube.com/watch?v=' + VIDEOS[0]);
    await n.espera(5000);
    // Music no siempre arranca solo sin gesto: se le da al play como la persona.
    await n.enPestana(m, 'const v = document.querySelector("video"); if (v && v.paused) { const b = document.querySelector("#play-pause-button"); if (b) b.click(); } return true;');
    const r = await muestrea(m, 12);
    await n.captura(m, 'yt-music');
    await n.cierraPestana(app, m);
    apunta('yt-music', r);
    assert.equal(r.anuncio, false, 'anuncio en Music');
    assert.ok(r.avanza >= 5, 'Music no avanza');
  });

  it('huellas: lo que la página puede ver del bloqueador', async () => {
    await n.navega(p, 'https://www.youtube.com/watch?v=' + VIDEOS[2]);
    await n.espera(6000);
    const h = await n.enPestana(p, `
      const ts = (f) => { try { return Function.prototype.toString.call(f); } catch (e) { return 'error'; } };
      const propias = Object.getOwnPropertyNames(window).filter((k) => /cobalt|naviris|scriptlet|ubol?o?g|brave/i.test(k));
      return {
        responseJson: ts(Response.prototype.json),
        jsonParse: ts(JSON.parse),
        fetch: ts(window.fetch),
        propias,
        descYIPR: (() => { const d = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse'); return d ? (d.get ? 'accesor' : 'valor') + (d.configurable ? ' configurable' : '') : 'nada'; })()
      };`);
    apunta('yt-huellas', h);
    // uBlock (y Brave) no tocan Response.prototype.json: si aquí no es nativo,
    // es una diferencia con ellos que YouTube puede leer.
    assert.equal(h.responseJson, 'function json() { [native code] }', 'Response.prototype.json parcheado');
    assert.deepEqual(h.propias, []);
  });

  it('muro de diálogo: se cierra y el video sigue', async () => {
    await n.navega(p, 'https://www.youtube.com/watch?v=' + VIDEOS[2]);
    await n.espera(6000);
    await n.enPestana(p, `
      const d = document.createElement('tp-yt-paper-dialog');
      d.appendChild(document.createElement('ytd-enforcement-message-view-model'));
      document.body.appendChild(d);
      document.querySelector('#movie_player video').pause();
      return true;`);
    const t0 = Date.now();
    await n.hasta(() => n.enPestana(p, 'return !document.querySelector("tp-yt-paper-dialog ytd-enforcement-message-view-model");'), { tope: 5000, cada: 100, que: 'que se cierre el diálogo' });
    const ms = Date.now() - t0;
    const r = await muestrea(p, 5);
    apunta('yt-muro-dialogo', { msHastaCerrar: ms, avanza: r.avanza, pausado: r.pausadoAlFinal });
    assert.ok(ms < 2000, 'el diálogo tardó ' + ms + ' ms');
    assert.equal(r.pausadoAlFinal, false, 'el video siguió en pausa');
  });

  it('muro simulado en el reproductor: un reintento, luego a la vista con el botón de lista blanca', async () => {
    const vid = VIDEOS[1];
    await n.navega(p, 'https://www.youtube.com/watch?v=' + vid);
    await n.hasta(() => n.enPestana(p, 'return !!(document.querySelector("ytd-watch-flexy") && document.querySelector("#movie_player video"));'), { tope: 20000, que: 'el reproductor' });
    await n.espera(3000);
    // Técnica wall2.mjs: los mismos datos que manda YouTube a una cuenta marcada.
    const PON_MURO = `
      const f = document.querySelector('ytd-watch-flexy');
      const pd = (f.polymerController && f.polymerController.playerData) || f.playerData;
      pd.playabilityStatus = { status: 'ERROR', reason: 'Los bloqueadores de anuncios no están permitidos en YouTube', errorScreen: { enforcementMessageViewModel: { title: { content: 'Los bloqueadores de anuncios no están permitidos en YouTube' } } } };
      let es = f.querySelector('#error-screen');
      if (!es) { es = document.createElement('div'); es.id = 'error-screen'; f.appendChild(es); }
      es.hidden = false;
      if (!es.querySelector('ytd-enforcement-message-view-model')) { const e = document.createElement('ytd-enforcement-message-view-model'); e.textContent = 'Los bloqueadores de anuncios no están permitidos en YouTube'; es.appendChild(e); }
      document.querySelector('#movie_player video').pause();
      f.setAttribute('player-unavailable', '');
      return true;`;
    const docs0 = n.documentos(p).length;
    await n.enPestana(p, PON_MURO);
    // 1) Reintento: una recarga en ~2 s.
    await n.hasta(() => n.documentos(p).length > docs0, { tope: 8000, que: 'la recarga del reintento' });
    const msReintento = Date.now();
    await n.hasta(() => n.enPestana(p, 'return !!(document.querySelector("ytd-watch-flexy") && document.querySelector("#movie_player video")) && document.readyState === "complete";'), { tope: 20000, que: 'el reproductor tras recargar' });
    await n.espera(2500);
    // 2) El muro vuelve: se deja a la vista y la interfaz ofrece la lista blanca.
    const docs1 = n.documentos(p).length;
    await n.enPestana(p, PON_MURO);
    const toast = await n.hasta(() => n.evalua(app.ui, 'return els.toast.classList.contains("show") && els.toast.textContent.includes("Permitir anuncios") ? els.toast.textContent : "";'), { tope: 8000, que: 'el aviso con el botón de lista blanca' });
    await n.espera(3000);
    const sigue = await n.enPestana(p, 'const e = document.querySelector("#error-screen ytd-enforcement-message-view-model"); return !!e && e.isConnected && getComputedStyle(e).display !== "none";');
    const recargasDeMas = n.documentos(p).length - docs1;
    await n.captura(p, 'yt-muro-simulado');
    // 3) El botón mete youtube.com en la lista blanca y recarga.
    await n.evalua(app.ui, 'els.toast.querySelector("button").click(); return true;');
    const blanca = await n.hasta(async () => { const a = await n.evalua(app.ui, 'return (await window.cobalt.adblockGet()).whitelist;'); return a.includes('youtube.com') ? a : null; }, { tope: 5000, que: 'youtube.com en la lista blanca' });
    await n.hasta(() => n.documentos(p).length > docs1 + recargasDeMas, { tope: 8000, que: 'la recarga tras permitir' });
    apunta('yt-muro-simulado', { reintentoTrasMs: msReintento, toast, muroSigueVisible: sigue, recargasDeMas, listaBlanca: blanca });
    assert.equal(sigue, true, 'el muro se borró u ocultó (caja negra)');
    assert.equal(recargasDeMas, 0, 'recargó otra vez en vez de dejar el muro');
    await n.evalua(app.ui, 'await window.cobalt.adblockWhitelist("remove", "youtube.com"); return true;');
  });
});

/* =============== Bucle de recargas y aviso de cookies =============== */
describe('YouTube: aviso de cookies y recargas', { timeout: 5 * 60 * 1000 }, () => {
  let app;
  before(async () => { app = await n.arranca('yt-cookies'); await n.esperaMotor(app); });
  after(() => n.cierra(app));

  it('el aviso de cookies no se acepta solo y no hay bucle de recargas', async () => {
    // En inglés, que es el idioma de las reglas de clic automático de las listas.
    const p = await n.abrePestana(app, 'https://www.youtube.com/?hl=en');
    await n.espera(20000);
    const docs = n.documentos(p);
    const aviso = await n.enPestana(p, 'return !![...document.querySelectorAll(\'button[aria-label^="Accept the use of cookies"], button[aria-label^="Aceptar el uso de cookies"]\')].find((b) => b.offsetParent);');
    const ck = await p.cdp.envia('Network.getCookies', { urls: ['https://www.youtube.com/'] });
    const socs = ck.cookies.find((c) => c.name === 'SOCS');
    await n.captura(p, 'yt-cookies');
    apunta('yt-cookies-bucle', { documentos: docs, avisoVisible: aviso, cookieSOCS: socs ? socs.value : null });
    assert.equal(socs, undefined, 'el bloqueador aceptó/rechazó el aviso de cookies solo');
    assert.equal(aviso, true, 'el aviso de cookies no está a la vista');
    assert.ok(docs.length <= 3, 'demasiadas cargas de documento: ' + docs.length);
  });
});

/* ===================== Lista blanca y consumo ===================== */
describe('Lista blanca de YouTube y CPU', { timeout: 10 * 60 * 1000 }, () => {
  let app, p;
  before(async () => {
    app = await n.arranca('yt-blanca');
    await n.esperaMotor(app);
    p = await n.abrePestana(app, 'https://www.youtube.com/watch?v=' + VIDEOS[0]);
    await n.quitaAvisoCookiesYT(p);
  });
  after(() => n.cierra(app));

  async function cpuReproduciendo(id) {
    await n.navega(p, 'https://www.youtube.com/watch?v=' + id);
    await n.espera(15000);                 // pasa el preroll si lo hay
    const a = await n.cpuPagina(p); const t0 = Date.now();
    const r = await muestrea(p, 30);
    const b = await n.cpuPagina(p); const s = (Date.now() - t0) / 1000;
    return { cpuHiloPrincipal: +((b.tarea - a.tarea) / s * 100).toFixed(1), scriptPct: +((b.script - a.script) / s * 100).toFixed(1), estiloPct: +((b.estilo - a.estilo) / s * 100).toFixed(1), anuncio: r.anuncio, avanza: r.avanza };
  }

  it('CPU reproduciendo: con el bloqueador frente a YouTube en la lista blanca', async () => {
    const con = await cpuReproduciendo(VIDEOS[2]);
    await n.evalua(app.ui, 'await window.cobalt.adblockWhitelist("add", "youtube.com"); return true;');
    const sin = await cpuReproduciendo(VIDEOS[2]);
    await n.evalua(app.ui, 'await window.cobalt.adblockWhitelist("remove", "youtube.com"); return true;');
    apunta('yt-cpu', { conBloqueador: con, listaBlanca: sin });
    assert.ok(con.avanza >= 20, 'el video no avanzó con el bloqueador');
    // Margen amplio: la medida tiene ruido; lo que se busca es un disparo (el caso Ghostery).
    assert.ok(con.cpuHiloPrincipal <= Math.max(sin.cpuHiloPrincipal * 1.5, sin.cpuHiloPrincipal + 5), `CPU con bloqueador ${con.cpuHiloPrincipal} % frente a ${sin.cpuHiloPrincipal} %`);
  });

  it('lista blanca: con youtube.com permitido salen los anuncios y no se toca nada', async () => {
    await n.evalua(app.ui, 'await window.cobalt.adblockWhitelist("add", "youtube.com"); return true;');
    const antes = n.red(p).bloqueadas.length;
    await n.navega(p, 'https://www.youtube.com/watch?v=' + VIDEOS[0]);
    const r = await muestrea(p, 12);
    const h = await n.enPestana(p, 'return Function.prototype.toString.call(JSON.parse);');
    await n.captura(p, 'yt-lista-blanca');
    const bloqueadas = n.red(p).bloqueadas.slice(antes);
    await n.evalua(app.ui, 'await window.cobalt.adblockWhitelist("remove", "youtube.com"); return true;');
    apunta('yt-lista-blanca', { anuncio: r.anuncio, datosAnuncio: r.datosAnuncio, bloqueadas: bloqueadas.length, jsonParse: h });
    assert.equal(bloqueadas.length, 0, 'se bloquearon peticiones en un sitio permitido');
    assert.equal(h, 'function parse() { [native code] }', 'JSON.parse parcheado en un sitio permitido');
    assert.ok(r.datosAnuncio || r.anuncio, 'con la lista blanca YouTube debería mandar anuncios (control de la prueba)');
  });
});

/* ======================= Embeds de YouTube ======================= */
describe('YouTube incrustado en otra página', { timeout: 5 * 60 * 1000 }, () => {
  let app, srv, puerto;
  before(async () => {
    srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Embed</title><h1>Página de terceros</h1>
        <iframe width="640" height="360" src="https://www.youtube.com/embed/${EMBED}?autoplay=1&mute=1" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe>`);
    }).listen(0);
    await new Promise((r) => srv.once('listening', r));
    puerto = srv.address().port;
    app = await n.arranca('yt-embed');
    await n.esperaMotor(app);
  });
  after(async () => { await n.cierra(app); srv.close(); });

  it('el reproductor incrustado arranca y no muestra anuncio', async () => {
    // Con un nombre de host: desde una IP YouTube responde "Este video no está
    // disponible". *.localtest.me resuelve a 127.0.0.1 en el DNS público.
    const p = await n.abrePestana(app, `http://naviris-e2e.localtest.me:${puerto}/`);
    await n.espera(4000);
    const ms = await n.hasta(async () => (await n.marcos(p)).find((m) => /youtube\.com\/embed/.test(m.url)), { tope: 20000, que: 'el iframe de YouTube' });
    const muestras = [];
    for (let i = 0; i < 12; i++) {
      await n.espera(1000);
      muestras.push(await n.evalua(p.cdp, ESTADO_YT, ms.sesion).catch((e) => ({ error: e.message })));
    }
    await n.captura(p, 'yt-embed');
    const conT = muestras.filter((x) => typeof x.t === 'number');
    const r = { anuncio: muestras.some((x) => x.anuncio), avanza: conT.length > 1 ? conT[conT.length - 1].t - conT[0].t : 0, estados: muestras.map((x) => x.estado ?? x.error) };
    apunta('yt-embed', r);
    assert.equal(r.anuncio, false, 'anuncio en el embed');
    assert.ok(r.avanza >= 5, 'el embed no avanza');
  });
});

/* ======================= Fuera de YouTube ======================= */
describe('Bloqueo general y sitios grandes', { timeout: 10 * 60 * 1000 }, () => {
  let app;
  before(async () => { app = await n.arranca('web'); await n.esperaMotor(app); });
  after(() => n.cierra(app));

  // El test de d3ward (d3ward.github.io/toolz/adblock.html) está archivado
  // desde 2025; este es su sucesor, con las mismas pruebas y algunas más.
  it('adblock.turtlecute.org: dominios bloqueados y anuncios cosméticos', async () => {
    const p = await n.abrePestana(app, 'https://adblock.turtlecute.org/');
    await n.espera(25000);
    const r = await n.enPestana(p, `
      const m = document.body.innerText.match(/Total : (\\d+)\\s+(\\d+) blocked/) || [];
      const rojo = (t) => [...document.querySelectorAll('[class*="_bg-red"]')].some((e) => e.textContent.trim() === t);
      return { total: Number(m[1]), bloqueados: Number(m[2]), estatico: !rojo('Static Ad'), dinamico: !rojo('Dynamic Ad'), fallan: [...document.querySelectorAll('.test_block[class*="_bg-red"]')].map((e) => e.textContent.trim()) };`);
    await n.captura(p, 'web-turtlecute');
    const red = n.red(p);
    apunta('web-turtlecute', { ...r, sustituidas: red.sustituidas.length });
    // ads.js y pagead.js salen en rojo a propósito: las listas los sirven con
    // un sustituto ($redirect), que es justo para que la web no note el bloqueo.
    assert.ok(r.estatico, 'el anuncio estático (ocultado genérico) se ve');
    assert.ok(r.dinamico, 'el anuncio dinámico (ocultado genérico) se ve');
    assert.ok(r.bloqueados >= 0.6 * r.total, `bloqueo bajo: ${r.bloqueados}/${r.total}`);
  });

  it('adblock-tester.com: puntuación', async () => {
    const p = await n.abrePestana(app, 'https://adblock-tester.com/');
    await n.espera(30000);
    const r = await n.enPestana(p, `
      const t = document.body.innerText;
      const m = t.match(/(\\d+)\\s*(?:points out of|puntos de)\\s*(\\d+)/i) || t.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
      return { puntos: m ? Number(m[1]) : null, de: m ? Number(m[2]) : null, fallos: [...document.querySelectorAll('.test-failed, .failed, [class*=fail]')].map((e) => e.textContent.trim().slice(0, 60)).slice(0, 20) };`);
    await n.captura(p, 'web-adblock-tester');
    apunta('web-adblock-tester', { ...r, bloqueadas: n.red(p).bloqueadas.length });
    assert.ok(r.puntos !== null, 'no se pudo leer la puntuación');
    assert.ok(r.puntos >= 0.85 * r.de, `puntuación baja: ${r.puntos}/${r.de}`);
  });

  const SITIOS = [
    ['google-login', 'https://accounts.google.com/ServiceLogin', '#identifierId'],
    ['twitch', 'https://www.twitch.tv/', 'a[href^="/"], [data-a-target]'],
    ['x', 'https://x.com/', 'input[name="username_or_email"], [data-testid="loginButton"], a[href="/login"]'],
    ['crunchyroll', 'https://www.crunchyroll.com/', 'header, [class*="erc-"], main']
  ];
  for (const [nombre, url, sel] of SITIOS) {
    it('no se rompe: ' + nombre, async () => {
      const p = await n.abrePestana(app, url);
      const errores = [];
      p.cdp.on((d) => { if (d.method === 'Runtime.exceptionThrown') errores.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 120)); });
      let ok = false;
      try { ok = await n.hasta(() => n.enPestana(p, `return !!document.querySelector(${JSON.stringify(sel)}) && document.readyState !== 'loading';`), { tope: 30000, que: 'el contenido de ' + nombre }); } catch { ok = false; }
      await n.espera(5000);
      const info = await n.enPestana(p, 'return { url: location.href, titulo: document.title, texto: document.body ? document.body.innerText.length : 0 };').catch(() => ({}));
      await n.captura(p, 'web-' + nombre);
      const r = n.red(p);
      apunta('web-' + nombre, { contenido: ok, ...info, bloqueadas: r.bloqueadas.length, ejemplosBloqueadas: r.bloqueadas.slice(0, 8).map((u) => u.slice(0, 100)), excepcionesJS: errores.length });
      await n.cierraPestana(app, p);
      assert.ok(ok, nombre + ' no muestra su contenido');
      assert.ok(info.texto > 50, nombre + ' en blanco');
      if (nombre === 'google-login') assert.equal(r.bloqueadas.length, 0, 'se bloqueó algo en el login de Google');
    });
  }
});

/* ============ Lista blanca con service workers, y ventanas emergentes ============ */
describe('Service workers y ventanas emergentes', { timeout: 6 * 60 * 1000 }, () => {
  // Script de rastreo que las listas bloquean sin sustituto (comprobado con el motor).
  const BLOQUEADA = 'https://cdn.taboola.com/libtrc/x/loader.js';
  let app, srv, base;
  before(async () => {
    srv = http.createServer((req, res) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(`self.addEventListener('install', () => self.skipWaiting());
          self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
          self.addEventListener('fetch', (e) => {
            const u = new URL(e.request.url);
            if (!u.pathname.startsWith('/prueba')) return;
            const op = { mode: 'no-cors', referrerPolicy: u.pathname === '/prueba-sinref' ? 'no-referrer' : 'strict-origin-when-cross-origin' };
            e.respondWith(fetch(${JSON.stringify(BLOQUEADA)}, op).then(() => new Response('pasa'), () => new Response('bloqueada')));
          });`);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (req.url.startsWith('/emergentes')) {
        res.end(`<!doctype html><title>Emergentes</title><button id="b" style="width:300px;height:120px">Clic</button><script>
          window.open(${JSON.stringify(BLOQUEADA)});
          window.open('https://example.com/', '_blank', 'width=400,height=300');
          document.getElementById('b').onclick = () => window.open('https://example.org/', '_blank', 'width=400,height=300');
        </script>`);
        return;
      }
      res.end('<!doctype html><title>SW</title><script>navigator.serviceWorker.register("/sw.js")</script>');
    }).listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    base = 'http://127.0.0.1:' + srv.address().port;
    app = await n.arranca('sw-emergentes');
    await n.esperaMotor(app);
  });
  after(async () => { await n.cierra(app); srv.close(); });

  async function pruebaSW(p) {
    await n.hasta(() => n.enPestana(p, 'return !!navigator.serviceWorker.controller;'), { tope: 15000, que: 'el service worker' }).catch(async () => {
      await n.navega(p, base + '/');
      await n.hasta(() => n.enPestana(p, 'return !!navigator.serviceWorker.controller;'), { tope: 15000, que: 'el service worker' });
    });
    return n.enPestana(p, `
      const t = async (u) => (await fetch(u)).text();
      let pagina; try { await fetch(${JSON.stringify(BLOQUEADA)}, { mode: 'no-cors' }); pagina = 'pasa'; } catch (e) { pagina = 'bloqueada'; }
      return { pagina, sw: await t('/prueba'), swSinReferrer: await t('/prueba-sinref') };`);
  }

  it('la lista blanca vale también para lo que pide el service worker del sitio', async () => {
    const p = await n.abrePestana(app, base + '/');
    const sinBlanca = await pruebaSW(p);
    await n.evalua(app.ui, 'await window.cobalt.adblockWhitelist("add", "127.0.0.1"); return true;');
    const conBlanca = await pruebaSW(p);
    await n.evalua(app.ui, 'await window.cobalt.adblockWhitelist("remove", "127.0.0.1"); return true;');
    await n.cierraPestana(app, p);
    apunta('sw-lista-blanca', { sinBlanca, conBlanca });
    // swSinReferrer no se comprueba, ni con lista blanca ni sin ella: sin pestaña
    // ni referrer, main no sabe de qué sitio es la petición. No se le aplica la
    // lista blanca y el motor la evalúa como de primera parte, así que pasa o se
    // bloquea según la regla sea $third-party o no (con la lista de Peter Lowe,
    // la de taboola ya no lo es). Ver INFORME de «adblock».
    assert.equal(sinBlanca.pagina, 'bloqueada');
    assert.equal(sinBlanca.sw, 'bloqueada', 'lo que pide el service worker se debe bloquear');
    assert.deepEqual({ pagina: conBlanca.pagina, sw: conBlanca.sw }, { pagina: 'pasa', sw: 'pasa' }, 'con el sitio permitido no se debe bloquear nada');
  });

  // Pendiente de decisión (ver INFORME): el <webview> lleva allowpopups y
  // Electron no tiene bloqueador de ventanas emergentes por gesto, así que
  // window.open sin clic abre pestaña. Se mide igual para ver el antes y después.
  it('ventanas emergentes: sin gesto no se abre ninguna', { todo: 'falta decidir cómo bloquear window.open sin gesto' }, async () => {
    const pestanas = () => n.evalua(app.ui, 'return tabs.length;');
    const ventanas = async () => (await (await fetch(`http://127.0.0.1:${n.PUERTO}/json/list`)).json()).filter((t) => t.type === 'page' || t.type === 'webview').length;
    const t0 = await pestanas(), v0 = await ventanas();
    const p = await n.abrePestana(app, base + '/emergentes');
    await n.espera(4000);
    const sinGesto = { pestanas: (await pestanas()) - t0 - 1, marcos: (await ventanas()) - v0 - 1 };
    await n.clic(p, '#b');
    await n.espera(3000);
    const conGesto = { pestanas: (await pestanas()) - t0 - 1, marcos: (await ventanas()) - v0 - 1 };
    await n.captura(p, 'emergentes');
    apunta('ventanas-emergentes', { sinGesto, conGesto });
    assert.equal(sinGesto.pestanas + sinGesto.marcos, 0, 'se abrieron ventanas sin que la persona hiciera clic');
  });
});

/* ============ «Permitir anuncios en este sitio» (botón del escudo) ============ */
describe('Permitir anuncios en un sitio', { timeout: 4 * 60 * 1000 }, () => {
  // Bloqueada sin sustituto por las listas (comprobado con el motor), como arriba.
  const BLOQUEADA = 'https://cdn.taboola.com/libtrc/x/loader.js';
  const HOST = 'lista-blanca.localtest.me';
  let app, srv, url;
  before(async () => {
    srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const pide = `fetch(${JSON.stringify(BLOQUEADA)}, { mode: 'no-cors' }).then(() => 'pasa', () => 'bloqueada')`;
      // El iframe es de otro sitio (lvh.me, que también resuelve a 127.0.0.1; a
      // 127.0.0.1 a secas las listas no dejan cargarlo desde otro sitio): cuenta
      // lo que le pasa a su petición con postMessage.
      if (req.url === '/marco') { res.end(`<!doctype html><script>${pide}.then((r) => parent.postMessage({ marco: r }, '*'));</script>`); return; }
      // Un anuncio para el ocultado genérico por clase (.banner-ads, preload) y
      // otro para el CSS de las listas que pone main en dom-ready ([data-ad-placeholder]).
      res.end(`<!doctype html><title>Lista blanca</title>
        <div class="banner-ads" id="generico" style="height:60px">anuncio</div>
        <div data-ad-placeholder id="cosmetico" style="height:60px">anuncio</div>
        <script>addEventListener('message', (e) => { window.marco = e.data.marco; }); ${pide}.then((r) => { window.red = r; });</script>
        <iframe src="http://naviris-marco.lvh.me:${srv.address().port}/marco"></iframe>`);
    }).listen(0);
    await new Promise((r) => srv.once('listening', r));
    url = `http://${HOST}:${srv.address().port}/`;
    app = await n.arranca('lista-blanca');
    await n.esperaMotor(app);
  });
  after(async () => { await n.cierra(app); srv.close(); });

  const estado = (p) => n.hasta(() => n.enPestana(p, `return window.red && window.marco && document.readyState === 'complete'
    && { red: window.red, marco: window.marco, generico: document.getElementById('generico').offsetHeight, cosmetico: document.getElementById('cosmetico').offsetHeight };`), { tope: 20000, que: 'la página de prueba' });
  // El botón de verdad: abre el panel del escudo y pulsa «Permitir anuncios en…»
  // o «Volver a bloquear en…», que guarda el sitio y recarga la pestaña.
  async function pulsaBoton(p, empieza) {
    const docs = n.documentos(p).length;
    const texto = await n.hasta(() => n.evalua(app.ui, `if (els.shieldPop.classList.contains('hidden')) els.navShield.click();
      const b = els.adblockSite; return !b.classList.contains('hidden') && b.textContent.startsWith(${JSON.stringify(empieza)}) && b.textContent;`), { tope: 10000, que: 'el botón ' + empieza });
    await n.evalua(app.ui, 'els.adblockSite.click(); return true;');
    await n.hasta(() => n.documentos(p).length > docs, { tope: 15000, que: 'la recarga' });
    await n.evalua(app.ui, 'if (!els.shieldPop.classList.contains("hidden")) els.navShield.click(); return true;');
    return texto;
  }

  it('el botón apaga red, cosméticos e iframes en ese sitio, recarga y se puede deshacer', async () => {
    const p = await n.abrePestana(app, url);
    const bloqueando = await estado(p);
    const permitir = await pulsaBoton(p, 'Permitir anuncios en');
    const bloqueadasAntes = n.red(p).bloqueadas.length;
    const permitido = await estado(p);
    const bloqueadasPermitido = n.red(p).bloqueadas.length - bloqueadasAntes;
    const lista = await n.evalua(app.ui, 'return (await window.cobalt.adblockGet()).whitelist;');
    const volver = await pulsaBoton(p, 'Volver a bloquear en');
    const otraVez = await estado(p);
    const listaFinal = await n.evalua(app.ui, 'return (await window.cobalt.adblockGet()).whitelist;');
    await n.captura(p, 'lista-blanca');
    await n.cierraPestana(app, p);
    apunta('lista-blanca-boton', { bloqueando, permitir, permitido, bloqueadasPermitido, lista, volver, otraVez, listaFinal });
    assert.deepEqual(bloqueando, { red: 'bloqueada', marco: 'bloqueada', generico: 0, cosmetico: 0 }, 'sin permitir, el bloqueador actúa');
    assert.equal(permitir, 'Permitir anuncios en ' + HOST);
    assert.deepEqual(lista, [HOST]);
    assert.deepEqual(permitido, { red: 'pasa', marco: 'pasa', generico: 60, cosmetico: 60 }, 'con el sitio permitido no se toca nada, tampoco en su iframe');
    assert.equal(bloqueadasPermitido, 0, 'peticiones bloqueadas en un sitio permitido');
    assert.equal(volver, 'Volver a bloquear en ' + HOST);
    assert.deepEqual(otraVez, bloqueando, 'al volver a bloquear, todo como al principio');
    assert.deepEqual(listaFinal, []);
  });
});

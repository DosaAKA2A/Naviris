/* Naviris addon: Strainer v1.1.1 (kind: tool)

   Un colador de enlaces. Las pasarelas de los acortadores (cuenta atras,
   "continuar" y anuncios entre el enlace de descarga y el archivo) llevan el
   destino consigo casi siempre: Strainer lo saca y se queda solo con el enlace
   final.

   Dos formas de usarlo, las dos desde el mismo boton del sidebar:

   - PANEL (clic en el boton): pegas un enlace, pulsas Colar y te devuelve el
     enlace final, con la cadena de saltos que hizo para llegar. Lo resuelve por
     detras, en una pagina que no llegas a ver, asi que sus anuncios tampoco.
   - AL NAVEGAR (interruptor del panel): si caes en una pasarela conocida
     mientras navegas, la pestana salta sola al destino. Alt+S lo fuerza en la
     pagina que estes viendo aunque el sitio no tenga regla.

   Como saca el destino, en este orden:
   1. De la propia URL, sin cargar nada: parametro tal cual, escapado o en
      base64 (hasta doble). Al navegar esto ocurre en will-navigate, o sea que
      la pasarela no recibe ni la visita.
   2. De la pagina cargada: el enlace al alojamiento final (Drive, Mega,
      MediaFire, pixeldrain, gofile...), con reintentos, porque muchas
      pasarelas lo escriben tarde con JavaScript.
   3. En modo profundo (Alt+S y panel), ademas: meta refresh, cualquier enlace
      externo con camino propio y las URLs dentro de los scripts.

   Las reglas por dominio NO viven aqui: estan en naviris.site/addons/strainer.json
   y se releen en cada arranque, asi que anadir un sitio no obliga a publicar
   version del addon (ni del navegador). Aqui solo queda la copia de respaldo.

   Cuidados: no salta dos veces desde la misma URL (60 s), no encadena mas de 6
   saltos en 30 s, no toca paginas de cuentas ajenas (Google, PayPal...) y el
   destino tiene que ser http/https y distinto de donde estamos.

   Requiere Naviris 2.7.6-dev.4 (naviris.leePagina, abrePestana y onAtajo). En
   versiones anteriores el panel resuelve solo lo que se ve en la URL.
*/
(function () {
  var ID = 'strainer';
  // El realce del tema, NO un color propio: en el riel un ambar fijo cantaba
  // entre iconos que siguen el tema (y en el tema rosa mas todavia). Es el mismo
  // token con el que se encienden el hover del riel y el Spotify sonando. El
  // ambar queda solo de respaldo por si el addon corre en un Naviris antiguo.
  var COLOR = 'var(--realce, #f5a524)';
  var REGLAS_URL = 'https://naviris.site/addons/strainer.json';

  // Copia de respaldo de las reglas. La buena es la de naviris.site; esta solo
  // entra si esa no se puede pedir. Se deja corta a proposito: lo verificado.
  var REGLAS_BASE = [
    { host: 'sphinxanime.com', ruta: '^/short/', modo: 'parametro', params: ['anonym'] },
    { host: 'box.sphinxanime.net', modo: 'dom', selector: 'a[href^="http"]' }
  ];

  // Nombres de parametro que suelen llevar el destino. Al navegar solo se
  // prueban en sitios CON regla; a lo bruto en cualquier web se llevarian por
  // delante inicios de sesion y flujos de pago. En el panel y con Alt+S, donde
  // manda la persona, se prueban siempre.
  var PARAMS = ['url', 'u', 'r', 'to', 'link', 'links', 'target', 'redirect', 'redir',
    'dest', 'destination', 'go', 'goto', 'out', 'next', 'anonym', 'enlace', 'ir', 'd', 'q'];

  // Cuentas ajenas: aqui un ?redirect= es del propio inicio de sesion.
  var NUNCA = /(^|\.)(google\.com|accounts\.google\.com|microsoft\.com|live\.com|apple\.com|paypal\.com|github\.com|cloudflare\.com)$/i;

  // Alojamientos finales y ruido. Van como texto porque el extractor se manda a
  // la pagina con toString() y no puede ver nada de aqui fuera; asi la lista es
  // una sola y no se desincroniza.
  var HOSTS_FIN = 'drive\\.google\\.com|docs\\.google\\.com|mega\\.nz|mega\\.co\\.nz|mediafire\\.com|1fichier\\.com|pixeldrain\\.com|gofile\\.io|krakenfiles\\.com|workupload\\.com|buzzheavier\\.com|send\\.cm|sendcm\\.com|terabox\\.com|1024terabox\\.com|dropbox\\.com|uploadhaven\\.com|qiwi\\.gg|acefile\\.co|frdl\\.io|desiupload\\.co|hexload\\.com|dailyuploads\\.net|racaty\\.net|zippyshare\\.com|anonfiles\\.com|bowfile\\.com|fastupload\\.io|filerio\\.in|uptobox\\.com|nitroflare\\.com|rapidgator\\.net';
  var HOSTS_RUIDO = 'facebook\\.com|x\\.com|twitter\\.com|t\\.me|telegram\\.me|telegram\\.org|wa\\.me|whatsapp\\.com|instagram\\.com|discord\\.gg|discord\\.com|youtube\\.com|youtu\\.be|reddit\\.com|patreon\\.com|paypal\\.com|ko-fi\\.com|buymeacoffee\\.com|tiktok\\.com|pinterest\\.com|linkedin\\.com|google\\.com|gstatic\\.com|googleapis\\.com|doubleclick\\.net|w3\\.org|schema\\.org|jquery\\.com|bootstrapcdn\\.com|cloudflare\\.com|fontawesome\\.com';
  var RE_FIN = new RegExp('(^|\\.)(' + HOSTS_FIN + ')$', 'i');

  var activo = localStorage.__navStrainer !== '0';   // por defecto encendido
  var contador = parseInt(localStorage.__navStrainerCount || '0', 10) || 0;
  var reglas = REGLAS_BASE;

  /* ---------- reglas ---------- */

  function aplicaReglas(j) {
    if (!j || !j.reglas || !j.reglas.length) return false;
    reglas = j.reglas;
    return true;
  }
  function cargaReglas() {
    try { aplicaReglas(JSON.parse(localStorage.__navStrainerReglas || 'null')); } catch (e) { /* nada */ }
    try {
      fetch(REGLAS_URL, { cache: 'no-cache' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (aplicaReglas(j)) localStorage.__navStrainerReglas = JSON.stringify(j); })
        .catch(function () { /* sin red o sin permiso: respaldo */ });
    } catch (e) { /* nada */ }
  }

  function parse(u) { try { return new URL(u); } catch (e) { return null; } }
  function mismoHost(host, patron) {
    host = (host || '').toLowerCase(); patron = (patron || '').toLowerCase();
    return host === patron || host.slice(-(patron.length + 1)) === '.' + patron;
  }
  function reglaDe(url) {
    var u = parse(url);
    if (!u || !/^https?:$/.test(u.protocol)) return null;
    for (var i = 0; i < reglas.length; i++) {
      var r = reglas[i];
      if (!mismoHost(u.hostname, r.host)) continue;
      if (r.ruta) { try { if (!new RegExp(r.ruta).test(u.pathname)) continue; } catch (e) { /* regla mal escrita */ } }
      return r;
    }
    return null;
  }
  function esFinal(url) { var u = parse(url); return !!u && RE_FIN.test(u.hostname); }

  /* ---------- el destino escondido en la propia URL ---------- */

  function deBase64(s) {
    if (!/^[A-Za-z0-9+/=_-]{8,}$/.test(s)) return null;
    var t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var d;
    try { d = atob(t); } catch (e) { return null; }
    if (!/^[\x20-\x7e]+$/.test(d)) return null;   // salio binario: no era base64 de texto
    return d;
  }
  function esUrl(s) {
    s = (s || '').trim();
    return /^https?:\/\/[^\s/]+\.[^\s]/i.test(s) ? s : null;
  }
  // Un valor puede venir tal cual, escapado, en base64, o en base64 dos veces.
  function aUrl(v) {
    if (!v || v.length < 8) return null;
    var cand = [v], b;
    try { cand.push(decodeURIComponent(v)); } catch (e) { /* nada */ }
    b = deBase64(v);
    if (b) {
      cand.push(b);
      try { cand.push(decodeURIComponent(b)); } catch (e) { /* nada */ }
      var b2 = deBase64(b);
      if (b2) cand.push(b2);
    }
    for (var i = 0; i < cand.length; i++) { var d = esUrl(cand[i]); if (d) return d; }
    return null;
  }
  function destinoDeUrl(url, regla) {
    var u = parse(url);
    if (!u) return null;
    var nombres = (regla && regla.params && regla.params.length) ? regla.params : PARAMS;
    var vals = [], i, claves = [];
    u.searchParams.forEach(function (v, k) { claves.push([k.toLowerCase(), v]); });
    for (i = 0; i < claves.length; i++) if (nombres.indexOf(claves[i][0]) !== -1) vals.push(claves[i][1]);
    // El resto de parametros, el hash y el ultimo tramo de la ruta, por si el
    // destino viaja sin nombre reconocible (…/short/aHR0cHM6…).
    for (i = 0; i < claves.length; i++) if (nombres.indexOf(claves[i][0]) === -1) vals.push(claves[i][1]);
    if (u.hash.length > 1) vals.push(u.hash.slice(1));
    var tramo = u.pathname.split('/').filter(Boolean).pop();
    if (tramo) vals.push(tramo);
    for (i = 0; i < vals.length; i++) { var d = aUrl(vals[i]); if (d) return d; }
    return null;
  }

  /* ---------- el destino escondido en la pagina ---------- */

  // Corre DENTRO de la pagina (se manda como texto con toString, asi que no
  // puede usar nada de aqui fuera; las listas de dominios llegan por parametro).
  // Devuelve la URL final o cadena vacia.
  function agenteEnPagina(sel, profundo, clic, finTxt, ruidoTxt, origen) {
    var FIN = new RegExp('(^|\\.)(' + finTxt + ')$', 'i');
    var RUIDO = new RegExp('(^|\\.)(' + ruidoTxt + ')$', 'i');
    var aqui = location.hostname;

    function sirve(href, exigirFinal) {
      var u; try { u = new URL(href, location.href); } catch (e) { return null; }
      if (!/^https?:$/.test(u.protocol)) return null;
      if (u.hostname === aqui) return null;
      // Un alojamiento conocido NUNCA es ruido: drive.google.com y
      // docs.google.com caen dentro de google.com, que si esta en la lista de
      // ruido, y sin esta salida se descartaba justo el enlace que buscamos.
      var final = FIN.test(u.hostname);
      if (exigirFinal) return final ? u.href : null;
      if (!final && RUIDO.test(u.hostname)) return null;
      return u.href;
    }

    if (clic) {
      // Pasarelas de "pulsa para continuar": se pulsa y el siguiente intento
      // recoge el enlace ya revelado.
      try { var b = document.querySelector(clic); if (b) b.click(); } catch (e) { /* nada */ }
    }

    var i, u2, as = document.querySelectorAll('a[href]');

    // 1. Selector propio de la regla: manda sobre todo lo demas.
    if (sel) {
      try {
        var esp = document.querySelectorAll(sel);
        for (i = 0; i < esp.length; i++) { u2 = sirve(esp[i].getAttribute('href'), false); if (u2) return u2; }
      } catch (e) { /* selector mal escrito */ }
    }

    // 2. Enlace a un alojamiento de archivos conocido.
    for (i = 0; i < as.length; i++) { u2 = sirve(as[i].getAttribute('href'), true); if (u2) return u2; }

    // 3. Redireccion por meta refresh.
    var meta = document.querySelector('meta[http-equiv="refresh" i]');
    if (meta) {
      var m = /url\s*=\s*['"]?([^'";]+)/i.exec(meta.getAttribute('content') || '');
      if (m) { u2 = sirve(m[1], false); if (u2) return u2; }
    }

    // 4. URLs dentro de los scripts, pero solo a alojamientos conocidos y con
    //    camino propio: hay paginas con listas de dominios sueltos (app_domains
    //    y parecidas) que no son espejos de nada.
    var sc = document.querySelectorAll('script:not([src])');
    for (i = 0; i < sc.length; i++) {
      var urls = (sc[i].textContent || '').match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
      for (var j = 0; j < urls.length; j++) {
        var uu; try { uu = new URL(urls[j]); } catch (e) { continue; }
        if (uu.pathname.length < 2) continue;
        u2 = sirve(urls[j], true); if (u2) return u2;
      }
    }

    if (!profundo) return '';

    // 5. Solo en modo profundo: cualquier enlace externo con camino propio. El
    //    mas largo suele ser el bueno (los cortos son avisos legales, el sitio
    //    del acortador, redes sociales que ya estan filtradas).
    var mejor = '', largo = -1;
    for (i = 0; i < as.length; i++) {
      u2 = sirve(as[i].getAttribute('href'), false);
      if (!u2) continue;
      var p; try { p = new URL(u2).pathname; } catch (e) { continue; }
      if (p.length < 2) continue;
      if (p.length > largo) { largo = p.length; mejor = u2; }
    }
    if (mejor) return mejor;

    // 6. URLs de los scripts a cualquier sitio.
    for (i = 0; i < sc.length; i++) {
      var us = (sc[i].textContent || '').match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
      for (var k = 0; k < us.length; k++) {
        var u3; try { u3 = new URL(us[k]); } catch (e) { continue; }
        if (u3.pathname.length < 2) continue;
        u2 = sirve(us[k], false); if (u2) return u2;
      }
    }

    // 7. Y si la pasarela ya nos llevo sola a otro sitio, eso ES el resultado.
    if (origen && location.href !== origen && /^https?:/.test(location.href)) return location.href;
    return '';
  }

  function codigoAgente(sel, profundo, clic, origen) {
    return '(' + agenteEnPagina.toString() + ')(' +
      JSON.stringify(sel || '') + ',' + (!!profundo) + ',' + JSON.stringify(clic || '') + ',' +
      JSON.stringify(HOSTS_FIN) + ',' + JSON.stringify(HOSTS_RUIDO) + ',' + JSON.stringify(origen || '') + ')';
  }
  function pideDestino(wv, sel, profundo, clic) {
    try { return wv.executeJavaScript(codigoAgente(sel, profundo, clic, '')).catch(function () { return ''; }); }
    catch (e) { return Promise.resolve(''); }
  }

  /* ---------- el salto al navegar ---------- */

  var memoria = new WeakMap();   // webview -> { saltos: [ts], desde: {url: ts}, ultima }
  function mem(wv) {
    var m = memoria.get(wv);
    if (!m) { m = { saltos: [], desde: {}, ultima: null }; memoria.set(wv, m); }
    return m;
  }
  function puedeSaltar(wv, url) {
    var m = mem(wv), ahora = Date.now();
    if (m.desde[url] && ahora - m.desde[url] < 60000) return false;   // ya saltamos desde aqui: seria bucle
    m.saltos = m.saltos.filter(function (t) { return ahora - t < 30000; });
    return m.saltos.length < 6;                                        // cadena demasiado larga: algo va mal
  }
  function apunta(wv, url) {
    var m = mem(wv);
    m.desde[url] = Date.now();
    m.saltos.push(Date.now());
  }
  function suma() {
    contador++; localStorage.__navStrainerCount = String(contador); pinta();
  }

  function salta(wv, desde, destino, aviso) {
    if (!destino || destino === desde) return false;
    var d = parse(destino);
    if (!d || !/^https?:$/.test(d.protocol)) return false;
    if (!puedeSaltar(wv, desde)) return false;
    apunta(wv, desde);
    try { wv.stop(); } catch (e) { /* nada */ }
    try { wv.loadURL(destino); } catch (e) { return false; }
    suma();
    // Solo se avisa al llegar al final de la cadena: en un salto intermedio
    // (pasarela que lleva a otra pasarela) el aviso sobra y ensucia.
    if (aviso !== false && !reglaDe(destino)) naviris.toast('Pasarela colada: ' + d.hostname);
    return true;
  }

  // Intento por la pagina cargada, con reintentos: muchas pasarelas escriben el
  // enlace tarde, con JavaScript.
  function intentaDom(wv, url, regla, profundo, intento) {
    intento = intento || 0;
    var esperas = [0, 1200, 3000];
    if (intento >= esperas.length) return;
    setTimeout(function () {
      var actual = '';
      try { actual = wv.getURL(); } catch (e) { return; }
      if (actual !== url) return;                       // la pestana ya se fue a otro sitio
      if (!profundo && !activo) return;
      pideDestino(wv, regla && regla.selector, profundo, intento === 1 && regla && regla.clic ? regla.clic : '')
        .then(function (destino) {
          if (destino && salta(wv, url, destino)) return;
          intentaDom(wv, url, regla, profundo, intento + 1);
        });
    }, esperas[intento]);
  }

  // Unica puerta de entrada: se mira una URL una sola vez por pestana. Los
  // eventos de navegacion y el vigia pasan todos por aqui, asi que da igual
  // cual llegue primero (o si no llega ninguno).
  function revisa(wv, url) {
    if (!url) return;
    var m = mem(wv);
    if (m.ultima === url) return;
    m.ultima = url;
    alNavegar(wv, url);
  }

  function alNavegar(wv, url) {
    if (!activo || !url) return;
    var u = parse(url);
    if (!u || !/^https?:$/.test(u.protocol) || NUNCA.test(u.hostname)) return;
    var regla = reglaDe(url);
    if (!regla) return;
    if (regla.modo !== 'dom') {
      var destino = destinoDeUrl(url, regla);
      if (destino && salta(wv, url, destino)) return;   // ni se llega a pintar la pasarela
    }
    if (regla.modo !== 'parametro') intentaDom(wv, url, regla, false, 0);
  }

  /* ---------- enganche a las pestanas ---------- */

  var wvs = [], oyentes = new WeakMap();
  function armar(wv) {
    if (wvs.indexOf(wv) !== -1) return;
    wvs.push(wv);
    var o = {
      // will-navigate llega ANTES de que salga la peticion: cuando el destino
      // va en la URL, la pasarela no recibe ni una visita. load-commit y
      // did-navigate quedan de red de seguridad, porque will-navigate no cubre
      // las navegaciones que arranca la propia interfaz (barra, marcador).
      antes: function (e) { var u = e && e.url; if (u) setTimeout(function () { revisa(wv, u); }, 0); },
      commit: function (e) { if (e && e.isMainFrame === false) return; var u = (e && e.url) || null; setTimeout(function () { revisa(wv, u || wv.getURL()); }, 0); },
      nav: function (e) { revisa(wv, (e && e.url) || wv.getURL()); }
    };
    oyentes.set(wv, o);
    wv.addEventListener('will-navigate', o.antes);
    wv.addEventListener('load-commit', o.commit);
    wv.addEventListener('did-navigate', o.nav);
    try { revisa(wv, wv.getURL()); } catch (e) { /* nada */ }
  }
  function desarmar() {
    for (var i = 0; i < wvs.length; i++) {
      var wv = wvs[i], o = oyentes.get(wv);
      if (o) {
        try { wv.removeEventListener('will-navigate', o.antes); } catch (e) { /* nada */ }
        try { wv.removeEventListener('load-commit', o.commit); } catch (e) { /* nada */ }
        try { wv.removeEventListener('did-navigate', o.nav); } catch (e) { /* nada */ }
      }
      oyentes.delete(wv);
    }
    wvs = [];
  }
  function barre() {
    var lista = [];
    try { lista = naviris.allWebviews ? naviris.allWebviews() : []; } catch (e) { lista = []; }
    if (!lista.length) { var a = naviris.activeWebview(); if (a) lista = [a]; }
    for (var i = 0; i < lista.length; i++) armar(lista[i]);
    // Se repasa la URL de todas, no solo la de las recien enganchadas: una
    // pasarela CAIDA no dispara load-commit ni did-navigate (la pestana se
    // queda en "Cargando…" para siempre) y sin este repaso no se colaba nunca,
    // que es justo el caso en que mas falta hace. revisa() no repite trabajo:
    // solo actua cuando la URL de esa pestana cambia.
    for (var j = 0; j < wvs.length; j++) {
      try { revisa(wvs[j], wvs[j].getURL()); } catch (e) { /* pestana muriendo */ }
    }
  }

  /* ---------- colar un enlace a mano (panel) ---------- */

  // Resuelve un enlace SIN ensenarselo al usuario: el core abre una pagina
  // fuera de pantalla, corre el extractor dentro y la destruye.
  function porDetras(url) {
    if (!naviris.leePagina) return Promise.resolve(null);
    var r = reglaDe(url);
    return naviris.leePagina(url, codigoAgente(r && r.selector, true, r && r.clic, url), 14000)
      .then(function (d) { return typeof d === 'string' && d ? d : null; })
      .catch(function () { return null; });
  }

  function normaliza(txt) {
    txt = String(txt || '').trim().replace(/^[<"']+|[>"']+$/g, '');
    if (!txt) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(txt)) txt = 'https://' + txt;
    var u = parse(txt);
    return u && /^https?:$/.test(u.protocol) ? u.href : '';
  }

  // Devuelve la cadena de saltos: [{url, via}], el primero es lo que se pego.
  function cuela(entrada, avisa) {
    var cadena = [{ url: entrada, via: 'lo que pegaste' }];
    var vistos = {};
    function paso(actual, n) {
      vistos[actual] = 1;
      if (n >= 5 || esFinal(actual)) return Promise.resolve(cadena);
      var r = reglaDe(actual);
      // Sacarlo de la URL es gratis y no se inventa nada: el destino va escrito
      // ahi. Esto se sigue haciendo salte donde salte.
      var d = destinoDeUrl(actual, r);
      if (d && !vistos[d]) {
        cadena.push({ url: d, via: 'la URL' });
        return paso(d, n + 1);
      }
      // Abrir la pagina, en cambio, solo se hace con el enlace que pego la
      // persona (ella dice que es una pasarela) o con una pasarela CONOCIDA. Si
      // no, se acaba resolviendo paginas normales: probado, example.com llevaba
      // a iana.org y de ahi a icann.org, tres saltos mas alla del enlace bueno.
      if (n > 0 && !r) return Promise.resolve(cadena);
      avisa('Abriendo la pasarela por detrás…');
      return porDetras(actual).then(function (d2) {
        if (!d2 || vistos[d2] || d2 === actual) return cadena;
        cadena.push({ url: d2, via: 'la página' });
        return paso(d2, n + 1);
      });
    }
    return paso(entrada, 0);
  }

  /* ---------- Alt+S: colar la pagina que se esta viendo ---------- */

  function saltoAMano() {
    var wv = null;
    try { wv = naviris.activeWebview(); } catch (e) { /* nada */ }
    if (!wv) { naviris.toast('No hay ninguna página abierta que colar'); return; }
    var url = '';
    try { url = wv.getURL(); } catch (e) { /* nada */ }
    var u = parse(url);
    if (!u || !/^https?:$/.test(u.protocol)) { naviris.toast('Esta pestaña no es una página web'); return; }
    var destino = destinoDeUrl(url, null);   // a mano se prueban los parametros siempre
    if (destino && salta(wv, url, destino)) return;
    naviris.toast('Strainer: buscando el enlace final…');
    var r = reglaDe(url);
    pideDestino(wv, r && r.selector, true, '').then(function (d) {
      if (d && salta(wv, url, d)) return;
      naviris.toast('No se encontró el enlace final en esta página');
    });
  }

  // Desde 2.7.6-dev.3 lo reparte el core (naviris.onAtajo), que es la unica
  // forma de que responda con el foco DENTRO de la pagina: las teclas de una
  // webview no llegan a esta interfaz. En versiones anteriores queda el
  // respaldo, que solo funciona con el foco en la interfaz.
  var atajoPropio = null;
  if (!(naviris.onAtajo && naviris.onAtajo('s', saltoAMano))) {
    atajoPropio = function (e) {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saltoAMano(); }
    };
    window.addEventListener('keydown', atajoPropio, true);
  }

  /* ---------- panel ---------- */

  var css = document.createElement('style');
  css.id = 'str-style';
  css.textContent = [
    '#str-panel{width:340px;max-height:640px}',
    '#str-panel .lp-body{padding:12px 16px 18px}',
    '.str-lbl{margin:14px 2px 7px;font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--dim,#5c5e64)}',
    '.str-lbl:first-child{margin-top:2px}',
    '.str-in{width:100%;box-sizing:border-box;border:1px solid var(--line,#232327);background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;font-size:12.5px;font-family:var(--mono,ui-monospace,monospace);color:var(--text,#ececef);resize:none;height:78px;outline:none}',
    '.str-in:focus{border-color:' + COLOR + '}',
    // Un enlace largo hace aparecer scroll en el cuadro, y ahi salia la barra
    // del sistema con sus flechitas. En Naviris ningun scroll usa la del
    // sistema: misma barra fina que el resto de la app.
    '.str-in::-webkit-scrollbar{width:11px;height:11px}',
    '.str-in::-webkit-scrollbar-track,.str-in::-webkit-scrollbar-corner{background:transparent}',
    '.str-in::-webkit-scrollbar-thumb{background:rgba(128,128,132,.42);border:3px solid transparent;border-radius:999px;background-clip:content-box}',
    '.str-in::-webkit-scrollbar-thumb:hover{background:rgba(128,128,132,.62);background-clip:content-box}',
    '.str-in::-webkit-scrollbar-button{display:none;width:0;height:0}',
    '.str-row{display:flex;gap:8px;margin-top:10px}',
    '.str-btn{flex:1;border:none;border-radius:10px;padding:11px 14px;font-size:12.5px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.08);color:var(--text,#ececef);transition:background .12s}',
    '.str-btn:hover{background:rgba(255,255,255,.15)}',
    '.str-btn:disabled{opacity:.5;cursor:default}',
    // El texto sobre el realce lo decide el tema: en lima va casi negro y en
    // rosa blanco, asi que un marron fijo se volvia ilegible en uno de los dos.
    '.str-btn.pri{background:' + COLOR + ';color:var(--accent-fg,#1b1200)}',
    '.str-btn.pri:hover{filter:brightness(1.08)}',
    '.str-est{font-size:12px;color:var(--muted,#8b8d94);margin-top:10px;min-height:16px}',
    '.str-est.mal{color:#ff6b6b}',
    '.str-fin{border:1px solid ' + COLOR + ';border-radius:11px;padding:10px 12px;margin-top:10px;background:color-mix(in srgb, var(--realce, #f5a524) 8%, transparent)}',
    '.str-fin .h{font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:' + COLOR + ';margin-bottom:6px}',
    '.str-fin .u{font-family:var(--mono,ui-monospace,monospace);font-size:12px;color:var(--text,#ececef);word-break:break-all;line-height:1.5}',
    '.str-salto{display:flex;gap:8px;font-size:11.5px;padding:5px 0;border-top:1px solid var(--line,#232327)}',
    '.str-salto:first-child{border-top:none}',
    '.str-salto .n{color:var(--dim,#5c5e64);flex:none;font-family:var(--mono,ui-monospace,monospace)}',
    '.str-salto .h{color:var(--text,#ececef);word-break:break-all}',
    '.str-salto .v{color:var(--dim,#5c5e64);flex:none}',
    '.str-sw{display:flex;align-items:center;gap:10px;justify-content:space-between;border:1px solid var(--line,#232327);border-radius:11px;padding:10px 12px;margin-top:4px;cursor:pointer}',
    '.str-sw .t{font-size:12.5px;color:var(--text,#ececef)}',
    '.str-sw .s{font-size:11.5px;color:var(--muted,#8b8d94);margin-top:2px;line-height:1.45}',
    '.str-led{width:34px;height:19px;border-radius:999px;background:rgba(255,255,255,.14);position:relative;flex:none;transition:background .15s}',
    '.str-led i{position:absolute;top:2.5px;left:2.5px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}',
    '.str-sw.on .str-led{background:' + COLOR + '}',
    '.str-sw.on .str-led i{left:17.5px}',
    '.str-pie{font-size:11.5px;color:var(--dim,#5c5e64);margin-top:14px;line-height:1.55}'
  ].join('\n');
  document.head.appendChild(css);

  var ICO_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg>';
  var ICO_CAPAS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>';

  var panel = document.createElement('aside');
  panel.id = 'str-panel';
  panel.className = 'side-panel-left hidden';
  panel.innerHTML =
    '<div class="lp-head"><span class="lp-title"><span id="str-ico"></span> Strainer</span>' +
    '<button id="str-close" class="lp-x" title="Cerrar"></button></div>' +
    '<div class="lp-body">' +
    '<div class="str-lbl">Enlace que quieres colar</div>' +
    '<textarea id="str-in" class="str-in" spellcheck="false" placeholder="Pega aquí el enlace del acortador"></textarea>' +
    '<div class="str-row"><button id="str-go" class="str-btn pri">Colar</button>' +
    '<button id="str-clear" class="str-btn">Limpiar</button></div>' +
    '<div id="str-est" class="str-est"></div>' +
    '<div id="str-res"></div>' +
    '<div class="str-lbl">Al navegar</div>' +
    '<div id="str-sw" class="str-sw"><div><div class="t">Colar solo las pasarelas</div>' +
    '<div class="s">Si caes en una pasarela conocida, la pestaña salta sola al enlace final.</div></div>' +
    '<div class="str-led"><i></i></div></div>' +
    '<div class="str-pie">Alt+S cuela la página que estés viendo, aunque el sitio no tenga regla.</div>' +
    '</div>';
  document.body.appendChild(panel);
  panel.querySelector('#str-ico').innerHTML = ICO_CAPAS;
  panel.querySelector('#str-ico').style.cssText = 'display:inline-flex;width:15px;height:15px;color:' + COLOR;
  panel.querySelector('#str-close').innerHTML = ICO_X;
  panel.querySelector('#str-close').addEventListener('click', function () { panel.classList.add('hidden'); });

  var elIn = panel.querySelector('#str-in');
  var elGo = panel.querySelector('#str-go');
  var elEst = panel.querySelector('#str-est');
  var elRes = panel.querySelector('#str-res');
  var elSw = panel.querySelector('#str-sw');

  var escapadas = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return escapadas[c]; }); }
  function estado(txt, mal) { elEst.textContent = txt || ''; elEst.className = 'str-est' + (mal ? ' mal' : ''); }

  function pintaSwitch() {
    elSw.classList.toggle('on', activo);
  }
  elSw.addEventListener('click', function () {
    activo = !activo;
    localStorage.__navStrainer = activo ? '1' : '0';
    if (activo) barre();
    pintaSwitch(); pinta();
  });

  function copia(txt) {
    try {
      navigator.clipboard.writeText(txt).then(function () { naviris.toast('Enlace copiado'); },
        function () { naviris.toast('No se pudo copiar'); });
    } catch (e) { naviris.toast('No se pudo copiar'); }
  }

  function pintaResultado(cadena) {
    var fin = cadena[cadena.length - 1];
    if (cadena.length < 2) {
      elRes.innerHTML = '';
      estado(esFinal(fin.url)
        ? 'Ese enlace ya es el final: no hay pasarela que colar.'
        : 'No se encontró ningún enlace detrás de ese. Puede que la pasarela pida pulsar algo.', true);
      return;
    }
    var saltos = '';
    for (var i = 1; i < cadena.length; i++) {
      var h = parse(cadena[i].url);
      saltos += '<div class="str-salto"><span class="n">' + i + '</span>' +
        '<span class="h">' + esc(h ? h.hostname : cadena[i].url) + '</span>' +
        '<span class="v">por ' + esc(cadena[i].via) + '</span></div>';
    }
    elRes.innerHTML =
      '<div class="str-fin"><div class="h">Enlace final</div><div class="u">' + esc(fin.url) + '</div></div>' +
      '<div class="str-row"><button id="str-copy" class="str-btn">Copiar</button>' +
      '<button id="str-open" class="str-btn">Abrir</button></div>' +
      '<div class="str-lbl">Saltos</div>' + saltos;
    elRes.querySelector('#str-copy').addEventListener('click', function () { copia(fin.url); });
    elRes.querySelector('#str-open').addEventListener('click', function () {
      if (naviris.abrePestana) naviris.abrePestana(fin.url, true);
      else naviris.toast('Actualiza Naviris para abrirlo desde aquí');
    });
    estado(cadena.length - 1 === 1 ? 'Un salto.' : (cadena.length - 1) + ' saltos.');
  }

  var colando = false;
  function colar() {
    if (colando) return;
    var url = normaliza(elIn.value);
    if (!url) { elRes.innerHTML = ''; estado('Eso no parece un enlace.', true); return; }
    colando = true; elGo.disabled = true; elRes.innerHTML = '';
    estado('Colando…');
    cuela(url, function (t) { estado(t); }).then(function (cadena) {
      colando = false; elGo.disabled = false;
      if (cadena.length > 1) suma();
      pintaResultado(cadena);
    }, function () {
      colando = false; elGo.disabled = false;
      estado('No se pudo resolver ese enlace.', true);
    });
  }
  elGo.addEventListener('click', colar);
  elIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); colar(); }
  });
  panel.querySelector('#str-clear').addEventListener('click', function () {
    elIn.value = ''; elRes.innerHTML = ''; estado(''); elIn.focus();
  });

  function abrePanel() {
    var oculto = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (!oculto) return;
    pintaSwitch();
    // Si lo que hay copiado es un enlace, se ofrece ya escrito: es lo que
    // acabas de copiar de la pagina de descarga nueve de cada diez veces.
    try {
      navigator.clipboard.readText().then(function (t) {
        var u = normaliza(t);
        if (u && !elIn.value) { elIn.value = u; }
        elIn.focus();
      }, function () { elIn.focus(); });
    } catch (e) { elIn.focus(); }
  }

  /* ---------- boton ---------- */

  function pinta(btn) {
    btn = btn || document.getElementById('adt-' + ID);
    if (!btn) return;
    btn.style.color = activo ? COLOR : '';
    // El halo va en currentColor para que siga al realce del tema; con el ambar
    // escrito a mano se quedaba naranja aunque el icono ya no lo fuera.
    btn.style.filter = activo ? 'drop-shadow(0 0 5px currentColor)' : '';
    btn.title = 'Strainer: cuela un enlace y quédate con el final (' + contador + ' colados)' +
      (activo ? ' · las pasarelas se saltan solas al navegar' : ' · el salto automático está en pausa');
  }

  naviris.registerTool({
    id: ID,
    label: 'Strainer: cuela un enlace de acortador y quédate con el final',
    icon: 'layers',
    onClick: function (btn) { abrePanel(); pinta(btn); },
    onUnload: function () {
      try { clearInterval(timer); } catch (e) { /* nada */ }
      try { if (naviris.offAtajo) naviris.offAtajo('s'); } catch (e) { /* nada */ }
      try { if (atajoPropio) window.removeEventListener('keydown', atajoPropio, true); } catch (e) { /* nada */ }
      try { panel.remove(); css.remove(); } catch (e) { /* nada */ }
      desarmar();
    }
  });
  pinta();
  pintaSwitch();
  cargaReglas();

  // Banco de pruebas: desde la consola de la interfaz se puede comprobar que
  // una URL se resuelve bien sin tener que visitar la pasarela.
  //   __strainer.destinoDeUrl('https://sitio/x?u=aHR0cHM6…')
  //   __strainer.cuela('https://sitio/x', console.log).then(console.log)
  window.__strainer = {
    destinoDeUrl: destinoDeUrl,
    reglaDe: reglaDe,
    esFinal: esFinal,
    agenteEnPagina: agenteEnPagina,
    // Las listas van aparte porque el extractor las recibe por parametro (se
    // manda a la pagina como texto y no ve nada de aqui fuera).
    hosts: { fin: HOSTS_FIN, ruido: HOSTS_RUIDO },
    cuela: cuela,
    reglas: function () { return reglas; }
  };

  // Vigia: engancha las pestanas nuevas y se auto-limpia si quitan el addon
  // (su boton ya no esta en el DOM).
  var timer = setInterval(function () {
    if (!document.getElementById('adt-' + ID)) { clearInterval(timer); desarmar(); try { panel.remove(); css.remove(); } catch (e) { /* nada */ } return; }
    barre();
  }, 1500);
  barre();
})();

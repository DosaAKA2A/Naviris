/* Naviris addon: Salta pasarelas v1.0.0 (kind: tool)

   Las pasarelas de acortadores (esas paginas con cuenta atras, "continuar" y
   anuncios que se cruzan entre el enlace de descarga y el archivo real) llevan
   el destino consigo casi siempre. Este addon lo saca y lleva la pestana
   directamente al enlace final, sin pasar por la pasarela.

   Como lo resuelve, en este orden:

   1. Por la URL, sin cargar nada. Muchisimas pasarelas viajan con el destino en
      un parametro (?url=, ?u=, ?r=, ?anonym=...), tal cual o en base64. Si esta
      ahi, Naviris corta la carga y salta antes de que la pagina llegue a pintar
      un solo anuncio. Es el caso de sphinxanime.com/short/.
   2. Por la pagina ya cargada. Si el destino no va en la URL, se busca en el
      documento el enlace al alojamiento final (Drive, Mega, MediaFire,
      pixeldrain, gofile...) y se salta a el. Se reintenta a 1,2 s y a 3 s
      porque muchas pasarelas escriben ese enlace tarde, con JavaScript.
   3. A mano, con Alt+S. Fuerza el intento en la pestana activa aunque el sitio
      no tenga regla, y ahi si se mira todo: parametros, meta refresh, enlaces
      del documento y URLs dentro de los scripts. Es la salida para una pasarela
      nueva que todavia no esta en la lista.

   Las reglas por dominio NO viven aqui: estan en naviris.site/addons/pasarelas.json
   y se releen en cada arranque, asi que anadir un sitio no obliga a publicar
   version nueva del addon (ni del navegador). Lo de dentro de este archivo es
   solo la copia de respaldo, por si no hay red o la version de Naviris todavia
   no permite pedir ese archivo (hace falta 2.7.6-dev.3 o superior; en versiones
   anteriores el addon funciona igual, con la copia de respaldo).

   Cuidados que lleva puestos:
   - Nunca salta dos veces desde la misma URL (60 s de memoria) ni encadena mas
     de 6 saltos en 30 s: una pasarela que devuelve a la anterior haria un bucle.
   - Nunca toca paginas de inicio de sesion (Google, Microsoft, Apple...): ahi
     los ?redirect= son del propio flujo de la cuenta, no una pasarela.
   - El destino tiene que ser http/https y distinto de donde estamos.
*/
(function () {
  var ID = 'salta-pasarelas';
  var AMBAR = '#f5a524';                 // encendido = se ve de un vistazo que esta trabajando
  var REGLAS_URL = 'https://naviris.site/addons/pasarelas.json';

  // Copia de respaldo de las reglas. La buena es la de naviris.site; esta solo
  // entra si esa no se puede pedir. Se deja corta a proposito: lo verificado.
  var REGLAS_BASE = [
    { host: 'sphinxanime.com', ruta: '^/short/', modo: 'parametro', params: ['anonym'] },
    { host: 'box.sphinxanime.net', modo: 'dom', selector: 'a[href^="http"]' }
  ];

  // Nombres de parametro que suelen llevar el destino. Solo se prueban en
  // sitios CON regla (o en el salto a mano); a lo bruto en cualquier web se
  // llevaria por delante inicios de sesion y flujos de pago.
  var PARAMS = ['url', 'u', 'r', 'to', 'link', 'links', 'target', 'redirect', 'redir',
    'dest', 'destination', 'go', 'goto', 'out', 'next', 'anonym', 'enlace', 'ir', 'd', 'q'];

  // Cuentas ajenas: aqui un ?redirect= es del propio inicio de sesion.
  var NUNCA = /(^|\.)(google\.com|accounts\.google\.com|microsoft\.com|live\.com|apple\.com|paypal\.com|github\.com|cloudflare\.com)$/i;

  var activo = localStorage.__navPasarelas !== '0';   // por defecto encendido: se instala para usarlo
  var contador = parseInt(localStorage.__navPasarelasCount || '0', 10) || 0;
  var reglas = REGLAS_BASE;

  /* ---------- reglas ---------- */

  function aplicaReglas(j) {
    if (!j || !j.reglas || !j.reglas.length) return false;
    reglas = j.reglas;
    return true;
  }
  function cargaReglas() {
    try { aplicaReglas(JSON.parse(localStorage.__navPasarelasReglas || 'null')); } catch (e) { /* nada */ }
    // Si la version de Naviris no permite pedir naviris.site, esto falla y se
    // queda con lo que haya: es un adorno, no un requisito.
    try {
      fetch(REGLAS_URL, { cache: 'no-cache' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (aplicaReglas(j)) localStorage.__navPasarelasReglas = JSON.stringify(j); })
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
    var vals = [], i;
    var claves = [];
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
  // puede usar nada de aqui fuera). Devuelve la URL final o cadena vacia.
  function agenteEnPagina(sel, profundo, clic) {
    var FIN = /(^|\.)(drive\.google\.com|docs\.google\.com|mega\.nz|mega\.co\.nz|mediafire\.com|1fichier\.com|pixeldrain\.com|gofile\.io|krakenfiles\.com|workupload\.com|buzzheavier\.com|send\.cm|sendcm\.com|terabox\.com|1024terabox\.com|dropbox\.com|uploadhaven\.com|qiwi\.gg|acefile\.co|frdl\.io|desiupload\.co|hexload\.com|dailyuploads\.net|racaty\.net|zippyshare\.com|anonfiles\.com|bowfile\.com|fastupload\.io|filerio\.in|uptobox\.com|nitroflare\.com|rapidgator\.net)$/i;
    var RUIDO = /(^|\.)(facebook\.com|x\.com|twitter\.com|t\.me|telegram\.me|telegram\.org|wa\.me|whatsapp\.com|instagram\.com|discord\.gg|discord\.com|youtube\.com|youtu\.be|reddit\.com|patreon\.com|paypal\.com|ko-fi\.com|buymeacoffee\.com|tiktok\.com|pinterest\.com|linkedin\.com|google\.com|gstatic\.com|googleapis\.com|doubleclick\.net|w3\.org|schema\.org|jquery\.com|bootstrapcdn\.com|cloudflare\.com|fontawesome\.com)$/i;
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
      // Pasarelas de "pulsa para continuar": se pulsa y se deja que el
      // siguiente reintento recoja el enlace ya revelado.
      try { var b = document.querySelector(clic); if (b) b.click(); } catch (e) { /* nada */ }
    }

    var i, u2, a, as = document.querySelectorAll('a[href]');

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

    // 4. URLs dentro de los scripts de la pagina, pero solo a alojamientos
    //    conocidos y con camino propio: hay paginas con listas de dominios
    //    sueltos (app_domains y parecidos) que no son espejos de nada.
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

    // 5. Solo en el salto a mano: cualquier enlace externo con camino propio.
    //    El mas largo suele ser el bueno (los cortos son avisos legales, el
    //    sitio del acortador, redes sociales que ya estan filtradas).
    var mejor = '', largo = -1;
    for (i = 0; i < as.length; i++) {
      u2 = sirve(as[i].getAttribute('href'), false);
      if (!u2) continue;
      var p; try { p = new URL(u2).pathname; } catch (e) { continue; }
      if (p.length < 2) continue;
      if (p.length > largo) { largo = p.length; mejor = u2; }
    }
    if (mejor) return mejor;

    // 6. Y ya como ultimo recurso, URLs de los scripts a cualquier sitio.
    for (i = 0; i < sc.length; i++) {
      var us = (sc[i].textContent || '').match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
      for (var k = 0; k < us.length; k++) {
        var u3; try { u3 = new URL(us[k]); } catch (e) { continue; }
        if (u3.pathname.length < 2) continue;
        u2 = sirve(us[k], false); if (u2) return u2;
      }
    }
    return '';
  }

  function pideDestino(wv, sel, profundo, clic) {
    var code = '(' + agenteEnPagina.toString() + ')(' +
      JSON.stringify(sel || '') + ',' + (!!profundo) + ',' + JSON.stringify(clic || '') + ')';
    try { return wv.executeJavaScript(code).catch(function () { return ''; }); } catch (e) { return Promise.resolve(''); }
  }

  /* ---------- el salto ---------- */

  var memoria = new WeakMap();   // webview -> { saltos: [ts], desde: {url: ts} }
  function mem(wv) {
    var m = memoria.get(wv);
    if (!m) { m = { saltos: [], desde: {} }; memoria.set(wv, m); }
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

  function salta(wv, desde, destino, aviso) {
    if (!destino || destino === desde) return false;
    var d = parse(destino);
    if (!d || !/^https?:$/.test(d.protocol)) return false;
    if (!puedeSaltar(wv, desde)) return false;
    apunta(wv, desde);
    try { wv.stop(); } catch (e) { /* nada */ }
    try { wv.loadURL(destino); } catch (e) { return false; }
    contador++; localStorage.__navPasarelasCount = String(contador); pinta();
    // Solo se avisa al llegar al final de la cadena: en un salto intermedio
    // (pasarela que lleva a otra pasarela) el aviso sobra y ensucia.
    if (aviso !== false && !reglaDe(destino)) naviris.toast('Pasarela saltada: ' + d.hostname);
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
      // va en la URL, la pasarela no llega a recibir ni una visita. load-commit
      // y did-navigate quedan de red de seguridad, porque will-navigate no
      // cubre las navegaciones que arranca la propia interfaz (barra, marcador).
      antes: function (e) { var u = e && e.url; if (u) setTimeout(function () { alNavegar(wv, u); }, 0); },
      commit: function (e) { if (e && e.isMainFrame === false) return; var u = (e && e.url) || null; setTimeout(function () { alNavegar(wv, u || wv.getURL()); }, 0); },
      nav: function (e) { alNavegar(wv, (e && e.url) || wv.getURL()); }
    };
    oyentes.set(wv, o);
    wv.addEventListener('will-navigate', o.antes);
    wv.addEventListener('load-commit', o.commit);
    wv.addEventListener('did-navigate', o.nav);
    // Una pestana que ya estaba abierta en una pasarela cuando se instalo o se
    // encendio el addon tambien cuenta.
    try { alNavegar(wv, wv.getURL()); } catch (e) { /* nada */ }
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
  }

  /* ---------- salto a mano (Alt+S) ---------- */

  function saltoAMano() {
    var wv = null;
    try { wv = naviris.activeWebview(); } catch (e) { /* nada */ }
    if (!wv) { naviris.toast('No hay ninguna pagina abierta que saltar'); return; }
    var url = '';
    try { url = wv.getURL(); } catch (e) { /* nada */ }
    var u = parse(url);
    if (!u || !/^https?:$/.test(u.protocol)) { naviris.toast('Esta pestana no es una pagina web'); return; }
    // A mano se prueban los parametros aunque el sitio no tenga regla.
    var destino = destinoDeUrl(url, null);
    if (destino && salta(wv, url, destino)) return;
    naviris.toast('Buscando el enlace final…');
    pideDestino(wv, reglaDe(url) && reglaDe(url).selector, true, '').then(function (d) {
      if (d && salta(wv, url, d)) return;
      naviris.toast('No se encontro el enlace final en esta pagina');
    });
  }
  // Alt+S. Desde 2.7.6-dev.3 lo reparte el core (naviris.onAtajo), que es la
  // unica forma de que responda con el foco DENTRO de la pagina: los eventos de
  // teclado de una webview no llegan a esta interfaz. En versiones anteriores
  // queda el respaldo, que solo funciona con el foco en la interfaz.
  var atajoPropio = null;
  if (!(naviris.onAtajo && naviris.onAtajo('s', saltoAMano))) {
    atajoPropio = function (e) {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saltoAMano(); }
    };
    window.addEventListener('keydown', atajoPropio, true);
  }

  /* ---------- boton ---------- */

  function pinta(btn) {
    btn = btn || document.getElementById('adt-' + ID);
    if (!btn) return;
    btn.style.color = activo ? AMBAR : '';
    btn.style.filter = activo ? 'drop-shadow(0 0 5px rgba(245,165,36,.75))' : '';
    btn.title = activo
      ? 'Salta pasarelas: ACTIVO — las pasarelas de acortadores se saltan solas (' + contador + ' saltadas). Alt+S fuerza el salto en la pagina que estes viendo. Clic para pausarlo.'
      : 'Salta pasarelas: PAUSADO — clic para que las pasarelas de acortadores se salten solas. Alt+S sigue forzando el salto a mano.';
  }

  naviris.registerTool({
    id: ID,
    label: 'Salta pasarelas: lleva la pestana directa al enlace final del acortador',
    icon: 'skip-forward',
    onClick: function (btn) {
      activo = !activo;
      localStorage.__navPasarelas = activo ? '1' : '0';
      if (activo) barre();
      pinta(btn);
      naviris.toast(activo ? 'Salta pasarelas activo' : 'Salta pasarelas en pausa (Alt+S sigue funcionando)');
    },
    onUnload: function () {
      try { clearInterval(timer); } catch (e) { /* nada */ }
      try { if (naviris.offAtajo) naviris.offAtajo('s'); } catch (e) { /* nada */ }
      try { if (atajoPropio) window.removeEventListener('keydown', atajoPropio, true); } catch (e) { /* nada */ }
      desarmar();
    }
  });
  pinta();
  cargaReglas();

  // Banco de pruebas: desde la consola de la interfaz se puede comprobar que
  // una URL se resuelve bien sin tener que visitar la pasarela.
  //   __saltaPasarelas.destinoDeUrl('https://sitio/x?u=aHR0cHM6…')
  //   __saltaPasarelas.reglaDe('https://sitio/x')
  window.__saltaPasarelas = {
    destinoDeUrl: destinoDeUrl,
    reglaDe: reglaDe,
    agenteEnPagina: agenteEnPagina,
    reglas: function () { return reglas; }
  };

  // Vigia: engancha las pestanas nuevas y se auto-limpia si quitan el addon
  // (su boton ya no esta en el DOM).
  var timer = setInterval(function () {
    if (!document.getElementById('adt-' + ID)) { clearInterval(timer); desarmar(); return; }
    barre();
  }, 1500);
  barre();
})();

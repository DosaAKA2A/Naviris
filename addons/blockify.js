/* Naviris addon: Blockify v1.3.0
   Port completo de la extensión "Spotify Ad Blocker - Blockify" 1.9.5 de
   Chrome, reescrita como addon de Naviris. Qué hace en open.spotify.com:

   1. Captura el controller interno del reproductor colándose en el runtime del
      empaquetador (el global de chunks del bundle) y recorriendo los módulos
      hasta dar con un objeto que exponga nextTrack/pause/resume Y el _streamer
      con _listPlayer.next, que es lo que de verdad hace falta para saltar.
   2. Salta el anuncio al instante: escucha track_loaded en ese _streamer y,
      cuando la pista es un anuncio, dispara _listPlayer.next("trackdone").
   3. Mutify de respaldo: si un anuncio llega a sonar (controller aún no
      capturado), un observer reconoce la interfaz de pausa publicitaria
      (ad-companion-card y compañía) y Naviris silencia la pestaña hasta que
      vuelve la música.
   4. Oculta las tarjetas y avisos de anuncio del reproductor y los banners de
      "Upgrade to Premium" (los mismos selectores que la extensión).

   Qué NO se portó, a propósito: su telemetría (insights.getblockify.com,
   PostHog, Sentry), los switches remotos de blockify.b-cdn.net, las promos y
   el cuadro de valoración, y sus listas de filtros (easylist y compañía):
   Naviris ya trae el motor de adblock de Brave en el core, igual que los
   bloqueos de YouTube/Twitch/Hulu que la extensión duplicaba.

   v1.1.0: freno anti-congelón. Saltar un anuncio que Spotify re-sirve una y
   otra vez dejaba el reproductor colgado (y el aluvión de saltos, la interfaz);
   ahora tras 3 recargas seguidas del anuncio se deja sonar en silencio y el
   salto se rearma con la siguiente pista normal. Acompaña al arreglo del core
   (v2.7.3-dev.9) que deja de bloquear por red las peticiones de Spotify.

   v1.2.0: el addon podía quedarse MUERTO pareciendo que funcionaba. Arreglos:
   - El criterio de captura del controller exige ahora _streamer.on y
     _listPlayer.next, no solo nextTrack/pause/resume: había envoltorios que
     cumplían la tripleta sin tener _streamer, engancha() petaba en silencio y
     como __nbController ya estaba fijado no se reintentaba nunca. Botón verde,
     cero saltos. Ahora __nbController solo se fija si engancha() funcionó.
   - El guard del agente lleva versión: actualizar en caliente no llegaba a la
     página (seguía corriendo el agente viejo) y hacía falta recargar la pestaña.
   - El freno cuenta saltos QUE NO SIRVIERON (mismo anuncio recargado), no
     cargas de anuncio seguidas: un corte normal de 3-4 anuncios distintos
     disparaba el freno justo cuando el salto sí funcionaba.
   - Un único dueño del mute, y el rearme del freno ocurre aunque el addon esté
     pausado (antes pausar durante un anuncio dejaba el estado roto para siempre).
   - deepFind con cota de profundidad y visitados compartidos: recorrer el grafo
     entero de cada módulo del bundle congelaba la página por sí solo.
   - Se arman todas las pestañas de Spotify, no solo la activa; se sueltan los
     listeners al descargar el addon; el CSS se retira al pausar.
   - Fuera el bloque de ad_content_id con sus hooks de fetch y WebSocket: era
     código muerto (nadie lee ese atributo en Naviris, y el core exime a Spotify
     del bloqueo por red) y parcheaba el reproductor a cambio de nada.
   - El respaldo de silenciar ya no depende de una frase en inglés, que en un
     Spotify en español no aparecía nunca.

   v1.3.0: LA CAUSA DE RAÍZ. Spotify migró su empaquetador de webpack a RSPACK y
   con ello el global cambió de webpackChunkclient_web a rspackChunkclient_web.
   El addon lo buscaba por nombre fijo, así que la captura del controller no
   podía funcionar: el push petaba con "Cannot read properties of undefined" y se
   lo tragaba el catch. Comprobado en vivo por CDP el 2026-07-31 en
   open.spotify.com: el único global de chunks presente es rspackChunkclient_web.
   Todo lo de v1.2.0 seguía siendo necesario, pero no bastaba.
   Ahora el global se descubre por patrón /^(webpack|rspack)Chunk/ en vez de por
   nombre, y la caché de módulos se localiza POR FORMA (un objeto cuyos valores
   son módulos con .exports) en vez de asumir require.c, que rspack no expone.

   Arquitectura: herramienta del sidebar (kind "tool", corre en el renderer).
   En la página solo se inyecta un agente que detecta y salta; la página avisa
   al addon por console-message ("NAVBLOCKIFY|{...}") y el addon silencia o
   desmutea la pestaña con setAudioMuted. Botón verde Spotify = activo, con
   contador de anuncios saltados en el tooltip. */
(function () {
  var ID = 'blockify';
  var VERDE = '#1DB954'; // verde Spotify: se ve de un vistazo que está activo
  var activo = localStorage.__navBlockify !== '0'; // activo nada más instalar
  var contador = Number(localStorage.__navBlockifyCount || 0);
  var wvs = [];          // webviews de Spotify ya armados (para apagar/desmutear)
  var avisado = false;   // un solo toast por sesión al saltar el primer anuncio

  /* ---------- Agente que se inyecta en la página (mundo de la página) ---------- */
  // El guard LLEVA VERSIÓN a propósito. Con un guard sin versión, actualizar el
  // addon en caliente no cambiaba nada: el renderer cargaba el código nuevo pero
  // la pestaña de Spotify seguía ejecutando el agente viejo y el nuevo se salía en
  // su primera línea. Había que recargar la pestaña para que el arreglo existiera.
  var AGENTE_VER = 3;
  var AGENT = '(function(){' +
    'if(window.__navBlockifyAgent>=' + AGENTE_VER + ')return;' +
    'var reemplazo=!!window.__navBlockifyAgent;window.__navBlockifyAgent=' + AGENTE_VER + ';' +
    'if(window.__navBlockifyOff===undefined)window.__navBlockifyOff=0;' +
    // Referencia NATIVA de console.log guardada en la inyección: si Spotify
    // sustituye console.log por un no-op (práctica habitual en producción), el
    // canal con el addon moriría en silencio y el botón seguiría en verde.
    'var LOG=console.log.bind(console);' +
    'function rep(o){try{LOG("NAVBLOCKIFY|"+JSON.stringify(o))}catch(e){}}' +
    // Al reemplazar un agente viejo hay que desarmar sus temporizadores y su
    // observer, o quedan dos agentes mandando mutes contradictorios.
    'try{if(window.__navBlockifyStop)window.__navBlockifyStop()}catch(e){}' +
    'var vivos=[],obs=null;' +
    'window.__navBlockifyStop=function(){for(var i=0;i<vivos.length;i++){try{clearTimeout(vivos[i]);clearInterval(vivos[i])}catch(e){}}' +
    'vivos=[];try{if(obs)obs.disconnect()}catch(e){}};' +
    'function luego(f,ms){var t=setTimeout(f,ms);vivos.push(t);return t}' +
    // 1. Controller de Spotify vía webpack. El criterio EXIGE _streamer.on: antes
    // bastaba con nextTrack+pause+resume, pero Spotify tiene varios envoltorios
    // que cumplen esa tripleta y NO tienen _streamer. Al quedarse con uno de esos,
    // engancha() petaba, el catch se lo tragaba y como __nbController ya estaba
    // fijado no se reintentaba jamás: botón verde y cero anuncios saltados.
    'function sirve(o){try{return typeof o.nextTrack==="function"&&typeof o.pause==="function"&&' +
    'typeof o.resume==="function"&&o._streamer&&typeof o._streamer.on==="function"&&' +
    'o._streamer._listPlayer&&typeof o._streamer._listPlayer.next==="function"}catch(e){return false}}' +
    // deepFind con COTA de profundidad y visitados COMPARTIDOS entre módulos. Sin
    // las dos cosas, recorrer el grafo entero de cada módulo del bundle (con un
    // Set nuevo por módulo) bloqueaba el hilo de la página varios segundos: era
    // una causa de congelón independiente de los saltos en bucle.
    'function deepFind(o,vis,prof){if(!o||typeof o!=="object"||prof>6)return null;' +
    'if(vis.has(o))return null;vis.add(o);' +
    'if(o===window||o===document||o.nodeType)return null;' +
    'if(sirve(o))return o;' +
    'for(var k in o){try{var f=deepFind(o[k],vis,prof+1);if(f)return f}catch(e){}}' +
    'return null}' +
    // Freno anti-congelón: cuenta SALTOS QUE NO SIRVIERON, es decir, veces que
    // vuelve a cargar EL MISMO anuncio tras haberlo saltado. Antes contaba cargas
    // de anuncio seguidas, así que un corte normal de Spotify (3-4 anuncios
    // distintos encadenados) disparaba el freno justo cuando el salto SÍ estaba
    // funcionando, y te comías el bloque en silencio en vez de música.
    'var ultimoId=null,fallos=0,muteForzado=false;' +
    'function idDe(t){try{return t.uri||t.id||(t.metadata&&t.metadata.entity_uri)||null}catch(e){return null}}' +
    // Un único dueño del mute: manda(estado) es la ÚNICA vía. Antes el freno y el
    // detector de interfaz escribían por su cuenta, cada uno con su propio dedup,
    // y se desincronizaban (la tarjeta del anuncio desaparecía, el detector
    // mandaba mute:false y el anuncio seguía sonando a todo volumen).
    'var muteActual=false;' +
    'function manda(v){v=!!v;if(v===muteActual)return;muteActual=v;rep({mute:v})}' +
    'function engancha(c){c._streamer.on("track_loaded",function(e){' +
    'var t=e&&e.data&&e.data.track;if(!t)return;' +
    'var esAd=!!(t.isAd||t.is_advertisement||(t.metadata&&t.metadata.is_advertisement));' +
    // El rearme va ANTES de mirar si el addon está pausado: si no, pausar durante
    // un anuncio dejaba muteForzado en true para siempre y al reactivar ni se
    // saltaba ni se silenciaba nunca más.
    'if(!esAd){ultimoId=null;fallos=0;if(muteForzado){muteForzado=false;manda(false)}return}' +
    'if(window.__navBlockifyOff)return;' +
    'var id=idDe(t);' +
    'if(id&&id===ultimoId){fallos++}else{fallos=0;ultimoId=id}' +
    'if(fallos>=3){if(!muteForzado){muteForzado=true;manda(true)}return}' +
    'try{c._streamer._listPlayer.next("trackdone");rep({skip:1})}catch(x){}});rep({hook:1})}' +
    // Spotify migró de webpack a RSPACK: el global pasó de webpackChunkclient_web a
    // rspackChunkclient_web. Buscarlo por nombre fijo era el motivo REAL de que el
    // controller no se capturara nunca (comprobado en vivo el 2026-07-31: en
    // open.spotify.com solo existe rspackChunkclient_web). Se descubre por patrón
    // para no volver a atarse a un nombre concreto.
    'function chunkGlobal(){' +
    'var pref=["rspackChunkclient_web","webpackChunkclient_web"];' +
    'for(var i=0;i<pref.length;i++){var v=window[pref[i]];if(v&&typeof v.push==="function")return v}' +
    'try{var ks=Object.keys(window);' +
    'for(var j=0;j<ks.length;j++){if(!/^(webpack|rspack)Chunk/.test(ks[j]))continue;' +
    'var w=window[ks[j]];if(w&&typeof w.push==="function")return w}}catch(e){}' +
    'return null}' +
    // La caché de módulos tampoco se puede dar por hecha: en webpack es require.c,
    // pero rspack no la expone ahí. Se localiza por forma (un objeto cuyos valores
    // son módulos con .exports) en vez de por nombre.
    'function cacheDe(req){if(!req)return null;' +
    'if(req.c&&typeof req.c==="object")return req.c;' +
    'try{var ps=Object.getOwnPropertyNames(req);' +
    'for(var i=0;i<ps.length;i++){var v;try{v=req[ps[i]]}catch(e){continue}' +
    'if(!v||typeof v!=="object")continue;' +
    'var ks=Object.keys(v);if(!ks.length)continue;' +
    'var ok=0,n=Math.min(ks.length,5);' +
    'for(var j=0;j<n;j++){var m=v[ks[j]];if(m&&typeof m==="object"&&"exports" in m)ok++}' +
    'if(ok===n)return v}}catch(e){}' +
    'return null}' +
    'var intentos=0;' +
    'function busca(){if(window.__nbController)return;intentos++;' +
    'try{window.__nbReq=null;' +
    'var g=chunkGlobal();if(!g){if(intentos<8)luego(busca,5000);return}' +
    'g.push([[Math.random()],{},function(r){window.__nbReq=r}]);' +
    'luego(function(){if(window.__nbController)return;' +
    'var req=window.__nbReq,vis=new Set(),c=null;' +
    'var cache=cacheDe(req);' +
    'if(!cache)rep({sincache:1});' +
    'if(cache){for(var id in cache){' +
    'try{c=deepFind(cache[id]&&cache[id].exports,vis,0);if(c)break}catch(e){}}}' +
    // __nbController solo se fija si engancha() DE VERDAD funcionó. Si falla, se
    // deja sin fijar para que el siguiente intento pueda probar otro candidato.
    'if(c){try{engancha(c);window.__nbController=c;return}catch(e){rep({hookfail:1})}}' +
    'if(intentos<8)luego(busca,5000)},1000)}catch(e){if(intentos<8)luego(busca,5000)}}' +
    // Ventana de búsqueda más larga (8 intentos): con red lenta o entrando al
    // reproductor tarde, el bundle de Spotify aún no existe en los primeros.
    'luego(busca,reemplazo?500:4000);' +
    // 2. Respaldo: reconocer la interfaz de pausa publicitaria. Ya NO depende de
    // una frase en inglés ("Your music will continue after the break"), que en un
    // Spotify en español no aparecía nunca y dejaba el respaldo sin cubrir.
    'var deb=null;' +
    'function esAnuncio(){try{' +
    'if(document.querySelector("[data-testid=ad-companion-card],[data-testid=ad-companion-card-tagline],a[data-context-item-type=ad],[data-testid=advertiser-name]"))return true;' +
    'var b=document.querySelector("[data-testid=context-item-info-ad-title],[data-testid=now-playing-widget] [data-testid=ad-title]");' +
    'if(b)return true}catch(e){}return false}' +
    'function sync(){if(window.__navBlockifyOff){manda(false);return}' +
    // El detector de interfaz NO desmutea mientras el freno tiene el mute forzado:
    // el anuncio sigue sonando aunque su tarjeta ya no esté en el DOM.
    'if(muteForzado)return;manda(esAnuncio())}' +
    'function vigila(){if(!document.body){luego(vigila,1200);return}' +
    'obs=new MutationObserver(function(){if(deb)clearTimeout(deb);deb=luego(function(){deb=null;sync()},500)});' +
    'obs.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});' +
    'sync()}' +
    'vigila()' +
    '})();';

  // Los mismos selectores que la extensión: tarjetas de anuncio, banners de
  // Premium y los toasts notistack (ahí asoman los avisos publicitarios).
  var CSS =
    '[data-testid="ad-companion-card"],[data-testid="ad-companion-card-tagline"],a[data-context-item-type="ad"]{display:none!important;visibility:hidden!important}' +
    'button[title="Upgrade to Premium"],button[aria-label="Upgrade to Premium"],a[href="/download"]{display:none!important}' +
    '.notistack-CollapseWrapper{visibility:hidden!important}';

  function esSpotify(wv) {
    try { return /^https?:\/\/open\.spotify\.com([/?#]|$)/.test(wv.getURL()); } catch (e) { return false; }
  }
  // Clave de la hoja de estilos por webview, para poder retirarla al pausar el
  // addon (antes el CSS que oculta tarjetas y banners se quedaba puesto para
  // siempre, y encima se insertaba dos veces por navegación).
  var cssKey = new WeakMap();
  function ponCss(wv) {
    if (cssKey.has(wv)) return;
    cssKey.set(wv, true);
    try { wv.insertCSS(CSS).then(function (k) { cssKey.set(wv, k); }).catch(function () {}); } catch (e) { /* nada */ }
  }
  function quitaCss(wv) {
    var k = cssKey.get(wv);
    if (!k || k === true) { cssKey.delete(wv); return; }
    cssKey.delete(wv);
    try { wv.removeInsertedCSS(k).catch(function () {}); } catch (e) { /* nada */ }
  }
  function inyectar(wv) {
    try { wv.executeJavaScript(AGENT).catch(function () {}); } catch (e) { /* nada */ }
    try { wv.executeJavaScript('window.__navBlockifyOff=' + (activo ? '0' : '1')).catch(function () {}); } catch (e) { /* nada */ }
    ponCss(wv);
  }
  function onMsg(e) {
    if (typeof e.message !== 'string' || e.message.indexOf('NAVBLOCKIFY|') !== 0) return;
    var m; try { m = JSON.parse(e.message.slice(12)); } catch (x) { return; }
    if ('mute' in m) { try { e.target.setAudioMuted(activo && !!m.mute); } catch (x) { /* nada */ } }
    if (m.skip) {
      contador++; localStorage.__navBlockifyCount = String(contador); pinta();
      if (!avisado) { avisado = true; naviris.toast('Blockify: anuncio de Spotify saltado'); }
    }
  }
  // Los listeners se guardan por webview para poder soltarlos en desarmar(): sin
  // eso, actualizar el addon dejaba vivos los de la instancia anterior y acababa
  // habiendo dos manejadores con su propio contador y su propio criterio de mute.
  var oyentes = new WeakMap();
  function armar(wv) {
    if (wvs.indexOf(wv) !== -1) return;
    wvs.push(wv);
    var re = function () {
      if (esSpotify(wv)) { if (activo) inyectar(wv); }
      else { try { wv.setAudioMuted(false); } catch (e) { /* nada */ } } // fuera de Spotify no queda nada muteado
    };
    oyentes.set(wv, re);
    wv.addEventListener('console-message', onMsg);
    wv.addEventListener('dom-ready', re);
    wv.addEventListener('did-navigate', re);
    re();
  }
  function desarmar() {
    for (var i = 0; i < wvs.length; i++) {
      var wv = wvs[i], re = oyentes.get(wv);
      try { wv.removeEventListener('console-message', onMsg); } catch (e) { /* nada */ }
      if (re) {
        try { wv.removeEventListener('dom-ready', re); } catch (e) { /* nada */ }
        try { wv.removeEventListener('did-navigate', re); } catch (e) { /* nada */ }
      }
      oyentes.delete(wv);
      try { wv.setAudioMuted(false); } catch (e) { /* nada */ }
      quitaCss(wv);
    }
    wvs = [];
  }
  function apagar() {
    for (var i = 0; i < wvs.length; i++) {
      try { wvs[i].setAudioMuted(false); } catch (e) { /* nada */ }
      try { wvs[i].executeJavaScript('window.__navBlockifyOff=1').catch(function () {}); } catch (e) { /* nada */ }
      quitaCss(wvs[i]);
    }
  }
  function encender() {
    for (var i = 0; i < wvs.length; i++) {
      try { if (esSpotify(wvs[i])) inyectar(wvs[i]); } catch (e) { /* nada */ }
    }
  }
  // Arma TODAS las pestañas de Spotify, no solo la activa: una abierta en segundo
  // plano (clic central, restauración de sesión) no se armaba hasta ponerla en
  // primer plano, así que Blockify no hacía nada en ella.
  function barre() {
    var lista = [];
    try { lista = naviris.allWebviews ? naviris.allWebviews() : []; } catch (e) { lista = []; }
    if (!lista.length) { var a = naviris.activeWebview(); if (a) lista = [a]; }
    for (var i = 0; i < lista.length; i++) {
      if (esSpotify(lista[i])) armar(lista[i]);
    }
  }
  function pinta(btn) {
    btn = btn || document.getElementById('adt-' + ID);
    if (!btn) return;
    btn.style.color = activo ? VERDE : '';
    btn.style.filter = activo ? 'drop-shadow(0 0 5px rgba(29,185,84,.75))' : '';
    btn.title = activo
      ? 'Blockify: ACTIVO — los anuncios de Spotify Web se saltan solos (' + contador + ' saltados). Clic para pausarlo.'
      : 'Blockify: bloquea los anuncios de audio de Spotify Web. Clic para activarlo.';
  }

  naviris.registerTool({
    id: ID,
    label: 'Blockify: bloquea los anuncios de audio de Spotify Web',
    icon: 'musical-note',
    onClick: function (btn) {
      activo = !activo;
      localStorage.__navBlockify = activo ? '1' : '0';
      if (activo) { barre(); encender(); }
      else apagar();
      pinta(btn);
      naviris.toast(activo ? 'Blockify activo: los anuncios de Spotify se saltan solos' : 'Blockify en pausa');
    },
    // Lo llama Naviris al retirar la herramienta (desinstalar o actualizar en
    // caliente): suelta listeners, desmutea y quita el CSS.
    onUnload: function () { try { clearInterval(timer); } catch (e) { /* nada */ } desarmar(); }
  });
  pinta();

  // Vigía: arma las pestañas de Spotify (todas, no solo la activa); se auto-limpia
  // si quitan el addon (botón fuera del DOM), desmuteando lo que quede mutado.
  var timer = setInterval(function () {
    var btn = document.getElementById('adt-' + ID);
    if (!btn) { clearInterval(timer); desarmar(); return; }
    if (!activo) return;
    barre();
  }, 1500);
})();

/* Naviris addon: Blockify v1.1.0
   Port completo de la extensión "Spotify Ad Blocker - Blockify" 1.9.5 de
   Chrome, reescrita como addon de Naviris. Qué hace en open.spotify.com:

   1. Detecta las pistas de anuncio interceptando las respuestas /state del
      reproductor (fetch) y los mensajes replace_state del websocket "dealer":
      toda pista con content_type "AD" delata sus file_ids, que se publican en
      el atributo ad_content_id del <body> (mismo contrato que la extensión).
   2. Salta el anuncio al instante: captura el controller interno de Spotify
      vía webpack (objeto con nextTrack/pause/resume), escucha track_loaded y
      cuando la pista es un anuncio dispara _listPlayer.next("trackdone").
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
  var AGENT = '(function(){' +
    'if(window.__navBlockifyAgent)return;window.__navBlockifyAgent=1;' +
    'if(window.__navBlockifyOff===undefined)window.__navBlockifyOff=0;' +
    'function rep(o){try{console.log("NAVBLOCKIFY|"+JSON.stringify(o))}catch(e){}}' +
    // Pistas de anuncio: content_type "AD" -> file_ids_mp3[].file_id. Tope de 10
    // ids (como la extensión) y publicación en ad_content_id del <body>.
    'var ids=[];' +
    'function addTracks(tracks){if(!tracks||!tracks.length)return;var nuevos=[],i,j;' +
    'for(i=0;i<tracks.length;i++){var t=tracks[i];' +
    'if(t&&t.content_type==="AD"&&t.manifest&&t.manifest.file_ids_mp3){var f=t.manifest.file_ids_mp3;' +
    'for(j=0;j<f.length;j++)if(f[j]&&f[j].file_id&&ids.indexOf(f[j].file_id)<0)nuevos.push(f[j].file_id)}}' +
    'if(!nuevos.length)return;ids=ids.concat(nuevos);if(ids.length>10)ids=ids.slice(ids.length-10);' +
    'try{document.body.setAttribute("ad_content_id",JSON.stringify(ids))}catch(e){}' +
    'rep({ids:ids.length})}' +
    // 1. Hook de fetch: las respuestas de /state traen la máquina de estados del
    // reproductor con la cola de pistas (anuncios incluidos).
    'var of=window.fetch;' +
    'window.fetch=function(u,i){var s=(typeof u==="string")?u:((u&&u.url)||"");' +
    'if(s.indexOf("/state")!==-1){return of.call(window,u,i).then(function(r){' +
    'try{r.clone().json().then(function(d){if(d&&d.state_machine)addTracks(d.state_machine.tracks)}).catch(function(){})}catch(e){}' +
    'return r})}' +
    'return of.call(window,u,i)};' +
    // 2. Hook de WebSocket: el socket "dealer" empuja replace_state con la misma
    // máquina de estados. Se escucha sin tocar el mensaje.
    'var WS=window.WebSocket;' +
    'window.WebSocket=function(url,prot){var ws=prot?new WS(url,prot):new WS(url);' +
    'ws.addEventListener("message",function(ev){try{var d=JSON.parse(ev.data);var p=d&&d.payloads;if(!p)return;' +
    'for(var i=0;i<p.length;i++)if(p[i]&&p[i].type==="replace_state"&&p[i].state_machine)addTracks(p[i].state_machine.tracks)}catch(e){}});' +
    'return ws};' +
    'window.WebSocket.prototype=WS.prototype;' +
    'window.WebSocket.CONNECTING=WS.CONNECTING;window.WebSocket.OPEN=WS.OPEN;' +
    'window.WebSocket.CLOSING=WS.CLOSING;window.WebSocket.CLOSED=WS.CLOSED;' +
    // 3. Controller de Spotify vía webpack: objeto con nextTrack/pause/resume.
    // En track_loaded, si la pista es un anuncio, siguiente pista al instante.
    'function deepFind(o,vis){if(!o||typeof o!=="object")return null;if(vis.has(o))return null;vis.add(o);' +
    'if(o===window||o===document)return null;' +
    'try{if(typeof o.nextTrack==="function"&&typeof o.pause==="function"&&typeof o.resume==="function")return o}catch(e){return null}' +
    'for(var k in o){try{var f=deepFind(o[k],vis);if(f)return f}catch(e){}}' +
    'return null}' +
    // Freno anti-congelón: si Spotify re-sirve el anuncio nada más saltarlo
    // (3 recargas seguidas en menos de 2,5 s cada una), insistir con el salto
    // deja el reproductor colgado esperando al servidor. En ese caso se deja
    // sonar el anuncio EN SILENCIO (mute forzado) y al volver la música normal
    // se desmutea y se rearma el salto.
    'var lastSkip=0,rafaga=0,muteForzado=false;' +
    'function engancha(c){try{c._streamer.on("track_loaded",function(e){' +
    'if(window.__navBlockifyOff)return;' +
    'var t=e&&e.data&&e.data.track;if(!t)return;' +
    'if(!t.isAd){rafaga=0;if(muteForzado){muteForzado=false;rep({mute:false})}return}' +
    'var ahora=Date.now();rafaga=(ahora-lastSkip<2500)?rafaga+1:0;lastSkip=ahora;' +
    'if(rafaga>=3){if(!muteForzado){muteForzado=true;rep({mute:true})}return}' +
    'try{c._streamer._listPlayer.next("trackdone");rep({skip:1})}catch(x){}});rep({hook:1})}catch(e){}}' +
    'var intentos=0;' +
    'function busca(){if(window.__nbController)return;intentos++;' +
    'try{window.__nbReq=null;' +
    'window.webpackChunkclient_web.push([[Math.random()],{},function(r){window.__nbReq=r}]);' +
    'setTimeout(function(){if(window.__nbController)return;' +
    'var req=window.__nbReq;if(req&&req.c){for(var id in req.c){' +
    'try{var c=deepFind(req.c[id].exports,new Set());if(c){window.__nbController=c;engancha(c);return}}catch(e){}}}' +
    'if(intentos<4)setTimeout(busca,5000)},1000)}catch(e){if(intentos<4)setTimeout(busca,5000)}}' +
    'setTimeout(busca,4000);' +
    // 4. Mutify: reconocer la interfaz de pausa publicitaria y avisar al addon
    // para silenciar/desmutear la pestaña. Debounce de 500 ms como la extensión.
    'var adUi=null,deb=null;' +
    'function esAnuncio(){var p=document.getElementById("Desktop_PanelContainer_Id");' +
    'if(p){if(p.textContent.indexOf("Your music will continue after the break")!==-1)return true;' +
    'if(p.querySelector("[data-testid=ad-companion-card]"))return true;' +
    'if(p.querySelector("[data-testid=ad-companion-card-tagline]"))return true;' +
    'if(p.querySelector("a[data-context-item-type=ad]"))return true}' +
    'if(document.querySelector("[data-testid=ad-companion-card],a[data-context-item-type=ad]"))return true;' +
    'return false}' +
    'function sync(){var a=!window.__navBlockifyOff&&esAnuncio();if(a===adUi)return;adUi=a;rep({mute:a})}' +
    'function vigila(){if(!document.body){setTimeout(vigila,1200);return}' +
    'new MutationObserver(function(){if(deb)clearTimeout(deb);deb=setTimeout(function(){deb=null;sync()},500)})' +
    '.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});' +
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
  function inyectar(wv) {
    try { wv.executeJavaScript(AGENT).catch(function () {}); } catch (e) { /* nada */ }
    try { wv.executeJavaScript('window.__navBlockifyOff=' + (activo ? '0' : '1')).catch(function () {}); } catch (e) { /* nada */ }
    try { wv.insertCSS(CSS).catch(function () {}); } catch (e) { /* nada */ }
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
  function armar(wv) {
    if (wvs.indexOf(wv) !== -1) return;
    wvs.push(wv);
    wv.addEventListener('console-message', onMsg);
    var re = function () {
      if (esSpotify(wv)) { if (activo) inyectar(wv); }
      else { try { wv.setAudioMuted(false); } catch (e) { /* nada */ } } // fuera de Spotify no queda nada muteado
    };
    wv.addEventListener('dom-ready', re);
    wv.addEventListener('did-navigate', re);
    re();
  }
  function apagar() {
    for (var i = 0; i < wvs.length; i++) {
      try { wvs[i].setAudioMuted(false); } catch (e) { /* nada */ }
      try { wvs[i].executeJavaScript('window.__navBlockifyOff=1').catch(function () {}); } catch (e) { /* nada */ }
    }
  }
  function encender() {
    for (var i = 0; i < wvs.length; i++) {
      try { if (esSpotify(wvs[i])) inyectar(wvs[i]); } catch (e) { /* nada */ }
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
      if (activo) { encender(); var wv = naviris.activeWebview(); if (wv && esSpotify(wv)) armar(wv); }
      else apagar();
      pinta(btn);
      naviris.toast(activo ? 'Blockify activo: los anuncios de Spotify se saltan solos' : 'Blockify en pausa');
    }
  });
  pinta();

  // Vigía: arma cada pestaña de Spotify al verla activa; se auto-limpia si
  // quitan el addon (botón fuera del DOM), desmuteando lo que quede mutado.
  var timer = setInterval(function () {
    var btn = document.getElementById('adt-' + ID);
    if (!btn) { clearInterval(timer); apagar(); return; }
    if (!activo) return;
    var wv = naviris.activeWebview();
    if (wv && esSpotify(wv)) armar(wv);
  }, 1500);
})();

/* Naviris addon: Watch Party v2.8.0
   Ver video a la vez con amigos en Crunchyroll, Netflix, Disney+, YouTube y
   MOOVIN (moovin.live).
   NO transmite video: cada quien reproduce su propia copia con su propia
   cuenta; solo se sincronizan las señales de control (play/pausa/seek) y un
   chat, vía el relay de Cloudflare.

   Arquitectura: herramienta del sidebar (kind "tool", corre en el renderer).
   El botón se ilumina con el color del sitio de la pestaña activa y abre un
   panel lateral acoplado (estilo Teleparty) con sala, chat y estado. En la
   página solo se inyecta un agente mínimo que controla el <video> y avisa de
   los eventos por console-message. En YouTube se usa su API de reproductor
   (playVideo/pauseVideo/seekTo) y los anuncios se detectan para no
   sincronizar con el tiempo del anuncio.

   Anfitrión-autoritativo: quien crea la sala late con su tiempo cada 2 s; los
   demás corrigen si se desvían más de 1,5 s. El invitado navega solo al video
   del anfitrión; el chat narra cada acción; y el anfitrión decide quién
   controla la reproducción y quién puede cambiar el video.

   Habla el MISMO protocolo que el Watch Party integrado en MOOVIN (join / ev /
   beat / chat): una sala creada allí y una creada aquí son intercambiables.
   La identidad de un video de MOOVIN es su ?v= (iris:<url>); la página vacía
   es iris:moovin. Esos identificadores son protocolo compartido: no cambiar.

   v2.8.0 (2026-09-09): revisión completa tras "no le carga nada".
   - Se puede entrar a una sala DESDE CUALQUIER PESTAÑA, el hub incluido: el
     addon abre solo el video del anfitrión (antes el botón de unirse estaba
     apagado si no estabas ya en un sitio soportado, así que un invitado que
     entraba desde el hub con el código de una sala de MOOVIN no iba a ningún
     lado). Crear una sala sigue pidiendo tener el video delante.
   - Se navega UNA vez por destino. Si la pestaña no aterriza en el video
     (Netflix sin sesión manda a /title/, perfil sin elegir, título que no
     existe en tu país) antes se volvía a cargar cada 15 s, sin tregua: no
     había forma de iniciar sesión ni de elegir perfil. Ahora avisa y deja un
     botón para volver a intentarlo cuando estés listo.
   - Play, pausa y salto solo se aplican si estás en el MISMO video que el
     anfitrión; antes el latido tocaba cualquier <video> de la página (el
     tráiler del catálogo, la previsualización de YouTube).
   - Las URL que viajan son canónicas (Netflix sin trackId/tctx del anfitrión)
     y NINGUNA URL que llega de la sala se carga sin comprobar que es https y
     de un sitio soportado: el relay reenvía lo que le manden.
   - Sesión (`sid`) en el join: al reconectar, el relay cierra el socket viejo
     en silencio, y el chat dice "volvió a conectarse" en vez de "se unió",
     sin el "3 personas" con dos en la sala ni el "salió" fantasma después.
   - En MOOVIN, cambiar de capítulo ya no recarga la página del invitado: se
     le pide a la propia página (__moovinAbre) y solo si no está se recarga.
   - Corregido: tras seguir un cambio de video remoto, el siguiente cambio
     propio se tragaba (un flag que se quedaba puesto).
   v2.7.x: MOOVIN con dominio propio; caras en la sala (avatar del elenco y
   foto de la cuenta de Naviris, que viaja una vez al entrar); el relay marca
   `host` al reenviar para que el candado de video funcione; reconexión con
   espera creciente.
   Requiere Naviris 2.8.0+ (unirse desde el hub usa naviris.abrePestana, de la
   2.7.6-dev.5; el CSP anterior a 2.7.3-dev.12 vetaba la conexión).
*/
(function () {
  var SERVER = localStorage.__navPartyServer || 'wss://naviris-party.studio-iris2026.workers.dev';
  var DRIFT = 1.5;      // segundos de desvío tolerado antes de re-seek
  var ECHO_MS = 900;    // ventana ignorando eventos locales tras aplicar un remoto
  var ID = 'watch-party';
  var BTN_ID = 'adt-' + ID;

  /* ---------- Agente que se inyecta en la página (mundo de la página) ---------- */
  var AGENT = '(function(){' +
    'if(window.__navPartyAgent)return;window.__navPartyAgent=1;var mute=0;' +
    // YouTube tiene varios <video> (miniaturas, previsualizaciones): el bueno es
    // el del reproductor principal. Se prefiere ese y se cae al primero que haya.
    'function vid(){var v=document.querySelector("#movie_player video, .html5-video-player video");' +
    'if(v)return v;var all=document.querySelectorAll("video");' +
    'for(var i=0;i<all.length;i++){var r=all[i].getBoundingClientRect();if(r.width>200&&r.height>100)return all[i]}' +
    'return all[0]||null}' +
    'var isNf=/netflix\\./.test(location.hostname),nfP=null;' +
    'var isYt=/youtube\\.|youtu\\.be/.test(location.hostname);' +
    // En YouTube manda la API del reproductor: play/pause/seek por el <video> a
    // secas se pelean con su controlador y a veces no "prenden".
    'function yt(){try{var p=document.getElementById("movie_player");return p&&p.playVideo?p:null}catch(e){return null}}' +
    // Los anuncios de YouTube corren en el MISMO <video>: si sincronizas durante
    // uno, el tiempo no es el del video real. Se detecta y se ignora el latido.
    'function ytAnuncio(){try{var p=document.querySelector(".html5-video-player");return !!(p&&p.classList.contains("ad-showing"))}catch(e){return false}}' +
    'function nf(){try{if(nfP)return nfP;var api=window.netflix&&netflix.appContext&&netflix.appContext.state.playerApp.getAPI().videoPlayer;if(!api)return null;var ids=api.getAllPlayerSessionIds()||[];var sid=null;for(var i=0;i<ids.length;i++)if(/watch/.test(ids[i]))sid=ids[i];sid=sid||ids[0];nfP=sid?api.getVideoPlayerBySessionId(sid):null;return nfP}catch(e){return null}}' +
    'function doPlay(){if(isNf){var p=nf();if(p){try{p.play();return}catch(e){}}}' +
    'if(isYt){var y=yt();if(y){try{y.playVideo();return}catch(e){}}}' +
    'var v=vid();if(v)v.play().catch(function(){})}' +
    'function doPause(){if(isNf){var p=nf();if(p){try{p.pause();return}catch(e){}}}' +
    'if(isYt){var y=yt();if(y){try{y.pauseVideo();return}catch(e){}}}' +
    'var v=vid();if(v)v.pause()}' +
    'function doSeek(t){if(isNf){var p=nf();if(p){try{p.seek(Math.round(t*1000));return}catch(e){}}}' +
    'if(isYt){var y=yt();if(y){try{y.seekTo(t,true);return}catch(e){}}}' +
    'var v=vid();if(v)v.currentTime=t}' +
    // has:false durante un anuncio de YouTube (nadie se sincroniza con el tiempo
    // del anuncio) y también con un <video> SIN fuente (MOOVIN antes de elegir
    // película): un latido con tiempo 0 de un reproductor vacío pausaba a todos.
    'window.__navPartyState=function(){var v=vid();var ad=isYt&&ytAnuncio();var src=!!v&&(v.readyState>0||!!v.currentSrc);' +
    'return{time:v?v.currentTime:0,paused:v?v.paused:true,has:src&&!ad,ad:!!ad}};' +
    'window.__navPartyApply=function(m){mute=Date.now()+' + ECHO_MS + ';var st=window.__navPartyState();' +
    'if(m.kind==="seek")doSeek(m.time);' +
    'else if(m.kind==="play"){if(typeof m.time==="number"&&Math.abs(st.time-m.time)>' + DRIFT + ')doSeek(m.time);doPlay()}' +
    'else if(m.kind==="pause"){doPause();if(typeof m.time==="number")doSeek(m.time)}};' +
    'window.__navPartyBeat=function(m){if(Date.now()<mute)return;var st=window.__navPartyState();if(!st.has)return;' +
    'if(m.paused&&!st.paused){mute=Date.now()+' + ECHO_MS + ';doPause()}' +
    'else if(!m.paused&&st.paused){mute=Date.now()+' + ECHO_MS + ';doPlay()}' +
    'if(typeof m.time==="number"&&Math.abs(st.time-m.time)>' + DRIFT + '){mute=Date.now()+' + ECHO_MS + ';doSeek(m.time)}};' +
    // MOOVIN: cambiar de película sin recargar la página. Devuelve true si la
    // página ofrece el gancho (__moovinAbre, desde 2026-09-09) y se usó.
    'window.__navPartyAbre=function(v){try{if(typeof window.__moovinAbre==="function"){window.__moovinAbre(v);return true}}catch(e){}return false};' +
    'var wired=null,last={k:"",at:0};' +
    'function emit(kind){return function(){if(Date.now()<mute)return;' +
    'if(isYt&&ytAnuncio())return;' + // los play/pause del anuncio no son tuyos: no difundir
    'var now=Date.now();if(last.k===kind&&now-last.at<1200)return;last={k:kind,at:now};' + // dedup de eventos repetidos (stalls del player)
    'console.log("NAVPARTY|"+JSON.stringify({kind:kind,time:(vid()||{currentTime:0}).currentTime}))}}' +
    // "seeking" y no "seeked": es inmediato (los saltos remotos caen SIEMPRE dentro
    // del mute, sin eco aunque el buffering DRM tarde) y Crunchyroll no dispara
    // "seeked" de forma fiable en saltos programáticos.
    'function wire(){var v=vid();if(!v||v===wired)return;wired=v;v.addEventListener("play",emit("play"));v.addEventListener("pause",emit("pause"));v.addEventListener("seeking",emit("seek"))}' +
    'var iv=setInterval(wire,1500);wire();' +
    'window.__navPartyStop=function(){clearInterval(iv);wired=null;window.__navPartyAgent=0};' +
    '})();';

  /* ---------- Estilos (panel propio acoplado; tokens del core con fallback) ---------- */
  var css = document.createElement('style');
  css.id = 'nvp-style';
  css.textContent = [
    /* Botón del sidebar: SOLO cambia de color por sitio reconocido */
    '#' + BTN_ID + '.nvp-netflix{color:#e50914}',
    '#' + BTN_ID + '.nvp-crunchy{color:#f47521}',
    '#' + BTN_ID + '.nvp-disney{color:#3aa0ff}',
    '#' + BTN_ID + '.nvp-youtube{color:#ff4444}',
    '#' + BTN_ID + '.nvp-iris{color:#dc402a}',
    '#' + BTN_ID + '{position:relative}',
    '#' + BTN_ID + '.nvp-live::after{content:"";position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:#9ee2b8}',
    '#' + BTN_ID + '.nvp-live:not(.nvp-netflix):not(.nvp-crunchy):not(.nvp-disney):not(.nvp-youtube):not(.nvp-iris){color:#9ee2b8}',
    /* Panel: columna acoplada al borde derecho, altura completa (el contenido
       se encoge; nada queda tapado, como la barra de Teleparty) */
    '#nvp-panel{flex:0 0 302px;width:302px;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--bg-2,#121217);border-left:1px solid var(--line,#26262d);overflow:hidden;transition:flex-basis .45s cubic-bezier(.3,1.22,.4,1),width .45s cubic-bezier(.3,1.22,.4,1),border-left-width .45s ease}',
    '#nvp-panel.nvp-plegado{flex-basis:0!important;width:0!important;border-left-width:0!important}',
    /* El contenido se maqueta UNA VEZ al ancho final y anclado a la derecha:
       el pliegue solo lo recorta (overflow hidden) — sin remaquetado del texto
       durante la animación. */
    '#nvp-panel{align-items:flex-end}',
    '#nvp-panel>*{width:301px;flex-shrink:0}',
    '#nvp-panel.hidden{display:none!important}',
    '.nvp-head{display:flex;align-items:center;gap:8px;padding:13px 14px;border-bottom:1px solid var(--line,#26262d);flex:none}',
    '.nvp-head .ico{display:inline-flex;width:16px;height:16px;color:var(--violet,#b98cff)}',
    '.nvp-head .ico svg{width:16px;height:16px}',
    '.nvp-head .t{font-size:13.5px;font-weight:700;color:var(--text,#ececef)}',
    '.nvp-x{margin-left:auto;border:none;background:none;color:var(--muted,#8b8d94);cursor:pointer;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px}',
    '.nvp-x:hover{background:rgba(128,128,140,.14);color:var(--text,#ececef)}',
    '.nvp-x svg{width:14px;height:14px}',
    '#nvp-body{flex:1;display:flex;flex-direction:column;min-height:0}',
    /* Formulario (fuera de sala) */
    '.nvp-setup{padding:14px 16px 18px;overflow-y:auto}',
    '.nvp-lbl{margin:16px 2px 8px;font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--dim,#5c5e64)}',
    '.nvp-lbl:first-child{margin-top:2px}',
    '.nvp-hint{font-size:12.5px;color:var(--muted,#8b8d94);line-height:1.6;margin:2px 2px 6px}',
    '.nvp-row{display:flex;gap:8px}',
    '.nvp-in{flex:1;min-width:0;background:var(--bg,#0a0a0c);color:var(--text,#ececef);border:1px solid var(--line-2,#2c2c33);border-radius:10px;padding:11px 13px;font-size:13px;outline:none;transition:border-color .12s}',
    '.nvp-in:focus{border-color:var(--violet,#b98cff)}',
    '.nvp-in::placeholder{color:var(--dim,#5c5e64)}',
    '.nvp-in.code{text-transform:uppercase;font-family:var(--mono,ui-monospace,monospace);letter-spacing:3px;font-weight:700}',
    '.nvp-cta{width:100%;margin-top:14px;border:none;border-radius:10px;padding:12px 16px;font-size:13px;font-weight:700;cursor:pointer;background:var(--violet,#b98cff);color:var(--bg,#0a0a0c);transition:filter .12s}',
    '.nvp-cta:hover{filter:brightness(1.08)}',
    '.nvp-cta:disabled{background:var(--line-2,#2c2c33);color:var(--dim,#5c5e64);cursor:default;filter:none}',
    '.nvp-btn{border:none;border-radius:10px;padding:11px 14px;font-size:12.5px;font-weight:700;cursor:pointer;background:rgba(128,128,140,.14);color:var(--text,#ececef);flex:0 0 auto;transition:background .12s}',
    '.nvp-btn:hover{background:rgba(128,128,140,.24)}',
    '.nvp-btn:disabled{color:var(--dim,#5c5e64);cursor:default;background:rgba(128,128,140,.07)}',
    /* Cabecera de sala */
    '.nvp-room{padding:12px 14px;border-bottom:1px solid var(--line,#26262d);flex:none}',
    '.nvp-coderow{display:flex;align-items:center;gap:8px}',
    '.nvp-code{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:none;border:1px dashed var(--line-2,#2c2c33);border-radius:9px;cursor:pointer;font-family:var(--mono,ui-monospace,monospace);font-size:17px;font-weight:800;letter-spacing:6px;color:var(--text,#ececef);transition:background .12s,border-color .12s}',
    '.nvp-code:hover{background:rgba(128,128,140,.1);border-color:var(--muted,#8b8d94)}',
    '.nvp-code svg{width:13px;height:13px;color:var(--muted,#8b8d94);letter-spacing:0}',
    '.nvp-leave{margin-left:auto;border:none;background:none;color:#e6a9b4;font-size:11.5px;font-weight:700;cursor:pointer;padding:6px 8px;border-radius:8px}',
    '.nvp-leave:hover{background:rgba(230,169,180,.1)}',
    '.nvp-status{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11.5px;color:var(--muted,#8b8d94)}',
    '.nvp-status .dot{width:7px;height:7px;border-radius:50%;background:#9ee2b8;flex:none}',
    '.nvp-status.err{color:#e6a9b4}',
    '.nvp-status.err .dot{background:#e6a9b4}',
    '.nvp-watch{margin-top:7px;font-size:11.5px;color:var(--dim,#5c5e64);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    /* Fuera de sintonía: el invitado no está en el video del anfitrión */
    '.nvp-ir{display:none;width:100%;margin-top:9px;border:1px solid var(--violet,#b98cff);background:none;color:var(--violet,#b98cff);border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;transition:background .12s}',
    '.nvp-ir:hover{background:rgba(185,140,255,.12)}',
    '.nvp-ir.visible{display:block}',
    '.nvp-lock{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11.8px;color:var(--muted,#8b8d94);cursor:pointer;user-select:none}',
    '.nvp-lock:hover{color:var(--text,#ececef)}',
    '.nvp-lock input{accent-color:var(--violet,#b98cff);margin:0}',
    /* Chat: ocupa todo el alto; mensajes con avatar (estilo Teleparty) */
    '.nvp-chat{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:11px}',
    '.nvp-msg{display:flex;gap:9px;align-items:flex-start}',
    '.nvp-av{width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:rgba(10,10,14,.78);overflow:hidden}',
    '.nvp-av img{width:100%;height:100%;object-fit:cover;display:block}',
    '.nvp-mb{min-width:0;flex:1;padding-top:1px}',
    '.nvp-who{font-size:12.5px;font-weight:700;color:var(--text,#ececef);line-height:1.4}',
    '.nvp-act{font-size:12px;font-style:italic;color:var(--muted,#8b8d94);line-height:1.5}',
    '.nvp-tx{font-size:12.8px;color:var(--text,#ececef);line-height:1.55;word-wrap:break-word;padding:1px 0}',
    '.nvp-sys{display:flex;align-items:center;gap:8px;color:var(--dim,#5c5e64);font-size:11px;line-height:1.5}',
    '.nvp-sys::before,.nvp-sys::after{content:"";flex:1;height:1px;background:var(--line,#26262d)}',
    '.nvp-sys span{flex:0 1 auto;text-align:center}',
    '.nvp-empty{margin:auto;text-align:center;color:var(--dim,#5c5e64);font-size:12px;line-height:1.7;padding:0 18px}',
    /* Entrada de mensaje fija abajo */
    '.nvp-compose{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line,#26262d);flex:none}',
    '.nvp-compose .nvp-in{border-radius:999px;padding:10px 15px}',
    '.nvp-send{flex:none;width:38px;height:38px;border:none;border-radius:50%;cursor:pointer;background:var(--violet,#b98cff);color:var(--bg,#0a0a0c);display:flex;align-items:center;justify-content:center;transition:filter .12s}',
    '.nvp-send:hover{filter:brightness(1.08)}',
    '.nvp-send svg{width:15px;height:15px}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- Caras de la sala ----------
     Avatares del elenco de MOOVIN: la página manda el suyo en el campo `av`
     de cada mensaje. La lista es CERRADA a propósito: el `av` viene de otra
     persona de la sala, y con una lista fija nunca se compone una URL con un
     valor ajeno. Los SVG son públicos (moovin.live/avatares/<id>.svg). */
  var AVATARES = ['aria', 'pj1', 'pj2', 'pj3', 'pj4', 'pj5', 'pj6', 'pj7', 'pj8', 'pj9', 'pj10', 'pj11'];
  var avs = {};     // nombre -> id de avatar del elenco
  var fotos = {};   // nombre -> foto propia, la que manda cada quien al entrar

  /* La foto y el nombre de TU cuenta de Naviris. Los addons de herramienta
     corren dentro del hub, así que se leen de su localStorage tal cual: la
     foto ya está reducida a 128x128 y guardada como data URI. */
  function miCuenta() {
    try {
      var foto = JSON.parse(localStorage.getItem('cobalt.account.foto') || 'null');
      var nombre = JSON.parse(localStorage.getItem('cobalt.account.nombre') || 'null');
      return { foto: fotoValida(foto) ? foto : '', nombre: (nombre || '').trim() };
    } catch (e) { return { foto: '', nombre: '' }; }
  }
  /* Una foto que llega de OTRA persona solo se pinta si es un mapa de bits en
     data URI. Nada de SVG (puede traer script) ni de URLs de fuera, y con
     tope de tamaño. */
  function fotoValida(f) {
    return typeof f === 'string' && f.length < 200000
      && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(f);
  }
  function apuntaFoto(who, f) { if (who && fotoValida(f)) fotos[who] = f; }
  function apuntaAv(who, av) { if (who && AVATARES.indexOf(av) !== -1) avs[who] = av; }
  function nameColor(name) {
    var h = 0; for (var i = 0; i < (name || '?').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 55%, 72%)';
  }

  /* ---------- Panel acoplado (columna propia en #app-row) ---------- */
  var panel = document.createElement('aside');
  panel.id = 'nvp-panel';
  panel.className = 'hidden';
  panel.innerHTML =
    '<div class="nvp-head"><span class="ico" id="nvp-ico"></span><span class="t">Watch Party</span>' +
    '<button id="nvp-close" class="nvp-x" title="Cerrar"></button></div>' +
    '<div id="nvp-body"></div>';
  var appRow = document.getElementById('app-row');
  if (appRow) appRow.appendChild(panel);
  else { panel.style.cssText = 'position:fixed;right:0;top:0;bottom:0;z-index:500'; document.body.appendChild(panel); }

  // Iconos propios inline para no depender del core.
  var ICON_EYE = '<svg viewBox="0 0 16 16" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 8L3.07945 4.30466C4.29638 2.84434 6.09909 2 8 2C9.90091 2 11.7036 2.84434 12.9206 4.30466L16 8L12.9206 11.6953C11.7036 13.1557 9.90091 14 8 14C6.09909 14 4.29638 13.1557 3.07945 11.6953L0 8ZM8 11C9.65685 11 11 9.65685 11 8C11 6.34315 9.65685 5 8 5C6.34315 5 5 6.34315 5 8C5 9.65685 6.34315 11 8 11Z" fill="currentColor"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg>';
  var ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z"/></svg>';
  panel.querySelector('#nvp-ico').innerHTML = ICON_EYE;
  panel.querySelector('#nvp-close').innerHTML = ICON_X;

  /* ---------- Sitios e identidad del video ---------- */
  var SITIOS = { netflix: 'Netflix', crunchy: 'Crunchyroll', disney: 'Disney+', youtube: 'YouTube', iris: 'MOOVIN' };
  var LISTA_SITIOS = 'Crunchyroll, Netflix, Disney+, YouTube o MOOVIN';
  function siteOf(url) {
    var h = '', p = ''; try { var u = new URL(url); h = u.hostname; p = u.pathname; } catch (e) { return null; }
    if (/(^|\.)netflix\.com$/.test(h)) return 'netflix';
    if (/(^|\.)crunchyroll\.com$/.test(h)) return 'crunchy';
    if (/(^|\.)disneyplus\.com$/.test(h)) return 'disney';
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
    // MOOVIN: en moovin.live es todo el dominio; en iris.it.com (que sigue vivo
    // por la tele) solo la ruta /moovin, el resto del estudio no reproduce.
    if (/(^|\.)moovin\.live$/.test(h)) return 'iris';
    if (/(^|\.)iris\.it\.com$/.test(h) && /^\/moovin(\/|$)/.test(p)) return 'iris';
    return null;
  }
  // Identidad del episodio (para saber si dos URLs son "el mismo capítulo"
  // aunque cambien locale, slug o parámetros de seguimiento).
  function epIdOf(url) {
    var m = /crunchyroll\.com\/(?:[a-z-]+\/)?watch\/([A-Z0-9]+)/i.exec(url || '');
    if (m) return 'cr:' + m[1].toUpperCase();
    m = /netflix\.com\/watch\/(\d+)/i.exec(url || '');
    if (m) return 'nf:' + m[1];
    // Disney+: /video/<uuid> (y /play/<uuid> en algunos flujos)
    m = /disneyplus\.com\/(?:[a-z-]+\/)?(?:video|play)\/([a-f0-9-]{8,})/i.exec(url || '');
    if (m) return 'dp:' + m[1].toLowerCase();
    // YouTube: watch?v=ID, youtu.be/ID, /live/ID, /embed/ID, /shorts/ID
    m = /[?&]v=([\w-]{6,})/.exec(url || '');
    if (m && /youtube\.com|youtu\.be/.test(url)) return 'yt:' + m[1];
    m = /(?:youtu\.be|youtube\.com\/(?:live|embed|shorts))\/([\w-]{6,})/i.exec(url || '');
    if (m) return 'yt:' + m[1];
    // MOOVIN: la película es el parámetro ?v= (URL del video). Sin él, la
    // página vacía cuenta como "el mismo sitio" para no forzar navegación
    // cuando el anfitrión reproduce un archivo local.
    m = /(?:moovin\.live|iris\.it\.com\/moovin)[^#]*[?&]v=([^&#]+)/i.exec(url || '');
    if (m) { try { return 'iris:' + decodeURIComponent(m[1]); } catch (e) { return 'iris:' + m[1]; } }
    if (/moovin\.live(\/|$|\?)|iris\.it\.com\/moovin(\/|$|\?)/i.test(url || '')) return 'iris:moovin';
    return null;
  }
  /* La URL que se manda a la sala, limpia. La de Netflix lleva trackId y tctx
     (el contexto de navegación del anfitrión) y la de YouTube la lista o el
     origen; nada de eso es el video, y al invitado solo le sirve el video. */
  function canonUrl(url) {
    var ep = epIdOf(url); if (!ep) return url;
    var id = ep.slice(3);
    if (ep.indexOf('nf:') === 0) return 'https://www.netflix.com/watch/' + id;
    if (ep.indexOf('yt:') === 0) return 'https://www.youtube.com/watch?v=' + id;
    if (ep.indexOf('cr:') === 0 || ep.indexOf('dp:') === 0) return url.split(/[?#]/)[0];
    return url;   // MOOVIN: origen + ruta + ?v= ya es la forma canónica
  }
  /* Lo que llega de la sala lo ha mandado otra persona y el relay lo reenvía
     tal cual: solo se carga una URL https de un sitio soportado. */
  function urlSegura(u) {
    try { return typeof u === 'string' && new URL(u).protocol === 'https:' && !!siteOf(u); } catch (e) { return false; }
  }
  function tituloLimpio(t) { return String(t || '').replace(/ - Crunchyroll.*$| - Netflix.*$| - YouTube$| — MOOVIN$/i, ''); }
  function fmtT(s) {
    if (typeof s !== 'number' || !isFinite(s)) return '';
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60);
    if (ss.length < 2) ss = '0' + ss;
    if (h) { var mm = String(m); if (mm.length < 2) mm = '0' + mm; return h + ':' + mm + ':' + ss; }
    return m + ':' + ss;
  }
  function activeSite() {
    var wv = naviris.activeWebview(); if (!wv) return null;
    try { return siteOf(wv.getURL()); } catch (e) { return null; }
  }

  /* ---------- Estado ---------- */
  var party = null;      // ver start()
  var beatTimer = null;

  function wvUrl() { try { return party && party.wv ? party.wv.getURL() : ''; } catch (e) { return ''; } }
  function wvTitulo() { try { return party && party.wv ? (party.wv.getTitle() || '') : ''; } catch (e) { return ''; } }
  /* ¿Estás en el mismo video que el anfitrión? Mientras no lo estés, su play,
     pausa y salto no se aplican: antes le llegaban a cualquier <video> de la
     página (el tráiler del catálogo, la previsualización de YouTube). El
     anfitrión siempre está en sintonía consigo mismo. */
  function enSintonia() {
    if (!party || party.host) return true;
    var want = epIdOf(party.hostUrl); if (!want) return true;
    return epIdOf(wvUrl()) === want;
  }
  function send(obj) { try { if (party && party.ws && party.ws.readyState === 1) party.ws.send(JSON.stringify(obj)); } catch (e) { /* nada */ } }
  function pushMsg(m) { if (!party) return; party.msgs.push(m); if (party.msgs.length > 200) { party.msgs.shift(); ui.pintados = Math.max(0, (ui.pintados || 0) - 1); } render(); }
  // Aviso de sala (línea divisoria, sin persona): estados, permisos…
  function logSys(text) { pushMsg({ text: text, sys: true, t: Date.now() }); }
  // Acción de una persona (cursiva junto a su avatar): "puso play", "se unió"…
  function logAct(who, text) { pushMsg({ who: who || '?', text: text, act: true, t: Date.now() }); }
  function logChat(who, text) { pushMsg({ who: who, text: text, t: Date.now() }); }
  // Narración filtrada: sin duplicados seguidos y sin los pausa/play espurios
  // que el reproductor dispara al bufferizar justo después de un salto.
  var narr = { kind: '', at: 0 };
  function narrate(kind, who, time) {
    var now = Date.now();
    if ((kind === 'play' || kind === 'pause') && narr.kind === 'seek' && now - narr.at < 2500) return;
    if (narr.kind === kind && now - narr.at < 1500) return;
    narr = { kind: kind, at: now };
    logAct(who, kind === 'play' ? 'puso play' : kind === 'pause' ? 'pausó en ' + fmtT(time) : 'saltó a ' + fmtT(time));
  }
  function inject(wv) { try { wv.executeJavaScript(AGENT).catch(function () {}); } catch (e) { /* nada */ } }

  /* ---------- La pestaña de la sala ----------
     El invitado puede entrar sin pestaña (desde el hub): la sala se ata a la
     pestaña en cuanto hay que abrir el video del anfitrión. */
  function enlaza(wv) {
    if (!party || !wv || party.wv === wv) return;
    desenlaza();
    party.wv = wv;
    wv.addEventListener('console-message', onConsole);
    wv.addEventListener('did-navigate', onRenav);
    wv.addEventListener('did-navigate-in-page', onRenav);
    wv.addEventListener('dom-ready', onRenav);
    wv.addEventListener('destroyed', onGone);
    party.ultimoEp = epIdOf(wvUrl());
    inject(wv);
  }
  function desenlaza() {
    var wv = party && party.wv; if (!wv) return;
    try {
      wv.removeEventListener('console-message', onConsole);
      wv.removeEventListener('did-navigate', onRenav);
      wv.removeEventListener('did-navigate-in-page', onRenav);
      wv.removeEventListener('dom-ready', onRenav);
      wv.removeEventListener('destroyed', onGone);
    } catch (e) { /* nada */ }
    try { wv.executeJavaScript('window.__navPartyStop&&__navPartyStop()').catch(function () {}); } catch (e) { /* nada */ }
    party.wv = null;
  }
  /* Abre una URL de la sala en la pestaña de la sala; si no hay (se entró
     desde el hub), en una pestaña nueva que pasa a ser la de la sala. */
  function irA(url) {
    if (!party || !urlSegura(url)) return;
    if (party.wv) {
      // En MOOVIN se le pide a la propia página que cambie de película: sin
      // recargar, sin volver a pedir el pase ni el catálogo. Si la página no
      // trae el gancho (versión anterior), se recarga como siempre.
      var v = epIdOf(url), aqui = siteOf(wvUrl());
      if (aqui === 'iris' && v && v.indexOf('iris:') === 0 && v !== 'iris:moovin') {
        var wv = party.wv;
        try {
          wv.executeJavaScript('window.__navPartyAbre?__navPartyAbre(' + JSON.stringify(v.slice(5)) + '):false')
            .then(function (ok) { if (!ok && party && party.wv === wv) wv.loadURL(url); })
            .catch(function () { try { if (party && party.wv === wv) wv.loadURL(url); } catch (e) { /* nada */ } });
          return;
        } catch (e) { /* cae a loadURL */ }
      }
      try { party.wv.loadURL(url); } catch (e) { /* nada */ }
      return;
    }
    naviris.abrePestana(url, true);
    var intentos = 0;
    (function busca() {
      if (!party || party.wv) return;
      var wv = naviris.activeWebview();
      if (wv) { enlaza(wv); render(); glow(); return; }
      if (intentos++ < 20) setTimeout(busca, 100);
    })();
  }

  function onConsole(e) {
    if (!party || typeof e.message !== 'string' || e.message.indexOf('NAVPARTY|') !== 0) return;
    var m; try { m = JSON.parse(e.message.slice(9)); } catch (x) { return; }
    // Lo que hagas en OTRO video (mientras la pestaña no está en el del
    // anfitrión) es cosa tuya: no se difunde ni se narra.
    if (!enSintonia()) return;
    // Control exclusivo: las acciones de los invitados no se difunden (y el
    // siguiente latido del anfitrión las revierte). Aviso sin spamear.
    if (party.lock && !party.host) {
      if (Date.now() - (party.lockWarned || 0) > 5000) { party.lockWarned = Date.now(); logSys('Solo el anfitrión controla la reproducción'); }
      return;
    }
    send({ t: 'ev', kind: m.kind, time: m.time, at: Date.now() });
    narrate(m.kind, party.name, m.time);
  }
  function onRenav() {
    if (!party || !party.wv) return;
    inject(party.wv);
    // Cambio de video: si el anfitrión lo permite (o eres tú el anfitrión), al
    // abrir otro video se lleva a toda la sala. Con navLock activo, solo el
    // anfitrión puede; a los invitados el latido les devuelve al suyo.
    // `ultimoEp` ya se pone al SEGUIR un cambio remoto, así que ese no se
    // vuelve a difundir (antes había además un flag que se quedaba puesto y
    // se tragaba el siguiente cambio propio).
    var url = wvUrl();
    var ep = epIdOf(url);
    if (!ep || ep === party.ultimoEp) return;
    party.ultimoEp = ep;
    if (party.host || !party.navLock) {
      send({ t: 'ev', kind: 'nav', url: canonUrl(url), at: Date.now() });
      logAct(party.name, 'cambió el video de la sala');
    }
  }
  function onGone() { if (party) { leave(true); naviris.toast('Watch Party terminada: se cerró la pestaña'); } }

  function applyRemote(m) {
    if (!party) return;
    var who = m.from || 'Alguien';
    if (m.kind === 'nav') {
      // Sala cerrada: solo se sigue al anfitrión. `m.host` lo pone el servidor
      // al reenviar (del attachment del join), así que es de fiar.
      if (party.navLock && !m.host && !party.host) return;
      if (!urlSegura(m.url)) return;
      var want = epIdOf(m.url); if (!want) return;
      if (epIdOf(wvUrl()) === want) return;
      logAct(who, 'cambió el video de la sala');
      party.ultimoEp = want; party.objetivo = want; party.intento = Date.now(); marcaDesync(false);
      irA(m.url);
      return;
    }
    if (m.kind !== 'play' && m.kind !== 'pause' && m.kind !== 'seek') return;   // órdenes de otros clientes (el mando de MOOVIN)
    narrate(m.kind, who, m.time);
    if (!party.wv || !enSintonia()) return;
    try { party.wv.executeJavaScript('window.__navPartyApply&&__navPartyApply(' + JSON.stringify({ kind: m.kind, time: m.time }) + ')').catch(function () {}); } catch (e) { /* nada */ }
  }
  /* Invitados: seguir el video del anfitrión (su URL viaja en el latido).
     Se navega UNA vez por destino. Si la pestaña no aterriza en él (Netflix
     sin sesión manda a /title/, un perfil sin elegir, un título que no existe
     en tu país), se avisa y queda el botón para reintentar: antes se volvía a
     cargar cada 15 s y no había forma de iniciar sesión ni de elegir perfil. */
  function syncEpisode(url) {
    if (!party || party.host || !urlSegura(url)) return;
    var want = epIdOf(url); if (!want) return;
    if (epIdOf(wvUrl()) === want) { party.objetivo = want; marcaDesync(false); return; }
    if (party.objetivo === want) {
      if (!party.desync && Date.now() - (party.intento || 0) > 12000) {
        marcaDesync(true);
        logSys('No se pudo abrir el video del anfitrión. Inicia sesión o elige tu perfil y toca «Ir al video del anfitrión»');
      }
      return;
    }
    party.objetivo = want; party.intento = Date.now(); marcaDesync(false);
    logSys('Abriendo el video del anfitrión…');
    irA(url);
  }
  function marcaDesync(v) { if (party && party.desync !== v) { party.desync = v; render(); } }
  function applyBeat(m) {
    if (!party || !party.wv || !enSintonia()) return;
    try { party.wv.executeJavaScript('window.__navPartyBeat&&__navPartyBeat(' + JSON.stringify({ time: m.time, paused: !!m.paused }) + ')').catch(function () {}); } catch (e) { /* nada */ }
  }
  function beatStart() {
    beatStop();
    var tick = function () {
      if (!party || !party.wv) return;
      // La URL se lee FUERA del executeJavaScript: al cambiar de episodio el
      // mundo JS de la página se destruye y la promesa se rompe, que es
      // justo el latido que llevaba la URL nueva. Se manda igual, con el
      // tiempo si se pudo consultar y sin él si no.
      var base = { t: 'beat', url: canonUrl(wvUrl()), tit: tituloLimpio(wvTitulo()).slice(0, 120), lock: !!party.lock, nlock: !!party.navLock, at: Date.now() };
      var mandado = false;
      var manda = function (st) {
        if (mandado || !party) return;
        mandado = true;
        if (st && st.has) { base.time = st.time; base.paused = st.paused; }
        base.at = Date.now();
        send(base);
      };
      try {
        party.wv.executeJavaScript('window.__navPartyState?__navPartyState():null')
          .then(manda).catch(function () { manda(null); });
      } catch (e) { manda(null); }
    };
    tick();
    beatTimer = setInterval(tick, 2000);
  }
  function beatStop() { if (beatTimer) { clearInterval(beatTimer); beatTimer = null; } }
  function randomCode() { var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '', i; for (i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
  // Identificador de ESTA sesión en la sala: al reconectar, el relay cierra el
  // socket viejo con el mismo sid en silencio (sin "salió" fantasma ni contar
  // dos veces a la misma persona).
  function nuevoSid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function start(code, asHost) {
    var wv = naviris.activeWebview();
    // Crear una sala pide tener el video delante: es lo que va a ver la sala.
    // Unirse no: el video lo pone el anfitrión y se abre solo.
    if (asHost && (!wv || !activeSite())) { naviris.toast('Abre el video en ' + LISTA_SITIOS + ' y vuelve a intentarlo'); return; }
    leave(true);
    /* El nombre lo propone tu cuenta de Naviris, que es el que ya elegiste en
       el hub. Lo escrito a mano sigue mandando. */
    var name = (localStorage.__navPartyName || miCuenta().nombre
      || (asHost ? 'Anfitrión' : 'Invitado')).slice(0, 32);
    party = {
      code: code, host: asHost, wv: null, ws: null, sid: nuevoSid(),
      n: 1, status: 'Conectando…', ok: false, everOk: false, msgs: [], name: name,
      lock: false, navLock: true,          // por defecto SOLO el anfitrión cambia el video
      site: activeSite(), ultimoEp: null,
      hostUrl: '', hostTit: '',            // lo que ve el anfitrión (del latido)
      objetivo: null, intento: 0, desync: false
    };
    // El invitado se ata a la pestaña activa si es una página (aunque no sea
    // un sitio soportado: es la que va a navegar al video). Desde el hub no
    // hay pestaña: se abre una al llegar el primer latido.
    if (wv) enlaza(wv);

    /* El socket se abre aquí dentro para poder repetirlo: si se cae (el Durable
       Object se redespliega, el portátil se suspende, un bache de red) antes se
       quedaba la sala pintada con su código mientras ya no se sincronizaba
       nada, que por fuera se ve igual que "no me cambia el episodio". */
    var reintento = 0, reTimer = null;
    var miParty = party;
    function abreSocket() {
      if (party !== miParty) return;
      var ws;
      try { ws = new WebSocket(SERVER); } catch (e) {
        // El CSP del renderer puede vetar la conexión (Naviris < 2.7.3-dev.12).
        party.status = 'Sin conexión con el servidor. Actualiza Naviris.';
        naviris.toast('Watch Party no puede conectar: actualiza Naviris');
        render(); glow(); return;
      }
      party.ws = ws;
      ws.onopen = function () {
        var volvia = reintento > 0;
        reintento = 0;
        /* La foto va UNA vez, aquí. En cada mensaje serían kilobytes por
           latido: el resto del protocolo se queda como estaba. */
        var yo = miCuenta();
        var join = { t: 'join', room: code, name: name, host: asHost, sid: party.sid };
        if (volvia) join.again = true;
        if (yo.foto) join.foto = yo.foto;
        send(join);
      };
      ws.onmessage = function (ev) {
        if (!party || party.ws !== ws) return;
        var m; try { m = JSON.parse(ev.data); } catch (x) { return; }
        // El avatar viaja en TODO mensaje (join/ev/beat/chat), así que se
        // aprende de cualquiera de ellos; la foto solo al entrar (pesa).
        var quien = m.who || m.from;
        if (quien && m.av) apuntaAv(quien, m.av);
        if (quien && m.foto) apuntaFoto(quien, m.foto);
        if (m.t === 'joined') {
          var volvia = party.everOk;
          party.ok = true; party.everOk = true; party.n = m.n; party.status = 'En la sala';
          if (volvia) logSys('Conexión recuperada');
          else {
            logAct(party.name, asHost ? 'creó la sala' : 'se unió a la sala');
            logSys(asHost ? 'Toca el código para copiarlo y compartirlo' : 'El anfitrión marca el ritmo');
          }
          if (asHost) beatStart();
        }
        else if (m.t === 'peers') {
          party.n = m.n;
          if (m.joined && m.who) logAct(m.who, m.again ? 'volvió a conectarse' : 'se unió a la sala');
          else if (m.left && m.who) logAct(m.who, 'salió de la sala');
        }
        else if (m.t === 'ev') applyRemote(m);
        else if (m.t === 'beat') {
          if (!party.host) {
            var hadLock = !!party.lock; party.lock = !!m.lock;
            if (party.lock !== hadLock) logSys(party.lock ? 'El anfitrión activó el control exclusivo' : 'El anfitrión desactivó el control exclusivo');
            var hadNav = !!party.navLock; party.navLock = m.nlock !== false;
            if (party.navLock !== hadNav) logSys(party.navLock ? 'Ahora solo el anfitrión puede cambiar el video' : 'Ahora cualquiera puede cambiar el video');
            if (urlSegura(m.url)) party.hostUrl = m.url;
            party.hostTit = typeof m.tit === 'string' ? m.tit.slice(0, 120) : '';
            // Al entrar se va SIEMPRE a lo que ve el anfitrión. Después, con la
            // sala cerrada el latido te devuelve a su video; abierta, el video
            // lo manda quien lo haya cambiado (llega como `nav`).
            if (party.navLock || !party.objetivo) syncEpisode(m.url);
            if (typeof m.time === 'number') applyBeat(m);
          }
        }
        else if (m.t === 'chat') logChat(m.from || '?', String(m.msg || ''));
        else if (m.t === 'error') party.status = 'Error: ' + m.msg;
        render(); glow();
      };
      // Si NUNCA llegó a conectar, casi seguro es el CSP de un Naviris viejo
      // (2.7.3-dev.3 a dev.11) vetando el WebSocket: se pide actualizar.
      ws.onclose = function () {
        if (!party || party.ws !== ws) return;
        party.ok = false; beatStop();
        if (!party.everOk) { party.status = 'Sin conexión · actualiza Naviris (Acerca de → NavirisDev)'; render(); return; }
        // Ya había conectado alguna vez: es un corte, se vuelve a entrar sola.
        reintento++;
        var espera = Math.min(30000, 1000 * Math.pow(2, reintento - 1));
        party.status = 'Reconectando…';
        if (reTimer) clearTimeout(reTimer);
        reTimer = setTimeout(function () { reTimer = null; abreSocket(); }, espera);
        render();
      };
      ws.onerror = function () { if (party && party.ws === ws) { party.ok = false; party.status = party.everOk ? 'Sin conexión con el servidor' : 'Sin conexión · actualiza Naviris (Acerca de → NavirisDev)'; render(); } };
      render(); glow();
    }
    party.paraReconexion = function () { if (reTimer) { clearTimeout(reTimer); reTimer = null; } };
    abreSocket();
  }
  function leave(silent) {
    if (!party) return;
    beatStop();
    try { party.paraReconexion && party.paraReconexion(); } catch (e) { /* nada */ }
    desenlaza();
    try { party.ws && party.ws.close(); } catch (e) { /* nada */ }
    party = null;
    if (!silent) naviris.toast('Saliste de la sala');
    render(); glow();
  }

  /* ---------- Render del panel ----------
     La estructura se construye SOLO al cambiar de modo (dentro/fuera de sala)
     y lo demás se actualiza en su sitio, sin recrear inputs ni botones (si se
     recrean, el chat pierde el foco y los clics a medias se pierden). */
  var body = panel.querySelector('#nvp-body');
  var ui = {}, modoActual = null;

  function render(force) {
    if (panel.classList.contains('hidden')) return;
    var modo = party ? 'dentro' : 'fuera';
    if (modo === modoActual && !force) { actualizar(); return; }
    modoActual = modo; ui = {};
    construir();
    actualizar();
  }
  // Refresca solo los datos: nada de recrear inputs ni botones.
  function actualizar() {
    var site = activeSite();
    if (modoActual === 'fuera') {
      if (ui.hint) ui.hint.textContent = site
        ? 'Listo: la sala usará ' + (SITIOS[site] || '') + ' en esta pestaña. Crea una sala y comparte el código, o únete con uno.'
        : 'Para crear una sala, abre el video en ' + LISTA_SITIOS + ' (el botón se ilumina con el color del sitio). Para unirte basta el código: la pestaña saltará sola a lo que vea el anfitrión.';
      if (ui.crear) ui.crear.disabled = !site;
      return;
    }
    if (!party) return;
    if (ui.code) ui.code.firstChild.textContent = party.code;
    if (ui.estado) {
      ui.estado.parentNode.className = 'nvp-status' + (party.ok ? '' : ' err');
      ui.estado.textContent = party.n + (party.n === 1 ? ' persona' : ' personas')
        + ' · ' + (party.host ? 'eres el anfitrión' : 'invitado') + ' · ' + party.status;
    }
    if (ui.viendo) {
      var texto = '';
      if (party.wv && enSintonia()) { var t = tituloLimpio(wvTitulo() || wvUrl()); if (t) texto = 'Viendo: ' + t; }
      else if (party.hostTit || party.hostUrl) texto = 'El anfitrión ve: ' + (party.hostTit || party.hostUrl);
      ui.viendo.textContent = texto;
      ui.viendo.style.display = texto ? '' : 'none';
    }
    if (ui.ir) ui.ir.classList.toggle('visible', !!party.desync && !!party.hostUrl);
    if (ui.lock && ui.lock.checked !== !!party.lock) ui.lock.checked = !!party.lock;
    if (ui.navLock && ui.navLock.checked !== !!party.navLock) ui.navLock.checked = !!party.navLock;
    pintarChat();
  }
  function avatar(who) {
    var av = document.createElement('span'); av.className = 'nvp-av';
    /* La foto manda: la tuya sale de tu cuenta de Naviris y la de los demás
       de lo que mandaron al entrar. Después el avatar del elenco de MOOVIN,
       y en último lugar la inicial de siempre. */
    var foto = (party && who === party.name) ? miCuenta().foto : fotos[who];
    if (fotoValida(foto)) {
      var f = document.createElement('img');
      f.src = foto; f.alt = '';
      f.addEventListener('error', function () { av.innerHTML = ''; pintaInicial(av, who); });
      av.appendChild(f);
      return av;
    }
    var id = avs[who];
    if (id && AVATARES.indexOf(id) !== -1) {
      var img = document.createElement('img');
      img.src = 'https://moovin.live/avatares/' + id + '.svg';
      img.alt = '';
      // Si no carga (sin red, o el archivo ya no está) se cae a la inicial.
      img.addEventListener('error', function () { av.innerHTML = ''; pintaInicial(av, who); });
      av.appendChild(img);
      return av;
    }
    pintaInicial(av, who);
    return av;
  }
  function pintaInicial(av, who) {
    av.style.background = nameColor(who);
    av.textContent = (who || '?').trim().charAt(0).toUpperCase() || '?';
  }
  // Chat incremental: solo añade lo nuevo (no se rehace, así no se pierde el
  // scroll ni el foco mientras escribes). Mensajes seguidos de la misma
  // persona se agrupan bajo su avatar.
  function pintarChat() {
    if (!ui.chat || !party) return;
    if (ui.pintados > party.msgs.length) { ui.chat.innerHTML = ''; ui.pintados = 0; ui.grp = null; ui.lastWho = null; }
    if (!party.msgs.length) {
      if (!ui.vacio) {
        ui.vacio = document.createElement('div'); ui.vacio.className = 'nvp-empty';
        ui.vacio.textContent = 'Aún no hay mensajes.' + String.fromCharCode(10) + 'Saluda a la sala.';
        ui.chat.appendChild(ui.vacio);
      }
      return;
    }
    if (ui.vacio) { ui.vacio.remove(); ui.vacio = null; }
    var pegado = ui.chat.scrollHeight - ui.chat.scrollTop - ui.chat.clientHeight < 40;
    for (var i = ui.pintados || 0; i < party.msgs.length; i++) {
      var m = party.msgs[i];
      if (m.sys) {
        ui.grp = null; ui.lastWho = null;
        var sysLine = document.createElement('div'); sysLine.className = 'nvp-sys';
        var sp = document.createElement('span'); sp.textContent = m.text; sysLine.appendChild(sp);
        ui.chat.appendChild(sysLine);
        continue;
      }
      // Acción o chat: mismo bloque avatar+nombre; solo cambia el estilo del texto.
      var nuevoGrupo = !ui.grp || m.who !== ui.lastWho || (m.t || 0) - (ui.lastT || 0) > 180000;
      if (nuevoGrupo) {
        var msg = document.createElement('div'); msg.className = 'nvp-msg';
        msg.appendChild(avatar(m.who));
        var mb = document.createElement('div'); mb.className = 'nvp-mb';
        var who = document.createElement('div'); who.className = 'nvp-who'; who.textContent = m.who;
        mb.appendChild(who);
        msg.appendChild(mb);
        ui.chat.appendChild(msg);
        ui.grp = mb;
      }
      var tx = document.createElement('div'); tx.className = m.act ? 'nvp-act' : 'nvp-tx'; tx.textContent = m.text;
      ui.grp.appendChild(tx);
      ui.lastWho = m.who; ui.lastT = m.t || 0;
    }
    ui.pintados = party.msgs.length;
    if (pegado) ui.chat.scrollTop = ui.chat.scrollHeight;
  }

  function construir() {
    body.innerHTML = '';
    var site = activeSite();
    if (!party) {
      var setup = document.createElement('div'); setup.className = 'nvp-setup';
      var hint = document.createElement('div'); hint.className = 'nvp-hint';
      ui.hint = hint; setup.appendChild(hint);
      var lblN = document.createElement('div'); lblN.className = 'nvp-lbl'; lblN.textContent = 'Tu nombre'; setup.appendChild(lblN);
      var nameRow = document.createElement('div'); nameRow.className = 'nvp-row';
      var nameIn = document.createElement('input'); nameIn.id = 'nvp-name'; nameIn.className = 'nvp-in'; nameIn.maxLength = 32;
      nameIn.placeholder = 'Cómo te verán en la sala'; nameIn.value = localStorage.__navPartyName || '';
      nameIn.addEventListener('change', function () { localStorage.__navPartyName = nameIn.value.trim(); });
      nameRow.appendChild(nameIn); setup.appendChild(nameRow);
      var go = document.createElement('button'); go.className = 'nvp-cta'; go.disabled = !site;
      go.textContent = 'Crear sala';
      go.addEventListener('click', function () { localStorage.__navPartyName = nameIn.value.trim(); start(randomCode(), true); });
      setup.appendChild(go); ui.crear = go;
      var lbl = document.createElement('div'); lbl.className = 'nvp-lbl'; lbl.textContent = 'O únete a una sala'; setup.appendChild(lbl);
      var joinRow = document.createElement('div'); joinRow.className = 'nvp-row';
      var codeIn = document.createElement('input'); codeIn.id = 'nvp-codein'; codeIn.className = 'nvp-in code'; codeIn.maxLength = 12; codeIn.placeholder = 'Código';
      var joinBtn = document.createElement('button'); joinBtn.className = 'nvp-btn'; joinBtn.textContent = 'Unirse'; ui.unirse = joinBtn;
      var doJoin = function () {
        var c = codeIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!c) return;
        localStorage.__navPartyName = nameIn.value.trim(); start(c, false);
      };
      joinBtn.addEventListener('click', doJoin);
      codeIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
      joinRow.appendChild(codeIn); joinRow.appendChild(joinBtn); setup.appendChild(joinRow);
      body.appendChild(setup);
    } else {
      // Cabecera de sala: código (copiar al tocar), salir, estado y qué se ve.
      var room = document.createElement('div'); room.className = 'nvp-room';
      var codeRow = document.createElement('div'); codeRow.className = 'nvp-coderow';
      var code = document.createElement('button'); code.className = 'nvp-code'; code.title = 'Copiar el código de la sala';
      code.appendChild(document.createTextNode(party.code));
      var cIco = document.createElement('span'); cIco.innerHTML = ICON_COPY; code.appendChild(cIco.firstChild);
      code.addEventListener('click', function () { navigator.clipboard.writeText(party.code).then(function () { naviris.toast('Código copiado: ' + party.code); }).catch(function () {}); });
      codeRow.appendChild(code); ui.code = code;
      var lv = document.createElement('button'); lv.className = 'nvp-leave'; lv.textContent = 'Salir';
      lv.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); leave(false); });
      codeRow.appendChild(lv);
      room.appendChild(codeRow);
      var st = document.createElement('div'); st.className = 'nvp-status';
      st.innerHTML = '<span class="dot"></span><span></span>';
      ui.estado = st.lastChild;
      room.appendChild(st);
      var w = document.createElement('div'); w.className = 'nvp-watch';
      room.appendChild(w); ui.viendo = w;
      if (!party.host) {
        // Solo sale cuando la pestaña no llegó al video del anfitrión.
        var ir = document.createElement('button'); ir.className = 'nvp-ir'; ir.textContent = 'Ir al video del anfitrión';
        ir.addEventListener('click', function () {
          if (!party || !party.hostUrl) return;
          party.objetivo = epIdOf(party.hostUrl); party.intento = Date.now(); marcaDesync(false);
          logSys('Abriendo el video del anfitrión…');
          irA(party.hostUrl);
        });
        room.appendChild(ir); ui.ir = ir;
      }
      if (party.host) {
        // Dos permisos distintos: quién controla la reproducción y quién puede
        // cambiar el video que ve la sala.
        var lockRow = document.createElement('label'); lockRow.className = 'nvp-lock';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!party.lock;
        cb.addEventListener('change', function () { party.lock = cb.checked; logSys(cb.checked ? 'Control exclusivo: solo tú puedes dar play, pausar y saltar' : 'Control exclusivo desactivado: todos pueden controlar'); });
        lockRow.appendChild(cb); lockRow.appendChild(document.createTextNode('Solo el anfitrión controla la reproducción'));
        room.appendChild(lockRow); ui.lock = cb;

        var navRow = document.createElement('label'); navRow.className = 'nvp-lock';
        var cb2 = document.createElement('input'); cb2.type = 'checkbox'; cb2.checked = !!party.navLock;
        cb2.addEventListener('change', function () {
          party.navLock = cb2.checked;
          logSys(cb2.checked ? 'Solo tú puedes cambiar el video de la sala' : 'Cualquiera puede cambiar el video de la sala');
        });
        navRow.appendChild(cb2); navRow.appendChild(document.createTextNode('Solo el anfitrión cambia el video'));
        room.appendChild(navRow); ui.navLock = cb2;
      }
      body.appendChild(room);
      // Chat a toda altura + entrada fija abajo.
      var chat = document.createElement('div'); chat.className = 'nvp-chat';
      body.appendChild(chat);
      ui.chat = chat; ui.pintados = 0; ui.grp = null; ui.lastWho = null; ui.lastT = 0;
      var compose = document.createElement('div'); compose.className = 'nvp-compose';
      var chatIn = document.createElement('input'); chatIn.id = 'nvp-chatin'; chatIn.className = 'nvp-in'; chatIn.maxLength = 300; chatIn.placeholder = 'Escribe un mensaje…';
      var sendBtn = document.createElement('button'); sendBtn.className = 'nvp-send'; sendBtn.title = 'Enviar';
      sendBtn.innerHTML = ICON_SEND;
      // Se vacía el campo ANTES de registrar el mensaje: logChat dispara el
      // repintado del chat y con el orden inverso el texto se quedaba escrito.
      var doChat = function () {
        var msg = chatIn.value.trim(); if (!msg || !party) return;
        chatIn.value = '';
        send({ t: 'chat', msg: msg });
        logChat(party.name, msg);
        chatIn.focus();
      };
      sendBtn.addEventListener('click', doChat);
      chatIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doChat(); } });
      compose.appendChild(chatIn); compose.appendChild(sendBtn); body.appendChild(compose);
    }
  }

  /* ---------- Botón del sidebar + color por sitio ---------- */
  naviris.registerTool({
    id: ID,
    label: 'Watch Party — ver a la vez con amigos',
    icon: 'eye-fill',
    onClick: function () { togglePanel(); }
  });
  var btn = document.getElementById(BTN_ID);
  if (btn) btn.innerHTML = ICON_EYE;

  function glow() {
    var b = document.getElementById(BTN_ID); if (!b) return;
    // El botón mantiene SIEMPRE el color de la plataforma; con sala activa se
    // añade un punto verde en la esquina en vez de teñirlo todo de verde.
    var site = activeSite() || (party && party.site) || null;
    b.classList.toggle('nvp-live', !!party);
    b.classList.toggle('nvp-netflix', site === 'netflix');
    b.classList.toggle('nvp-crunchy', site === 'crunchy');
    b.classList.toggle('nvp-disney', site === 'disney');
    b.classList.toggle('nvp-youtube', site === 'youtube');
    b.classList.toggle('nvp-iris', site === 'iris');
  }
  // Sondeo ligero (2 s): la API de addons no expone eventos de navegación. Si el
  // addon se quita/pausa (botón fuera del DOM), se limpia todo solo.
  var glowTimer = setInterval(function () {
    if (!document.getElementById(BTN_ID)) {
      clearInterval(glowTimer); leave(true);
      panel.remove(); css.remove();
      return;
    }
    glow();
    if (!panel.classList.contains('hidden')) render();
  }, 2000);

  // Panel acoplado: se abre y se cierra solo desde su botón o la X (nada de
  // cerrarse al hacer clic fuera: el chat convive con el video, como Teleparty).
  // El panel comprime la página al abrirse, así que el ancho se anima
  // (flex-basis 0 -> 302) con una curva con rebote en vez de aparecer de golpe.
  // Al cerrar, primero se pliega y luego se oculta; si el usuario reabre a
  // mitad de pliegue, el temporizador lo respeta.
  function togglePanel(force) {
    var open = force !== undefined ? force : panel.classList.contains('hidden');
    if (open) {
      panel.classList.remove('hidden');
      panel.classList.add('nvp-plegado');
      requestAnimationFrame(function () { requestAnimationFrame(function () { panel.classList.remove('nvp-plegado'); }); });
      render(true);
    } else {
      panel.classList.add('nvp-plegado');
      setTimeout(function () { if (panel.classList.contains('nvp-plegado')) { panel.classList.add('hidden'); panel.classList.remove('nvp-plegado'); } }, 470);
    }
  }
  panel.querySelector('#nvp-close').addEventListener('click', function () { togglePanel(false); });

  glow();
})();

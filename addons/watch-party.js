/* Naviris addon: Watch Party v2.5.0
   Ver video a la vez con amigos en Crunchyroll, Netflix, Disney+ y YouTube.
   NO transmite video: cada quien reproduce su propia copia con su propia
   cuenta; solo se sincronizan las señales de control (play/pausa/seek) y un
   chat, vía el relay de Cloudflare.

   Arquitectura: herramienta del sidebar (kind "tool", corre en el renderer).
   El botón se ilumina con el color del sitio de la pestaña activa y abre un
   panel lateral con sala, chat y estado. En la página solo se inyecta un
   agente mínimo que controla el <video> y avisa de los eventos por
   console-message. En YouTube se usa su API de reproductor
   (playVideo/pauseVideo/seekTo) y los anuncios se detectan para no
   sincronizar con el tiempo del anuncio.

   Anfitrión-autoritativo: quien crea la sala late con su tiempo cada 2 s; los
   demás corrigen si se desvían más de 1,5 s. Al unirse, el invitado navega
   solo al episodio del anfitrión; el chat narra cada acción; y el anfitrión
   decide quién controla la reproducción y quién puede cambiar el video.

   v2.5.0: panel acoplado al borde derecho a altura completa (estilo
   Teleparty): el contenido se encoge en vez de taparse, el chat ocupa todo el
   alto con avatares por persona y las acciones (puso play, se unió…) se
   narran en cursiva junto al nombre; entrada de mensaje fija abajo. Textos en
   español neutro. Requiere Naviris 2.7.3-dev.12+ (el CSP anterior bloqueaba
   la conexión con el servidor de salas y unirse no hacía nada).
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
    // has:false durante un anuncio de YouTube -> el resto de la sala no se
    // sincroniza con el tiempo del anuncio ni se le corrige el suyo.
    'window.__navPartyState=function(){var v=vid();var ad=isYt&&ytAnuncio();' +
    'return{time:v?v.currentTime:0,paused:v?v.paused:true,has:!!v&&!ad,ad:!!ad}};' +
    'window.__navPartyApply=function(m){mute=Date.now()+' + ECHO_MS + ';var st=window.__navPartyState();' +
    'if(m.kind==="seek")doSeek(m.time);' +
    'else if(m.kind==="play"){if(typeof m.time==="number"&&Math.abs(st.time-m.time)>' + DRIFT + ')doSeek(m.time);doPlay()}' +
    'else if(m.kind==="pause"){doPause();if(typeof m.time==="number")doSeek(m.time)}};' +
    'window.__navPartyBeat=function(m){if(Date.now()<mute)return;var st=window.__navPartyState();if(!st.has)return;' +
    'if(m.paused&&!st.paused){mute=Date.now()+' + ECHO_MS + ';doPause()}' +
    'else if(!m.paused&&st.paused){mute=Date.now()+' + ECHO_MS + ';doPlay()}' +
    'if(typeof m.time==="number"&&Math.abs(st.time-m.time)>' + DRIFT + '){mute=Date.now()+' + ECHO_MS + ';doSeek(m.time)}};' +
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
    '#' + BTN_ID + '{position:relative}',
    '#' + BTN_ID + '.nvp-live::after{content:"";position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:#9ee2b8}',
    '#' + BTN_ID + '.nvp-live:not(.nvp-netflix):not(.nvp-crunchy):not(.nvp-disney):not(.nvp-youtube){color:#9ee2b8}',
    /* Panel: columna acoplada al borde derecho, altura completa (el contenido
       se encoge; nada queda tapado, como la barra de Teleparty) */
    '#nvp-panel{flex:0 0 302px;width:302px;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--bg-2,#121217);border-left:1px solid var(--line,#26262d)}',
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
    '.nvp-lock{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11.8px;color:var(--muted,#8b8d94);cursor:pointer;user-select:none}',
    '.nvp-lock:hover{color:var(--text,#ececef)}',
    '.nvp-lock input{accent-color:var(--violet,#b98cff);margin:0}',
    /* Chat: ocupa todo el alto; mensajes con avatar (estilo Teleparty) */
    '.nvp-chat{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:11px}',
    '.nvp-msg{display:flex;gap:9px;align-items:flex-start}',
    '.nvp-av{width:28px;height:28px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:rgba(10,10,14,.78)}',
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

  /* Color estable por autor (paleta suave, sin depender del core) */
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

  /* ---------- Estado ---------- */
  var party = null;      // { code, host, wv, ws, n, status, ok, msgs, name }
  var beatTimer = null;

  var SITIOS = {
    netflix: 'Netflix', crunchy: 'Crunchyroll', disney: 'Disney+', youtube: 'YouTube'
  };
  function siteOf(url) {
    var h = ''; try { h = new URL(url).hostname; } catch (e) { return null; }
    if (/(^|\.)netflix\.com$/.test(h)) return 'netflix';
    if (/(^|\.)crunchyroll\.com$/.test(h)) return 'crunchy';
    if (/(^|\.)disneyplus\.com$/.test(h)) return 'disney';
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
    return null;
  }
  // Identidad del episodio (para saber si dos URLs son "el mismo capítulo"
  // aunque cambien locale o slug): crunchyroll.com/../watch/GXXXX/..,
  // netflix.com/watch/123456
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
    if (m) return 'yt:' + m[1];
    m = /(?:youtu\.be|youtube\.com\/(?:live|embed|shorts))\/([\w-]{6,})/i.exec(url || '');
    if (m) return 'yt:' + m[1];
    return null;
  }
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
  function send(obj) { try { if (party && party.ws && party.ws.readyState === 1) party.ws.send(JSON.stringify(obj)); } catch (e) { /* nada */ } }
  function pushMsg(m) { if (!party) return; party.msgs.push(m); if (party.msgs.length > 200) { party.msgs.shift(); ui.pintados = Math.max(0, (ui.pintados || 0) - 1); } render(); }
  // Aviso de sala (línea divisoria, sin persona): estados, permisos…
  function logSys(text) { pushMsg({ text: text, sys: true, t: Date.now() }); }
  // Acción de una persona (cursiva junto a su avatar, estilo Teleparty):
  // "puso play", "se unió a la sala"…
  function logAct(who, text) { pushMsg({ who: who || '?', text: text, act: true, t: Date.now() }); }
  function logChat(who, text) { pushMsg({ who: who, text: text, t: Date.now() }); }
  // Narración filtrada: sin duplicados seguidos y sin los pausa/play espurios
  // que el reproductor dispara al bufferizar justo después de un salto.
  var narr = { kind: '', at: 0 };
  function narrate(kind, who, text) {
    var now = Date.now();
    if ((kind === 'play' || kind === 'pause') && narr.kind === 'seek' && now - narr.at < 2500) return;
    if (narr.kind === kind && now - narr.at < 1500) return;
    narr = { kind: kind, at: now };
    logAct(who, text);
  }
  function inject(wv) { try { wv.executeJavaScript(AGENT).catch(function () {}); } catch (e) { /* nada */ } }

  function onConsole(e) {
    if (!party || typeof e.message !== 'string' || e.message.indexOf('NAVPARTY|') !== 0) return;
    var m; try { m = JSON.parse(e.message.slice(9)); } catch (x) { return; }
    // Control exclusivo: las acciones de los invitados no se difunden (y el
    // siguiente latido del anfitrión las revierte). Aviso sin spamear.
    if (party.lock && !party.host) {
      if (Date.now() - (party.lockWarned || 0) > 5000) { party.lockWarned = Date.now(); logSys('Solo el anfitrión controla la reproducción'); }
      return;
    }
    send({ t: 'ev', kind: m.kind, time: m.time, at: Date.now() });
    narrate(m.kind, party.name, m.kind === 'play' ? 'puso play' : m.kind === 'pause' ? 'pausó en ' + fmtT(m.time) : 'saltó a ' + fmtT(m.time));
  }
  function onRenav() {
    if (!party) return;
    inject(party.wv);
    // Cambio de video: si el anfitrión lo permite (o eres tú el anfitrión), al
    // abrir otro video se lleva a toda la sala. Con navLock activo, solo el
    // anfitrión puede; a los invitados el latido les devuelve al suyo.
    var url = ''; try { url = party.wv.getURL(); } catch (e) { return; }
    var ep = epIdOf(url);
    if (!ep || ep === party.ultimoEp) return;
    var puedo = party.host || !party.navLock;
    party.ultimoEp = ep;
    if (puedo && !party.aplicandoNav) {
      send({ t: 'ev', kind: 'nav', url: url, at: Date.now() });
      logAct(party.name, 'cambió el video de la sala');
    }
    party.aplicandoNav = false;
  }
  function onGone() { if (party) { leave(true); naviris.toast('Watch Party terminada: se cerró la pestaña'); } }

  function applyRemote(m) {
    if (!party) return;
    var who = m.from || 'Alguien';
    // Alguien cambió el video de la sala: se sigue si el anfitrión lo permite
    // (el propio anfitrión siempre acepta el cambio de un invitado cuando
    // tiene el cambio de video abierto).
    if (m.kind === 'nav') {
      if (party.navLock && !party.host) return;   // sala cerrada: manda el anfitrión
      var want = epIdOf(m.url); if (!want) return;
      var cur = ''; try { cur = party.wv.getURL(); } catch (e) { /* nada */ }
      if (epIdOf(cur) === want) return;
      logAct(who, 'cambió el video de la sala');
      party.aplicandoNav = true; party.ultimoEp = want;
      try { party.wv.loadURL(m.url); } catch (e) { /* nada */ }
      return;
    }
    narrate(m.kind, who, m.kind === 'play' ? 'puso play' : m.kind === 'pause' ? 'pausó en ' + fmtT(m.time) : 'saltó a ' + fmtT(m.time));
    try { party.wv.executeJavaScript('window.__navPartyApply&&__navPartyApply(' + JSON.stringify({ kind: m.kind, time: m.time }) + ')').catch(function () {}); } catch (e) { /* nada */ }
  }
  // Invitados: seguir el episodio del anfitrión (la URL viaja en su latido). Si
  // el capítulo no coincide, la pestaña navega sola al del anfitrión.
  function syncEpisode(url) {
    if (!party || party.host || !url) return;
    var want = epIdOf(url); if (!want) return;
    var cur = ''; try { cur = party.wv.getURL(); } catch (e) { return; }
    if (epIdOf(cur) === want) { party.navving = 0; return; }
    if (party.navving && Date.now() - party.navving < 15000) return; // ya está navegando
    party.navving = Date.now();
    logSys('Abriendo el episodio del anfitrión…');
    try { party.wv.loadURL(url); } catch (e) { /* nada */ }
  }
  function applyBeat(m) {
    if (!party) return;
    try { party.wv.executeJavaScript('window.__navPartyBeat&&__navPartyBeat(' + JSON.stringify({ time: m.time, paused: !!m.paused }) + ')').catch(function () {}); } catch (e) { /* nada */ }
  }
  function beatStart() {
    beatStop();
    var tick = function () {
      if (!party) return;
      try {
        party.wv.executeJavaScript('window.__navPartyState?__navPartyState():null').then(function (st) {
          if (!party) return;
          var url = ''; try { url = party.wv.getURL(); } catch (e) { /* nada */ }
          // El latido siempre lleva la URL (los invitados siguen el episodio) y
          // el modo de control; tiempo/pausa solo si ya hay video.
          var msg = { t: 'beat', url: url, lock: !!party.lock, nlock: !!party.navLock, at: Date.now() };
          if (st && st.has) { msg.time = st.time; msg.paused = st.paused; }
          send(msg);
        }).catch(function () {});
      } catch (e) { /* nada */ }
    };
    tick();
    beatTimer = setInterval(tick, 2000);
  }
  function beatStop() { if (beatTimer) { clearInterval(beatTimer); beatTimer = null; } }
  function randomCode() { var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '', i; for (i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

  function start(code, asHost) {
    var wv = naviris.activeWebview();
    if (!wv || !activeSite()) { naviris.toast('Abre el video en Crunchyroll, Netflix, Disney+ o YouTube y vuelve a intentarlo'); return; }
    leave(true);
    var name = (localStorage.__navPartyName || (asHost ? 'Anfitrión' : 'Invitado')).slice(0, 32);
    // navLock: por defecto SOLO el anfitrión cambia el video de la sala.
    party = { code: code, host: asHost, wv: wv, ws: null, n: 1, status: 'Conectando…', ok: false, msgs: [], name: name, navLock: true, site: activeSite(), ultimoEp: epIdOf(wv.getURL ? wv.getURL() : '') };
    wv.addEventListener('console-message', onConsole);
    wv.addEventListener('did-navigate', onRenav);
    wv.addEventListener('did-navigate-in-page', onRenav);
    wv.addEventListener('dom-ready', onRenav);
    wv.addEventListener('destroyed', onGone);
    inject(wv);
    var ws;
    try { ws = new WebSocket(SERVER); } catch (e) {
      // El CSP del renderer puede vetar la conexión (Naviris < 2.7.3-dev.12).
      party.status = 'Sin conexión con el servidor. Actualiza Naviris.';
      naviris.toast('Watch Party no puede conectar: actualiza Naviris');
      render(); glow(); return;
    }
    party.ws = ws;
    ws.onopen = function () { send({ t: 'join', room: code, name: name, host: asHost }); };
    ws.onmessage = function (ev) {
      if (!party || party.ws !== ws) return;
      var m; try { m = JSON.parse(ev.data); } catch (x) { return; }
      if (m.t === 'joined') {
        party.ok = true; party.n = m.n; party.status = 'En la sala';
        logAct(party.name, asHost ? 'creó la sala' : 'se unió a la sala');
        logSys(asHost ? 'Toca el código para copiarlo y compartirlo' : 'El anfitrión marca el ritmo');
        if (asHost) beatStart();
      }
      else if (m.t === 'peers') { party.n = m.n; if (m.joined && m.who) logAct(m.who, 'se unió a la sala'); else if (m.left && m.who) logAct(m.who, 'salió de la sala'); }
      else if (m.t === 'ev') applyRemote(m);
      else if (m.t === 'beat') {
        if (!party.host) {
          var hadLock = !!party.lock; party.lock = !!m.lock;
          if (party.lock !== hadLock) logSys(party.lock ? 'El anfitrión activó el control exclusivo' : 'El anfitrión desactivó el control exclusivo');
          var hadNav = !!party.navLock; party.navLock = m.nlock !== false;
          if (party.navLock !== hadNav) logSys(party.navLock ? 'Ahora solo el anfitrión puede cambiar el video' : 'Ahora cualquiera puede cambiar el video');
          // Solo se te devuelve al video del anfitrión si la sala está cerrada;
          // si está abierta, el video lo manda quien lo haya cambiado.
          if (party.navLock) syncEpisode(m.url);
          if (typeof m.time === 'number') applyBeat(m);
        }
      }
      else if (m.t === 'chat') logChat(m.from || '?', String(m.msg || ''));
      else if (m.t === 'error') party.status = 'Error: ' + m.msg;
      render(); glow();
    };
    ws.onclose = function () { if (party && party.ws === ws) { party.ok = false; party.status = 'Desconectado'; beatStop(); render(); } };
    ws.onerror = function () { if (party && party.ws === ws) { party.ok = false; party.status = 'Sin conexión con el servidor'; render(); } };
    render(); glow();
  }
  function leave(silent) {
    if (!party) return;
    beatStop();
    var wv = party.wv;
    try { wv.removeEventListener('console-message', onConsole); } catch (e) { /* nada */ }
    try { wv.removeEventListener('did-navigate', onRenav); wv.removeEventListener('did-navigate-in-page', onRenav); wv.removeEventListener('dom-ready', onRenav); wv.removeEventListener('destroyed', onGone); } catch (e) { /* nada */ }
    try { wv.executeJavaScript('window.__navPartyStop&&__navPartyStop()').catch(function () {}); } catch (e) { /* nada */ }
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
        ? 'Listo: la sala usará ' + (SITIOS[site] || '') + ' en esta pestaña. Crea una sala y comparte el código, o únete con uno: la pestaña saltará sola a lo que vea el anfitrión.'
        : 'Abre Crunchyroll, Netflix, Disney+ o YouTube en la pestaña activa (el botón se ilumina con el color del sitio) y vuelve aquí.';
      if (ui.crear) ui.crear.disabled = !site;
      if (ui.unirse) ui.unirse.disabled = !site;
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
      var title = ''; try { title = party.wv.getTitle() || party.wv.getURL(); } catch (e) { /* nada */ }
      ui.viendo.textContent = title ? 'Viendo: ' + title.replace(/ - Crunchyroll.*$| - Netflix.*$| - YouTube$/i, '') : '';
      ui.viendo.style.display = title ? '' : 'none';
    }
    if (ui.lock && ui.lock.checked !== !!party.lock) ui.lock.checked = !!party.lock;
    if (ui.navLock && ui.navLock.checked !== !!party.navLock) ui.navLock.checked = !!party.navLock;
    pintarChat();
  }
  function avatar(who) {
    var av = document.createElement('span'); av.className = 'nvp-av';
    av.style.background = nameColor(who);
    av.textContent = (who || '?').trim().charAt(0).toUpperCase() || '?';
    return av;
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
      var joinBtn = document.createElement('button'); joinBtn.className = 'nvp-btn'; joinBtn.textContent = 'Unirse'; joinBtn.disabled = !site; ui.unirse = joinBtn;
      var doJoin = function () { var c = codeIn.value.trim().toUpperCase(); if (!c) return; localStorage.__navPartyName = nameIn.value.trim(); start(c, false); };
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
  function togglePanel(force) {
    var open = force !== undefined ? force : panel.classList.contains('hidden');
    if (open) { panel.classList.remove('hidden'); render(true); }
    else panel.classList.add('hidden');
  }
  panel.querySelector('#nvp-close').addEventListener('click', function () { togglePanel(false); });

  glow();
})();

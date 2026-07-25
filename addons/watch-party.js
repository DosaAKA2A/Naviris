/* Naviris addon: Watch Party v2.1.0
   Ver series a la vez con amigos en Crunchyroll y Netflix, estilo Teleparty pero
   más simple y sin cuentas de terceros. NO transmite vídeo: cada quien reproduce
   su propia copia con su propia cuenta; solo se sincronizan las señales de
   control (play/pausa/seek) y un chat, vía el relay de Cloudflare.

   v2: herramienta del sidebar (kind "tool", corre en el renderer). Botón junto a
   Rat Tool/AutoLoot que se ilumina al reconocer el sitio de la pestaña activa
   (rojo Netflix, naranja Crunchyroll; verde con sala activa) y panel lateral
   izquierdo con sala, chat y estado. En la página solo se inyecta un agente
   mínimo que controla el <video> y avisa de los eventos por console-message.

   v2.1 (paridad con Teleparty): al unirse, el invitado NAVEGA SOLO al episodio
   del anfitrión (el latido lleva la URL y se compara el id del capítulo); el
   chat narra cada acción ("X ha dado play", "X ha saltado a 12:34", "X ha
   pausado", "X ha salido"); y el anfitrión puede activar "Solo el anfitrión
   controla" (los play/pausa de los invitados no se difunden y el latido los
   revierte).

   Anfitrión-autoritativo: quien crea la sala late con su tiempo cada 2 s; los
   demás corrigen si se desvían más de 1,5 s. */
(function () {
  var SERVER = localStorage.__navPartyServer || 'wss://naviris-party.studio-iris2026.workers.dev';
  var DRIFT = 1.5;      // segundos de desvío tolerado antes de re-seek
  var ECHO_MS = 900;    // ventana ignorando eventos locales tras aplicar un remoto
  var ID = 'watch-party';
  var BTN_ID = 'adt-' + ID;

  /* ---------- Agente que se inyecta en la página (mundo de la página) ---------- */
  var AGENT = '(function(){' +
    'if(window.__navPartyAgent)return;window.__navPartyAgent=1;var mute=0;' +
    'function vid(){return document.querySelector("video")}' +
    'var isNf=/netflix\\./.test(location.hostname),nfP=null;' +
    'function nf(){try{if(nfP)return nfP;var api=window.netflix&&netflix.appContext&&netflix.appContext.state.playerApp.getAPI().videoPlayer;if(!api)return null;var ids=api.getAllPlayerSessionIds()||[];var sid=null;for(var i=0;i<ids.length;i++)if(/watch/.test(ids[i]))sid=ids[i];sid=sid||ids[0];nfP=sid?api.getVideoPlayerBySessionId(sid):null;return nfP}catch(e){return null}}' +
    'function doPlay(){if(isNf){var p=nf();if(p){try{p.play();return}catch(e){}}}var v=vid();if(v)v.play().catch(function(){})}' +
    'function doPause(){if(isNf){var p=nf();if(p){try{p.pause();return}catch(e){}}}var v=vid();if(v)v.pause()}' +
    'function doSeek(t){if(isNf){var p=nf();if(p){try{p.seek(Math.round(t*1000));return}catch(e){}}}var v=vid();if(v)v.currentTime=t}' +
    'window.__navPartyState=function(){var v=vid();return{time:v?v.currentTime:0,paused:v?v.paused:true,has:!!v}};' +
    'window.__navPartyApply=function(m){mute=Date.now()+' + ECHO_MS + ';var st=window.__navPartyState();' +
    'if(m.kind==="seek")doSeek(m.time);' +
    'else if(m.kind==="play"){if(typeof m.time==="number"&&Math.abs(st.time-m.time)>' + DRIFT + ')doSeek(m.time);doPlay()}' +
    'else if(m.kind==="pause"){doPause();if(typeof m.time==="number")doSeek(m.time)}};' +
    'window.__navPartyBeat=function(m){if(Date.now()<mute)return;var st=window.__navPartyState();if(!st.has)return;' +
    'if(m.paused&&!st.paused){mute=Date.now()+' + ECHO_MS + ';doPause()}' +
    'else if(!m.paused&&st.paused){mute=Date.now()+' + ECHO_MS + ';doPlay()}' +
    'if(typeof m.time==="number"&&Math.abs(st.time-m.time)>' + DRIFT + '){mute=Date.now()+' + ECHO_MS + ';doSeek(m.time)}};' +
    'var wired=null;' +
    'function emit(kind){return function(){if(Date.now()<mute)return;console.log("NAVPARTY|"+JSON.stringify({kind:kind,time:(vid()||{currentTime:0}).currentTime}))}}' +
    'function wire(){var v=vid();if(!v||v===wired)return;wired=v;v.addEventListener("play",emit("play"));v.addEventListener("pause",emit("pause"));v.addEventListener("seeked",emit("seek"))}' +
    'var iv=setInterval(wire,1500);wire();' +
    'window.__navPartyStop=function(){clearInterval(iv);wired=null;window.__navPartyAgent=0};' +
    '})();';

  /* ---------- Estilos (reusa side-panel-left, lp- y loot- del core) ---------- */
  var css = document.createElement('style');
  css.id = 'nvp-style';
  css.textContent = [
    /* Botón del sidebar: brillo ESTÁTICO por sitio reconocido (nada animado en reposo) */
    '#' + BTN_ID + '.nvp-netflix{color:#e50914;filter:drop-shadow(0 0 6px rgba(229,9,20,.65))}',
    '#' + BTN_ID + '.nvp-crunchy{color:#f47521;filter:drop-shadow(0 0 6px rgba(244,117,33,.65))}',
    '#' + BTN_ID + '.nvp-live{color:#9ee2b8;filter:drop-shadow(0 0 6px rgba(158,226,184,.5))}',
    '.nvp-row{display:flex;gap:6px;margin-top:8px}',
    '.nvp-in{flex:1;min-width:0;background:rgba(0,0,0,.25);color:var(--text,#ececef);border:1px solid var(--line-2,#2c2c33);border-radius:9px;padding:9px 10px;font-size:12.5px;outline:none}',
    '.nvp-in:focus{border-color:var(--muted,#8b8d94)}',
    '.nvp-in::placeholder{color:var(--dim,#5c5e64)}',
    '.nvp-in.code{text-transform:uppercase;font-family:var(--mono,ui-monospace,monospace);letter-spacing:2px}',
    '.nvp-btn{border:none;border-radius:9px;padding:9px 13px;font-size:12px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.08);color:var(--text,#ececef);flex:0 0 auto}',
    '.nvp-btn:hover{background:rgba(255,255,255,.14)}',
    '.nvp-btn:disabled{color:var(--dim,#5c5e64);cursor:default;background:rgba(255,255,255,.04)}',
    '.nvp-code{display:flex;flex-direction:column;align-items:center;gap:3px;margin-top:8px;padding:13px 10px;border:1px dashed var(--line-2,#2c2c33);border-radius:12px;cursor:pointer}',
    '.nvp-code:hover{background:rgba(255,255,255,.04)}',
    '.nvp-code .c{font-family:var(--mono,ui-monospace,monospace);font-size:26px;font-weight:800;letter-spacing:8px;color:var(--text,#ececef);text-indent:8px}',
    '.nvp-code .h{font-size:10.5px;color:var(--muted,#8b8d94)}',
    '.nvp-status{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--muted,#8b8d94)}',
    '.nvp-status .dot{width:7px;height:7px;border-radius:50%;background:#9ee2b8;flex:none}',
    '.nvp-status.err .dot{background:#e6a9b4}',
    '.nvp-watch{display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--line,#232327);border-radius:10px;margin-top:8px}',
    '.nvp-watch .n{flex:1;min-width:0;font-size:12.5px;color:var(--text,#ececef);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.nvp-chat{height:150px;overflow-y:auto;margin-top:8px;border:1px solid var(--line,#232327);border-radius:10px;padding:8px 10px;font-size:12.5px;display:flex;flex-direction:column;gap:4px}',
    '.nvp-chat .l{color:var(--text,#ececef);word-wrap:break-word}',
    '.nvp-chat .l b{color:var(--violet,#b98cff);font-weight:600}',
    '.nvp-chat .s{color:var(--muted,#8b8d94);font-size:11.5px}',
    '.nvp-leave{width:100%;margin-top:10px;border:1px solid var(--line-2,#2c2c33);background:none;color:#e6a9b4;border-radius:10px;padding:9px;font-size:12px;font-weight:600;cursor:pointer}',
    '.nvp-leave:hover{background:rgba(230,169,180,.08)}',
    '.nvp-lock{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted,#8b8d94);cursor:pointer;user-select:none}',
    '.nvp-lock input{accent-color:var(--violet,#b98cff)}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- Panel lateral (estructura del core: side-panel-left) ---------- */
  var panel = document.createElement('aside');
  panel.id = 'nvp-panel';
  panel.className = 'side-panel-left hidden';
  panel.innerHTML =
    '<div class="lp-head"><span class="lp-title"><span id="nvp-ico"></span> Watch Party</span>' +
    '<button id="nvp-close" class="lp-x" title="Cerrar"></button></div>' +
    '<div id="nvp-body" class="lp-body"></div>';
  document.body.appendChild(panel);

  // Iconos propios (Heroicons, stroke currentColor) para no depender del core
  var ICON_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg>';
  panel.querySelector('#nvp-ico').innerHTML = ICON_USERS;
  panel.querySelector('#nvp-ico').style.cssText = 'display:inline-flex;width:15px;height:15px;color:var(--violet,#b98cff)';
  panel.querySelector('#nvp-close').innerHTML = ICON_X;

  /* ---------- Estado ---------- */
  var party = null;      // { code, host, wv, ws, n, status, ok, msgs, name }
  var beatTimer = null;

  function siteOf(url) {
    var h = ''; try { h = new URL(url).hostname; } catch (e) { return null; }
    if (/(^|\.)netflix\.com$/.test(h)) return 'netflix';
    if (/(^|\.)crunchyroll\.com$/.test(h)) return 'crunchy';
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
  function logSys(text) { if (!party) return; party.msgs.push({ text: text, sys: true }); if (party.msgs.length > 200) party.msgs.shift(); render(); }
  function logChat(who, text) { if (!party) return; party.msgs.push({ who: who, text: text }); if (party.msgs.length > 200) party.msgs.shift(); render(); }
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
    logSys(m.kind === 'play' ? 'Has dado play' : m.kind === 'pause' ? 'Has pausado en ' + fmtT(m.time) : 'Has saltado a ' + fmtT(m.time));
  }
  function onRenav() { if (party) inject(party.wv); }
  function onGone() { if (party) { leave(true); naviris.toast('Watch Party terminada: se cerró la pestaña'); } }

  function applyRemote(m) {
    if (!party) return;
    var who = m.from || 'Alguien';
    logSys(m.kind === 'play' ? who + ' ha dado play' : m.kind === 'pause' ? who + ' ha pausado en ' + fmtT(m.time) : who + ' ha saltado a ' + fmtT(m.time));
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
          // el modo de control; tiempo/pausa solo si ya hay vídeo.
          var msg = { t: 'beat', url: url, lock: !!party.lock, at: Date.now() };
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
    if (!wv || !activeSite()) { naviris.toast('Abre el episodio en Netflix o Crunchyroll y vuelve a intentarlo'); return; }
    leave(true);
    var name = (localStorage.__navPartyName || (asHost ? 'Anfitrión' : 'Invitado')).slice(0, 32);
    party = { code: code, host: asHost, wv: wv, ws: null, n: 1, status: 'Conectando…', ok: false, msgs: [], name: name };
    wv.addEventListener('console-message', onConsole);
    wv.addEventListener('did-navigate', onRenav);
    wv.addEventListener('did-navigate-in-page', onRenav);
    wv.addEventListener('dom-ready', onRenav);
    wv.addEventListener('destroyed', onGone);
    inject(wv);
    var ws = new WebSocket(SERVER); party.ws = ws;
    ws.onopen = function () { send({ t: 'join', room: code, name: name, host: asHost }); };
    ws.onmessage = function (ev) {
      if (!party || party.ws !== ws) return;
      var m; try { m = JSON.parse(ev.data); } catch (x) { return; }
      if (m.t === 'joined') { party.ok = true; party.n = m.n; party.status = 'En la sala'; logSys(asHost ? 'Sala creada. Toca el código para copiarlo y compártelo.' : 'Dentro. El anfitrión marca el ritmo.'); if (asHost) beatStart(); }
      else if (m.t === 'peers') { party.n = m.n; if (m.joined && m.who) logSys(m.who + ' se ha unido'); else if (m.left && m.who) logSys(m.who + ' ha salido de la sala'); }
      else if (m.t === 'ev') applyRemote(m);
      else if (m.t === 'beat') {
        if (!party.host) {
          var hadLock = !!party.lock; party.lock = !!m.lock;
          if (party.lock !== hadLock) logSys(party.lock ? 'El anfitrión ha activado el control exclusivo' : 'El anfitrión ha desactivado el control exclusivo');
          syncEpisode(m.url);
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
    if (!silent) naviris.toast('Has saltado de la sala');
    render(); glow();
  }

  /* ---------- Render del panel ---------- */
  var body = panel.querySelector('#nvp-body');
  function render() {
    if (panel.classList.contains('hidden')) return;
    // Conserva lo escrito y el foco al re-renderizar (llegan mensajes mientras tecleas)
    var keep = {}, ids = ['nvp-name', 'nvp-codein', 'nvp-chatin'], i, el;
    for (i = 0; i < ids.length; i++) { el = document.getElementById(ids[i]); if (el) keep[ids[i]] = { v: el.value, f: document.activeElement === el, s: el.selectionStart }; }
    body.innerHTML = '';
    var site = activeSite();
    var siteName = site === 'netflix' ? 'Netflix' : site === 'crunchy' ? 'Crunchyroll' : null;
    if (!party) {
      var hint = document.createElement('div'); hint.className = 'loot-hint';
      hint.textContent = site
        ? 'Listo: la sala usará ' + siteName + ' en esta pestaña. Crea una sala y comparte el código, o únete con uno: la pestaña saltará sola al episodio del anfitrión.'
        : 'Abre Netflix o Crunchyroll en la pestaña activa (el botón se ilumina con el color del sitio) y vuelve aquí.';
      body.appendChild(hint);
      var nameRow = document.createElement('div'); nameRow.className = 'nvp-row';
      var nameIn = document.createElement('input'); nameIn.id = 'nvp-name'; nameIn.className = 'nvp-in'; nameIn.maxLength = 32;
      nameIn.placeholder = 'Tu nombre (opcional)'; nameIn.value = localStorage.__navPartyName || '';
      nameIn.addEventListener('change', function () { localStorage.__navPartyName = nameIn.value.trim(); });
      nameRow.appendChild(nameIn); body.appendChild(nameRow);
      var go = document.createElement('button'); go.className = 'loot-go' + (site ? '' : ' off'); go.disabled = !site;
      go.textContent = 'Crear sala';
      go.addEventListener('click', function () { localStorage.__navPartyName = nameIn.value.trim(); start(randomCode(), true); });
      body.appendChild(go);
      var lbl = document.createElement('div'); lbl.className = 'loot-lbl'; lbl.textContent = 'O ÚNETE A UNA SALA'; body.appendChild(lbl);
      var joinRow = document.createElement('div'); joinRow.className = 'nvp-row';
      var codeIn = document.createElement('input'); codeIn.id = 'nvp-codein'; codeIn.className = 'nvp-in code'; codeIn.maxLength = 12; codeIn.placeholder = 'Código';
      var joinBtn = document.createElement('button'); joinBtn.className = 'nvp-btn'; joinBtn.textContent = 'Unirse'; joinBtn.disabled = !site;
      var doJoin = function () { var c = codeIn.value.trim().toUpperCase(); if (!c) return; localStorage.__navPartyName = nameIn.value.trim(); start(c, false); };
      joinBtn.addEventListener('click', doJoin);
      codeIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
      joinRow.appendChild(codeIn); joinRow.appendChild(joinBtn); body.appendChild(joinRow);
    } else {
      var codeBox = document.createElement('div'); codeBox.className = 'nvp-code'; codeBox.title = 'Copiar el código';
      codeBox.innerHTML = '<span class="c"></span><span class="h">toca para copiar y compartir</span>';
      codeBox.querySelector('.c').textContent = party.code;
      codeBox.addEventListener('click', function () { navigator.clipboard.writeText(party.code).then(function () { naviris.toast('Código copiado: ' + party.code); }).catch(function () {}); });
      body.appendChild(codeBox);
      var st = document.createElement('div'); st.className = 'nvp-status' + (party.ok ? '' : ' err');
      st.innerHTML = '<span class="dot"></span><span></span>';
      st.lastChild.textContent = party.n + ' viendo · ' + (party.host ? 'anfitrión' : 'invitado') + ' · ' + party.status;
      body.appendChild(st);
      var title = ''; try { title = party.wv.getTitle() || party.wv.getURL(); } catch (e) { /* nada */ }
      if (title) {
        var w = document.createElement('div'); w.className = 'nvp-watch';
        var nm = document.createElement('span'); nm.className = 'n'; nm.textContent = title;
        w.appendChild(nm); body.appendChild(w);
      }
      if (party.host) {
        var lockRow = document.createElement('label'); lockRow.className = 'nvp-lock';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!party.lock;
        cb.addEventListener('change', function () { party.lock = cb.checked; logSys(cb.checked ? 'Control exclusivo: solo tú puedes dar play, pausar y saltar' : 'Control exclusivo desactivado: todos pueden controlar'); });
        lockRow.appendChild(cb); lockRow.appendChild(document.createTextNode('Solo el anfitrión controla'));
        body.appendChild(lockRow);
      }
      var chat = document.createElement('div'); chat.className = 'nvp-chat';
      for (i = 0; i < party.msgs.length; i++) {
        var m = party.msgs[i], line = document.createElement('div');
        if (m.sys) { line.className = 's'; line.textContent = m.text; }
        else { line.className = 'l'; var b = document.createElement('b'); b.textContent = m.who + ': '; line.appendChild(b); line.appendChild(document.createTextNode(m.text)); }
        chat.appendChild(line);
      }
      body.appendChild(chat); chat.scrollTop = chat.scrollHeight;
      var chatRow = document.createElement('div'); chatRow.className = 'nvp-row';
      var chatIn = document.createElement('input'); chatIn.id = 'nvp-chatin'; chatIn.className = 'nvp-in'; chatIn.maxLength = 300; chatIn.placeholder = 'Escribe en el chat…';
      var sendBtn = document.createElement('button'); sendBtn.className = 'nvp-btn'; sendBtn.textContent = 'Enviar';
      var doChat = function () { var msg = chatIn.value.trim(); if (!msg || !party) return; send({ t: 'chat', msg: msg }); logChat(party.name, msg); chatIn.value = ''; };
      sendBtn.addEventListener('click', doChat);
      chatIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') doChat(); });
      chatRow.appendChild(chatIn); chatRow.appendChild(sendBtn); body.appendChild(chatRow);
      var lv = document.createElement('button'); lv.className = 'nvp-leave'; lv.textContent = 'Salir de la sala';
      lv.addEventListener('click', function () { leave(false); });
      body.appendChild(lv);
    }
    for (i = 0; i < ids.length; i++) {
      el = document.getElementById(ids[i]);
      if (el && keep[ids[i]]) { el.value = keep[ids[i]].v; if (keep[ids[i]].f) { el.focus(); try { el.setSelectionRange(keep[ids[i]].s, keep[ids[i]].s); } catch (e) { /* nada */ } } }
    }
  }

  /* ---------- Botón del sidebar + glow por sitio ---------- */
  naviris.registerTool({
    id: ID,
    label: 'Watch Party — ver a la vez con amigos',
    icon: 'film',
    onClick: function () { togglePanel(); }
  });
  var btn = document.getElementById(BTN_ID);
  if (btn) btn.innerHTML = ICON_USERS;

  function glow() {
    var b = document.getElementById(BTN_ID); if (!b) return;
    var site = activeSite();
    b.classList.toggle('nvp-live', !!party);
    b.classList.toggle('nvp-netflix', !party && site === 'netflix');
    b.classList.toggle('nvp-crunchy', !party && site === 'crunchy');
  }
  // Sondeo ligero (2 s): la API de addons no expone eventos de navegación. Si el
  // addon se quita/pausa (botón fuera del DOM), se limpia todo solo.
  var glowTimer = setInterval(function () {
    if (!document.getElementById(BTN_ID)) {
      clearInterval(glowTimer); leave(true);
      panel.remove(); css.remove(); document.removeEventListener('mousedown', onAway, true);
      return;
    }
    glow();
    if (!panel.classList.contains('hidden')) render();
  }, 2000);

  function togglePanel(force) {
    var open = force !== undefined ? force : panel.classList.contains('hidden');
    if (open) { panel.classList.remove('hidden'); render(); }
    else panel.classList.add('hidden');
  }
  panel.querySelector('#nvp-close').addEventListener('click', function () { togglePanel(false); });
  function onAway(e) {
    var b = document.getElementById(BTN_ID);
    if (!panel.classList.contains('hidden') && !panel.contains(e.target) && (!b || !b.contains(e.target))) togglePanel(false);
  }
  document.addEventListener('mousedown', onAway, true);

  glow();
})();

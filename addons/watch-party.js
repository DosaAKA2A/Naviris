/* Naviris addon: Watch Party v1.0.0
   Ver series a la vez con amigos en Crunchyroll y Netflix, estilo Teleparty pero
   más simple y sin cuentas de terceros. NO transmite vídeo: cada quien reproduce
   su propia copia con su propia cuenta; el addon solo sincroniza las señales de
   control (play/pausa/seek) y un chat, a través del servidor de watchparty/.

   Requiere que el servidor esté desplegado y su URL configurada abajo (SERVER) o
   en localStorage.__navPartyServer. Reproducir Crunchyroll/Netflix requiere que
   Naviris tenga Widevine (build castlabs ECS); el addon en sí no depende de ello.

   Anfitrión-autoritativo: quien crea la sala manda un latido con su tiempo cada
   2 s; los demás corrigen si se desvían más de 1,5 s. Cualquiera puede dar
   play/pausa/seek (se reenvía al resto). Se evita el eco al aplicar remotos. */
(function () {
  if (window.__navParty) return; window.__navParty = 1;

  var SERVER = localStorage.__navPartyServer || 'wss://party.naviris.site';
  var DRIFT = 1.5;        // segundos de desvío tolerado antes de re-seek
  var BEAT_MS = 2000;     // cada cuánto late el anfitrión
  var ECHO_MS = 900;      // ventana para ignorar eventos provocados por aplicar un remoto

  /* ---------- ¿Página de reproducción? ---------- */
  var host = location.hostname;
  var isNetflix = /netflix\./.test(host);
  var isCrunchy = /crunchyroll\./.test(host);
  if (!isNetflix && !isCrunchy) return;

  /* ---------- Adaptador de vídeo ---------- */
  function getVideo() { return document.querySelector('video'); }

  var netflixPlayer = null;
  function nfPlayer() {
    try {
      if (netflixPlayer) return netflixPlayer;
      var api = window.netflix && netflix.appContext && netflix.appContext.state.playerApp.getAPI().videoPlayer;
      if (!api) return null;
      var ids = api.getAllPlayerSessionIds() || [];
      var sid = ids.find(function (s) { return /watch/.test(s); }) || ids[0];
      netflixPlayer = sid ? api.getVideoPlayerBySessionId(sid) : null;
      return netflixPlayer;
    } catch (e) { return null; }
  }

  var adapter = {
    getTime: function () { var v = getVideo(); return v ? v.currentTime : 0; },
    isPaused: function () { var v = getVideo(); return v ? v.paused : true; },
    play: function () {
      if (isNetflix) { var p = nfPlayer(); if (p) { try { p.play(); return; } catch (e) {} } }
      var v = getVideo(); if (v) v.play().catch(function () {});
    },
    pause: function () {
      if (isNetflix) { var p = nfPlayer(); if (p) { try { p.pause(); return; } catch (e) {} } }
      var v = getVideo(); if (v) v.pause();
    },
    seek: function (t) {
      if (isNetflix) { var p = nfPlayer(); if (p) { try { p.seek(Math.round(t * 1000)); return; } catch (e) {} } }
      var v = getVideo(); if (v) v.currentTime = t;
    }
  };

  /* ---------- Estado de sincronización ---------- */
  var ws = null, room = null, isHost = false, name = 'Yo';
  var applyingUntil = 0;           // hasta cuándo ignorar eventos locales (eco)
  var beatTimer = null;
  var suppressing = function () { return Date.now() < applyingUntil; };
  var markApplying = function () { applyingUntil = Date.now() + ECHO_MS; };

  function send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }

  function applyRemoteEvent(m) {
    markApplying();
    if (m.kind === 'seek') adapter.seek(m.time);
    else if (m.kind === 'play') { if (typeof m.time === 'number' && Math.abs(adapter.getTime() - m.time) > DRIFT) adapter.seek(m.time); adapter.play(); }
    else if (m.kind === 'pause') { adapter.pause(); if (typeof m.time === 'number') adapter.seek(m.time); }
  }

  function applyBeat(m) {
    if (suppressing()) return;
    // Alinear estado de reproducción y corregir deriva.
    if (m.paused && !adapter.isPaused()) { markApplying(); adapter.pause(); }
    else if (!m.paused && adapter.isPaused()) { markApplying(); adapter.play(); }
    if (typeof m.time === 'number' && Math.abs(adapter.getTime() - m.time) > DRIFT) { markApplying(); adapter.seek(m.time); }
  }

  /* ---------- Eventos locales del vídeo -> difundir ---------- */
  var wired = null;
  function wireVideo() {
    var v = getVideo();
    if (!v || v === wired) return;
    wired = v;
    var emit = function (kind) {
      return function () {
        if (!room || suppressing()) return;
        send({ t: 'ev', kind: kind, time: adapter.getTime(), at: Date.now() });
      };
    };
    v.addEventListener('play', emit('play'));
    v.addEventListener('pause', emit('pause'));
    v.addEventListener('seeked', emit('seek'));
  }
  setInterval(wireVideo, 1000); wireVideo();

  /* ---------- Conexión / sala ---------- */
  function connect(code, asHost) {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    room = code; isHost = asHost;
    setStatus('conectando…');
    ws = new WebSocket(SERVER);
    ws.onopen = function () { send({ t: 'join', room: code, name: name, host: asHost }); };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'joined') { setStatus('en la sala ' + m.room + (asHost ? ' (anfitrión)' : '') + ' · ' + m.n + ' viendo'); startBeat(); }
      else if (m.t === 'peers') { setStatus('sala ' + room + (isHost ? ' (anfitrión)' : '') + ' · ' + m.n + ' viendo'); if (m.joined && m.who) log('· ' + m.who + ' se unió'); }
      else if (m.t === 'ev') applyRemoteEvent(m);
      else if (m.t === 'beat') { if (!isHost) applyBeat(m); }
      else if (m.t === 'chat') log((m.from || '?') + ': ' + m.msg);
      else if (m.t === 'error') setStatus('error: ' + m.msg);
    };
    ws.onclose = function () { setStatus('desconectado'); stopBeat(); };
    ws.onerror = function () { setStatus('sin conexión al servidor'); };
  }
  function startBeat() {
    stopBeat();
    if (!isHost) return;
    beatTimer = setInterval(function () { send({ t: 'beat', time: adapter.getTime(), paused: adapter.isPaused(), at: Date.now() }); }, BEAT_MS);
  }
  function stopBeat() { if (beatTimer) { clearInterval(beatTimer); beatTimer = null; } }
  function leaveRoom() { stopBeat(); if (ws) { try { ws.close(); } catch (e) {} ws = null; } room = null; setStatus('fuera de la sala'); }

  function randomCode() {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  /* ---------- Panel (sin emojis, iconografía por texto) ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '#nav-party{position:fixed;left:14px;bottom:14px;z-index:2147483000;width:250px;background:#12141a;color:#e6e8ee;',
    'border:1px solid #2a2f3a;border-radius:10px;font:13px/1.4 Arial,Helvetica,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.55);overflow:hidden}',
    '#nav-party .hd{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#171a22;cursor:default}',
    '#nav-party .hd b{font-size:13px;letter-spacing:.2px}',
    '#nav-party .hd .min{cursor:pointer;color:#9aa2b1;padding:0 4px}',
    '#nav-party .bd{padding:10px 11px;display:flex;flex-direction:column;gap:8px}',
    '#nav-party.min .bd{display:none}',
    '#nav-party .st{font-size:11.5px;color:#9ee2b8;min-height:15px}',
    '#nav-party .row{display:flex;gap:6px}',
    '#nav-party button{flex:1;background:#2a3140;color:#e6e8ee;border:0;border-radius:6px;padding:7px 8px;font:600 12px Arial;cursor:pointer}',
    '#nav-party button:hover{background:#354056}',
    '#nav-party button.p{background:#e0563f;color:#fff}#nav-party button.p:hover{background:#f0664f}',
    '#nav-party input{background:#0d0f14;color:#e6e8ee;border:1px solid #2a2f3a;border-radius:6px;padding:7px 8px;font:12px Arial;min-width:0}',
    '#nav-party .log{height:96px;overflow:auto;background:#0d0f14;border:1px solid #22262f;border-radius:6px;padding:6px 7px;font-size:11.5px;color:#c3c8d2;display:none}',
    '#nav-party .log.on{display:block}',
    '#nav-party .log div{margin:1px 0;word-wrap:break-word}'
  ].join('');
  document.documentElement.appendChild(css);

  var panel = document.createElement('div'); panel.id = 'nav-party';
  panel.innerHTML =
    '<div class="hd"><b>Watch Party</b><span class="min" title="Minimizar">—</span></div>' +
    '<div class="bd">' +
      '<div class="st">fuera de la sala</div>' +
      '<div class="row"><button id="np-create">Crear sala</button></div>' +
      '<div class="row"><input id="np-code" placeholder="código" maxlength="6"><button id="np-join" style="flex:0 0 auto">Unirse</button></div>' +
      '<div class="log" id="np-log"></div>' +
      '<div class="row" id="np-chatrow" style="display:none"><input id="np-chat" placeholder="escribe…"><button id="np-send" style="flex:0 0 auto">Enviar</button></div>' +
      '<div class="row" id="np-leaverow" style="display:none"><button id="np-leave">Salir de la sala</button></div>' +
    '</div>';
  function mount() { if (!document.body) return setTimeout(mount, 200); document.body.appendChild(panel); }
  mount();

  var $ = function (id) { return panel.querySelector(id); };
  function setStatus(s) { var el = $('.st'); if (el) el.textContent = s; }
  function log(line) {
    var el = $('#np-log'); if (!el) return; el.classList.add('on');
    var d = document.createElement('div'); d.textContent = line; el.appendChild(d); el.scrollTop = el.scrollHeight;
  }
  function enterUI(code) {
    $('#np-create').parentNode.style.display = 'none';
    $('#np-code').parentNode.style.display = 'none';
    $('#np-chatrow').style.display = 'flex';
    $('#np-leaverow').style.display = 'flex';
    $('#np-code').value = code;
  }
  function exitUI() {
    $('#np-create').parentNode.style.display = 'flex';
    $('#np-code').parentNode.style.display = 'flex';
    $('#np-chatrow').style.display = 'none';
    $('#np-leaverow').style.display = 'none';
  }

  $('.min').addEventListener('click', function () { panel.classList.toggle('min'); });
  $('#np-create').addEventListener('click', function () { var code = randomCode(); connect(code, true); enterUI(code); log('· Sala creada: ' + code + ' (compártela)'); });
  $('#np-join').addEventListener('click', function () {
    var code = ($('#np-code').value || '').toUpperCase().trim(); if (!code) return;
    connect(code, false); enterUI(code); log('· Uniéndote a ' + code + '…');
  });
  $('#np-leave').addEventListener('click', function () { leaveRoom(); exitUI(); });
  function doChat() { var i = $('#np-chat'); var msg = (i.value || '').trim(); if (!msg || !room) return; send({ t: 'chat', msg: msg }); log(name + ': ' + msg); i.value = ''; }
  $('#np-send').addEventListener('click', doChat);
  $('#np-chat').addEventListener('keydown', function (e) { if (e.key === 'Enter') doChat(); });

  setStatus('fuera de la sala · servidor: ' + SERVER.replace(/^wss?:\/\//, ''));
})();

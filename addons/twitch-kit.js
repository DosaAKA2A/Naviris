/* Naviris addon: Twitch Kit v1.1.0
   Mejoras para VER streams en Twitch, al estilo BetterTTV/7TV pero de Naviris.
   kind "content" (matches twitch.tv): corre DENTRO de la página, como BTTV, así
   que los arreglos de selectores se despliegan por catálogo sin release.

   Funciones v1 (cada una con su toggle en el panel de ajustes):
   - Chat: hora en cada mensaje; fondo alterno; resaltado de menciones y de
     palabras clave propias con sonido y parpadeo del título; recuperar los
     mensajes que borran los mods (se conservan atenuados).
   - UI de Twitch: ocultar por piezas (recomendados, "también ven", stories,
     botones de bits/sub/prime/hype, leaderboard, avisos de la comunidad).
   - Player: clic en el vídeo para pausar/reproducir; saltar el aviso de
     contenido para adultos automáticamente.

   Ajustes: botón "NK" junto al engranaje del chat -> modal propio (estilo
   Naviris, monocromo, sin emojis). Persisten en localStorage.__navTwitchKit. */
(function () {
  if (window.__navTwitchKit) return; window.__navTwitchKit = 1;
  var KEY = '__navTwitchKitCfg';

  var DEF = {
    tsChat: true,        // hora en los mensajes
    altBg: false,        // fondo alterno en el chat
    mentionHi: true,     // resaltar menciones a ti
    mentionSound: true,  // sonido al mencionarte
    titleFlash: true,    // parpadeo del título al mencionarte
    keywords: '',        // palabras clave propias (separadas por comas)
    keepDeleted: true,   // conservar mensajes borrados (atenuados)
    clickPause: true,    // clic en el vídeo = pausa/play
    skipWarnings: true,  // saltar el aviso de contenido
    hideRecommended: false,
    hideAlsoWatch: false,
    hideStories: false,
    hideMonet: false,    // bits, sub, prime, hype chat, combos
    hideLeaderboard: false,
    hideCommunity: false // hype trains, avisos de la comunidad en el chat
  };
  var cfg = DEF;
  try { cfg = Object.assign({}, DEF, JSON.parse(localStorage[KEY] || '{}')); } catch (e) { /* nada */ }
  function save() { try { localStorage[KEY] = JSON.stringify(cfg); } catch (e) { /* nada */ } }

  /* ---------- Usuario propio (para detectar menciones) ---------- */
  function myLogin() {
    try { var m = /(?:^|; )login=([^;]+)/.exec(document.cookie); return m ? decodeURIComponent(m[1]).toLowerCase() : ''; } catch (e) { return ''; }
  }

  /* ---------- CSS dinámico ---------- */
  var style = document.createElement('style'); style.id = 'nk-style';
  function applyCss() {
    var r = [];
    /* base del kit */
    r.push('.nk-time{font-family:ui-monospace,monospace;font-size:10px;color:#9a9da6;opacity:.75;margin-right:5px;vertical-align:baseline}');
    r.push('.nk-mention{background:rgba(185,140,255,.14)!important;box-shadow:inset 3px 0 0 #b98cff}');
    r.push('.nk-keyword{background:rgba(158,226,184,.12)!important;box-shadow:inset 3px 0 0 #9ee2b8}');
    r.push('.nk-deleted{opacity:.55}.nk-deleted .text-fragment{text-decoration:line-through}');
    r.push('.nk-deleted-tag{font-size:10px;color:#e6a9b4;margin-left:6px;font-style:italic}');
    /* Botón del kit en el top-nav (como 7TV/BTTV) */
    r.push('#nk-btn.nk-topnav{display:inline-flex;align-items:center;justify-content:center;align-self:center;height:30px;min-width:34px;padding:0 8px;margin:0 4px;border:none;border-radius:8px;background:rgba(185,140,255,.16);color:#c8a6ff;font-weight:800;font-size:12px;letter-spacing:.5px;cursor:pointer;transition:background .12s}');
    r.push('#nk-btn.nk-topnav:hover{background:rgba(185,140,255,.28);color:#fff}');
    r.push('#nk-btn.nk-chatrow{border:none;background:none;color:#b98cff;font-weight:800;font-size:11px;letter-spacing:.5px;cursor:pointer;padding:4px 6px;border-radius:6px}');
    r.push('#nk-btn.nk-chatrow:hover{background:rgba(185,140,255,.12)}');
    if (cfg.altBg) r.push('.chat-scrollable-area__message-container > div:nth-child(odd) .chat-line__message{background:rgba(255,255,255,.035)}');
    if (cfg.hideRecommended) r.push('[aria-label*="ecomendad" i],[aria-label*="ecommended" i],.side-nav-section[aria-label="Para ti" i],.side-nav-section[aria-label="For You" i]{display:none!important}');
    if (cfg.hideAlsoWatch) r.push('[aria-label*="ambién ven" i],[aria-label*="lso watch" i]{display:none!important}');
    if (cfg.hideStories) r.push('[class*="stories-tray" i],[data-a-target*="stories" i],[aria-label*="istorias" i],[aria-label*="tories" i]{display:none!important}');
    if (cfg.hideMonet) r.push('[data-a-target="bits-button"],[data-a-target="top-nav-get-bits-button"],[data-a-target="subscribe-button"],[data-a-target="gift-button"],[data-a-target="prime-offers-icon"],[data-test-selector="paid-pinned-chat-message-list"],[class*="paid-pinned" i],[class*="combos-button" i],[data-a-target="hype-chat-button"]{display:none!important}');
    if (cfg.hideLeaderboard) r.push('[data-test-selector="channel-leaderboard-container"],[class*="channel-leaderboard" i]{display:none!important}');
    if (cfg.hideCommunity) r.push('[class*="community-highlight" i],[data-test-selector="community-highlight-stack"]{display:none!important}');
    style.textContent = r.join('\n');
    if (!style.parentNode) (document.head || document.documentElement).appendChild(style);
  }

  /* ---------- Sonido de mención (blip corto generado, sin ficheros) ---------- */
  var audioCtx = null, lastBeep = 0;
  function beep() {
    var now = Date.now(); if (now - lastBeep < 3000) return; lastBeep = now; // sin ametrallar
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.4);
    } catch (e) { /* nada */ }
  }

  /* ---------- Parpadeo del título (transitorio, se restaura solo) ---------- */
  var flashTimer = null, titleSaved = null;
  function flashTitle(who) {
    if (flashTimer) return;
    titleSaved = document.title;
    var on = false, n = 0;
    flashTimer = setInterval(function () {
      on = !on; n++;
      document.title = on ? ('[' + (who || 'Mencion') + '] ' + titleSaved) : titleSaved;
      if (n >= 8) { clearInterval(flashTimer); flashTimer = null; document.title = titleSaved; }
    }, 900);
  }

  /* ---------- Chat: observador de mensajes ---------- */
  function fmtClock(d) { var m = String(d.getMinutes()); if (m.length < 2) m = '0' + m; return d.getHours() + ':' + m; }
  function keywordList() {
    return cfg.keywords.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  }
  function decorate(node) {
    if (!node || node.nodeType !== 1 || node.__nk) return;
    var msg = node.classList && node.classList.contains('chat-line__message') ? node : node.querySelector && node.querySelector('.chat-line__message');
    if (!msg || msg.__nk) return;
    msg.__nk = 1;
    // hora
    if (cfg.tsChat && !msg.querySelector('.nk-time')) {
      var t = document.createElement('span'); t.className = 'nk-time'; t.textContent = fmtClock(new Date());
      msg.insertBefore(t, msg.firstChild);
    }
    // texto para resaltados + copia para "recuperar borrados"
    var text = (msg.textContent || '').toLowerCase();
    msg.__nkText = msg.innerHTML;
    var me = myLogin();
    if (cfg.mentionHi && me && text.indexOf('@' + me) !== -1) {
      msg.classList.add('nk-mention');
      if (cfg.mentionSound) beep();
      if (cfg.titleFlash) flashTitle('@' + me);
    } else {
      var kws = keywordList();
      for (var i = 0; i < kws.length; i++) if (text.indexOf(kws[i]) !== -1) { msg.classList.add('nk-keyword'); break; }
    }
  }
  // Borrados: Twitch marca la línea o sustituye el contenido; restauramos la copia
  function handleDeleted(msg) {
    if (!cfg.keepDeleted || !msg.__nkText || msg.__nkRestored) return;
    msg.__nkRestored = 1;
    msg.innerHTML = msg.__nkText;
    msg.classList.add('nk-deleted');
    var tag = document.createElement('span'); tag.className = 'nk-deleted-tag'; tag.textContent = 'eliminado';
    msg.appendChild(tag);
  }
  var chatObs = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      for (var j = 0; j < m.addedNodes.length; j++) decorate(m.addedNodes[j]);
      // detección de borrado: aparece el aviso o cambia la clase
      if (m.target && m.target.classList && m.target.classList.contains('chat-line__message')) {
        if (m.target.querySelector('[data-a-target="chat-deleted-message-placeholder"], .chat-line__message--deleted-notice')) handleDeleted(m.target);
      }
    }
  });
  function armChat() {
    var list = document.querySelector('.chat-scrollable-area__message-container');
    if (list && !list.__nkObs) { list.__nkObs = 1; chatObs.observe(list, { childList: true, subtree: true }); }
  }

  /* ---------- Player: clic para pausar + saltar avisos ---------- */
  document.addEventListener('click', function (e) {
    if (!cfg.clickPause || !e.target || !e.target.closest) return;
    // Acepta el clic en cualquier capa del overlay del player, pero NUNCA sobre
    // controles reales (botones, enlaces, sliders del player)
    if (!e.target.closest('.video-player__overlay') && e.target.tagName !== 'VIDEO') return;
    if (e.target.closest('button,a,input,[role="button"],[role="slider"],[data-a-target="player-controls"]')) return;
    var v = document.querySelector('video'); if (!v) return;
    if (v.paused) v.play().catch(function () {}); else v.pause();
  }, true);
  function skipWarning() {
    if (!cfg.skipWarnings) return;
    var b = document.querySelector('[data-a-target="content-classification-gate-overlay-start-watching-button"], [data-a-target="player-overlay-mature-accept"] button, button[data-a-target*="mature" i]');
    if (b) { try { b.click(); } catch (e) { /* nada */ } }
  }

  /* ---------- Panel de ajustes (botón NK junto al engranaje del chat) ---------- */
  var OPTS = [
    ['sec', 'Chat'],
    ['tsChat', 'Hora en cada mensaje'],
    ['altBg', 'Fondo alterno en el chat'],
    ['mentionHi', 'Resaltar cuando te mencionan'],
    ['mentionSound', 'Sonido al mencionarte'],
    ['titleFlash', 'Parpadeo del titulo al mencionarte'],
    ['keywords', 'Palabras clave propias (separadas por comas)', 'text'],
    ['keepDeleted', 'Conservar mensajes borrados por mods'],
    ['sec', 'Interfaz de Twitch'],
    ['hideRecommended', 'Ocultar canales recomendados'],
    ['hideAlsoWatch', 'Ocultar "los espectadores tambien ven"'],
    ['hideStories', 'Ocultar stories'],
    ['hideMonet', 'Ocultar botones de bits, subs, Prime e hype'],
    ['hideLeaderboard', 'Ocultar leaderboard del canal'],
    ['hideCommunity', 'Ocultar avisos de comunidad (hype train...)'],
    ['sec', 'Player'],
    ['clickPause', 'Clic en el video para pausar/reproducir'],
    ['skipWarnings', 'Saltar el aviso de contenido para adultos']
  ];
  var modal = null;
  function toggleModal() {
    if (modal) { modal.remove(); modal = null; return; }
    modal = document.createElement('div');
    modal.id = 'nk-modal';
    // Anclado bajo el botón del top-nav (esquina superior derecha), como los
    // paneles de 7TV/BTTV; si el botón está en la fila del chat, sube desde abajo.
    var atTop = !!document.querySelector('#nk-btn.nk-topnav');
    var pos = atTop ? 'top:52px;right:16px' : 'bottom:70px;right:352px';
    modal.style.cssText = 'position:fixed;' + pos + ';z-index:2147483000;width:310px;max-height:78vh;overflow:auto;background:#141419;color:#ececef;border:1px solid #2c2c33;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.6);font:13px/1.5 Inter,Arial,sans-serif;padding:16px 16px 18px';
    var h = document.createElement('div');
    h.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;margin-bottom:4px';
    h.textContent = 'Twitch Kit de Naviris';
    var x = document.createElement('button');
    x.textContent = 'Cerrar';
    x.style.cssText = 'margin-left:auto;border:none;background:rgba(255,255,255,.08);color:#ececef;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer';
    x.addEventListener('click', toggleModal);
    h.appendChild(x); modal.appendChild(h);
    OPTS.forEach(function (o) {
      if (o[0] === 'sec') {
        var s = document.createElement('div');
        s.style.cssText = 'margin:14px 2px 8px;font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#5c5e64';
        s.textContent = o[1]; modal.appendChild(s); return;
      }
      if (o[2] === 'text') {
        var wrap = document.createElement('div'); wrap.style.cssText = 'margin:6px 0';
        var inp = document.createElement('input');
        inp.placeholder = o[1]; inp.value = cfg[o[0]] || '';
        inp.style.cssText = 'width:100%;background:rgba(0,0,0,.3);color:#ececef;border:1px solid #2c2c33;border-radius:9px;padding:9px 11px;font-size:12.5px;outline:none;box-sizing:border-box';
        inp.addEventListener('change', function () { cfg[o[0]] = inp.value; save(); applyCss(); });
        wrap.appendChild(inp); modal.appendChild(wrap); return;
      }
      var row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 2px;cursor:pointer;color:#c9ccd4';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!cfg[o[0]];
      cb.style.cssText = 'accent-color:#b98cff';
      cb.addEventListener('change', function () { cfg[o[0]] = cb.checked; save(); applyCss(); });
      var sp = document.createElement('span'); sp.textContent = o[1];
      row.appendChild(cb); row.appendChild(sp); modal.appendChild(row);
    });
    document.body.appendChild(modal);
  }
  function makeBtn() {
    var b = document.createElement('button');
    b.id = 'nk-btn'; b.title = 'Twitch Kit de Naviris'; b.textContent = 'NK';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleModal(); });
    return b;
  }
  function armButton() {
    if (document.getElementById('nk-btn')) return;
    // PREFERIDO: la barra superior de Twitch, en el grupo de iconos de la derecha
    // (notificaciones, whispers, Prime), donde 7TV y BetterTTV ponen los suyos.
    // Se ancla RELATIVO al botón de notificaciones (data-a-target estable):
    // se sube hasta el ancestro que comparte fila con el botón de Prime/bits y se
    // inserta el nuestro justo antes de ese "slot".
    var notif = document.querySelector('[data-a-target="notification-button"], button[aria-label*="otificac" i]');
    var anchor = document.querySelector('.top-nav__prime, [data-a-target="prime-offers-icon"], [data-a-target="top-nav-get-bits-button"], [data-a-target="whispers-menu-button"]');
    if (notif && anchor) {
      var row = notif.parentElement, slot = notif, node = notif;
      for (var i = 0; i < 8; i++) {
        var p = node.parentElement; if (!p) break;
        if (p.contains(anchor) && p.contains(notif)) { row = p; slot = node; break; }
        node = p;
      }
      var b = makeBtn(); b.className = 'nk-topnav';
      row.insertBefore(b, slot);
      return;
    }
    // RESPALDO: la fila de botones del chat (por si cambia el top-nav)
    var host = document.querySelector('.chat-input__buttons-container .tw-align-items-center, .chat-input__buttons-container > div:last-child');
    if (host) {
      var b2 = makeBtn();
      b2.className = 'nk-chatrow';
      host.insertBefore(b2, host.firstChild);
    }
  }

  /* ---------- Bucle de mantenimiento (SPA de Twitch): ligero, 2 s ---------- */
  applyCss();
  setInterval(function () { armChat(); armButton(); skipWarning(); }, 2000);
})();

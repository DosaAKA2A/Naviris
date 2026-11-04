/* Spotify residente y sus widgets: reproductor, siesta en pausa y «Tu música». */

/* ============ Widget Spotify (2026-08-11) ============
   Controla la pestaña ABIERTA de open.spotify.com — sin API ni claves: se lee
   navigator.mediaSession.metadata (título/artista/carátula, lo alimenta el
   propio player web) y se clican los botones reales por data-testid. El sondeo
   (3 s) solo trabaja con el hub visible y se apaga solo al quitar el widget. */
const SP_LEE = `(() => {
  const m = navigator.mediaSession; const md = m && m.metadata;
  const b = document.querySelector('[data-testid="control-button-playpause"]');
  const on = (m && m.playbackState === 'playing') || !!(b && /pausa|pause/i.test(b.getAttribute('aria-label') || ''));
  const art = md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : '';
  const vb = document.querySelector('[data-testid="volume-bar"] input[type=range]');
  const vol = vb ? Math.round((parseFloat(vb.value) / (parseFloat(vb.max) || 1)) * 100) : null;
  return { t: md ? md.title : '', a: md ? md.artist : '', art, on, vol };
})()`;
const SP_SEL = {
  play: ['[data-testid="control-button-playpause"]', 'button[aria-label*="Pausar"]', 'button[aria-label*="Pause"]', 'button[aria-label*="Reproducir"]', 'button[aria-label*="Play"]'],
  next: ['[data-testid="control-button-skip-forward"]', 'button[aria-label*="Siguiente"]', 'button[aria-label*="Next"]'],
  prev: ['[data-testid="control-button-skip-back"]', 'button[aria-label*="Anterior"]', 'button[aria-label*="Previous"]']
};

/* ===== Spotify RESIDENTE (2026-08-11, petición de Dosa) =====
   Webview propio FUERA del sistema de pestañas: no lo duerme el ahorro de
   energía y el audio sigue al navegar por otros sitios. El botón del sidebar
   (bajo el home) abre un panel cápsula; CERRAR el panel solo lo oculta.
   El botón aparece si hay sesión de Spotify (cookie sp_dc, IPC spotify:logged)
   o si el dock ya se usó alguna vez (naviris.spotifyDock). */
let spPlayerWv = null;
/* PANEL DE SPOTIFY (rehecho 2026-08-12).
   Antes el panel medía 392px fijos y forzaba USER AGENT DE MÓVIL, porque a esa
   anchura la web de escritorio se veía apretada. El precio era grave y no se
   había visto: en su web móvil, Spotify CAPA "Tu biblioteca" y te manda a
   instalar la aplicación. Por eso Dosa no podía entrar a su biblioteca.
   Ahora: user agent normal (de escritorio), panel más ancho y ajustable
   arrastrando, y un zoom calculado para que la página crea que tiene al menos
   VIEWPORT_DESKTOP píxeles de ancho — así sirve la interfaz completa aunque el
   panel sea estrecho. */
const SP_VIEWPORT = 900;   // ancho de página mínimo para que Spotify dé la UI de escritorio
const SP_ANCHO_DEF = 720, SP_ANCHO_MIN = 380, SP_ANCHO_MAX = 1280;
function spAncho() {
  const v = +store.get('naviris.spPanelW', SP_ANCHO_DEF) || SP_ANCHO_DEF;
  return Math.max(SP_ANCHO_MIN, Math.min(SP_ANCHO_MAX, v));
}
function aplicaSpAncho(px) {
  const ancho = Math.max(SP_ANCHO_MIN, Math.min(SP_ANCHO_MAX, Math.round(px)));
  const panel = document.getElementById('sp-panel');
  if (panel) panel.style.width = ancho + 'px';
  // Zoom < 1 = la página se cree más ancha de lo que es: con 720px reales y
  // zoom 0.8 ve 900, que es lo que necesita para no caer en la vista móvil.
  if (spPlayerWv) { try { spPlayerWv.setZoomFactor(Math.max(0.5, Math.min(1, ancho / SP_VIEWPORT))); } catch { /* aún no listo */ } }
  return ancho;
}
function ensureSpotifyPlayer() {
  if (spPlayerWv) return spPlayerWv;
  const wv = document.createElement('webview');
  wv.setAttribute('partition', PARTITION);
  // sin scrollbar dentro del panel (el scroll por rueda/gesto sigue vivo)
  wv.addEventListener('dom-ready', () => {
    wv.insertCSS('::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}').catch(() => {});
    aplicaSpAncho(spAncho());
  });
  /* Señales de que lo estás USANDO. Solo marcan la HORA del último uso: si
     además reiniciaban la cuenta atrás no se dormía jamás, porque el propio
     Spotify dispara navegaciones internas solo. Tampoco se escucha
     did-navigate-in-page por lo mismo — y no hace falta: para navegar por
     Spotify tienes que tener el panel abierto, y con el panel abierto no se
     duerme nunca. */
  const usando = () => { spUltimoUso = Date.now(); };
  wv.addEventListener('focus', usando);
  wv.addEventListener('did-navigate', usando);
  /* Al abrir una lista o un album, el widget tiene que ENTERARSE. Antes solo
     se leia al pintar el widget: si abrias la lista despues, se quedaba con
     "abre un album o una lista" para siempre. Aqui solo se marca sucia; el
     repaso de cada 3 s hace la lectura. */
  const cambio = () => { spListaSucia = true; };
  wv.addEventListener('did-navigate', cambio);
  wv.addEventListener('did-navigate-in-page', cambio);
  wv.src = 'https://open.spotify.com';
  document.getElementById('sp-holder').appendChild(wv);
  spPlayerWv = wv;
  store.set('naviris.spotifyDock', true);
  els.sbSpotify.classList.remove('hidden');
  return wv;
}
/* Tirador del canto derecho, como el de los paneles web laterales. */
function armaSpGrip() {
  const panel = document.getElementById('sp-panel');
  const asa = document.getElementById('sp-grip');
  if (!panel || !asa) return;
  asa.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = panel.getBoundingClientRect().width;
    document.body.style.cursor = 'ew-resize';
    const mueve = (ev) => { panel.style.width = Math.max(SP_ANCHO_MIN, Math.min(SP_ANCHO_MAX, w0 + (ev.clientX - x0))) + 'px'; };
    const suelta = () => {
      document.removeEventListener('mousemove', mueve); document.removeEventListener('mouseup', suelta);
      document.body.style.cursor = '';
      store.set('naviris.spPanelW', aplicaSpAncho(panel.getBoundingClientRect().width));
    };
    document.addEventListener('mousemove', mueve); document.addEventListener('mouseup', suelta);
  });
}
function toggleSpotifyPanel(force) {
  const panel = document.getElementById('sp-panel');
  const abrir = force !== undefined ? force : panel.classList.contains('hidden');
  if (abrir) { spUltimoUso = Date.now(); ensureSpotifyPlayer(); spDespierta(false); aplicaSpAncho(spAncho()); panel.classList.remove('hidden'); els.sbSpotify.classList.add('open'); }
  else { panel.classList.add('hidden'); els.sbSpotify.classList.remove('open'); }
  actualizaSpotifyVivo();
}
async function actualizaSpotifyVivo() {
  // La etiqueta "Sonando de fondo" del panel solo si de verdad suena
  const vivo = document.getElementById('sp-p-vivo'); if (!vivo || !spPlayerWv) return;
  try { const st = await spPlayerWv.executeJavaScript(SP_LEE, false); vivo.classList.toggle('hidden', !st.on); }
  catch { vivo.classList.add('hidden'); }
}
function spTab() {
  // El reproductor residente manda; si no existe, vale una pestaña abierta
  if (spPlayerWv) return { webview: spPlayerWv, asleep: false };
  return tabs.find((t) => {
    if (t.asleep || !t.webview) return false;
    try { return new URL(t.url).host === 'open.spotify.com'; } catch { return false; }
  });
}
/* Arranque del dock: glifo de marca, clic, y visibilidad por sesión o uso previo */
els.sbSpotify.innerHTML = window.brandIcon('spotify') || window.icon('musical-note');
els.sbSpotify.addEventListener('click', () => toggleSpotifyPanel());
armaSpGrip();
document.getElementById('sp-p-x').addEventListener('click', () => toggleSpotifyPanel(false));
(async () => {
  if (store.get('naviris.spotifyDock', false)) { els.sbSpotify.classList.remove('hidden'); return; }
  try { if (await window.navirisApp.spotifyLogged()) els.sbSpotify.classList.remove('hidden'); } catch { /* sin IPC: se queda oculto */ }
})();
function spCmd(cmd) {
  spUltimoUso = Date.now();
  const tab = spTab(); if (!tab) return;
  const sels = JSON.stringify(SP_SEL[cmd]);
  tab.webview.executeJavaScript(`(function(){ for (const s of ${sels}) { const b = document.querySelector(s); if (b) { b.click(); return; } } })()`, true).catch(() => {});
  setTimeout(actualizaSpotify, 400); // reflejar el nuevo estado enseguida
}
let spTimer = null;
/* ===== SPOTIFY SE DUERME EN PAUSA (2026-08-13, peticion de Dosa) =====
   El reproductor residente es un webview vivo: su proceso ronda los cientos de
   MB aunque no suene nada. Si la musica lleva PAUSADA 15 s, se manda a
   about:blank y se libera; la URL queda guardada y vuelve sola en cuanto pulsas
   play, abres el panel o eliges una cancion. No se duerme nunca sonando, que
   seria cortarte la musica. */
/* REACTIVADO (2026-08-13). Estuvo apagado mientras se buscaba por qué se
   cerraba la sesión de Spotify: resultó no tener nada que ver — sp_dc es una
   cookie DE SESIÓN y Chromium la tiraba al salir (arreglado en main.js,
   conservaSesiones). Con el culpable encontrado, vuelve el ahorro, pero con
   más margen: cinco minutos en pausa en vez de quince segundos. Liberar
   cientos de MB merece la pena; hacerlo con prisa, no. */
const SP_DORMIR_MS = 5 * 60 * 1000;
const SP_GRACIA_MS = 5 * 60 * 1000;   // margen desde el último uso: cerrar el panel no es dejar de usarlo
let spPausaDesde = 0, spDormido = false, spUrlDormida = '', spUltimoUso = 0, spListaSucia = false, spTicks = 0;
function spDuerme() {
  if (spDormido || !spPlayerWv) return;
  try { spUrlDormida = spPlayerWv.getURL() || 'https://open.spotify.com'; } catch { spUrlDormida = 'https://open.spotify.com'; }
  if (/^about:/.test(spUrlDormida)) return;
  spDormido = true;
  try { spPlayerWv.src = 'about:blank'; } catch { /* nada */ }
  document.querySelectorAll('.w-sp').forEach((el) => el.classList.add('sp-dormido'));
  els.sbSpotify?.classList.add('dormido'); els.sbSpotify?.classList.remove('sonando');
}
/* Despertar: se restaura la pagina y, si se pidio reproducir, se pulsa play en
   cuanto carga (Spotify recupera solo la cancion donde la dejaste). */
function spDespierta(conPlay) {
  if (!spPlayerWv) { ensureSpotifyPlayer(); return; }
  if (!spDormido) { if (conPlay) spCmd('play'); return; }
  spDormido = false; spPausaDesde = 0;
  document.querySelectorAll('.w-sp').forEach((el) => el.classList.remove('sp-dormido'));
  els.sbSpotify?.classList.remove('dormido');
  const alCargar = () => {
    spPlayerWv.removeEventListener('dom-ready', alCargar);
    if (conPlay) setTimeout(() => spCmd('play'), 1800);
  };
  spPlayerWv.addEventListener('dom-ready', alCargar);
  try { spPlayerWv.src = spUrlDormida || 'https://open.spotify.com'; } catch { /* nada */ }
}
/* Cuenta atras de la pausa: solo con el reproductor RESIDENTE (una pestana
   normal de Spotify es del usuario y no se toca). Vive aparte (auditoría
   2026-10): dentro de actualizaSpotify solo corría con el widget puesto y el
   hub a la vista, y el reproductor abierto desde el lateral no se dormía
   nunca. La llaman el repaso del widget (con la lectura que ya hizo) y el de
   30 s del ahorro de energía (que lee aquí). */
async function spCuentaPausa(st) {
  if (!spPlayerWv || spDormido) return;
  if (st === undefined) { try { st = await spPlayerWv.executeJavaScript(SP_LEE, false); } catch { st = null; } }
  // OJO: SP_LEE devuelve on:true con el reproductor VACIO (Spotify deja su
  // boton en ese estado), asi que sonando exige ademas que haya cancion. De
  // paso, un reproductor abierto sin nada cargado tambien se duerme: es un
  // proceso entero gastado en enseniar una portada.
  const sonando = !!(st && st.on && st.t);
  /* CUANDO PUEDE DORMIRSE (corregido 2026-08-13). La primera version solo
     miraba si sonaba algo, y se moria en las narices de Dosa mientras elegia
     musica: navegar por Spotify no es reproducir. Ahora hacen falta TRES
     cosas: que no suene nada, que el panel este CERRADO (con el abierto lo
     estas mirando) y que hayan pasado 60 s desde el ultimo uso — cerrar el
     panel no es dejar de usarlo. */
  const panel = document.getElementById('sp-panel');
  const mirando = panel && !panel.classList.contains('hidden');
  if (sonando || mirando) spPausaDesde = 0;
  else if (!spPausaDesde) spPausaDesde = Date.now();
  else if (SP_DORMIR_MS > 0 && Date.now() - spPausaDesde > SP_DORMIR_MS && Date.now() - spUltimoUso > SP_GRACIA_MS) spDuerme();
}
async function actualizaSpotify() {
  if (!widgets.some((w) => w.type === 'spotify')) { clearInterval(spTimer); spTimer = null; return; }
  const cuerpos = document.querySelectorAll('.w-sp');
  if (!els.hub.classList.contains('active')) return;
  const tab = spTab(); let st = null;
  if (tab && !spDormido) { try { st = await tab.webview.executeJavaScript(SP_LEE, false); } catch { st = null; } }
  spCuentaPausa(st);
  // Usar Spotify en pestaña también revela el dock (además de la cookie de
  // sesión): la señal "tiene cuenta" más fiable es que lo esté usando.
  if (tab) els.sbSpotify.classList.remove('hidden');
  cuerpos.forEach((el) => pintaSpotify(el, st, !!tab));
  /* El botón del sidebar cuenta lo que pasa (2026-08-13): VERDE mientras suena
     algo, apagado cuando el reproductor está dormido, y normal en pausa. */
  if (els.sbSpotify) {
    els.sbSpotify.classList.toggle('sonando', !!(st && st.on && st.t) && !spDormido);
    els.sbSpotify.classList.toggle('dormido', spDormido);
    els.sbSpotify.title = spDormido ? 'Spotify — dormido, haz clic para volver'
      : (st && st.on && st.t) ? 'Spotify — sonando: ' + st.t
      : 'Spotify — tu música mientras navegas';
  }
  // Relectura de la lista: al navegar por Spotify, y de todos modos cada 15 s
  // como red de seguridad (su reproductor no avisa de todo lo que cambia).
  spTicks++;
  if (tab && !spDormido && (spListaSucia || spTicks % 5 === 0)) {
    spListaSucia = false;
    cuerpos.forEach((el) => llenaListas(el));
  }
}
function pintaSpotify(el, st, hayTab) {
  const sl = el.querySelector('.sp-vol-sl');
  if (sl && st && st.vol != null && !sl.dataset.tocando) sl.value = String(st.vol);
  const img = el.querySelector('.sp-art img'), tit = el.querySelector('.sp-tit'), sub = el.querySelector('.sp-sub');
  const abre = el.querySelector('.sp-abre'), play = el.querySelector('.sp-play');
  const hay = !!(st && st.t);
  el.classList.toggle('sp-vacio', !hay);
  abre.classList.toggle('hidden', hay || hayTab);
  // Con pestaña de Spotify los controles SIEMPRE sirven (clican los botones
  // reales del player), haya o no metadatos — sin pestaña, se apagan.
  el.querySelectorAll('.sp-b').forEach((b) => { b.disabled = !hayTab; });
  if (!hay) {
    tit.textContent = 'Spotify';
    sub.textContent = hayTab ? 'Spotify está abierto — reproduce algo para verlo aquí' : 'Abre open.spotify.com y controla la música desde aquí';
    img.removeAttribute('src'); return;
  }
  if (tit.textContent !== st.t) { tit.textContent = st.t; tit.title = st.t; }
  if (sub.textContent !== (st.a || '')) sub.textContent = st.a || '';
  if (st.art && img.getAttribute('src') !== st.art) img.src = st.art;
  const icono = st.on ? 'pause' : 'play';
  if (play.dataset.ic !== icono) { play.dataset.ic = icono; play.innerHTML = window.icon(icono); }
}
function renderSpotify(body) {
  // Reproductor + "Tu música" en UNA tarjeta (mock de Dosa: van juntos):
  // arriba el player con su FAB fundido al canto; debajo, tus listas.
  body.innerHTML = `
    <div class="sp-player">
      <div class="sp-art">${window.icon('musical-note')}<img alt="" /></div>
      <div class="sp-meta">
        <div class="sp-tit">Spotify</div>
        <div class="sp-sub">Abre open.spotify.com y controla la música desde aquí</div>
        <div class="sp-ctr">
          <button class="sp-b" data-cmd="prev" title="Anterior" disabled>${window.icon('skip-back')}</button>
          <button class="sp-b" data-cmd="next" title="Siguiente" disabled>${window.icon('skip-forward')}</button>
          <span class="sp-vol-ic" title="Volumen">${window.icon('speaker-wave')}</span>
          <input type="range" class="sp-vol-sl" min="0" max="100" value="70" title="Volumen" />
          <button class="sp-abre">Abrir Spotify</button>
        </div>
      </div>
    </div>
    <div class="sp-bib">
      <div class="w-head"><span class="spl-rotulo">Tu música</span><button class="wh-btn spl-rf" title="Actualizar">${window.icon('arrow-path')}</button></div>
      <div class="spl-lista"><div class="w-vacio">Conecta Spotify para ver tus listas</div></div>
    </div>
    <button class="sp-play sp-b" data-cmd="play" title="Reproducir / pausa" data-ic="play">${window.icon('play')}</button>`;
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]'); if (!b || b.disabled) return;
    e.stopPropagation();
    // Dormido, el play tiene que despertarlo primero (y los demas mandos
    // tambien, o pulsarian sobre una pagina en blanco).
    if (spDormido) { spDespierta(b.dataset.cmd === 'play'); return; }
    spCmd(b.dataset.cmd);
  });
  // "Abrir Spotify" levanta el reproductor RESIDENTE (no una pestaña): la
  // música sobrevive a la navegación y el botón del dock queda en el sidebar.
  body.querySelector('.sp-abre').addEventListener('click', (e) => { e.stopPropagation(); toggleSpotifyPanel(true); setTimeout(() => llenaListas(body), 5000); });
  body.querySelector('.spl-rf').addEventListener('click', (e) => { e.stopPropagation(); llenaListas(body); });
  const desliz = body.querySelector('.sp-vol-sl');
  if (desliz) {
    // Mientras lo arrastras, el repaso de cada 3 s NO debe pisarte el valor.
    const marca = () => { desliz.dataset.tocando = '1'; clearTimeout(desliz._t); desliz._t = setTimeout(() => { delete desliz.dataset.tocando; }, 1200); };
    ['pointerdown', 'input'].forEach((ev) => desliz.addEventListener(ev, marca));
    desliz.addEventListener('click', (e) => e.stopPropagation());
    desliz.addEventListener('input', () => {
      const t = spTab(); if (!t) return;
      t.webview.executeJavaScript(SPL_VOL(+desliz.value), true).catch(() => {});
      spUltimoUso = Date.now();
    });
  }
  spTimer = relojHub(spTimer, actualizaSpotify, 3000);
  actualizaSpotify();
  llenaListas(body);
}
async function llenaListas(body) {
  const cont = body.querySelector('.spl-lista'); if (!cont) return;
  const t = spTab();
  const rotulo = body.querySelector('.spl-rotulo');
  if (!t) { cont.innerHTML = '<div class="w-vacio">Conecta Spotify para ver tus listas</div>'; return; }
  let r = null;
  try { r = await t.webview.executeJavaScript(SPL_LEE, false); } catch { /* aún cargando */ }
  const items = (r && r.items) || [];
  if (rotulo) rotulo.textContent = r && r.fuente === 'cola' ? 'A continuación'
    : r && r.fuente === 'biblioteca' ? 'Tu biblioteca' : 'Lista abierta';
  cont.innerHTML = items.map((l) => `<button class="spl-i" data-i="${Number(l.i) || 0}" data-h="${escapeHtml(l.h || '')}"><span class="spl-t">${escapeHtml(l.t)}</span>${l.sub ? `<span class="spl-sub">${escapeHtml(l.sub)}</span>` : ''}${window.icon('play')}</button>`).join('') ||
    (r && r.fuente === 'ilegible'
      ? '<div class="w-vacio">Tienes una lista abierta pero no pude leer sus canciones — haz clic en actualizar</div>'
      : '<div class="w-vacio">Abre un álbum o una lista en Spotify y aparecerán sus canciones</div>');
  cont.querySelectorAll('.spl-i').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (spDormido) { spDespierta(true); return; }
    const wv = spTab(); if (!wv) return;
    if (b.dataset.h) { splReproduce(b.dataset.h); return; }   // fila de biblioteca: se abre y suena
    wv.webview.executeJavaScript(SPL_TOCA(+b.dataset.i), true).catch(() => {});
    setTimeout(actualizaSpotify, 600);
  }));
  // Aquí SÍ hay scroll (con la barra propia de Naviris): un álbum entero no
  // cabe en la tarjeta y ocultar lo que sobra dejaba media lista invisible.
}

/* ============ Widget "Tu música": listas del Spotify residente ============
   Lee las playlists/álbumes de la biblioteca del webview de Spotify (los
   enlaces reales de su sidebar) y al clicar navega el reproductor a la lista
   y pulsa su play grande. Sin API ni claves: es TU sesión. */
/* LA LISTA DEL WIDGET = LO QUE VIENE DESPUÉS (reescrito 2026-08-13 con el DOM
   real de Spotify delante, gracias a que Dosa abrió el CDP con su cuenta).
   Comprobado en una playlist de verdad: las pistas son [data-testid=
   "tracklist-row"] y el título vive en [data-testid="internal-track-link"];
   el resto de la fila trae el número, la duración y el artista.
   ANTES fallaba por dos cosas: se leía la PORTADA (si no hay lista abierta no
   hay pistas) y había un respaldo genérico por [role="row"] que en la portada
   casaba con sus rejillas e inventaba filas — de ahí que salieran "Título" y
   una sola canción. Ese respaldo se retira: mejor decir que no hay lista que
   enseñar basura. */
const SPL_LEE = `(async () => {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  // Al abrir una lista, sus filas tardan un momento en montarse
  for (let i = 0; i < 4; i++) {
    if (document.querySelectorAll('[data-testid="tracklist-row"]').length) break;
    await esperar(500);
  }
  const lim = (x) => (x || '').trim().replace(/\\s+/g, ' ').slice(0, 70);
  const filas = [...document.querySelectorAll('[data-testid="tracklist-row"]')];
  if (filas.length) {
    /* Se exige el ENLACE REAL de la pista (con href). Leyendo a media carga
       entraban la fila de cabecera ("Título/Álbum") y esqueletos repetidos:
       ninguno tiene href, así que con esto se caen solos. El href sirve además
       para quitar duplicados de la lista virtualizada. */
    const vistos = new Set();
    const items = filas.slice(0, 24).map((f, i) => {
      const enlace = f.querySelector('[data-testid="internal-track-link"]');
      const href = enlace && enlace.getAttribute('href');
      if (!href || vistos.has(href)) return null;
      vistos.add(href);
      const t = lim(enlace.textContent);
      if (!t) return null;
      const lineas = (f.innerText || '').split('\\n').map((x) => x.trim()).filter(Boolean);
      // Se descartan el número de pista, la duración y la marca de explícito
      const sub = lim(lineas.find((l) => l !== t && l !== 'E' && l.length > 1 &&
        !/^\\d+$/.test(l) && !/^\\d+:\\d\\d$/.test(l)) || '');
      return { t, sub, i };
    }).filter(Boolean);
    if (items.length) return { fuente: 'lista', items: items.slice(0, 20) };
  }
  // La barra de TU BIBLIOTECA, cuando no hay lista abierta pero sí barra
  const bib = document.querySelector('[data-testid="library-container"], nav[aria-label*="iblioteca"], nav[aria-label*="ibrary"]');
  if (bib) {
    const vis = new Set(); const out = [];
    bib.querySelectorAll('a[href^="/playlist/"], a[href^="/album/"], a[href^="/collection/"]').forEach((a) => {
      const t = lim(a.getAttribute('aria-label') || a.textContent);
      const h = a.getAttribute('href');
      if (t && h && !vis.has(h)) { vis.add(h); out.push({ t, sub: '', h }); }
    });
    if (out.length) return { fuente: 'biblioteca', items: out.slice(0, 12) };
  }
  const dentro = /\\/(playlist|album|artist|collection)\\//.test(location.pathname);
  return { fuente: dentro ? 'ilegible' : 'nada', items: [] };
})()`;
/* Reproducir la pista N de esa misma lista: Spotify no expone enlace de
   reproduccion, asi que se pulsa el boton de play de la fila y, si no lo
   encuentra (solo aparece al pasar el raton), se le manda un doble clic, que
   es como se reproduce una fila en su reproductor. */
const SPL_TOCA = (i) => `(() => {
  const f = document.querySelectorAll('[data-testid="tracklist-row"]')[${i}];
  if (!f) return false;
  const b = f.querySelector('button[data-testid="play-button"], button[aria-label*="Reproducir"], button[aria-label*="Play"]');
  if (b) { b.click(); return true; }
  f.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return true;
})()`;
/* VOLUMEN (peticion de Dosa): se mueve la barra del propio Spotify, asi el
   cambio se ve en su interfaz y sobrevive a los cambios de cancion. React
   ignora un value asignado a pelo: hay que usar el setter nativo y avisar. */
/* VOLUMEN. Se mueve la barra del propio Spotify (asi el cambio se ve en su
   interfaz y sobrevive al cambio de cancion). React ignora un value asignado a
   pelo: hay que usar el setter nativo y avisar con input/change. El deslizador
   manda un porcentaje ABSOLUTO, no pasos. */
const SPL_VOL = (pct) => `(() => {
  const inp = document.querySelector('[data-testid="volume-bar"] input[type=range]');
  if (!inp) return null;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const max = parseFloat(inp.max) || 1;
  const v = Math.max(0, Math.min(max, (${pct} / 100) * max));
  set.call(inp, String(v));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return Math.round((v / max) * 100);
})()`;
function splReproduce(h) {
  const wv = ensureSpotifyPlayer();
  const alCargar = () => {
    wv.removeEventListener('dom-ready', alCargar);
    // El play grande de la lista tarda en montarse (SPA): reintenta hasta 8 s
    wv.executeJavaScript(`(function(){ let n = 0; const t = setInterval(() => {
      const b = document.querySelector('[data-testid="action-bar-row"] [data-testid="play-button"], button[aria-label^="Reproducir"], button[aria-label^="Play"]');
      if (b) { b.click(); clearInterval(t); } else if (++n > 16) clearInterval(t);
    }, 500); })()`, true).catch(() => {});
  };
  wv.addEventListener('dom-ready', alCargar);
  wv.src = 'https://open.spotify.com' + h;
  toggleSpotifyPanel(true);
}

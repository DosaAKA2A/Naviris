/* Herramientas del riel: anclaje de popovers, AutoLoot, Rat Tool, resoluciones, etiqueta de los botones, inicio y ajustes. */

/* Ancla un popover de herramienta JUNTO a su botón del sidebar. Antes iban
   clavados abajo por CSS (de cuando sus botones vivían abajo) y se abrían
   lejos del botón — queja del usuario 2026-08-11. */
function anclarPanelIzq(panel, btn) {
  const r = btn.getBoundingClientRect();
  panel.style.top = '0px';
  const h = panel.offsetHeight;
  panel.style.top = Math.max(8, Math.min(Math.round(r.top - 8), window.innerHeight - h - 12)) + 'px';
  panel.style.left = Math.round(r.right + 12) + 'px';
}
function anclarPop(pop, btn) {
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.round(r.right + 14) + 'px';
  pop.style.bottom = 'auto';
  pop.style.top = '0px'; // visible y medible antes de colocarlo
  const h = pop.offsetHeight;
  pop.style.top = Math.max(8, Math.min(Math.round(r.top), window.innerHeight - h - 12)) + 'px';
}
/* Cierra los popovers de herramientas: lo llama el clic fuera (UI) y el foco
   de cualquier webview (los clics DENTRO de la página no burbujean hasta
   aquí, así que sin esto los popovers se quedaban abiertos). */
function cerrarPopsHerramientas() {
  if (els.ratPop && !els.ratPop.classList.contains('hidden')) { els.ratPop.classList.add('hidden'); els.sbRat.classList.remove('open'); }
  if (els.resPop && !els.resPop.classList.contains('hidden')) { els.resPop.classList.add('hidden'); els.sbRes.classList.toggle('open', !!resMode); }
  if (!els.lootPanel.classList.contains('hidden')) toggleLootPanel(false);
  if (!els.shieldPop.classList.contains('hidden')) { els.shieldPop.classList.add('hidden'); els.navShield.classList.remove('open'); clearInterval(adblockPoll); adblockPoll = null; }
  cerrarSitePop();
  els.menuPop.classList.add('hidden');
  closeFolderPop();
  if (!els.espPop.classList.contains('hidden')) alternaEspacios();
}

/* ============ Loot: registro de recompensas del auto-reclamo ============ */
let loot = store.get('naviris.loot', []);
function recordLoot(kind, channel, info) {
  info = info || {};
  loot.unshift({ t: Date.now(), kind: kind === 'drop' ? 'drop' : 'points', channel: channel || '', name: info.name || '', balance: (typeof info.balance === 'number' ? info.balance : null) });
  if (loot.length > 500) loot = loot.slice(0, 500);
  store.set('naviris.loot', loot);
  updateLootUI();
}

/* ============ Panel de AutoLoot (integrado en el core) ============ */
let lootView = 'ses'; // 'ses' | 'hist'
// Ilumina el botón del sidebar cuando hay sesiones recolectando y refresca el
// panel si está abierto.
function updateLootUI() {
  const active = tabs.some((t) => t.autoLoot);
  els.sbLoot.classList.toggle('collecting', active);
  if (!els.lootPanel.classList.contains('hidden')) renderLootPanel();
}
let lootTimer = null;
function fmtDur(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm';
  return (s % 60) + 's';
}
function toggleLootPanel(force) {
  const open = force !== undefined ? force : els.lootPanel.classList.contains('hidden');
  if (open) {
    closeRightPanels(); els.lootPanel.classList.remove('hidden'); els.sbLoot.classList.add('open'); renderLootPanel();
    anclarPanelIzq(els.lootPanel, els.sbLoot); // pegado a SU botón, no arriba del todo
    // Mientras el panel esté abierto, refresca el temporizador de cada sesión.
    if (!lootTimer) lootTimer = setInterval(() => {
      if (els.lootPanel.classList.contains('hidden')) { clearInterval(lootTimer); lootTimer = null; return; }
      if (lootView !== 'ses') return;
      // Solo cambian el tiempo y la cuenta: rehacer el panel entero se comía los clics en sus botones.
      const s = tabs.find((t) => t.autoLoot), row = els.lootBody.querySelector('.loot-ses');
      if (!s !== !row) { renderLootPanel(); return; }   // la sesión empezó o acabó por otro lado
      if (!row) return;
      row.querySelector('.ls-name').textContent = s.title || s.url;
      row.querySelector('.ls-time').textContent = s.lootStart ? ('farmeando ' + fmtDur(Date.now() - s.lootStart)) : '';
      row.querySelector('.ls-n').textContent = s.twitchClaims || 0;
    }, 10000);
  } else {
    els.lootPanel.classList.add('hidden'); els.sbLoot.classList.remove('open');
    if (lootTimer) { clearInterval(lootTimer); lootTimer = null; }
  }
}
function renderLootPanel() {
  els.lootTabSes.classList.toggle('active', lootView === 'ses');
  els.lootTabHist.classList.toggle('active', lootView === 'hist');
  const twitch = activeIsTwitch();
  // AutoClaim v2: sesión ÚNICA (un solo canal a la vez)
  const s = tabs.find((t) => t.autoLoot) || null;
  const cur = activeTab();
  const body = els.lootBody; body.innerHTML = '';
  if (lootView === 'ses') {
    if (!s) {
      const go = document.createElement('button'); go.id = 'loot-go'; go.className = 'loot-go' + (twitch ? '' : ' off');
      go.textContent = 'Activar en este canal'; go.disabled = !twitch;
      go.addEventListener('click', () => { activateAutoLoot(activeTab()); renderLootPanel(); });
      body.appendChild(go);
      const hint = document.createElement('div'); hint.className = 'loot-hint';
      hint.textContent = twitch
        ? 'Silencia el canal, baja la resolución solo en esa pestaña y reclama puntos y drops en segundo plano. Un canal a la vez.'
        : 'Abre un canal de Twitch para poder activar el AutoClaim.';
      body.appendChild(hint);
    } else {
      body.appendChild(lootLabel('CANAL EN FARMEO'));
      const row = document.createElement('div'); row.className = 'loot-ses';
      row.innerHTML = '<span class="ls-dot"></span><span class="ls-info"><span class="ls-name"></span><span class="ls-time"></span></span><span class="ls-n"></span>';
      row.querySelector('.ls-name').textContent = s.title || s.url;
      const tspan = row.querySelector('.ls-time');
      tspan.textContent = s.lootStart ? ('farmeando ' + fmtDur(Date.now() - s.lootStart)) : '';
      tspan.title = 'Tiempo que el AutoClaim lleva trabajando en este canal';
      const nspan = row.querySelector('.ls-n');
      nspan.textContent = s.twitchClaims || 0;
      nspan.title = 'Reclamos (puntos + drops) en esta sesión';
      const go2 = document.createElement('button'); go2.className = 'ls-btn'; go2.textContent = 'ir'; go2.addEventListener('click', () => activateTab(s.id));
      const stop = document.createElement('button'); stop.className = 'ls-btn stop'; stop.textContent = 'detener'; stop.addEventListener('click', () => { setAutoLoot(s, false); renderLootPanel(); });
      row.append(go2, stop); body.appendChild(row);
      // Estás viendo OTRO canal de Twitch: ofrecer mover el farmeo aquí
      if (twitch && cur && cur.id !== s.id) {
        const sw = document.createElement('button'); sw.className = 'loot-go'; sw.style.marginTop = '10px';
        sw.textContent = 'Cambiar el farmeo a este canal';
        sw.addEventListener('click', () => { activateAutoLoot(cur); renderLootPanel(); });
        body.appendChild(sw);
      }
      const hint2 = document.createElement('div'); hint2.className = 'loot-hint';
      hint2.textContent = 'Solo se farmea un canal a la vez: activar en otro canal detiene este.';
      body.appendChild(hint2);
    }
  } else {
    const pts = loot.filter((l) => l.kind === 'points').length, drops = loot.filter((l) => l.kind === 'drop').length;
    body.appendChild(lootLabel('LOOT OBTENIDO', pts + ' cofres · ' + drops + ' drops'));
    if (!loot.length) { const e = document.createElement('div'); e.className = 'loot-empty'; e.textContent = 'Aún no se ha reclamado nada.'; body.appendChild(e); }
    // Agrupado por canal: nº de cofres de puntos + saldo, y los drops con su nombre.
    const groups = new Map();
    for (const l of loot) { const k = (l.channel || 'Twitch').replace(/^www\./, ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
    const order = [...groups.entries()].sort((a, b) => b[1][0].t - a[1][0].t);
    for (const [chan, items] of order) {
      const ptsItems = items.filter((x) => x.kind === 'points');
      const dropItems = items.filter((x) => x.kind === 'drop');
      const bals = ptsItems.map((x) => x.balance).filter((x) => typeof x === 'number');
      const bal = bals.length ? Math.max(...bals) : null;
      const card = document.createElement('div'); card.className = 'loot-hgroup';
      const head = document.createElement('div'); head.className = 'lhg-head';
      const nm = document.createElement('span'); nm.className = 'lhg-name'; nm.textContent = chan;
      const sum = document.createElement('span'); sum.className = 'lhg-sum';
      sum.textContent = `${ptsItems.length} cofres` + (bal != null ? ` · ${bal.toLocaleString('es')} pts` : '') + (dropItems.length ? ` · ${dropItems.length} drops` : '');
      head.append(nm, sum); card.appendChild(head);
      for (const d of dropItems.slice(0, 40)) {
        const row = document.createElement('div'); row.className = 'lhg-drop';
        const ic = document.createElement('span'); ic.className = 'lh-ic'; ic.innerHTML = window.icon('gift');
        const dn = document.createElement('span'); dn.className = 'lh-name'; dn.textContent = d.name || 'Drop reclamado';
        const when = document.createElement('span'); when.className = 'lh-when';
        when.textContent = new Date(d.t).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        row.append(ic, dn, when); card.appendChild(row);
      }
      body.appendChild(card);
    }
    if (loot.length) { const c = document.createElement('button'); c.className = 'loot-clear-btn'; c.textContent = 'Vaciar historial'; c.addEventListener('click', () => { loot = []; store.set('naviris.loot', loot); renderLootPanel(); }); body.appendChild(c); }
  }
}
function lootLabel(t, extra) {
  const d = document.createElement('div'); d.className = 'loot-lbl';
  d.innerHTML = '<span></span><span class="ll-x"></span>';
  d.firstChild.textContent = t; d.querySelector('.ll-x').textContent = extra || '';
  return d;
}
els.sbLoot.addEventListener('click', () => toggleLootPanel());
els.lootClose.addEventListener('click', () => toggleLootPanel(false));
els.lootTabSes.addEventListener('click', () => { lootView = 'ses'; renderLootPanel(); });
els.lootTabHist.addEventListener('click', () => { lootView = 'hist'; renderLootPanel(); });

/* ============ AutoLoot (por pestaña) ============ */
function setAutoLoot(tab, on) {
  if (!tab || tab.kind !== 'web') return;
  tab.autoLoot = !!on;
  if (on) { if (!tab.lootStart) tab.lootStart = Date.now(); } // marca de inicio para el temporizador
  else { tab.lowRes = false; tab.twitchClaims = 0; delete tab.lootStart; }
  try { tab.webview?.send('naviris-autoloot', { on: !!on, lowRes: !!tab.lowRes }); } catch { /* nada */ }
  renderTabs(); updateLootUI();
}
function activateAutoLoot(tab) {
  if (!tab || tab.kind !== 'web') return;
  // AutoClaim v2: UN solo canal a la vez (no se puede farmear dos, decisión de
  // producto). Activar aquí apaga cualquier sesión anterior.
  for (const t of tabs) if (t.autoLoot && t.id !== tab.id) setAutoLoot(t, false);
  tab.lowRes = true; tab.autoLoot = true;
  if (!tab.lootStart) tab.lootStart = Date.now(); // inicio del temporizador de trabajo
  if (!tab.muted) { tab.muted = true; try { tab.webview?.setAudioMuted(true); } catch { /* nada */ } }
  // La calidad ahora baja desde el menú del reproductor (en caliente), así que
  // ya no hace falta recargar la pestaña ni reiniciar el stream.
  try { tab.webview?.send('naviris-autoloot', { on: true, lowRes: true }); } catch { /* nada */ }
  renderTabs(); updateLootUI();
  toast('AutoClaim activo: canal silenciado y en resolución mínima');
}

/* ============ Rat Tool ============ */
// Plataformas y "¿es un video concreto?" viven en rat.js (window.ratTool): las
// mismas reglas que usa el proceso principal y que prueba test/rat.test.js.
// Extrae la URL del vídeo que se está viendo. En el feed de TikTok (/foryou) la
// barra no cambia, así que buscamos el vídeo concreto por varias vías.
function resolveMediaUrl() {
  const RX = /youtu\.be\/|\/(watch|shorts|video|status|reel|reels|clip|p|tv|embed)(\/|\?|$)/i;
  const ok = (u) => u && RX.test(u) ? u : null;
  // 1. Si la propia URL ya es de un vídeo, úsala
  if (ok(location.href)) return location.href;
  // 2. canonical / og:url (páginas de vídeo directas)
  const c = document.querySelector('link[rel="canonical"]'); if (ok(c && c.href)) return c.href;
  const og = document.querySelector('meta[property="og:url"]'); if (ok(og && og.content)) return og.content;
  // 3. Feeds (TikTok FYP, etc.): el enlace a /video/ más centrado en el viewport
  const cy = window.innerHeight / 2;
  let best = null, bestD = Infinity;
  document.querySelectorAll('a[href*="/video/"], a[href*="/status/"], a[href*="/reel/"]').forEach((a) => {
    if (!ok(a.href)) return;
    const r = a.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.width < 30 || r.height < 30) return;
    const d = Math.abs((r.top + r.bottom) / 2 - cy);
    if (d < bestD) { bestD = d; best = a.href; }
  });
  if (best) return best;
  // 4. Último recurso: el vídeo en reproducción → ancestro con enlace a /video/
  const vids = [...document.querySelectorAll('video')];
  const playing = vids.find((v) => !v.paused && v.currentTime > 0) || vids[0];
  if (playing) { let el = playing; for (let i = 0; i < 10 && el; i++, el = el.parentElement) { const a = el.querySelector && el.querySelector('a[href*="/video/"], a[href*="/status/"]'); if (a && ok(a.href)) return a.href; } }
  return location.href;
}
// ¿La pestaña activa es Twitch?
function activeIsTwitch() { const t = activeTab(); return t?.kind === 'web' && /(^|\.)twitch\.tv$/.test(hostOf(t.url)); }

els.sbRat.addEventListener('click', async (e) => {
  e.stopPropagation();
  const open = els.ratPop.classList.contains('hidden'); els.ratPop.classList.toggle('hidden'); els.sbRat.classList.toggle('open', open);
  if (!open) return;
  anclarPop(els.ratPop, els.sbRat);
  const tab = activeTab();
  els.ratHeadsub.textContent = 'Descargar video o audio';
  let url = tab?.kind === 'web' ? tab.url : '';
  // 1º: el vídeo de la PÁGINA ACTUAL (así, al pasar de TikTok a YouTube, detecta YouTube)
  if (tab?.kind === 'web' && tab.webview) { try { const real = await tab.webview.executeJavaScript(`(${resolveMediaUrl.toString()})()`); if (real) url = real; } catch {} }
  // 2º: solo si la página actual NO es un vídeo, usa el enlace copiado (útil en Instagram: copiar enlace → detectar)
  if (!window.ratTool.esVideo(url)) {
    try { const clip = (await window.navirisApp.readClipboard() || '').trim(); if (/^https?:\/\/\S+$/i.test(clip)) url = clip; } catch {}
  }
  els.ratUrl.value = url; updateRatPlat();
  els.ratXcheck.checked = !!settings.xRevealSensitive;
  els.ratQrow.classList.add('hidden'); loadRatQualities();
  const ok = await window.navirisApp.ytAvailable();
  els.ratNote.textContent = ok ? 'Se guarda en Descargas. En TikTok abre un video concreto; se baja sin marca de agua.' : 'No se pudo preparar el descargador. Reinicia Naviris e inténtalo de nuevo.';
});

function updateRatPlat() {
  const url = els.ratUrl.value.trim(); const p = window.ratTool.plataforma(url);
  const tab = activeTab(); const onSite = tab?.kind === 'web' && p && hostOf(tab.url) === hostOf(url);
  const looksVideo = window.ratTool.esVideo(url);
  // Tarjeta de detección con logo + URL cuando estás en la web y es un video
  // (en el feed decía a la vez "Video detectado" y "Abre un video concreto")
  if (p && onSite && looksVideo) {
    els.ratDetect.classList.remove('hidden');
    els.ratDetectLogo.innerHTML = p.marca ? window.brandIcon(p.marca) : window.icon('film');
    els.ratDetectName.textContent = 'Video en ' + p.nombre + ' detectado';
    els.ratDetectUrl.textContent = url;
  } else els.ratDetect.classList.add('hidden');
  // Toggle de sensibilidad solo en X
  const onX = p && p.id === 'x' && onSite;
  els.ratXtoggle.classList.toggle('hidden', !onX);
  if (window.ratTool.esLista(url)) els.ratPlat.innerHTML = `<b style="color:var(--danger)">Es una lista de reproducción</b>: abre uno de sus videos para descargarlo.`;
  else if (window.ratTool.esDirecto(url)) els.ratPlat.innerHTML = `<b style="color:var(--danger)">Es un directo</b>: cuando acabe, descarga el video desde la pestaña Videos del canal.`;
  else if (p && !looksVideo) els.ratPlat.innerHTML = `<b style="color:var(--danger)">Abre un video concreto</b> o pega su enlace (en el feed no se detecta).`;
  else els.ratPlat.innerHTML = p ? `Plataforma: <b>${p.nombre}</b>` : (url ? 'Se intentará con yt-dlp.' : '');
}
let ratQualityToken = 0, ratQualityTimer = null;
async function loadRatQualities() {
  const url = els.ratUrl.value.trim();
  if (!/^https?:\/\//.test(url)) { els.ratQrow.classList.add('hidden'); return; }
  const token = ++ratQualityToken;
  els.ratQrow.classList.remove('hidden');
  els.ratQuality.innerHTML = '<option value="">Cargando resoluciones…</option>';
  let heights = [];
  try { heights = await window.navirisApp.ytFormats(url); } catch {}
  if (token !== ratQualityToken) return; // llegó otra petición más nueva
  if (!heights.length) { els.ratQuality.innerHTML = '<option value="">Máxima calidad</option>'; return; }
  els.ratQuality.innerHTML = '<option value="">Máxima calidad</option>';
  heights.forEach((h) => { const o = document.createElement('option'); o.value = String(h); o.textContent = h + 'p'; els.ratQuality.appendChild(o); });
}
els.ratUrl.addEventListener('input', () => { updateRatPlat(); clearTimeout(ratQualityTimer); ratQualityTimer = setTimeout(loadRatQualities, 700); });
els.ratXcheck.addEventListener('change', async () => { settings = await window.navirisApp.setSettings({ xRevealSensitive: els.ratXcheck.checked }); const tab = activeTab(); if (tab?.kind === 'web' && /(^|\.)(x\.com|twitter\.com)$/.test(hostOf(tab.url))) tab.webview.reload(); toast(els.ratXcheck.checked ? 'Contenido sensible visible en X' : 'Sensibilidad de X restaurada'); });
async function ratGrab(mode) { const url = els.ratUrl.value.trim(); if (!/^https?:/.test(url)) { toast('Pega un enlace válido'); return; } const quality = mode === 'video' ? els.ratQuality.value : ''; els.ratPop.classList.add('hidden'); els.sbRat.classList.remove('open'); toggleDownloads(true); await window.navirisApp.ytDownload(url, mode, quality); toast(mode === 'audio' ? 'Extrayendo MP3…' : (quality ? `Descargando video (${quality}p)…` : 'Descargando video…')); }
els.ratVideo.addEventListener('click', () => ratGrab('video'));
els.ratAudio.addEventListener('click', () => ratGrab('audio'));

/* ============ Resoluciones ============ */
const RESOLUTIONS = [
  { w: 0, h: 0, label: 'Adaptable', note: 'nativa' }, { w: 1920, h: 1080, label: 'Full HD', note: 'la más usada' },
  { w: 1366, h: 768, label: 'HD portátil', note: 'muy común' }, { w: 1536, h: 864, label: 'FHD 125%', note: 'con escala' },
  { w: 1440, h: 900, label: 'WXGA+', note: '16:10' }, { w: 1600, h: 900, label: 'HD+', note: '' },
  { w: 1280, h: 800, label: 'WXGA', note: 'portátiles antiguos' }, { w: 1280, h: 720, label: 'HD 720p', note: '' },
  { w: 1360, h: 768, label: 'HD 1360', note: 'económicos' }, { w: 1024, h: 768, label: 'XGA', note: 'muy antiguos' },
  { w: 1280, h: 1024, label: 'SXGA', note: '5:4' }, { w: 800, h: 600, label: 'SVGA', note: 'mínima' },
  { w: 2560, h: 1440, label: 'QHD', note: '27"' }, { w: 3840, h: 2160, label: '4K UHD', note: '' }
];
let resMode = null;
function applyResponsive() {
  for (const t of tabs) if (t.webview) t.webview.style.cssText = '';
  const tab = activeTab();
  if (!resMode || !tab || tab.kind !== 'web' || !tab.webview) { els.content.classList.remove('res-mode'); els.resLabel.classList.add('hidden'); return; }
  els.content.classList.add('res-mode'); const rect = els.content.getBoundingClientRect();
  const k = Math.min((rect.width - 28) / resMode.w, (rect.height - 52) / resMode.h, 1); const wv = tab.webview;
  wv.style.width = resMode.w + 'px'; wv.style.height = resMode.h + 'px'; wv.style.left = '50%'; wv.style.top = '50%'; wv.style.transform = `translate(-50%,-50%) scale(${k})`;
  els.resLabel.textContent = `${resMode.label} · ${resMode.w}×${resMode.h}` + (k < 1 ? ` · ${Math.round(k * 100)}%` : ''); els.resLabel.classList.remove('hidden');
}
/* Resoluciones en REJILLA de fichas (2026-08-11): la lista larga se salía de
   la pantalla y era un muro de texto. Cada resolución es una ficha compacta
   con su nombre, medidas y proporción; la activa va en el realce. */
function renderResList() {
  els.resList.innerHTML = '';
  for (const r of RESOLUTIONS) {
    const sel = resMode ? resMode.w === r.w && resMode.h === r.h : r.w === 0;
    const b = document.createElement('button');
    b.className = 'rp-card' + (sel ? ' sel' : '');
    const prop = r.w ? (Math.abs(r.w / r.h - 16 / 9) < 0.02 ? '16:9' : Math.abs(r.w / r.h - 16 / 10) < 0.02 ? '16:10' : Math.abs(r.w / r.h - 4 / 3) < 0.02 ? '4:3' : '') : '';
    b.innerHTML = `<span class="rp-dim">${r.w ? r.w + '×' + r.h : 'Nativa'}</span>` +
      `<span class="rp-name">${escapeHtml(r.label)}</span>` +
      (prop ? `<span class="rp-prop">${prop}</span>` : '');
    b.title = r.note || r.label;
    b.addEventListener('click', () => { resMode = r.w ? r : null; applyResponsive(); renderResList(); });
    els.resList.appendChild(b);
  }
}
els.sbRes.addEventListener('click', (e) => { e.stopPropagation(); const open = els.resPop.classList.contains('hidden'); els.resPop.classList.toggle('hidden'); els.sbRes.classList.toggle('open', open); if (open) { renderResList(); anclarPop(els.resPop, els.sbRes); } });
window.addEventListener('resize', () => applyResponsive());

/* ============ Etiqueta del riel (estilo Opera GX) ============
   El tooltip del sistema tarda ~1 s y no sigue el tema. Aquí el texto se lee
   del propio title al entrar y se devuelve al salir: los botones que cambian
   su title en caliente (AutoClaim, Blockify, los addons) siguen funcionando
   sin que haya que tocarlos. */
(() => {
  const tip = document.createElement('div'); tip.id = 'sb-tip'; document.body.appendChild(tip);
  let actual = null;
  const oculta = () => {
    if (actual && actual.dataset.tip != null) { actual.title = actual.dataset.tip; delete actual.dataset.tip; }
    actual = null; tip.classList.remove('on');
  };
  /* Al pulsar, la etiqueta se va y ese botón no la vuelve a sacar hasta que el
     puntero salga de él: tapaba la cabecera del panel recién abierto. Va en
     pointerdown porque varios botones cortan la propagación del click. */
  let pulsado = null;
  els.sidebar.addEventListener('pointerdown', (e) => { pulsado = e.target.closest('.sb-btn'); oculta(); });
  els.sidebar.addEventListener('mouseover', (e) => {
    if (pulsado && !pulsado.contains(e.target)) pulsado = null;
    const b = e.target.closest('.sb-btn'); if (!b || b === actual || b === pulsado) return;
    oculta();
    const txt = (b.title || '').trim(); if (!txt) return;
    actual = b; b.dataset.tip = b.title; b.title = '';   // sin title no sale el del sistema
    tip.textContent = txt; tip.classList.add('on');
    const r = b.getBoundingClientRect();
    tip.style.left = Math.round(r.right + 10) + 'px';
    tip.style.top = Math.round(Math.min(window.innerHeight - tip.offsetHeight - 8, Math.max(8, r.top + r.height / 2 - tip.offsetHeight / 2))) + 'px';
  });
  els.sidebar.addEventListener('mouseleave', () => { pulsado = null; oculta(); });
  // En captura: los botones que abren un popover paran la propagación del clic y la etiqueta se quedaba encima de él.
  els.sidebar.addEventListener('click', oculta, true);
})();

/* ============ Sidebar home + ajustes ============ */
// La pestaña de hub se busca en el espacio que se ve: la de otro espacio lo cambiaría (y su candado no se salta).
els.sbHome.addEventListener('click', () => { const h = tabsVisibles().find((t) => t.kind === 'hub'); if (h) activateTab(h.id); else createTab(); });
// El mismo menú que el ⋮ de la barra, pero pegado a su botón del riel (y desde arriba de la lista).
els.sbSettings.addEventListener('click', (e) => {
  e.stopPropagation(); els.menuPop.classList.toggle('hidden');
  if (!els.menuPop.classList.contains('hidden')) { anclarPop(els.menuPop, els.sbSettings); els.menuPop.scrollTop = 0; }
});

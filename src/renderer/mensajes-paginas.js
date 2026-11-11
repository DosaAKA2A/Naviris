/* Lo que llega de las páginas (webview-preload): contraseñas, modo agente, reclamos de AutoClaim y muro de YouTube. */

/* ============ Contraseñas: guardar y autorrellenar en sitios ============ */
// cuenta → última contraseña ofrecida: no se vuelve a preguntar por la misma,
// pero si la persona se equivocó y repite con otra, se ofrece la nueva.
const pwPrompted = new Map();
// Sitio al que va lo que ofrece rellenar la barra (null en "Guardar"). Si la
// pestaña se va a otro sitio, la barra se quita y no se manda nada.
let pwBarHost = null;
function hidePwBar() { els.pwBar.classList.add('hidden'); pwBarHost = null; }
function showPwBar(html, yesLabel, onYes, host = null) {
  els.pwText.innerHTML = html;
  els.pwYes.textContent = yesLabel;
  els.pwYes.onclick = () => { hidePwBar(); onYes(); };
  els.pwNo.onclick = hidePwBar;
  els.pwBar.classList.remove('hidden');
  pwBarHost = host;
}
// `esquema`: además, que siga en ese esquema (una contraseña de https no se rellena en http).
const sigueEnSitio = (wv, host, esquema) => { try { const u = wv.getURL(); return hostOf(u) === host && (!esquema || esquemaDe(u) === esquema); } catch { return false; } };
const esquemaDe = (u) => { try { return new URL(u).protocol.slice(0, -1); } catch { return ''; } };
// Indicador de Modo agente: ÁMBAR = activo (puerto CDP abierto, sin agente conectado);
// VERDE = un agente está conectado/actuando. El agente declara presencia llamando a
// window.navirisAgentPing() (heartbeat) o controlando alguna pestaña. Si el heartbeat
// deja de llegar (~15s), vuelve a ámbar sin necesidad de un intervalo perpetuo.
let agentLastPing = 0, agentPingTimeout = null;
window.navirisAgentPing = function () {
  agentLastPing = Date.now(); refreshAgentBadge();
  clearTimeout(agentPingTimeout); agentPingTimeout = setTimeout(refreshAgentBadge, 15500);
};
function refreshAgentBadge() {
  const b = document.getElementById('agent-badge'); if (!b) return;
  if (!settings.agentMode) { b.classList.add('hidden'); b.classList.remove('connected'); return; }
  b.classList.remove('hidden');
  const connected = (Date.now() - agentLastPing < 15000) || tabs.some((t) => t.agentControlled);
  b.classList.toggle('connected', connected);
}
// Un reclamo de AutoClaim (puntos o drop): suma a la sesión de su pestaña, lo guarda
// en el historial y avisa. La cuenta la lleva solo la interfaz: antes se fiaba del
// contador del preload, que volvía a cero al recargar la página y se comía los
// drops que reclama el webview oculto.
function apuntaReclamo(tab, d) {
  const seg = (tab.url.split('twitch.tv/')[1] || '').split(/[/?#]/)[0];
  tab.twitchClaims = (tab.twitchClaims || 0) + 1; renderTabs();
  recordLoot(d.kind, 'twitch.tv' + (seg ? '/' + seg : ''), { name: d.name, balance: d.balance });
  toast(d.kind === 'drop' ? (d.name ? 'Drop reclamado: ' + d.name : 'Drop de Twitch reclamado') : `Punto de Twitch reclamado (${tab.twitchClaims})`);
}
// Webview OCULTO que reclama los drops pendientes SIN tocar la pestaña que farmea:
// carga /drops/inventory en la MISMA sesión que esa pestaña (antes iba siempre a la
// general y, con Twitch abierto en un contenedor o en un espacio protegido, entraba
// sin cuenta y no reclamaba nada), pulsa el botón real de Twitch (que sí viaja con
// Client-Integrity) y se autodestruye. El farmeo no se corta.
let dropClaimer = null;
function ensureDropClaimer(sourceTab) {
  if (dropClaimer) return; // ya hay uno trabajando
  const wv = document.createElement('webview');
  wv.setAttribute('partition', particionDeTab(sourceTab));
  wv.setAttribute('allowpopups', '');
  wv.classList.add('agent-hidden'); // renderizado pero fuera de pantalla: invisible al usuario
  wv.src = 'https://www.twitch.tv/drops/inventory';
  const cleanup = () => {
    if (!dropClaimer) return;
    try { clearTimeout(dropClaimer.timer); } catch { /* nada */ }
    try { wv.remove(); } catch { /* nada */ }
    dropClaimer = null;
  };
  wv.addEventListener('dom-ready', () => { try { wv.send('naviris-claim-inventory'); } catch { /* nada */ } });
  wv.addEventListener('ipc-message', (ev) => {
    if (ev.channel !== 'naviris-twitch') return;
    const d = (ev.args && ev.args[0]) || {};
    if (d.type === 'claim' && d.kind === 'drop') apuntaReclamo(sourceTab, d);
    else if (d.type === 'claim-done') cleanup();
  });
  els.content.appendChild(wv);
  dropClaimer = { wv, timer: setTimeout(cleanup, 45000) }; // salvavidas si algo falla
}
async function onWebviewMessage(wv, e) {
  const data = (e.args && e.args[0]) || {};
  // Algo copiado desde un campo de contraseña de la página: el Portapapeles no lo apunta
  if (e.channel === 'naviris-copia-sensible') { if (typeof data === 'string') marcaSensible(data); return; }
  // Botones 4/5 del ratón pulsados DENTRO de la página
  if (e.channel === 'naviris-mouse-nav') {
    if (settings.mouseNav === false) return;   // el interruptor vale también con el ratón sobre la web
    const dir = (e.args && e.args[0]) || '';
    if (dir === 'back') irAtras(); else if (dir === 'forward') irAdelante();
    return;
  }
  /* YouTube dejó a la vista su muro anti-bloqueador dentro del reproductor
     después del reintento del preload (webview-preload, bloque de YouTube): se
     ofrece la lista blanca. Si la pestaña no se está viendo, el aviso espera a
     que se abra (activateTab). El preload no lo puede saber: un webview de
     fondo sigue diciendo visibilityState "visible" (medido el 2026-10-07, con
     el hub delante), y el aviso salía sobre otra pestaña. */
  if (e.channel === 'naviris-yt-muro') {
    const tab = tabs.find((t) => t.webview === wv); if (!tab) return;
    let vid = '';
    try { const u = new URL(data.url); if (/(^|\.)youtube\.com$/.test(u.hostname)) vid = u.searchParams.get('v') || ''; } catch { /* nada */ }
    if (!vid) return;
    if (tab.id !== activeId && tab.id !== divId) { tab.muroPendiente = vid; return; }
    avisaMuroYT(tab, vid);
    return;
  }
  // Un agente (CDP) marcó/desmarcó esta pestaña: pinta el distintivo. Vale para cualquier pestaña.
  if (e.channel === 'naviris-agent') {
    const tab = tabs.find((t) => t.webview === wv); if (!tab) return;
    tab.agentControlled = !!data.on;
    try { wv.classList.toggle('agent-controlled', !!data.on); } catch { /* nada */ }
    renderTabs(); refreshAgentBadge();
    return;
  }
  // Twitch: se atiende aunque la pestaña esté en segundo plano (ahí es donde se deja el stream)
  if (e.channel === 'naviris-twitch') {
    const tab = tabs.find((t) => t.webview === wv); if (!tab) return;
    // Hay drops ganados sin reclamar: abre el webview oculto que los reclama sin cortar el farmeo.
    if (data.type === 'drops-pending') ensureDropClaimer(tab);
    else if (data.type === 'claim') apuntaReclamo(tab, data);
    return;
  }
  if (activeTab()?.webview !== wv) return; // el resto (contraseñas) solo en la pestaña activa
  if (e.channel === 'naviris-capture') {
    if (IS_PRIVATE) return; // en ventana privada no se guardan contraseñas
    const { url, username, password } = data;
    if (!password) return;
    const host = hostOf(url); if (!host) return;
    // Se guarda con el esquema de la página: la de https no se ofrecerá en http.
    const esquema = esquemaDe(url);
    const key = host + '|' + esquema + '|' + (username || '');
    if (pwPrompted.get(key) === password) return;
    pwPrompted.set(key, password);
    const existing = (await window.navirisApp.pwForHost(host, esquema)).find((c) => (c.username || '') === (username || ''));
    const who = username ? `<b>${escapeHtml(username)}</b> en <b>${escapeHtml(host)}</b>` : `<b>${escapeHtml(host)}</b>`;
    if (existing) showPwBar(`¿Actualizar la contraseña de ${who}?`, 'Actualizar', () => doSavePw(host, username, password, esquema));
    else showPwBar(`¿Guardar la contraseña de ${who} en Naviris?`, 'Guardar', () => doSavePw(host, username, password, esquema));
  } else if (e.channel === 'naviris-loginform') {
    const host = hostOf(data.url); if (!host) return;
    const esquema = esquemaDe(data.url);
    const creds = await window.navirisApp.pwForHost(host, esquema);
    if (!creds.length) return;
    const cred = creds[0];
    const who = cred.username ? `<b>${escapeHtml(cred.username)}</b>` : 'la cuenta guardada';
    showPwBar(`Rellenar ${who} en <b>${escapeHtml(host)}</b> — te pedirá verificación de Windows.`, 'Rellenar', () => doFillPw(wv, cred, host, esquema), host);
  } else if (e.channel === 'naviris-otpform') {
    /* Casilla de código de un solo uso: si hay una cuenta del autenticador que
       case con este sitio, se ofrece el codigo. Se empareja por el emisor
       (GitHub ↔ github.com) y por la etiqueta; si no casa ninguna NO se
       ofrece nada, porque meter el codigo de otra cuenta seria peor que no
       ofrecer. */
    const host = hostOf(data.url); if (!host) return;
    const lista = await window.navirisApp.totpList().catch(() => []);
    if (!lista.length) return;
    /* Se compara con cada trozo del dominio menos el final (accounts.GOOGLE.com,
       login.MICROSOFTonline.com), no solo con el primero. Un emisor corto solo
       vale si es el trozo entero: "X" en x.com, no en cualquier dominio con una x. */
    const partes = host.split('.').slice(0, -1);
    const casa = (e2) => {
      const em = (e2.issuer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const lb = (e2.label || '').toLowerCase();
      return (!!em && partes.some((p) => p === em || (em.length >= 3 && p.length >= 4 && (p.includes(em) || em.includes(p))))) || lb.includes(host);
    };
    const cuenta = lista.find(casa);
    if (!cuenta) return;
    const nombre = escapeHtml(cuenta.issuer || host);
    const pon = async () => {
      if (!sigueEnSitio(wv, host)) { toast('La página cambió; vuelve a intentarlo'); return; }
      const r = await window.navirisApp.totpCodes();
      if (!r.ok) { toast('Desbloquea el autenticador para usar el código'); return; }
      const it = r.items.find((x) => x.id === cuenta.id);
      if (!it || !/^[0-9]{4,8}$/.test(it.code)) { toast('No se pudo generar el código'); return; }
      if (!sigueEnSitio(wv, host)) { toast('La página cambió; vuelve a intentarlo'); return; }
      try { wv.send('naviris-otp-fill', it.code, host); toast('Código puesto — caduca en ' + it.restan + ' s'); } catch { toast('No se pudo rellenar'); }
    };
    showPwBar('Rellenar el código de <b>' + nombre + '</b> desde tu autenticador.', 'Rellenar código', pon, host);
  } else if (e.channel === 'naviris-cardform') {
    // Formulario de pago detectado: ofrecer la tarjeta guardada (CVC no; lo teclea el usuario)
    if (IS_PRIVATE) return;
    const host = hostOf(data.url); if (!host) return;
    const cards = await window.navirisApp.cardsList();
    if (!cards.length) return;
    const card = cards[0];
    showPwBar(`Rellenar la tarjeta <b>${escapeHtml(card.brand)} •••• ${escapeHtml(card.last4)}</b> en <b>${escapeHtml(host)}</b> — te pedirá verificación de Windows. El CVC lo escribes tú.`, 'Rellenar', () => doFillCard(wv, card, host), host);
  }
}
// El aviso del muro de YouTube (ver 'naviris-yt-muro'): como mucho uno por pestaña
// y video. El botón mete youtube.com en la lista blanca, igual que el escudo, y
// recarga la pestaña.
function avisaMuroYT(tab, vid) {
  tab.muroAvisado = tab.muroAvisado || new Set();
  if (tab.muroAvisado.has(vid)) return;
  tab.muroAvisado.add(vid);
  toast('YouTube bloqueó el video por el bloqueador de anuncios.', {
    label: 'Permitir anuncios en YouTube',
    alPulsar: async () => {
      await window.navirisApp.adblockWhitelist('add', 'youtube.com');
      if (!els.shieldPop.classList.contains('hidden')) refreshAdblockUI();
      toast('Anuncios permitidos en YouTube');
      try { tab.webview?.reload(); } catch { /* nada */ }
    }
  });
}
// Lo que se rellena va solo al sitio que se ofreció: se mira antes de pedir
// Windows Hello y otra vez después, que mientras tanto se puede haber navegado.
async function doFillCard(wv, card, host) {
  if (!sigueEnSitio(wv, host)) { toast('La página cambió; vuelve a intentarlo'); return; }
  const r = await window.navirisApp.cardsFill(card.id);
  if (r.ok && !sigueEnSitio(wv, host)) { toast('La página cambió; vuelve a intentarlo'); return; }
  if (r.ok) { try { wv.send('naviris-fill-card', r, host); toast('Tarjeta rellenada (falta el CVC)'); } catch { toast('No se pudo rellenar'); } }
  else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo rellenar');
}
async function doSavePw(host, username, password, esquema) {
  const r = await window.navirisApp.pwAdd(host, username || '', password, esquema);
  toast(r && r.ok ? (r.updated ? 'Contraseña actualizada' : 'Contraseña guardada en Naviris') : 'No se pudo guardar');
}
async function doFillPw(wv, cred, host, esquema) {
  if (!sigueEnSitio(wv, host, esquema)) { toast('La página cambió; vuelve a intentarlo'); return; }
  const r = await window.navirisApp.pwReveal(cred.id);
  if (r.ok && !sigueEnSitio(wv, host, esquema)) { toast('La página cambió; vuelve a intentarlo'); return; }
  // soloHttps: la página lo vuelve a mirar antes de escribir (webview-preload).
  if (r.ok) { try { wv.send('naviris-fill', { username: cred.username, password: r.password, soloHttps: cred.esquema === 'https' }, host); toast('Contraseña rellenada'); } catch { toast('No se pudo rellenar'); } }
  else toast(r.error === 'verificacion cancelada' ? 'Verificación cancelada' : 'No se pudo rellenar');
}

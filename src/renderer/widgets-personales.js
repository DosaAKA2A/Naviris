/* Widgets con datos personales: portapapeles, notas, ventana privada, tarjetas y códigos 2FA. */

/* ============ Widget PORTAPAPELES (2026-08-12) ============
   Historial de lo copiado (solo texto, local, max 20). Clic vuelve a copiar;
   se vigila el portapapeles cada 1,5 s mientras el hub esta visible. */
let clipTimer = null, clipUltimo = '';
const clipHist = () => store.get('naviris.clip', []);
/* LO QUE NO SE APUNTA (auditoría 2026-10). El historial vive en claro en
   localStorage y apuntaba todo: la contraseña o la tarjeta copiadas desde su
   panel, el código y el enlace otpauth:// del autenticador, y lo que copiaras
   en la ventana privada. Ahora:
   · lo que la app copia o se copia desde esas pantallas pasa por
     marcaSensible() y todas las ventanas lo dan por visto;
   · mientras una ventana privada tiene el foco, las demás no apuntan nada, y
     al soltarlo dan por visto lo que quedó en el portapapeles;
   · los enlaces otpauth:// y los números de tarjeta válidos no se apuntan
     nunca, y los que ya estuvieran guardados se borran al arrancar.
   Las ventanas se avisan por un BroadcastChannel: en memoria, nada a disco. */
function esSecreto(t) {
  t = String(t || '');
  if (/^otpauth:\/\//i.test(t)) return true;
  const d = t.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(d)) return false;
  let s = 0;   // control de Luhn, el de los números de tarjeta
  for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; }
  return s % 10 === 0;
}
if (clipHist().some(esSecreto)) store.set('naviris.clip', clipHist().filter((t) => !esSecreto(t)));
const canalClip = new BroadcastChannel('naviris-portapapeles');
const clipPrivadas = new Set();   // ventanas privadas que tienen el foco ahora
let clipDandoPorVisto = 0;
function marcaSensible(t) {
  t = String(t || '').trim(); if (!t) return;
  clipUltimo = t; canalClip.postMessage({ sensible: t });
}
function daPorVisto() {
  clipDandoPorVisto++;
  window.navirisApp.clipRead().catch(() => '').then((t) => { clipUltimo = (t || '').trim(); clipDandoPorVisto--; });
}
if (IS_PRIVATE) {
  const id = Math.random().toString(36).slice(2);
  const avisa = (privada) => canalClip.postMessage({ privada, id });
  window.addEventListener('focus', () => avisa(true));
  window.addEventListener('blur', () => avisa(false));
  window.addEventListener('pagehide', () => avisa(false));
  if (document.hasFocus()) avisa(true);
} else {
  canalClip.onmessage = (e) => {
    const m = e.data || {};
    if (typeof m.sensible === 'string') { clipUltimo = m.sensible; return; }
    if (!m.id) return;
    if (m.privada) clipPrivadas.add(m.id); else { clipPrivadas.delete(m.id); daPorVisto(); }
  };
  // Con el foco aquí, ninguna privada lo tiene (por si su aviso no llegó)
  window.addEventListener('focus', () => { if (clipPrivadas.size) { clipPrivadas.clear(); daPorVisto(); } });
}
// Copiar a mano desde las pantallas de contraseñas, tarjetas o autenticador
['copy', 'cut'].forEach((tipo) => document.addEventListener(tipo, () => {
  const a = document.activeElement;
  const campo = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') ? a : null;
  const nodo = campo || getSelection().anchorNode?.parentElement;
  if (!nodo?.closest('#pw-panel, .w-auth, .au-modal, input[type=password]')) return;
  marcaSensible(campo ? campo.value.slice(campo.selectionStart, campo.selectionEnd) : String(getSelection()));
}, true));
function renderClipW(body) {
  body.innerHTML = `
    <div class="w-head">${window.icon('clipboard')} Portapapeles<button class="wh-btn clip-x" title="Vaciar">${window.icon('x-mark')}</button></div>
    <div class="clip-lista"></div>`;
  body.querySelector('.clip-x').addEventListener('click', (e) => { e.stopPropagation(); store.set('naviris.clip', []); pintaClip(); });
  // En la ventana privada no se vigila: solo se enseña lo que ya había
  if (!IS_PRIVATE) clipTimer = relojHub(clipTimer, vigilaClip, 1500);
  requestAnimationFrame(() => { pintaClip(); vigilaClip(); });
}
async function vigilaClip() {
  if (!widgets.some((w) => w.type === 'clip')) { clearInterval(clipTimer); clipTimer = null; return; }
  if (IS_PRIVATE || !els.hub.classList.contains('active')) return;
  const t = (await window.navirisApp.clipRead().catch(() => '') || '').trim();
  if (clipPrivadas.size || clipDandoPorVisto) { clipUltimo = t; return; }   // es de la ventana privada
  // Solo se repinta si hay algo nuevo: rehacer la lista cada 1,5 s recalculaba el hub sin parar
  if (t && t !== clipUltimo) {
    clipUltimo = t;
    if (esSecreto(t)) return;
    const l = clipHist().filter((x) => x !== t); l.unshift(t);
    store.set('naviris.clip', l.slice(0, 20));
    pintaClip();   // solo si cambió: repintar cada 1,5 s se comía los clics en la lista
  }
}
function pintaClip() {
  const l = clipHist();
  document.querySelectorAll('.w-clip .clip-lista').forEach((cont) => {
    cont.innerHTML = l.map((t, i) => `<button class="clip-i" data-i="${i}"><span>${escapeHtml(t.slice(0, 90))}</span></button>`).join('') ||
      '<div class="w-vacio">Lo que copies aparecerá aquí</div>';
    cont.querySelectorAll('.clip-i').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); const t = l[+b.dataset.i]; clipUltimo = t;
      window.navirisApp.clipWrite(t); toast('Copiado de nuevo');
    }));
    // Borrar una sola entrada (lo sensible que se colara), como en el autenticador
    cont.querySelectorAll('.clip-i').forEach((b) => b.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation(); const t = l[+b.dataset.i];
      showCtxMenu(e.clientX, e.clientY, [
        { label: 'Copiar', icon: 'clipboard', action: () => { clipUltimo = t; window.navirisApp.clipWrite(t); toast('Copiado de nuevo'); } },
        { sep: true },
        { label: 'Eliminar', icon: 'trash', danger: true, action: () => { store.set('naviris.clip', clipHist().filter((x) => x !== t)); pintaClip(); } }
      ]);
    }));
    recortaFilas(cont, '.clip-i');
  });
}

/* ============ Widget NOTAS mejorado (2026-08-12) ============
   Lista de tareas con tachado + texto libre debajo; todo local. */
const notasLista = () => store.get('naviris.notas2', []);
function renderNotasW(body) {
  const pinta = () => {
    const l = notasLista();
    body.innerHTML = `
      <div class="w-head">${window.icon('pencil-square')} Notas<span class="wh-sub">${l.filter((x) => !x.ok).length || ''}</span></div>
      <div class="nt-lista">${l.map((x, i) => `
        <label class="nt-i${x.ok ? ' ok' : ''}"><input type="checkbox" data-i="${i}"${x.ok ? ' checked' : ''} /><span class="nt-box">${window.icon('check')}</span><span class="nt-t">${escapeHtml(x.t)}</span><button class="nt-x" data-i="${i}" title="Quitar">${window.icon('x-mark')}</button></label>`).join('')}</div>
      <div class="nt-add"><input type="text" placeholder="Nueva tarea…" maxlength="120" /><button title="Añadir">${window.icon('plus')}</button></div>`;
    const alta = () => {
      const inp = body.querySelector('.nt-add input'); const t = inp.value.trim(); if (!t) return;
      const l2 = notasLista(); l2.push({ t, ok: false }); store.set('naviris.notas2', l2); pinta();
      body.querySelector('.nt-add input').focus();
    };
    body.querySelector('.nt-add button').addEventListener('click', (e) => { e.stopPropagation(); alta(); });
    body.querySelector('.nt-add input').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') alta(); });
    body.querySelectorAll('.nt-i input').forEach((ch) => ch.addEventListener('change', (e) => {
      e.stopPropagation(); const l2 = notasLista(); l2[+ch.dataset.i].ok = ch.checked; store.set('naviris.notas2', l2); pinta();
    }));
    body.querySelectorAll('.nt-x').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault(); const l2 = notasLista(); l2.splice(+b.dataset.i, 1); store.set('naviris.notas2', l2); pinta();
    }));
    window.nvsRepasa?.(body);   // la lista es nueva (también al añadir con Enter, sin clic)
  };
  pinta();
}

/* ============ Widget VENTANA PRIVADA (2026-08-11) ============
   Un solo boton, como icono de app: cuadrado 1x1 en violeta con el candado
   grande. Clic = ventana privada nueva. */
function renderPrivadaW(body) {
  body.innerHTML = `<div class="pv-ico">${window.icon('book-lock')}</div><span class="pv-t">Privada</span>`;
  body.addEventListener('click', () => window.navirisApp.newPrivateWindow());
}

/* ============ Widget TARJETAS / WALLET (2026-08-11) ============
   Una mini TARJETA de crédito con el degradado del realce: chip, puntos y el
   candado de Windows Hello. No muestra NINGÚN dato real (los datos viven
   cifrados y detrás de Hello); el botón abre el gestor del panel. */
/* Cada marca con SU color y SU logo, como en Google Wallet (Dosa, 2026-09-09).
   Mastercard son sus dos círculos; las demás, su palabra — que es como se
   reconoce una tarjeta de verdad. El número completo no llega nunca aquí: solo
   la marca y los cuatro últimos, que es lo que devuelve cards:list. */
const TARJETAS = {
  'Visa':             { bg: 'linear-gradient(135deg, #2a3a95 0%, #131a4a 100%)', fg: '#ffffff', word: 'VISA', cls: 'visa' },
  'Mastercard':       { bg: 'linear-gradient(135deg, #2b2b2f 0%, #131315 100%)', fg: '#ffffff', mc: true },
  'American Express': { bg: 'linear-gradient(135deg, #1a8fd8 0%, #00609c 100%)', fg: '#ffffff', word: 'AMEX' },
  'Discover':         { bg: 'linear-gradient(135deg, #f28a2e 0%, #d1600a 100%)', fg: '#1b1206', word: 'DISCOVER' },
  'JCB':              { bg: 'linear-gradient(135deg, #2a7d3f 0%, #14431f 100%)', fg: '#ffffff', word: 'JCB' },
  'Diners Club':      { bg: 'linear-gradient(135deg, #4a6fa8 0%, #24385c 100%)', fg: '#ffffff', word: 'DINERS' },
  'UnionPay':         { bg: 'linear-gradient(135deg, #c9332f 0%, #7d1a18 100%)', fg: '#ffffff', word: 'UNIONPAY' }
};
const LOGO_MC = '<svg viewBox="0 0 40 24" aria-hidden="true"><circle cx="15" cy="12" r="9" fill="#eb001b"/><circle cx="25" cy="12" r="9" fill="#f79e1b" fill-opacity=".85"/></svg>';
function pintaTarjetaW(body, c) {
  const t = (c && TARJETAS[c.brand]) || null;
  const tj = body.querySelector('.wl-tarjeta');
  if (t) { tj.style.setProperty('--tj', t.bg); tj.style.setProperty('--tj-fg', t.fg); }
  else { tj.style.removeProperty('--tj'); tj.style.removeProperty('--tj-fg'); }
  const marca = tj.querySelector('.wl-marca');
  if (!c) { marca.textContent = 'Naviris'; return; }
  marca.innerHTML = t && t.mc ? `<span class="wl-logo">${LOGO_MC}</span>`
    : `<span class="wl-word ${(t && t.cls) || ''}">${escapeHtml((t && t.word) || c.brand)}</span>`;
  const num = document.createElement('div'); num.className = 'wl-num'; num.textContent = '•••• ' + c.last4;
  const cad = document.createElement('div'); cad.className = 'wl-cuenta'; cad.textContent = String(c.expMonth).padStart(2, '0') + '/' + String(c.expYear).slice(-2);
  // Idempotente: repintar la misma tarjeta no debe apilar números viejos.
  tj.querySelectorAll('.wl-puntos, .wl-num, .wl-cuenta').forEach((x) => x.remove());
  tj.append(num, cad);
}
function renderWalletW(body) {
  body.innerHTML = `
    <div class="wl-tarjeta">
      <div class="wl-chip"></div>
      <div class="wl-puntos"><span>••••</span><span>••••</span><span>••••</span></div>
      <div class="wl-marca">Naviris</div>
    </div>
    <div class="wl-pie">
      <span class="wl-hello">${window.icon('key')} Windows Hello</span>
      <button class="wl-ver">Ver tarjetas</button>
    </div>`;
  /* Abre el panel en Tarjetas SIN alternarlo (auditoría 2026-10): pulsar el
     botón del lateral lo CERRABA si ya estaba abierto, y el temporizador de
     60 ms competía con la consulta del cifrado. */
  const abre = async (e) => {
    e?.stopPropagation();
    const info = await window.navirisApp.pwAvailable();
    if (!info.encryption) { toast('El cifrado seguro no está disponible en este sistema'); return; }
    switchPwTab(true); togglePwPanel(true);
  };
  body.querySelector('.wl-ver').addEventListener('click', abre);
  body.addEventListener('click', abre);
  // La primera tarjeta guardada manda el color y el logo. Sin tarjetas, la
  // neutra del tema; si el cifrado no está disponible, tampoco pasa nada.
  window.navirisApp.cardsList().then((l) => { if (body.isConnected) pintaTarjetaW(body, l && l[0]); }).catch(() => {});
}

/* ============ Widget de códigos 2FA (TOTP) ============
   Los códigos NO se pintan de entrada: la caja se abre con Windows Hello y se
   queda abierta unos minutos. Si no, cualquiera que pasara por delante del
   portátil abierto tendría a la vista el segundo factor de todas las cuentas,
   que es justo lo que este widget debería proteger.
   El secreto no llega nunca aquí: main devuelve solo el código ya calculado. */
let authTimer = null;

/* El logo REAL de la cuenta cuando lo tenemos (Simple Icons, monocromo como
   manda el hub), y si no la inicial en un chip. Un autenticador con los logos
   de Discord o GitHub se lee de un vistazo; una lista de texto, no. Los nombres
   que no coinciden con la marca se traducen a mano (Google guarda sus códigos
   como "Google", pero el logo que tenemos es el de Gmail). */
const MARCA_2FA = {
  google: 'gmail', gmail: 'gmail', discord: 'discord', github: 'github', twitch: 'twitch',
  reddit: 'reddit', spotify: 'spotify', instagram: 'instagram', whatsapp: 'whatsapp',
  youtube: 'youtube', pinterest: 'pinterest', crunchyroll: 'crunchyroll',
  x: 'x', twitter: 'x', claude: 'claude', anthropic: 'claude'
};
function emblema2fa(issuer) {
  const nom = String(issuer || '').trim();
  const clave = nom.toLowerCase().replace(/\s+/g, '');
  const marca = MARCA_2FA[clave] || ((window.brandNames && window.brandNames().includes(clave)) ? clave : null);
  const svg = marca && window.brandIcon ? window.brandIcon(marca) : null;
  if (svg) return `<span class="au-logo au-logo-marca">${svg}</span>`;
  return `<span class="au-logo au-logo-ini">${escapeHtml((nom.charAt(0) || '?').toUpperCase())}</span>`;
}
// Cabecera común a TODOS los estados: el widget se llama igual esté vacío,
// bloqueado o lleno. Antes solo la tenía el estado con códigos, y los otros dos
// parecían otra cosa.
function cabecera2fa(acciones) {
  return `
    <div class="au-head">
      <span class="au-marca">${window.icon('fingerprint')}<span class="au-tit">Autenticador</span></span>
      ${acciones ? `<span class="au-tools">${acciones}</span>` : ''}
    </div>`;
}

function renderAuthW(body) {
  clearInterval(authTimer);
  /* La cuenta atrás de 1 s solo existe con los códigos a la vista y el hub
     visible (auditoría 2026-10). Antes corría siempre, también con el hub
     oculto, y en los estados vacío y bloqueado rehacía el widget entero cada
     segundo (con dos consultas a main), así que hasta se perdían clics en
     "Desbloquear". Cada estado decide ahora si la necesita. */
  const pinta = async () => {
    clearInterval(authTimer); authTimer = null;
    const est = await window.navirisApp.totpAvailable();
    if (!est.encryption) {
      body.innerHTML = cabecera2fa('') + `
        <div class="au-hero">
          <span class="au-emblema">${window.icon('shield-check')}</span>
          <span class="au-hero-t">No disponible</span>
          <span class="au-hero-s">Este equipo no ofrece el cifrado que hace falta para guardar los códigos.</span>
        </div>`;
      return;
    }
    if (!est.count) {
      body.innerHTML = cabecera2fa('') + `
        <div class="au-hero">
          <span class="au-emblema au-emblema-on">${window.icon('fingerprint')}</span>
          <span class="au-hero-t">Tus códigos, aquí</span>
          <span class="au-hero-s">Los seis dígitos que te piden al entrar en Discord, GitHub o Google, sin buscar el teléfono.</span>
          <button class="au-add au-cta">${window.icon('plus')}<span>Añadir cuenta</span></button>
        </div>`;
      body.querySelector('.au-add').addEventListener('click', (e) => { e.stopPropagation(); pideAlta(pinta); });
      return;
    }
    if (!est.unlocked) {
      body.innerHTML = cabecera2fa('') + `
        <div class="au-hero">
          <span class="au-emblema">${window.icon('lock-closed')}</span>
          <span class="au-hero-t">${est.count} ${est.count === 1 ? 'cuenta guardada' : 'cuentas guardadas'}</span>
          <span class="au-hero-s">Los códigos se abren con Windows Hello y se quedan a la vista unos minutos.</span>
          <button class="au-unlock au-cta">${window.icon('fingerprint')}<span>Desbloquear</span></button>
        </div>`;
      body.querySelector('.au-unlock').addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await window.navirisApp.totpUnlock();
        if (r.ok) pinta(); else toast('No se pudo verificar tu identidad');
      });
      return;
    }
    const r = await window.navirisApp.totpCodes();
    if (!r.ok) { pinta(); return; }
    body.innerHTML = cabecera2fa(`
          <button class="au-add" title="Añadir cuenta">${window.icon('plus')}</button>
          <button class="au-lock" title="Bloquear">${window.icon('lock-closed')}</button>`) + `
      <div class="au-lista">${r.items.map((it) => `
        <div class="au-it" data-id="${it.id}" title="Clic para copiar">
          ${emblema2fa(it.issuer)}
          <div class="au-info">
            <span class="au-em">${escapeHtml(it.issuer)}</span>
            ${it.label ? `<span class="au-lb">${escapeHtml(it.label)}</span>` : ''}
          </div>
          <div class="au-cod">
            <span class="au-num">${it.code.replace(/(\d{3})(?=\d)/, '$1 ')}</span>
            <svg class="au-ring" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" class="au-r-bg"></circle>
              <circle cx="12" cy="12" r="9" class="au-r-fg"
                style="stroke-dasharray:56.5; stroke-dashoffset:${(56.5 * (1 - it.restan / it.period)).toFixed(1)}"></circle>
            </svg>
          </div>
        </div>`).join('')}</div>`;
    body.querySelectorAll('.au-it').forEach((el) => {
      // Un clic copia el código: es lo que se hace el 100 % de las veces.
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const n = el.querySelector('.au-num').textContent.replace(/\s/g, '');
        marcaSensible(n); window.navirisApp.clipWrite(n);
        toast('Código copiado');
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showCtxMenu(e.clientX, e.clientY, [
          {
            label: 'Copiar código', icon: 'clipboard', action: () => {
              const n = el.querySelector('.au-num').textContent.replace(/\s/g, '');
              marcaSensible(n); window.navirisApp.clipWrite(n); toast('Código copiado');
            }
          },
          {
            label: 'Copiar la cuenta para otro dispositivo', icon: 'key', action: async () => {
              const v = await window.navirisApp.totpReveal(el.dataset.id);
              if (v.ok) { marcaSensible(v.uri); window.navirisApp.clipWrite(v.uri); toast('Enlace de la cuenta copiado'); }
              else toast('No se pudo verificar tu identidad');
            }
          },
          { sep: true },
          {
            label: 'Eliminar', icon: 'trash', danger: true, action: async () => {
              const v = await window.navirisApp.totpDelete(el.dataset.id);
              if (v.ok) { toast('Código eliminado'); pinta(); } else toast('No se pudo verificar tu identidad');
            }
          }
        ]);
      });
    });
    body.querySelector('.au-add').addEventListener('click', (e) => { e.stopPropagation(); pideAlta(pinta); });
    body.querySelector('.au-lock').addEventListener('click', async (e) => {
      e.stopPropagation(); await window.navirisApp.totpLock(); pinta();
    });
    window.nvsRepasa?.(body);   // la lista llega tras una espera (Windows Hello), sin clic que la repase
    // Un segundo: es lo que necesita la cuenta atrás para no ir a saltos.
    authTimer = relojHub(authTimer, cuenta, 1000);
  };
  const cuenta = async () => {
    if (!document.body.contains(body)) { clearInterval(authTimer); return; }
    const est = await window.navirisApp.totpAvailable();
    if (!est.unlocked || !est.count) { pinta(); return; }
    const r = await window.navirisApp.totpCodes();
    if (!r.ok) { pinta(); return; }
    r.items.forEach((it) => {
      const el = body.querySelector(`.au-it[data-id="${it.id}"]`);
      if (!el) return;
      const num = el.querySelector('.au-num');
      const txt = it.code.replace(/(\d{3})(?=\d)/, '$1 ');
      if (num.textContent !== txt) num.textContent = txt;
      const fg = el.querySelector('.au-r-fg');
      if (fg) fg.style.strokeDashoffset = (56.5 * (1 - it.restan / it.period)).toFixed(1);
    });
  };
  pinta();
}

/* Alta: se admite tanto el enlace otpauth:// del QR como el secreto pelado que
   enseñan las webs debajo del código. */
function pideAlta(alTerminar) {
  const cap = document.createElement('div');
  cap.className = 'au-modal';
  cap.innerHTML = `
    <div class="au-box" role="dialog" aria-modal="true" aria-labelledby="au-alta-tit">
      <div class="au-box-t" id="au-alta-tit">Añadir cuenta</div>
      <div class="au-box-s">Pega el enlace <span class="au-mono">otpauth://</span> del código QR, o el secreto que muestra la web al activar la verificación en dos pasos.</div>
      <input class="au-in au-uri" type="text" spellcheck="false" placeholder="otpauth://totp/... o JBSWY3DPEHPK3PXP" />
      <input class="au-in au-nom" type="text" spellcheck="false" placeholder="Nombre (ej. Discord)" />
      <div class="au-box-b">
        <button class="au-cancel">Cancelar</button>
        <button class="au-ok">Guardar</button>
      </div>
      <div class="au-err"></div>
    </div>`;
  document.body.appendChild(cap);
  const uri = cap.querySelector('.au-uri'), nom = cap.querySelector('.au-nom'), err = cap.querySelector('.au-err');
  uri.focus();
  const cierra = () => cap.remove();
  cap.addEventListener('click', (e) => { if (e.target === cap) cierra(); });
  cap.querySelector('.au-cancel').addEventListener('click', cierra);
  const guarda = async () => {
    err.textContent = '';
    const v = uri.value.trim();
    if (!v) { err.textContent = 'Pega el enlace o el secreto'; return; }
    const r = await window.navirisApp.totpAdd({ entrada: v, issuer: nom.value.trim() });
    if (!r.ok) { err.textContent = r.error || 'No se pudo guardar'; return; }
    cierra(); toast('Cuenta añadida'); alTerminar && alTerminar();
  };
  cap.querySelector('.au-ok').addEventListener('click', guarda);
  uri.addEventListener('keydown', (e) => { if (e.key === 'Enter') nom.focus(); });
  nom.addEventListener('keydown', (e) => { if (e.key === 'Enter') guarda(); });
  cap.addEventListener('keydown', (e) => { if (e.key === 'Escape') cierra(); });
}

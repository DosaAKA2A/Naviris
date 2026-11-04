/* Widgets del hub: clima, cuenta, calendario, tendencias de X, imagen, correo, descargas, MOOVIN y monitor. */

/* Clima y región (open-meteo + ipapi, sin claves) */
let geoCache = null, wxCache = null, wxViejo = false;
// Estado del clima → [descripción, icono]. Los iconos son el set de clima
// elegido a mano (Dazzle Line Icons vía svgrepo, prefijo wx-). Prioridad:
// aviso severo > precipitación > viento fuerte > frío/calor > humedad > cielo.
function WMO(cur) {
  const c = cur.weather_code, t = cur.temperature_2m;
  const v = cur.wind_speed_10m || 0, h = cur.relative_humidity_2m || 0, dia = cur.is_day !== 0;
  if (c >= 95) return ['Tormenta', 'wx-alerta'];
  if (c >= 85) return ['Nevando', 'wx-nevando'];
  if (c >= 80) return (c === 80 && dia) ? ['Chubascos con sol', 'wx-arcoiris'] : ['Chubascos', 'wx-lluvia'];
  if (c === 77 || c === 66 || c === 67 || c === 56 || c === 57) return ['Granizo', 'wx-granizo'];
  if (c >= 71) return ['Nevando', 'wx-nevando'];
  if (c >= 61) return ['Lluvia', 'wx-lluvia'];
  if (c >= 51) return ['Posible lluvia', 'wx-paraguas'];
  if (c >= 45) return ['Niebla', 'wx-nublado'];
  if (v >= 40) return ['Ventoso', 'wx-viento'];
  if (t <= 3) return ['Frío', 'wx-frio'];
  if (t >= 33) return ['Caluroso', 'wx-calor'];
  if (h >= 85 && t >= 20) return ['Mucha humedad', 'wx-humedad'];
  if (c === 3) return ['Nublado', 'wx-nublado'];
  if (c >= 1) return ['Sol y nubes', 'wx-sol-nubes'];
  return dia ? ['Soleado', 'wx-sol'] : ['Despejado', 'moon'];
}
const WX_QUERY = 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day';
// Tres fuentes gratuitas en cadena, normalizadas al mismo formato. ipapi.co va
// la ÚLTIMA: limita sin aviso y respondía 403 (HTML) en cada arranque, con un
// error en consola y una espera de más antes del clima (auditoría 2026-10).
async function getGeo() {
  if (geoCache) return geoCache;
  const fuentes = [
    ['https://ipwho.is/', (j) => ({ city: j.city, region: j.region, country_name: j.country, latitude: j.latitude, longitude: j.longitude, timezone: j.timezone && j.timezone.id })],
    ['https://get.geojs.io/v1/ip/geo.json', (j) => ({ city: j.city, region: j.region, country_name: j.country, latitude: +j.latitude, longitude: +j.longitude, timezone: j.timezone })],
    ['https://ipapi.co/json/', (j) => j]
  ];
  for (const [url, map] of fuentes) {
    try {
      const j = map(await (await fetch(url)).json());
      if (j && j.latitude != null && !isNaN(+j.latitude)) { geoCache = j; return geoCache; }
    } catch { /* siguiente fuente */ }
  }
  throw new Error('geo no disponible');
}
async function loadWeather(el, kind) {
  try {
    const geo = await getGeo();
    if (kind === 'region') { el.innerHTML = `<div class="wx-ic">${window.icon('map-pin')}</div><div><div class="wx-temp" style="font-size:20px">${escapeHtml(geo.city || '—')}</div><div class="wx-desc">${escapeHtml(geo.region || '')}, ${escapeHtml(geo.country_name || '')}</div><div class="wx-city">${escapeHtml(geo.timezone || '')}</div></div>`; return; }
    if (!wxCache) { const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=${WX_QUERY}`); wxCache = (await r.json()).current; }
    const [desc, ic] = WMO(wxCache);
    // Tarjeta VERDE del bento (2026-08-11): dato grande a la izquierda, icono
    // arriba a la derecha, chips de viento/humedad y ↗ fundido en el scoop.
    el.innerHTML = `
      <div class="wx2-top"><div class="wx2-temp">${Math.round(wxCache.temperature_2m)}°</div><div class="wx2-ic">${window.icon(ic)}</div></div>
      <div class="wx2-desc">${desc}</div>
      <div class="wx2-chips">
        <span class="wx2-chip">${Math.round(wxCache.wind_speed_10m || 0)} km/h</span>
        <span class="wx2-chip">${Math.round(wxCache.relative_humidity_2m || 0)}% hum.</span>
      </div>
      <div class="wx2-city">${escapeHtml(geo.city || '')}</div>
      <button class="wx2-go" title="Pronóstico completo">${window.icon('arrow-up-right')}</button>`;
    el.querySelector('.wx2-go').addEventListener('click', (e) => { e.stopPropagation(); navigateActive(window.naviBuscadores.urlDeBusqueda(settings.buscador, 'clima ' + (geo.city || ''))); });
  } catch { el.innerHTML = '<div class="w-loading">Clima no disponible (sin conexión)</div>'; }
}

/* ============ Widget Cuenta (2026-08-11) ============
   Dos estados: sin sesión (invita a crearla) y con sesión (quién eres y cuándo
   sincronizó). El FAB ↗ vive fundido en la esquina (scoop) y abre el modal de
   cuenta que ya existe. Se repinta desde renderAccountPill al cambiar el estado. */
function renderUserCard(body) {
  const logged = !!(account && account.token);
  body.classList.toggle('u-on', logged);
  if (logged) {
    const nombre = nombreCuenta();
    const st = store.get('naviris.syncStamp', 0);
    body.innerHTML = `
      <div class="u-ava">${escapeHtml(nombre.charAt(0).toUpperCase())}</div>
      <div class="u-nom">${escapeHtml(nombre)}</div>
      <div class="u-mail">${escapeHtml(account.email)}</div>
      <div class="u-sync">${st ? 'Sincronizada · ' + new Date(st).toLocaleDateString('es') : 'Aún sin sincronizar aquí'}</div>
      <button class="u-go" title="Gestionar cuenta">${window.icon('arrow-up-right')}</button>`;
    // La foto llega del servidor: va por style, nunca dentro del HTML (como en pintaFoto).
    const foto = fotoLocal(), ava = body.querySelector('.u-ava');
    if (foto) { ava.style.backgroundImage = `url("${foto}")`; ava.classList.add('con-foto'); }
  } else {
    body.innerHTML = `
      <div class="u-ava u-ava-off">${window.icon('user-circle')}</div>
      <div class="u-nom">Tu cuenta</div>
      <div class="u-mail">Tema, fondo y ajustes en la nube, en cualquier equipo</div>
      <div class="u-sync">Sin sesión iniciada</div>
      <button class="u-go" title="Iniciar sesión">${window.icon('arrow-up-right')}</button>`;
  }
  body.onclick = () => showAccountModal(); // onclick y no addEventListener: se repinta y no acumula
}
function refrescaUserCards() { document.querySelectorAll('.w-user').forEach((b) => renderUserCard(b)); pintaFoto(); }

/* ============ Widget Calendario con recordatorios (2026-08-11) ============ */
const recordatorios = () => store.get('naviris.reminders', []);
const guardaRecordatorios = (l) => store.set('naviris.reminders', l);
function renderCalendar(body) {
  const vista = new Date(); vista.setDate(1);
  const pinta = () => {
    const y = vista.getFullYear(), m = vista.getMonth(); const hoy = new Date();
    // Mayúscula solo inicial ("Agosto de 2026"): el capitalize de CSS pondría "Agosto De 2026"
    const bruto = vista.toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const nombre = bruto.charAt(0).toUpperCase() + bruto.slice(1);
    const marca = new Set(recordatorios().map((r) => r.fecha));
    const hueco = (vista.getDay() + 6) % 7; // semana empieza en lunes
    const dias = new Date(y, m + 1, 0).getDate();
    let celdas = '';
    for (let i = 0; i < hueco; i++) celdas += '<span></span>';
    for (let d = 1; d <= dias; d++) {
      const f = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const esHoy = hoy.getFullYear() === y && hoy.getMonth() === m && hoy.getDate() === d;
      celdas += `<button class="cal-d${esHoy ? ' hoy' : ''}${marca.has(f) ? ' con' : ''}" data-f="${f}">${d}</button>`;
    }
    body.innerHTML = `
      <div class="cal-top">
        <button class="cal-nav" data-d="-1" title="Mes anterior" aria-label="Mes anterior">${window.icon('chevron-left')}</button>
        <div class="cal-mes">${nombre}</div>
        <button class="cal-nav" data-d="1" title="Mes siguiente" aria-label="Mes siguiente">${window.icon('chevron-right')}</button>
      </div>
      <div class="cal-sem"><span>Lu</span><span>Ma</span><span>Mi</span><span>Ju</span><span>Vi</span><span>Sá</span><span>Do</span></div>
      <div class="cal-grid">${celdas}</div>`;
    body.querySelectorAll('.cal-nav').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); vista.setMonth(vista.getMonth() + +b.dataset.d); pinta(); }));
    body.querySelectorAll('.cal-d').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); formulario(b.dataset.f); }));
  };
  const formulario = (f) => {
    const diaBruto = new Date(f + 'T00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
    const dia = diaBruto.charAt(0).toUpperCase() + diaBruto.slice(1);
    const lista = recordatorios().filter((r) => r.fecha === f).sort((a, b) => a.hora.localeCompare(b.hora));
    body.innerHTML = `
      <div class="cal-top">
        <button class="cal-nav cal-volver" title="Volver" aria-label="Volver">${window.icon('chevron-left')}</button>
        <div class="cal-mes">${dia}</div><span></span>
      </div>
      <div class="cal-lista">${lista.map((r) => `<div class="cal-r"><span class="cal-r-h">${r.hora}</span><span class="cal-r-t">${escapeHtml(r.texto)}</span><button class="cal-r-x" data-id="${r.id}" title="Quitar">${window.icon('x-mark')}</button></div>`).join('') || '<div class="cal-nada">Sin recordatorios</div>'}</div>
      <div class="cal-form">
        <input type="time" class="cal-hora" value="09:00" />
        <input type="text" class="cal-texto" placeholder="Recordatorio…" maxlength="80" />
        <button class="cal-add" title="Añadir">${window.icon('plus')}</button>
      </div>`;
    body.querySelector('.cal-volver').addEventListener('click', (e) => { e.stopPropagation(); pinta(); });
    body.querySelectorAll('.cal-r-x').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); guardaRecordatorios(recordatorios().filter((r) => String(r.id) !== b.dataset.id)); formulario(f); }));
    const alta = () => {
      const texto = body.querySelector('.cal-texto').value.trim(); if (!texto) return;
      const l = recordatorios(); l.push({ id: Date.now(), fecha: f, hora: body.querySelector('.cal-hora').value || '09:00', texto, avisado: false });
      guardaRecordatorios(l); formulario(f);
    };
    body.querySelector('.cal-add').addEventListener('click', (e) => { e.stopPropagation(); alta(); });
    body.querySelector('.cal-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter') alta(); });
    window.nvsRepasa?.(body);   // la lista es nueva (también al añadir con Enter, sin clic)
  };
  pinta();
}

/* ============ Widget Tendencias de X (mundial) ============
   Sin API: se lee trends24.in (recopila las tendencias mundiales públicas) en
   un webview OCULTO que se destruye al terminar; caché de 20 min. Clic = buscar
   el tema en X. */
let xtCache = { t: 0, items: [], src: 'mundial' };
function scrapeOculto(url, code, timeoutMs = 15000) {
  return new Promise((res) => {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', PARTITION);
    wv.style.cssText = 'position:absolute;left:-9999px;top:0;width:1000px;height:800px;';
    let fin = false;
    const acaba = (v) => { if (fin) return; fin = true; try { wv.remove(); } catch { } res(v); };
    setTimeout(() => acaba(null), timeoutMs);
    wv.addEventListener('dom-ready', () => {
      setTimeout(() => { wv.executeJavaScript(code, false).then(acaba).catch(() => acaba(null)); }, 1500);
    });
    wv.src = url; document.body.appendChild(wv);
  });
}
const XT_LEE = `(async () => {
  const out = [];
  const tarjeta = document.querySelector('.trend-card');
  if (tarjeta) tarjeta.querySelectorAll('.trend-card__list a').forEach((a) => out.push(a.textContent.trim()));
  if (!out.length) document.querySelectorAll('ol li a').forEach((a) => { if (out.length < 12) out.push(a.textContent.trim()); });
  /* Fuera su service worker (auditoría 2026-10): trends24 lo registra en cada
     visita y dejaba un proceso vivo indefinidamente con el hub en reposo. */
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { /* sin SW */ }
  return out.filter(Boolean).slice(0, 9);
})()`;
// x.com/explore con TU sesion: tendencias "Para ti" (el algoritmo del propio
// usuario). Sin sesion, X no pinta [data-testid=trend] y caemos a mundiales.
/* ESPERA ACTIVA (2026-08-13). Se leía 1,5 s después de cargar y X todavía no
   había pintado las tendencias: salían menos de tres y el widget caía a las
   mundiales. Comprobado con el CDP de Dosa que el webview oculto SÍ entra con
   su sesión y ve doce — solo hacía falta esperarlas. */
const XT_LEE_X = `(async () => {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 14; i++) {
    // Sin sesión X manda al login: no hay nada que esperar (antes, 24 s de webview)
    if (['/login', '/i/flow/login', '/i/jf/onboarding'].some((p) => location.pathname.startsWith(p))) return { login: true };
    if (document.querySelectorAll('[data-testid="trend"]').length >= 3) break;
    await esperar(700);
  }
  const out = [];
  /* En x.com/home las tendencias viven en el módulo lateral "Qué está
     pasando"; en /explore son la lista principal. Se prueban las dos formas
     porque el data-testid no siempre está en el mismo sitio. */
  const modulo = document.querySelector('[aria-label*="endencias"], [aria-label*="rending"]');
  if (modulo && !document.querySelector('[data-testid="trend"]')) {
    modulo.querySelectorAll('div[dir="ltr"], span').forEach((e) => {
      const t = (e.textContent || '').trim();
      if (t.startsWith('#') && t.length > 1 && !out.includes(t)) out.push(t);
    });
    if (out.length >= 3) return out.slice(0, 9);
    out.length = 0;
  }
  document.querySelectorAll('[data-testid="trend"]').forEach((t) => {
    const lineas = (t.innerText || '').split('\\n').map((x) => x.trim()).filter(Boolean);
    const tag = lineas.find((l) => l.startsWith('#')) || lineas[1] || lineas[0];
    if (tag && tag.length > 1 && !out.includes(tag)) out.push(tag);
  });
  return out.slice(0, 9);
})()`;
function renderXTrends(body) {
  const pinta = (items, cargando) => {
    const fuente = xtCache.src === 'ti' ? 'Para ti' : 'Mundial';
    const sinSesion = !cargando && xtCache.src !== 'ti';
    body.innerHTML = `<div class="w-head">${window.brandIcon('x') || window.icon('hash')} Tendencias<span class="xt-chip">${fuente} · X</span>` +
      `<button class="wh-btn xt-rf" title="Volver a leer las tendencias">${window.icon('arrow-path')}</button></div>` +
      `<div class="xt-lista">` +
      (cargando ? '<div class="w-vacio">Leyendo tendencias…</div>'
        : (items.map((t, i) => `<button class="xt-i"><span class="xt-n">${i + 1}</span><bdi class="xt-t">${escapeHtml(t)}</bdi>${window.icon('arrow-up-right')}</button>`).join('') ||
          '<div class="w-vacio">No se pudieron leer las tendencias</div>')) + `</div>` +
      // Las "Para ti" salen de TU sesión de X. Sin ella solo hay mundiales, y
      // callarlo hacía pensar que el widget estaba roto.
      (sinSesion ? `<button class="xt-login">Inicia sesión en X para ver las tuyas</button>` : '');
    body.querySelector('.xt-login')?.addEventListener('click', (e) => { e.stopPropagation(); navigateActive('https://x.com/login'); });
    body.querySelector('.xt-rf')?.addEventListener('click', (e) => {
      e.stopPropagation(); xtCache = { t: 0, items: [], src: 'mundial' }; renderXTrends(body);
    });
    body.querySelectorAll('.xt-i').forEach((b, i) => b.addEventListener('click', (e) => {
      e.stopPropagation(); navigateActive('https://x.com/search?q=' + encodeURIComponent(items[i]));
    }));
    // Sin scrollbar: solo las filas que CABEN completas en la talla actual.
    const cont = body.querySelector('.xt-lista'); if (cont) recortaFilas(cont, '.xt-i');
  };
  /* La caché duraba 20 min PARA TODO, también para el respaldo mundial: una
     vez caía ahí seguía enseñando mundiales veinte minutos aunque ya tuvieras
     X abierto. Ahora lo tuyo se cachea 20 min y el respaldo solo 2, para que
     vuelva a intentarlo en cuanto haya sesión. */
  const vida = xtCache.src === 'ti' ? 20 * 60 * 1000 : 2 * 60 * 1000;
  if (xtCache.items.length && Date.now() - xtCache.t < vida) { pinta(xtCache.items); return; }
  pinta([], true);
  /* UNA lectura a la vez (auditoría 2026-10): cada repintado del hub con la
     caché vacía (tema, ventana, accesos, sincronización) lanzaba su propia
     cadena de webviews ocultos, hasta cinco x.com a la vez. Ahora todos se
     cuelgan de la que esté en marcha y, al acabar, se pinta la tarjeta viva. */
  if (!xtLectura) xtLectura = leeTendencias().finally(() => { xtLectura = null; });
  xtLectura.then(() => { if (body.isConnected) pinta(xtCache.items); });
}
/* De donde salen tus tendencias, por orden (2026-08-13):
   1. TU PESTANA de X. Es la unica que tiene tu sesion de verdad.
   2. Un webview oculto en x.com/explore. Se queda como segundo intento
      porque, comprobado, X lo trata como visitante y lo manda al login —
      por eso salian las mundiales aunque tuvieras X abierto. Si acaba en el
      login, en los 20 min siguientes ni se intenta (no hay sesion que leer).
   3. trends24.in: las mundiales publicas, el ultimo recurso honesto. */
let xtLectura = null, xtSinSesionHasta = 0;
function leeTendencias() {
  const deTuPestana = () => {
    const t = tabs.find((x) => x.kind === 'web' && !x.asleep && x.webview &&
      /(^|\.)(x|twitter)\.com$/.test(hostOf(x.url) || ''));
    if (!t) return Promise.resolve(null);
    return t.webview.executeJavaScript(XT_LEE_X, false).catch(() => null);
  };
  const mundiales = () => scrapeOculto('https://trends24.in/', XT_LEE).then((mundo) => {
    if (mundo && mundo.length) xtCache = { t: Date.now(), items: mundo, src: 'mundial' };
  });
  return deTuPestana().then((mias) => {
    if (mias && mias.length >= 3) { xtCache = { t: Date.now(), items: mias, src: 'ti' }; return null; }
    if (Date.now() < xtSinSesionHasta) return mundiales();
    return scrapeOculto('https://x.com/explore', XT_LEE_X, 24000).then((tuyas) => {
      if (tuyas && tuyas.length >= 3) { xtCache = { t: Date.now(), items: tuyas, src: 'ti' }; return null; }
      if (tuyas && tuyas.login) xtSinSesionHasta = Date.now() + 20 * 60 * 1000;
      return mundiales();
    });
  });
}

/* ============ Widget Imagen (los huecos "violeta" del bento) ============
   Un marco para la imagen que el usuario quiera: se elige de disco y llena la
   tarjeta (cover). La ruta se guarda EN el widget (naviris.widgets). */
/* Imagenes POR TEMA (2026-08-12): cada tema trae su juego empaquetado en
   src/temas/<tema>/<slot>.jpg. El widget guarda un `slot` (1..3) y solo usa
   ruta propia si el usuario elige una imagen suya (w.img manda siempre).
   El tema lo da temaActual() (arriba, lee el ajuste guardado): aqui habia una
   SEGUNDA definicion que lo deducia de las clases de <html> y, por izado, se
   comia a la primera — el arranque preguntaba el tema ANTES de poner esas
   clases, asi que siempre respondia 'oscuro' (fogonazo oscuro al abrir en
   claro/rosa y fondo del tema equivocado). */
/* Manda el SLOT (2026-08-12): un contenedor con slot ensena la foto del tema
   activo y cambia con el. `img` es solo para la imagen que elija el usuario, y
   al elegirla se retira el slot para que su foto mande. Antes era al reves, y
   los contenedores que apuntaban a un archivo suelto del disco se quedaban
   clavados en el juego de un tema (y solo existian en ese equipo). */
/* El tema MONO no trae laminas propias: usa las del oscuro y el CSS las pasa
   a gris (:root.mono .w-img.img-tema img). Tres JPG mas en el repo para decir
   exactamente lo mismo no compensan, y asi no se pueden desincronizar. */
function carpetaLaminas() { const t = temaActual(); return t === 'mono' ? 'oscuro' : t; }
function imagenDeTema(w) {
  if (w.slot) return `temas/${carpetaLaminas()}/${w.slot}.jpg`;
  return w.img || '';
}
function renderImagen(body, w) {
  const elige = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const ruta = window.navirisApp.filePath(f);
      if (!ruta) return;
      // GIF animado permitido: es contenido DEL USUARIO y la optimizacion es
      // decision suya (la regla anti-animacion-infinita es para NUESTRA UI).
      if (/\.gif$/i.test(ruta)) toast('GIF en bucle: se ve genial, pero consume más GPU. Decisión tuya');
      w.img = 'file:///' + ruta.replace(/\\/g, '/'); w.slot = 0; saveWidgets(); pinta();
    };
    inp.click();
  };
  const pinta = () => {
    const src = imagenDeTema(w);
    body.classList.toggle('con-img', !!src);
    // Lamina DEL TEMA (no del usuario): es la unica que el tema mono pasa a gris.
    body.classList.toggle('img-tema', !!w.slot);
    if (src) {
      body.innerHTML = `<img src="${escapeHtml(src)}" alt="" /><button class="wi-cambia" title="Cambiar imagen">${window.icon('photo')}</button>`;
      const imgW = body.querySelector('img');
      imgW.addEventListener('error', () => { imgW.style.display = 'none'; });
      body.querySelector('.wi-cambia').addEventListener('click', (e) => { e.stopPropagation(); elige(); });
      body.onclick = null;
    } else {
      body.innerHTML = `<div class="wi-vacio">${window.icon('photo')}<span>Elegir imagen</span></div>`;
      body.onclick = elige;
    }
  };
  pinta();
}

/* ============ Widget Correo — SOLO GMAIL (2026-08-12) ============
   Gmail se lee por su feed atom nativo con TUS cookies (lo pide main, sin
   CORS). Se retiraron las pestañas de Outlook y "+": Outlook no publica feed
   y montar su OAuth (registro en Entra, PKCE, token en disco) no compensa
   para una pestaña de widget — decisión de Dosa, 2026-08-12.
   El widget pasa a leerse como una bandeja de verdad: cabecera con la marca,
   el número de no leídos como dato grande, y filas con inicial del remitente,
   asunto y hora. Sin barras de scroll: las filas que no caben se ocultan
   (mismo criterio que el widget de Descargas). */
let mailCache = { t: 0, entradas: null, total: '0', err: null };
function mlHora(ts) {
  if (!ts) return '';
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return min + ' min';
  const hor = Math.round(min / 60);
  if (hor < 24) return hor + ' h';
  const dias = Math.round(hor / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return dias + ' d';
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
async function cargaGmail(force) {
  if (!force && mailCache.entradas && Date.now() - mailCache.t < 5 * 60 * 1000) return mailCache;
  try {
    const r = await window.navirisApp.gmailFeed();
    if (!r.ok) { mailCache = { t: Date.now(), entradas: null, total: '0', err: (r.status === 401 || r.status === 403) ? 'sin-sesion' : 'error' }; return mailCache; }
    const doc = new DOMParser().parseFromString(r.xml, 'text/xml');
    const entradas = [...doc.querySelectorAll('entry')].slice(0, 8).map((e) => ({
      asunto: (e.querySelector('title')?.textContent || '').trim() || '(sin asunto)',
      de: (e.querySelector('author > name')?.textContent || '').trim() ||
          (e.querySelector('author > email')?.textContent || '').trim() || 'Desconocido',
      resumen: (e.querySelector('summary')?.textContent || '').trim(),
      fecha: Date.parse(e.querySelector('issued')?.textContent || e.querySelector('modified')?.textContent || '') || 0,
      link: e.querySelector('link')?.getAttribute('href') || 'https://mail.google.com'
    }));
    mailCache = { t: Date.now(), entradas, total: doc.querySelector('fullcount')?.textContent || '0', err: null };
  } catch { mailCache = { t: Date.now(), entradas: null, total: '0', err: 'error' }; }
  return mailCache;
}
function renderMail(body) {
  const cabecera = (girando) => `<div class="w-head">${window.brandIcon('gmail') || window.icon('inbox')}<span>Bandeja</span>
    <button class="wh-btn ml-recarga${girando ? ' ml-ocupado' : ''}" title="Actualizar">${window.icon('arrow-path')}</button></div>`;
  const fila = (e, i) => `<button class="ml-i" data-i="${i}" title="${escapeHtml(e.asunto)}">
      <span class="ml-txt">
        <span class="ml-de">${escapeHtml(e.de)}</span>
        <span class="ml-asunto">${escapeHtml(e.asunto)}</span>
        <span class="ml-resumen">${escapeHtml(e.resumen.slice(0, 90))}</span>
      </span>
      <span class="ml-hora">${escapeHtml(mlHora(e.fecha))}</span>
    </button>`;
  const pinta = async (force) => {
    body.innerHTML = cabecera(true) + '<div class="ml-hero"><span class="ml-n">·</span><span class="ml-lbl">leyendo bandeja</span></div>';
    ata();
    const m = await cargaGmail(force);
    let cuerpo;
    if (m.err === 'sin-sesion') {
      cuerpo = `<div class="w-vacio">Inicia sesión en Gmail para ver tu bandeja<button class="w-cta ml-abre">Abrir Gmail</button></div>`;
    } else if (m.err || !m.entradas) {
      cuerpo = `<div class="w-vacio">No se pudo leer la bandeja<button class="w-cta ml-recarga">Reintentar</button></div>`;
    } else if (!m.entradas.length) {
      cuerpo = `<div class="ml-limpia">${window.icon('check')}<span>Bandeja limpia</span></div>` +
        `<button class="ml-pie">Abrir Gmail ${window.icon('arrow-up-right')}</button>`;
    } else {
      const n = m.total || String(m.entradas.length);
      cuerpo = `<div class="ml-hero"><span class="ml-n">${escapeHtml(n)}</span><span class="ml-lbl">sin leer</span></div>` +
        `<div class="ml-lista">${m.entradas.map(fila).join('')}</div>` +
        `<button class="ml-pie">Abrir Gmail ${window.icon('arrow-up-right')}</button>`;
    }
    body.innerHTML = cabecera(false) + cuerpo;
    ata();
    recorta();
    function recorta() {
      const cont = body.querySelector('.ml-lista'); if (cont) recortaFilas(cont, '.ml-i', 2);
    }
    function ata() {
      body.querySelectorAll('.ml-recarga').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); pinta(true); }));
      body.querySelector('.ml-abre')?.addEventListener('click', (ev) => { ev.stopPropagation(); navigateActive('https://mail.google.com'); });
      body.querySelector('.ml-pie')?.addEventListener('click', (ev) => { ev.stopPropagation(); navigateActive('https://mail.google.com'); });
      body.querySelectorAll('.ml-i').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation(); const ent = mailCache.entradas?.[+b.dataset.i]; if (ent) navigateActive(ent.link);
      }));
    }
  };
  pinta();
}

/* ============ Widget DESCARGAS (2026-08-11) ============
   Diseño propio: ANILLO de progreso (SVG, avanza por eventos — nada infinito)
   con la descarga activa, y las últimas completadas como filas. Bebe de los
   mismos eventos download:new/update del panel. */
const dlVivo = new Map();
function anilloSVG() {
  return `<svg class="dlw-anillo" viewBox="0 0 72 72">
    <circle class="dlw-riel" cx="36" cy="36" r="31" />
    <circle class="dlw-avance" cx="36" cy="36" r="31" pathLength="100" />
  </svg>`;
}
function renderDescargasW(body) {
  body.innerHTML = `
    <div class="dlw-activa hidden">
      <div class="dlw-aro">${anilloSVG()}<div class="dlw-centro">${window.icon('download')}<span class="dlw-pct hidden"></span></div></div>
      <div class="dlw-meta"><div class="dlw-nombre"></div><div class="dlw-sub"></div></div>
    </div>
    <div class="w-head">${window.icon('download')} Hoy<span class="wh-sub dlw-cnt"></span></div>
    <div class="dlw-lista"><div class="w-vacio">Leyendo descargas…</div></div>
    <button class="w-cta dlw-ir">Panel de descargas</button>`;
  body.querySelector('.dlw-ir').addEventListener('click', (e) => { e.stopPropagation(); toggleDownloadsPage(); });
  llenaHoyDescargas(body);
  actualizaDescargasW();
}
/* Todas las descargas DE HOY (no solo la activa): filas que quepan, sin
   scrollbar; clic abre el archivo. */
function llenaHoyDescargas(body) {
  const cont = body.querySelector('.dlw-lista'); if (!cont) return;
  window.navirisApp.listDownloadFiles().then((files) => {
    const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
    const hoy = (files || []).filter((f) => f.mtime >= hoy0.getTime());
    const cnt = body.querySelector('.dlw-cnt'); if (cnt) cnt.textContent = hoy.length ? String(hoy.length) : '';
    cont.innerHTML = hoy.map((f) => {
      const ext = (f.name.split('.').pop() || 'doc').slice(0, 4);
      return `<button class="dlw-r" data-n="${escapeHtml(f.name)}"><span class="dlw-r-k">${escapeHtml(ext)}</span><span class="dlw-r-n">${escapeHtml(f.name)}</span></button>`;
    }).join('') || '<div class="w-vacio">Hoy no has descargado nada</div>';
    cont.querySelectorAll('.dlw-r').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); window.navirisApp.openDownloadFile(b.dataset.n); }));
    recortaFilas(cont, '.dlw-r');
  }).catch(() => { cont.innerHTML = '<div class="w-vacio">No se pudo leer la carpeta</div>'; });
}
function actualizaDescargasW() {
  const activa = [...dlVivo.values()].reverse().find((m) => m.state === 'progressing' || m.state === 'started');
  document.querySelectorAll('.w-dlw').forEach((el) => {
    const caja = el.querySelector('.dlw-activa'); if (!caja) return;
    caja.classList.toggle('hidden', !activa);
    if (!activa) return;
    const p = activa.total ? Math.round(activa.received / activa.total * 100) : null;
    el.querySelector('.dlw-nombre').textContent = activa.name || 'Descargando…';
    el.querySelector('.dlw-sub').textContent = p == null ? 'Descargando…' : p + '% — en curso';
    const pct = el.querySelector('.dlw-pct');
    pct.textContent = p == null ? '…' : p + '%';
    pct.classList.remove('hidden');
    el.querySelector('.dlw-centro svg').classList.add('hidden');
    const av = el.querySelector('.dlw-avance');
    if (av) av.style.strokeDashoffset = String(100 - (p ?? 30));
  });
}


/* ============ Widget MOOVIN (2026-08-12) ============
   Acceso a la biblioteca privada de MOOVIN. Desde 2.7.10-dev.4 Naviris ya NO
   pone el pase: entra a la cuenta de MOOVIN que este vinculada a esta cuenta
   de Naviris (ver `moovin:identidad` en main). Sin cuenta, o sin vincular,
   MOOVIN enseña su pantalla de entrada. El widget sigue siendo la puerta. */
function renderMoovinW(body) {
  body.innerHTML = `
    <div class="mv-cartel">${window.icon('tv')}</div>
    <div class="mv-meta"><div class="mv-tit">MOOVIN</div><div class="mv-sub">Tu biblioteca privada</div></div>
    <button class="mv-play" title="Entrar">${window.icon('play')}</button>`;
  const abre = (e) => { e?.stopPropagation(); navigateActive('https://moovin.live/'); };
  body.querySelector('.mv-play').addEventListener('click', abre);
  body.addEventListener('click', abre);
}

/* ============ Widget MONITOR (2026-08-12) ============
   RAM del sistema y consumo de Naviris (CPU/RAM), en barras. Sondeo cada 3 s
   solo con el hub visible; se apaga solo si el widget desaparece. */
let monTimer = null;
function renderMonitorW(body) {
  body.innerHTML = `
    <div class="w-head">${window.icon('res-scale')} Monitor</div>
    <div class="mon-stats">
      <div class="mon-stat"><span class="mon-k">RAM</span><span class="mon-v mon-ram-v">—</span><div class="mon-riel"><i class="mon-ram"></i></div></div>
      <div class="mon-stat"><span class="mon-k">CPU</span><span class="mon-v mon-cpu-v">—</span><div class="mon-riel"><i class="mon-cpu"></i></div></div>
    </div>
    <div class="mon-pie"><span class="mon-app">Naviris —</span><span class="mon-proc"></span></div>
    <div class="mon-acc">
      <button class="mon-b mon-juego" title="Duerme pestañas de fondo y silencia el ruido">${window.icon('play')}<span>Modo juego</span></button>
      <button class="mon-b mon-limpia" title="Duerme las pestañas de fondo que no suenan">${window.icon('arrow-path')}<span>Liberar</span></button>
    </div>`;
  body.querySelector('.mon-juego').addEventListener('click', (e) => { e.stopPropagation(); modoJuego(); });
  body.querySelector('.mon-limpia').addEventListener('click', (e) => { e.stopPropagation(); liberaMemoria(); });
  monTimer = relojHub(monTimer, actualizaMonitor, 3000); // fresco: un tick durante el re-render lo apagaba
  requestAnimationFrame(actualizaMonitor); // el body aun no esta en el DOM
}
async function actualizaMonitor() {
  if (!widgets.some((w) => w.type === 'monitor')) { clearInterval(monTimer); monTimer = null; return; }
  const cajas = document.querySelectorAll('.w-mon');
  if (!els.hub.classList.contains('active')) return;
  const st = await window.navirisApp.sysStats().catch(() => null); if (!st) return;
  const gbApp = st.appMb >= 1024 ? (st.appMb / 1024).toFixed(1) + ' GB' : st.appMb + ' MB';
  /* Las barras van por transform (auditoría 2026-10): animar `width` cada 3 s
     recalculaba la maquetación del hub entero. Y solo se escribe lo que
     cambia: reescribir el mismo dato también repintaba. La barra va a
     punto entero: una décima es menos de un píxel y aun así animaba. */
  const pon = (el, sel, v) => { const n = el.querySelector(sel); if (n && n.textContent !== v) n.textContent = v; };
  const barra = (el, sel, pct) => { const n = el.querySelector(sel), v = 'scaleX(' + Math.round(Math.max(0, Math.min(100, pct))) / 100 + ')'; if (n && n.style.transform !== v) n.style.transform = v; };
  cajas.forEach((el) => {
    barra(el, '.mon-ram', st.ramUso);
    pon(el, '.mon-ram-v', st.ramUso + '%');
    barra(el, '.mon-cpu', st.appCpu);
    pon(el, '.mon-cpu-v', (st.appCpu < 10 ? st.appCpu.toFixed(1) : Math.round(st.appCpu)) + '%');
    pon(el, '.mon-app', 'Naviris ' + gbApp);
    pon(el, '.mon-proc', st.procesos + ' procesos');
  });
}

/* Modo juego: duerme TODAS las pestañas de fondo (libera su renderer) y
   silencia lo que suene. La activa se respeta. Reversible: al volver a una
   pestaña, se recarga sola (mecanica de "dormida" que ya existia). */
function modoJuego() {
  let n = 0;
  for (const t of tabs) {
    // Tampoco la mitad derecha de la pantalla dividida (se está viendo) ni la de AutoClaim (tiene que seguir contando).
    if (t.id === activeId || t.id === divId || t.autoLoot || t.asleep || !t.webview) continue;
    try { t.webview.setAudioMuted(true); } catch { }
    duermePestana(t);
    n++;
  }
  renderTabs(); saveSession();
  toast(n ? `Modo juego: ${n} pestaña${n > 1 ? 's' : ''} dormida${n > 1 ? 's' : ''}` : 'Modo juego: no había pestañas de fondo');
  actualizaMonitor();
}
/* Liberar: lo mismo que hace el ahorro de energía a los 30 min, pero ya
   (auditoría 2026-10; antes repetía about:blank en las que ya dormían y decía
   "Memoria liberada" sin haber hecho nada). Duerme las pestañas de fondo que no
   suenan, no reclaman en Twitch ni son la otra mitad de la pantalla dividida.
   A diferencia del Modo juego, no silencia ni corta nada. */
function liberaMemoria() {
  let n = 0;
  for (const t of tabs) {
    if (t.kind !== 'web' || t.id === activeId || t.id === divId || t.asleep || !t.webview || t.autoLoot || t.audible) continue;
    duermePestana(t); n++;
  }
  if (n) { renderTabs(); saveSession(); }
  toast(n ? `Memoria liberada: ${n} pestaña${n > 1 ? 's' : ''} dormida${n > 1 ? 's' : ''}` : 'No había pestañas de fondo que dormir');
  setTimeout(actualizaMonitor, 800);
}

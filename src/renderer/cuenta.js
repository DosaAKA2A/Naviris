/* Cuenta Naviris: sesión, sincronización, nombre y foto de perfil. */

/* ============ Cuenta Naviris (sincronización de preferencias) ============ */
const ACC_API = 'https://naviris-account.studio-iris2026.workers.dev';
let account = store.get('naviris.account', null); // { email, token }
/* El main necesita el token para pedirle al worker la prueba de identidad
   que MOOVIN cambia por una sesion. Se le pasa al arrancar, al entrar y al
   salir; el se lo queda solo en memoria. */
const avisaTokenCuenta = () => window.navirisApp.cuentaToken(account && account.token ? account.token : '');
avisaTokenCuenta();
// Qué viaja: preferencias de usuario + marcadores + accesos + widgets + notas +
// fondo. NUNCA contraseñas, tarjetas, historial ni sesión (locales por diseño).
const SYNC_SETTINGS = ['lightMode', 'smartSearch', 'xRevealSensitive', 'blockPasskeys', 'restoreSession', 'powerSaver', 'adblockEnabled', 'adblockWhitelist', 'atajos', 'mouseNav'];
function buildSyncData() {
  const s = {};
  for (const k of SYNC_SETTINGS) if (settings[k] !== undefined) s[k] = settings[k];
  return {
    v: 1, settings: s,
    bookmarks: store.get('naviris.bookmarks2', []),
    dials: store.get('naviris.dials', null),
    widgets: store.get('naviris.widgets', null),
    notes: store.get('naviris.notes', ''),
    nombre: store.get('naviris.account.nombre', ''),
    // Un fondo por tema (dev.49). `hubBg` se mantiene para las versiones que
    // aun sincronizan el fondo unico: viaja el del tema activo.
    hubBg: store.get(bgThemeKey(), null),
    hubBgs: Object.fromEntries(TEMAS.map((t) => [t, store.get(bgThemeKey(t), null)]).filter(([, v]) => v != null))
  };
}
async function applySyncData(d) {
  if (!d) return;
  if (Array.isArray(d.bookmarks)) { store.set('naviris.bookmarks2', d.bookmarks); bookmarks = d.bookmarks; }
  if (Array.isArray(d.dials)) { store.set('naviris.dials', d.dials); dials = d.dials; }
  // Sin la tarjeta de accesos: la línea estable aún la manda y aquí viven en el dock
  if (Array.isArray(d.widgets)) { widgets = d.widgets.filter((w) => w && w.type !== 'shortcuts'); store.set('naviris.widgets', widgets); }
  if (typeof d.notes === 'string') store.set('naviris.notes', d.notes);
  // Solo si el blob TRAE la clave: una versión anterior no la manda, y tomar su
  // ausencia por "sin nombre" borraría el que acabas de poner en este equipo.
  if (typeof d.nombre === 'string') store.set('naviris.account.nombre', d.nombre.trim().slice(0, 24));
  if (d.hubBgs && typeof d.hubBgs === 'object') for (const t of TEMAS) if (d.hubBgs[t]) store.set(bgThemeKey(t), d.hubBgs[t]);
  if (d.hubBg && !(d.hubBgs && d.hubBgs[temaActual()])) applyBackground(d.hubBg);
  else if (d.hubBgs) applyBackground(store.get(bgThemeKey(), defaultBgTema()));
  if (d.settings) {
    settings = await window.navirisApp.setSettings(d.settings);
    applyTheme(settings.lightMode); els.optLight.checked = !!settings.lightMode;
    els.optSmartsearch.checked = settings.smartSearch !== false;
    els.optPasskeys.checked = settings.blockPasskeys !== false; els.optRestore.checked = settings.restoreSession !== false;
    els.optPowersaver.checked = settings.powerSaver;
    els.optAtajos.checked = settings.atajos !== false;
    els.optVtabs.checked = !!settings.tabsVerticales;
    els.optMousenav.checked = settings.mouseNav !== false;
    const ab = await window.navirisApp.adblockGet(); els.navShield.classList.toggle('off', !ab.enabled);
  }
  renderBookmarksBar(); renderHub();
}
const accEls = {
  modal: $('#account-modal'), loginView: $('#acc-login-view'), userView: $('#acc-user-view'),
  email: $('#acc-email'), pass: $('#acc-pass'), error: $('#acc-error'), who: $('#acc-who'), last: $('#acc-last'),
  foto: $('#acc-foto'), fotoSet: $('#acc-foto-set'), fotoDel: $('#acc-foto-del'),
  nombre: $('#acc-nombre'),
  pill: $('#hub-account'), pillLabel: $('#hub-account-label')
};

/* ===== NOMBRE DE USUARIO (2026-08-17, petición de Dosa) =====
   Antes, en todas partes donde había que llamarte de algún modo se usaba la
   parte del correo (hatred.aka2a). Ahora puedes poner el tuyo, y manda en los
   tres sitios: la pastilla del hub, el widget de cuenta y la inicial del avatar
   cuando no hay foto.
   Vive en el BLOB de sincronización, no en una clave propia del servidor como
   la foto: son 20 bytes, no compite por el espacio del blob y viaja entre
   equipos sin tocar el worker. Vacío = se vuelve al nombre del correo. */
function nombreCuenta() {
  const n = String(store.get('naviris.account.nombre', '') || '').trim();
  if (n) return n;
  return (account && account.email) ? account.email.split('@')[0] : '';
}
function guardaNombre() {
  if (!accEls.nombre) return;
  const antes = String(store.get('naviris.account.nombre', '') || '');
  const v = accEls.nombre.value.trim().slice(0, 24);
  if (v === antes) return;
  store.set('naviris.account.nombre', v);
  accEls.nombre.value = v;
  accEls.nombre.placeholder = nombreCuenta();
  renderAccountPill();  // pastilla y widget del hub
  pintaFoto();          // la inicial del avatar sigue al nombre
  accPush();            // y viaja a la cuenta con el resto de preferencias
  toast(v ? 'Nombre actualizado' : 'Se usará el nombre de tu correo');
}

function renderAccountPill() {
  const logged = !!(account && account.token);
  accEls.pill.classList.toggle('logged', logged);
  accEls.pillLabel.textContent = logged ? nombreCuenta() : 'Iniciar sesión';
  accEls.pill.title = logged ? `Cuenta Naviris — ${account.email}` : 'Cuenta Naviris: guarda tus preferencias en la nube';
  refrescaUserCards(); // el widget de cuenta del hub refleja el mismo estado
}
function accError(msg) { accEls.error.textContent = msg || ''; accEls.error.classList.toggle('hidden', !msg); }
function showAccountModal() {
  const logged = !!(account && account.token);
  accEls.loginView.classList.toggle('hidden', logged);
  accEls.userView.classList.toggle('hidden', !logged);
  if (logged) {
    accEls.who.textContent = account.email;
    if (accEls.nombre) {
      accEls.nombre.value = String(store.get('naviris.account.nombre', '') || '');
      // El placeholder enseña con qué te va a llamar si lo dejas vacío
      accEls.nombre.placeholder = account.email.split('@')[0];
    }
    cargaFoto();
    const st = store.get('naviris.syncStamp', 0);
    accEls.last.textContent = st ? 'Última sincronización: ' + new Date(st).toLocaleString('es') : 'Aún sin sincronizar en este equipo.';
  } else { accError(''); accEls.pass.value = ''; }
  accEls.modal.classList.remove('hidden');
  if (!logged) accEls.email.focus();
}
accEls.pill.addEventListener('click', showAccountModal);
accEls.foto?.addEventListener('click', eligeFoto);
accEls.fotoSet?.addEventListener('click', eligeFoto);
accEls.fotoDel?.addEventListener('click', quitaFoto);
// Se guarda al salir del campo o con Enter: sin botón de guardar que recordar
accEls.nombre?.addEventListener('change', guardaNombre);
accEls.nombre?.addEventListener('blur', guardaNombre);
accEls.nombre?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); accEls.nombre.blur(); } });
$('#acc-cancel').addEventListener('click', () => accEls.modal.classList.add('hidden'));
$('#acc-close2').addEventListener('click', () => accEls.modal.classList.add('hidden'));

/* ===== FOTO DE PERFIL DE LA CUENTA (2026-08-13) =====
   Vive en el worker, en su propia clave (av:<correo>), no dentro del blob de
   sincronización: ahí competiría con marcadores y widgets por sus 300 KB. Se
   reduce SIEMPRE en el equipo a 128x128 antes de subirla —unos 10 KB— porque
   subir una foto de móvil de 4 MB para verla a 40 píxeles no tiene sentido.
   Se guarda además una copia local para que aparezca al instante al abrir,
   sin esperar a la red. */
const FOTO_LADO = 128;
function fotoLocal() { return store.get('naviris.account.foto', null); }
function pintaFoto(img) {
  const url = img || fotoLocal();
  if (accEls.foto) {
    accEls.foto.style.backgroundImage = url ? `url("${url}")` : '';
    accEls.foto.classList.toggle('con-foto', !!url);
    accEls.foto.textContent = url ? '' : (nombreCuenta().charAt(0).toUpperCase() || '');
    accEls.fotoDel?.classList.toggle('hidden', !url);
  }
  document.querySelectorAll('.w-user .u-ava').forEach((a) => {
    a.style.backgroundImage = url ? `url("${url}")` : '';
    a.classList.toggle('con-foto', !!url);
  });
}
async function cargaFoto() {
  pintaFoto();                                   // primero lo local, sin esperar
  if (!(account && account.token)) return;
  const r = await accRequest('/avatar');
  if (r && r.ok) { store.set('naviris.account.foto', r.img || null); pintaFoto(r.img); }
}
/* Reducción en el cliente: se recorta al cuadrado central y se escala a 128,
   así una foto apaisada no sale deformada. */
function reduceImagen(ruta) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const lado = Math.min(im.naturalWidth, im.naturalHeight);
      const c = document.createElement('canvas'); c.width = c.height = FOTO_LADO;
      const g = c.getContext('2d');
      g.drawImage(im, (im.naturalWidth - lado) / 2, (im.naturalHeight - lado) / 2, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    im.onerror = () => rej(new Error('no se pudo leer la imagen'));
    im.src = 'file:///' + String(ruta).replace(/\\/g, '/');
  });
}
async function eligeFoto() {
  if (!(account && account.token)) { toast('Entra en tu cuenta para poner foto'); return; }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const ruta = window.navirisApp.filePath(f); if (!ruta) return;
    try {
      const img = await reduceImagen(ruta);
      const r = await accRequest('/avatar', { method: 'PUT', body: JSON.stringify({ img }) });
      if (r && r.ok) { store.set('naviris.account.foto', img); pintaFoto(img); toast('Foto de perfil actualizada'); }
      else toast('No se pudo guardar la foto: ' + ((r && r.error) || 'error del servidor'));
    } catch { toast('No se pudo leer esa imagen'); }
  };
  inp.click();
}
async function quitaFoto() {
  const r = await accRequest('/avatar', { method: 'DELETE' });
  if (r && r.ok) { store.set('naviris.account.foto', null); pintaFoto(null); toast('Foto quitada'); }
}
async function accRequest(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (account && account.token) headers.Authorization = 'Bearer ' + account.token;
  try {
    const r = await fetch(ACC_API + path, { ...opts, headers });
    return await r.json();
  } catch { return { ok: false, error: 'Sin conexión con el servidor de cuentas' }; }
}
async function accAuth(path) {
  const email = accEls.email.value.trim(), password = accEls.pass.value;
  if (!email || !password) { accError('Escribe el correo y la contraseña'); return; }
  accError('');
  const r = await accRequest(path, { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!r.ok) { accError(r.error || 'No se pudo iniciar sesión'); return; }
  account = { email: r.email, token: r.token };
  store.set('naviris.account', account);
  avisaTokenCuenta();
  renderAccountPill();
  // Al entrar: si la cuenta ya tiene datos se cargan aquí (eso es "moverse de PC");
  // si está vacía (recién creada), se sube lo de este equipo.
  const s = await accRequest('/sync');
  if (s.ok && s.data) { await applySyncData(s.data); store.set('naviris.syncStamp', s.updatedAt); toast('Preferencias de tu cuenta cargadas'); }
  else if (s.ok) { await accPush(); toast('Cuenta lista: tus preferencias ya están en la nube'); }
  showAccountModal();
}
$('#acc-login').addEventListener('click', () => accAuth('/login'));
$('#acc-register').addEventListener('click', () => accAuth('/register'));
accEls.pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') accAuth('/login'); });
$('#acc-logout').addEventListener('click', async () => {
  await accRequest('/logout', { method: 'POST' });
  // Foto y nombre son de la CUENTA, no del equipo: al salir se van con ella
  store.set('naviris.account.foto', null);
  store.set('naviris.account.nombre', '');
  account = null; store.set('naviris.account', null); store.set('naviris.syncStamp', 0);
  avisaTokenCuenta();
  renderAccountPill(); showAccountModal();
});
let lastPushJson = '';
async function accPush() {
  if (!account || !account.token) return;
  const data = buildSyncData();
  const r = await accRequest('/sync', { method: 'PUT', body: JSON.stringify({ data }) });
  if (r.ok) { lastPushJson = JSON.stringify(data); store.set('naviris.syncStamp', r.updatedAt); }
  else if (/Sesión caducada/.test(r.error || '')) { account = null; store.set('naviris.account', null); avisaTokenCuenta(); renderAccountPill(); }
  return r;
}
$('#acc-sync').addEventListener('click', async () => {
  const r = await accPush();
  toast(r && r.ok ? 'Sincronizado' : 'No se pudo sincronizar');
  showAccountModal();
});
// Al arrancar con sesión: baja lo del servidor si es más nuevo que lo aplicado aquí
async function accBootSync() {
  if (!account || !account.token) return;
  const s = await accRequest('/sync');
  if (s.ok && s.data && s.updatedAt > store.get('naviris.syncStamp', 0)) { await applySyncData(s.data); store.set('naviris.syncStamp', s.updatedAt); }
  lastPushJson = JSON.stringify(buildSyncData());
}
// Empuje automático: cada minuto, solo si algo cambió de verdad
setInterval(() => {
  if (!account || !account.token || IS_PRIVATE) return;
  const now = JSON.stringify(buildSyncData());
  if (now !== lastPushJson) accPush();
}, 60000);
renderAccountPill();

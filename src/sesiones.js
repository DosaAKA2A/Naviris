/* ===== SESIONES QUE SOBREVIVEN AL CIERRE (2026-08-13) =====
   A Dosa se le cerraba la sesión de Spotify al cerrar Naviris, y SOLO la de
   Spotify. Comprobado en disco con la app cerrada: faltaba sp_dc, mientras
   las de X y YouTube seguían ahí. La explicación: sp_dc es una cookie DE
   SESIÓN (sin fecha de caducidad), y esas Chromium las tira al salir. Las de
   X y YouTube son persistentes, por eso aguantaban.

   Chrome no las tira si tienes activado "Continuar donde lo dejaste": ese
   ajuste conserva las cookies de sesión entre arranques. Electron no trae
   ese comportamiento, así que se implementa aquí — y main.js lo llama SOLO si
   el ajuste equivalente de Naviris está activo, porque es su significado: si
   pides continuar donde lo dejaste, la sesión de tus webs forma parte de
   eso. Con el ajuste apagado, cerrar sigue cerrando sesiones.

   Cómo: al salir, las cookies marcadas como de sesión se vuelven a escribir
   con caducidad de 30 días. Es lo mismo que hace Chrome de facto.
   Va aparte de main.js para poder probarlo sin Electron (test/sesiones.test.js):
   recibe el `cookies` de una sesión y devuelve cuántas conservó. */
const DIAS_SESION = 30;

async function conservaCookiesDeSesion(cookies, ahora = Date.now()) {
  const todas = await cookies.get({});
  const caduca = Math.floor(ahora / 1000) + DIAS_SESION * 24 * 60 * 60;
  let n = 0;
  for (const c of todas) {
    if (!c.session) continue;                    // las persistentes ya aguantan
    const host = (c.domain || '').replace(/^\./, '');
    if (!host) continue;
    const url = (c.secure ? 'https://' : 'http://') + host + (c.path || '/');
    /* Las PARTICIONADAS (CHIPS) se quedan como están (2026-11-03). Son las que
       pone un iframe de otro sitio (un video de YouTube incrustado, el botón
       de Google, un Turnstile...) y solo valen dentro de la web que lo
       incrusta. cookies.get({}) las devuelve mezcladas con las demás y sin
       decir que lo son, y al reescribirlas aquí sin partición se volvían
       cookies NORMALES del sitio incrustado: medido, la cookie de sesión de
       un iframe salía al reabrir como cookie propia de su dominio, y con el
       mismo nombre que una de verdad la pisaba. Cada cierre metía en
       youtube.com o google.com valores sacados de sus iframes, por eso el
       lío solo aparecía en perfiles usados. Se reconocen porque una consulta
       por URL, que no incluye particionadas, no las ve. */
    const propias = await cookies.get({ url, name: c.name });
    if (!propias.some((p) => p.domain === c.domain && p.path === c.path && p.value === c.value)) continue;
    /* Las cookies de UN solo host (hostOnly) se reescriben SIN domain. Con
       domain, Chromium crea otra cookie distinta, de dominio, que convive con
       la original: Google y YouTube recibían dos cookies con el mismo nombre
       (una de ellas, copia vieja de 30 días que sobrevivía a cerrar sesión), y
       las `__Host-`, que prohíben domain, fallaban en silencio y se perdían. */
    const nueva = {
      url, name: c.name, value: c.value, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
      expirationDate: caduca
    };
    if (!c.hostOnly) nueva.domain = c.domain;
    try {
      await cookies.set(nueva);
      n++;
    } catch { /* alguna cookie rara se resistirá; no vale la pena romper el cierre */ }
  }
  try { await cookies.flushStore(); } catch { /* nada */ }
  return n;
}

module.exports = { conservaCookiesDeSesion, DIAS_SESION };

/* ===== FRENO CONTRA LOS BUCLES DE RECARGAS (2026-10-22) =====
   A Dosa, y a usuarios, YouTube se les quedaba en blanco "cargando". Medido por
   CDP: la portada se pedía, llegaba bien (servida por su service worker) y,
   antes de terminar de cargar, se volvía a pedir, dos veces por segundo durante
   minutos. Brave sufre lo mismo con Shields y sin causa conocida
   (brave-browser #49663 y #57995). Sea cual sea el origen, una pestaña que carga
   la misma página una y otra vez no le sirve a nadie: si pasa más de MAX veces
   en VENTANA, se detiene, se cortan las repeticiones durante PAUSA y la
   interfaz avisa con un botón para reintentar.
   Cuenta origen + ruta sin la query: el bucle de tema de YouTube alterna `/` y
   `/?themeRefresh=1`. Las navegaciones dentro del documento (las de una SPA) no
   cuentan, y una carga normal de YouTube con sus dos recargas propias (tema y
   consentimiento) se queda en tres, por debajo del tope.

   LAS RECARGAS DEL USUARIO NO CUENTAN (2026-11-03). El freno contaba igual un
   F5 de una persona que un bucle de la web: al quinto F5 en diez segundos la
   pestaña dejaba de recargar durante 30 s con el aviso de «se recargaba sin
   parar» (medido en la parte «huecos»). Ahora la interfaz avisa ANTES de cada
   recarga o navegación que pide el usuario (F5, Ctrl+R, el botón, el menú,
   escribir una dirección) y esa navegación pasa siempre: quita el freno si lo
   había y deja la cuenta a cero. Lo que la página haga DESPUÉS se vuelve a
   contar desde cero, así que un bucle de verdad se frena igual tras un F5.
   El pase dura PASE ms y vale para UNA navegación.
   Sin Electron, para poder probarlo (test/freno-recargas.test.js). */
'use strict';

const VENTANA = 10000;
const MAX = 4;
const PAUSA = 30000;
const PASE = 3000;

function claveDe(url) {
  if (!/^https?:/.test(url || '')) return null;
  try { const u = new URL(url); return u.origin + u.pathname; } catch { return null; }
}

/* navega(url, ahora) dice qué hacer con una navegación principal nueva:
     'sigue'  → déjala
     'corta'  → párala (la página sigue frenada)
     'frena'  → párala y avisa: acaba de pasarse del tope */
function crearFreno({ ventana = VENTANA, max = MAX, pausa = PAUSA, pase = PASE } = {}) {
  let clave = '', marcas = [], frenadoHasta = 0, paseHasta = 0;
  return {
    usuario(ahora) { paseHasta = ahora + pase; },
    reintenta() { marcas = []; frenadoHasta = 0; },
    navega(url, ahora) {
      const k = claveDe(url);
      if (!k) return 'sigue';
      if (paseHasta && ahora <= paseHasta) {
        paseHasta = 0; clave = k; marcas = []; frenadoHasta = 0;
        return 'sigue';
      }
      if (k === clave && ahora < frenadoHasta) return 'corta';
      if (k !== clave) { clave = k; marcas = []; frenadoHasta = 0; }
      marcas = marcas.filter((t) => ahora - t < ventana);
      marcas.push(ahora);
      if (marcas.length <= max) return 'sigue';
      marcas = []; frenadoHasta = ahora + pausa;
      return 'frena';
    }
  };
}

module.exports = { crearFreno, claveDe, VENTANA, MAX, PAUSA, PASE };

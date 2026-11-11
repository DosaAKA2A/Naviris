/* ===== CLAVES DE LA INTERFAZ CON EL NOMBRE VIEJO (2026-11-03) =====
   Hasta la 3.0 todo lo que la interfaz guarda en su localStorage (marcadores,
   historial, widgets, cuenta, temas…) iba en claves "cobalt.*", el nombre que
   tuvo Naviris. Ahora va en "naviris.*". Esto copia cada clave vieja a la
   nueva una sola vez, antes de que la interfaz (src/renderer/) lea nada. Lo demás del cambio
   de nombre (la sesión de las webs y los archivos del perfil) está en
   migraciones.js.

   Las viejas se quedan, como allí: la 2.x solo sabe leerlas, y desde la rama
   dev se puede volver a ella. Si no queda sitio para la copia (el localStorage
   tiene tope), esa clave se mueve en vez de copiarse. Si una no cabe ni así, las
   demás siguen y no se apunta como hecha: al abrir otra vez se copian las que
   falten (las ya copiadas no se tocan, pueden haber cambiado desde entonces).
   Las que fallaron quedan en una lista porque, mientras, la interfaz habrá escrito
   sus valores por defecto en esos nombres, y el dato bueno es el viejo. */
(function (raiz) {
  const VIEJO = 'cobalt.';
  const NUEVO = 'naviris.';
  const HECHO = 'naviris.clavesMigradas';
  const PENDIENTES = 'naviris.clavesPendientes';

  function migraClaves(ls) {
    if (ls.getItem(HECHO) === '1') return 0;
    const viejas = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(VIEJO)) viejas.push(k);
    }
    let pendientes = [];
    try { pendientes = JSON.parse(ls.getItem(PENDIENTES)) || []; } catch { /* sin lista */ }
    const fallidas = [];
    let copiadas = 0;
    for (const k of viejas) {
      const nueva = NUEVO + k.slice(VIEJO.length);
      if (ls.getItem(nueva) != null && !pendientes.includes(k)) continue;
      const v = ls.getItem(k);
      try {
        ls.setItem(nueva, v);
      } catch {
        ls.removeItem(k);
        try { ls.setItem(nueva, v); } catch { ls.setItem(k, v); fallidas.push(k); continue; }
      }
      copiadas++;
    }
    if (fallidas.length) {
      console.warn('[Naviris] Claves de la interfaz pendientes:', fallidas.join(', '));
      ls.setItem(PENDIENTES, JSON.stringify(fallidas));
      return copiadas;
    }
    ls.removeItem(PENDIENTES);
    ls.setItem(HECHO, '1');
    return copiadas;
  }

  /* EL ORIGEN DE LA INTERFAZ (2026-11-11). La interfaz pasó de file:// a
     naviris://app (ver protocolo.js) y su localStorage empieza vacío. `pide`
     trae del proceso principal lo que había en file:// (migra-origen.js) y aquí
     se copia tal cual, claves viejas cobalt.* incluidas (de ellas se encarga
     migraClaves, que va después). Se pide ANTES de tocar este almacén: el
     principal lee la misma base de disco que Chromium abre al primer acceso.
     Mientras no se apunte como hecha, lo viejo gana a lo que haya: si un
     arranque no pudo leerlo, la interfaz habrá puesto sus valores por defecto,
     y el dato bueno es el viejo. Si una clave no cabe, no se apunta y se
     reintenta entera en el siguiente arranque; nunca se borra nada. */
  const ORIGEN_HECHO = 'naviris.origenMigrado';
  function migraOrigen(ls, pide) {
    const viejo = pide();
    if (!viejo) return { nada: true };
    if (viejo.error) return { ok: false, error: viejo.error };
    if (ls.getItem(ORIGEN_HECHO) === '1') return { ok: true, copiadas: 0 };
    const fallidas = [];
    let copiadas = 0;
    for (const [k, v] of Object.entries(viejo.claves || {})) {
      try { ls.setItem(k, v); copiadas++; } catch { fallidas.push(k); }
    }
    if (fallidas.length) return { ok: false, fallidas };
    ls.setItem(ORIGEN_HECHO, '1');
    return { ok: true, copiadas };
  }

  /* EL ACCESO DE FÁBRICA A IRIS.IT.COM (2026-11-11). El dominio caducó y hoy lo
     sirve un tercero, así que sale de los accesos de fábrica. A quien ya tenía
     sus accesos guardados se le quita solo ese, una vez, y solo si sigue siendo
     exactamente el de fábrica (mismo nombre y misma dirección): uno que la
     persona haya puesto o cambiado a mano se queda. Si no hay accesos
     guardados, la interfaz ya usa la lista de fábrica nueva. Espera a que las
     claves viejas estén copiadas: los accesos de la 2.x llegan por ahí. */
  const DIALS = 'naviris.dials';
  const IRIS_HECHO = 'naviris.irisFuera';
  const esIrisDeFabrica = (d) => !!d && d.name === 'IRIS' && d.url === 'https://iris.it.com';
  function quitaIrisDeFabrica(ls) {
    if (ls.getItem(IRIS_HECHO) === '1' || ls.getItem(HECHO) !== '1') return 0;
    let dials = null;
    try { dials = JSON.parse(ls.getItem(DIALS)); } catch { /* ilegible: no se toca */ }
    let quitados = 0;
    if (Array.isArray(dials)) {
      const quedan = dials.filter((d) => !esIrisDeFabrica(d));
      quitados = dials.length - quedan.length;
      if (quitados) ls.setItem(DIALS, JSON.stringify(quedan));
    }
    ls.setItem(IRIS_HECHO, '1');
    return quitados;
  }

  const api = { migraClaves, migraOrigen, quitaIrisDeFabrica };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.naviMigraClaves = api;
})(typeof window !== 'undefined' ? window : globalThis);

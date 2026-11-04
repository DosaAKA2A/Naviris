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

  const api = { migraClaves };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.naviMigraClaves = api;
})(typeof window !== 'undefined' ? window : globalThis);

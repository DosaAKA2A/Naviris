/* ===== CLAVES DE LA INTERFAZ CON EL NOMBRE VIEJO (2026-11-03) =====
   Hasta la 3.0 todo lo que la interfaz guarda en su localStorage (marcadores,
   historial, widgets, cuenta, temas…) iba en claves "cobalt.*", el nombre que
   tuvo Naviris. Ahora va en "naviris.*". Esto copia cada clave vieja a la
   nueva una sola vez, antes de que renderer.js lea nada. Lo demás del cambio
   de nombre (la sesión de las webs y los archivos del perfil) está en
   migraciones.js.

   Las viejas se quedan, como allí: la 2.x solo sabe leerlas, y desde la rama
   dev se puede volver a ella. Si no queda sitio para la copia (el localStorage
   tiene tope), esa clave se mueve en vez de copiarse. Si algo falla a medias
   no se apunta como hecha: al abrir otra vez se copian las que falten (las ya
   copiadas no se tocan, pueden haber cambiado desde entonces). */
(function (raiz) {
  const VIEJO = 'cobalt.';
  const NUEVO = 'naviris.';
  const HECHO = 'naviris.clavesMigradas';

  function migraClaves(ls) {
    if (ls.getItem(HECHO) === '1') return 0;
    const viejas = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(VIEJO)) viejas.push(k);
    }
    let copiadas = 0;
    for (const k of viejas) {
      const nueva = NUEVO + k.slice(VIEJO.length);
      if (ls.getItem(nueva) != null) continue;
      const v = ls.getItem(k);
      try {
        ls.setItem(nueva, v);
      } catch {
        ls.removeItem(k);
        try { ls.setItem(nueva, v); } catch (e) { ls.setItem(k, v); throw e; }
      }
      copiadas++;
    }
    ls.setItem(HECHO, '1');
    return copiadas;
  }

  const api = { migraClaves };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.naviMigraClaves = api;
})(typeof window !== 'undefined' ? window : globalThis);
